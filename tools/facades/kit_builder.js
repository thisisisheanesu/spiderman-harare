// Reference builder for the Harare facade kit (public/models/facades), three.js r186.
// Plain ES module; depends on three.js and tools/materials/interior_glass.js. Copy into src/world/ when
// integrating (the city renderer can also port the algorithm to its own GeoBuffer / texture-array path).
//
//   import { FacadeKit } from './kit_builder.js';
//   const kit = await FacadeKit.load({ base: 'models/facades/', textures: 'textures/', gltfLoader, renderer });
//   const b = kit.build(building.fp, building.h, { type: 'brick', seed: building.id });
//   scene.add(b.lod);                      // THREE.LOD: LOD0 modules (< 60 m), LOD1 atlas quads, LOD2 impostor walls
//   kit.setNight(sky.nightFactor);         // lit windows (interior glass + atlas / impostor masks)
//
// What build() does (see public/models/facades/README.md "Assembling a building"):
//   1. floors: ground floor + N middle floors + cap, stretched to the footprint height (planFloors)
//   2. ring orientation so that walking A->B the street side is on the left (outward normal = (-dz, 0, dx)),
//      corners: ~90 deg convex corners get the type's corner module, other corners are trimmed and filled with piers
//   3. each edge: bays of width L / n within the modules' stretch range; module columns are consistent up the
//      facade; short end walls of slabs become blank walls
//   4. LOD0: every placed module is transformed (stretch + wall frame), its metre UVs re-projected so textures run
//      continuously along the wall and up the floors, and merged per material (one draw call per PBR set)
//   5. attachments from common.glb: window AC units on anchors.ac, burglar bars, shop shutters, downpipes,
//      pavement canopies / colonial verandahs
//   6. LOD1: the modules' .lod1 quads (atlas) merged into one mesh; LOD2: plain wall strips with the impostor texture
import * as THREE from 'three';
import { createInteriorGlassMaterial } from '../materials/interior_glass.js';

const TMP = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------------------------------------
function hash32(...xs) {
  let h = 0x811c9dc5;
  for (const x of xs) {
    let v = typeof x === 'number' ? Math.floor(x * 1000) | 0 : String(x).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
    for (let i = 0; i < 4; i++) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      v >>>= 8;
    }
  }
  return h >>> 0;
}
const hash01 = (...xs) => hash32(...xs) / 4294967296;

function makeRng(seed) {
  let s = hash32('facade', seed) || 1;
  const r = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  r.pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  r.weighted = (w) => {
    const keys = Object.keys(w).filter((k) => w[k] > 0);
    let t = keys.reduce((a, k) => a + w[k], 0) * r();
    for (const k of keys) {
      t -= w[k];
      if (t <= 0) return k;
    }
    return keys[keys.length - 1];
  };
  return r;
}

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexLin = (h) => [1, 3, 5].map((i) => srgbToLin(parseInt(h.slice(i, i + 2), 16) / 255));

// Growable per-material vertex buffer.
class Batch {
  constructor(opts = {}) {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = opts.color ? [] : null;
    this.uv1 = opts.glass ? [] : null;
    this.wd = opts.glass ? [] : null;
    this.tint = opts.tint ? [] : null;
    this.idx = [];
    this.n = 0;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv1) g.setAttribute('winUv', new THREE.Float32BufferAttribute(this.uv1, 2));
    if (this.wd) g.setAttribute('winData', new THREE.Float32BufferAttribute(this.wd, 4));
    if (this.tint) {
      for (let k = 0; k < 3; k++) {
        g.setAttribute('aTint' + k, new THREE.Float32BufferAttribute(this.tint.filter((_, i) => Math.floor(i / 3) % 3 === k), 3));
      }
    }
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// Geometry of one glTF primitive as plain arrays (float normals).
function extractPart(mesh) {
  const g = mesh.geometry;
  const pa = g.attributes.position;
  const na = g.attributes.normal;
  const ua = g.attributes.uv;
  const u1 = g.attributes.uv1;
  const n = pa.count;
  const part = { pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), uv: new Float32Array(n * 2), uv1: u1 ? new Float32Array(n * 2) : null };
  for (let i = 0; i < n; i++) {
    part.pos[i * 3] = pa.getX(i);
    part.pos[i * 3 + 1] = pa.getY(i);
    part.pos[i * 3 + 2] = pa.getZ(i);
    part.nrm[i * 3] = na.getX(i);
    part.nrm[i * 3 + 1] = na.getY(i);
    part.nrm[i * 3 + 2] = na.getZ(i);
    if (ua) {
      part.uv[i * 2] = ua.getX(i);
      part.uv[i * 2 + 1] = ua.getY(i);
    }
    if (u1) {
      part.uv1[i * 2] = u1.getX(i);
      part.uv1[i * 2 + 1] = u1.getY(i);
    }
  }
  part.index = g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i);
  part.count = n;
  return part;
}

