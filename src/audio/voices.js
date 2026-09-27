// Voice sprites: public/audio/voices.json lists short clips inside a couple of mp3 sprite files.
// Clip: {id, sprite:'f'|'m', start, dur, kind:'line'|'bark', gender, voice, sn, en}.
// Sprites are fetched and decoded lazily (after the audio context is unlocked).

const MANIFEST_URL = 'audio/voices.json';

// Sprite URLs in the manifest are relative to the manifest; tolerate page-relative 'audio/…' too.
export function resolveAudioUrl(src) {
  const base = /^audio\//.test(src) ? document.baseURI : new URL(MANIFEST_URL, document.baseURI);
  return new URL(src, base).toString();
}

// Decoded audio is raw float PCM, so ~9 minutes of voice sprites would take ~200 MB at 48 kHz.
// Decoding through an OfflineAudioContext at the recordings' own rate (or lower on phones) keeps
// it at a fraction of that; the buffers still play in the main context.
export async function fetchAudioBuffer(ctx, url, sampleRate) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  let decoder = ctx;
  if (sampleRate && sampleRate < ctx.sampleRate) {
    try {
      decoder = new OfflineAudioContext(1, 1, sampleRate);
    } catch {
      /* rate not supported here: decode at the context rate */
    }
  }
  return decoder.decodeAudioData(await res.arrayBuffer());
}

export class VoiceBank {
  // decodeRate: sample rate to decode the sprites at (they are 24 kHz speech).
  constructor(manifest, decodeRate) {
    this.decodeRate = decodeRate;
    this.manifest = manifest;
    this.clips = Array.isArray(manifest?.clips) ? manifest.clips : [];
    this.byId = new Map(this.clips.map((c) => [c.id, c]));
    this.buffers = {};
    this._loading = null;
  }

  // Decode every sprite once; resolves when all have settled.
  load(ctx) {
    if (!this._loading) {
      const sprites = this.manifest?.sprites || {};
      this._loading = Promise.all(
        Object.entries(sprites).map(([key, src]) =>
          fetchAudioBuffer(ctx, resolveAudioUrl(src), this.decodeRate)
            .then((buf) => {
              this.buffers[key] = buf;
            })
            .catch((err) => console.warn(`[audio] voice sprite '${key}' unavailable:`, err.message)),
        ),
      );
    }
    return this._loading;
  }

  clip(id) {
    return this.byId.get(id) || null;
  }

  buffer(sprite) {
    return this.buffers[sprite] || null;
  }

  // voiceClips({kind, gender, voice}) — every given field must match.
  filter(filter = {}) {
    const keys = Object.keys(filter).filter((k) => filter[k] !== undefined && filter[k] !== null);
    return this.clips.filter((c) => keys.every((k) => c[k] === filter[k]));
  }
}
