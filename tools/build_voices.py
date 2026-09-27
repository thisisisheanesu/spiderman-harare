#!/usr/bin/env python3
"""Turn Google FLEURS Shona (sn_zw) recordings into game-ready NPC voice clips.

Usage:
    python3 tools/build_voices.py [--fleurs DIR] [--fleurs-en DIR] [--out public/audio]
                                  [--work DIR] [--ffmpeg PATH] [--seed N] [--verify-only]

Inputs (FLEURS layout, tab-separated, no header, no quoting):
    <fleurs>/{dev,test}.tsv + <fleurs>/audio/{dev,test}/*.wav   (16 kHz mono float)
        cols: 0 sentence id, 1 wav, 2 raw text, 3 normalised text, 4 chars, 5 samples, 6 gender
    <fleurs-en>/{dev,test,train}.tsv   English FLEURS rows; col 0 is the shared FLoRes id, col 2 the text.

Outputs (in --out, paths in the manifest are relative to the site root):
    voices_f.mp3, voices_m.mp3   audio sprites (mono 24 kHz, 48 kbps CBR), 0.30 s silence between clips
    crowd_loop.mp3               ~45 s seamless stereo loop of layered, unintelligible Shona chatter
    voices.json                  manifest {version, attribution, sprites, ambient, clips[]}
    CREDITS.md                   dataset attribution

Pipeline:
    1. analyse every dev/test recording (noise floor, speech RMS, peak/clipping, energy VAD, pauses, F0)
    2. curate content by FLoRes sentence id (hand-reviewed allow-list below, plus a keyword safety net
       on the English translation)
    3. "line" clips = whole utterances 3.0-9.5 s after trimming (60 ms pad kept); when a gender runs
       short, two-sentence utterances are split at the sentence-final pause (text split on the '.')
    4. "bark" clips = utterance starts up to the first >=180 ms pause (0.7-2.6 s); the cut always lies
       inside a detected pause; Shona text only when two independent timing estimates agree
    5. highpass 90 Hz + afftdn (nr 10), active-speech RMS normalisation with a peak limiter, 15 ms fades
    6. sprites, crowd loop, manifest, credits, then verification of the encoded files
"""
import argparse
import hashlib
import json
import math
import os
import random
import re
import struct
import subprocess
import sys
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
SCRATCH = Path('/tmp/claude-0/-home-user-spiderman-harare/e6051643-6af1-580e-a761-33b3fad97763/scratchpad')
DEFAULT_FLEURS = SCRATCH / 'fleurs' / 'sn_zw'
DEFAULT_FLEURS_EN = SCRATCH / 'fleurs_en' / 'en_us'
DEFAULT_OUT = REPO / 'public' / 'audio'
DEFAULT_WORK = SCRATCH / 'voices_work'
DEFAULT_FFMPEG = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'

SR = 16000                 # FLEURS sample rate; all clip maths happens here
SPRITE_SR = 24000
SPRITE_KBPS = 48
SPRITE_MAX_BYTES = 8 * 1024 * 1024
GAP_S = 0.30               # digital silence between sprite clips
PAD_S = 0.060              # silence kept around trimmed speech
FADE_S = 0.015
FRAME = 400                # 25 ms analysis frame
HOP = 160                  # 10 ms hop
HOP_S = HOP / SR
PAUSE_MIN_S = 0.18         # a "pause" is >= 180 ms of sub-threshold energy

LINE_MIN_S, LINE_MAX_S = 3.0, 9.5
BARK_MIN_S, BARK_MAX_S = 0.7, 2.6
TARGET_LINES = {'female': 60, 'male': 60}
TARGET_BARKS = {'female': 50, 'male': 50}
MAX_PER_SENTENCE = 3

TARGET_RMS_DB = -20.0      # active-speech RMS after normalisation (dBFS)
PEAK_CEIL_DB = -2.0        # sample-peak ceiling (dBFS)

CROWD_LEN_S = 45.0
CROWD_VOICES = 28
CROWD_SR = 44100

ATTRIBUTION = ('Shona speech from FLEURS (Conneau et al., 2022, Google) — sn_zw, CC BY 4.0. '
               'English sentences from FLoRes (CC BY-SA 4.0).')

# --------------------------------------------------------------------------------------------------
# Content curation. Every FLoRes sentence id present in sn_zw dev+test (498) was reviewed by its
# English translation. Allowed: neutral / everyday / fun / interesting (travel, nature, animals,
# sport, food, science, weather, culture, cities, history trivia). Everything else (violence, war,
# bombs, death, disasters, disease, crime, politics, religion, sex, drugs/alcohol, named living
# people, stereotypes, medical) is simply not on the list.
ALLOWED_IDS = {
    # dev+test ids 1510-1659
    1512, 1513, 1517, 1519, 1521, 1522, 1523, 1525, 1526, 1528, 1531, 1533, 1534, 1535, 1537, 1538,
    1539, 1541, 1544, 1545, 1546, 1548, 1549, 1550, 1552, 1554, 1556, 1558, 1559, 1560, 1561, 1562,
    1563, 1565, 1567, 1573, 1574, 1576, 1577, 1581, 1582, 1585, 1586, 1592, 1593, 1594, 1597, 1599,
    1600, 1601, 1602, 1605, 1607, 1610, 1611, 1613, 1614, 1615, 1617, 1618, 1619, 1620, 1621, 1624,
    1627, 1628, 1631, 1633, 1634, 1638, 1639, 1640, 1641, 1643, 1646, 1647, 1648, 1649, 1650, 1651,
    1655, 1657, 1658,
    # 1660-1999
    1660, 1662, 1663, 1664, 1666, 1667, 1668, 1672, 1674, 1675, 1676, 1677, 1680, 1681, 1682, 1684,
    1685, 1686, 1689, 1691, 1693, 1695, 1698, 1700, 1701, 1704, 1707, 1711, 1712, 1714, 1715, 1717,
    1718, 1720, 1724, 1725, 1726, 1728, 1729, 1730, 1731, 1732, 1734, 1735, 1737, 1738, 1740, 1741,
    1742, 1743, 1744, 1745, 1746, 1750, 1753, 1754, 1758, 1760, 1763, 1765, 1766, 1767, 1768, 1770,
    1771, 1772, 1773, 1774, 1775, 1776, 1777, 1781, 1782, 1785, 1787, 1789, 1790, 1791, 1792, 1793,
    1794, 1796, 1797, 1798, 1800, 1801, 1802, 1803, 1805, 1806, 1807, 1809, 1811, 1813, 1814, 1817,
    1818, 1819, 1820, 1822, 1823, 1825, 1827, 1831, 1832, 1833, 1836, 1838, 1839, 1841, 1842, 1844,
    1846, 1849, 1850, 1851, 1852, 1855, 1856, 1862, 1865, 1866, 1867, 1868, 1869, 1870, 1871, 1874,
    1875, 1879, 1880, 1881, 1882, 1883, 1884, 1886, 1888, 1889, 1890, 1893, 1894, 1895, 1897, 1900,
    1901, 1903, 1904, 1905, 1906, 1908, 1909, 1911, 1912, 1913, 1914, 1915, 1916, 1918, 1919, 1920,
    1921, 1924, 1925, 1926, 1927, 1928, 1931, 1933, 1934, 1935, 1942, 1944, 1945, 1949, 1950, 1952,
    1954, 1956, 1958, 1959, 1962, 1963, 1964, 1965, 1968, 1969, 1970, 1972, 1973, 1974, 1975, 1977,
    1978, 1979, 1980, 1981, 1983, 1985, 1986, 1989, 1990, 1992, 1994, 1995, 1998,
    # 2000+
    2000, 2002, 2003, 2005, 2006, 2009,
}

