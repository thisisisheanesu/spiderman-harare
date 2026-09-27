import * as THREE from 'three';

// Street and rooftop props from public/models/props (see its README): every placement is recorded
// with add() while the city is built (synchronously, from the metadata below), then load() fetches
// only the GLBs that are used and draws each prop as InstancedMeshes, one per primitive and draw
// level (GLB LOD0, GLB LOD1, a cheap far shape; see PROP_META.lod). update(camera) moves instances
// between the levels / hidden as the camera travels (incrementally: only the instances whose level
// changed are copied).
//
// The procedural props (street lamps, bollards, planters, shelters, dishes, JoJo tanks, cones)
// share one palette material; the lamps' LampLens primitive is merged into the lamp geometry
// (attribute aLens) and glows at night for the instances marked lit (per-instance attribute aLit),
// so each lamp model is one draw call. Scanned props (Poly Haven) keep their own PBR materials; their
// far level is one shared InstancedMesh of unit boxes (scaled to each model, in its average colour).

// Placement metadata copied from public/models/props/props.json (placement runs before the files
// are fetched): h = model top (m), base = radius of what touches the ground (obstacles),
// anchors = web-swing points in prop space. pal = procedural palette prop. lod = draw levels
// [[model, up to metres (desktop high)], ...] nearest first; model is 'lod0' / 'lod1' (the GLBs), or
// a cheap far shape built at load: 'lamp' (pole, arms, heads, lit lens), 'tank' (JoJo tank, with its
// stand) or 'box' (the model's bounding box in its own texture colours). shadow = casts shadows.
const P = (h, base, lod, o = {}) => ({ h, base, lod, ...o });
const LAMP_ANCHORS_2 = (top) => [[0, top, 0], [1.858, 10.145, 0], [-1.858, 10.145, 0]];
export const PROP_META = {
  street_lamp_single: P(8.21, 0.28, [['lod0', 70], ['lamp', 420]], { pal: 1, shadow: 1, anchors: [[0, 8, 0], [0, 8.145, 1.858]] }),
  street_lamp_double: P(10.21, 0.28, [['lod0', 80], ['lamp', 480]], { pal: 1, shadow: 1, anchors: LAMP_ANCHORS_2(10) }),
  street_lamp_double_solar: P(10.864, 0.28, [['lod0', 80], ['lamp', 480]], { pal: 1, shadow: 1, anchors: LAMP_ANCHORS_2(10.9) }),
  street_lamp_double_solar_ew: P(10.864, 0.28, [['lod0', 80], ['lamp', 480]], { pal: 1, shadow: 1, anchors: LAMP_ANCHORS_2(10.9) }),
  bollard_concrete: P(0.845, 0.15, [['lod0', 40], ['box', 100]], { pal: 1 }),
  bollard_painted: P(0.845, 0.15, [['lod0', 45], ['box', 110]], { pal: 1 }),
  planter_concrete: P(0.6, 0.85, [['lod0', 160]], { pal: 1 }),
  bus_shelter: P(2.82, 2.48, [['lod0', 260]], { pal: 1, shadow: 1, anchors: [[0, 2.75, 1.05]] }),
  satellite_dish: P(1.641, 0.354, [['lod0', 120]], { pal: 1 }),
  water_tank: P(2.1, 0.931, [['lod0', 35], ['lod1', 90], ['tank', 280]], { pal: 1, shadow: 1 }),
  water_tank_stand: P(4.16, 1.112, [['lod0', 35], ['lod1', 90], ['tank', 340]], { pal: 1, shadow: 1 }),
  traffic_cone: P(0.7, 0.269, [['lod0', 70]], { pal: 1 }),
  bench_timber: P(0.867, 1.27, [['lod0', 25], ['lod1', 70], ['box', 140]], { shadow: 1 }),
  bin_metal: P(0.906, 0.276, [['lod0', 20], ['lod1', 50], ['box', 110]]),
  barrier_concrete: P(0.831, 0.823, [['lod0', 25], ['lod1', 80], ['box', 170]], { shadow: 1 }),
  ac_unit: P(0.608, 0.402, [['lod0', 18], ['lod1', 40], ['box', 110]]),
  electrical_box: P(1.12, 0.489, [['lod0', 22], ['lod1', 50], ['box', 140]]),
  chair_monobloc: P(0.88, 0.44, [['lod0', 16], ['lod1', 70]]),
  crate_plastic_red: P(0.267, 0.274, [['lod0', 14], ['lod1', 55]]),
  crate_plastic_yellow: P(0.254, 0.305, [['lod0', 14], ['lod1', 55]]),
  drum_plastic_blue: P(0.88, 0.244, [['lod0', 16], ['lod1', 75]]),
  cardboard_box: P(0.342, 0.313, [['lod0', 14], ['lod1', 55]]),
  plant_aloe_pot: P(0.8, 0.268, [['lod0', 18], ['lod1', 85]]),
  plant_leafy_pot: P(0.842, 0.424, [['lod0', 18], ['lod1', 85]]),
  trash_bag: P(0.575, 0.264, [['lod0', 14], ['lod1', 55]]),
  tyre_old: P(0.6, 0.299, [['lod0', 14], ['lod1', 60]]),
  manhole_cover: P(0.068, 0.345, [['lod0', 10], ['lod1', 40]]),
};

