import * as THREE from 'three';
import { createSkyDome, createStars } from './skyDome.js';
import { CityEnvironment } from './render/environment.js';

// Sky + lighting for Harare (lat -17.83 S, lon 31.05 E) on a late-September day (27 Sep 2026:
// solar declination -1.7 deg, solar noon 11:47 CAT, sunrise 05:41, sunset 17:53). The moon is
// one day past full, so it rises in the east just after dusk.
//
// Public: sun (DirectionalLight, follows the player: the sun by day, the moon at night), hemi,
// setTimeOfDay(hours), timeOfDay, isNight, nightFactor (0..1), sunDirection / moonDirection (unit
// vectors towards them, may point below the horizon), lightDirection (towards the current key
// light), palette {zenith, horizon, ground, version} (linear Colors, for glass reflections),
// environment (the PMREM in scene.environment: image-based light for every PBR material).

const LAT = (-17.83 * Math.PI) / 180;
const SUN_DECL = (-1.7 * Math.PI) / 180;
const SOLAR_NOON = 11.783;
const MOON_DECL = (3 * Math.PI) / 180;
const MOON_TRANSIT = 24.6;
const CYCLE = [
  [7, 'Morning'],
  [10.5, 'Late morning'],
  [13, 'Midday'],
  [17.75, 'Golden hour'],
  [19.25, 'Evening'],
  [22, 'Night'],
];

// Keyed by sun elevation (degrees). Colours are display sRGB.
// The sky (hemisphere) fill is kept game-bright rather than photometric: shaded walls stay readable
// at golden hour, and at night the city reads as blue-grey masses under the moon and the glow of
// the CBD instead of black cut-outs (ACES crushes anything below ~0.02 linear to black).
const KEYS = [
  { el: 60, zenith: '#5a8ecf', horizon: '#d3d5cf', fog: '#cdcbc0', glow: '#fff3da', hemiSky: '#c3d6ee', hemiGround: '#a08868', hemi: 1.6, sun: '#fff3e2', sunI: 2.75 },
  { el: 30, zenith: '#6192cf', horizon: '#d8d7cc', fog: '#d0cdbf', glow: '#ffeccc', hemiSky: '#c3d4e8', hemiGround: '#9e8566', hemi: 1.55, sun: '#ffefd8', sunI: 2.6 },
  { el: 12, zenith: '#6d97cb', horizon: '#e3d6bd', fog: '#d8ceb8', glow: '#ffd9a8', hemiSky: '#c9d3df', hemiGround: '#9a8066', hemi: 1.4, sun: '#ffe2b8', sunI: 2.45 },
  { el: 5, zenith: '#6a88bd', horizon: '#ebbf93', fog: '#d6b99a', glow: '#ffb070', hemiSky: '#cdc6cc', hemiGround: '#8e705a', hemi: 1.22, sun: '#ffbd80', sunI: 2.0 },
  { el: 0, zenith: '#4d6399', horizon: '#ee9868', fog: '#c38f74', glow: '#ff8040', hemiSky: '#b6a8bc', hemiGround: '#6e5648', hemi: 1.02, sun: '#ff8a4a', sunI: 1.1 },
  { el: -4, zenith: '#2b3666', horizon: '#a8695c', fog: '#735657', glow: '#d06040', hemiSky: '#7a7c9e', hemiGround: '#3e3430', hemi: 1.35, sun: '#ff7040', sunI: 0 },
  { el: -9, zenith: '#131b3a', horizon: '#46374a', fog: '#352d3c', glow: '#503040', hemiSky: '#5e6a9a', hemiGround: '#342c28', hemi: 1.9, sun: '#000000', sunI: 0 },
  { el: -16, zenith: '#070b1c', horizon: '#2a2230', fog: '#1f1b25', glow: '#1a1418', hemiSky: '#6a78a8', hemiGround: '#3a332e', hemi: 2.4, sun: '#000000', sunI: 0 },
];

const MOON_COLOR = new THREE.Color('#9fb4dc');
const COLOR_KEYS = ['zenith', 'horizon', 'fog', 'glow', 'hemiSky', 'hemiGround', 'sun'];

// Unit vector towards a body with declination `decl` that transits at `transit` hours (local
// time), from Harare's latitude. Azimuth measured from north through east. Returns elevation (rad).
function celestial(hours, decl, transit, out) {
  const H = ((hours - transit) * 15 * Math.PI) / 180;
  const el = Math.asin(Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(decl) * Math.cos(LAT) - Math.sin(LAT) * Math.cos(H));
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  return el;
}

// Keyframe colours pre-parsed as raw display values (interpolated in sRGB, no colour management).
for (const k of KEYS) {
  for (const f of COLOR_KEYS) k[f] = new THREE.Color().setStyle(k[f], THREE.LinearSRGBColorSpace);
}

