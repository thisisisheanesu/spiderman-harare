#!/usr/bin/env python3
"""Extra real Zimbabwean audio for Spider-Man: Harare: street ambience loops and a Shona greetings sprite.

Usage:
    python3 tools/build_extras.py [--out public/audio] [--cache DIR] [--ffmpeg PATH] [--verify-only]

Everything is rebuilt from the public source URLs listed in AMBIENCE and CLIPS below (each with its author,
title, licence and page; the FSI unit files come from fsi_url()). Downloads are cached in --cache and fetched at
most one per ~1.2 s with a descriptive User-Agent (backing off on HTTP 429/5xx).

Outputs (in --out; URLs in the manifest are relative to the site root, no leading slash):
    street/<id>.mp3          seamless ambience loops, 44.1 kHz, 96 kbps CBR, integrated loudness -20 LUFS
    street/greetings.mp3     Shona greetings/exclamations sprite, mono 24 kHz 48 kbps CBR, 0.30 s silence between clips
    extras.json              manifest {version, ambience[], sprite, clips[]}
    CREDITS-extra.md         attribution for every source file

Ambience pipeline (per source): decode at 44.1 kHz -> high-pass -> take [t0, t0 + len + xfade] -> fold the last
`xfade` seconds over the first ones with an equal-power cross-fade (so the file is circular: its end runs straight
into its start) -> gain to -20 LUFS (measured on 3 tiled copies, so the loop point counts like any other moment),
limiter at -1.5 dBFS applied to the tiled copy (middle cycle kept, so limiter state is continuous across the loop
point) -> rotate the start to a calm moment -> MP3.

Greetings pipeline (per clip): decode the FSI unit at 24 kHz -> 90 Hz high-pass + FFT denoise (tape hiss) ->
cut the reviewed window -> energy-trim to the speech with 60 ms padding -> 15 ms fades -> active-speech RMS to
-20 dBFS with a -2 dBFS peak ceiling -> concatenate with 0.30 s digital silence -> MP3. Offsets in extras.json are
computed from the PCM concatenation and verified on the decoded MP3 (speech energy right after every clip start,
digital silence in every gap).

How the greeting windows were chosen (not repeated at build time, recorded here for review): each FSI unit was
split at pauses by an energy detector, every pause-delimited segment of the basic dialogues was transcribed with
Meta's MMS-1b-all Shona ASR model and matched against the dialogue text printed in the FSI Shona Basic Course
(1965); only segments whose ASR transcript matched the book's text were kept (the transcript is stored as `asr`
next to each clip below). One exception, kept on purpose: in Unit 8 the book prints "Hongu, tingaenda" but the
speaker clearly says "Hunde, tingaenda" (ASR and CTC scores agree; the book uses "Hunde" for "yes" elsewhere), so the
text follows the audio. "Hunde" alone was cut at the energy minimum (58.19 s) of the short pause before
"tingaenda" (found with CTC forced alignment, then refined on the energy curve).
Speaker: the course preface credits the Shona tape voices to Mr. and Mrs. Matthew Mataranyika. Every clip used here
is the same male voice: a WavLM speaker-verification model scores all of them as close to each other as two takes of
one line, and a wav2vec2 gender classifier (Common Voice) gives male >= 0.98 for each. Pitch (`f0`, median Hz)
still varies a lot (108-273 Hz) with the tone pattern and emphasis of the phrase.
"""
import argparse
import json
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
SCRATCH = Path('/tmp/claude-0/-home-user-spiderman-harare/e6051643-6af1-580e-a761-33b3fad97763/scratchpad/extras')
DEFAULT_OUT = REPO / 'public' / 'audio'
DEFAULT_CACHE = SCRATCH / 'build_cache'
DEFAULT_FFMPEG = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
USER_AGENT = 'SpiderManHarareFanGame/0.1 (https://github.com/thisisisheanesu/spiderman-harare)'

AMB_SR = 44100
AMB_KBPS = 96
AMB_LUFS = -20.0
AMB_CEIL_DB = -1.5
SPRITE_SR = 24000
SPRITE_KBPS = 48
GAP_S = 0.30
PAD_S = 0.060
FADE_S = 0.015
CLIP_RMS_DB = -20.0
CLIP_PEAK_DB = -2.0

CC0 = ('CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/')
BY_SA_3 = ('CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/')
PD_US = ('Public domain (work of the U.S. Government)', 'https://creativecommons.org/publicdomain/mark/1.0/')
RCD = 'radio continental drift (Claudia Wegener)'