// Draw distances per quality level (scales every level; phones also skip the scanned props' LOD0).
// Small clutter phones leave out altogether (fewer distinct meshes = fewer draw calls).
const LOW_SKIP = new Set(['manhole_cover', 'trash_bag', 'cardboard_box', 'tyre_old', 'crate_plastic_yellow', 'plant_leafy_pot']);
const RANGE = { low: 0.62, medium: 0.85, high: 1 };
const LENS_COLOR = new THREE.Color(1, 0.92, 0.8);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// Prop-space point (lx, ly, lz) of an instance at (x, y, z) rotated by rot about Y, scaled s.
export function propPoint(x, y, z, rot, s, lx, ly, lz, out) {
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  out.x = x + (c * lx + sn * lz) * s;
  out.y = y + ly * s;
  out.z = z + (-sn * lx + c * lz) * s;
  return out;
}

// Plain float attributes (the GLBs use int8 normals, possibly interleaved) so primitives merge.
function plainAttr(attr, itemSize) {
  const out = new Float32Array(attr.count * itemSize);
  for (let i = 0; i < attr.count; i++) for (let c = 0; c < itemSize; c++) out[i * itemSize + c] = attr.getComponent(i, c);
  return new THREE.BufferAttribute(out, itemSize);
}

// One geometry from several primitives (palette + LampLens) with aLens = 1 on lens vertices.
function mergePalette(prims) {
  let nv = 0;
  let ni = 0;
  for (const { geometry: g } of prims) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const lens = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v0 = 0;
  let i0 = 0;
  for (const { geometry: g, lens: isLens } of prims) {
    const P0 = g.attributes.position;
    const N0 = g.attributes.normal;
    const U0 = g.attributes.uv;
    for (let i = 0; i < P0.count; i++) {
      for (let c = 0; c < 3; c++) {
        pos[(v0 + i) * 3 + c] = P0.getComponent(i, c);
        nrm[(v0 + i) * 3 + c] = N0 ? N0.getComponent(i, c) : c === 1 ? 1 : 0;
      }
      uv[(v0 + i) * 2] = U0 ? U0.getComponent(i, 0) : 0.5;
      uv[(v0 + i) * 2 + 1] = U0 ? U0.getComponent(i, 1) : 0.5;
      lens[v0 + i] = isLens ? 1 : 0;
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[i0 + k] = g.index.getX(k) + v0;
    else for (let k = 0; k < P0.count; k++) idx[i0 + k] = k + v0;
    v0 += P0.count;
    i0 += g.index ? g.index.count : P0.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aLens', new THREE.BufferAttribute(lens, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

// Primitives of a loaded GLB: [{geometry (prop space, metres), material}].
function primitivesOf(gltf) {
  const out = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    let g = o.geometry;
    if (!o.matrixWorld.equals(_m.identity())) {
      g = g.clone();
      for (const k of Object.keys(g.attributes)) if (g.attributes[k].isInterleavedBufferAttribute) g.setAttribute(k, plainAttr(g.attributes[k], g.attributes[k].itemSize));
      g.applyMatrix4(o.matrixWorld);
    }
    out.push({ geometry: g, material: o.material });
  });
  return out;
}

// Cheap far shapes (prop space) whose faces take their UV from the nearest vertex of the source
// model, so they show the model's own palette / texture colours.
class Shape {
  constructor(src) {
    this.sp = src.attributes.position;
    this.su = src.attributes.uv;
    this.sl = src.attributes.aLens || null;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.lens = [];
    this.idx = [];
  }

  // UV of the source vertex nearest (x, y, z).
  uvAt(x, y, z) {
    const P = this.sp;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < P.count; i++) {
      // (Lens vertices have no palette UV.)
      if (this.sl && this.sl.getX(i) > 0.5) continue;
      const d = (P.getX(i) - x) ** 2 + (P.getY(i) - y) ** 2 + (P.getZ(i) - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return this.su ? [this.su.getX(best), this.su.getY(best)] : [0.5, 0.5];
  }

  quad(a, b, c, d, n, uv, lens = 0) {
    const v0 = this.pos.length / 3;
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.uv.push(uv[0], uv[1]);
      this.lens.push(lens);
    }
    this.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
  }

  // Axis-aligned box from y0 up; faces: {side, top, bottom} UVs; lensBottom lights the underside.
  box(cx, y0, cz, sx, sy, sz, uv, { top = uv, bottom = null, lensBottom = false } = {}) {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const y1 = y0 + sy;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], uv);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], uv);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], uv);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], uv);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], top);
    if (bottom || lensBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], bottom || uv, lensBottom ? 1 : 0);
  }

  // Upright n-sided prism (radius r) from y0 to y0 + h, with an optional cone cap of height capH.
  prism(cx, y0, cz, r, h, n, uv, capH = 0) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const p = (a, y) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      this.quad(p(a1, y0), p(a0, y0), p(a0, y0 + h), p(a1, y0 + h), [Math.cos(am), 0, Math.sin(am)], uv);
      if (capH > 0) {
        const tip = [cx, y0 + h + capH, cz];
        const k = Math.hypot(r, capH);
        this.quad(p(a1, y0 + h), p(a0, y0 + h), tip, tip, [(Math.cos(am) * capH) / k, r / k, (Math.sin(am) * capH) / k], uv);
      }
    }
  }

  // Square beam of width w from a to b (arms).
  beam(a, b, w, uv) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const side = new THREE.Vector3().crossVectors(d, _up).normalize();
    const up = new THREE.Vector3().crossVectors(side, d);
    const h = w / 2;
    const c = (p, i, j) => [p[0] + (side.x * i + up.x * j) * h, p[1] + (side.y * i + up.y * j) * h, p[2] + (side.z * i + up.z * j) * h];
    const faces = [[[1, 1], [-1, 1], up], [[-1, -1], [1, -1], up.clone().negate()], [[1, -1], [1, 1], side], [[-1, 1], [-1, -1], side.clone().negate()]];
    for (const [[i0, j0], [i1, j1], n] of faces) this.quad(c(a, i1, j1), c(a, i0, j0), c(b, i0, j0), c(b, i1, j1), [n.x, n.y, n.z], uv);
  }

  toGeometry(withLens) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (withLens) g.setAttribute('aLens', new THREE.Float32BufferAttribute(this.lens, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Far street lamp (~70 triangles instead of ~300): pole, arm(s), luminaire(s) with the lit lens
// underneath, the solar panel on top.
function lampFar(src, name) {
  const S = new Shape(src);
  const single = name === 'street_lamp_single';
  const top = single ? 8 : 10;
  const solar = name.includes('solar');
  const galv = S.uvAt(0.07, top * 0.5, 0);
  S.prism(0, 0, 0, 0.1, top + (solar ? 0.6 : 0.1), 4, galv);
  for (const [dx, dz] of single ? [[0, 1]] : [[1, 0], [-1, 0]]) {
    const tipY = top + 0.145;
    S.beam([0, top - 0.25, 0], [dx * 1.858, tipY, dz * 1.858], 0.08, galv);
    const hx = dx * (1.858 + 0.31);
    const hz = dz * (1.858 + 0.31);
    const steel = S.uvAt(hx, tipY + 0.07, hz);
    S.box(hx, tipY - 0.025, hz, dx ? 0.62 : 0.26, 0.09, dz ? 0.62 : 0.26, steel, { lensBottom: true });
  }
  if (solar) {
    const cell = S.uvAt(0, top + 0.95, 0);
    const ew = name.endsWith('_ew');
    S.box(0, top + 0.62, 0, ew ? 0.82 : 1.2, 0.05, ew ? 1.2 : 0.82, cell);
  }
  return S.toGeometry(true);
}

// Far JoJo tank (~40 triangles instead of ~950): an octagonal tank with a shallow dome, on four legs
// and a frame when it stands on its stand.
function tankFar(src, stand) {
  const S = new Shape(src);
  const z0 = stand ? 2.06 : 0;
  const green = S.uvAt(-0.7, z0 + 0.3, 0);
  S.prism(0, z0, 0, 0.72, 1.75, 8, green, 0.3);
  if (stand) {
    const rust = S.uvAt(0.79, 1.0, 0.79);
    for (const x of [-0.79, 0.79]) for (const z of [-0.79, 0.79]) S.box(x, 0, z, 0.07, 2.0, 0.07, rust);
    S.box(0, 2.0, 0, 1.6, 0.06, 1.6, rust);
  }
  return S.toGeometry(true);
}

// Bounding box of the model in its own colours (one face sample per side).
function boxFar(prims, withLens) {
  let main = prims[0];
  for (const p of prims) if (p.geometry.attributes.position.count > main.geometry.attributes.position.count) main = p;
  const bb = new THREE.Box3();
  for (const p of prims) {
    p.geometry.computeBoundingBox();
    bb.union(p.geometry.boundingBox);
  }
  const S = new Shape(main.geometry);
  const c = bb.getCenter(new THREE.Vector3());
  const sz = bb.getSize(new THREE.Vector3());
  const side = S.uvAt(bb.max.x, c.y, c.z);
  const top = S.uvAt(c.x, bb.max.y, c.z);
  S.box(c.x, bb.min.y, c.z, sz.x, sz.y, sz.z, side, { top });
  return { geometry: S.toGeometry(withLens), material: main.material };
}

// Palette material shared by every procedural prop, with the lamp lens override and night glow.
function paletteMaterial(src, uniforms) {
  const mat = src.clone();
  // The galvanised / aluminium swatches are fully metallic: without a bright environment (dusk,
  // night, phones) they read as black. Keep them part-metal so poles stay grey.
  mat.metalness = 0.5;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uLensColor = { value: LENS_COLOR };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLens;\nattribute float aLit;\nvarying float vLens;\nvarying float vLit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLens = aLens;\nvLit = aLit;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform vec3 uLensColor;\nvarying float vLens;\nvarying float vLit;')
      .replace('#include <map_fragment>', '#include <map_fragment>\nif (vLens > 0.5) diffuseColor.rgb = mix(vec3(0.55, 0.56, 0.55), uLensColor, 0.35 + 0.65 * vLit * uNight);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (vLens > 0.5) roughnessFactor = 0.3;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif (vLens > 0.5) metalnessFactor = 0.0;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uLensColor * (vLens * vLit * uNight * 7.0);');
  };
  mat.customProgramCacheKey = () => 'city-prop-palette-1';
  return mat;
}

// A set of instanced meshes (one per primitive) holding the live instances of one prop at one LOD
// level. Slots [0, n) are live; ids[slot] = instance index.
class Bucket {
  constructor(group, prims, cap, castShadow, lit, colored = false) {
    this.colored = colored;
    this.meshes = prims.map(({ geometry, material }) => {
      const g = lit ? geometry.clone() : geometry;
      const m = new THREE.InstancedMesh(g, material, cap);
      if (colored) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.visible = false;
      m.frustumCulled = false;
      m.castShadow = castShadow;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      if (lit) {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
        a.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute('aLit', a);
        m.userData.lit = a;
      }
      group.add(m);
      return m;
    });
    this.ids = new Int32Array(cap);
    this.n = 0;
    this.lo = Infinity;
    this.hi = -1;
  }

  _touch(s) {
    if (s < this.lo) this.lo = s;
    if (s > this.hi) this.hi = s;
  }

  flush() {
    const hi = Math.min(this.hi, this.n - 1);
    for (const m of this.meshes) {
      m.count = this.n;
      m.visible = this.n > 0;
      if (hi < this.lo) continue;
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(this.lo * 16, (hi - this.lo + 1) * 16);
      m.instanceMatrix.needsUpdate = true;
      const lit = m.userData.lit;
      if (lit) {
        lit.clearUpdateRanges();
        lit.addUpdateRange(this.lo, hi - this.lo + 1);
        lit.needsUpdate = true;
      }
      if (m.instanceColor) {
        m.instanceColor.clearUpdateRanges();
        m.instanceColor.addUpdateRange(this.lo * 3, (hi - this.lo + 1) * 3);
        m.instanceColor.needsUpdate = true;
      }
    }
    this.lo = Infinity;
    this.hi = -1;
  }
}

// Bucket slots hold global instance keys (field index * KEY + instance), so one bucket can be shared
// by several props (the scanned props' far boxes).
const KEY = 1 << 21;

// All instances of one prop and their LOD buckets. levels: [{dist, bucket, box?}]; a `box` level
// ({matrix (prop space -> unit box), color}) draws the instance as a coloured unit box.
class Field {
  constructor(name, data, levels, fid, registry) {
    this.name = name;
    this.fid = fid;
    this.registry = registry;
    const N = data.length / 7;
    this.N = N;
    this.x = new Float32Array(N);
    this.z = new Float32Array(N);
    this.lit = new Float32Array(N);
    this.matrices = new Float32Array(N * 16);
    this.hidden = new Uint8Array(N);
    const box = levels.find((l) => l.box)?.box;
    this.boxMatrices = box ? new Float32Array(N * 16) : null;
    this.boxColor = box?.color || null;
    for (let i = 0; i < N; i++) {
      const [x, y, z, rot, s, lit] = data.slice(i * 7, i * 7 + 6);
      this.x[i] = x;
      this.z[i] = z;
      this.lit[i] = lit;
      _q.setFromAxisAngle(_up, rot);
      _p.set(x, y, z);
      _s.setScalar(s);
      _m.compose(_p, _q, _s).toArray(this.matrices, i * 16);
      if (box) _m.multiply(box.matrix).toArray(this.boxMatrices, i * 16);
    }
    this.levels = levels.map((l) => ({ d2: l.dist * l.dist, bucket: l.bucket, box: !!l.box }));
    this.cur = new Int8Array(N).fill(-1);
    this.slot = new Int32Array(N);
  }

  _remove(b, s) {
    const last = --b.n;
    if (s !== last) {
      const moved = b.ids[last];
      b.ids[s] = moved;
      this.registry[Math.floor(moved / KEY)].slot[moved % KEY] = s;
      for (const m of b.meshes) {
        m.instanceMatrix.array.copyWithin(s * 16, last * 16, last * 16 + 16);
        const lit = m.userData.lit;
        if (lit) lit.array[s] = lit.array[last];
        if (m.instanceColor) m.instanceColor.array.copyWithin(s * 3, last * 3, last * 3 + 3);
      }
      b._touch(s);
    }
  }

  _add(b, i, box) {
    const s = b.n++;
    b.ids[s] = this.fid * KEY + i;
    this.slot[i] = s;
    const src = (box ? this.boxMatrices : this.matrices).subarray(i * 16, i * 16 + 16);
    for (const m of b.meshes) {
      m.instanceMatrix.array.set(src, s * 16);
      const lit = m.userData.lit;
      if (lit) lit.array[s] = this.lit[i];
      if (m.instanceColor && this.boxColor) this.boxColor.toArray(m.instanceColor.array, s * 3);
    }
    b._touch(s);
  }

  refresh(cx, cz) {
    const lv = this.levels;
    const L = lv.length;
    for (let i = 0; i < this.N; i++) {
      let k = -1;
      if (!this.hidden[i]) {
        const dx = this.x[i] - cx;
        const dz = this.z[i] - cz;
        const d2 = dx * dx + dz * dz;
        k = 0;
        while (k < L && d2 >= lv[k].d2) k++;
        if (k === L) k = -1;
      }
      const old = this.cur[i];
      if (old === k) continue;
      this.cur[i] = k;
      if (old >= 0) this._remove(lv[old].bucket, this.slot[i]);
      if (k >= 0) this._add(lv[k].bucket, i, lv[k].box);
    }
  }
}

// Unit-box transform and average colour of a model (the scanned props' shared far boxes).
const _avgCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function boxInfo(prims) {
  let main = prims[0];
  for (const p of prims) if (p.geometry.attributes.position.count > main.geometry.attributes.position.count) main = p;
  const bb = new THREE.Box3();
  for (const p of prims) {
    p.geometry.computeBoundingBox();
    bb.union(p.geometry.boundingBox);
  }
  const c = bb.getCenter(new THREE.Vector3());
  const size = bb.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.02, 0.02, 0.02));
  const matrix = new THREE.Matrix4().compose(c, new THREE.Quaternion(), size);
  const mat = main.material;
  const color = new THREE.Color(1, 1, 1);
  const img = mat.map?.image;
  if (img && _avgCanvas) {
    try {
      _avgCanvas.width = _avgCanvas.height = 8;
      const ctx = _avgCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      color.setRGB(r / 16320, g / 16320, b / 16320, THREE.SRGBColorSpace);
    } catch {
      // Keep white: the material colour below still applies.
    }
  }
  if (mat.color) color.multiply(mat.color);
  return { matrix, color };
}

