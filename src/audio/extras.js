import { fetchAudioBuffer, matchClips, resolveAudioUrl } from './voices.js';

// Extra street audio: public/audio/extras.json (built by tools/build_extras.py, credits in
// audio/CREDITS-extra.md). Everything here is optional: a missing or broken manifest just means no
// extras (extraClips() returns [], playExtra() returns null).
//
//   ambience: [{id, url, use: 'market'|'rank'|'street'|'park', dur, channels, loop, ...}]  60 s seamless loops
//   sprite:   'audio/street/greetings.mp3'
//   clips:    [{id, start, dur, kind: 'greet'|'exclaim'|'call', lang: 'sn', text, en, gender, ...}]
// Clips get `sn` (= text for Shona clips) and `bank: 'extras'` added so they read like the FLEURS clips.

const MANIFEST_URL = 'audio/extras.json';

export class ExtrasBank {
  constructor(decodeRate) {
    this.decodeRate = decodeRate;
    this.manifest = null;
    this.clips = [];
    this.byId = new Map();
    this.buffer = null;
    this._manifest = null;
    this._sprite = null;
    this.ready = new Promise((resolve) => (this._resolveReady = resolve));
  }

  // Fetch the manifest once; resolves to it, or null when it is absent / unreadable.
  loadManifest() {
    if (!this._manifest) {
      this._manifest = (async () => {
        try {
          const res = await fetch(new URL(MANIFEST_URL, document.baseURI));
          const type = res.headers.get('content-type') || '';
          if (!res.ok || type.includes('html')) throw new Error(`HTTP ${res.status}`);
          const m = await res.json();
          this.manifest = m && typeof m === 'object' ? m : null;
        } catch (err) {
          console.warn('[audio] extras.json unavailable:', err.message);
          this.manifest = null;
        }
        const clips = Array.isArray(this.manifest?.clips) ? this.manifest.clips : [];
        this.clips = clips
          .filter((c) => c && typeof c.id === 'string' && Number.isFinite(c.start) && Number.isFinite(c.dur) && c.dur > 0)
          .map((c) => ({ ...c, sn: c.sn ?? (c.lang === 'sn' ? c.text : undefined), bank: 'extras' }));
        this.byId = new Map(this.clips.map((c) => [c.id, c]));
        this._resolveReady(this.clips);
        return this.manifest;
      })();
    }
    return this._manifest;
  }

  // Ambience loop entries ([] without a manifest).
  get ambience() {
    const list = this.manifest?.ambience;
    return Array.isArray(list) ? list.filter((a) => a && typeof a.url === 'string' && typeof a.use === 'string') : [];
  }

  // Decode the greetings sprite once (after the manifest); resolves when settled.
  loadSprite(ctx) {
    if (!this._sprite) {
      this._sprite = this.loadManifest().then(async (m) => {
        if (!m?.sprite || !this.clips.length) return;
        try {
          this.buffer = await fetchAudioBuffer(ctx, resolveAudioUrl(m.sprite), this.decodeRate);
        } catch (err) {
          console.warn('[audio] greetings sprite unavailable:', err.message);
        }
      });
    }
    return this._sprite;
  }

  clip(id) {
    return this.byId.get(id) || null;
  }

  filter(filter) {
    return matchClips(this.clips, filter);
  }
}