# ---------------------------------------------------------------------------------------------------------------
# Ambience sources. t0/len/xfade in seconds of the source file; hp = high-pass corner (Hz); ch = output channels.
# Windows were picked for a steady level (lowest 0.5 s-level spread, no isolated bangs, similar level at both
# ends) and reviewed on spectrograms.
AMBIENCE = [
    dict(id='market-avondale', use='market', ch=2, hp=120, t0=22.0, len=60.0, xfade=3.0,
         url='https://cdn.freesound.org/previews/534/534700_7083541-hq.mp3',
         source='https://freesound.org/people/KevZim/sounds/534700/',
         title='Suburban Shopping Centre Zimbabwe', author='KevZim (Freesound)', license=CC0,
         place='Outside Avondale Flea Market, Avondale shopping centre, Harare (geotagged -17.8007, 31.0384)',
         recorded='uploaded 11 Sep 2020 (recording date not given), Zoom H4n',
         desc='Outdoor bustle outside a flea market: many voices at a distance, footsteps, traffic behind. '
              'Source is the Freesound high-quality MP3 preview (the original WAV needs a login).'),
    dict(id='rank-entumbane', use='rank', ch=1, hp=90, t0=41.0, len=60.0, xfade=3.0,
         url='https://archive.org/download/aporee_34495_39655/BingaBusAtEntumbaneRank.mp3',
         source='https://archive.org/details/aporee_34495_39655',
         title='Entumbane Rank, Bulawayo, Zimbabwe - Binga bus leaving Entumbane rank', author=RCD, license=BY_SA_3,
         place='Entumbane bus rank, Luveve Rd, Bulawayo (-20.1272, 28.5352)',
         recorded='15 May 2016, mobile phone (mono)',
         desc='Inside the long-distance bus to Binga while it still sits at the rank, full of traders and '
              'passengers talking before departure. radio aporee ::: maps / All Africa Sound Map.'),
    dict(id='street-parklane', use='street', ch=2, hp=90, t0=126.0, len=60.0, xfade=3.0,
         url='https://archive.org/download/aporee_22318_25902/01CityPresbyterianChurchHarare.mp3',
         source='https://archive.org/details/aporee_22318_25902',
         title='Park Lane, Harare, Zimbabwe - City Presbyterian Church Harare', author=RCD, license=BY_SA_3,
         place='Park Lane by Harare Gardens / National Gallery, central Harare (-17.8264, 31.0473)',
         recorded='4 Oct 2012, ~18:40',
         desc='Evening street: gospel singing pours out of the open windows and doors of City Presbyterian Church '
              'onto Park Lane as people walk past to their kombis.'),
    dict(id='park-avenues', use='park', ch=2, hp=90, t0=219.0, len=60.0, xfade=3.0,
         url='https://archive.org/download/aporee_22319_25903/02AfricanApostolicChurch.mp3',
         source='https://archive.org/details/aporee_22319_25903',
         title='Avenues, Harare, Zimbabwe - Sabbath service', author=RCD, license=BY_SA_3,
         place='Open field on Herbert Chitepo Avenue, the Avenues, Harare (-17.8199, 31.0580)',
         recorded='listed 8 Aug 2012, 14:15 (the recordist describes a Saturday-midday service)',
         desc='Sabbath service of the African Apostolic Church in the open: a large white-robed congregation seated '
              'on the grass, call-and-response singing led by one voice. Recorded close to the group.'),
]

# ---------------------------------------------------------------------------------------------------------------
# Greetings: FSI Shona Basic Course tapes (Foreign Service Institute, 1965; Shona voices by Mr. and Mrs. Matthew
# Mataranyika). Work of the U.S. Government -> public domain in the USA; the archive.org item carries the Public
# Domain Mark.
FSI_ITEM = 'https://archive.org/details/Shona_201407'
FSI_BOOK = 'https://archive.org/details/micro_IA41153663_0434'

# Honest notes shown with some clips (the 'call' clips are real Shona speech, but read calmly, not shouted).
CLIP_NOTE = {cid: ('Destination read calmly from the course vocabulary list (1960s place-name forms), not a real '
                   'conductor shout; pitch/volume it up for a hwindi.') for cid in (
    'sn-ku-harare', 'sn-kwa-mutare', 'sn-ku-marondera', 'sn-ku-kwekwe', 'sn-ku-gweru', 'sn-ku-bhuruwayo',
    'sn-ku-chipinga')}
CLIP_NOTE['sn-ndiri-kutengesa-mahobo'] = "Vendor's line from a textbook market dialogue, spoken calmly."
CLIP_NOTE['sn-hunde'] = CLIP_NOTE['sn-hunde-tingaenda'] = (
    "'Hunde' is this speaker's regional word for 'yes' (the course book prints 'Hongu' in this dialogue and "
    "'Hunde' elsewhere); in Harare you would more often hear 'Hongu' or 'Ehe'.")


def fsi_url(unit):
    name = f'FSI - Shona Basic Course - Unit {unit:02d}.mp3'
    return 'https://archive.org/download/Shona_201407/' + urllib.parse.quote(name)


FSI_SPEAKER = {'male': 'Matthew Mataranyika (FSI tape voice)'}

