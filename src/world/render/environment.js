import * as THREE from 'three';

// Image-based lighting for every PBR material (scene.environment). The environment is rendered
// into a PMREM from a tiny scene: the procedural sky of skyDome.js above the horizon (same palette,
// so reflections match the sky you see, sunsets included) and, below it, the street, trees and
// low-rise blocks of the CC0 HDRI (public/textures/env, "Wide Street 01"), rotated so its sunlit side
// faces the game sun and tinted / dimmed by the time of day. The shader writes a 512 x 256
// equirectangular half-float target, converted by PMREMGenerator.fromEquirectangular into a reused
// cube-UV target. Rebuilt when the time of day moves (a fraction of a millisecond of GPU work).
// Phones ('low'): the HDRI alone, converted once, faded by night.

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uHdr;
uniform float uHdrOn;
uniform float uHdrRot;
uniform vec3 uHdrTint;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uGlow;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform float uSunVis;
uniform float uNight;
uniform float uScale;
varying vec2 vUv;

vec3 toLin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

void main() {
  // Equirectangular direction (inverse of three's equirectUv).
  float phi = (vUv.x - 0.5) * 6.2831853;
  float th = (vUv.y - 0.5) * 3.1415927;
  vec3 d = vec3(cos(th) * cos(phi), sin(th), cos(th) * sin(phi));
  float y = d.y;
  // Sky (display colours of the dome, decoded to linear radiance).
  float t = pow(clamp(y, 0.0, 1.0), 0.42);
  vec3 sky = mix(uHorizon, uZenith, t);
  sky = mix(sky, uFog, exp(-max(y, 0.0) * 20.0));
  float fwd = max(dot(d, uSunDir), 0.0);
  sky += uGlow * (pow(fwd, 5.0) * 0.28 + pow(fwd, 48.0) * 0.45) * uSunVis;
  vec3 col = toLin(sky);
  // The HDRI supplies what surrounds a street: asphalt below the horizon, buildings and trees up to
  // ~35 deg. Its own sky is replaced by the procedural one (so reflections follow the hour).
  vec3 ground = toLin(uGround);
  float skyW = smoothstep(-0.02, 0.1, y);
  vec3 near = ground;
  if (uHdrOn > 0.5) {
    float c = cos(uHdrRot);
    float s = sin(uHdrRot);
    vec3 r = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
    vec2 uv = vec2(atan(r.z, r.x) * 0.15915494 + 0.5, asin(clamp(r.y, -1.0, 1.0)) * 0.31830988 + 0.5);
    vec3 h = min(texture2D(uHdr, uv).rgb, vec3(4.0));
    // Blue-dominant pixels of the HDRI are its sky.
    float blue = (h.b - h.r) / (h.b + h.r + 1e-3);
    float hSky = smoothstep(0.18, 0.34, blue) * step(0.0, y);
    near = h * uHdrTint;
    skyW = y < 0.0 ? 0.0 : max(hSky, smoothstep(0.45, 0.62, y));
  }
  // Haze: distant things take the colour of the horizon air.
  near = mix(near, toLin(uFog) * mix(1.0, 0.75, uNight), 0.25 * (1.0 - smoothstep(0.0, 0.3, abs(y))));
  col = mix(near, col, skyW);
  // City glow at night: sodium / LED light scattered in the haze low over the CBD.
  col += vec3(0.05, 0.032, 0.018) * uNight * (1.0 - smoothstep(-0.05, 0.35, abs(y)));
  gl_FragColor = vec4(col * uScale, 1.0);
}`;

export class CityEnvironment {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.low = quality.level === 'low';
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.equirect = new THREE.WebGLRenderTarget(512, 256, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false,
    });
    this.uniforms = {
      uHdr: { value: null },
      uHdrOn: { value: 0 },
      uHdrRot: { value: 0 },
      uHdrTint: { value: new THREE.Color(1, 1, 1) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunVis: { value: 1 },
      uNight: { value: 0 },
      uScale: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, depthWrite: false, depthTest: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.target = null;
    this.texture = null;
    this.hdrSun = new THREE.Vector3(0.488, 0.798, 0.355);
    this._last = { t: -99, night: -1 };
    this.dirty = true;
    this.builds = 0;
  }

  // Loads the HDRI (through the shared asset loader). Safe to skip: the sky alone still lights.
  async load(assets) {
    try {
      const [hdr, meta] = await Promise.all([assets.hdr('textures/env/harare_day_ibl_1k.hdr'), assets.json('textures/env/env.json')]);
      if (meta?.sunInSource?.threeDirectionDefaultMapping) this.hdrSun.fromArray(meta.sunInSource.threeDirectionDefaultMapping);
      hdr.minFilter = THREE.LinearFilter;
      hdr.magFilter = THREE.LinearFilter;
      hdr.generateMipmaps = false;
      this.hdr = hdr;
      this.uniforms.uHdr.value = hdr;
      this.uniforms.uHdrOn.value = 1;
      if (this.low) {
        // Phones: one PMREM of the HDRI itself (sky included), faded by night.
        this.lowTexture = this.pmrem.fromEquirectangular(hdr).texture;
      }
    } catch (err) {
      console.warn('[sky] HDRI unavailable, sky-only environment', err);
    }
  }

  // raw: the sky's display-referred palette (zenith, horizon, fog, glow, hemiGround); night 0..1.
  update(sky, raw, night, force = false) {
    const u = this.uniforms;
    if (this.low && this.lowTexture) {
      this.texture = this.lowTexture;
      return this.texture;
    }
    const t = sky.timeOfDay;
    const dt = Math.abs(t - this._last.t);
    if (!force && !this.dirty && Math.min(dt, 24 - dt) < 0.1 && Math.abs(night - this._last.night) < 0.03) return this.texture;
    this._last.t = t;
    this._last.night = night;
    this.dirty = false;
    u.uZenith.value.copy(raw.zenith);
    u.uHorizon.value.copy(raw.horizon);
    u.uFog.value.copy(raw.fog);
    u.uGlow.value.copy(raw.glow);
    u.uGround.value.copy(raw.hemiGround).multiplyScalar(0.8);
    u.uSunDir.value.copy(sky.sunDirection);
    u.uSunVis.value = THREE.MathUtils.smoothstep(sky.sunDirection.y, -0.12, 0.02);
    u.uNight.value = night;
    // Turn the HDRI so its sunlit side faces the game sun (rotation about +Y of the lookup).
    const a = Math.atan2(this.hdrSun.x, this.hdrSun.z) - Math.atan2(sky.sunDirection.x, sky.sunDirection.z);
    u.uHdrRot.value = a;
    // Street tone follows the hour: full by day, warm and dim at dusk, near black at night.
    const g = raw.hemiGround;
    const day = 1 - night;
    u.uHdrTint.value.setRGB(0.55 + 0.45 * g.r, 0.55 + 0.45 * g.g, 0.55 + 0.45 * g.b).multiplyScalar(0.05 + 0.95 * day * day);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const toneMapping = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.equirect);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
    r.toneMapping = toneMapping;
    this.target = this.pmrem.fromEquirectangular(this.equirect.texture, this.target);
    this.texture = this.target.texture;
    this.builds++;
    return this.texture;
  }
}
