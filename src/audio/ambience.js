import { pointInPoly } from '../core/geo.js';
import { noiseBuffer, synthesizeWildlife } from './synth.js';
import { fetchAudioBuffer, resolveAudioUrl } from './voices.js';

const PARAM_RATE = 1 / 15; // s between AudioParam updates
const BIRD_KINDS = new Set(['park', 'grass', 'golf', 'wood']);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Continuous beds, all driven from AudioManager.update():
//   crowd    real Shona street chatter (audio/crowd_loop.mp3), cross-faded loop, level from npcs
//   traffic  synthesized distant rumble + tyre hiss with a slow swell, level from traffic
//   city     quiet always-on pink-noise bed, rare distant horns, doves / bulbuls (crickets at night) in parks
//   wind     tracks the player's speed (roars when diving), louder with altitude (on the sfx bus)
// Ground-level beds fade out with altitude, wind takes over.
export class Ambience {
  constructor(audio) {
    this.audio = audio;
    this.ctx = audio.ctx;
    this.targets = { crowd: 0, traffic: 0 };
    this.paused = false;
    this._paramT = 0;
    this._hornT = 14;
    this._birdT = 3;
    this._inPark = false;
    this._parkT = 0;
    this.parks = (audio.game.data.areas || []).filter((a) => BIRD_KINDS.has(a.kind)).map(withBounds);
  }

  // Build the looping graph (called once the context runs).
  start() {
    const ctx = this.ctx;
    const { ambience, sfx } = this.audio.buses;
    const white = noiseBuffer(ctx, 'white', 3, 5);
    const pink = noiseBuffer(ctx, 'pink', 4, 6);
    const brown = noiseBuffer(ctx, 'brown', 5, 7);

    // Wind: broad band + a whistle band for high-speed dives.
    this.windBand = ctx.createBiquadFilter();
    this.windBand.type = 'bandpass';
    this.windBand.Q.value = 0.6;
    this.windGain = gainNode(ctx, 0);
    this.whistle = ctx.createBiquadFilter();
    this.whistle.type = 'bandpass';
    this.whistle.frequency.value = 1900;
    this.whistle.Q.value = 7;
    this.whistleGain = gainNode(ctx, 0);
    loop(ctx, white).connect(this.windBand).connect(this.windGain).connect(sfx);
    loop(ctx, white, 1.3).connect(this.whistle).connect(this.whistleGain).connect(sfx);

    // Traffic: low rumble + tyre hiss, swelling slowly like passing streams of cars.
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.value = 170;
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'bandpass';
    hiss.frequency.value = 650;
    hiss.Q.value = 0.5;
    const swell = gainNode(ctx, 0.75);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = gainNode(ctx, 0.25);
    lfo.connect(lfoDepth).connect(swell.gain);
    lfo.start();
    this.trafficGain = gainNode(ctx, 0);
    loop(ctx, brown).connect(rumble).connect(swell);
    loop(ctx, pink).connect(hiss).connect(gainNode(ctx, 0.55)).connect(swell);
    swell.connect(this.trafficGain).connect(ambience);

    // City bed.
    const bedFilter = ctx.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.value = 850;
    this.bedGain = gainNode(ctx, 0);
    loop(ctx, pink, 0.9).connect(bedFilter).connect(this.bedGain).connect(ambience);

    this.crowdGain = gainNode(ctx, 0);
    this.crowdGain.connect(ambience);
    this.wildlife = synthesizeWildlife(ctx);
  }

  // region: optional {start, end} (s) of the loopable part; decodeRate: 0 = context rate.
  async loadCrowd(src, region, decodeRate) {
    try {
      const buffer = await fetchAudioBuffer(this.ctx, resolveAudioUrl(src), decodeRate);
      this.crowd = new CrossfadeLoop(this.ctx, buffer, this.crowdGain, region);
    } catch (err) {
      console.warn('[audio] crowd bed unavailable:', err.message);
    }
  }

  setLevel(key, level) {
    if (key in this.targets) this.targets[key] = clamp01(level);
  }