# unit, window (s) in the unit mp3, kind, Shona text (FSI spelling, tone marks dropped), English, sex, MMS ASR
# transcript of the window, median F0 (Hz). Filled from the review described in the module docstring.
CLIPS = [
    dict(id='sn-mangwanani-mai', unit=1, win=(9.82, 11.28), kind='greet', lang='sn',
         text='Mangwanani mai.', en='Good morning, madam.',
         gender='male', asr='mangwanani mai', f0=128),
    dict(id='sn-mangwanani-baba', unit=1, win=(17.56, 18.87), kind='greet', lang='sn',
         text='Mangwanani baba.', en='Good morning, sir.',
         gender='male', asr='mangwanani baba', f0=116),
    dict(id='sn-mwarara-here', unit=1, win=(29.76, 31.01), kind='greet', lang='sn',
         text='Mwarara here?', en='Did you sleep well? (the usual morning "how are you")',
         gender='male', asr='mwararahere', f0=109),
    dict(id='sn-ndarara-zvangu', unit=1, win=(37.02, 38.33), kind='greet', lang='sn',
         text='Ndarara zvangu.', en='I slept well. (reply)',
         gender='male', asr='ndarara zvangu', f0=108),
    dict(id='sn-mangwanani-shewe', unit=2, win=(12.68, 14.15), kind='greet', lang='sn',
         text='Mangwanani shewe.', en='Good morning (respectful).',
         gender='male', asr='mangwa nanishewe', f0=146),
    dict(id='sn-mangwanani-chirombowe', unit=2, win=(20.30, 21.84), kind='greet', lang='sn',
         text='Mangwanani chirombowe.', en='Good morning (respectful, to a man).',
         gender='male', asr='mangwananichirombawi', f0=136),
    dict(id='sn-masikati', unit=10, win=(19.65, 21.11), kind='greet', lang='sn',
         text='Masikati.', en='Good afternoon.',
         gender='male', asr='masikaati', f0=140),
    dict(id='sn-masikati-baba', unit=4, win=(23.25, 24.74), kind='greet', lang='sn',
         text='Masikati baba.', en='Good afternoon, sir.',
         gender='male', asr='masikati baba', f0=131),
    dict(id='sn-masikati-muzvare', unit=3, win=(11.19, 13.11), kind='greet', lang='sn',
         text='Masikati muzvare.', en='Good afternoon, miss.',
         gender='male', asr='masikati muzvare', f0=153),
    dict(id='sn-masikati-mwanangu', unit=4, win=(10.29, 11.97), kind='greet', lang='sn',
         text='Masikati mwanangu.', en='Good afternoon, my child.',
         gender='male', asr='masikati mwanangu', f0=146),
    dict(id='sn-masikati-shewe', unit=3, win=(20.35, 21.83), kind='greet', lang='sn',
         text='Masikati shewe.', en='Good afternoon (respectful).',
         gender='male', asr='masikati shewe', f0=130),
    dict(id='sn-masikati-chirombowe', unit=10, win=(9.90, 11.93), kind='greet', lang='sn',
         text='Masikati chirombowe.', en='Good afternoon (respectful, to a man).',
         gender='male', asr='masikati chirombowe', f0=179),
    dict(id='sn-mwaswera-here-shewe', unit=3, win=(29.34, 31.17), kind='greet', lang='sn',
         text='Mwaswera here shewe?', en='How has your day been? (respectful)',
         gender='male', asr='mwaswerahere shewe', f0=151),
    dict(id='sn-ndaswera-zvangu', unit=3, win=(38.94, 41.70), kind='greet', lang='sn',
         text='Ndaswera zvangu kana mwaswerawo.', en="I've had a good day, if you have too.",
         gender='male', asr='ndaswera zvangu kana maswera', f0=130),
    dict(id='sn-masanga-chirombowe', unit=5, win=(9.76, 11.76), kind='greet', lang='sn',
         text='Masanga chirombowe.', en='Hello! (greeting between people meeting on the road)',
         gender='male', asr='masanga chirombowe', f0=164),
    dict(id='sn-mwazviita', unit=9, win=(110.87, 112.28), kind='greet', lang='sn',
         text='Mwazviita.', en='Thank you.',
         gender='male', asr='mwazviita', f0=205),
    dict(id='sn-tamusiya', unit=9, win=(112.77, 114.20), kind='greet', lang='sn',
         text='Tamusiya.', en='Goodbye. (lit. "we have left you")',
         gender='male', asr='kamusiiya', f0=152),
    dict(id='sn-aiwa-zvitambo', unit=2, win=(36.68, 38.12), kind='exclaim', lang='sn',
         text='Aiwa, zvitambo.', en='Oh, very well indeed!',
         gender='male', asr='aiwa zvitambo', f0=122),
    dict(id='sn-hunde', unit=8, win=(57.37, 58.19), kind='exclaim', lang='sn',
         text='Hunde.', en='Yes.',
         gender='male', asr='hunde', f0=273),
    dict(id='sn-hunde-tingaenda', unit=8, win=(57.37, 59.20), kind='exclaim', lang='sn',
         text='Hunde, tingaenda.', en="Yes, let's go.",
         gender='male', asr='hunde tingaenda', f0=168),
    dict(id='sn-munhu-ndiani', unit=5, win=(26.78, 28.41), kind='exclaim', lang='sn',
         text='Munhu ndiani?', en='Who is that? / Who are you?',
         gender='male', asr='munhu ndiani', f0=164),
    dict(id='sn-muri-kutsvaka-ani', unit=10, win=(27.09, 28.81), kind='exclaim', lang='sn',
         text='Muri kutsvaka ani?', en='Who are you looking for?',
         gender='male', asr='muri kutsvaka ani', f0=177),
    dict(id='sn-anoita-marinyi', unit=9, win=(21.56, 23.51), kind='exclaim', lang='sn',
         text='Anoita marinyi?', en='How much are they?',
         gender='male', asr='anoita marinyi', f0=195),
    dict(id='sn-muri-kunyanya-kani', unit=9, win=(45.66, 48.49), kind='exclaim', lang='sn',
         text='Ah! Muri kunyanya kani!', en="Oh, that's too much! (too expensive)",
         gender='male', asr='aa muri kunyanya kaani', f0=192),
    dict(id='sn-ndiri-kutengesa-mahobo', unit=9, win=(9.64, 11.92), kind='call', lang='sn',
         text='Ndiri kutengesa mahobo.', en="I'm selling bananas.",
         gender='male', asr='ndiri kutengesa mahobo', f0=190),
    dict(id='sn-ku-harare', unit=10, win=(102.44, 103.88), kind='call', lang='sn',
         text='KuHarare.', en='To Harare.',
         gender='male', asr='kuharaare', f0=175),
    dict(id='sn-kwa-mutare', unit=10, win=(93.17, 94.59), kind='call', lang='sn',
         text='KwaMutare.', en='To Mutare.',
         gender='male', asr='kwamutaare', f0=195),
    dict(id='sn-ku-marondera', unit=10, win=(106.35, 107.95), kind='call', lang='sn',
         text='KuMarondera.', en='To Marondera.',
         gender='male', asr='kumarondera', f0=174),
    dict(id='sn-ku-kwekwe', unit=10, win=(114.50, 115.78), kind='call', lang='sn',
         text='KuKwekwe.', en='To Kwekwe.',
         gender='male', asr='kukwekwe', f0=200),
    dict(id='sn-ku-gweru', unit=10, win=(118.56, 119.89), kind='call', lang='sn',
         text='KuGweru.', en='To Gweru.',
         gender='male', asr='kugweru', f0=184),
    dict(id='sn-ku-bhuruwayo', unit=10, win=(122.44, 123.94), kind='call', lang='sn',
         text='KuBhuruwayo.', en='To Bulawayo.',
         gender='male', asr='kubhuruwayo', f0=167),
    dict(id='sn-ku-chipinga', unit=10, win=(126.20, 127.65), kind='call', lang='sn',
         text='KuChipinga.', en='To Chipinge (then spelt Chipinga).',
         gender='male', asr='kuchipinga', f0=202),
]