# Safety net: an allowed sentence whose English matches one of these is still rejected (and reported),
# so a slip in the hand review cannot put e.g. "bomb" in an NPC's mouth.
BLOCK_RE = re.compile(
    r'\b(kill\w*|murder\w*|bomb\w*|war|wars|warfare|weapon\w*|gun\w*|rifle\w*|shoot\w*|shot|army|'
    r'soldier\w*|troops?|military|invad\w*|invasion|attack\w*|hostage\w*|terror\w*|'
    r'dead|death\w*|die[ds]?|dying|funeral|tomb\w*|corpse|body|injur\w*|wound\w*|accident\w*|crash\w*|'
    r'disaster\w*|earthquake|tsunami|flood\w*|hurricane|storm\w*|tornado\w*|wildfire\w*|explos\w*|'
    r'disease\w*|virus|ebola|cancer|infect\w*|hospital\w*|patient\w*|drug\w*|cannabis|alcohol\w*|'
    r'beer|tobacco|police\w*|crime\w*|criminal\w*|prison\w*|inmate\w*|riot\w*|loot\w*|abuse\w*|'
    r'harass\w*|sex\w*|porn\w*|contracepti\w*|election\w*|president\w*|governor\w*|politic\w*|'
    r'parliament\w*|senator|minister|congress\w*|jesus|christ\w*|islam\w*|church\w*|holocaust|nazi\w*)\b',
    re.IGNORECASE)
# Allowed sentences that trip the keyword net but were re-read and are fine: 1525 "old mosques and churches"
# in a city description, 1592 "people were probably patient" (travel), 1738 a mosasaur "attacked anything
# that entered the water", 1743 "cultural or political influence" on technology (academic).
KEYWORD_REVIEWED_OK = {1525, 1592, 1738, 1743}

# --------------------------------------------------------------------------------------------------


def log(*a):
    print(*a, flush=True)


def read_tsv(path):
    rows = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if line:
                rows.append(line.split('\t'))
    return rows


def ffmpeg_decode(ffmpeg, path, af=None, sr=SR, channels=1):
    cmd = [ffmpeg, '-v', 'error', '-nostdin', '-i', str(path)]
    if af:
        cmd += ['-af', af]
    cmd += ['-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', str(channels), '-ar', str(sr), 'pipe:1']
    out = subprocess.run(cmd, check=True, capture_output=True).stdout
    x = np.frombuffer(out, dtype='<f4').astype(np.float32)
    return x.reshape(-1, channels) if channels > 1 else x


def read_wav_float(path):
    """Minimal RIFF reader for the FLEURS files (IEEE float or 16-bit PCM, mono)."""
    d = Path(path).read_bytes()
    assert d[:4] == b'RIFF' and d[8:12] == b'WAVE', path
    i, fmt, data = 12, None, None
    while i + 8 <= len(d):
        cid, sz = d[i:i + 4], struct.unpack('<I', d[i + 4:i + 8])[0]
        body = d[i + 8:i + 8 + sz]
        if cid == b'fmt ':
            fmt = struct.unpack('<HHIIHH', body[:16])
        elif cid == b'data':
            data = body
        i += 8 + sz + (sz & 1)
    tag, ch, rate, _, _, bits = fmt
    assert ch == 1 and rate == SR, (path, fmt)
    if tag == 3 and bits == 32:
        return np.frombuffer(data, dtype='<f4').astype(np.float32)
    if tag == 1 and bits == 16:
        return np.frombuffer(data, dtype='<i2').astype(np.float32) / 32768.0
    raise ValueError(f'unsupported wav format {fmt} in {path}')


def db(x):
    return 10.0 * np.log10(np.maximum(x, 1e-12))


