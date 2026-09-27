import { pointInPoly } from '../core/geo.js';
import { noiseBuffer, synthesizeWildlife } from './synth.js';
import { fetchAudioBuffer, resolveAudioUrl } from './voices.js';
import { SoundZones } from './zones.js';

const PARAM_RATE = 1 / 15; // s between AudioParam updates
const ZONE_RATE = 0.25; // s between location samples
const BIRD_KINDS = new Set(['park', 'grass', 'golf', 'wood']);
const STREET_USES = ['market', 'rank', 'street', 'park'];
// Peak gain of each real street recording (all four are loudness-matched to -20 LUFS).
// rank-entumbane is mono and ~3 dB denser than the others, hence its lower gain.
const STREET_GAIN = { market: 0.5, rank: 0.4, park: 0.3, street: 0.42 };
const PARK_LOWPASS = 1500; // Hz: the service is heard from across the park, not from its front row
const STREET_DAY = 0.35; // share of the evening level the Park Lane recording keeps by day
const VOICE_DUCK = 0.6; // voice-like beds (recordings, chatter) dip to this while someone nearby speaks
const TRAFFIC_DUCK = 0.8; // ... and the traffic rumble to this

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Glide an AudioParam towards v. Clears whatever is still scheduled from `now` on first, so repeated
// calls never pile up events or overlap (safe on frame hitches, while the context is suspended, or
// when game time runs ahead of the audio clock: everything is timed on ctx.currentTime).
export function glide(param, v, now, tc) {
  if (!Number.isFinite(v) || !Number.isFinite(now)) return;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(v, now, tc);
}

// 0..1 weight of the Park Lane evening recording by hour: people walking to their kombis while the
// City Presbyterian choir sings (peaks 17:30-20:00, a trace late at night, quiet by day).
function eveningWeight(h) {
  h = ((h % 24) + 24) % 24;
  if (h < 5) return 0.3;
  if (h < 6) return 0.3 * (6 - h);
  if (h < 15.5) return 0;
  if (h < 17.5) return smooth((h - 15.5) / 2);
  if (h < 20) return 1;
  if (h < 23) return 1 - 0.7 * smooth((h - 20) / 3);
  return 0.3;
}

