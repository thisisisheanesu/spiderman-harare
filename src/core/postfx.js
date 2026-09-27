import * as THREE from 'three';

// Post effects that leave the tuned look alone. The scene still renders straight to the canvas
// (tone mapping, fog, the display-referred sky dome exactly as before); afterwards:
//
//   Ambient occlusion ('medium' / 'high'): a half-resolution normal + depth prepass of the city
//   geometry only (meshes on AO_LAYER: building chunks and ground; about a dozen draw calls, the
//   camera's far plane pulled in to the AO range), a Scalable-Ambient-Obscurance style estimate
//   (12 spiral taps), a depth-aware blur, then one full-screen quad MULTIPLIED onto the finished,
//   tone-mapped frame, faded out with distance (and so with the fog). Characters, vehicles and
//   trees are not occluders, they only receive the occlusion of what stands behind them.
//
//   Glow at night: bright pixels (lit windows, lamps, signs) bleed a soft halo. Built from a copy
//   of the finished frame (threshold near white), so the day look is untouched; skipped entirely
//   while nightFactor is ~0.
//
// renderer.info is accumulated over the whole frame (autoReset off; reset at the start of render()).
// profile = true measures GPU time per pass with EXT_disjoint_timer_query_webgl2 (stats.gpu).

export const AO_LAYER = 7;

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const AO_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform vec2 uTanFov;
uniform float uNear;
uniform float uFar;
uniform float uProjScale;
uniform float uRadius;
uniform float uIntensity;
uniform float uBias;
varying vec2 vUv;

float vz(vec2 uv) { return perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
vec3 vpos(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * uTanFov * -z, z); }

void main() {
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  float z = perspectiveDepthToViewZ(d, uNear, uFar);
  vec3 P = vpos(vUv, z);
  vec3 N = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0);
  float rPx = min(uRadius * uProjScale / -z, 90.0);
  if (rPx < 1.0) { gl_FragColor = vec4(1.0); return; }
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float a0 = ign * 6.2831853;
  float r2 = uRadius * uRadius;
  float occ = 0.0;
  const int N_TAPS = 12;
  for (int i = 0; i < N_TAPS; i++) {
    float t = (float(i) + 0.5) / float(N_TAPS);
    float a = a0 + t * 6.2831853 * 7.0;
    vec2 suv = vUv + vec2(cos(a), sin(a)) * (t * rPx) / uRes;
    if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) continue;
    vec3 S = vpos(suv, vz(suv));
    vec3 v = S - P;
    float vv = dot(v, v);
    float vn = dot(v, N);
    float f = max(r2 - vv, 0.0) / r2;
    occ += f * f * f * max((vn - uBias * -z * 0.01) / (vv + 0.02), 0.0);
  }
  float ao = clamp(1.0 - occ * uIntensity * 4.0 / float(N_TAPS), 0.0, 1.0);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tAO;
uniform sampler2D tDepth;
uniform vec2 uDir;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
void main() {
  float zc = perspectiveDepthToViewZ(texture2D(tDepth, vUv).x, uNear, uFar);
  float sum = 0.0;
  float wsum = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + uDir * float(i);
    float z = perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
    float w = exp(-abs(z - zc) * 12.0 / max(-zc, 1.0)) * (1.0 - abs(float(i)) / 4.5);
    sum += texture2D(tAO, uv).r * w;
    wsum += w;
  }
  gl_FragColor = vec4(vec3(sum / max(wsum, 1e-4)), 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tAO;
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform float uFadeNear;
uniform float uFadeFar;
uniform float uStrength;
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).x;
  float z = -perspectiveDepthToViewZ(d, uNear, uFar);
  float fade = (1.0 - smoothstep(uFadeNear, uFadeFar, z)) * step(d, 0.99999);
  float ao = texture2D(tAO, vUv).r;
  gl_FragColor = vec4(vec3(mix(1.0, ao, fade * uStrength)), 1.0);
}`;

// Glow: threshold + downsample, blur, add.
const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i / 2), float(i - (i / 2) * 2)) - 0.5;
    vec3 s = texture2D(tColor, vUv + o * uTexel).rgb;
    float l = max(max(s.r, s.g), s.b);
    c += s * smoothstep(uThreshold, 1.0, l);
  }
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

const GBLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
  c += texture2D(tSrc, vUv + uDir * 1.385).rgb * 0.316;
  c += texture2D(tSrc, vUv - uDir * 1.385).rgb * 0.316;
  c += texture2D(tSrc, vUv + uDir * 3.231).rgb * 0.070;
  c += texture2D(tSrc, vUv - uDir * 3.231).rgb * 0.070;
  gl_FragColor = vec4(c, 1.0);
}`;

const GLOW_ADD_FRAG = /* glsl */ `
uniform sampler2D tA;
uniform sampler2D tB;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tA, vUv).rgb * 0.6 + texture2D(tB, vUv).rgb * 0.8;
  gl_FragColor = vec4(c * uStrength, 1.0);
}`;

function rt(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false,
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, ...opts,
  });
}

