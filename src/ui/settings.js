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
  quality: null,
};

function readStored() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
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
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch {
      /* storage unavailable: the setting still applies for this session */
    }
  }
}