// Continuous beds, all driven from AudioManager.update():
//   crowd    real Shona street chatter (audio/crowd_loop.mp3), cross-faded loop, level from npcs
//   traffic  synthesized distant rumble + tyre hiss with a slow swell, level from traffic
//   city     quiet always-on pink-noise bed, rare distant horns, doves / bulbuls (crickets at night) in parks
//   street   four real recordings from Zimbabwe (audio/extras.json), blended by where the player is
//            (SoundZones): 'rank' near kombi ranks, 'market' at markets / First Street Mall / vendor
//            clusters, 'park' in the parks (daytime, low-passed), 'street' in the CBD (evening-weighted)
//   wind     tracks the player's speed (roars when diving), louder with altitude (on the sfx bus)
// Ground-level beds fade out with altitude, wind takes over. Beds dip a little under nearby voices.
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
    this.zones = new SoundZones(audio.game.data, () => audio.game.npcs?.vendors?.stalls);
    this.zone = { rank: 0, market: 0, park: 0, street: 0 };
    this._zoneT = 0;
    this.street = {}; // use -> {gain, input, loop, id}
    this._tod = { rank: 1, market: 1, park: 1, street: 1 };
    this.debug = { zone: this.zone, gains: {} };
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

    // Street recordings: one gain per use (the park one behind a low-pass); sources join once decoded.
    for (const use of STREET_USES) {
      const gain = gainNode(ctx, 0);
      let input = gain;
      if (use === 'park') {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = PARK_LOWPASS;
        lp.Q.value = 0.5;
        lp.connect(gain);
        input = lp;
      }
      gain.connect(ambience);
      this.street[use] = { gain, input, loop: null };
    }
  }

  // entries: extras.json ambience list. Decoded one after another (at decodeRate, 0 = context rate;
  // mono: fold stereo recordings down to save memory on phones). The first entry per use wins.
  async loadStreet(entries, decodeRate, mono) {
    const seen = new Set();
    for (const e of entries) {
      const slot = this.street[e.use];
      if (!slot || seen.has(e.use)) continue;
      seen.add(e.use);
      try {
        let buffer = await fetchAudioBuffer(this.ctx, resolveAudioUrl(e.url), decodeRate);
        if (mono && buffer.numberOfChannels > 1) buffer = downmix(this.ctx, buffer);
        // A seamless loop whose decoded length matches the manifest loops natively (sample-exact);
        // anything else (encoder padding kept by this browser) gets short overlapping cross-fades.
        const exact = e.loop !== false && Number.isFinite(e.dur) && Math.abs(buffer.duration - e.dur) < 0.03;
        slot.loop = exact ? new NativeLoop(this.ctx, buffer, slot.input) : new CrossfadeLoop(this.ctx, buffer, slot.input, null, 0.25);
        slot.id = e.id;
      } catch (err) {
        console.warn(`[audio] street ambience '${e.id || e.use}' unavailable:`, err.message);
      }
    }
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
    for (const use of STREET_USES) this.street[use].loop?.tick?.();
    this._paramT += dt;
    this._zoneT -= dt;
    if (this._paramT < PARAM_RATE) return;
    const step = this._paramT;
    this._paramT = 0;

    const game = this.audio.game;
    const now = this.ctx.currentTime;
    const set = (param, v, tc = 0.25) => glide(param, v, now, tc);
    const p = player?.position;
    const alt = p?.y ?? 0;
    const high = clamp01((alt - 8) / 90); // 0 at street level, 1 high above the rooftops
    const ground = this.paused ? 0.3 : 1 - 0.85 * high;
    const zone = this._sampleZones(p);
    // Someone nearby is talking: let their voice through.
    const speaking = this.audio.voicesActive > 0 && !this.paused;
    const duck = speaking ? VOICE_DUCK : 1;

    // The real rank / market recordings already carry a crowd: thin the FLEURS chatter under them.
    const crowdShare = 1 - 0.3 * Math.max(zone.rank, zone.market);
    set(this.crowdGain.gain, this.targets.crowd * 0.9 * ground * crowdShare * duck, 0.6);
    set(this.trafficGain.gain, this.targets.traffic * 0.55 * (this.paused ? 0.3 : 1 - 0.65 * high) * (speaking ? TRAFFIC_DUCK : 1), 0.6);
    set(this.bedGain.gain, (0.08 + 0.06 * this.targets.traffic) * (this.paused ? 0.4 : 1 - 0.5 * high), 0.8);
    this._streetGains(set, zone, p, duck, game);

    const speed = this.paused ? 0 : (player?.speed ?? player?.velocity?.length() ?? 0);
    const v = Math.min(1.4, speed / 40);
    const diving = !this.paused && player?.state === 'dive';
    set(this.windGain.gain, this.paused ? 0 : 0.015 + 0.06 * high + 0.42 * v * v + (diving ? 0.18 : 0), 0.12);
    set(this.windBand.frequency, 320 + 950 * Math.min(1, v) + (diving ? 400 : 0), 0.12);
    set(this.whistleGain.gain, diving || v > 0.85 ? 0.05 + 0.1 * Math.max(0, v - 0.6) : 0, 0.2);

    if (this.paused || !player) return;
    this._cityEvents(step, player, high);
  }

  _sampleZones(p) {
    if (p && this._zoneT <= 0) {
      this._zoneT = ZONE_RATE;
      const z = this.zones.sample(p.x, p.z);
      Object.assign(this.zone, z);
    }
    return this.zone;
  }

  // Street recordings: zone weight x time of day x height above the street (quiet up high, where the
  // wind takes over) x voice duck.
  _streetGains(set, zone, p, duck, game) {
    const sky = game.sky;
    const night = clamp01(sky?.nightFactor ?? 0);
    const hour = Number.isFinite(sky?.timeOfDay) ? sky.timeOfDay : 12;
    const groundY = p ? (game.city?.heightAt?.(p.x, p.z) ?? 0) : 0;
    const above = p ? Math.max(0, p.y - (Number.isFinite(groundY) ? groundY : 0)) : 0;
    const low = this.paused ? 0.3 : Math.max(0.03, 1 - smooth((above - 3) / 62));
    const tod = this._tod;
    tod.rank = 1 - 0.5 * night;
    tod.market = 1 - 0.75 * night;
    tod.park = 1 - night; // the open-air service is a daytime thing
    tod.street = STREET_DAY + (1 - STREET_DAY) * eveningWeight(hour);
    const gains = this.debug.gains;
    for (const use of STREET_USES) {
      const slot = this.street[use];
      const g = slot.loop ? STREET_GAIN[use] * zone[use] * tod[use] * low * duck : 0;
      gains[use] = Math.round(g * 1000) / 1000;
      set(slot.gain.gain, g, 0.9);
    }
    gains.low = Math.round(low * 100) / 100;
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
  constructor(ctx, buffer, dest, region, maxFade = 1.5) {
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
    this.fade = Math.min(maxFade, len / 4);
    this.next = null;
    this.offset = this.start + Math.random() * (len - this.fade * 2); // begin somewhere mid-loop
  }

  tick() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (this.next === null || this.next < now) this.next = now + 0.05;
    while (this.next < now + 1) {
      const t = this.next;
      const len = Math.max(this.fade * 2, this.end - this.offset);
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

// A sample-exact seamless loop: one looping source, started at a random point so the beds never
// line up with each other. No scheduling, so nothing to go wrong on hitches.
class NativeLoop {
  constructor(ctx, buffer, dest) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = buffer.duration;
    src.connect(dest);
    src.start(ctx.currentTime + 0.05, Math.random() * buffer.duration);
    this.src = src;
  }
}

// Stereo -> mono copy (halves the memory of a decoded bed).
function downmix(ctx, buffer) {
  const n = buffer.numberOfChannels;
  const out = ctx.createBuffer(1, buffer.length, buffer.sampleRate);
  const dst = out.getChannelData(0);
  for (let c = 0; c < n; c++) {
    const src = buffer.getChannelData(c);
    for (let i = 0; i < src.length; i++) dst[i] += src[i] / n;
  }
  return out;
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
