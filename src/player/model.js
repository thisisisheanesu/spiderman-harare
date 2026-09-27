import * as THREE from 'three';

// Procedural Spider-Man: a single SkinnedMesh (one draw call + one shadow pass) built from smooth
// parametric tubes on a 19-bone skeleton. Model space: feet at y = 0, facing -Z, +X is the
// character's right. Height ≈ 1.78 m. Every vertex also carries its bind-pose position (used by the
// suit-transition shader) and a lens flag (the white eye lenses glow slightly).

export const BONE_NAMES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'forearmL', 'handL',
  'shoulderR', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL',
  'thighR', 'shinR', 'footR',
];
export const B = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 7, 2, 9, 10, 11, 0, 13, 14, 0, 16, 17];

// Segment lengths (m), shared with the pose IK.
export const LIMB = { thigh: 0.43, shin: 0.4, ankle: 0.08, upperArm: 0.29, forearm: 0.26, hand: 0.18 };
export const HIP_JOINT_Y = LIMB.ankle + LIMB.shin + LIMB.thigh; // 0.91
export const PIVOT_Y = 0.95; // model origin sits this far below the player's body pivot

// Bind-pose joint positions in model space.
const J = {
  hips: [0, 0.97, 0],
  spine: [0, 1.07, 0],
  chest: [0, 1.24, 0],
  neck: [0, 1.49, 0],
  head: [0, 1.57, 0],
  shoulder: [0.07, 1.44, 0],
  upperArm: [0.19, 1.44, 0],
  forearm: [0.19, 1.44 - LIMB.upperArm, 0],
  hand: [0.19, 1.44 - LIMB.upperArm - LIMB.forearm, 0],
  thigh: [0.095, HIP_JOINT_Y, 0],
  shin: [0.095, HIP_JOINT_Y - LIMB.thigh, 0],
  foot: [0.095, LIMB.ankle, 0],
};

function jointPos(name) {
  if (J[name]) return new THREE.Vector3(...J[name]);
  const [x, y, z] = J[name.slice(0, -1)];
  return new THREE.Vector3(name.endsWith('L') ? -x : x, y, z);
}

// Atlas regions in canvas pixels [x, y, w, h] of a 1024² texture; suits.js paints into the same rects.
export const ATLAS_SIZE = 1024;
export const ATLAS = {
  torso: [0, 0, 512, 512],
  head: [512, 0, 256, 256],
  neck: [768, 0, 128, 128],
  hand: [896, 0, 128, 128],
  foot: [768, 128, 128, 128],
  lens: [896, 128, 64, 64],
  rim: [960, 128, 64, 64],
  upperArm: [512, 256, 128, 256],
  forearm: [640, 256, 128, 256],
  thigh: [0, 512, 256, 256],
  shin: [256, 512, 256, 256],
};

// Profiles: [t, rx, rz, offZ] along each part's axis (t = 0..1 between its joints; caps beyond).
// The torso and head are described directly in model-space heights.
export const TORSO_Y0 = 0.83;
export const TORSO_Y1 = 1.535;
const TORSO_KEYS = [
  [0.83, 0.0, 0.0, 0.0],
  [0.835, 0.07, 0.06, 0.0],
  [0.85, 0.13, 0.095, 0.0],
  [0.88, 0.155, 0.108, 0.0],
  [0.94, 0.166, 0.112, 0.004],
  [1.0, 0.153, 0.102, 0.0],
  [1.07, 0.14, 0.096, -0.004],
  [1.15, 0.15, 0.1, -0.004],
  [1.25, 0.172, 0.112, 0.0],
  [1.34, 0.19, 0.118, 0.0],
  [1.41, 0.196, 0.112, 0.004],
  [1.455, 0.17, 0.096, 0.01],
  [1.49, 0.11, 0.075, 0.012],
  [1.515, 0.07, 0.062, 0.01],
  [1.528, 0.04, 0.04, 0.01],
  [1.535, 0.0, 0.0, 0.01],
];
export const HEAD_Y0 = 1.535;
export const HEAD_Y1 = 1.785;
export const HEAD_KEYS = [
  [1.535, 0.0, 0.0, -0.012],
  [1.54, 0.03, 0.04, -0.016],
  [1.555, 0.05, 0.068, -0.016],
  [1.585, 0.064, 0.088, -0.01],
  [1.625, 0.074, 0.097, -0.004],
  [1.67, 0.079, 0.1, 0.0],
  [1.715, 0.078, 0.098, 0.004],
  [1.75, 0.068, 0.086, 0.006],
  [1.772, 0.048, 0.062, 0.006],
  [1.782, 0.024, 0.032, 0.006],
  [1.785, 0.0, 0.0, 0.006],
];

