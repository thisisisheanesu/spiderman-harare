import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Procedural low-poly people, drawn as two instanced meshes (near / far LOD) with the whole
// skeleton animated in the vertex shader: every vertex knows its bone and colour slot, every
// instance carries its walk phase, gait, head and arm pose, clothing flags and eight packed colours.
// One draw call per LOD for the whole crowd, plus the same shader in the shadow pass.

// Clothing / prop flags (instance bitmask).
export const FLAG = {
  FEMALE: 1 << 0,
  SKIRT: 1 << 1, // knee-length skirt or dress
  LONG: 1 << 2, // ankle-length skirt, zambia wrap, robe
  WRAP: 1 << 3, // dhuku head wrap
  CAP: 1 << 4,
  BUN: 1 << 5,
  LOAD: 1 << 6, // basin of produce carried on the head
  BABY: 1 << 7, // baby tied on the back
  PACK: 1 << 8, // school bag / backpack
  SUIT: 1 << 9, // shirt front + tie under a jacket
  HAT: 1 << 10,
  HANDBAG: 1 << 11,
  PHONE: 1 << 12,
  BAGHAND: 1 << 13, // plastic carrier bag in the left hand
  SHORTSLEEVE: 1 << 14,
  SHORTS: 1 << 15,
  PAT_TOP: 1 << 18,
  PAT_BOTTOM: 1 << 19,
  GLASSES: 1 << 20,
  BALD: 1 << 21,
};
export const PATTERN_SHIFT = 16; // 2 bits: 0 plain, 1 stripes, 2 gingham, 3 wax print
const BIT = Object.fromEntries(Object.entries(FLAG).map(([k, v]) => [k, Math.log2(v)]));

const B = { PELVIS: 0, TORSO: 1, HEAD: 2, ARM_R: 3, FORE_R: 4, ARM_L: 5, FORE_L: 6, THIGH_R: 7, SHIN_R: 8, THIGH_L: 9, SHIN_L: 10, SKIRT: 11 };
// Colour slots 0-7 are the instance colours; 8+ are resolved from flags in the shader.
const S = { SKIN: 0, TOP: 1, BOTTOM: 2, SHOES: 3, HAIR: 4, ACCENT: 5, ITEM: 6, EXTRA: 7, THIGH: 8, SHIN: 9, FOREARM: 10, DARK: 11, EYE: 12, LIP: 13 };

// Skeleton (metres, 1.72 m adult facing -z).
const J = { hipX: 0.095, hipY: 0.93, kneeY: 0.5, waistY: 1.02, shX: 0.2, shY: 1.39, elbowY: 1.11, neckY: 1.47 };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

function femaleDelta(x, y, z, bone) {
  const side = Math.sign(x);
  if (bone === B.PELVIS || bone === B.SKIRT) return [x * 0.13, 0, z > 0 ? z * 0.12 : 0];
  if (bone === B.TORSO) {
    let dx = 0;
    let dz = 0;
    if (y > 1.03 && y < 1.2) dx -= x * 0.12 * (1 - Math.abs(y - 1.11) / 0.09);
    if (y > 1.33) dx -= x * 0.08;
    if (z < 0 && y > 1.18 && y < 1.37) dz -= 0.035 * Math.sin(((y - 1.18) / 0.19) * Math.PI);
    return [dx, 0, dz];
  }
  if (bone >= B.ARM_R && bone <= B.FORE_L) return [-side * 0.016, 0, 0];
  if (bone === B.THIGH_R || bone === B.THIGH_L) return [side * 0.014 * Math.max(0, (y - 0.5) / 0.43), 0, 0];
  return [0, 0, 0];
}

class Builder {
  constructor(lod) {
    this.lod = lod;
    this.parts = [];
  }

