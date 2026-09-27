import * as THREE from 'three';

// Real spoken Shona street phrases from public/audio/extras.json (FSI Shona Basic Course tapes, 1965,
// public domain: all one MALE voice, see audio/CREDITS-extra.md), played through game.audio.playExtra:
// greetings for Spider-Man by time of day, exclamations when he lands, the banana seller's call and
// hwindi destination calls. One director per game, shared by the pedestrians (src/npc) and the kombis
// (src/traffic), so the street never turns into a chorus: a gap between any two starts, at most two
// clips at once (three voices counting the FLEURS lines), never the same clip twice in a row and not
// again within half a minute, and a cool-down per purpose (greeting, reaction, vendor, hwindi).
// Everything degrades to "no clip" (callers fall back to text-only bubbles) while the audio manager,
// its extras manifest or the decoded sprite are missing.

const MIN_GAP = 1.2; // s between two clip starts
const MAX_ACTIVE = 2; // extra clips at once
const MAX_VOICES = 3; // extra clips + FLEURS lines at once
const REPEAT = 30; // s before the same clip is heard again
const PURPOSE_GAP = { greet: 3, react: 2.5, vendor: 8, hwindi: 7 };

// Greetings a man on the street would give Spider-Man (a man): "baba" / "chirombowe" forms, never the
// ones addressed to women. Mangwanani before ~11:00 (and "Mwarara here?", did you sleep well), Masikati
// after; the recordings have no "Manheru" (good evening), so evenings get the road greeting "Masanga".
export const GREETINGS = {
  morning: ['sn-mangwanani-baba', 'sn-mangwanani-chirombowe', 'sn-mwarara-here'],
  day: ['sn-masikati', 'sn-masikati-baba', 'sn-masikati-chirombowe', 'sn-masanga-chirombowe'],
  evening: ['sn-masanga-chirombowe'],
};
export const ELDER_GREETINGS = { day: ['sn-masikati-mwanangu'] }; // "good afternoon, my child"
// Reactions to Spider-Man: "Who is that?", "Ah! You're overdoing it!", "Oh, very well indeed!" and,
// now and then, "Thank you".
export const REACT_AWE = [['sn-munhu-ndiani', 0.45], ['sn-muri-kunyanya-kani', 0.28], ['sn-aiwa-zvitambo', 0.15], ['sn-mwazviita', 0.12]];
export const REACT_FEAR = [['sn-munhu-ndiani', 0.6], ['sn-muri-kunyanya-kani', 0.4]];
export const REACT_SWING = [['sn-munhu-ndiani', 1], ['sn-aiwa-zvitambo', 0.3]];
export const BANANAS = 'sn-ndiri-kutengesa-mahobo';

export function greetingPart(hour) {
  return hour >= 4 && hour < 11 ? 'morning' : hour >= 11 && hour < 18 ? 'day' : 'evening';
}

// English gloss for a bubble: the manifest's teaching notes in brackets are dropped, and of alternative
// readings ("Who is that? / Who are you?") only the first is kept.
export function gloss(en) {
  return (en || '').replace(/\s*\([^)]*\)/g, '').split(' / ')[0].trim();
}

// "KuHarare." -> "KuHarare!" (a destination as a hwindi calls it).
export function shout(text) {
  return `${(text || '').replace(/[.!?\s]+$/, '')}!`;
}

const directors = new WeakMap();

// The director of this game (created on first use).
export function streetVoices(game) {
  let d = directors.get(game);
  if (!d) directors.set(game, (d = new StreetVoices(game)));
  return d;
}

export class StreetVoices {
  constructor(game) {
    this.game = game;
    this.byId = new Map();
    this.destinations = [];
    this.played = new Map(); // clip id -> game time it last started
    this.purposeAt = {}; // purpose -> game time from which it may be used again
    this.lastId = null;
    this.lastStart = -1e9;
    this.active = []; // {from?, until, handle, track, startAc?} (game time; startAc: audio-clock start of a scheduled repeat)
    this.voices = []; // FLEURS lines: end times
    this.pending = []; // {at, fn}
    this.stats = { played: [], failed: 0 };
    this._frame = -1;
    this._destN = 0;
    this._v = new THREE.Vector3();
  }

  // Manifest clips, once the audio manager has them.
  _load() {
    if (this.byId.size) return true;
    const clips = this.game.audio?.extraClips?.();
    if (!Array.isArray(clips) || !clips.length) return false;
    for (const c of clips) this.byId.set(c.id, c);
    // Destination calls: every 'call' clip except the banana seller's.
    this.destinations = clips.filter((c) => c.kind === 'call' && c.id !== BANANAS).map((c) => c.id);
    return true;
  }

  get ready() {
    return typeof this.game.audio?.playExtra === 'function' && this._load();
  }

  clip(id) {
    return this._load() ? this.byId.get(id) || null : null;
  }

  _count(t) {
    let n = 0;
    for (const a of this.active) if (a.until > t && !(a.from > t)) n++;
    return n;
  }

  // Voices playing now: extra clips plus FLEURS lines the voice director reported.
  voiceCount() {
    const t = this.game.time;
    let n = this._count(t);
    for (const u of this.voices) if (u > t) n++;
    return n;
  }

  // Report a FLEURS line (src/npc/voices.js) that plays until `until` (game time).
  noteVoice(until) {
    const t = this.game.time;
    this.voices = this.voices.filter((u) => u > t);
    this.voices.push(until);
    this.lastStart = Math.max(this.lastStart, t - MIN_GAP * 0.5);
  }

  // May a clip for `purpose` start now (or `delay` s from now)?
  canSpeak(purpose, delay = 0) {
    if (!this.ready) return false;
    const t = this.game.time + delay;
    if (t - this.lastStart < MIN_GAP || t < (this.purposeAt[purpose] ?? -1e9)) return false;
    return this._count(t) < MAX_ACTIVE && this.voiceCount() < MAX_VOICES;
  }