// Round end caps appended to a limb profile (quarter-circle falloff).
function withCaps(keys, capStart, capEnd) {
  const out = [];
  const first = keys[0];
  const last = keys[keys.length - 1];
  const ring = [
    [1.0, 0.0],
    [0.92, 0.39],
    [0.7, 0.71],
    [0.38, 0.93],
  ];
  for (const [s, f] of ring) out.push([first[0] - capStart * s, first[1] * f, first[2] * f, first[3] || 0]);
  out.push(...keys);
  for (let i = ring.length - 1; i >= 0; i--) {
    const [s, f] = ring[i];
    out.push([last[0] + capEnd * s, last[1] * f, last[2] * f, last[3] || 0]);
  }
  return out;
}

// Catmull-Rom sample of a key table at parameter t. Writes [rx, rz, offZ] into out.
export function sampleKeys(keys, t, out) {
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] < t) i++;
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k0 = keys[Math.max(0, i - 1)];
  const k3 = keys[Math.min(keys.length - 1, i + 2)];
  const s = Math.min(1, Math.max(0, (t - k1[0]) / (k2[0] - k1[0] || 1)));
  const s2 = s * s;
  const s3 = s2 * s;
  for (let c = 1; c <= 3; c++) {
    const p0 = k0[c] || 0;
    const p1 = k1[c] || 0;
    const p2 = k2[c] || 0;
    const p3 = k3[c] || 0;
    let v = 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
    if (c < 3) v = Math.max(0, Math.min(v, Math.max(p1, p2) * 1.05));
    out[c - 1] = v;
  }
  return out;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

class SkinBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.skinIndex = [];
    this.skinWeight = [];
    this.lens = [];
    this.index = [];
  }

  get count() {
    return this.pos.length / 3;
  }

  vertex(p, n, u, v, bones, lens = 0) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.skinIndex.push(bones[0], bones[1], 0, 0);
    this.skinWeight.push(1 - bones[2], bones[2], 0, 0);
    this.lens.push(lens);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeight, 4));
    g.setAttribute('aLens', new THREE.Float32BufferAttribute(this.lens, 1));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

// UV of a canvas-pixel rect position (u, v in 0..1 inside the rect, v = 1 at the rect's top row).
const ATLAS_PAD = 3;
function atlasUV(rect, u, v, out) {
  out.x = (rect[0] + ATLAS_PAD + u * (rect[2] - 2 * ATLAS_PAD)) / ATLAS_SIZE;
  out.y = 1 - (rect[1] + ATLAS_PAD + (1 - v) * (rect[3] - 2 * ATLAS_PAD)) / ATLAS_SIZE;
  return out;
}

const _p = new THREE.Vector3();
const _pu = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();
const _uv = new THREE.Vector2();
const _r = [0, 0, 0];