  // Add a primitive: placed by position/rotation/scale, tagged with bone, colour slot and flag rule
  // (flag > 0: only drawn when that flag bit is set; flag < 0: hidden when it is set).
  add(geo, { bone, slot, flag = 0, at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] }) {
    _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
    _m.compose(_v.set(at[0], at[1], at[2]), _q, _s.set(scale[0], scale[1], scale[2]));
    geo.applyMatrix4(_m);
    geo.deleteAttribute('uv');
    const n = geo.attributes.position.count;
    const part = new Float32Array(n * 4);
    const fem = new Float32Array(n * 3);
    const p = geo.attributes.position;
    for (let i = 0; i < n; i++) {
      part.set([bone, slot, flag, 0], i * 4);
      fem.set(femaleDelta(p.getX(i), p.getY(i), p.getZ(i), bone), i * 3);
    }
    geo.setAttribute('aPart', new THREE.BufferAttribute(part, 4));
    geo.setAttribute('aFem', new THREE.BufferAttribute(fem, 3));
    this.parts.push(geo);
  }

  cyl(rTop, rBot, y0, y1, seg, opts) {
    const g = new THREE.CylinderGeometry(rTop, rBot, y1 - y0, seg, 1, false);
    const at = opts.at || [0, 0, 0];
    this.add(g, { ...opts, at: [at[0], (y0 + y1) / 2, at[2]] });
  }

  sphere(r, w, h, opts, theta = Math.PI) {
    this.add(new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, theta), opts);
  }

  box(sx, sy, sz, opts) {
    this.add(new THREE.BoxGeometry(sx, sy, sz), opts);
  }

  build() {
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    g.computeBoundingSphere();
    return g;
  }
}

// flagged helpers: +bit+1 = needs flag, -(bit+1) = hidden by flag.
const needs = (name) => BIT[name] + 1;
const hiddenBy = (name) => -(BIT[name] + 1);

