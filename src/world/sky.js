import * as THREE from 'three';
import { createSkyDome, createStars } from './skyDome.js';

// Sky + lighting for Harare (lat -17.83 S, lon 31.05 E) on a late-September day (27 Sep 2026:
// solar declination -1.7 deg, solar noon 11:47 CAT, sunrise 05:41, sunset 17:53). The moon is
// one day past full, so it rises in the east just after dusk.
//
// Public: sun (DirectionalLight, follows the player), hemi, setTimeOfDay(hours), timeOfDay,
// isNight, nightFactor (0..1), sunDirection (unit Vector3 towards the sun, or the moon at night),
// palette {zenith, horizon, ground (linear Colors), version} for reflections.

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
const KEYS = [
  { el: 60, zenith: '#5a8ecf', horizon: '#d3d5cf', fog: '#cdcbc0', glow: '#fff3da', hemiSky: '#c3d6ee', hemiGround: '#a08868', hemi: 1.15, sun: '#fff3e2', sunI: 3.1 },
  { el: 30, zenith: '#6192cf', horizon: '#d8d7cc', fog: '#d0cdbf', glow: '#ffeccc', hemiSky: '#c3d4e8', hemiGround: '#9e8566', hemi: 1.08, sun: '#ffefd8', sunI: 2.9 },
  { el: 12, zenith: '#6d97cb', horizon: '#e3d6bd', fog: '#d8ceb8', glow: '#ffd9a8', hemiSky: '#c9d3df', hemiGround: '#9a8066', hemi: 0.95, sun: '#ffe2b8', sunI: 2.6 },
  { el: 5, zenith: '#6a88bd', horizon: '#ebbf93', fog: '#d6b99a', glow: '#ffb070', hemiSky: '#c8c2c4', hemiGround: '#8a6c56', hemi: 0.78, sun: '#ffbd80', sunI: 2.0 },
  { el: 0, zenith: '#4d6399', horizon: '#ee9868', fog: '#c38f74', glow: '#ff8040', hemiSky: '#a99cae', hemiGround: '#665044', hemi: 0.56, sun: '#ff8a4a', sunI: 0.9 },
  { el: -4, zenith: '#2b3666', horizon: '#a8695c', fog: '#735657', glow: '#d06040', hemiSky: '#666a8a', hemiGround: '#3a302c', hemi: 0.36, sun: '#ff7040', sunI: 0 },
  { el: -9, zenith: '#131b3a', horizon: '#46374a', fog: '#352d3c', glow: '#503040', hemiSky: '#3a4262', hemiGround: '#221c1c', hemi: 0.24, sun: '#000000', sunI: 0 },
  { el: -16, zenith: '#060916', horizon: '#1d1a24', fog: '#18161d', glow: '#1a1418', hemiSky: '#253052', hemiGround: '#141110', hemi: 0.17, sun: '#000000', sunI: 0 },
];

const MOON_COLOR = new THREE.Color('#9fb4dc');

function celestial(hours, decl, transit) {
  const H = ((hours - transit) * 15 * Math.PI) / 180;
  const sinEl = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(-Math.sin(H), Math.tan(decl) * Math.cos(LAT) - Math.sin(LAT) * Math.cos(H));
  return { el, az };
}

