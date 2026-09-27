import { makeRng } from '../core/rng.js';

// Procedural sound effects, synthesized once into AudioBuffers (plain JS DSP, no audio files).
// Every recipe is deterministic (seeded noise) so the game sounds the same on every run.

const TAU = Math.PI * 2;

// RBJ-cookbook biquad, direct form I. Coefficients can be changed while running (for sweeps).
class Biquad {
  constructor(sr) {
    this.sr = sr;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  set(type, freq, q) {
    const w = (TAU * Math.min(freq, this.sr * 0.45)) / this.sr;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0;
    let b1;
    let b2;
    if (type === 'lowpass') {
      b0 = b2 = (1 - cos) / 2;
      b1 = 1 - cos;
    } else if (type === 'highpass') {
      b0 = b2 = (1 + cos) / 2;
      b1 = -(1 + cos);
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }

  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const expSweep = (a, b, t) => a * Math.pow(b / a, Math.min(1, Math.max(0, t)));
const env = (t, attack, tau) => (t < attack ? t / attack : Math.exp(-(t - attack) / tau));

function render(ctx, seconds, fn, peak = 0.9) {
  const sr = ctx.sampleRate;
  const n = Math.ceil(seconds * sr);
  const data = new Float32Array(n);
  fn(data, sr);
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(data[i]));
  const k = max > 0 ? peak / max : 0;
  // Normalise and fade the last 5 ms so nothing clicks.
  const tail = Math.min(n, Math.round(sr * 0.005));
  for (let i = 0; i < n; i++) data[i] *= k * (i >= n - tail ? (n - i) / tail : 1);
  const buf = ctx.createBuffer(1, n, sr);
  buf.getChannelData(0).set(data);
  return buf;
}

// Web shot: bright filtered noise burst + a fast falling pitch sweep.
function thwip(ctx) {
  const rng = makeRng(11);
  return render(ctx, 0.26, (d, sr) => {
    const bp = new Biquad(sr);
    const lp = new Biquad(sr).set('lowpass', 900, 0.7);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      if ((i & 15) === 0) bp.set('bandpass', expSweep(7500, 1600, t / 0.16), 1.3);
      const n = rng() * 2 - 1;
      ph += (TAU * expSweep(2800, 480, t / 0.09)) / sr;
      d[i] = bp.run(n) * 1.6 * env(t, 0.002, 0.05) + Math.sin(ph) * 0.35 * env(t, 0.002, 0.03) + lp.run(n) * 0.35 * env(t, 0.001, 0.018);
    }
  });
}

// Zip line: rising, zipper-modulated buzz with a hissing noise band.
function zip(ctx) {
  const rng = makeRng(23);
  const dur = 0.5;
  return render(ctx, dur, (d, sr) => {
    const bp = new Biquad(sr).set('bandpass', 1500, 0.8);
    const hiss = new Biquad(sr);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      if ((i & 15) === 0) hiss.set('bandpass', expSweep(1400, 5200, t / dur), 1.1);
      ph += expSweep(170, 950, t / 0.36) / sr;
      const saw = 2 * (ph % 1) - 1;
      const zipper = 0.55 + 0.45 * Math.sin(TAU * 48 * t);
      const shape = Math.min(1, t / 0.02) * Math.min(1, (dur - t) / 0.14);
      d[i] = (bp.run(saw) * zipper + hiss.run(rng() * 2 - 1) * 0.5) * shape;
    }
  }, 0.8);
}

// Air rush: noise through a band that sweeps up and back down, swelling in the middle.
function whoosh(ctx) {
  const rng = makeRng(37);
  const dur = 0.7;
  return render(ctx, dur, (d, sr) => {
    const bp = new Biquad(sr);
    const bp2 = new Biquad(sr);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const u = t / dur;
      if ((i & 15) === 0) {
        const f = 260 + 1250 * Math.sin(Math.PI * Math.min(1, u * 1.15));
        bp.set('bandpass', f, 0.9);
        bp2.set('bandpass', f * 2.1, 2);
      }
      const n = rng() * 2 - 1;
      const swell = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 2);
      d[i] = (bp.run(n) + bp2.run(n) * 0.35) * swell;
    }
  }, 0.75);
}