# ---------------------------------------------------------------------------------------------------------------
def log(*a):
    print(*a, flush=True)


_last_fetch = [0.0]


def fetch(url, cache_dir):
    cache_dir.mkdir(parents=True, exist_ok=True)
    name = re.sub(r'[^A-Za-z0-9._-]+', '_', urllib.parse.unquote(url.split('://', 1)[1]))[-150:]
    path = cache_dir / name
    if path.exists() and path.stat().st_size > 0:
        return path
    for attempt in range(6):
        wait = 1.2 - (time.time() - _last_fetch[0])
        if wait > 0:
            time.sleep(wait)
        _last_fetch[0] = time.time()
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            path.write_bytes(data)
            log(f'  downloaded {url} ({len(data):,d} bytes)')
            return path
        except urllib.error.HTTPError as e:
            # 429/5xx: back off; 404 can come from a flaky archive.org storage node behind a redirect: retry
            if e.code in (404, 429, 500, 502, 503, 504) and attempt < 5:
                ra = e.headers.get('Retry-After')
                time.sleep(max(int(ra) if ra and ra.isdigit() else 0, 5 * (attempt + 1)))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt < 5:
                time.sleep(5 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f'could not download {url}')


def decode(ffmpeg, path, sr, channels, af=None):
    cmd = [ffmpeg, '-v', 'error', '-nostdin', '-i', str(path)]
    if af:
        cmd += ['-af', af]
    cmd += ['-f', 'f32le', '-ac', str(channels), '-ar', str(sr), 'pipe:1']
    out = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype='<f4').reshape(-1, channels).astype(np.float64)


def run_filter(ffmpeg, x, sr, af):
    ch = x.shape[1]
    cmd = [ffmpeg, '-v', 'error', '-nostdin', '-f', 'f32le', '-ar', str(sr), '-ac', str(ch), '-i', 'pipe:0',
           '-af', af, '-f', 'f32le', '-ar', str(sr), '-ac', str(ch), 'pipe:1']
    out = subprocess.run(cmd, input=x.astype('<f4').tobytes(), capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype='<f4').reshape(-1, ch).astype(np.float64)