// A closed tube around an axis. spec: {origin, dir, ex, ez, len, keys, segU, perSpan, rect,
// tex: [t0, t1] (range of t mapped onto the rect), skin(t) -> [boneA, boneB, weightB], deform?}
function tube(builder, spec) {
  const { origin, dir, ex, ez, len, keys, segU, rect } = spec;
  const [tex0, tex1] = spec.tex || [0, 1];
  const perSpan = spec.perSpan || 2;
  const ts = [];
  for (let i = 0; i < keys.length - 1; i++) {
    for (let k = 0; k < perSpan; k++) ts.push(keys[i][0] + ((keys[i + 1][0] - keys[i][0]) * k) / perSpan);
  }
  ts.push(keys[keys.length - 1][0]);
  const tMin = ts[0];
  const tMax = ts[ts.length - 1];

  const point = (u, t, out) => {
    sampleKeys(keys, t, _r);
    const th = u * Math.PI * 2;
    out.copy(origin).addScaledVector(dir, t * len);
    out.addScaledVector(ex, _r[0] * Math.sin(th));
    out.addScaledVector(ez, _r[1] * Math.cos(th) + _r[2]);
    if (spec.deform) spec.deform(out, u, t);
    return out;
  };

  const start = builder.count;
  const eps = 1e-3;
  const dt = (tMax - tMin) * 1e-3;
  for (let j = 0; j < ts.length; j++) {
    const t = ts[j];
    const te = Math.min(tMax - dt, Math.max(tMin + dt, t));
    const bones = spec.skin(t);
    for (let i = 0; i <= segU; i++) {
      const u = i / segU;
      point(u, t, _p);
      point(u + eps, te, _pu).sub(point(u - eps, te, _n));
      point(u, te + dt, _pv).sub(point(u, te - dt, _n));
      _n.crossVectors(_pu, _pv);
      if (_n.lengthSq() < 1e-14) {
        _n.copy(dir).multiplyScalar(t < (tMin + tMax) / 2 ? -1 : 1);
      } else {
        _n.normalize();
        _c.copy(origin).addScaledVector(dir, te * len);
        point(u, te, _pu).sub(_c);
        if (_n.dot(_pu) < 0) _n.negate();
      }
      const v = Math.min(1, Math.max(0, (t - tex0) / (tex1 - tex0)));
      atlasUV(rect, u, v, _uv);
      builder.vertex(_p, _n, _uv.x, _uv.y, bones);
    }
  }

  // Wind triangles so their geometric normal agrees with the vertex normals.
  const row = segU + 1;
  const quads = [];
  for (let j = 0; j < ts.length - 1; j++) {
    for (let i = 0; i < segU; i++) {
      const a = start + j * row + i;
      quads.push([a, a + 1, a + row + 1, a + row]);
    }
  }
  const P = builder.pos;
  const N = builder.nrm;
  let votes = 0;
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (const [a, b, c] of quads) {
    e1.set(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
    e2.set(P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]);
    e1.cross(e2);
    votes += Math.sign(e1.x * N[a * 3] + e1.y * N[a * 3 + 1] + e1.z * N[a * 3 + 2]);
  }
  const flip = votes < 0;
  for (const [a, b, c, d] of quads) {
    if (flip) builder.index.push(a, c, b, a, d, c);
    else builder.index.push(a, b, c, a, c, d);
  }
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const DOWN = new THREE.Vector3(0, -1, 0);
const FWD = new THREE.Vector3(0, 0, -1);

// Skinning helper: blend from bone a to bone b across t in [t0, t1] (max weight wMax on b).
const blend = (a, b, t, t0, t1, wMax = 0.5) => [a, b, smooth(t0, t1, t) * wMax];

function buildTorso(sb) {
  const len = TORSO_Y1 - TORSO_Y0;
  const keys = TORSO_KEYS.map(([y, rx, rz, oz]) => [(y - TORSO_Y0) / len, rx, rz, oz]);
  tube(sb, {
    origin: new THREE.Vector3(0, TORSO_Y0, 0),
    dir: Y,
    ex: X,
    ez: Z,
    len,
    keys,
    segU: 28,
    perSpan: 3,
    rect: ATLAS.torso,
    skin: (t) => {
      const y = TORSO_Y0 + t * len;
      if (y < 1.07) return blend(B.hips, B.spine, y, 0.98, 1.07, 1);
      if (y < 1.26) return blend(B.spine, B.chest, y, 1.13, 1.26, 1);
      return blend(B.chest, B.neck, y, 1.47, 1.53, 0.6);
    },
    deform: (p, u, t) => {
      const y = TORSO_Y0 + t * len;
      const th = u * Math.PI * 2;
      const front = -Math.cos(th); // 1 at the chest centre
      // Pecs, shoulder blades and glutes.
      if (front > 0) {
        const pec = smooth(1.22, 1.3, y) * (1 - smooth(1.36, 1.42, y));
        const across = Math.exp(-(((Math.abs(p.x) - 0.075) / 0.06) ** 2));
        p.z -= 0.022 * pec * across * front;
        const abs = smooth(1.02, 1.08, y) * (1 - smooth(1.18, 1.22, y));
        p.z -= 0.006 * abs * Math.exp(-((p.x / 0.05) ** 2)) * front;
      } else {
        const blade = smooth(1.26, 1.33, y) * (1 - smooth(1.4, 1.45, y));
        p.z += 0.01 * blade * Math.exp(-(((Math.abs(p.x) - 0.08) / 0.05) ** 2)) * -front;
        const glute = smooth(0.84, 0.88, y) * (1 - smooth(0.95, 1.0, y));
        p.z += 0.02 * glute * Math.exp(-(((Math.abs(p.x) - 0.075) / 0.06) ** 2)) * -front;
      }
      // Trapezius slope into the neck.
      const trap = smooth(1.43, 1.5, y);
      p.y += trap * 0.012 * Math.exp(-(((Math.abs(p.x) - 0.08) / 0.05) ** 2));
    },
  });
}

function buildHead(sb) {
  const len = HEAD_Y1 - HEAD_Y0;
  const keys = HEAD_KEYS.map(([y, rx, rz, oz]) => [(y - HEAD_Y0) / len, rx, rz, oz]);
  tube(sb, {
    origin: new THREE.Vector3(0, HEAD_Y0, 0),
    dir: Y,
    ex: X,
    ez: Z,
    len,
    keys,
    segU: 28,
    perSpan: 3,
    rect: ATLAS.head,
    skin: () => [B.head, B.head, 0],
    deform: (p, u, t) => {
      // Narrow jaw towards the chin.
      const y = HEAD_Y0 + t * len;
      const jaw = 1 - smooth(1.54, 1.63, y);
      const front = Math.max(0, -Math.cos(u * Math.PI * 2));
      p.x *= 1 - 0.28 * jaw * front;
    },
  });
  tube(sb, {
    origin: new THREE.Vector3(0, 1.45, 0.004),
    dir: Y,
    ex: X,
    ez: Z,
    len: 0.13,
    keys: withCaps([
      [0, 0.058, 0.056],
      [0.5, 0.053, 0.052],
      [1, 0.05, 0.05],
    ], 0.2, 0.2),
    segU: 16,
    rect: ATLAS.neck,
    skin: (t) => (t < 0.5 ? blend(B.chest, B.neck, t, 0, 0.5, 1) : blend(B.neck, B.head, t, 0.6, 1, 0.8)),
  });
}

// The head surface's front z at model-space (x, y) — used to wrap the eye lenses onto the mask.
function headFrontZ(x, y) {
  const len = HEAD_Y1 - HEAD_Y0;
  const keys = HEAD_KEYS.map(([yy, rx, rz, oz]) => [(yy - HEAD_Y0) / len, rx, rz, oz]);
  sampleKeys(keys, (y - HEAD_Y0) / len, _r);
  const s = Math.min(0.999, Math.abs(x) / _r[0]);
  return _r[2] - _r[1] * Math.sqrt(1 - s * s);
}

function eyeShape(scale) {
  // Right eye in face coordinates (x outward, y up), metres.
  const s = new THREE.Shape();
  s.moveTo(-0.026 * scale, -0.013 * scale);
  s.bezierCurveTo(-0.018 * scale, 0.006 * scale, 0.002 * scale, 0.02 * scale, 0.024 * scale, 0.02 * scale);
  s.bezierCurveTo(0.034 * scale, 0.02 * scale, 0.039 * scale, 0.01 * scale, 0.037 * scale, -0.002 * scale);
  s.bezierCurveTo(0.035 * scale, -0.016 * scale, 0.02 * scale, -0.024 * scale, 0.004 * scale, -0.024 * scale);
  s.bezierCurveTo(-0.01 * scale, -0.024 * scale, -0.022 * scale, -0.02 * scale, -0.026 * scale, -0.013 * scale);
  return s;
}

function buildEyes(sb) {
  const layers = [
    { scale: 1.5, lift: 0.0015, rect: ATLAS.rim, lens: 0 },
    { scale: 1.18, lift: 0.0035, rect: ATLAS.lens, lens: 1 },
  ];
  const cx = 0.037;
  const cy = 1.672;
  for (const side of [-1, 1]) {
    for (const L of layers) {
      const g = new THREE.ShapeGeometry(eyeShape(L.scale), 6);
      const pos = g.attributes.position;
      const start = sb.count;
      const bbox = new THREE.Box2();
      for (let i = 0; i < pos.count; i++) bbox.expandByPoint(new THREE.Vector2(pos.getX(i), pos.getY(i)));
      for (let i = 0; i < pos.count; i++) {
        const ex = pos.getX(i);
        const ey = pos.getY(i);
        const x = side * (cx + ex);
        const y = cy + ey;
        // Lenses bulge slightly like the real mask's curved lenses.
        const r = Math.min(1, Math.hypot(ex / 0.03, ey / 0.022));
        const bulge = L.lens ? 0.003 * (1 - r * r) : 0;
        const z0 = headFrontZ(x, y);
        _n.set(x * 0.9, 0, z0 * 0.8).normalize();
        _p.set(x, y, z0).addScaledVector(_n, L.lift + bulge);
        const u = (ex - bbox.min.x) / (bbox.max.x - bbox.min.x);
        const v = (ey - bbox.min.y) / (bbox.max.y - bbox.min.y);
        atlasUV(L.rect, 0.1 + u * 0.8, 0.1 + v * 0.8, _uv);
        sb.vertex(_p, _n, _uv.x, _uv.y, [B.head, B.head, 0], L.lens);
      }
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i += 3) {
        // Faces must point forward (-Z); mirrored eyes flip winding.
        if (side > 0) sb.index.push(start + idx[i], start + idx[i + 2], start + idx[i + 1]);
        else sb.index.push(start + idx[i], start + idx[i + 1], start + idx[i + 2]);
      }
      g.dispose();
    }
  }
}