export function createBodyGeometry(lod) {
  const near = lod === 0;
  const seg = near ? 7 : 4;
  const b = new Builder(lod);
  for (const side of [1, -1]) {
    const x = J.hipX * side;
    const thigh = side > 0 ? B.THIGH_R : B.THIGH_L;
    const shin = side > 0 ? B.SHIN_R : B.SHIN_L;
    b.cyl(0.079, 0.058, J.kneeY, J.hipY + 0.02, seg, { bone: thigh, slot: S.THIGH, at: [x, 0, 0] });
    b.cyl(0.056, 0.042, 0.07, J.kneeY + 0.01, seg, { bone: shin, slot: S.SHIN, at: [x, 0, 0] });
    b.box(0.1, 0.075, 0.25, { bone: shin, slot: S.SHOES, at: [x, 0.0375, -0.04] });
    const arm = side > 0 ? B.ARM_R : B.ARM_L;
    const fore = side > 0 ? B.FORE_R : B.FORE_L;
    const ax = J.shX * side;
    b.cyl(0.05, 0.043, J.elbowY, J.shY + 0.01, seg, { bone: arm, slot: S.TOP, at: [ax, 0, 0] });
    if (near) b.sphere(0.056, 6, 4, { bone: arm, slot: S.TOP, at: [ax, J.shY - 0.005, 0] });
    b.cyl(0.042, 0.034, 0.855, J.elbowY + 0.01, seg, { bone: fore, slot: S.FOREARM, at: [ax, 0, 0] });
    b.sphere(0.043, near ? 6 : 4, near ? 4 : 3, { bone: fore, slot: S.SKIN, at: [ax, 0.81, -0.005], scale: [0.7, 1.25, 1] });
  }
  // Pelvis, torso, rounded shoulders, neck.
  b.cyl(0.15, 0.155, 0.85, 1.05, near ? 8 : 5, { bone: B.PELVIS, slot: S.BOTTOM, scale: [1, 1, 0.65] });
  b.cyl(0.176, 0.145, 1.04, J.shY + 0.01, near ? 8 : 5, { bone: B.TORSO, slot: S.TOP, scale: [1, 1, 0.6] });
  b.sphere(0.176, near ? 8 : 5, near ? 4 : 3, { bone: B.TORSO, slot: S.TOP, at: [0, J.shY, 0], scale: [1, 0.38, 0.6] }, Math.PI / 2);
  b.cyl(0.046, 0.05, J.shY, J.neckY + 0.05, near ? 6 : 4, { bone: B.TORSO, slot: S.SKIN });
  // Head, hair, face direction cue.
  b.sphere(0.1, near ? 9 : 6, near ? 7 : 4, { bone: B.HEAD, slot: S.SKIN, at: [0, 1.585, 0], scale: [0.92, 1.12, 1] });
  b.sphere(0.104, near ? 9 : 6, near ? 5 : 3, { bone: B.HEAD, slot: S.HAIR, flag: hiddenBy('BALD'), at: [0, 1.6, 0.012], rot: [0.45, 0, 0], scale: [0.95, 1.08, 1.02] }, 1.75);
  if (near) {
    // Face: nose, eyes (hidden behind sunglasses), lips, ears - enough to read where someone looks.
    b.box(0.028, 0.045, 0.035, { bone: B.HEAD, slot: S.SKIN, at: [0, 1.572, -0.1] });
    for (const side of [1, -1]) {
      b.box(0.028, 0.015, 0.01, { bone: B.HEAD, slot: S.EYE, flag: hiddenBy('GLASSES'), at: [side * 0.034, 1.603, -0.093] });
      b.box(0.012, 0.012, 0.008, { bone: B.HEAD, slot: S.DARK, flag: hiddenBy('GLASSES'), at: [side * 0.034, 1.603, -0.098] });
      b.sphere(0.024, 5, 4, { bone: B.HEAD, slot: S.SKIN, at: [side * 0.088, 1.585, 0.004], scale: [0.45, 1, 0.8] });
    }
    b.box(0.045, 0.013, 0.012, { bone: B.HEAD, slot: S.LIP, at: [0, 1.536, -0.091] });
    b.box(0.165, 0.032, 0.02, { bone: B.HEAD, slot: S.DARK, flag: needs('GLASSES'), at: [0, 1.602, -0.094] });
    b.sphere(0.056, 6, 4, { bone: B.HEAD, slot: S.HAIR, flag: needs('BUN'), at: [0, 1.69, 0.065] });
  }
  // Head wear.
  b.sphere(0.119, near ? 9 : 6, near ? 5 : 3, { bone: B.HEAD, slot: S.ACCENT, flag: needs('WRAP'), at: [0, 1.62, 0.012], rot: [0.5, 0, 0], scale: [0.98, 1.05, 1.08] }, 1.7);
  b.sphere(0.068, near ? 7 : 5, near ? 4 : 3, { bone: B.HEAD, slot: S.ACCENT, flag: needs('WRAP'), at: [0, 1.715, 0.035], scale: [1.45, 0.75, 1.05] });
  b.sphere(0.107, near ? 9 : 6, near ? 4 : 3, { bone: B.HEAD, slot: S.ACCENT, flag: needs('CAP'), at: [0, 1.605, 0.004], scale: [0.96, 0.95, 1.02] }, 1.5);
  b.box(0.16, 0.012, 0.11, { bone: B.HEAD, slot: S.ACCENT, flag: needs('CAP'), at: [0, 1.625, -0.12], rot: [-0.12, 0, 0] });
  b.cyl(0.085, 0.1, 1.64, 1.73, near ? 8 : 5, { bone: B.HEAD, slot: S.ACCENT, flag: needs('HAT') });
  b.cyl(0.17, 0.17, 1.64, 1.652, near ? 10 : 6, { bone: B.HEAD, slot: S.ACCENT, flag: needs('HAT') });
  // Basin of produce on the head (contents use the hair slot: hair is hidden under the wrap).
  b.cyl(0.25, 0.17, 1.72, 1.83, near ? 10 : 6, { bone: B.HEAD, slot: S.ITEM, flag: needs('LOAD') });
  b.sphere(0.22, near ? 8 : 5, near ? 3 : 2, { bone: B.HEAD, slot: S.HAIR, flag: needs('LOAD'), at: [0, 1.82, 0], scale: [1, 0.45, 1] }, Math.PI / 2);
  // Skirts (bones: follow the legs).
  b.cyl(0.165, 0.25, 0.54, 1.045, near ? 9 : 5, { bone: B.SKIRT, slot: S.BOTTOM, flag: needs('SKIRT'), scale: [1, 1, 0.76] });
  b.cyl(0.165, 0.285, 0.13, 1.045, near ? 9 : 5, { bone: B.SKIRT, slot: S.BOTTOM, flag: needs('LONG'), scale: [1, 1, 0.8] });
  // Baby on the back in a wrap, school bag, suit front, handbag.
  b.sphere(0.16, near ? 7 : 5, near ? 5 : 3, { bone: B.TORSO, slot: S.EXTRA, flag: needs('BABY'), at: [0, 1.16, 0.15], scale: [1.05, 1.12, 0.7] });
  b.cyl(0.182, 0.176, 1.27, 1.33, near ? 8 : 5, { bone: B.TORSO, slot: S.EXTRA, flag: needs('BABY'), scale: [1, 1, 0.64] });
  if (near) b.sphere(0.066, 6, 5, { bone: B.TORSO, slot: S.SKIN, flag: needs('BABY'), at: [0.035, 1.335, 0.19] });
  b.box(0.27, 0.34, 0.13, { bone: B.TORSO, slot: S.ITEM, flag: needs('PACK'), at: [0, 1.2, 0.155] });
  if (near) {
    b.box(0.1, 0.25, 0.012, { bone: B.TORSO, slot: S.EXTRA, flag: needs('SUIT'), at: [0, 1.27, -0.1] });
    b.box(0.036, 0.22, 0.012, { bone: B.TORSO, slot: S.ACCENT, flag: needs('SUIT'), at: [0, 1.25, -0.106] });
    b.box(0.075, 0.17, 0.22, { bone: B.TORSO, slot: S.ITEM, flag: needs('HANDBAG'), at: [-0.24, 0.99, 0.07] });
    b.box(0.012, 0.36, 0.03, { bone: B.TORSO, slot: S.ITEM, flag: needs('HANDBAG'), at: [-0.2, 1.21, 0.07], rot: [0, 0, -0.18] });
    // Phone modelled pointing forward so it stands upright when the forearm is raised level.
    b.box(0.07, 0.012, 0.14, { bone: B.FORE_R, slot: S.DARK, flag: needs('PHONE'), at: [J.shX - 0.01, 0.79, -0.05] });
    b.box(0.2, 0.25, 0.09, { bone: B.FORE_L, slot: S.ITEM, flag: needs('BAGHAND'), at: [-J.shX, 0.65, 0] });
  }
  return b.build();
}

