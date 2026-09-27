import * as THREE from 'three';
import { makeRng } from '../core/rng.js';

// Sky dome: gradient + dusty horizon haze, sun disc with forward-scattering glow, the moon, and a
// faint ring of distant hills. Outputs display colours directly (no tone mapping) so the horizon
// matches the scene fog colour exactly.
const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uGlow;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uSunVis;
uniform float uMoonVis;
uniform float uNight;
varying vec3 vDir;

float hills(float a) {
  return 0.010 + 0.006 * sin(a * 3.0 + 1.3) + 0.004 * sin(a * 7.0 + 0.4) + 0.003 * sin(a * 17.0 + 2.1) + 0.0015 * sin(a * 41.0);
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float t = pow(clamp(y, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);
  // Dusty haze band hugging the horizon (veld-fire season).
  col = mix(col, uFog, exp(-max(y, 0.0) * 22.0) * 0.75);
  float mu = dot(d, uSunDir);
  float fwd = max(mu, 0.0);
  col += uGlow * (pow(fwd, 5.0) * 0.28 + pow(fwd, 48.0) * 0.45) * uSunVis;
  float disc = smoothstep(0.99975, 0.99988, mu) * uSunVis * smoothstep(-0.02, 0.01, y);
  col = mix(col, vec3(1.0, 0.97, 0.9), disc);
  // Moon (a day past full) with a soft halo.
  float mm = dot(d, uMoonDir);
  col += vec3(0.55, 0.62, 0.75) * pow(max(mm, 0.0), 180.0) * 0.35 * uMoonVis;
  float moon = smoothstep(0.99982, 0.99990, mm) * uMoonVis;
  col = mix(col, vec3(0.93, 0.93, 0.88), moon);
  // Distant hills, hazy.
  float a = atan(d.x, d.z);
  float hz = hills(a);
  col = mix(col, mix(uFog, uZenith * 0.5 + uFog * 0.5, 0.25) * (1.0 - 0.15 * uNight), smoothstep(hz + 0.002, hz - 0.002, y));
  col = mix(col, uFog, smoothstep(0.004, -0.02, y));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSkyDome(radius) {
  const geo = new THREE.SphereGeometry(radius, 48, 24);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
    uniforms: {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunVis: { value: 1 },
      uMoonVis: { value: 0 },
      uNight: { value: 0 },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'skyDome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  const u = mat.uniforms;
  return {
    mesh,
    setState(sunDir, moonDir, raw, night, moonUp) {
      u.uZenith.value.copy(raw.zenith);
      u.uHorizon.value.copy(raw.horizon);
      u.uFog.value.copy(raw.fog);
      u.uGlow.value.copy(raw.glow);
      u.uSunDir.value.copy(sunDir);
      u.uMoonDir.value.copy(moonDir);
      u.uSunVis.value = THREE.MathUtils.smoothstep(sunDir.y, -0.12, 0.02);
      u.uMoonVis.value = moonUp * THREE.MathUtils.smoothstep(night, 0.2, 0.8);
      u.uNight.value = night;
    },
  };
}

// Star field (fixed to the camera like the dome), fades in at night.
export function createStars(radius, count = 1400) {
  const rng = makeRng(77);
  const pos = new Float32Array(count * 3);
  const mag = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const y = Math.pow(rng(), 0.7) * 0.98 + 0.02;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * r * radius;
    pos[i * 3 + 1] = y * radius;
    pos[i * 3 + 2] = Math.sin(a) * r * radius;
    mag[i] = Math.pow(rng(), 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float mag;
      varying float vMag;
      void main() {
        vMag = mag;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
        gl_PointSize = 1.2 + mag * 2.4;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      varying float vMag;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float f = smoothstep(0.5, 0.1, length(c));
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * (0.35 + vMag), f * uAlpha);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Points(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -9;
  return { mesh, material };
}