  // Hold `purpose` from now until `delay` s from now plus its usual gap (a clip is scheduled then).
  reserve(purpose, delay) {
    const t = this.game.time;
    this.purposeAt[purpose] = t + delay + (PURPOSE_GAP[purpose] ?? 3);
    this.lastStart = Math.max(this.lastStart, t + delay - MIN_GAP * 0.5);
  }

  _fresh(id, t) {
    const at = this.played.get(id);
    return id !== this.lastId && (at === undefined || t - at > REPEAT) && this.byId.has(id);
  }

  // A random fresh clip from ids, or from [id, weight] pairs; null if none.
  choose(list) {
    if (!this._load()) return null;
    const t = this.game.time;
    let total = 0;
    for (const e of list) if (this._fresh(Array.isArray(e) ? e[0] : e, t)) total += Array.isArray(e) ? e[1] : 1;
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const e of list) {
      const id = Array.isArray(e) ? e[0] : e;
      if (!this._fresh(id, t)) continue;
      r -= Array.isArray(e) ? e[1] : 1;
      if (r <= 0) return this.byId.get(id);
    }
    return null;
  }

  // Next destination call, round robin (each kombi / hwindi keeps the one it is given).
  assignDestination() {
    if (!this._load() || !this.destinations.length) return null;
    return this.destinations[this._destN++ % this.destinations.length];
  }

  // Play a clip. `track(v)` writes the speaker's current mouth position into v and returns false once
  // they are gone (the clip then stops following them). Returns the audio handle (duration in wall
  // seconds) or null when nothing could be played.
  play(clip, track, { rate = 1, volume = 1, purpose = 'greet' } = {}) {
    if (!clip || !this.ready) return null;
    const t = this.game.time;
    const pos = this._v;
    if (track && !track(pos)) return null;
    const handle = this.game.audio.playExtra(clip.id, track ? pos : null, { rate, volume });
    if (!handle) {
      this.stats.failed++;
      return null;
    }
    const dur = handle.duration ?? clip.dur / rate;
    this.played.set(clip.id, t);
    this.lastId = clip.id;
    this.lastStart = Math.max(this.lastStart, t); // (a scheduled hwindi repeat may lie ahead)
    this.purposeAt[purpose] = Math.max(this.purposeAt[purpose] ?? -1e9, t + dur + (PURPOSE_GAP[purpose] ?? 3));
    this.active.push({ until: t + dur, handle, track });
    this._log(clip.id, t, rate, volume, dur, purpose);
    return handle;
  }

  // Recent plays (stats.played, newest last) for debugging and tests.
  _log(id, t, rate, volume, dur, purpose) {
    const s = this.stats.played;
    s.push({ id, t: Math.round(t * 100) / 100, rate: Math.round(rate * 1000) / 1000, volume: Math.round(volume * 100) / 100, dur: Math.round(dur * 100) / 100, purpose });
    if (s.length > 60) s.shift();
  }

  // A hwindi calling a destination: the clip twice in a row, the second a little faster (higher) and
  // louder. Returns the total duration in seconds, or 0 if the first call could not be played.
  doubleCall(clip, track, { rate = 1, volume = 1 } = {}) {
    const h = this.play(clip, track, { rate, volume, purpose: 'hwindi' });
    if (!h) return 0;
    const t = this.game.time;
    const d1 = h.duration ?? clip.dur / rate;
    const gap = 0.16;
    const rate2 = rate * 1.06;
    let d2 = clip.dur / rate2;
    // The repeat is part of the same call: it bypasses the gaps (and the no-repeat rule) on purpose, and
    // is scheduled on the audio clock right away, so the rhythm holds even when frames (and with them
    // game time) run slowly or the game is paused in between. play() left the speaker's position in _v.
    const ctx = this.game.audio.ctx;
    const h2 = this.game.audio.playExtra(clip.id, track ? this._v : null, { rate: rate2, volume: volume * 1.22, delay: d1 + gap });
    if (h2) {
      d2 = h2.duration ?? d2;
      this.active.push({ from: t + d1 + gap, until: t + d1 + gap + d2, handle: h2, track, startAc: ctx ? ctx.currentTime + d1 + gap : 0 });
      this.lastStart = t + d1 + gap; // the gap to the next clip counts from the repeat
      this._log(clip.id, t + d1 + gap, rate2, volume * 1.22, d2, 'hwindi-repeat');
    }
    const total = d1 + gap + d2;
    this.purposeAt.hwindi = t + total + PURPOSE_GAP.hwindi;
    return total;
  }

  // Run fn `delay` seconds of game time from now (from update()).
  later(delay, fn) {
    this.pending.push({ at: this.game.time + delay, fn });
  }

  // Once per frame (both npcs and traffic call it; the second call is a no-op).
  update() {
    const game = this.game;
    if (this._frame === game.frame) return;
    this._frame = game.frame;
    const t = game.time;
    if (this.pending.length) {
      const due = [];
      this.pending = this.pending.filter((p) => (p.at <= t ? (due.push(p), false) : true));
      for (const p of due) p.fn();
    }
    if (!this.active.length) return;
    const pos = this._v;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      if (a.until <= t) {
        this.active.splice(i, 1);
        continue;
      }
      if (!a.track || !a.handle.setPosition) continue;
      if (a.track(pos)) a.handle.setPosition(pos);
      else {
        a.track = null;
        // The speaker is gone before his repeated call began: drop it.
        if (a.startAc && game.audio?.ctx?.currentTime < a.startAc) a.handle.stop?.();
      }
    }
  }
}