// Shared GLSL: bone animation + colour resolution. Rotation angles: pitch > 0 swings a limb forward
// (-z) / tilts the head up; roll > 0 lifts an arm away from the body.
const VERT_HEAD = /* glsl */ `
attribute vec4 aPart;
attribute vec3 aFem;
attribute vec4 iColA;
attribute vec4 iColB;
attribute vec4 iAnim;
attribute vec4 iArmR;
attribute vec4 iArmL;
attribute vec4 iStyle;
varying vec3 vNpcColor;
varying vec3 vNpcAlt;
varying vec3 vNpcLocal;
varying float vNpcPattern;

vec3 npcUnpack(float v) {
  v = floor(v + 0.5);
  float r = floor(v / 65536.0);
  float g = floor((v - r * 65536.0) / 256.0);
  float b = v - r * 65536.0 - g * 256.0;
  return pow(vec3(r, g, b) / 255.0, vec3(2.2));
}
bool npcFlag(float flags, float bit) { return mod(floor(flags / exp2(bit)), 2.0) > 0.5; }
mat3 npcRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 npcRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 npcRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void npcRot(inout vec3 p, inout vec3 n, vec3 pivot, mat3 m) { p = pivot + m * (p - pivot); n = m * n; }

void npcPose(inout vec3 p, inout vec3 n) {
  float bone = aPart.x;
  float flags = iStyle.x;
  float rule = aPart.z;
  if (rule > 0.5 && !npcFlag(flags, rule - 1.0)) { p = vec3(0.0); return; }
  if (rule < -0.5 && npcFlag(flags, -rule - 1.0)) { p = vec3(0.0); return; }
  float fem = npcFlag(flags, 0.0) ? 1.0 : 0.0;
  p += aFem * fem;
  float build = iStyle.y;
  float side = p.x >= 0.0 ? 1.0 : -1.0;
  if (bone < 1.5 || bone > 10.5) p.xz *= 1.0 + build * vec2(0.2, 0.26);
  else if (bone < 6.5 && bone > 2.5) p.x += side * build * 0.035;
  else if (bone > 6.5) p.x += side * build * 0.02;
  vNpcLocal = p;

  float phase = iAnim.x;
  float gait = iAnim.y;
  float walk = clamp(gait, 0.0, 1.0);
  float run = clamp(gait - 1.0, 0.0, 1.0);
  float sit = iStyle.w;
  float lean = iStyle.z + run * 0.22;
  float s = sin(phase);
  float c = cos(phase);
  float longSkirt = npcFlag(flags, 2.0) ? 0.72 : 1.0;

  // Legs: hips swing, knees flex through the swing phase; sitting folds both.
  float hipAmp = (0.42 * walk + 0.36 * run) * longSkirt;
  float kneeAmp = 0.55 * walk + 0.85 * run;
  float hipR = hipAmp * s + sit * 1.45;
  float hipL = -hipAmp * s + sit * 1.45;
  float kneeR = -(0.08 * walk + kneeAmp * pow(max(0.0, cos(phase + 0.35)), 1.5)) - sit * 1.5;
  float kneeL = -(0.08 * walk + kneeAmp * pow(max(0.0, cos(phase + 0.35 + 3.14159)), 1.5)) - sit * 1.5;
  float hipX = ${J.hipX.toFixed(3)} + 0.014 * fem + 0.02 * build;
  if (bone > 6.5 && bone < 10.5) {
    bool right = bone < 8.5;
    float hip = right ? hipR : hipL;
    float knee = right ? kneeR : kneeL;
    float hx = right ? hipX : -hipX;
    if (bone == 8.0 || bone == 10.0) npcRot(p, n, vec3(hx, ${J.kneeY.toFixed(3)}, 0.0), npcRotX(knee));
    npcRot(p, n, vec3(hx, ${J.hipY.toFixed(3)}, 0.0), npcRotX(hip));
  } else if (bone > 10.5) {
    // Skirt hem follows the legs, blended across the front/back seam.
    float w = smoothstep(-0.07, 0.07, p.x);
    float depth = clamp((${J.hipY.toFixed(3)} + 0.1 - p.y) / 0.6, 0.0, 1.0);
    float a = mix(hipL, hipR, w) * depth * 0.8 + sit * depth * 0.4;
    npcRot(p, n, vec3(0.0, ${J.hipY.toFixed(3)} + 0.1, 0.0), npcRotX(a));
  }

  // Arms: counter-swing when walking, blended with the posed angles (pitch, roll, elbow, weight).
  float armAmp = 0.34 * walk + 0.7 * run;
  float elbowWalk = 0.22 + 0.12 * walk + 1.05 * run;
  float shX = ${J.shX.toFixed(3)} - 0.016 * fem + 0.035 * build;
  if (bone > 2.5 && bone < 6.5) {
    bool right = bone < 4.5;
    vec4 pose = right ? iArmR : iArmL;
    float swing = (right ? -armAmp : armAmp) * s;
    float pitch = mix(swing, pose.x, pose.w);
    float roll = mix(0.07 + 0.08 * build + 0.05 * run, pose.y, pose.w);
    float elbow = mix(elbowWalk + max(0.0, swing) * 0.4, pose.z, pose.w);
    float sx = right ? shX : -shX;
    if (bone == 4.0 || bone == 6.0) npcRot(p, n, vec3(sx, ${J.elbowY.toFixed(3)}, 0.0), npcRotX(elbow));
    npcRot(p, n, vec3(sx, ${J.shY.toFixed(3)}, 0.0), npcRotZ(right ? roll : -roll) * npcRotX(pitch));
  }
  if (bone > 1.5 && bone < 2.5) {
    npcRot(p, n, vec3(0.0, ${J.neckY.toFixed(3)}, 0.0), npcRotY(iAnim.z) * npcRotX(iAnim.w));
  }
  // Upper body: breathing, lean and counter-twist about the waist.
  if (bone > 0.5 && bone < 6.5) {
    p.y += (p.y - ${J.waistY.toFixed(3)}) * 0.012 * sin(phase * 0.5) * (1.0 - walk);
    npcRot(p, n, vec3(0.0, ${J.waistY.toFixed(3)}, 0.0), npcRotY(-0.09 * walk * s) * npcRotX(-lean));
  }
  // Whole body: pelvis twist, bob (stance leg length), sway, sitting drop.
  npcRot(p, n, vec3(0.0), npcRotY(0.11 * walk * s));
  float drop = 0.84 * (1.0 - cos(hipAmp * s)) * (1.0 - run) + run * (0.04 - 0.07 * abs(c));
  p.y -= drop + sit * 0.43;
  p.x += (0.022 * walk * s + 0.018 * sin(phase * 0.25) * (1.0 - walk)) * (1.0 - sit);

  // Colour for this vertex.
  float slot = aPart.y;
  bool bare = npcFlag(flags, 1.0) || npcFlag(flags, 2.0);
  if (slot == 8.0) slot = bare ? 0.0 : 2.0;
  else if (slot == 9.0) slot = bare || npcFlag(flags, 15.0) ? 0.0 : 2.0;
  else if (slot == 10.0) slot = npcFlag(flags, 14.0) ? 0.0 : 1.0;
  vec4 cols = slot < 3.5 ? iColA : iColB;
  float k = mod(slot, 4.0);
  float packed = k < 0.5 ? cols.x : k < 1.5 ? cols.y : k < 2.5 ? cols.z : cols.w;
  vNpcColor = slot > 12.5 ? npcUnpack(iColA.x) * vec3(0.78, 0.52, 0.5) : slot > 11.5 ? vec3(0.8, 0.77, 0.72) : slot > 10.5 ? vec3(0.012) : npcUnpack(packed);
  vNpcAlt = npcUnpack(iColB.w);
  float pat = mod(floor(flags / 65536.0), 4.0);
  bool patTop = slot == 1.0 && npcFlag(flags, 18.0);
  bool patBottom = slot == 2.0 && npcFlag(flags, 19.0);
  vNpcPattern = (patTop || patBottom) ? pat : 0.0;
}
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vNpcColor;
varying vec3 vNpcAlt;
varying vec3 vNpcLocal;
varying float vNpcPattern;
vec3 npcFragColor() {
  if (vNpcPattern < 0.5) return vNpcColor;
  vec3 q = vNpcLocal;
  float m;
  if (vNpcPattern < 1.5) m = step(0.5, fract(q.y * 16.0));
  else if (vNpcPattern < 2.5) m = 0.5 * (step(0.5, fract(q.y * 18.0)) + step(0.5, fract((q.x + q.z) * 18.0)));
  else {
    // Wax-print motif: rings around dots on a staggered grid.
    vec2 uv = vec2(q.x * 0.7 + q.z * 0.7, q.y) * 9.0;
    uv.x += 0.5 * step(0.5, fract(uv.y * 0.5));
    float r = length(fract(uv) - 0.5);
    m = max(1.0 - smoothstep(0.1, 0.14, r), 1.0 - smoothstep(0.03, 0.06, abs(r - 0.3)));
  }
  return mix(vNpcColor, vNpcAlt, m);
}
`;

