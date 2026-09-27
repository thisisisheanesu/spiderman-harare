// Player settings, persisted in localStorage (every access is guarded: private mode, blocked storage
// and sandboxed iframes all throw). Volumes are 0..1, sensitivity is a multiplier, quality is
// 'low' | 'medium' | 'high' | null (null = pick automatically).

const KEY = 'spiderman-harare.settings.v1';

const DEFAULTS = {
  master: 0.8,
  voices: 1,
  sfx: 0.8,
  ambience: 0.7,
  muted: false,
  sensitivity: 1,
  invertY: false,
  subtitles: true,
  tour: true, // first-time objective chain (src/ui/tour.js); switched off when finished
  quality: null,
};

// Without localStorage (blocked in some sandboxed iframes) the settings ride on window.name, which
// survives a reload of the same frame, so "Reload to apply" (graphics quality) still works there.
const NAME_PREFIX = `${KEY}:`;

function parse(raw) {
  try {
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

function readStored() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    /* storage unavailable: fall back to window.name */
  }
  if (raw === null) {
    try {
      const name = window.name || '';
      if (name.startsWith(NAME_PREFIX)) raw = name.slice(NAME_PREFIX.length);
    } catch {
      /* ignore */
    }
  }
  return parse(raw) || {};
}

function writeStored(values) {
  const json = JSON.stringify(values);
  try {
    window.localStorage.setItem(KEY, json);
    return;
  } catch {
    /* storage unavailable */
  }
  try {
    const name = window.name || '';
    // Never clobber a name the embedding page gave this frame.
    if (!name || name.startsWith(NAME_PREFIX)) window.name = NAME_PREFIX + json;
  } catch {
    /* the setting still applies for this session */
  }
}

// Quality chosen in the pause menu, applied when the page boots (see main.js pickQuality).
export function storedQuality() {
  const q = readStored().quality;
  return q === 'low' || q === 'medium' || q === 'high' ? q : null;
}

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    const stored = readStored();
    for (const k of Object.keys(DEFAULTS)) {
      const v = stored[k];
      if (typeof v === typeof DEFAULTS[k] && (typeof v !== 'number' || Number.isFinite(v))) this.values[k] = v;
    }
    this.values.quality = storedQuality();
  }

  get(k) {
    return this.values[k];
  }

  set(k, v) {
    if (this.values[k] === v) return;
    this.values[k] = v;
    writeStored(this.values);
  }
}