function lerpKey(el, field, out) {
  let i = 0;
  while (i < KEYS.length - 1 && KEYS[i + 1].el > el) i++;
  const k0 = KEYS[i];
  const k1 = KEYS[Math.min(i + 1, KEYS.length - 1)];
  const t = k0 === k1 ? 0 : THREE.MathUtils.clamp((k0.el - el) / (k0.el - k1.el), 0, 1);
  const v0 = k0[field];
  const v1 = k1[field];
  if (typeof v0 === 'number') return v0 + (v1 - v0) * t;
  return out.copy(v0).lerp(v1, t);
}

export class Sky {
  constructor() {
    this.timeOfDay = 10.5;
    this.isNight = false;
    this.nightFactor = 0;
    this.sunDirection = new THREE.Vector3(0, 1, 0);
    this.moonDirection = new THREE.Vector3();
    this.lightDirection = new THREE.Vector3(0, 1, 0);
    this.palette = { zenith: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(), version: 0 };
    this._raw = { zenith: new THREE.Color(), horizon: new THREE.Color(), fog: new THREE.Color(), glow: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), sun: new THREE.Color() };
    this._tween = null;
    this._focus = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._u = new THREE.Vector3();
  }

  async init(game) {
    this.game = game;
    const q = game.quality;
    const scene = game.scene;
    this.drawDistance = q.drawDistance || 2500;
    scene.fog = new THREE.Fog('#cdcbc0', 150, this.drawDistance);
    scene.background = new THREE.Color('#cdcbc0');

    this.hemi = new THREE.HemisphereLight('#c3d6ee', '#a08868', 1.1);
    scene.add(this.hemi);

    const sun = new THREE.DirectionalLight('#fff3e2', 3);
    sun.castShadow = !!q.shadows;
    const size = q.level === 'high' ? 110 : 75;
    this.shadowSize = size;
    if (sun.castShadow) {
      sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      Object.assign(sun.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: 1, far: 900 });
      sun.shadow.bias = -0.0003;
      sun.shadow.normalBias = 0.05 + (size * 2) / q.shadowMapSize;
    }
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    this.dome = createSkyDome(game.camera.far * 0.9);
    this.stars = createStars(game.camera.far * 0.85);
    scene.add(this.dome.mesh);
    scene.add(this.stars.mesh);
    // Image-based lighting: the sky + HDRI street environment (render/environment.js).
    this.env = new CityEnvironment(game.renderer, q);
    await this.env.load(game.assets);
    this.setTimeOfDay(this.timeOfDay);
  }

  // Rebuilds the PMREM environment when the hour moved (throttled while the T-key tween runs).
  _updateEnv(force = false) {
    if (!this.env) return;
    const tex = this.env.update(this, this._raw, this.nightFactor, force);
    const scene = this.game.scene;
    if (tex && scene.environment !== tex) scene.environment = tex;
    // The environment replaces most of the hemisphere fill by day; at night the tuned blue-grey
    // hemisphere keeps the city readable (the night sky itself is nearly black).
    scene.environmentIntensity = this.envIntensity;
  }

  // Jumps to a time of day (settings slider, ?time=): cancels any running T-key transition.
  setTimeOfDay(hours) {
    if (!Number.isFinite(hours)) return;
    this._tween = null;
    this._apply(hours);
  }

  _apply(hours) {
    const h = ((hours % 24) + 24) % 24;
    this.timeOfDay = h;
    const el = THREE.MathUtils.radToDeg(celestial(h, SUN_DECL, SOLAR_NOON, this.sunDirection));
    celestial(h, MOON_DECL, MOON_TRANSIT, this.moonDirection);
    const raw = this._raw;
    for (const k of COLOR_KEYS) lerpKey(el, k, raw[k]);
    const hemiI = lerpKey(el, 'hemi');
    const sunI = lerpKey(el, 'sunI');

    this.nightFactor = THREE.MathUtils.smoothstep(-el, -4, 10);
    this.isNight = el < -6;
    const moonUp = THREE.MathUtils.smoothstep(this.moonDirection.y, -0.02, 0.15);
    const moonLight = this.nightFactor * moonUp;

    // Directional light: the sun by day, the moon at night.
    const light = this.lightDirection;
    if (sunI > 0.05 || moonLight < 0.05) {
      light.copy(this.sunDirection);
      if (light.y < 0.05) light.y = 0.05;
      this.sun.color.setRGB(raw.sun.r, raw.sun.g, raw.sun.b, THREE.SRGBColorSpace);
      this.sun.intensity = sunI;
    } else {
      light.copy(this.moonDirection);
      this.sun.color.copy(MOON_COLOR);
      this.sun.intensity = 0.75 * moonLight;
    }
    light.normalize();
    this.hemi.color.setRGB(raw.hemiSky.r, raw.hemiSky.g, raw.hemiSky.b, THREE.SRGBColorSpace);
    this.hemi.groundColor.setRGB(raw.hemiGround.r, raw.hemiGround.g, raw.hemiGround.b, THREE.SRGBColorSpace);
    // Share of the hemisphere fill kept next to the image-based light.
    const hemiKeep = THREE.MathUtils.lerp(0.35, 1.0, this.nightFactor);
    this.hemi.intensity = hemiI * (this.env ? hemiKeep : 1);
    this.envIntensity = THREE.MathUtils.lerp(1.0, 0.6, this.nightFactor);

    const scene = this.game.scene;
    scene.fog.color.setRGB(raw.fog.r, raw.fog.g, raw.fog.b, THREE.SRGBColorSpace);
    scene.background.copy(scene.fog.color);
    scene.fog.near = THREE.MathUtils.lerp(150, 60, this.nightFactor);
    scene.fog.far = this.drawDistance * THREE.MathUtils.lerp(1, 0.7, this.nightFactor);
    this.game.renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 1.25, this.nightFactor);

    this._placeLight();
    this.dome.setState(this.sunDirection, this.moonDirection, raw, this.nightFactor, moonUp);
    this.stars.material.uniforms.uAlpha.value = THREE.MathUtils.smoothstep(this.nightFactor, 0.55, 1);

    const pal = this.palette;
    pal.zenith.setRGB(raw.zenith.r, raw.zenith.g, raw.zenith.b, THREE.SRGBColorSpace).multiplyScalar(1.15);
    pal.horizon.setRGB(raw.horizon.r, raw.horizon.g, raw.horizon.b, THREE.SRGBColorSpace).multiplyScalar(1.1);
    pal.ground.setRGB(raw.hemiGround.r, raw.hemiGround.g, raw.hemiGround.b, THREE.SRGBColorSpace).multiplyScalar(0.6);
    pal.version++;
    if (this.env && !this._tween) this._updateEnv();
    this.game.city?.setNight?.(this.nightFactor);
  }

  _cycle() {
    const now = (this._tween ? this._tween.to : this.timeOfDay) % 24;
    const next = CYCLE.find(([h]) => h > now + 0.01) || CYCLE[0];
    const from = this.timeOfDay;
    let to = next[0];
    if (to < from) to += 24;
    this._tween = { from, to, t: 0, dur: Math.min(2.2, 0.6 + (to - from) * 0.18) };
    const hh = Math.floor(next[0]);
    const mm = Math.round((next[0] - hh) * 60);
    const label = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${next[1]}`;
    this.game.hud?.toast?.(label, 1800);
  }

  update(dt, game) {
    if (game.input.pressed('time')) this._cycle();
    const tw = this._tween;
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const k = tw.t * tw.t * (3 - 2 * tw.t);
      this._apply(tw.from + (tw.to - tw.from) * k);
      if (tw.t >= 1) this._tween = null;
    }

    // During a time-of-day transition, refresh the environment a few times a second.
    this._envClock = (this._envClock || 0) + dt;
    if (tw && this._envClock > 0.25) {
      this._envClock = 0;
      this._updateEnv();
    } else if (!tw && this.env?.dirty) {
      this._updateEnv(true);
    }
    if (!tw && this._wasTween) this._updateEnv(true);
    this._wasTween = !!tw;

    const cam = game.camera;
    this.dome.mesh.position.copy(cam.position);
    this.stars.mesh.position.copy(cam.position);
    this._placeLight();
  }

  // Centres the key light's shadow frustum a little ahead of the player (where the camera looks),
  // snapped to shadow-map texels so the shadows don't swim.
  _placeLight() {
    const cam = this.game.camera;
    const focus = this._focus.copy(this.game.player?.position || cam.position);
    const fwd = cam.getWorldDirection(this._r);
    const flat = Math.hypot(fwd.x, fwd.z);
    if (flat > 1e-3) focus.addScaledVector(fwd.set(fwd.x / flat, 0, fwd.z / flat), this.shadowSize * 0.4);
    const sun = this.sun;
    const dir = this.lightDirection;
    if (sun.castShadow) {
      const texel = (this.shadowSize * 2) / sun.shadow.mapSize.x;
      const r = this._r.set(0, 1, 0).cross(dir);
      if (r.lengthSq() < 1e-6) r.set(1, 0, 0);
      r.normalize();
      const u = this._u.copy(dir).cross(r).normalize();
      const a = focus.dot(r);
      const b = focus.dot(u);
      focus.addScaledVector(r, Math.round(a / texel) * texel - a).addScaledVector(u, Math.round(b / texel) * texel - b);
    }
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(dir, 450);
    sun.target.updateMatrixWorld();
  }
}