export class PostFX {
  constructor(game) {
    this.game = game;
    this.renderer = game.renderer;
    const level = game.quality?.level || 'high';
    this.aoEnabled = level !== 'low';
    this.glowEnabled = level !== 'low';
    // Tunables.
    this.ao = { radius: 1.6, intensity: 1.15, bias: 0.6, fadeNear: 60, fadeFar: 190, strength: 0.85, range: 200 };
    this.glow = { threshold: 0.82, strength: 0.55 };
    this.profile = false;
    this.stats = { gpu: {}, calls: 0 };

    this.normalMat = new THREE.MeshNormalMaterial();
    this.aoCam = new THREE.PerspectiveCamera();
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    const mat = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
    this.aoMat = mat(AO_FRAG, {
      tNormal: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2() }, uTanFov: { value: new THREE.Vector2() },
      uNear: { value: 0.25 }, uFar: { value: 300 }, uProjScale: { value: 500 }, uRadius: { value: 1.5 }, uIntensity: { value: 1 }, uBias: { value: 0.5 },
    });
    this.blurMat = mat(BLUR_FRAG, { tAO: { value: null }, tDepth: { value: null }, uDir: { value: new THREE.Vector2() }, uNear: { value: 0.25 }, uFar: { value: 300 } });
    this.compMat = mat(COMPOSITE_FRAG, {
      tAO: { value: null }, tDepth: { value: null }, uNear: { value: 0.25 }, uFar: { value: 300 },
      uFadeNear: { value: 60 }, uFadeFar: { value: 190 }, uStrength: { value: 1 },
    }, {
      transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.brightMat = mat(BRIGHT_FRAG, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.8 } });
    this.gblurMat = mat(GBLUR_FRAG, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.glowAddMat = mat(GLOW_ADD_FRAG, { tA: { value: null }, tB: { value: null }, uStrength: { value: 0.5 } }, {
      transparent: true, blending: THREE.AdditiveBlending,
    });
    this.size = new THREE.Vector2();
    this.w = 0;
    this.h = 0;
    this.renderer.info.autoReset = false;
    this._queries = [];
  }

