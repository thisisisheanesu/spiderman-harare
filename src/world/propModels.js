import * as THREE from 'three';

// Street and rooftop props from public/models/props (see its README): every placement is recorded
// with add() while the city is built (synchronously, from the metadata below), then load() fetches
// only the GLBs that are used and draws each prop as InstancedMeshes, one per primitive and LOD
// level. update(camera) moves instances between the LOD0 / LOD1 / hidden buckets as the camera
// travels (incrementally: only the instances whose level changed are copied).
//
// The procedural props (street lamps, bollards, planters, shelters, dishes, JoJo tanks, cones)
// share one palette material; the lamps' LampLens primitive is merged into the lamp geometry
// (attribute aLens) and glows at night for the instances marked lit (per-instance attribute aLit),
// so each lamp model is one draw call. Scanned props (Poly Haven) keep their own PBR materials.

// Placement metadata copied from public/models/props/props.json (placement runs before the files
// are fetched): h = model top (m), base = radius of what touches the ground (obstacles),
// anchors = web-swing points in prop space. Render settings: pal = procedural palette prop,
// near = LOD0 distance (scanned props), far = drawn up to (m, desktop high), shadow = casts shadows.
const P = (h, base, o = {}) => ({ h, base, ...o });
export const PROP_META = {
  street_lamp_single: P(8.21, 0.28, { pal: 1, far: 420, shadow: 1, anchors: [[0, 8, 0], [0, 8.145, 1.858]] }),
  street_lamp_double: P(10.21, 0.28, { pal: 1, far: 480, shadow: 1, anchors: [[0, 10, 0], [1.858, 10.145, 0], [-1.858, 10.145, 0]] }),
  street_lamp_double_solar: P(10.864, 0.28, { pal: 1, far: 480, shadow: 1, anchors: [[0, 10.9, 0], [1.858, 10.145, 0], [-1.858, 10.145, 0]] }),
  street_lamp_double_solar_ew: P(10.864, 0.28, { pal: 1, far: 480, shadow: 1, anchors: [[0, 10.9, 0], [1.858, 10.145, 0], [-1.858, 10.145, 0]] }),
  bollard_concrete: P(0.845, 0.15, { pal: 1, far: 110 }),
  bollard_painted: P(0.845, 0.15, { pal: 1, far: 120 }),
  planter_concrete: P(0.6, 0.85, { pal: 1, far: 170 }),
  bus_shelter: P(2.82, 2.48, { pal: 1, far: 280, shadow: 1, anchors: [[0, 2.75, 1.05]] }),
  satellite_dish: P(1.641, 0.354, { pal: 1, far: 230 }),
  water_tank: P(2.1, 0.931, { pal: 1, far: 430, shadow: 1 }),
  water_tank_stand: P(4.16, 1.112, { pal: 1, far: 500, shadow: 1 }),
  traffic_cone: P(0.7, 0.269, { pal: 1, far: 80 }),
  bench_timber: P(0.867, 1.27, { near: 30, far: 150, shadow: 1 }),
  bin_metal: P(0.906, 0.276, { near: 24, far: 110 }),
  barrier_concrete: P(0.831, 0.823, { near: 30, far: 170, shadow: 1 }),
  ac_unit: P(0.608, 0.402, { near: 24, far: 130 }),
  electrical_box: P(1.12, 0.489, { near: 26, far: 140 }),
  chair_monobloc: P(0.88, 0.44, { near: 20, far: 75 }),
  crate_plastic_red: P(0.267, 0.274, { near: 16, far: 60 }),
  crate_plastic_yellow: P(0.254, 0.305, { near: 16, far: 60 }),
  drum_plastic_blue: P(0.88, 0.244, { near: 20, far: 80 }),
  cardboard_box: P(0.342, 0.313, { near: 16, far: 60 }),
  plant_aloe_pot: P(0.8, 0.268, { near: 20, far: 90 }),
  plant_leafy_pot: P(0.842, 0.424, { near: 20, far: 90 }),
  trash_bag: P(0.575, 0.264, { near: 16, far: 60 }),
  tyre_old: P(0.6, 0.299, { near: 16, far: 65 }),
  manhole_cover: P(0.068, 0.345, { near: 12, far: 45 }),
};

// Draw distances per quality level (scale on `far`; low draws LOD1 only).
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