def frame_power(x):
    n = 1 + max(0, (len(x) - FRAME) // HOP)
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(n)[:, None]
    fr = x[np.minimum(idx, len(x) - 1)]
    return (fr.astype(np.float64) ** 2).mean(axis=1)


def runs(mask):
    """[(start, end)) index runs where mask is True."""
    m = np.concatenate([[False], mask, [False]]).astype(np.int8)
    d = np.diff(m)
    return list(zip(np.where(d == 1)[0].tolist(), np.where(d == -1)[0].tolist()))


def voicing(x, n_frames, win=640):
    """Per analysis frame: True when the 40 ms window starting there is periodic in the 70-400 Hz range."""
    st = np.minimum(np.arange(n_frames) * HOP, max(0, len(x) - win))
    fr = x[st[:, None] + np.arange(win)[None, :]] * np.hanning(win)[None, :]
    ac = np.fft.irfft(np.abs(np.fft.rfft(fr, 2048, axis=1)) ** 2, axis=1)[:, :260]
    ac = ac / np.maximum(ac[:, :1], 1e-20)
    return ac[:, SR // 400:SR // 70 + 1].max(axis=1) > 0.5


def vad(frame_db, noise_db, speech_db, voiced, thr=None):
    """Adaptive energy VAD -> (speech runs in frames, threshold). A run is speech when it lasts >= 40 ms
    (not a click), stands >= 15 dB above the noise floor, and either gets within 12 dB of the speech peaks
    or is voiced (Shona words end in vowels). Weak runs (> 20 dB under the peaks) at the very start/end
    that are separated from the sentence by a pause are dropped too: breaths, rustle, hums."""
    if thr is None:
        thr = noise_db + max(9.0, 0.30 * (speech_db - noise_db))
    floor = noise_db + 15.0
    out = []
    for a, b in runs(frame_db > thr):
        m = frame_db[a:b].max()
        if b - a >= 4 and m >= floor and (m >= speech_db - 12.0 or (m >= speech_db - 30.0 and voiced[a:b].sum() >= 3)):
            out.append((a, b))
    # group into phrases (split at pauses) and drop all-weak phrases at either end
    phrases = []
    for r in out:
        if phrases and r[0] - phrases[-1][-1][1] < PAUSE_MIN_S / HOP_S:
            phrases[-1].append(r)
        else:
            phrases.append([r])
    weak = lambda ph: max(frame_db[a:b].max() for a, b in ph) < speech_db - 20.0
    while len(phrases) > 1 and weak(phrases[0]):
        phrases.pop(0)
    while len(phrases) > 1 and weak(phrases[-1]):
        phrases.pop()
    return [r for ph in phrases for r in ph], thr


def f0_median(x, active_runs):
    """Median F0 (Hz) over voiced active frames via normalised autocorrelation."""
    win = 640
    starts = []
    for a, b in active_runs:
        starts.extend(range(a * HOP, max(a * HOP, b * HOP + FRAME - win), HOP * 2))
    starts = [s for s in starts if s + win <= len(x)]
    if not starts:
        return None
    fr = x[np.array(starts)[:, None] + np.arange(win)[None, :]] * np.hanning(win)[None, :]
    spec = np.fft.rfft(fr, 2048, axis=1)
    ac = np.fft.irfft(np.abs(spec) ** 2, axis=1)[:, :260]
    ac = ac / np.maximum(ac[:, :1], 1e-12)
    lo, hi = SR // 400, SR // 70
    k = lo + np.argmax(ac[:, lo:hi + 1], axis=1)
    peak = ac[np.arange(len(k)), k]
    f0 = SR / k[peak > 0.45]
    return float(np.median(f0)) if len(f0) >= 20 else None


def syllable_peaks(frame_db, active_runs, thr):
    """Frame indices of energy peaks (syllable nuclei proxy): local maxima of the smoothed envelope,
    >= 90 ms apart, with >= 3 dB dip on both sides, inside active speech."""
    k = np.hanning(7)
    env = np.convolve(frame_db, k / k.sum(), mode='same')
    peaks = []
    for a, b in active_runs:
        seg = env[a:b]
        cand = [i for i in range(1, len(seg) - 1) if seg[i] >= seg[i - 1] and seg[i] > seg[i + 1] and seg[i] > thr + 3]
        for i in cand:
            left = seg[max(0, i - 12):i + 1].min()
            right = seg[i:i + 13].min()
            if seg[i] - left >= 3 and seg[i] - right >= 3:
                if peaks and a + i - peaks[-1] < 9:
                    if env[a + i] > env[peaks[-1]]:
                        peaks[-1] = a + i
                    continue
                peaks.append(a + i)
    return peaks


def analyse_one(args):
    ffmpeg, wav, meta = args
    raw = read_wav_float(wav)
    hp = ffmpeg_decode(ffmpeg, wav, af='highpass=f=90')
    dur = len(raw) / SR
    p = frame_power(hp)
    fdb = db(p)
    live = fdb[fdb > -115.0]                  # ignore digital-zero padding some files start with
    noise_db = float(np.percentile(live if len(live) > 50 else fdb, 10))
    speech_db = float(np.percentile(fdb, 95))
    voiced = voicing(hp, len(fdb))
    act, thr = vad(fdb, noise_db, speech_db, voiced)
    res = dict(meta, dur=dur, noise_db=noise_db, speech_peak_db=speech_db, thr_db=float(thr),
               peak=float(np.abs(raw).max()))
    a = np.abs(raw)
    res['clip_samples'] = int((a >= 0.999).sum())
    flat = (np.abs(np.diff(raw)) < 1e-7) & (a[1:] > 0.9)
    res['flat_runs'] = int(sum(1 for s, e in runs(flat) if e - s >= 2))
    if not act:
        res['ok'] = False
        return res, None
    on = act[0][0] * HOP / SR
    off = (act[-1][1] - 1) * HOP / SR + FRAME / SR
    mask = np.zeros(len(fdb), bool)
    for s, e in act:
        mask[s:e] = True
    pauses = []
    for (s0, e0), (s1, e1) in zip(act[:-1], act[1:]):
        g0, g1 = (e0 - 1) * HOP / SR + FRAME / SR, s1 * HOP / SR
        if g1 - g0 >= PAUSE_MIN_S:
            pauses.append((round(g0, 3), round(g1, 3)))
    peaks = syllable_peaks(fdb, act, thr)
    # Pauses for bark cuts: measured at a level 22 dB under the speech peaks (so a pause includes the decay
    # of the preceding word), but only counted when the gap also dips below the strict VAD threshold,
    # i.e. contains real silence. The cut goes to the quietest frame of the gap.
    r2, _ = vad(fdb, noise_db, speech_db, voiced, thr=max(thr, speech_db - 22.0))
    bark_pauses = []
    for (s0, e0), (s1, e1) in zip(r2[:-1], r2[1:]):
        g0, g1 = (e0 - 1) * HOP / SR + FRAME / SR, s1 * HOP / SR
        if g1 - g0 >= PAUSE_MIN_S and fdb[e0:s1].min() <= thr:
            # quietest frame (by its centre) between 60 and 140 ms into the gap, and >= 60 ms before its end
            ctr = np.arange(len(fdb)) * HOP_S + FRAME / (2 * SR)
            win = np.where((ctr >= g0 + PAD_S) & (ctr <= min(g0 + 0.14, g1 - PAD_S)))[0]
            cut = float(ctr[win[np.argmin(fdb[win])]]) if len(win) else g0 + PAD_S
            bark_pauses.append((round(g0, 3), round(g1, 3), round(cut, 3)))
    res.update(ok=True, on=on, off=min(off, dur), lead_sil=on, trail_sil=max(0.0, dur - off),
               runs=[[int(s), int(e)] for s, e in act], bark_pauses=bark_pauses,
               active_s=float(mask.sum() * HOP / SR), speech_rms_db=float(db(p[mask].mean())),
               pauses=pauses, max_pause=max([b - a for a, b in pauses], default=0.0),
               f0=f0_median(hp, act), n_peaks=len(peaks), peaks_s=[round(i * HOP / SR, 3) for i in peaks])
    res['snr_db'] = res['speech_rms_db'] - noise_db
    sgn = np.signbit(hp)
    zc = np.concatenate([[0], np.cumsum(sgn[1:] != sgn[:-1])])
    st = np.minimum(np.arange(len(fdb)) * HOP, len(hp) - 1)
    zcr = (zc[np.minimum(st + FRAME, len(hp) - 1)] - zc[st]) / FRAME
    return res, np.stack([fdb, zcr]).astype(np.float16)


# --------------------------------------------------------------------------------------------------

def tidy(text):
    """Strip stray leading punctuation (a few FLoRes lines start with '. ') and collapse whitespace."""
    return re.sub(r'\s+', ' ', re.sub(r'^[\s.,;:]+', '', text)).strip()


def load_corpus(fleurs, fleurs_en):
    en = {}
    for split in ('dev', 'test', 'train'):
        p = Path(fleurs_en) / f'{split}.tsv'
        if p.exists():
            for c in read_tsv(p):
                en.setdefault(int(c[0]), tidy(c[2]))
    items = []
    for split in ('dev', 'test'):
        for c in read_tsv(Path(fleurs) / f'{split}.tsv'):
            wav = Path(fleurs) / 'audio' / split / c[1]
            if not wav.exists():
                continue
            items.append(dict(split=split, sid=int(c[0]), wav=c[1], sn=tidy(c[2]), sn_norm=c[3].strip(),
                              samples=int(c[5]), gender={'FEMALE': 'female', 'MALE': 'male'}[c[6].strip()],
                              en=en.get(int(c[0]))))
    return items


def analyse_all(items, fleurs, ffmpeg, work):
    cache = Path(work) / 'analysis.json'
    env_cache = Path(work) / 'envelopes.npz'
    if cache.exists() and env_cache.exists():
        data = json.loads(cache.read_text())
        if len(data) == len(items):
            envs = dict(np.load(env_cache))
            log(f'analysis: {len(data)} files (cached)')
            return data, envs
    jobs = [(ffmpeg, Path(fleurs) / 'audio' / it['split'] / it['wav'], it) for it in items]
    data, envs = [], {}
    with ProcessPoolExecutor(max_workers=os.cpu_count() or 2) as ex:
        for i, (res, env) in enumerate(ex.map(analyse_one, jobs, chunksize=8)):
            data.append(res)
            if env is not None:
                envs[res['wav']] = env
            if (i + 1) % 200 == 0:
                log(f'  analysed {i + 1}/{len(jobs)}')
    Path(work).mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(data))
    np.savez_compressed(env_cache, **envs)
    log(f'analysis: {len(data)} files')
    return data, envs




# --------------------------------------------------------------------------------------------------
# Quality annotation + text helpers

def session_of(r):
    """Coarse recording-session group. Used to normalise speaking rate and to balance voices: the male
    recordings split cleanly (k-means silhouette 0.57) into a clean/quiet and a noisy session; the female
    recordings show no separable structure."""
    if r['gender'] == 'female':
        return 'f'
    return 'm-noisy' if r['noise_db'] > -70 else 'm-clean'


def letters(s):
    return sum(ch.isalpha() for ch in s)


def vowels(s):
    return sum(ch.lower() in 'aeiou' for ch in s)


def annotate(data):
    rates = defaultdict(list)
    for r in data:
        if r['ok']:
            r['session'] = session_of(r)
            r['cps'] = letters(r['sn_norm']) / max(r['active_s'], 0.1)
            rates[r['session']].append(r['cps'])
    med = {k: float(np.median(v)) for k, v in rates.items()}
    for r in data:
        if not r['ok']:
            continue
        r['cps_ratio'] = r['cps'] / med[r['session']]
        r['keyword_hit'] = bool(r['en'] and BLOCK_RE.search(r['en'])) and r['sid'] not in KEYWORD_REVIEWED_OK
        r['content_ok'] = r['sid'] in ALLOWED_IDS and r['en'] is not None and not r['keyword_hit']
        f0 = r['f0'] or 0
        # FLEURS gender labels are occasionally wrong; the game pairs clips with NPC bodies, so check F0
        r['f0_ok'] = (f0 >= 140) if r['gender'] == 'female' else (0 < f0 <= 150)
        r['clean'] = r['clip_samples'] == 0 and r['flat_runs'] == 0 and r['f0_ok']
        # speaking rate far from the session median = likely skipped/extra words vs the transcript
        r['score'] = r['snr_db'] - 20 * abs(math.log(r['cps_ratio']))
    return med


def run_extent(s, e):
    return s * HOP / SR, (e - 1) * HOP / SR + FRAME / SR


def active_before(r, t):
    tot = 0.0
    for s, e in r['runs']:
        a, b = run_extent(s, e)
        if a >= t:
            break
        tot += min(b, t) - a
    return tot


def peaks_before(r, t):
    return sum(1 for p in r['peaks_s'] if p < t)


def split_sentences(text):
    parts, start = [], 0
    for m in re.finditer(r'[.!?]["”\']?\s+(?=["“\']?[A-Z])', text):
        prev = re.findall(r'\S+$', text[start:m.start() + 1])
        core = re.sub(r'[^A-Za-z]', '', prev[0] if prev else '')
        if len(core) < 3 or core.isupper():      # "Dr.", "U.S.", "St." ...
            continue
        parts.append(text[start:m.end()].strip())
        start = m.end()
    parts.append(text[start:].strip())
    return [p for p in parts if p]


def timing_unreliable(text):
    """Digits and acronyms are spoken much longer than their letter count suggests."""
    return bool(re.search(r'\d', text) or re.search(r'\b[A-Z]{2,}\b', text))


def fragment_text(r, cut_t):
    """Shona text spoken before cut_t, or None. Two independent estimates must pick the same word
    boundary: (A) proportional letter timing over active speech, (B) proportion of syllable-nucleus
    energy peaks mapped onto the vowel count (Shona syllables are open, so vowels ~ syllables)."""
    text = r['sn']
    if timing_unreliable(text):
        return None
    words = list(re.finditer(r'\S+', text))
    if len(words) < 3 or not r['peaks_s']:
        return None
    cumL = np.cumsum([letters(w.group()) for w in words]).astype(float)
    cumV = np.cumsum([vowels(w.group()) for w in words]).astype(float)
    eA = active_before(r, cut_t) / active_before(r, 1e9) * cumL[-1]
    eB = peaks_before(r, cut_t) / len(r['peaks_s']) * cumV[-1]

    def nearest(e, b):
        d = np.abs(b - e)
        o = np.argsort(d)
        return int(o[0]), float(d[o[0]]), float(d[o[1]]) if len(o) > 1 else 1e9, int(o[1]) if len(o) > 1 else -1

    is_punct = lambda i: bool(re.search(r'[,;:.!?]["”\')]?$', words[i].group()))
    # Readers pause at punctuation: if exactly one comma/stop lies close to BOTH estimates, take it.
    near = [i for i in range(len(words) - 1) if is_punct(i)
            and abs(eA - cumL[i]) <= max(3.0, 0.25 * eA) and abs(eB - cumV[i]) <= max(1.5, 0.25 * eB)]
    if len(near) == 1:
        iA = near[0]
    else:
        iA, dA1, dA2, jA = nearest(eA, cumL[:-1])
        iB, dB1, dB2, jB = nearest(eB, cumV[:-1])
        if iA != iB:
            return None
        lim = 0.7 if is_punct(iA) else 0.45
        if dA1 > lim * max(dA2, 1e-9) or dB1 > lim * max(dB2, 1e-9):
            return None
        # a pause right next to a comma that the estimate did not land on is ambiguous
        if not is_punct(iA) and ((jA >= 0 and is_punct(jA) and dA1 > 0.25 * dA2)
                                 or (jB >= 0 and is_punct(jB) and dB1 > 0.25 * dB2)):
            return None
    frag = text[:words[iA].end()].rstrip()
    if re.search(r'[.!?]["”\']?$', frag):
        return frag
    return re.sub(r'[,;:\s]+$', '', frag) + '…'


# --------------------------------------------------------------------------------------------------
# Candidate selection

def level_at(r, t_a, t_b):
    """Loudest analysis frame (dBFS) in [t_a, t_b]."""
    env = r['_env']
    a, b = max(0, int(t_a / HOP_S)), min(len(env), int(math.ceil(t_b / HOP_S)) + 1)
    return float(env[a:b].astype(float).max()) if b > a else -120.0


def quiet_at(r, t, half=0.04):
    """True when the neighbourhood of a cut point is quiet: within 10 dB of the noise floor or 30 dB
    under the speech peaks (so no breath/rustle/hum event sits on a clip end)."""
    return level_at(r, t - half, t + half) <= max(r['noise_db'] + 10.0, r['speech_peak_db'] - 30.0)


def clean_start(r):
    """The first 25 ms of a clip (before the fade-in completes) must not be speech-loud. A breath intake
    just before the first word is fine - that is not speech (the VAD already excluded it)."""
    return level_at(r, r['on'] - PAD_S, r['on'] - 0.035) <= max(r['noise_db'] + 10.0, r['speech_peak_db'] - 25.0)


def no_bursts(r, t0, t1):
    """No low-frequency burst in the clip more than 9 dB over the speech peaks: rejects mic pops, bumps
    and coughs (which would also dominate the limiter). Hissy frames (zero-crossing rate > 0.35) are
    sibilants - Shona 's'/'sv'/'zv' - which in the muffled female recordings outshine the vowels."""
    env, zcr = r['_env'], r['_zcr']
    a, b = max(0, int(t0 / HOP_S)), min(len(env), int(math.ceil(t1 / HOP_S)) + 1)
    loud = env[a:b].astype(float) > r['speech_peak_db'] + 9.0
    return not np.any(loud & (zcr[a:b].astype(float) < 0.35))


def line_window(r):
    return max(0.0, r['on'] - PAD_S), min(r['dur'], r['off'] + PAD_S)


def base_ok(r, min_snr):
    return (r['ok'] and r['content_ok'] and r['clean'] and r['lead_sil'] >= 0.10 and r['snr_db'] >= min_snr)


def line_candidates(data, min_snr=18.0):
    out = []
    for r in data:
        if not base_ok(r, min_snr) or r['trail_sil'] < 0.10 or not (0.78 <= r['cps_ratio'] <= 1.28):
            continue
        t0, t1 = line_window(r)
        if not (clean_start(r) and quiet_at(r, r['off'] + 0.05)):
            continue
        if LINE_MIN_S <= t1 - t0 <= LINE_MAX_S and r['max_pause'] <= 1.6 and no_bursts(r, t0, t1):
            out.append(dict(rec=r, t0=t0, t1=t1, sn=r['sn'], en=r['en'], part=None, score=r['score']))
    return out


def split_line_candidates(data, min_snr=18.0):
    """Two-sentence utterances too long for one line: cut at the sentence-final pause. The pause must be
    the unique long (>= 300 ms) pause where both timing estimates put the sentence boundary."""
    out = []
    for r in data:
        if not base_ok(r, min_snr) or r['trail_sil'] < 0.10 or not (0.78 <= r['cps_ratio'] <= 1.28):
            continue
        t0, t1 = line_window(r)
        if t1 - t0 <= LINE_MAX_S or timing_unreliable(r['sn']):
            continue
        if not (clean_start(r) and quiet_at(r, r['off'] + 0.05)):
            continue
        sn, en = split_sentences(r['sn']), split_sentences(r['en'])
        if len(sn) != 2 or len(en) != 2 or min(len(p.split()) for p in sn + en) < 3:
            continue
        fl, fv = letters(sn[0]) / letters(r['sn']), vowels(sn[0]) / vowels(r['sn'])
        tot = active_before(r, 1e9)
        cands = []
        for g0, g1 in r['pauses']:
            if g1 - g0 >= 0.30:
                dA = abs(active_before(r, g0) / tot - fl)
                dB = abs(peaks_before(r, g0) / max(1, len(r['peaks_s'])) - fv)
                cands.append((dA, dB, g0, g1))
        hits = [c for c in cands if c[0] <= 0.08 and c[1] <= 0.10]
        near = [c for c in cands if c[0] <= 0.16]
        if len(hits) != 1 or len(near) != 1:
            continue
        _, _, g0, g1 = hits[0]
        if g1 - g0 < 0.85 * max(b - a for a, b in r['pauses']):
            continue                          # the sentence break should be the reader's longest pause
        if not (quiet_at(r, g0 + PAD_S) and quiet_at(r, g1 - PAD_S)):
            continue
        pieces = [(t0, g0 + PAD_S, sn[0], en[0], 1), (g1 - PAD_S, t1, sn[1], en[1], 2)]
        for a, b, s_, e_, part in pieces:
            inner = [p for p in r['pauses'] if a < p[0] and p[1] < b]
            if (LINE_MIN_S <= b - a <= LINE_MAX_S and max([q - p for p, q in inner], default=0) <= 1.6
                    and no_bursts(r, a, b)):
                out.append(dict(rec=r, t0=a, t1=b, sn=s_, en=e_, part=part, score=r['score']))
    return out


def bark_candidates(data, exclude_wavs, min_snr=18.0):
    out, skipped_first = [], 0
    for r in data:
        if not base_ok(r, min_snr) or r['wav'] in exclude_wavs or not clean_start(r):
            continue
        t0 = max(0.0, r['on'] - PAD_S)
        cut = None
        for k, (g0, g1, t1) in enumerate(r['bark_pauses']):
            # t1 = quietest point of a >= 180 ms pause (>= 60 ms after the last word): never inside a word
            if t1 - t0 < BARK_MIN_S:
                continue                      # a lone short word before the first pause: extend to the next
            if t1 - t0 <= BARK_MAX_S and g0 > r['on'] and quiet_at(r, t1, half=0.03) and no_bursts(r, t0, t1):
                cut = (t1, g0, g1, k)
            break
        if not cut:
            continue
        t1, g0, g1, k = cut
        if active_before(r, g0) - active_before(r, r['on']) < 0.35:
            continue
        skipped_first += k > 0
        text = fragment_text(r, g0)
        out.append(dict(rec=r, t0=t0, t1=t1, sn=text, en=None, part=None, pause=(g0, g1), pause_index=k,
                        score=r['score'] + (4 if text else 0)))
    return out, skipped_first


def choose(cands, n, sid_count, used_wavs, quota=None, pair_seen=None):
    """Round-robin over sentence ids (best recording of every sentence first), honouring MAX_PER_SENTENCE,
    one clip per recording (split halves excepted) and optional per-session share quotas."""
    by = defaultdict(list)
    for c in sorted(cands, key=lambda c: -c['score']):
        by[c['rec']['sid']].append(c)
    order = sorted(by, key=lambda s: -by[s][0]['score'])
    chosen, sess = [], Counter()
    seen_pairs = set(pair_seen) if pair_seen is not None else set()
    for relax in (False, True):
        for rnd in range(6):
            for sid in order:
                if len(chosen) >= n:
                    return chosen
                lst = by[sid]
                if rnd >= len(lst):
                    continue
                c = lst[rnd]
                r = c['rec']
                key = (r['wav'], c['part'])
                if key in used_wavs or (c['part'] is None and any(k[0] == r['wav'] for k in used_wavs)):
                    continue
                if sid_count[sid] >= MAX_PER_SENTENCE:
                    continue
                if quota and not relax and sess[r['session']] >= quota.get(r['session'], 1.0) * n:
                    continue
                if not relax and (sid, r['session']) in seen_pairs:
                    continue                  # same sentence again from the same session: only if needed
                seen_pairs.add((sid, r['session']))
                chosen.append(c)
                used_wavs.add(key)
                sid_count[sid] += 1
                sess[r['session']] += 1
    return chosen


# --------------------------------------------------------------------------------------------------
# Signal processing

def xcorr_lag(ref, x, maxlag=4000):
    n = len(ref)
    c = np.fft.irfft(np.conj(np.fft.rfft(ref, 2 * n)) * np.fft.rfft(x, 2 * n))
    c = np.concatenate([c[-maxlag:], c[:maxlag + 1]])
    return int(np.argmax(c)) - maxlag


def denoised(ffmpeg, wav, noise_db):
    """highpass 90 Hz + light afftdn (nr 10). afftdn delays its output (400 samples at 16 kHz), which is
    measured against the highpass-only signal and compensated so VAD times stay valid."""
    nf = min(-20.0, max(-80.0, noise_db + 12.0))
    hp = ffmpeg_decode(ffmpeg, wav, af='highpass=f=90')
    pr = ffmpeg_decode(ffmpeg, wav, af=f'highpass=f=90,afftdn=nr=10:nf={nf:.1f}')
    lag = xcorr_lag(hp, pr)
    if lag > 0:
        pr = np.concatenate([pr[lag:], np.zeros(lag, np.float32)])
    elif lag < 0:
        pr = np.concatenate([np.zeros(-lag, np.float32), pr[:lag]])
    return pr, lag


def limiter(x, ceil, sr=SR, attack_ms=2.0, release_ms=80.0):
    """Peak limiter on 1 ms blocks: instant gain target per block, exponential release forward in time and
    exponential attack ramp backward in time (i.e. look-ahead), so gain never steps."""
    a = np.abs(x)
    if a.max() <= ceil:
        return x, 0.0
    blk = max(1, sr // 1000)
    n = -(-len(x) // blk)
    buf = np.zeros(n * blk)
    buf[:len(x)] = a
    req = np.minimum(1.0, ceil / np.maximum(buf.reshape(n, blk).max(axis=1), 1e-9))
    rel = 1.0 - math.exp(-1.0 / release_ms)
    att = 1.0 - math.exp(-1.0 / attack_ms)
    g = np.empty(n)
    cur = 1.0
    for i in range(n):
        cur = req[i] if req[i] < cur else cur + (req[i] - cur) * rel
        g[i] = cur
    cur = 1.0
    for i in range(n - 1, -1, -1):
        cur = g[i] if g[i] < cur else cur + (g[i] - cur) * att
        g[i] = cur
    gi = np.interp(np.arange(len(x)), np.arange(n) * blk + blk / 2.0, g)
    return np.clip(x * gi, -ceil, ceil), float(-20 * math.log10(g.min()))


def fades(x, sr=SR, ms=FADE_S * 1000):
    k = int(sr * ms / 1000)
    if k > 0 and len(x) > 2 * k:
        w = 0.5 - 0.5 * np.cos(np.pi * np.arange(k) / k)
        x[:k] *= w
        x[-k:] *= w[::-1]
    return x


def active_frames_in(runs_, a, b):
    """Global analysis-frame indices inside samples [a, b) that the VAD marked active."""
    lo, hi = a // HOP, max(a // HOP, (b - FRAME) // HOP)
    out = []
    for s, e in runs_:
        s2, e2 = max(s, lo), min(e, hi + 1)
        if s2 < e2:
            out.extend(range(s2, e2))
    return np.array(out, dtype=int)


def render_job(job):
    ffmpeg, wav, noise_db, t0, t1, runs_ = job
    pr, lag = denoised(ffmpeg, wav, noise_db)
    a, b = int(round(t0 * SR)), int(round(t1 * SR))
    x = pr[a:b].astype(np.float64)
    fr = active_frames_in(runs_, a, b)
    p = frame_power(pr)
    rms_in = float(db(p[fr[fr < len(p)]].mean()))
    gain_db = TARGET_RMS_DB - rms_in
    x *= 10 ** (gain_db / 20)
    x, gr = limiter(x, 10 ** (PEAK_CEIL_DB / 20))
    x = fades(x)
    return x.astype(np.float32), dict(lag=lag, gain_db=gain_db, limit_db=gr, rms_in=rms_in)


def resample_fft(x, n_out):
    X = np.fft.rfft(x)
    Y = np.zeros(n_out // 2 + 1, dtype=complex)
    m = min(len(X), len(Y))
    Y[:m] = X[:m]
    return np.fft.irfft(Y, n_out) * (n_out / len(x))


# --------------------------------------------------------------------------------------------------
# Outputs

def encode_mp3(ffmpeg, pcm, in_sr, out_path, out_sr, kbps, channels=1, af=None):
    cmd = [ffmpeg, '-v', 'error', '-nostdin', '-y', '-f', 'f32le', '-ar', str(in_sr), '-ac', str(channels), '-i', 'pipe:0']
    if af:
        cmd += ['-af', af]
    cmd += ['-ar', str(out_sr), '-ac', str(channels), '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', '-abr', '0',
            '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1', str(out_path)]
    subprocess.run(cmd, input=np.ascontiguousarray(pcm, dtype='<f4').tobytes(), check=True)


def build_sprites(ffmpeg, clips, out_dir):
    """clips: list of dicts with 'gender', 'pcm'. Assigns sprite/start/dur; writes voices_<g>[n].mp3."""
    sprites = {}
    max_s = SPRITE_MAX_BYTES / (SPRITE_KBPS * 1000 / 8) * 0.92
    gap = np.zeros(int(round(GAP_S * SR)), np.float32)
    for g in ('f', 'm'):
        group = [c for c in clips if c['gender'][0] == g]
        packs, cur, t = [], [], 0.0
        for c in group:
            d = len(c['pcm']) / SR
            if cur and t + GAP_S + d > max_s:
                packs.append(cur)
                cur, t = [], 0.0
            t += (GAP_S if cur else 0.0) + d
            cur.append(c)
        if cur:
            packs.append(cur)
        for k, pack in enumerate(packs):
            key = g if k == 0 else f'{g}{k + 1}'
            parts, n = [], 0
            for i, c in enumerate(pack):
                if i:
                    parts.append(gap)
                    n += len(gap)
                c['sprite'], c['start'], c['dur'] = key, n / SR, len(c['pcm']) / SR
                parts.append(c['pcm'])
                n += len(c['pcm'])
            pcm = np.concatenate(parts)
            name = f'voices_{key}.mp3'
            encode_mp3(ffmpeg, pcm, SR, Path(out_dir) / name, SPRITE_SR, SPRITE_KBPS,
                       af=f'aresample={SPRITE_SR}:filter_size=64:cutoff=0.97')
            sprites[key] = dict(path=f'audio/{name}', seconds=n / SR, clips=len(pack),
                                bytes=(Path(out_dir) / name).stat().st_size)
            log(f'  sprite {name}: {len(pack)} clips, {n / SR:.1f} s, {sprites[key]["bytes"] / 1e6:.2f} MB')
    return sprites


def build_crowd(ffmpeg, data, exclude_wavs, out_path, rng):
    """Layer many utterances on a circular 45 s timeline (whatever runs past the end wraps to the start,
    i.e. a perfect tail->head crossfade), filter a 3x tiled copy and keep the middle cycle so the
    lowpass/echo state is continuous across the loop point."""
    L = int(CROWD_LEN_S * CROWD_SR)
    pool = [r for r in data if base_ok(r, 18.0) and r['wav'] not in exclude_wavs and r['off'] - r['on'] >= 10.0
            and clean_start(r) and quiet_at(r, r['off'] + 0.05) and no_bursts(r, r['on'], r['off'])]
    fem = [r for r in pool if r['session'] == 'f']
    mc = [r for r in pool if r['session'] == 'm-clean']
    mn = [r for r in pool if r['session'] == 'm-noisy' and r['snr_db'] >= 20]
    rng.shuffle(fem), rng.shuffle(mc), rng.shuffle(mn)
    n_f = CROWD_VOICES // 2
    n_mn = min(len(mn), CROWD_VOICES // 5)
    picks, seen = [], set()
    for src, k in ((fem, n_f), (mn, n_mn), (mc, CROWD_VOICES - n_f - n_mn)):
        got = 0
        for r in src:
            if got >= k:
                break
            if r['sid'] in seen:          # different sentences, so nothing repeats verbatim
                continue
            picks.append(r)
            seen.add(r['sid'])
            got += 1
    jobs = [(ffmpeg, Path(r['_fleurs']) / 'audio' / r['split'] / r['wav'], r['noise_db'], max(0.0, r['on'] - 0.05),
             min(r['dur'], r['off'] + 0.05), r['runs']) for r in picks]
    with ProcessPoolExecutor(max_workers=os.cpu_count() or 2) as ex:
        voices = [v for v, _ in ex.map(render_job, jobs)]
    n = len(voices)
    offsets = (np.arange(n) + rng.uniform(0.1, 0.9, n)) / n * L
    rng.shuffle(offsets)
    gains = rng.uniform(-18.0, -6.0, n)
    pans = rng.uniform(-0.85, 0.85, n)
    rates = rng.uniform(0.95, 1.06, n)       # small speed/pitch spread: more apparent speakers
    tracks = []
    for v, rate in zip(voices, rates):
        y = resample_fft(v.astype(np.float64), int(round(len(v) * CROWD_SR / SR / rate)))
        tracks.append(y[:L])
    win = int(0.5 * CROWD_SR)
    nw = L // win

    E_unit = np.zeros((n, nw))                  # per-voice energy per 0.5 s window at 0 dB gain
    for i, (y, off) in enumerate(zip(tracks, offsets)):
        e = np.zeros(L)
        e[(int(off) + np.arange(len(y))) % L] = y ** 2
        E_unit[i] = e[:nw * win].reshape(nw, win).sum(axis=1)
    energy_map = lambda g: E_unit * (10 ** (g / 10))[:, None]

    # keep any single voice from dominating a window (-> nothing intelligibly foregrounded)
    for _ in range(300):
        E = energy_map(gains)
        share = E / np.maximum(E.sum(axis=0, keepdims=True), 1e-12)
        share[gains <= -20.0] = 0.0
        i, w = np.unravel_index(np.argmax(share), share.shape)
        if share[i, w] <= 0.45:
            break
        gains[i] -= 1.0
    E = energy_map(gains)
    share = E / np.maximum(E.sum(axis=0, keepdims=True), 1e-12)
    tot_db = db(E.sum(axis=0) / win)
    audible = (db(E / win) > tot_db[None, :] - 15).sum(axis=0)
    mix = np.zeros((L, 2))
    for y, off, gdb, pan in zip(tracks, offsets, gains, pans):
        th = (pan + 1) * math.pi / 4
        idx = (int(off) + np.arange(len(y))) % L
        yy = y * 10 ** (gdb / 20)
        np.add.at(mix[:, 0], idx, yy * math.cos(th))
        np.add.at(mix[:, 1], idx, yy * math.sin(th))
    # slow circular level rider (1 s windows, +/-6 dB) evens out moments where few voices overlap
    lw = CROWD_SR
    lev = np.sqrt((np.concatenate([mix, mix[:lw]]) ** 2).mean(axis=1))
    csum = np.concatenate([[0.0], np.cumsum(lev ** 2)])
    env = np.sqrt((csum[lw:lw + L] - csum[:L]) / lw)               # window starting at each sample
    env = np.roll(env, lw // 2)                                     # centre it
    ride = np.clip(np.median(env) / np.maximum(env, 1e-9), 10 ** (-6 / 20), 10 ** (6 / 20))
    mix *= ride[:, None]
    tiled = np.tile(mix, (3, 1)).astype(np.float32)
    cmd = [ffmpeg, '-v', 'error', '-nostdin', '-f', 'f32le', '-ar', str(CROWD_SR), '-ac', '2', '-i', 'pipe:0',
           '-af', 'lowpass=f=4000,aecho=0.85:0.9:29|53|83:0.22|0.15|0.09', '-f', 'f32le', '-ac', '2', 'pipe:1']
    out = subprocess.run(cmd, input=tiled.tobytes(), capture_output=True, check=True).stdout
    y = np.frombuffer(out, dtype='<f4').reshape(-1, 2)[L:2 * L].astype(np.float64)
    rms = math.sqrt((y ** 2).mean())
    g = 10 ** (-22.0 / 20) / rms
    g = min(g, 10 ** (-2.0 / 20) / np.abs(y).max())
    y *= g
    # The loop is circular, so any sample can be the file start: start where the 50 ms level is close to
    # the median and changes least, so even the first play-through begins mid-murmur.
    w50 = int(0.05 * CROWD_SR)
    p = np.concatenate([[0.0], np.cumsum(np.concatenate([y, y[:w50]]).mean(axis=1) ** 2)])
    lv = db((p[w50:w50 + L] - p[:L]) / w50)                          # level of [k, k + 50 ms)
    prev = np.roll(lv, w50)                                          # level of [k - 50 ms, k)
    med = np.median(lv)
    cost = np.abs(lv - prev) + 0.5 * np.abs(lv - med) + 0.5 * np.abs(prev - med)
    k = int(np.argmin(cost[::441]) * 441)
    y = np.roll(y, -k, axis=0)
    encode_mp3(ffmpeg, y, CROWD_SR, out_path, CROWD_SR, 96, channels=2)
    info = dict(voices=n, female=sum(r['gender'] == 'female' for r in picks),
                male=sum(r['gender'] == 'male' for r in picks), sentences=len(seen),
                gains_db=[round(float(x), 1) for x in gains], max_share=float(share.max()),
                min_audible_voices=int(audible.min()), mean_audible_voices=float(audible.mean()),
                rms_db=float(20 * math.log10(math.sqrt((y ** 2).mean()))), peak_db=float(20 * math.log10(np.abs(y).max())),
                bytes=Path(out_path).stat().st_size, wavs=[r['wav'] for r in picks])
    return info


CREDITS = """# Voice audio credits

The NPC voices and the crowd ambience in this game are real recordings of Shona speakers from Zimbabwe,
recorded for Google's **FLEURS** speech dataset (locale `sn_zw`). Nothing was synthesised: the clips are
trimmed, lightly cleaned (90 Hz high-pass, mild FFT denoise), loudness-matched and packed into audio sprites
by `tools/build_voices.py`. The crowd bed layers many of the same recordings at low level (with a small
speed/pitch spread, a 4 kHz low-pass and a short room echo) so that no single sentence is intelligible.

| File | Contents |
|------|----------|
| `voices_f.mp3`, `voices_m.mp3` | {n_clips} clips ({summary}); offsets, Shona text and English translations in `voices.json` |
| `crowd_loop.mp3` | {crowd_s:.0f} s seamless loop of layered Shona chatter ({crowd_voices} utterances) |

## Speech: FLEURS

- Dataset: FLEURS - Few-shot Learning Evaluation of Universal Representations of Speech, Shona (`sn_zw`),
  dev and test splits. <https://huggingface.co/datasets/google/fleurs>
- License: **Creative Commons Attribution 4.0 International (CC BY 4.0)**
  <https://creativecommons.org/licenses/by/4.0/>
- Paper: Alexis Conneau, Min Ma, Simran Khanuja, Yu Zhang, Vera Axelrod, Siddharth Dalmia, Jason Riesa,
  Clara Rivera, Ankur Bapna. *FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech.*
  IEEE Spoken Language Technology Workshop (SLT) 2022. arXiv:2205.12446 <https://arxiv.org/abs/2205.12446>

```bibtex
@article{{fleurs2022arxiv,
  title   = {{FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech}},
  author  = {{Conneau, Alexis and Ma, Min and Khanuja, Simran and Zhang, Yu and Axelrod, Vera and Dalmia, Siddharth
             and Riesa, Jason and Rivera, Clara and Bapna, Ankur}},
  journal = {{arXiv preprint arXiv:2205.12446}},
  url     = {{https://arxiv.org/abs/2205.12446}},
  year    = {{2022}}
}}
```

## Sentences: FLoRes

The speakers read sentences from the FLoRes-101 benchmark (translations of English Wikipedia sentences).
The Shona text (`sn`) is the FLEURS transcription; the English text (`en`) is the matching FLoRes English
sentence, licensed **CC BY-SA 4.0** <https://creativecommons.org/licenses/by-sa/4.0/>.
Goyal et al., *The FLORES-101 Evaluation Benchmark for Low-Resource and Multilingual Machine Translation*, 2021.
<https://github.com/facebookresearch/flores>

## Changes made

Selection of a subset of utterances (content curated to everyday/neutral topics), trimming of silence,
cutting of short fragments at natural pauses ("barks"), splitting of some two-sentence utterances at the
sentence pause, high-pass filtering, FFT denoising, loudness normalisation with peak limiting, 15 ms fades,
resampling to 24 kHz, MP3 encoding and concatenation into sprites; for the crowd loop additionally mixing,
panning, speed change (+/-6 %), low-pass filtering and echo. Bark subtitles (`approx: true`) are estimated
from timing and may be off by a word.

This is a non-commercial fan project and is not endorsed by Google, Meta, or the speakers.
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--fleurs', default=str(DEFAULT_FLEURS))
    ap.add_argument('--fleurs-en', default=str(DEFAULT_FLEURS_EN))
    ap.add_argument('--out', default=str(DEFAULT_OUT))
    ap.add_argument('--work', default=str(DEFAULT_WORK))
    ap.add_argument('--ffmpeg', default=os.environ.get('FFMPEG', DEFAULT_FFMPEG))
    ap.add_argument('--seed', type=int, default=20260927)
    ap.add_argument('--verify-only', action='store_true')
    ap.add_argument('--stop-after', choices=['analyse', 'select'], default=None)
    args = ap.parse_args()
    out_dir = Path(args.out)
    if args.verify_only:
        return verify(args.ffmpeg, out_dir, random.Random(args.seed))

    items = load_corpus(args.fleurs, args.fleurs_en)
    log(f'corpus: {len(items)} recordings, {len({i["sid"] for i in items})} sentences')
    data, envs = analyse_all(items, args.fleurs, args.ffmpeg, args.work)
    if args.stop_after == 'analyse':
        return
    for r in data:
        r['_fleurs'] = args.fleurs
        e = envs.get(r['wav'])
        r['_env'], r['_zcr'] = (e[0], e[1]) if e is not None else (None, None)
    med = annotate(data)
    log('speaking-rate medians (letters/s):', {k: round(v, 1) for k, v in med.items()})
    hits = sorted({(r['sid'], r['en']) for r in data if r['ok'] and r['sid'] in ALLOWED_IDS and r['keyword_hit']})
    for sid, en in hits:
        log(f'  keyword net rejected allowed sentence {sid}: {en[:90]}')
    log(f'content: {len(ALLOWED_IDS & {r["sid"] for r in data})} of {len({r["sid"] for r in data})} sentence ids allowed, '
        f'{sum(r["ok"] and r["content_ok"] for r in data)} recordings')

    sid_count, used = Counter(), set()
    quota = {'m-clean': 0.62, 'm-noisy': 0.45}      # keep both male sessions (voices) in the mix
    lines = {}
    for g in ('female', 'male'):
        # Line priority tiers: whole utterances, then sentence-split halves; and when natural short
        # utterance starts are scarce for this gender, recordings that could give a bark go last.
        bark_all, _ = bark_candidates([r for r in data if r['ok'] and r['gender'] == g], set())
        bark_wavs = {c['rec']['wav'] for c in bark_all}
        scarce = len(bark_wavs) < 1.25 * TARGET_BARKS[g]
        full = [c for c in line_candidates(data) if c['rec']['gender'] == g]
        split = [c for c in split_line_candidates(data) if c['rec']['gender'] == g]
        for c in split:
            c['score'] -= 100
        for c in full + split:
            if scarce and c['rec']['wav'] in bark_wavs:
                c['score'] -= 200
        chosen = choose(full + split, TARGET_LINES[g], sid_count, used, quota if g == 'male' else None)
        log(f'  {g}: {sum(c["part"] is None for c in chosen)} whole-utterance lines (of {len(full)} candidates) + '
            f'{sum(c["part"] is not None for c in chosen)} sentence-split lines (of {len(split)}); '
            f'bark-capable recordings {len(bark_wavs)}{" (scarce: kept for barks where possible)" if scarce else ""}; '
            f'sessions {dict(Counter(c["rec"]["session"] for c in chosen))}')
        lines[g] = chosen
    barks = {}
    for g in ('female', 'male'):
        cands, skipped = bark_candidates([r for r in data if r['ok'] and r['gender'] == g], {k[0] for k in used})
        barks[g] = choose(cands, TARGET_BARKS[g], sid_count, used, quota if g == 'male' else None)
        log(f'  {g}: {len(barks[g])} barks (of {len(cands)} candidates; {sum(c["pause_index"] > 0 for c in barks[g])} '
            f'extend past a pause < {BARK_MIN_S} s in; {sum(bool(c["sn"]) for c in barks[g])} with estimated text); '
            f'sessions {dict(Counter(c["rec"]["session"] for c in barks[g]))}')
    if args.stop_after == 'select':
        return

    sel = []
    for g in ('female', 'male'):
        for kind, group in (('line', lines[g]), ('bark', barks[g])):
            for i, c in enumerate(group, 1):
                c.update(kind=kind, gender=g, id=f'{g[0]}-{kind}-{i:03d}')
                sel.append(c)
    log(f'rendering {len(sel)} clips ...')
    jobs = [(args.ffmpeg, Path(args.fleurs) / 'audio' / c['rec']['split'] / c['rec']['wav'], c['rec']['noise_db'],
             c['t0'], c['t1'], c['rec']['runs']) for c in sel]
    with ProcessPoolExecutor(max_workers=os.cpu_count() or 2) as ex:
        for c, (pcm, info) in zip(sel, ex.map(render_job, jobs)):
            c['pcm'], c['proc'] = pcm, info
    lags = Counter(c['proc']['lag'] for c in sel)
    lim = [c['proc']['limit_db'] for c in sel]
    log(f'  afftdn lag compensation (samples): {dict(lags)}; limiter gain reduction: median '
        f'{np.median(lim):.1f} dB, max {max(lim):.1f} dB, {sum(x > 0 for x in lim)} clips limited')

    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob('voices_*.mp3'):
        old.unlink()
    sprites = build_sprites(args.ffmpeg, sel, out_dir)

    rng = np.random.default_rng(args.seed)
    crowd = build_crowd(args.ffmpeg, data, {k[0] for k in used}, out_dir / 'crowd_loop.mp3', rng)
    log(f'  crowd_loop.mp3: {crowd["voices"]} utterances ({crowd["female"]} F / {crowd["male"]} M, '
        f'{crowd["sentences"]} sentences), gains {min(crowd["gains_db"])}..{max(crowd["gains_db"])} dB, '
        f'max single-voice share of a 0.5 s window {crowd["max_share"]:.2f}, audible voices per window '
        f'min {crowd["min_audible_voices"]} / mean {crowd["mean_audible_voices"]:.1f}, '
        f'{crowd["bytes"] / 1e6:.2f} MB')

    manifest = {
        'version': 1,
        'attribution': ATTRIBUTION,
        'sprites': {k: v['path'] for k, v in sprites.items()},
        'ambient': {'crowd': 'audio/crowd_loop.mp3'},
        'ambientLoop': {'crowd': {'start': 0.0, 'end': CROWD_LEN_S}},
        'clips': [],
    }
    for c in sel:
        r = c['rec']
        clip = dict(id=c['id'], sprite=c['sprite'], start=round(c['start'], 4), dur=round(c['dur'], 4),
                    kind=c['kind'], gender=c['gender'], voice=Path(r['wav']).stem, sn=c['sn'], en=c['en'],
                    f0=int(round(r['f0'])))
        if c['kind'] == 'bark' and c['sn']:
            clip['approx'] = True
        manifest['clips'].append(clip)
    (out_dir / 'voices.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    kinds = Counter((c['kind'], c['gender']) for c in sel)
    summary = ', '.join(f'{kinds[(k, g)]} {g} {k}s' for k in ('line', 'bark') for g in ('female', 'male'))
    (out_dir / 'CREDITS.md').write_text(CREDITS.format(n_clips=len(sel), summary=summary, crowd_s=CROWD_LEN_S,
                                                       crowd_voices=crowd['voices']), encoding='utf-8')
    (Path(args.work) / 'build_report.json').write_text(json.dumps(dict(
        crowd=crowd, sprites=sprites,
        clips=[dict(id=c['id'], wav=c['rec']['wav'], sid=c['rec']['sid'], session=c['rec']['session'],
                    snr=round(c['rec']['snr_db'], 1), t0=c['t0'], t1=c['t1'], part=c['part'], **c['proc'])
               for c in sel]), indent=1))
    log(f'wrote {out_dir / "voices.json"} ({len(sel)} clips: {summary})')
    verify(args.ffmpeg, out_dir, random.Random(args.seed))


# --------------------------------------------------------------------------------------------------
# Verification (decodes the shipped files, so it also checks the MP3 encode)

def verify(ffmpeg, out_dir, rnd, n_check=20):
    man = json.loads((Path(out_dir) / 'voices.json').read_text(encoding='utf-8'))
    vsr = 16000
    ok_all = True
    pcm = {k: ffmpeg_decode(ffmpeg, Path(out_dir) / Path(p).name, sr=vsr) for k, p in man['sprites'].items()}
    fdb = lambda seg: float(db(frame_power(seg).max())) if len(seg) >= FRAME else -120.0
    rms = lambda seg: float(db((seg.astype(np.float64) ** 2).mean())) if len(seg) else -120.0
    log('\nVERIFY sprites')
    for k, x in pcm.items():
        cl = [c for c in man['clips'] if c['sprite'] == k]
        expect = sum(c['dur'] for c in cl) + GAP_S * (len(cl) - 1)
        got = len(x) / vsr
        ends = sorted(c['start'] + c['dur'] for c in cl)
        good = abs(got - expect) <= 0.1 and abs(ends[-1] - expect) < 1e-3
        ok_all &= good
        log(f'  {k}: {len(cl)} clips, sum(dur)+gaps = {expect:.3f} s, decoded = {got:.3f} s, '
            f'diff {got - expect:+.3f} s -> {"OK" if good else "FAIL"}')
    def check(c):
        x = pcm[c['sprite']]
        a, b = int(round(c['start'] * vsr)), int(round((c['start'] + c['dur']) * vsr))
        w, e = int(0.35 * vsr), int(0.03 * vsr)
        head, tail = fdb(x[a:a + w]), fdb(x[b - w:b])
        ein, eout = rms(x[a:a + e]), rms(x[b - e:b])
        last = b >= len(x) - int(0.05 * vsr)
        gap = None if last else rms(x[b + int(0.02 * vsr): b + int((GAP_S - 0.02) * vsr)])
        good = head > -40 and tail > -40 and ein < -35 and eout < -35 and (gap is None or gap < -60)
        return good, head, tail, ein, eout, gap

    sample = rnd.sample(man['clips'], min(n_check, len(man['clips'])))
    log(f'\nVERIFY {len(sample)} random clips (dBFS; speech = loudest 25 ms frame in the first/last 350 ms; '
        f'edge = first/last 30 ms; gap = RMS of the 0.30 s silence after the clip)')
    log(f'  {"id":<13}{"sprite":<7}{"start":>9}{"dur":>7}{"head":>7}{"tail":>7}{"edgeIn":>8}{"edgeOut":>8}{"gap":>8}  result')
    for c in sorted(sample, key=lambda c: c['id']):
        good, head, tail, ein, eout, gap = check(c)
        ok_all &= good
        log(f'  {c["id"]:<13}{c["sprite"]:<7}{c["start"]:>9.3f}{c["dur"]:>7.2f}{head:>7.1f}{tail:>7.1f}{ein:>8.1f}'
            f'{eout:>8.1f}{("  (end)" if gap is None else f"{gap:8.1f}")}  {"OK" if good else "FAIL"}')
    # the same test on every clip (the table above is the requested random sample)
    res = [(c, check(c)) for c in man['clips']]
    bad = [c['id'] for c, r in res if not r[0]]
    log(f'  same checks on ALL {len(res)} clips: {len(res) - len(bad)} pass{", FAIL: " + " ".join(bad) if bad else ""}; '
        f'weakest head/tail speech {min(min(r[1], r[2]) for _, r in res):.1f} dBFS, '
        f'loudest edge {max(max(r[3], r[4]) for _, r in res):.1f} dBFS')
    ok_all &= not bad
    # all gaps, not just the sampled ones
    worst = -200.0
    for k, x in pcm.items():
        for c in man['clips']:
            if c['sprite'] != k:
                continue
            b = int(round((c['start'] + c['dur']) * vsr))
            if b < len(x) - int(0.05 * vsr):
                worst = max(worst, rms(x[b + int(0.02 * vsr): b + int((GAP_S - 0.02) * vsr)]))
    log(f'  loudest inter-clip gap over ALL clips: {worst:.1f} dBFS -> {"OK" if worst < -60 else "FAIL"}')
    ok_all &= worst < -60
    # crowd loop: length, and continuity across the loop point
    y2 = ffmpeg_decode(ffmpeg, Path(out_dir) / 'crowd_loop.mp3', sr=CROWD_SR, channels=2)
    y = y2.mean(axis=1)
    n = int(0.05 * CROWD_SR)
    tail_db, head_db = rms(y[-n:]), rms(y[:n])
    body = np.array([rms(y[i:i + n]) for i in range(0, len(y) - n, n)])
    steps = np.abs(np.diff(body))                      # level change between neighbouring 50 ms windows
    jump = float(np.abs(y2[0] - y2[-1]).max())         # sample step across the loop point
    typical = float(np.percentile(np.abs(np.diff(y2, axis=0)), 99.9))
    good = (abs(len(y) / CROWD_SR - CROWD_LEN_S) < 0.01 and abs(tail_db - head_db) <= steps.max()
            and jump <= typical and min(head_db, tail_db) >= np.percentile(body, 5))
    ok_all &= good
    log(f'\nVERIFY crowd_loop.mp3: {len(y) / CROWD_SR:.3f} s; across the loop point: level step '
        f'{abs(tail_db - head_db):.1f} dB (neighbouring 50 ms windows in the body: median {np.median(steps):.1f}, '
        f'99th pct {np.percentile(steps, 99):.1f} dB), sample step {jump:.4f} (99.9th pct of body {typical:.4f}); '
        f'edge levels {tail_db:.1f}/{head_db:.1f} dBFS (body 5th pct {np.percentile(body, 5):.1f}, min {body.min():.1f}) '
        f'-> {"OK" if good else "FAIL"}')
    total = sum(f.stat().st_size for f in Path(out_dir).iterdir() if f.is_file())
    for f in sorted(Path(out_dir).iterdir()):
        log(f'  {f.name:<18}{f.stat().st_size:>10,d} bytes')
    log(f'  public/audio total: {total:,d} bytes ({total / 1e6:.2f} MB)')
    log(f'\nVERIFY overall: {"PASS" if ok_all else "FAIL"}')
    return 0 if ok_all else 1


if __name__ == '__main__':
    sys.exit(main())