  _resize() {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const W = this.size.x;
    const H = this.size.y;
    if (W === this.fullW && H === this.fullH) return;
    this.fullW = W;
    this.fullH = H;
    // AO at half the CSS resolution (independent of the device pixel ratio).
    const pr = r.getPixelRatio();
    const w = Math.max(64, Math.round((W / pr) * 0.5));
    const h = Math.max(64, Math.round((H / pr) * 0.5));
    this.w = w;
    this.h = h;
    this.prepass?.dispose();
    this.prepass = rt(w, h, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.prepass.depthTexture = new THREE.DepthTexture(w, h);
    this.prepass.depthTexture.type = THREE.UnsignedIntType;
    this.aoA?.dispose();
    this.aoB?.dispose();
    this.aoA = rt(w, h);
    this.aoB = rt(w, h);
    // Glow chain at quarter / eighth resolution of the drawing buffer.
    const gw = Math.max(32, Math.round(W / 4));
    const gh = Math.max(32, Math.round(H / 4));
    this.frameCopy?.dispose();
    this.frameCopy = new THREE.FramebufferTexture(W, H);
    this.frameCopy.minFilter = THREE.LinearFilter;
    this.frameCopy.magFilter = THREE.LinearFilter;
    for (const k of ['g1', 'g2', 'g3', 'g4']) this[k]?.dispose();
    this.g1 = rt(gw, gh);
    this.g2 = rt(gw, gh);
    this.g3 = rt(Math.max(16, gw >> 1), Math.max(16, gh >> 1));
    this.g4 = rt(Math.max(16, gw >> 1), Math.max(16, gh >> 1));
  }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.orthoCam);
  }

  // GPU timing (optional): wraps fn in a TIME_ELAPSED query, results collected a few frames later.
  _timed(name, fn) {
    if (!this.profile) return fn();
    const gl = this.renderer.getContext();
    const ext = this._ext ?? (this._ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'));
    if (!ext) return fn();
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    fn();
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    this._queries.push({ name, q });
  }

  _collect() {
    if (!this._queries.length) return;
    const gl = this.renderer.getContext();
    const ext = this._ext;
    const keep = [];
    for (const e of this._queries) {
      if (!gl.getQueryParameter(e.q, gl.QUERY_RESULT_AVAILABLE)) {
        keep.push(e);
        continue;
      }
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        const ms = gl.getQueryParameter(e.q, gl.QUERY_RESULT) / 1e6;
        const s = this.stats.gpu[e.name] || (this.stats.gpu[e.name] = { last: 0, avg: 0, n: 0 });
        s.last = ms;
        s.n++;
        s.avg += (ms - s.avg) / Math.min(s.n, 30);
      }
      gl.deleteQuery(e.q);
    }
    this._queries = keep;
  }

  render(scene, camera) {
    const r = this.renderer;
    r.info.reset();
    this._collect();
    this._timed('scene', () => r.render(scene, camera));
    const night = this.game.sky?.nightFactor ?? 0;
    const doAO = this.aoEnabled && this.ao.strength > 0;
    const doGlow = this.glowEnabled && night > 0.05;
    if (doAO || doGlow) {
      this._resize();
      const oldAuto = r.autoClear;
      if (doGlow) this._timed('glow', () => this._glow(night));
      if (doAO) this._timed('ao', () => this._ao(scene, camera, night));
      r.autoClear = oldAuto;
      r.setRenderTarget(null);
    }
    this.stats.calls = r.info.render.calls;
  }

  _ao(scene, camera, night) {
    const r = this.renderer;
    const A = this.ao;
    const cam = this.aoCam;
    cam.copy(camera, false);
    cam.layers.set(AO_LAYER);
    cam.far = Math.min(camera.far, A.range);
    cam.updateProjectionMatrix();
    cam.matrixWorld.copy(camera.matrixWorld);
    cam.matrixWorldInverse.copy(camera.matrixWorldInverse);
    // Normal + depth prepass of the city geometry (no shadow map update, no background).
    const bg = scene.background;
    const override = scene.overrideMaterial;
    const shadowAuto = r.shadowMap.autoUpdate;
    const shadowNeeds = r.shadowMap.needsUpdate;
    scene.background = null;
    scene.overrideMaterial = this.normalMat;
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = false;
    r.autoClear = true;
    r.getClearColor(this._clear || (this._clear = new THREE.Color()));
    const clearAlpha = r.getClearAlpha();
    r.setClearColor(0x8080ff, 1);
    r.setRenderTarget(this.prepass);
    r.render(scene, cam);
    r.setClearColor(this._clear, clearAlpha);
    scene.background = bg;
    scene.overrideMaterial = override;
    r.shadowMap.autoUpdate = shadowAuto;
    r.shadowMap.needsUpdate = shadowNeeds;

    const fovY = THREE.MathUtils.degToRad(cam.fov) / cam.zoom;
    const tanY = Math.tan(fovY / 2);
    const u = this.aoMat.uniforms;
    u.tNormal.value = this.prepass.texture;
    u.tDepth.value = this.prepass.depthTexture;
    u.uRes.value.set(this.w, this.h);
    u.uTanFov.value.set(tanY * cam.aspect, tanY);
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    u.uProjScale.value = this.h / (2 * tanY);
    u.uRadius.value = A.radius;
    u.uIntensity.value = A.intensity;
    u.uBias.value = A.bias;
    this._pass(this.aoMat, this.aoA);
    const b = this.blurMat.uniforms;
    b.tDepth.value = this.prepass.depthTexture;
    b.uNear.value = cam.near;
    b.uFar.value = cam.far;
    b.tAO.value = this.aoA.texture;
    b.uDir.value.set(1 / this.w, 0);
    this._pass(this.blurMat, this.aoB);
    b.tAO.value = this.aoB.texture;
    b.uDir.value.set(0, 1 / this.h);
    this._pass(this.blurMat, this.aoA);
    // Multiply onto the finished frame.
    const c = this.compMat.uniforms;
    c.tAO.value = this.aoA.texture;
    c.tDepth.value = this.prepass.depthTexture;
    c.uNear.value = cam.near;
    c.uFar.value = cam.far;
    const fog = scene.fog;
    const fadeFar = Math.min(A.fadeFar, fog ? fog.near + (fog.far - fog.near) * 0.12 : A.fadeFar);
    c.uFadeNear.value = Math.min(A.fadeNear, fadeFar * 0.5);
    c.uFadeFar.value = fadeFar;
    c.uStrength.value = A.strength * (1 - 0.35 * night);
    r.autoClear = false;
    this._pass(this.compMat, null);
  }

  _glow(night) {
    const r = this.renderer;
    r.setRenderTarget(null);
    r.copyFramebufferToTexture(this.frameCopy);
    const br = this.brightMat.uniforms;
    br.tColor.value = this.frameCopy;
    br.uTexel.value.set(1 / this.fullW, 1 / this.fullH);
    br.uThreshold.value = this.glow.threshold;
    r.autoClear = true;
    this._pass(this.brightMat, this.g1);
    const g = this.gblurMat.uniforms;
    g.tSrc.value = this.g1.texture;
    g.uDir.value.set(1 / this.g1.width, 0);
    this._pass(this.gblurMat, this.g2);
    g.tSrc.value = this.g2.texture;
    g.uDir.value.set(0, 1 / this.g1.height);
    this._pass(this.gblurMat, this.g1);
    g.tSrc.value = this.g1.texture;
    g.uDir.value.set(2 / this.g3.width, 0);
    this._pass(this.gblurMat, this.g3);
    g.tSrc.value = this.g3.texture;
    g.uDir.value.set(0, 2 / this.g3.height);
    this._pass(this.gblurMat, this.g4);
    const a = this.glowAddMat.uniforms;
    a.tA.value = this.g1.texture;
    a.tB.value = this.g4.texture;
    a.uStrength.value = this.glow.strength * THREE.MathUtils.smoothstep(night, 0.05, 0.6);
    r.autoClear = false;
    this._pass(this.glowAddMat, null);
  }
}