// Palette material shared by every procedural prop, with the lamp lens override and night glow.
function paletteMaterial(src, uniforms) {
  const mat = src.clone();
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
  constructor(group, prims, cap, castShadow, lit) {
    this.meshes = prims.map(({ geometry, material }) => {
      const g = lit ? geometry.clone() : geometry;
      const m = new THREE.InstancedMesh(g, material, cap);
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
    }
    this.lo = Infinity;
    this.hi = -1;
  }
}

// All instances of one prop and their LOD buckets.
class Field {
  constructor(name, data, levels) {
    this.name = name;
    const N = data.length / 7;
    this.N = N;
    this.x = new Float32Array(N);
    this.z = new Float32Array(N);
    this.lit = new Float32Array(N);
    this.matrices = new Float32Array(N * 16);
    this.hidden = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const [x, y, z, rot, s, lit] = data.slice(i * 7, i * 7 + 6);
      this.x[i] = x;
      this.z[i] = z;
      this.lit[i] = lit;
      _q.setFromAxisAngle(_up, rot);
      _p.set(x, y, z);
      _s.setScalar(s);
      _m.compose(_p, _q, _s).toArray(this.matrices, i * 16);
    }
    this.levels = levels.map((l) => ({ d2: l.dist * l.dist, bucket: l.bucket }));
    this.cur = new Int8Array(N).fill(-1);
    this.slot = new Int32Array(N);
  }

  _remove(b, s) {
    const last = --b.n;
    if (s !== last) {
      const moved = b.ids[last];
      b.ids[s] = moved;
      this.slot[moved] = s;
      for (const m of b.meshes) {
        m.instanceMatrix.array.copyWithin(s * 16, last * 16, last * 16 + 16);
        const lit = m.userData.lit;
        if (lit) lit.array[s] = lit.array[last];
      }
      b._touch(s);
    }
  }

  _add(b, i) {
    const s = b.n++;
    b.ids[s] = i;
    this.slot[i] = s;
    const src = this.matrices.subarray(i * 16, i * 16 + 16);
    for (const m of b.meshes) {
      m.instanceMatrix.array.set(src, s * 16);
      const lit = m.userData.lit;
      if (lit) lit.array[s] = this.lit[i];
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
      if (k >= 0) this._add(lv[k].bucket, i);
    }
    for (const l of lv) l.bucket.flush();
  }
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
    let arr = this.data.get(name);
    if (!arr) this.data.set(name, (arr = []));
    arr.push(x, y, z, rot, s, lit, 0);
    return arr.length / 7 - 1;
  }

  count(name) {
    return (this.data.get(name)?.length || 0) / 7;
  }

  // Starts downloading the models of every prop recorded so far (cached by game.assets).
  prefetch(assets) {
    for (const name of this.data.keys()) {
      assets.gltf(`models/props/${name}.glb`).catch(() => {});
      if (!PROP_META[name].pal && this.level !== 'high') continue;
      if (!PROP_META[name].pal) assets.gltf(`models/props/${name}_lod1.glb`).catch(() => {});
    }
  }

  // Fetches the used models and builds the instanced meshes. Missing files only drop that prop.
  async load(assets, uniforms) {
    const low = this.level === 'low';
    const names = [...this.data.keys()];
    const jobs = names.map(async (name) => {
      const meta = PROP_META[name];
      try {
        if (meta.pal) return { name, lod0: primitivesOf(await assets.gltf(`models/props/${name}.glb`)) };
        const lod1 = primitivesOf(await assets.gltf(`models/props/${name}_lod1.glb`));
        const lod0 = low ? null : primitivesOf(await assets.gltf(`models/props/${name}.glb`));
        return { name, lod0, lod1 };
      } catch (err) {
        console.warn(`[props] ${name} failed to load`, err);
        return null;
      }
    });
    const loaded = (await Promise.all(jobs)).filter(Boolean);
    let palette = null;
    for (const m of loaded) {
      const meta = PROP_META[m.name];
      const data = this.data.get(m.name);
      const N = data.length / 7;
      const far = meta.far * this.range;
      const shadow = this.shadows && !!meta.shadow;
      let levels;
      if (meta.pal) {
        const src = m.lod0.find((p) => p.material.name !== 'LampLens')?.material || m.lod0[0].material;
        palette ??= paletteMaterial(src, uniforms);
        const geo = mergePalette(m.lod0.map((p) => ({ geometry: p.geometry, lens: p.material.name === 'LampLens' })));
        levels = [{ dist: far, bucket: new Bucket(this.group, [{ geometry: geo, material: palette }], N, shadow, true) }];
      } else if (low) {
        levels = [{ dist: far, bucket: new Bucket(this.group, m.lod1, N, false, false) }];
      } else {
        levels = [
          { dist: meta.near * this.range, bucket: new Bucket(this.group, m.lod0, N, shadow, false) },
          { dist: far, bucket: new Bucket(this.group, m.lod1, N, false, false) },
        ];
      }
      this.fields.push(new Field(m.name, data, levels));
      this.stats.instances += N;
      this.stats.models++;
      this.stats.meshes += levels.reduce((a, l) => a + l.bucket.meshes.length, 0);
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
  }
}