export class PropSet {
  // level: 'low' | 'medium' | 'high'; shadows: whether the renderer draws shadow maps.
  constructor({ level = 'high', shadows = true } = {}) {
    this.level = level;
    this.shadows = shadows;
    this.range = RANGE[level] ?? 1;
    this.data = new Map();
    this.fields = [];
    this.group = new THREE.Group();
    this.group.name = 'props';
    this.group.matrixAutoUpdate = false;
    this.lastX = Infinity;
    this.lastZ = Infinity;
    this.stats = { instances: 0, models: 0, meshes: 0 };
  }

  // Records an instance: feet at (x, y, z), turned rot about Y (local +Z faces (sin rot, cos rot)),
  // uniform scale s; lit = 1 makes a street lamp's lens glow at night.
  add(name, x, y, z, rot = 0, s = 1, lit = 0) {
    if (!PROP_META[name]) throw new Error(`unknown prop ${name}`);
    if (this.skips(name)) return -1;
    let arr = this.data.get(name);
    if (!arr) this.data.set(name, (arr = []));
    arr.push(x, y, z, rot, s, lit, 0);
    return arr.length / 7 - 1;
  }

  // Whether this quality level leaves the prop out (callers skip its obstacle too).
  skips(name) {
    return this.level === 'low' && LOW_SKIP.has(name);
  }