// Landing: short body thump + a scuff of grit.
function land(ctx) {
  const rng = makeRng(41);
  return render(ctx, 0.36, (d, sr) => {
    const click = new Biquad(sr).set('lowpass', 1800, 0.7);
    const grit = new Biquad(sr).set('bandpass', 2400, 1.2);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      ph += (TAU * expSweep(115, 45, t / 0.12)) / sr;
      const n = rng() * 2 - 1;
      d[i] = Math.sin(ph) * env(t, 0.003, 0.07) + click.run(n) * 0.55 * env(t, 0.001, 0.012) + grit.run(n) * 0.3 * env(t, 0.01, 0.06);
    }
  });
}

// Superhero landing: deep saturated thump, rumble tail and falling debris.
function landHard(ctx) {
  const rng = makeRng(53);
  const dur = 1.2;
  const grains = [];
  for (let k = 0; k < 34; k++) {
    grains.push({ t: 0.04 + Math.pow(rng(), 1.6) * 0.95, f: 1800 + rng() * 4500, tau: 0.006 + rng() * 0.016, a: 0.1 + rng() * 0.3 });
  }
  grains.sort((a, b) => a.t - b.t);
  return render(ctx, dur, (d, sr) => {
    const click = new Biquad(sr).set('lowpass', 1300, 0.7);
    const rumble = new Biquad(sr).set('lowpass', 220, 0.8);
    const debris = new Biquad(sr);
    let ph = 0;
    let g = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      ph += (TAU * expSweep(85, 28, t / 0.3)) / sr;
      const n = rng() * 2 - 1;
      const body = Math.tanh(Math.sin(ph) * 2.2 * env(t, 0.003, 0.2));
      let deb = 0;
      while (g < grains.length && grains[g].t + grains[g].tau * 6 < t) g++;
      for (let k = g; k < grains.length && grains[k].t <= t; k++) {
        const gr = grains[k];
        deb += gr.a * Math.exp(-(t - gr.t) / gr.tau);
      }
      if ((i & 31) === 0 && g < grains.length) debris.set('bandpass', grains[g].f, 1.4);
      d[i] = body + click.run(n) * 0.8 * env(t, 0.001, 0.04) + rumble.run(n) * 1.4 * env(t, 0.01, 0.32) + debris.run(n) * deb * (1 - t / dur) * 3;
    }
  });
}

// Soft footstep.
function step(ctx) {
  const rng = makeRng(61);
  return render(ctx, 0.1, (d, sr) => {
    const lp = new Biquad(sr).set('lowpass', 1300, 0.8);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      d[i] = lp.run(rng() * 2 - 1) * env(t, 0.002, 0.018) + Math.sin(TAU * 90 * t) * 0.4 * env(t, 0.002, 0.014);
    }
  }, 0.6);
}

// Two-tone car horn (roughly 405 + 507 Hz, square-ish, gently clipped).
function horn(ctx) {
  const dur = 0.72;
  return render(ctx, dur, (d, sr) => {
    const lp = new Biquad(sr).set('lowpass', 2600, 0.8);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      let s = 0;
      for (const f of [405, 507]) {
        for (let h = 1; h <= 7; h += 2) s += Math.sin(TAU * f * h * t) / h;
      }
      const shape = Math.min(1, t / 0.015) * Math.min(1, (dur - t) / 0.06);
      d[i] = Math.tanh(lp.run(s) * 1.4) * shape;
    }
  }, 0.55); // dense and loud-sounding: lower peak keeps it level with the other effects
}

// Kombi hoot: brassy double toot (saw pair through a formant band).
function kombiHoot(ctx) {
  const dur = 0.66;
  const bursts = [
    [0, 0.19],
    [0.28, 0.64],
  ];
  return render(ctx, dur, (d, sr) => {
    const formant = new Biquad(sr).set('bandpass', 1150, 1.4);
    const body = new Biquad(sr).set('lowpass', 1800, 0.7);
    let p1 = 0;
    let p2 = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      p1 += 352 / sr;
      p2 += 443 / sr;
      const saw = 2 * (p1 % 1) - 1 + (2 * (p2 % 1) - 1);
      let shape = 0;
      for (const [a, b] of bursts) {
        if (t >= a && t < b) shape = Math.min(1, (t - a) / 0.012) * Math.min(1, (b - t) / 0.04);
      }
      d[i] = Math.tanh((formant.run(saw) * 1.6 + body.run(saw) * 0.6) * 1.3) * shape;
    }
  }, 0.6);
}