// ---------------------------------------------------------------------------------------------------------
// the kit
// ---------------------------------------------------------------------------------------------------------
export class FacadeKit {
  static async load({ base = 'models/facades/', textures = 'textures/', gltfLoader, textureLoader = new THREE.TextureLoader(),
    renderer = null, types = null } = {}) {
    const kit = new FacadeKit();
    kit.base = base;
    kit.texBase = textures;
    kit.textureLoader = textureLoader;
    kit.maxAniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
    kit.json = await (await fetch(base + 'kit.json')).json();
    // every PBR set of public/textures (so per-building material overrides can use any of them)
    const lib = await (await fetch(textures + 'materials.json')).json().catch(() => ({ materials: [] }));
    for (const m of lib.materials) {
      if (!kit.json.materials[m.name]) {
        kit.json.materials[m.name] = { files: m.files, tileSizeMetres: m.tileSizeMetres, avgColor: m.avgColor, avgColorLinear: m.avgColorLinear };
      }
    }
    kit.modules = {};
    const load = async (name, file) => {
      const gltf = await gltfLoader.loadAsync(base + file);
      gltf.scene.updateMatrixWorld(true);
      return [name, gltf.scene];
    };
    const wanted = types || Object.keys(kit.json.types);
    const scenes = Object.fromEntries(await Promise.all([
      load('common', kit.json.common.file),
      ...wanted.map((t) => load(t, kit.json.types[t].file)),
    ]));
    const grab = (scene, nodeName) => {
      const obj = scene.getObjectByName(nodeName);
      if (!obj) return null;
      const parts = [];
      obj.traverse((o) => {
        if (!o.isMesh) return;
        const role = o.material.userData.role || o.material.name;
        parts.push({ role, material: o.material, ...extractPart(o) });
      });
      return parts;
    };
    for (const [t, scene] of Object.entries(scenes)) {
      const defs = t === 'common' ? kit.json.common.modules : kit.json.types[t].modules;
      kit.modules[t] = {};
      for (const [key, m] of Object.entries(defs)) {
        kit.modules[t][key] = { meta: m, lod0: grab(scene, m.node), lod1: m.lod1Node ? grab(scene, m.lod1Node) : null };
      }
    }
    kit.materials = new Map();
    kit.night = 0;
    kit._atlasMats = {};
    return kit;
  }