def loudness(ffmpeg, x, sr):
    """EBU R128 integrated loudness (LUFS) and true peak (dBTP) via ffmpeg's ebur128 filter."""
    ch = x.shape[1]
    cmd = [ffmpeg, '-hide_banner', '-nostdin', '-f', 'f32le', '-ar', str(sr), '-ac', str(ch), '-i', 'pipe:0',
           '-af', 'ebur128=peak=true', '-f', 'null', '-']
    err = subprocess.run(cmd, input=x.astype('<f4').tobytes(), capture_output=True, check=True).stderr.decode()
    summary = err[err.rfind('Summary:'):]
    i = float(re.search(r'I:\s+(-?[\d.]+|-inf) LUFS', summary).group(1))
    tp = float(re.search(r'Peak:\s+(-?[\d.]+|-inf) dBFS', summary).group(1))
    return i, tp


def encode_mp3(ffmpeg, x, sr, path, kbps, out_sr=None, af=None):
    ch = x.shape[1] if x.ndim == 2 else 1
    cmd = [ffmpeg, '-v', 'error', '-nostdin', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', str(ch), '-i', 'pipe:0']
    if af:
        cmd += ['-af', af]
    cmd += ['-ar', str(out_sr or sr), '-ac', str(ch), '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', '-map_metadata', '-1',
            str(path)]
    subprocess.run(cmd, input=x.astype('<f4').tobytes(), capture_output=True, check=True)


def db(v):
    return 10 * np.log10(np.maximum(v, 1e-20))


def rms_db(x):
    return float(db(np.mean(np.square(x)))) if len(x) else -200.0


# ---------------------------------------------------------------------------------------------------------------
def build_ambience(ffmpeg, spec, cache, out_dir):
    src = fetch(spec['url'], cache)
    x = decode(ffmpeg, src, AMB_SR, spec['ch'], af=f'highpass=f={spec["hp"]}:poles=2')
    L, X = int(spec['len'] * AMB_SR), int(spec['xfade'] * AMB_SR)
    a = int(spec['t0'] * AMB_SR)
    seg = x[a:a + L + X]
    if len(seg) < L + X:
        raise RuntimeError(f'{spec["id"]}: source too short for the window')
    # circular loop: the tail [L, L+X) is folded over the head [0, X) with an equal-power cross-fade
    ramp = (np.arange(X) + 0.5) / X
    fade_in, fade_out = np.sin(ramp * np.pi / 2), np.cos(ramp * np.pi / 2)
    y = seg[:L].copy()
    y[:X] = seg[:X] * fade_in[:, None] + seg[L:L + X] * fade_out[:, None]
    # loudness on 3 tiled cycles, then gain + limiter on the tiled copy; keep the middle cycle
    tiled = np.tile(y, (3, 1))
    lufs, _ = loudness(ffmpeg, tiled, AMB_SR)
    gain_db = AMB_LUFS - lufs
    lim = 10 ** (AMB_CEIL_DB / 20)
    for _ in range(3):   # the limiter shaves a little loudness off very peaky sources: re-aim until within 0.2 LU
        z = run_filter(ffmpeg, tiled, AMB_SR,
                       f'volume={gain_db:.3f}dB,alimiter=limit={lim:.4f}:level=disabled:attack=5:release=80:asc=1')
        got, _ = loudness(ffmpeg, z, AMB_SR)
        if abs(got - AMB_LUFS) <= 0.2:
            break
        gain_db += AMB_LUFS - got
    y = z[L:2 * L]
    # rotate so the file starts at a calm, steady moment (the loop is circular, any sample may start it)
    w = int(0.05 * AMB_SR)
    mono = y.mean(axis=1)
    p = np.concatenate([[0.0], np.cumsum(np.concatenate([mono, mono[:w]]) ** 2)])
    lv = db((p[w:w + L] - p[:L]) / w)
    prev = np.roll(lv, w)
    med = np.median(lv)
    cost = np.abs(lv - prev) + 0.5 * np.abs(lv - med) + 0.5 * np.abs(prev - med)
    cost = cost + 0.25 * (lv - med)                  # ...preferably a quieter one
    k = int(np.argmin(cost[::441]) * 441)
    zc = np.nonzero(np.diff(np.signbit(mono[k:k + 441])))[0]     # snap to a zero crossing of the downmix
    k = (k + int(zc[np.argmin(np.abs(y[k + zc]).sum(axis=1))]) + 1) % L if len(zc) else k
    y = np.roll(y, -k, axis=0)
    out = out_dir / 'street' / f'{spec["id"]}.mp3'
    encode_mp3(ffmpeg, y, AMB_SR, out, AMB_KBPS)
    return dict(path=out, lufs_in=lufs, gain_db=gain_db, rotate_s=k / AMB_SR)


def verify_ambience(ffmpeg, spec, path):
    y2 = decode(ffmpeg, path, AMB_SR, spec['ch'])
    dur = len(y2) / AMB_SR
    lufs, tp = loudness(ffmpeg, np.tile(y2, (3, 1)), AMB_SR)
    y = y2.mean(axis=1)
    n = int(0.05 * AMB_SR)
    body = np.array([rms_db(y[i:i + n]) for i in range(0, len(y) - n, n)])
    steps = np.abs(np.diff(body))
    seam = abs(rms_db(y[-n:]) - rms_db(y[:n]))
    jump = float(np.abs(y2[0] - y2[-1]).max())
    typical = float(np.percentile(np.abs(np.diff(y2, axis=0)), 99.9))
    good = (abs(dur - spec['len']) < 0.02 and abs(lufs - AMB_LUFS) <= 1.0 and tp <= -0.5
            and seam <= np.percentile(steps, 99.5) and jump <= typical)
    log(f'  VERIFY {path.name}: {dur:.3f} s, {lufs:.1f} LUFS, peak {tp:.1f} dBFS; loop point: level step '
        f'{seam:.1f} dB (body 50 ms steps: median {np.median(steps):.1f}, '
        f'99.5th pct {np.percentile(steps, 99.5):.1f}), '
        f'sample step {jump:.4f} (body 99.9th pct {typical:.4f}) -> {"OK" if good else "FAIL"}')
    return good, dict(dur=dur, lufs=lufs, peak=tp)


# ---------------------------------------------------------------------------------------------------------------
def speech_bounds(x, sr, frame=0.01):
    """First/last 10 ms frame above an adaptive threshold (floor + 30 % of the floor->peak range, in dB)."""
    h = int(frame * sr)
    n = len(x) // h
    e = db(np.mean(np.square(x[:n * h].reshape(n, h)), axis=1))
    floor, peak = np.percentile(e, 5), np.percentile(e, 99)
    on = np.nonzero(e > floor + 0.30 * (peak - floor))[0]
    return on[0] * h, (on[-1] + 1) * h


def render_clip(units, c):
    x = units[c['unit']]
    a, b = int(c['win'][0] * SPRITE_SR), int(c['win'][1] * SPRITE_SR)
    w = x[a:b]
    s, e = speech_bounds(w, SPRITE_SR)
    pad = int(PAD_S * SPRITE_SR)
    y = w[max(0, s - pad):min(len(w), e + pad)].copy()
    f = int(FADE_S * SPRITE_SR)
    ramp = np.linspace(0, 1, f)
    y[:f] *= ramp
    y[-f:] *= ramp[::-1]
    # active-speech RMS (frames within 25 dB of the loudest) -> CLIP_RMS_DB, peak ceiling CLIP_PEAK_DB
    h = int(0.02 * SPRITE_SR)
    fr = y[:len(y) // h * h].reshape(-1, h)
    fe = db(np.mean(np.square(fr), axis=1))
    act = fr[fe > fe.max() - 25]
    g = 10 ** ((CLIP_RMS_DB - rms_db(act.ravel())) / 20)
    g = min(g, 10 ** (CLIP_PEAK_DB / 20) / np.abs(y).max())
    return y * g


def build_sprite(ffmpeg, cache, out_dir):
    units = {}
    for u in sorted({c['unit'] for c in CLIPS}):
        path = fetch(fsi_url(u), cache)
        units[u] = decode(ffmpeg, path, SPRITE_SR, 1, af='highpass=f=90:poles=2,afftdn=nr=12:nf=-50:tn=1')[:, 0]
    gap = np.zeros(int(GAP_S * SPRITE_SR))
    parts, n, clips = [], 0, []
    for i, c in enumerate(CLIPS):
        y = render_clip(units, c)
        if i:
            parts.append(gap)
            n += len(gap)
        clips.append(dict(c, start=round(n / SPRITE_SR, 4), dur=round(len(y) / SPRITE_SR, 4)))
        parts.append(y)
        n += len(y)
    pcm = np.concatenate(parts)[:, None]
    out = out_dir / 'street' / 'greetings.mp3'
    encode_mp3(ffmpeg, pcm, SPRITE_SR, out, SPRITE_KBPS)
    return out, clips, n / SPRITE_SR


def verify_sprite(ffmpeg, path, clips, seconds):
    """Decode the sprite and check every clip: speech must begin 20-200 ms after `start` (60 ms pad + trimmed
    onset) and end at most 200 ms before `start + dur`, and the 0.30 s gap before each clip must be digital silence."""
    y = decode(ffmpeg, path, SPRITE_SR, 1)[:, 0]
    ok = abs(len(y) / SPRITE_SR - seconds) < 0.01
    log(f'  VERIFY {path.name}: decoded {len(y) / SPRITE_SR:.3f} s (PCM {seconds:.3f} s)')
    h = int(0.01 * SPRITE_SR)
    worst_gap = -200.0
    for c in clips:
        a = int(round(c['start'] * SPRITE_SR))
        b = int(round((c['start'] + c['dur']) * SPRITE_SR))
        seg = y[a:b]
        e = db(np.mean(np.square(seg[:len(seg) // h * h].reshape(-1, h)), axis=1))
        loud = np.nonzero(e > -45.0)[0]
        onset = loud[0] * h / SPRITE_SR if len(loud) else 9.0
        tail = (len(e) - 1 - loud[-1]) * h / SPRITE_SR if len(loud) else 9.0
        before = rms_db(y[max(0, a - int(0.27 * SPRITE_SR)):a - int(0.03 * SPRITE_SR)]) if a > 0 else -200.0
        good = 0.02 <= onset <= 0.20 and 0.0 <= tail <= 0.20 and before < -60 and rms_db(seg) > -35
        worst_gap = max(worst_gap, before)
        ok &= good
        log(f'    {c["id"]:<26} start {c["start"]:7.3f} dur {c["dur"]:5.2f}  speech from +{onset * 1000:3.0f} ms to '
            f'-{tail * 1000:3.0f} ms  clip {rms_db(seg):6.1f} dBFS  gap before {before:7.1f} dBFS  '
            f'{"OK" if good else "FAIL"}')
    log(f'  {len(clips)} clips, loudest gap {worst_gap:.1f} dBFS -> {"OK" if ok else "FAIL"}')
    return ok


# ---------------------------------------------------------------------------------------------------------------
def manifest(amb, clips):
    return {
        'version': 1,
        'attribution': ('Street ambience: KevZim (Freesound, CC0) and radio continental drift / Claudia Wegener '
                        '(radio aporee, CC BY-SA 3.0). Shona greetings: FSI Shona Basic Course tapes (U.S. Foreign '
                        'Service Institute, 1965, public domain), voice of Matthew Mataranyika. '
                        'See audio/CREDITS-extra.md.'),
        'ambience': [dict(id=s['id'], url=f'audio/street/{s["id"]}.mp3', use=s['use'], place=s['place'],
                          author=s['author'], license=s['license'][0], license_url=s['license'][1],
                          source=s['source'], title=s['title'], recorded=s['recorded'],
                          dur=round(amb[s['id']]['dur'], 3), channels=s['ch'], loop=True) for s in AMBIENCE],
        'sprite': 'audio/street/greetings.mp3',
        'clips': [dict(id=c['id'], start=c['start'], dur=c['dur'], kind=c['kind'], lang=c['lang'], text=c['text'],
                       en=c['en'], gender=c['gender'], speaker=FSI_SPEAKER[c['gender']],
                       author='Foreign Service Institute (U.S. Department of State), Shona Basic Course (1965)',
                       license=PD_US[0], license_url=PD_US[1], source=FSI_ITEM, source_file=fsi_url(c['unit']),
                       **({'note': CLIP_NOTE[c['id']]} if c['id'] in CLIP_NOTE else {})) for c in clips],
    }


def credits(amb, clips):
    units = ', '.join(f'{u:02d}' for u in sorted({c['unit'] for c in clips}))
    lines = ['# Extra street audio credits', '',
             'Real recordings made in Zimbabwe, used under their open licences and rebuilt reproducibly from the',
             'source URLs below by `tools/build_extras.py` (its docstring documents every processing step). The FLEURS',
             'voices and `crowd_loop.mp3` are credited separately in `CREDITS.md`.', '',
             '## Street ambience loops (`street/*.mp3`)', '',
             '| File | Use | Where | Recording | Author | Licence |', '|---|---|---|---|---|---|']
    for s in AMBIENCE:
        lines.append(f'| `street/{s["id"]}.mp3` | {s["use"]} | {s["place"]} | [{s["title"]}]({s["source"]}) '
                     f'({s["recorded"]}) | {s["author"]} | [{s["license"][0]}]({s["license"][1]}) |')
    lines += ['']
    for s in AMBIENCE:
        a = amb[s['id']]
        lines += [f'- **`street/{s["id"]}.mp3`**: "{s["title"]}" by {s["author"]}, <{s["source"]}> '
                  f'(file: <{s["url"]}>), licensed {s["license"][0]} (<{s["license"][1]}>). {s["desc"]} '
                  f'Changes: excerpt {s["t0"]:.0f}-{s["t0"] + s["len"] + s["xfade"]:.0f} s, {s["hp"]} Hz high-pass, '
                  f'{"downmixed to mono, " if s["ch"] == 1 else ""}{s["xfade"]:.0f} s cross-fade into a '
                  f'{s["len"]:.0f} s seamless loop, gain {a["gain_db"]:+.1f} dB to -20 LUFS with a -1.5 dBFS limiter, '
                  f'start rotated by {a["rotate_s"]:.1f} s, MP3 {AMB_KBPS} kbps.']
    lines += ['',
              'The three loops adapted from radio continental drift recordings are licensed CC BY-SA 3.0 like their',
              'sources (attribution + share-alike). radio continental drift is the radio/sound-art project of Claudia',
              'Wegener; the recordings belong to the radio aporee ::: maps "All Africa Sound Map" and to the archive',
              '"The Women Sing at Both Sides of the Zambezi" (<https://archive.org/details/Voices_from_Harare_422>).',
              '`market-avondale.mp3` is CC0 (no conditions; credit given as a courtesy).', '',
              '## Shona greetings sprite (`street/greetings.mp3`)', '',
              f'- Source: *Shona Basic Course* audio tapes, Units {units}, Foreign Service Institute, U.S. Department',
              f'  of State (Earl W. Stevick, 1965). Audio: <{FSI_ITEM}>; book (Shona text and English translations',
              f'  used for `text` / `en`): <{FSI_BOOK}>.',
              '- Voice: the preface says "Shona texts, exercises, and tape voicings were furnished by Mr. and Mrs.',
              '  Matthew Mataranyika", Shona speakers from what was then Southern Rhodesia (today Zimbabwe), 1963-65.',
              '  Every clip used here is the male voice (checked with a speaker-verification model and a gender',
              '  classifier), i.e. Mr. Matthew Mataranyika. No female voice is included.',
              f'- Licence: {PD_US[0]}. FSI courses are works of the U.S. federal government (17 U.S.C. 105); the',
              f'  archive.org item carries the Public Domain Mark (<{PD_US[1]}>). Attribution given as a courtesy.',
              '- Changes: cut from the unit recordings, 90 Hz high-pass, FFT denoise, trimmed to the phrase, loudness',
              '  matched, resampled to 24 kHz, concatenated into one MP3 sprite.',
              '- Checks: every clip was transcribed with an automatic Shona speech recogniser (Meta MMS) and matches',
              '  the text below up to small recogniser slips (e.g. "kamusiya" for Tamusiya); the offsets in',
              '  `extras.json` were verified on the decoded sprite.',
              '- Style: 1960s textbook Shona. The greetings (Mangwanani / Masikati / Mwaswera here? / Mwazviita) are',
              '  still everyday polite Shona; the place names use the old spellings (Chipinga = Chipinge) and are read',
              '  calmly, not shouted. Not Harare street slang.', '',
              '| id | Shona | English | kind | unit | note |', '|---|---|---|---|---|---|']
    for c in clips:
        lines.append(f'| `{c["id"]}` | {c["text"]} | {c["en"]} | {c["kind"]} | {c["unit"]:02d} | '
                     f'{CLIP_NOTE.get(c["id"], "")} |')
    lines += ['']
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--out', type=Path, default=DEFAULT_OUT)
    ap.add_argument('--cache', type=Path, default=DEFAULT_CACHE)
    ap.add_argument('--ffmpeg', default=DEFAULT_FFMPEG)
    ap.add_argument('--verify-only', action='store_true')
    args = ap.parse_args()
    out_dir = args.out
    (out_dir / 'street').mkdir(parents=True, exist_ok=True)
    ok_all = True
    amb = {}
    if args.verify_only:
        man = json.loads((out_dir / 'extras.json').read_text())
        for s in AMBIENCE:
            good, info = verify_ambience(args.ffmpeg, s, out_dir / 'street' / f'{s["id"]}.mp3')
            ok_all &= good
        clips = [dict(c, **{k: m[k] for k in ('start', 'dur')}) for c, m in zip(CLIPS, man['clips'])]
        seconds = clips[-1]['start'] + clips[-1]['dur']
        ok_all &= verify_sprite(args.ffmpeg, out_dir / 'street' / 'greetings.mp3', clips, seconds)
    else:
        log('ambience loops:')
        for s in AMBIENCE:
            info = build_ambience(args.ffmpeg, s, args.cache, out_dir)
            good, v = verify_ambience(args.ffmpeg, s, info['path'])
            ok_all &= good
            amb[s['id']] = dict(info, **v)
        log('greetings sprite:')
        path, clips, seconds = build_sprite(args.ffmpeg, args.cache, out_dir)
        ok_all &= verify_sprite(args.ffmpeg, path, clips, seconds)
        (out_dir / 'extras.json').write_text(json.dumps(manifest(amb, clips), indent=1, ensure_ascii=False) + '\n')
        (out_dir / 'CREDITS-extra.md').write_text(credits(amb, clips))
    total = 0
    for f in sorted((out_dir / 'street').iterdir()):
        total += f.stat().st_size
        log(f'  street/{f.name:<24}{f.stat().st_size:>10,d} bytes')
    log(f'  street/ total {total:,d} bytes ({total / 1e6:.2f} MB) -> {"OK" if total < 6e6 else "TOO BIG"}')
    ok_all &= total < 6e6
    log('ALL OK' if ok_all else 'SOME CHECKS FAILED')
    return 0 if ok_all else 1


if __name__ == '__main__':
    sys.exit(main())