  count(name) {
    return (this.data.get(name)?.length || 0) / 7;
  }

  // Draw levels for this quality: [{model, dist}] (phones skip the scanned props' LOD0).
  _levels(meta) {
    let lv = meta.lod.map(([model, dist]) => ({ model, dist: dist * this.range }));
    if (this.level === 'low' && !meta.pal && lv.length > 1 && lv[0].model === 'lod0') lv = lv.slice(1);
    return lv;
  }

  // GLB files a prop needs at this quality.
  _files(name) {
    const meta = PROP_META[name];
    const files = new Set();
    for (const { model } of this._levels(meta)) {
      if (model === 'lod1' || (model === 'box' && !meta.pal)) files.add(`models/props/${name}_lod1.glb`);
      else files.add(`models/props/${name}.glb`);
    }
    return [...files];
  }

  // Starts downloading the models of every prop recorded so far (cached by game.assets).
  prefetch(assets) {
    for (const name of this.data.keys()) for (const f of this._files(name)) assets.gltf(f).catch(() => {});
  }

  // Fetches the used models and builds the instanced meshes. Missing files only drop that prop.
  async load(assets, uniforms) {
    const names = [...this.data.keys()];
    const jobs = names.map(async (name) => {
      try {
        const files = {};
        for (const f of this._files(name)) files[f.endsWith('_lod1.glb') ? 'lod1' : 'lod0'] = primitivesOf(await assets.gltf(f));
        return { name, ...files };
      } catch (err) {
        console.warn(`[props] ${name} failed to load`, err);
        return null;
      }
    });
    const loaded = (await Promise.all(jobs)).filter(Boolean);
    let palette = null;
    // One shared far-box mesh for every scanned prop (instance colours).
    let boxCap = 0;
    for (const m of loaded) {
      const meta = PROP_META[m.name];
      if (!meta.pal && this._levels(meta).some((l) => l.model === 'box')) boxCap += this.data.get(m.name).length / 7;
    }
    const farBoxes = boxCap
      ? new Bucket(this.group, [{ geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }) }], boxCap, false, false, true)
      : null;
    if (farBoxes) this.stats.meshes++;
    for (const m of loaded) {
      const meta = PROP_META[m.name];
      const data = this.data.get(m.name);
      const N = data.length / 7;
      const shadow = this.shadows && !!meta.shadow;
      const levels = [];
      let palGeo = null;
      if (meta.pal) {
        const src = m.lod0.find((p) => p.material.name !== 'LampLens')?.material || m.lod0[0].material;
        palette ??= paletteMaterial(src, uniforms);
        palGeo = (prims) => mergePalette(prims.map((p) => ({ geometry: p.geometry, lens: p.material.name === 'LampLens' })));
      }
      const base = meta.pal ? palGeo(m.lod0) : null;
      this._levels(meta).forEach(({ model, dist }, k) => {
        let prims;
        if (meta.pal) {
          const geo = model === 'lod0' ? base : model === 'lod1' ? palGeo(m.lod1) : model === 'lamp' ? lampFar(base, m.name) : model === 'tank' ? tankFar(base, m.name === 'water_tank_stand') : boxFar([{ geometry: base, material: palette }], true).geometry;
          prims = [{ geometry: geo, material: palette }];
        } else if (model === 'box') {
          levels.push({ dist, bucket: farBoxes, box: boxInfo(m.lod1 || m.lod0) });
          return;
        } else {
          prims = model === 'lod0' ? m.lod0 : m.lod1;
        }
        levels.push({ dist, bucket: new Bucket(this.group, prims, N, shadow && k === 0, !!meta.pal) });
      });
      this.fields.push(new Field(m.name, data, levels, this.fields.length, this.fields));
      this.stats.instances += N;
      this.stats.models++;
      this.stats.meshes += levels.reduce((a, l) => a + (l.box ? 0 : l.bucket.meshes.length), 0);
    }
    this.lastX = Infinity;
    return this;
  }

  // Hides every instance of the given props within r of any point [{x, z}] (e.g. where the
  // pedestrian lane put its stalls). Takes effect at the next refresh.
  hideNear(names, points, r) {
    const r2 = r * r;
    let n = 0;
    for (const f of this.fields) {
      if (!names.has(f.name)) continue;
      for (let i = 0; i < f.N; i++) {
        if (f.hidden[i]) continue;
        for (const p of points) {
          const dx = f.x[i] - p.x;
          const dz = f.z[i] - p.z;
          if (dx * dx + dz * dz < r2) {
            f.hidden[i] = 1;
            n++;
            break;
          }
        }
      }
    }
    this.lastX = Infinity;
    return n;
  }

  // LOD refresh when the camera has moved a few metres.
  update(cam) {
    const dx = cam.x - this.lastX;
    const dz = cam.z - this.lastZ;
    if (dx * dx + dz * dz < 16) return;
    this.lastX = cam.x;
    this.lastZ = cam.z;
    for (const f of this.fields) f.refresh(cam.x, cam.z);
    // Upload once, after every field moved its instances (buckets can be shared).
    for (const f of this.fields) for (const l of f.levels) l.bucket.flush();
  }
}