// UI click: tiny pitched tick.
function ui(ctx) {
  const rng = makeRng(71);
  return render(ctx, 0.07, (d, sr) => {
    const hp = new Biquad(sr).set('highpass', 3000, 0.7);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      ph += (TAU * expSweep(1900, 1350, t / 0.05)) / sr;
      d[i] = Math.sin(ph) * env(t, 0.001, 0.016) + hp.run(rng() * 2 - 1) * 0.25 * env(t, 0.0005, 0.003);
    }
  }, 0.5);
}

// Cape turtle dove: soft three-syllable croon "kuk-KOORR-uk", twice.
function dove(ctx) {
  const syll = [
    [0, 0.12, 520, 500, 0],
    [0.2, 0.36, 610, 470, 1],
    [0.64, 0.12, 500, 480, 0],
  ];
  const notes = [...syll, ...syll.map(([t, ...r]) => [t + 1.05, ...r])];
  return render(ctx, 1.9, (d, sr) => {
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const n = notes.find(([a, len]) => t >= a && t < a + len);
      if (!n) continue;
      const [a, len, f0, f1, rolled] = n;
      const u = (t - a) / len;
      ph += (TAU * (f0 + (f1 - f0) * u)) / sr;
      const roll = rolled ? 0.65 + 0.35 * Math.sin(TAU * 28 * t) : 1;
      d[i] = (Math.sin(ph) + 0.25 * Math.sin(2 * ph)) * Math.sin(Math.PI * u) * roll;
    }
  }, 0.5);
}

// Dark-capped bulbul: bright quick chatter in the 1.5-3.5 kHz range.
function bulbul(ctx, seed) {
  const rng = makeRng(seed);
  const notes = [];
  let t0 = 0;
  const count = 4 + Math.floor(rng() * 3);
  for (let k = 0; k < count; k++) {
    const len = 0.06 + rng() * 0.07;
    notes.push({ t: t0, len, f0: 1600 + rng() * 1200, f1: 2200 + rng() * 1300 });
    t0 += len + 0.04 + rng() * 0.05;
  }
  return render(ctx, t0 + 0.05, (d, sr) => {
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const n = notes.find((q) => t >= q.t && t < q.t + q.len);
      if (!n) continue;
      const u = (t - n.t) / n.len;
      ph += (TAU * (n.f0 + (n.f1 - n.f0) * Math.sin(Math.PI * u))) / sr;
      d[i] = Math.sin(ph) * Math.sin(Math.PI * u);
    }
  }, 0.5);
}

// Field cricket: a few 4.6 kHz pulse trains.
function cricket(ctx) {
  return render(ctx, 0.9, (d, sr) => {
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const chirp = Math.floor(t / 0.3);
      const p = t - chirp * 0.3;
      const pulse = p % 0.032;
      if (p > 0.13 || pulse > 0.014) continue;
      d[i] = Math.sin(TAU * 4600 * t) * Math.sin((Math.PI * pulse) / 0.014);
    }
  }, 0.35);
}

export function synthesizeSfx(ctx) {
  return {
    thwip: thwip(ctx),
    zip: zip(ctx),
    whoosh: whoosh(ctx),
    land: land(ctx),
    landHard: landHard(ctx),
    step: step(ctx),
    horn: horn(ctx),
    kombiHoot: kombiHoot(ctx),
    ui: ui(ctx),
  };
}

// Park wildlife: doves and bulbuls by day, crickets at night.
export function synthesizeWildlife(ctx) {
  return { day: [dove(ctx), bulbul(ctx, 101), bulbul(ctx, 202)], night: [cricket(ctx)] };
}

// Seamlessly looping noise beds: 'white', 'pink' or 'brown'. The tail is cross-faded into the head.
export function noiseBuffer(ctx, color, seconds, seed) {
  const rng = makeRng(seed);
  const sr = ctx.sampleRate;
  const n = Math.round(seconds * sr);
  const fade = Math.round(sr * 0.25);
  const raw = new Float32Array(n + fade);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let last = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = rng() * 2 - 1;
    if (color === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      raw[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
    } else if (color === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      raw[i] = last * 3.5;
    } else {
      raw[i] = w * 0.5;
    }
  }
  const buf = ctx.createBuffer(1, n, sr);
  const out = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    out[i] = i < fade ? raw[i] * (i / fade) + raw[n + i] * (1 - i / fade) : raw[i];
  }
  return buf;
}