function dirFrom({ el, az }, out) {
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

const _a = new THREE.Color();
const _b = new THREE.Color();

function lerpKey(el, field, out) {
  let i = 0;
  while (i < KEYS.length - 1 && KEYS[i + 1].el > el) i++;
  const k0 = KEYS[i];
  const k1 = KEYS[Math.min(i + 1, KEYS.length - 1)];
  const t = k0 === k1 ? 0 : THREE.MathUtils.clamp((k0.el - el) / (k0.el - k1.el), 0, 1);
  const v0 = k0[field];
  const v1 = k1[field];
  if (typeof v0 === 'number') return v0 + (v1 - v0) * t;
  // Interpolate display colours in sRGB, stored raw (no colour management).
  _a.setStyle(v0, THREE.LinearSRGBColorSpace);
  _b.setStyle(v1, THREE.LinearSRGBColorSpace);
  return out.copy(_a).lerp(_b, t);
}

export class Sky {
  constructor() {
    this.timeOfDay = 10.5;
    this.isNight = false;
    this.nightFactor = 0;
    this.sunDirection = new THREE.Vector3(0, 1, 0);
    this.moonDirection = new THREE.Vector3();
    this.palette = { zenith: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(), version: 0 };
    this._sunDir = new THREE.Vector3();
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
    this.setTimeOfDay(this.timeOfDay);
  }

  setTimeOfDay(hours) {
    const h = ((hours % 24) + 24) % 24;
    this.timeOfDay = h;
    const sunPos = celestial(h, SUN_DECL, SOLAR_NOON);
    const moonPos = celestial(h, MOON_DECL, MOON_TRANSIT);
    dirFrom(sunPos, this._sunDir);
    dirFrom(moonPos, this.moonDirection);
    const el = THREE.MathUtils.radToDeg(sunPos.el);
    const raw = this._raw;
    for (const k of ['zenith', 'horizon', 'fog', 'glow', 'hemiSky', 'hemiGround', 'sun']) lerpKey(el, k, raw[k]);
    const hemiI = lerpKey(el, 'hemi');
    const sunI = lerpKey(el, 'sunI');

    this.nightFactor = THREE.MathUtils.smoothstep(-el, -4, 10);
    this.isNight = el < -6;
    const moonUp = THREE.MathUtils.smoothstep(this.moonDirection.y, -0.02, 0.15);
    const moonLight = this.nightFactor * moonUp;

    // Directional light: the sun by day, the moon at night.
    if (sunI > 0.05 || moonLight < 0.05) {
      this.sunDirection.copy(this._sunDir);
      if (this.sunDirection.y < 0.05) this.sunDirection.y = 0.05;
      this.sun.color.setRGB(raw.sun.r, raw.sun.g, raw.sun.b, THREE.SRGBColorSpace);
      this.sun.intensity = sunI;
    } else {
      this.sunDirection.copy(this.moonDirection);
      this.sun.color.copy(MOON_COLOR);
      this.sun.intensity = 0.45 * moonLight;
    }
    this.sunDirection.normalize();
    this.hemi.color.setRGB(raw.hemiSky.r, raw.hemiSky.g, raw.hemiSky.b, THREE.SRGBColorSpace);
    this.hemi.groundColor.setRGB(raw.hemiGround.r, raw.hemiGround.g, raw.hemiGround.b, THREE.SRGBColorSpace);
    this.hemi.intensity = hemiI;

    const scene = this.game.scene;
    scene.fog.color.setRGB(raw.fog.r, raw.fog.g, raw.fog.b, THREE.SRGBColorSpace);
    scene.background.copy(scene.fog.color);
    scene.fog.near = THREE.MathUtils.lerp(150, 60, this.nightFactor);
    scene.fog.far = this.drawDistance * THREE.MathUtils.lerp(1, 0.7, this.nightFactor);
    this.game.renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 1.35, this.nightFactor);

    this.dome.setState(this._sunDir, this.moonDirection, raw, this.nightFactor, moonUp);
    this.stars.material.uniforms.uAlpha.value = THREE.MathUtils.smoothstep(this.nightFactor, 0.55, 1);

    const pal = this.palette;
    pal.zenith.setRGB(raw.zenith.r, raw.zenith.g, raw.zenith.b, THREE.SRGBColorSpace).multiplyScalar(1.15);
    pal.horizon.setRGB(raw.horizon.r, raw.horizon.g, raw.horizon.b, THREE.SRGBColorSpace).multiplyScalar(1.1);
    pal.ground.setRGB(raw.hemiGround.r, raw.hemiGround.g, raw.hemiGround.b, THREE.SRGBColorSpace).multiplyScalar(0.35);
    pal.version++;
    this.game.city?.setNight?.(this.nightFactor);
  }

  _cycle() {
    const now = this._tween ? this._tween.to : this.timeOfDay;
    let next = CYCLE.find(([h]) => h > now + 0.01) || CYCLE[0];
    const from = this.timeOfDay;
    let to = next[0];
    if (to < from) to += 24;
    this._tween = { from, to, t: 0, dur: Math.min(3, 0.8 + (to - from) * 0.25) };
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
      this.setTimeOfDay(tw.from + (tw.to - tw.from) * k);
      if (tw.t >= 1) this._tween = null;
    }

    const cam = game.camera;
    this.dome.mesh.position.copy(cam.position);
    this.stars.mesh.position.copy(cam.position);

    // Shadow frustum centred ahead of the player, snapped to shadow-map texels so it doesn't swim.
    const focus = this._focus.copy(game.player?.position || cam.position);
    const sun = this.sun;
    const dir = this.sunDirection;
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