function buildArm(sb, side) {
  const s = side === 'L' ? -1 : 1;
  const ex = new THREE.Vector3(s, 0, 0);
  const shoulder = jointPos(`upperArm${side}`);
  const elbow = jointPos(`forearm${side}`);
  const wrist = jointPos(`hand${side}`);
  const sh = B[`shoulder${side}`];
  const ua = B[`upperArm${side}`];
  const fa = B[`forearm${side}`];
  const hd = B[`hand${side}`];

  tube(sb, {
    origin: shoulder,
    dir: DOWN,
    ex,
    ez: Z,
    len: LIMB.upperArm,
    keys: withCaps([
      [0, 0.064, 0.066, 0.004],
      [0.18, 0.062, 0.064, 0.002],
      [0.45, 0.05, 0.056, -0.004],
      [0.75, 0.044, 0.046, -0.002],
      [1, 0.04, 0.041, 0],
    ], 0.24, 0.12),
    segU: 16,
    rect: ATLAS.upperArm,
    skin: (t) => (t < 0.2 ? blend(ua, sh, 0.2 - t, 0.1, 0.45, 0.35) : blend(ua, fa, t, 0.82, 1.08, 0.5)),
  });
  tube(sb, {
    origin: elbow,
    dir: DOWN,
    ex,
    ez: Z,
    len: LIMB.forearm,
    keys: withCaps([
      [0, 0.039, 0.04, 0.003],
      [0.22, 0.045, 0.043, 0.002],
      [0.6, 0.036, 0.034, 0],
      [1, 0.027, 0.03, 0],
    ], 0.12, 0.1),
    segU: 16,
    rect: ATLAS.forearm,
    skin: (t) => (t < 0.3 ? blend(fa, ua, 0.3 - t, 0.1, 0.4, 0.5) : blend(fa, hd, t, 0.9, 1.05, 0.4)),
  });
  // Mitten hand (palm faces the body) with a slight finger curl, plus a thumb.
  tube(sb, {
    origin: wrist,
    dir: DOWN,
    ex,
    ez: Z,
    len: LIMB.hand,
    keys: withCaps([
      [0, 0.024, 0.031, 0],
      [0.3, 0.025, 0.044, -0.004],
      [0.62, 0.02, 0.043, -0.006],
      [0.95, 0.016, 0.036, -0.016],
    ], 0.06, 0.08),
    segU: 12,
    rect: ATLAS.hand,
    skin: () => [hd, hd, 0],
    deform: (p, u, t) => {
      p.z -= 0.035 * Math.max(0, t - 0.55) ** 2 * 4;
    },
  });
  const thumbDir = new THREE.Vector3(-s * 0.35, -0.75, -0.55).normalize();
  const thumbEx = new THREE.Vector3().crossVectors(thumbDir, Z).normalize().multiplyScalar(s);
  const thumbEz = new THREE.Vector3().crossVectors(thumbEx, thumbDir).normalize().multiplyScalar(s);
  tube(sb, {
    origin: wrist.clone().add(new THREE.Vector3(-s * 0.012, -0.03, -0.018)),
    dir: thumbDir,
    ex: thumbEx,
    ez: thumbEz,
    len: 0.07,
    keys: withCaps([
      [0, 0.014, 0.016],
      [1, 0.011, 0.012],
    ], 0.2, 0.18),
    segU: 8,
    rect: ATLAS.hand,
    skin: () => [hd, hd, 0],
  });
}