  // --- materials ---------------------------------------------------------------------------------------
  tex(url, { srgb = false, repeat = null, flipY = true } = {}) {
    const key = url + (srgb ? '#s' : '') + (flipY ? '' : '#f');
    if (!this._tex) this._tex = new Map();
    let t = this._tex.get(key);
    if (!t) {
      t = this.textureLoader.load(url);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = this.maxAniso;
      t.flipY = flipY;
      if (repeat) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repeat[0], repeat[1]);
      }
      this._tex.set(key, t);
    }
    return t;
  }

  pbrMaterial(name, { metal = 1 } = {}) {
    const key = 'pbr:' + name + ':' + metal;
    if (this.materials.has(key)) return this.materials.get(key);
    const e = this.json.materials[name];
    const rep = [1 / e.tileSizeMetres[0], 1 / e.tileSizeMetres[1]];
    const orm = this.tex(this.texBase + e.files.orm, { repeat: rep });
    const mat = new THREE.MeshStandardMaterial({
      map: this.tex(this.texBase + e.files.albedo, { srgb: true, repeat: rep }),
      normalMap: this.tex(this.texBase + e.files.normal, { repeat: rep }),
      roughnessMap: orm, metalnessMap: orm, aoMap: orm,
      roughness: 1, metalness: metal, vertexColors: true,
    });
    mat.name = name;
    this.materials.set(key, mat);
    return mat;
  }

  glassMaterial(tintHex) {
    const key = 'glass:' + tintHex;
    if (this.materials.has(key)) return this.materials.get(key);
    const tb = this.texBase + 'glass/';
    const mat = createInteriorGlassMaterial({
      atlas: this.tex(tb + 'interiors_atlas.webp', { srgb: true }),
      glassNormal: this.tex(tb + 'window_glass_normal.webp', { repeat: [1 / 3, 1 / 3] }),
      glassOrm: this.tex(tb + 'window_glass_orm.webp', { repeat: [1 / 3, 1 / 3] }),
      glassGrime: null,
      tint: new THREE.Color(tintHex),
    });
    mat.userData.interior.uDarkLevel.value = 1.0;
    this.materials.set(key, mat);
    return mat;
  }

  simpleMaterial(key, params) {
    if (this.materials.has(key)) return this.materials.get(key);
    const mat = new THREE.MeshStandardMaterial(params);
    mat.name = key;
    this.materials.set(key, mat);
    return mat;
  }

  // LOD1 atlas / LOD2 impostor material: re-tint by the mask texture + lit windows at night.
  atlasMaterial(t, which) {
    const key = which + ':' + t;
    if (this.materials.has(key)) return this.materials.get(key);
    const A = this.json.types[t][which];
    const b = this.base;
    const rep = which === 'impostor' ? [1, 1] : null;
    const mk = (f, srgb) => {
      const tx = this.tex(b + f, { srgb, flipY: false, repeat: rep });
      if (which === 'impostor') tx.wrapT = THREE.ClampToEdgeWrapping;
      return tx;
    };
    const orm = mk(A.orm, false);
    const mat = new THREE.MeshStandardMaterial({ map: mk(A.albedo, true), normalMap: mk(A.normal, false), roughnessMap: orm,
      metalnessMap: orm, aoMap: orm, roughness: 1, metalness: 1 });
    const mask = mk(A.mask, false);
    const uniforms = { uMask: { value: mask }, uNight: { value: 0 } };
    mat.userData.uniforms = uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 aTint0; attribute vec3 aTint1; attribute vec3 aTint2; attribute float aSeed;
varying vec3 vT0; varying vec3 vT1; varying vec3 vT2; varying float vSeed; varying vec3 vFacWorld;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vT0 = aTint0; vT1 = aTint1; vT2 = aTint2; vSeed = aSeed;
vFacWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uMask; uniform float uNight;
varying vec3 vT0; varying vec3 vT1; varying vec3 vT2; varying float vSeed; varying vec3 vFacWorld;
float facHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
vec4 facMask = texture2D(uMask, vMapUv);
diffuseColor.rgb *= 1.0 + facMask.r * (vT0 - 1.0) + facMask.g * (vT1 - 1.0) + facMask.b * (vT2 - 1.0);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 cell = floor(vec3(vFacWorld.x / 1.6, vFacWorld.y / 3.4, vFacWorld.z / 1.6));
  float lit = step(0.55, facHash(cell + vSeed));
  totalEmissiveRadiance += facMask.a * lit * uNight * vec3(1.0, 0.82, 0.55) * 0.9;
}`);
    };
    mat.customProgramCacheKey = () => 'facadeAtlas';
    this.materials.set(key, mat);
    return mat;
  }

  setNight(f) {
    this.night = f;
    for (const [key, m] of this.materials) {
      if (m.userData.uniforms) m.userData.uniforms.uNight.value = f;
      if (m.userData.interior) {
        m.userData.interior.uDarkLevel.value = THREE.MathUtils.lerp(1.0, 0.04, f);
        m.userData.interior.uExposure.value = THREE.MathUtils.lerp(0.5, 1.2, f);
      }
      if (key.startsWith('sign')) m.emissiveIntensity = f * 0.6;
    }
  }

  // --- planning ----------------------------------------------------------------------------------------
  planFloors(h, T) {
    const Hg0 = T.groundFloor;
    const H0 = T.floor;
    let hc = T.cap;
    if (h < Hg0 + hc + 1.2) {
      hc = Math.min(hc, Math.max(0.5, h * 0.16));
      return { Hg: Math.max(2.4, h - hc), H: H0, n: 0, hc };
    }
    let n = Math.max(0, Math.round((h - Hg0 - hc) / H0));
    let Hg = Hg0;
    let H = n ? (h - Hg - hc) / n : H0;
    if (n && (H < 2.9 || H > 4.3)) {
      H = THREE.MathUtils.clamp(H, 2.9, 4.3);
      Hg = h - hc - n * H;
      if (Hg < 3.4 || Hg > 5.8) {
        n = Math.max(1, Math.round((h - hc - Hg0) / H0));
        Hg = THREE.MathUtils.clamp(h - hc - n * H0, 3.4, 5.8);
        H = (h - hc - Hg) / n;
      }
    }
    if (!n) Hg = h - hc;
    return { Hg, H, n, hc };
  }

  pickTints(t, rng, override = {}) {
    const T = this.json.types[t];
    const tints = {};
    for (const [role, info] of Object.entries(T.materials)) {
      const pal = T.palette?.[role];
      tints[role] = override[role] || (pal && rng() < 0.75 ? rng.pick(pal) : info.tint) || null;
    }
    return tints;
  }

  // role -> {pbr, tint}: the type's default, or opts.materials[role] = [pbrName, tintHex] of this building
  roleInfo(t, role, overrides = null) {
    const o = overrides?.[role];
    if (o) return { pbr: o[0], tint: o[1] || null };
    return this.json.types[t].materials[role] || this.json.common.materials[role] || null;
  }

  // colour multiplier for a role (linear, relative to the PBR texture's mean albedo)
  roleFactor(t, role, tints, overrides = null) {
    const info = this.roleInfo(t, role, overrides);
    if (!info) return [1, 1, 1];
    const hex = (overrides?.[role] ? info.tint : tints[role]) || info.tint;
    const m = this.json.materials[info.pbr];
    if (!hex || !m || ['glass', 'glass_spandrel', 'sign'].includes(role)) return [1, 1, 1];
    const l = hexLin(hex);
    return l.map((v, i) => v / Math.max(1e-4, m.avgColorLinear[i]));
  }

  // --- building ----------------------------------------------------------------------------------------
  build(fp, height, opts = {}) {
    const t = opts.type || 'brick';
    const T = this.json.types[t];
    const R = T.rules;
    const rng = makeRng(opts.seed ?? 1);
    const seed = hash01('b', opts.seed ?? 1);
    const tints = this.pickTints(t, rng, opts.tints || {});
    const plan = this.planFloors(height, T);
    const mods = this.modules[t];
    const common = this.modules.common;
    const out = { lod0: new Map(), lod1: new Map(), imp: new Map(), placements: [], stats: { modules: 0 } };

    // ring: drop closing duplicate, orient so the outward normal of A->B is (-dz, 0, dx)
    let pts = [];
    for (let i = 0; i < fp.length; i += 2) pts.push(new THREE.Vector2(fp[i], fp[i + 1]));
    if (pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-3) pts.pop();
    pts = pts.filter((p, i) => p.distanceTo(pts[(i + 1) % pts.length]) > 0.05);
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b2 = pts[(i + 1) % pts.length];
      area += a.x * b2.y - b2.x * a.y;
    }
    if (area > 0) pts.reverse();
    const N = pts.length;
    const edges = pts.map((a, i) => {
      const b2 = pts[(i + 1) % N];
      const d = b2.clone().sub(a);
      const L = d.length();
      d.divideScalar(L);
      return { a, b: b2, d, L, n: new THREE.Vector2(-d.y, d.x), trim0: 0, trim1: 0, corner: null };
    });
    const longest = Math.max(...edges.map((e) => e.L));
    const cornerMeta = mods.corner?.meta;
    const maxOut = Math.max(0.2, ...Object.values(mods).filter((m) => m.meta.kind === 'bay').map((m) => m.meta.depth?.out || 0.1));
    for (let i = 0; i < N; i++) {
      const e0 = edges[i];
      const e1 = edges[(i + 1) % N];
      const cross = e0.d.x * e1.d.y - e0.d.y * e1.d.x;
      const dot = e0.d.dot(e1.d);
      const angle = Math.acos(THREE.MathUtils.clamp(-dot, -1, 1)) * 180 / Math.PI; // interior angle for convex
      if (dot > 0.985) continue; // nearly straight: no corner treatment
      if (cross < 0 && Math.abs(angle - 90) < 20 && cornerMeta && e0.L > 2 && e1.L > 2) {
        const a = cornerMeta.width;
        e0.trim1 = a;
        e1.trim0 = a;
        e1.corner = true;
      } else if (cross < 0) {
        e0.trim1 = Math.min(0.3, e0.L / 4);
        e1.trim0 = Math.min(0.3, e1.L / 4);
      } else {
        const tr = Math.min(maxOut + 0.05, e0.L / 4, e1.L / 4);
        e0.trim1 = Math.max(e0.trim1, tr);
        e1.trim0 = Math.max(e1.trim0, tr);
      }
    }

    // vertical bands
    const bands = [];
    bands.push({ kind: 'ground', z: 0, h: plan.Hg, floor: 0 });
    for (let k = 0; k < plan.n; k++) bands.push({ kind: 'middle', z: plan.Hg + k * plan.H, h: plan.H, floor: k + 1 });
    bands.push({ kind: 'top', z: height - plan.hc, h: plan.hc, floor: plan.n + 1 });

    // column pattern for middle floors
    const midKeys = Object.keys(R.middle).filter((k) => R.middle[k] > 0 && mods[k]);
    let main = rng.weighted(R.middle);
    if (R.middle_alt && rng() < 0.3) main = rng.weighted(R.middle_alt);
    let pattern = [main];
    if (t === 'avenues') pattern = [main, rng.weighted(R.middle)];
    else if (midKeys.length > 1 && rng() < 0.25) pattern = [main, main, rng.pick(midKeys)];
    if (opts.middle) pattern = [].concat(opts.middle); // e.g. ['bay_hood'] or ['bay_balcony', 'bay_window']
    const canopyOn = opts.canopy ?? rng() < (R.canopy || 0);
    const verandahOn = opts.verandah ?? rng() < (R.verandah || 0);
    const att = R.attachments || {};

    const frame = (e, s, z) => {
      const X = new THREE.Vector3(e.d.x, 0, e.d.y);
      const Z = new THREE.Vector3(e.n.x, 0, e.n.y);
      const O = new THREE.Vector3(e.a.x + e.d.x * s, z, e.a.y + e.d.y * s);
      return { X, Z, O };
    };
    const place = (t2, key, e, s, z, w, h, info = {}) => {
      const mod = this.modules[t2][key];
      if (!mod) return;
      const m = mod.meta;
      const sx = m.width && w > 0 ? w / m.width : 1;
      const sy = m.height && h > 0 ? h / m.height : 1;
      const { X, Z, O } = frame(e, s, z);
      if (info.dy) O.y += info.dy;
      if (info.out) O.addScaledVector(Z, info.out);
      const M = new THREE.Matrix4().makeBasis(X, new THREE.Vector3(0, 1, 0), Z).scale(new THREE.Vector3(info.mirror ? -sx : sx, sy, 1)).setPosition(O);
      out.placements.push({ t: t2, key, M, sx, sy, u0: (e.u0 || 0) + s, v0: z, floor: info.floor ?? 0, bay: info.bay ?? 0, lodOnly: info.lodOnly });
      out.stats.modules++;
    };

    let perim = 0;
    edges.forEach((e, ei) => {
      e.u0 = perim;
      perim += e.L;
      const span = e.L - e.trim0 - e.trim1;
      const endWall = e.L < longest * 0.35 && ['ribbon', 'fins', 'eggcrate', 'avenues'].includes(t) && longest > 12;
      // bays
      let bays = [];
      if (span > 0.05) {
        if (span < T.bay * 0.6) bays = [{ s: e.trim0, w: span, filler: true }];
        else {
          let n = Math.max(1, Math.round(span / T.bay));
          const bw = span / n;
          for (let k = 0; k < n; k++) bays.push({ s: e.trim0 + k * bw, w: bw });
        }
      }
      // corner module at the start of this edge (covers all bands, stretched to the full height)
      if (e.corner && mods.corner) place(t, 'corner', e, 0, 0, mods.corner.meta.width, height, { floor: 0 });
      // trims without a corner: flat piers
      const pierKey = mods.pier ? 'pier' : 'blank';
      for (const [s0, w0] of [[0, e.corner ? 0 : e.trim0], [e.L - e.trim1, e.trim1]]) {
        if (w0 > 0.02) place(t, pierKey, e, s0, 0, w0, height - (mods[pierKey].meta.kind === 'pier' ? 0 : 0), { floor: 0 });
      }
      // ground floor choices (one entrance per long edge)
      const nb = bays.length;
      const entranceAt = nb >= 3 && R.ground.entrance ? Math.floor(nb / 2) : -1;
      bays.forEach((bay, bi) => {
        const colKey = pattern[bi % pattern.length];
        for (const band of bands) {
          let key;
          if (bay.filler) key = band.kind === 'top' ? 'cap' : pierKey;
          else if (band.kind === 'ground') {
            if (endWall && mods.ground_blank) key = 'ground_blank';
            else if (bi === entranceAt && mods.entrance) key = 'entrance';
            else {
              const g = { ...(opts.ground || R.ground) };
              delete g.entrance;
              key = rng.weighted(g);
            }
          } else if (band.kind === 'middle') key = endWall ? (R.end_wall || 'blank') : colKey;
          else key = (R.top_centre && bi === Math.floor(nb / 2) && e.L === longest) ? R.top_centre : R.top;
          if (!mods[key]) key = band.kind === 'ground' ? Object.keys(R.ground).find((k) => mods[k]) : key;
          if (band.kind === 'ground' && t === 'deco' && key === 'arcade') {
            // arcades come in runs: close the run ends
            const prevArc = bay.prevArcade;
            if (!prevArc && mods.arcade_end) place(t, 'arcade_end', e, bay.s, 0, 0, band.h, { floor: 0 });
            bays[bi + 1] && (bays[bi + 1].prevArcade = true);
            bay.arcade = true;
          } else if (band.kind === 'ground' && bay.prevArcade && mods.arcade_end) {
            place(t, 'arcade_end', e, bay.s, 0, 0, band.h, { floor: 0, mirror: true });
          }
          const w = bay.w;
          place(t, key, e, bay.s, band.z, w, band.h, { floor: band.floor, bay: bi });
          const mm = mods[key]?.meta;
          if (!mm) continue;
          // attachments
          const a = mm.anchors || {};
          const hh = hash01(seed, ei, bi, band.floor);
          const sx = mm.width ? w / mm.width : 1;
          const sy = mm.height ? band.h / mm.height : 1;
          if (band.kind === 'middle' && a.ac && hh < (att.ac || 0)) {
            const p = a.ac[Math.floor(hash01(hh, 3) * a.ac.length)];
            place('common', hash01(hh, 5) < 0.8 ? 'ac_window' : 'ac_split', e, bay.s + p[0] * sx, band.z + (hash01(hh, 5) < 0.8 ? p[1] * sy : 0.35), 0, 0,
              { out: hash01(hh, 5) < 0.8 ? p[2] : 0, floor: band.floor });
          }
          if (a.bars && band.floor <= 1 && hash01(hh, 7) < (att.bars || 0) * (band.floor === 0 ? 1.5 : 1)) {
            for (const r of a.bars) place('common', 'bars', e, bay.s + r.x0 * sx, band.z + r.y0 * sy, (r.x1 - r.x0) * sx, (r.y1 - r.y0) * sy, { out: 0.0, floor: band.floor });
          }
          if (band.kind === 'ground' && a.shutter && hash01(hh, 11) < (opts.closedShops ?? 0.15)) {
            const r = a.shutter[0];
            place('common', 'shutter', e, bay.s + r.x0 * sx, r.y0, (r.x1 - r.x0) * sx, (r.y1 - r.y0) * sy + 0.35, { out: r.z + 0.02, floor: 0 });
          }
          if (band.kind === 'ground' && canopyOn && !endWall && (key === 'shop' || key === 'entrance' || key === 'lobby') && common.canopy) {
            place('common', 'canopy', e, bay.s, band.h - 0.55, w, common.canopy.meta.height, { floor: 0 });
          }
          if (band.kind === 'ground' && verandahOn && mods.verandah && e.L === longest && key.startsWith('shop')) {
            place(t, 'verandah', e, bay.s, 0, w, Math.max(3.2, band.h - 0.3), { floor: 0 });
            if (bi === nb - 1 && mods.verandah_post) place(t, 'verandah_post', e, bay.s + w, 0, 0, (Math.max(3.2, band.h - 0.3)) * mods.verandah_post.meta.height / mods.verandah.meta.height, { floor: 0 });
          }
        }
      });
      // downpipes every att.pipe metres at bay joints
      if (att.pipe && nb > 1 && height < 45) {
        let next = att.pipe * (0.5 + hash01(seed, ei, 'p'));
        for (let bi = 1; bi < nb; bi++) {
          const s = bays[bi].s;
          if (s < next) continue;
          next = s + att.pipe;
          const top = height - plan.hc - 0.25;
          place('common', 'downpipe_shoe', e, s, 0, 0, 0, { floor: 0, out: 0.0 });
          place('common', 'downpipe', e, s, 0.3, 0, top - 0.6, { floor: 0 });
          place('common', 'downpipe_hopper', e, s, top - 0.35, 0, 0, { floor: 0 });
        }
      }
    });

    // --- assemble ---
    const lod0 = new Map();
    const lod1 = new Map();
    const ovr = opts.materials || null;
    const ftint = [0, 1, 2].map((k) => this.roleFactor(t, ['wall', 'trim', 'accent'][k], tints, ovr));
    const ftintDef = [0, 1, 2].map((k) => this.roleFactor(t, ['wall', 'trim', 'accent'][k], {}));
    const atlasTint = ftint.map((f, k) => f.map((v, i) => v / ftintDef[k][i]));
    const cells = { office: [0, 1, 1, 0, 7], shop: [4, 5, 6, 7, 4], residential: [2, 3, 2, 3], lobby: [0, 4] };
    for (const P of out.placements) {
      const mod = this.modules[P.t][P.key];
      const M = P.M;
      const det = M.determinant();
      const nm = new THREE.Matrix3().getNormalMatrix(M);
      for (const lvl of [0, 1]) {
        const parts = lvl === 0 ? mod.lod0 : mod.lod1;
        if (!parts) continue;
        for (const part of parts) {
          const role = part.role;
          let bkey;
          let material;
          const isExt = !this.json.types[t].materials[role] && !this.json.common.materials[role] && role !== 'atlas';
          if (role === 'atlas') {
            bkey = 'atlas';
            material = () => this.atlasMaterial(t, 'atlas');
          } else if (isExt) {
            bkey = 'ext:' + part.material.uuid;
            material = () => part.material;
          } else if (role === 'glass') {
            const hex = tints.glass || this.json.types[t].materials.glass.tint;
            bkey = 'glass:' + hex;
            material = () => this.glassMaterial(hex);
          } else if (role === 'glass_spandrel') {
            const hex = this.json.types[t].materials.glass_spandrel?.tint || '#3d5a78';
            bkey = 'spandrel:' + hex;
            material = () => this.simpleMaterial('spandrel:' + hex, { color: new THREE.Color(hex).multiplyScalar(0.35), roughness: 0.08, metalness: 0.3 });
          } else if (role === 'sign') {
            bkey = 'sign';
            material = () => opts.signMaterial || this.simpleMaterial('sign', { color: 0xe6e2d6, roughness: 0.6, emissive: 0xfff2d0, emissiveIntensity: 0 });
          } else {
            const info = this.roleInfo(t, role, ovr);
            bkey = 'pbr:' + info.pbr + (role === 'frame' || role === 'metal' ? ':m' : '');
            material = () => this.pbrMaterial(info.pbr, { metal: role === 'frame' || role === 'metal' ? 0.35 : 1 });
          }
          const target = lvl === 0 ? lod0 : lod1;
          let B = target.get(bkey);
          if (!B) {
            B = new Batch({ color: bkey.startsWith('pbr'), glass: bkey.startsWith('glass'), tint: bkey === 'atlas' });
            B.material = material;
            target.set(bkey, B);
          }
          const tf = bkey.startsWith('pbr') ? this.roleFactor(t, role, tints, ovr) : null;
          const metres = bkey.startsWith('pbr') || bkey.startsWith('glass');
          const base = B.n;
          for (let i = 0; i < part.count; i++) {
            TMP.set(part.pos[i * 3], part.pos[i * 3 + 1], part.pos[i * 3 + 2]).applyMatrix4(M);
            B.pos.push(TMP.x, TMP.y, TMP.z);
            const lx = part.nrm[i * 3];
            const ly = part.nrm[i * 3 + 1];
            TMP.set(lx, ly, part.nrm[i * 3 + 2]).applyMatrix3(nm).normalize();
            B.nrm.push(TMP.x, TMP.y, TMP.z);
            let u = part.uv[i * 2];
            let v = part.uv[i * 2 + 1];
            if (metres && P.t !== 'common' || (metres && P.key === 'canopy')) {
              if (Math.abs(ly) > 0.7) u = u * P.sx + P.u0;
              else if (Math.abs(lx) > 0.7) v = v * P.sy + P.v0;
              else {
                u = u * P.sx + P.u0;
                v = v * P.sy + P.v0;
              }
            }
            B.uv.push(u, v);
            if (B.col) B.col.push(...(tf || [1, 1, 1]));
            if (B.tint) B.tint.push(...atlasTint[0], ...atlasTint[1], ...atlasTint[2]);
            if (B.uv1) {
              const x = part.uv1 ? part.uv1[i * 2] : 0;
              const room = Math.floor(x / 2 + 1e-4);
              B.uv1.push(x - room * 2, part.uv1 ? part.uv1[i * 2 + 1] : 0);
              const hr = hash32(seed, P.floor, P.bay, room, P.u0 | 0);
              const kind = mod.meta.interior || 'office';
              const list = cells[kind] || this.json.types[t].glassCells;
              const cell = list[hr % list.length];
              B.wd.push(cell, (hr >>> 8) & 1, ((hr >>> 12) & 255) / 255 > 0.45 ? 1 : 0, this.json.types[t].roomDepth);
            }
          }
          if (B.tint) B.aSeed = seed;
          const idx = part.index;
          if (det < 0) {
            for (let k = 0; k < idx.length; k += 3) B.idx.push(base + idx[k], base + idx[k + 2], base + idx[k + 1]);
          } else {
            for (let k = 0; k < idx.length; k++) B.idx.push(base + idx[k]);
          }
          B.n += part.count;
        }
      }
    }
    const toGroup = (batches, name) => {
      const g = new THREE.Group();
      g.name = name;
      let tris = 0;
      for (const [k, B] of batches) {
        if (!B.n) continue;
        const geo = B.geometry();
        if (B.tint) geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(B.n).fill(seed * 100), 1));
        const mesh = new THREE.Mesh(geo, B.material());
        mesh.name = name + ':' + k;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        g.add(mesh);
        tris += B.idx.length / 3;
      }
      g.userData.tris = tris;
      return g;
    };
    const g0 = toGroup(lod0, 'lod0');
    const g1 = toGroup(lod1, 'lod1');
    const g2 = this.buildImpostor(t, edges, plan, height, atlasTint, seed);
    const lod = new THREE.LOD();
    lod.addLevel(g0, 0);
    lod.addLevel(g1, opts.lod1Distance ?? 60);
    lod.addLevel(g2, opts.lod2Distance ?? 220);
    return { lod, lod0: g0, lod1: g1, lod2: g2, plan, tints, stats: { ...out.stats, tris: [g0.userData.tris, g1.userData.tris, g2.userData.tris], drawCalls: [g0.children.length, g1.children.length, g2.children.length] } };
  }

  // LOD2: plain wall strips per edge textured with the impostor elevation (2 bays wide, ground / 2 middle / cap)
  buildImpostor(t, edges, plan, height, atlasTint, seed) {
    const I = this.json.types[t].impostor;
    const T = this.json.types[t];
    const B = new Batch({ tint: true });
    const quad = (e, s0, s1, z0, z1, u0, u1, v0, v1) => {
      const base = B.n;
      const P = (s, z) => [e.a.x + e.d.x * s, z, e.a.y + e.d.y * s];
      for (const [s, z, u, v] of [[s0, z0, u0, v1], [s1, z0, u1, v1], [s1, z1, u1, v0], [s0, z1, u0, v0]]) {
        B.pos.push(...P(s, z));
        B.nrm.push(e.n.x, 0, e.n.y);
        B.uv.push(u, v);
        B.tint.push(...atlasTint[0], ...atlasTint[1], ...atlasTint[2]);
      }
      B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      B.n += 4;
    };
    for (const e of edges) {
      const n = Math.max(1, Math.round(e.L / T.bay));
      const uMax = n / I.bays;
      const rows = I.rows;
      quad(e, 0, e.L, 0, plan.Hg, 0, uMax, rows.ground[0], rows.ground[1]);
      for (let k = 0; k < plan.n; k += 2) {
        const z0 = plan.Hg + k * plan.H;
        if (k + 1 < plan.n) quad(e, 0, e.L, z0, z0 + 2 * plan.H, 0, uMax, rows.middle[0], rows.middle[1]);
        else quad(e, 0, e.L, z0, z0 + plan.H, 0, uMax, (rows.middle[0] + rows.middle[1]) / 2, rows.middle[1]);
      }
      quad(e, 0, e.L, height - plan.hc, height, 0, uMax, rows.cap[0], rows.cap[1]);
    }
    const geo = B.geometry();
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(B.n).fill(seed * 100), 1));
    const mesh = new THREE.Mesh(geo, this.atlasMaterial(t, 'impostor'));
    mesh.name = 'lod2';
    mesh.userData.tris = B.idx.length / 3;
    const g = new THREE.Group();
    g.name = 'lod2';
    g.add(mesh);
    g.userData.tris = mesh.userData.tris;
    return g;
  }
}