  update(dt, player) {
    if (!this.windGain) return;
    this.crowd?.tick();
    this._paramT += dt;
    if (this._paramT < PARAM_RATE) return;
    const step = this._paramT;
    this._paramT = 0;

    const now = this.ctx.currentTime;
    const set = (param, v, tc = 0.25) => Number.isFinite(v) && param.setTargetAtTime(v, now, tc);
    const alt = player?.position.y ?? 0;
    const high = clamp01((alt - 8) / 90); // 0 at street level, 1 high above the rooftops
    const ground = this.paused ? 0.3 : 1 - 0.85 * high;

    set(this.crowdGain.gain, this.targets.crowd * 0.9 * ground, 0.6);
    set(this.trafficGain.gain, this.targets.traffic * 0.55 * (this.paused ? 0.3 : 1 - 0.65 * high), 0.6);
    set(this.bedGain.gain, (0.08 + 0.06 * this.targets.traffic) * (this.paused ? 0.4 : 1 - 0.5 * high), 0.8);

    const speed = this.paused ? 0 : (player?.speed ?? player?.velocity?.length() ?? 0);
    const v = Math.min(1.4, speed / 40);
    const diving = !this.paused && player?.state === 'dive';
    set(this.windGain.gain, this.paused ? 0 : 0.015 + 0.06 * high + 0.42 * v * v + (diving ? 0.18 : 0), 0.12);
    set(this.windBand.frequency, 320 + 950 * Math.min(1, v) + (diving ? 400 : 0), 0.12);
    set(this.whistleGain.gain, diving || v > 0.85 ? 0.05 + 0.1 * Math.max(0, v - 0.6) : 0, 0.2);

    if (this.paused || !player) return;
    this._cityEvents(step, player, high);
  }

  setPaused(p) {
    this.paused = p;
  }

  // Rare distant horns anywhere in town; birdsong while at ground level in a park.
  _cityEvents(dt, player, high) {
    const p = player.position;
    const audio = this.audio;
    this._hornT -= dt;
    if (this._hornT <= 0) {
      this._hornT = 10 + Math.random() * 25;
      if (high < 0.8) {
        const a = Math.random() * Math.PI * 2;
        const r = 90 + Math.random() * 140;
        audio.playSfx(Math.random() < 0.55 ? 'kombiHoot' : 'horn', { x: p.x + Math.cos(a) * r, y: 2, z: p.z + Math.sin(a) * r }, { volume: 0.5 });
      }
    }
    this._parkT -= dt;
    if (this._parkT <= 0) {
      this._parkT = 0.5;
      this._inPark = p.y < 30 && this.parks.some((a) => p.x > a.minX && p.x < a.maxX && p.z > a.minZ && p.z < a.maxZ && pointInPoly(p.x, p.z, a.pts));
    }
    this._birdT -= dt;
    if (this._inPark && this._birdT <= 0) {
      this._birdT = 1.5 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * 18;
      const set = audio.game.sky?.isNight ? this.wildlife.night : this.wildlife.day;
      const buf = set[Math.floor(Math.random() * set.length)];
      audio.playBuffer(buf, { x: p.x + Math.cos(a) * r, y: 4 + Math.random() * 6, z: p.z + Math.sin(a) * r }, { volume: 0.4, bus: 'ambience' });
    }
  }
}

// Plays a buffer (or its {start, end} region) in a seamless loop by overlapping copies with short
// cross-fades, which also hides the silent padding mp3 encoders add at both ends. Segments are
// scheduled about a second ahead; after a stall (slow frame, suspended tab) it simply restarts.
class CrossfadeLoop {
  constructor(ctx, buffer, dest, region) {
    this.ctx = ctx;
    this.buffer = buffer;
    this.dest = dest;
    this.start = Math.max(0, region?.start ?? 0);
    this.end = Math.min(buffer.duration, region?.end ?? buffer.duration);
    if (this.end - this.start < 1) {
      this.start = 0;
      this.end = buffer.duration;
    }
    const len = this.end - this.start;
    this.fade = Math.min(1.5, len / 4);
    this.next = null;
    this.offset = this.start + Math.random() * (len - this.fade * 2); // begin somewhere mid-loop
  }

  tick() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (this.next === null || this.next < now) this.next = now + 0.05;
    while (this.next < now + 1) {
      const t = this.next;
      const len = this.end - this.offset;
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + this.fade);
      g.gain.setValueAtTime(1, t + len - this.fade);
      g.gain.linearRampToValueAtTime(0, t + len);
      src.connect(g).connect(this.dest);
      src.start(t, this.offset, len);
      src.onended = () => {
        src.disconnect();
        g.disconnect();
      };
      this.next = t + len - this.fade;
      this.offset = this.start;
    }
  }
}

function gainNode(ctx, value) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function loop(ctx, buffer, rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.playbackRate.value = rate;
  src.start(ctx.currentTime, Math.random() * buffer.duration);
  return src;
}

function withBounds(a) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < a.pts.length; i += 2) {
    minX = Math.min(minX, a.pts[i]);
    maxX = Math.max(maxX, a.pts[i]);
    minZ = Math.min(minZ, a.pts[i + 1]);
    maxZ = Math.max(maxZ, a.pts[i + 1]);
  }
  return { pts: a.pts, minX, maxX, minZ, maxZ };
}