function buildLeg(sb, side) {
  const s = side === 'L' ? -1 : 1;
  const ex = new THREE.Vector3(s, 0, 0);
  const hip = jointPos(`thigh${side}`);
  const knee = jointPos(`shin${side}`);
  const ankle = jointPos(`foot${side}`);
  const th = B[`thigh${side}`];
  const sn = B[`shin${side}`];
  const ft = B[`foot${side}`];

  tube(sb, {
    origin: hip,
    dir: DOWN,
    ex,
    ez: Z,
    len: LIMB.thigh,
    keys: withCaps([
      [0, 0.088, 0.09, 0],
      [0.25, 0.082, 0.086, -0.006],
      [0.6, 0.068, 0.07, -0.006],
      [0.9, 0.053, 0.055, -0.002],
      [1, 0.05, 0.053, 0],
    ], 0.22, 0.12),
    segU: 16,
    rect: ATLAS.thigh,
    skin: (t) => (t < 0.2 ? blend(th, B.hips, 0.2 - t, 0.05, 0.4, 0.5) : blend(th, sn, t, 0.85, 1.08, 0.5)),
  });
  tube(sb, {
    origin: knee,
    dir: DOWN,
    ex,
    ez: Z,
    len: LIMB.shin,
    keys: withCaps([
      [0, 0.049, 0.052, 0],
      [0.22, 0.052, 0.058, 0.012],
      [0.45, 0.046, 0.05, 0.008],
      [0.8, 0.034, 0.036, 0],
      [1, 0.032, 0.034, 0.004],
    ], 0.14, 0.12),
    segU: 16,
    rect: ATLAS.shin,
    skin: (t) => (t < 0.25 ? blend(sn, th, 0.25 - t, 0.1, 0.4, 0.5) : blend(sn, ft, t, 0.9, 1.1, 0.5)),
  });
  // Foot: a tube along -Z from heel to toe with a flattened sole.
  tube(sb, {
    origin: new THREE.Vector3(hip.x, 0.05, 0.045),
    dir: FWD,
    ex,
    ez: Y,
    len: 0.22,
    keys: withCaps([
      [0, 0.036, 0.05],
      [0.25, 0.042, 0.05],
      [0.55, 0.045, 0.036],
      [0.85, 0.04, 0.026],
      [1, 0.034, 0.022],
    ], 0.12, 0.12),
    segU: 14,
    rect: ATLAS.foot,
    skin: () => [ft, ft, 0],
    deform: (p) => {
      if (p.y < 0.006) p.y = 0.006;
    },
  });
}

// Build the skeleton + skinned mesh. Returns {mesh, bones, skeleton}.
export function buildSpiderManMesh(material) {
  const sb = new SkinBuilder();
  buildTorso(sb);
  buildHead(sb);
  buildEyes(sb);
  buildArm(sb, 'L');
  buildArm(sb, 'R');
  buildLeg(sb, 'L');
  buildLeg(sb, 'R');
  const geometry = sb.build();

  const bones = BONE_NAMES.map((name) => {
    const b = new THREE.Bone();
    b.name = name;
    return b;
  });
  const world = BONE_NAMES.map((name) => jointPos(name));
  bones.forEach((b, i) => {
    const p = PARENT[i];
    b.position.copy(world[i]);
    if (p >= 0) {
      b.position.sub(world[p]);
      bones[p].add(b);
    }
  });

  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(bones[0]);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'spiderman';
  return { mesh, bones, skeleton, rest: bones.map((b) => b.position.clone()) };
}