function patchVertex(shader, withNormal) {
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERT_HEAD}`);
  if (withNormal) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 npcP = position;\nvec3 objectNormal = normal;\nnpcPose(npcP, objectNormal);')
      .replace('#include <begin_vertex>', 'vec3 transformed = npcP;');
  } else {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      'vec3 transformed = position;\nvec3 npcN = vec3(0.0, 1.0, 0.0);\nnpcPose(transformed, npcN);',
    );
  }
}

export function createBodyMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    patchVertex(shader, true);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= npcFragColor();');
  };
  mat.customProgramCacheKey = () => 'npc-body';
  return mat;
}

export function createBodyDepthMaterial() {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (shader) => patchVertex(shader, false);
  mat.customProgramCacheKey = () => 'npc-body-depth';
  return mat;
}

function write4(arr, o, x, y, z, w) {
  arr[o] = x;
  arr[o + 1] = y;
  arr[o + 2] = z;
  arr[o + 3] = w;
}

const INSTANCE_ATTRS = ['iColA', 'iColB', 'iAnim', 'iArmR', 'iArmL', 'iStyle'];

// Soft contact shadow texture for the blob under each person.
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Two LOD meshes + blob shadows. Per frame: begin(), push(agent, lod) for each visible agent, end().
export class CrowdRenderer {
  constructor(scene, max, { shadows }) {
    this.max = max;
    const material = createBodyMaterial();
    const depth = createBodyDepthMaterial();
    this.meshes = [0, 1].map((lod) => {
      const geo = createBodyGeometry(lod);
      for (const name of INSTANCE_ATTRS) {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
        a.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute(name, a);
      }
      const mesh = new THREE.InstancedMesh(geo, material, max);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = shadows && lod === 0;
      mesh.receiveShadow = shadows;
      mesh.customDepthMaterial = depth;
      mesh.name = lod ? 'crowd-far' : 'crowd-near';
      scene.add(mesh);
      return mesh;
    });
    const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.blobs = new THREE.InstancedMesh(
      blobGeo,
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      max,
    );
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = 1;
    this.blobs.count = 0;
    scene.add(this.blobs);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this.counts = [0, 0];
  }

  begin() {
    this.counts[0] = 0;
    this.counts[1] = 0;
    this.blobCount = 0;
  }

  push(a, lod, blob) {
    const i = this.counts[lod]++;
    const mesh = this.meshes[lod];
    const L = a.look;
    this._q.setFromAxisAngle(this._up, a.heading);
    this._s.setScalar(L.scale);
    this._m.compose(this._p.set(a.position.x, a.position.y, a.position.z), this._q, this._s);
    mesh.setMatrixAt(i, this._m);
    const g = mesh.geometry.attributes;
    const o = i * 4;
    const c = L.col;
    const p = a.pose;
    write4(g.iColA.array, o, c[0], c[1], c[2], c[3]);
    write4(g.iColB.array, o, c[4], c[5], c[6], c[7]);
    write4(g.iAnim.array, o, a.phase, p.gait, p.headYaw, p.headPitch);
    g.iArmR.array.set(p.armR, o);
    g.iArmL.array.set(p.armL, o);
    write4(g.iStyle.array, o, L.flags | p.flags, L.build, p.lean, p.sit);
    if (blob) {
      const k = this.blobCount++;
      this._s.set(0.75 * L.scale, 1, 0.75 * L.scale);
      this._q.identity();
      this._m.compose(this._p.set(a.position.x, a.position.y + 0.025, a.position.z), this._q, this._s);
      this.blobs.setMatrixAt(k, this._m);
    }
  }

  end() {
    for (let lod = 0; lod < 2; lod++) {
      const mesh = this.meshes[lod];
      const n = this.counts[lod];
      mesh.count = n;
      if (!n) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      for (const name of INSTANCE_ATTRS) {
        const attr = mesh.geometry.attributes[name];
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, n * 4);
        attr.needsUpdate = true;
      }
    }
    this.blobs.count = this.blobCount;
    if (this.blobCount) {
      this.blobs.instanceMatrix.clearUpdateRanges();
      this.blobs.instanceMatrix.addUpdateRange(0, this.blobCount * 16);
      this.blobs.instanceMatrix.needsUpdate = true;
    }
  }

  // Blob shadows fade out at night when there is no sun to cast them.
  setShadowStrength(v) {
    this.blobs.material.opacity = v;
  }
}
