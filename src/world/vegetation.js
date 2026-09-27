import * as THREE from 'three';
import { makeRng, hashString } from '../core/rng.js';
import { pointInRing, cleanRing, distToRing } from './polygon.js';
import { SegmentGrid } from './lines.js';
import { makeCanvas } from './atlas.js';
import { KERB_HEIGHT } from './streetMetrics.js';
import { leafTexture, modelFor, farBlobGeometry, farBlobFit } from './treeModels.js';

// Trees of late-September Harare: jacarandas in full lavender bloom lining the avenues and filling
// the parks, African flame trees (Spathodea) with orange-red flower clusters, msasa with their
// wine-red spring flush, plain green shade trees and eucalyptus, cypresses and palms in the squares
// and hotel frontages. Instanced per species and LOD level (all distant broadleaf trees share one
// blob mesh), updated incrementally as the camera moves (models in treeModels.js), plus
// fallen-petal carpets under the jacarandas.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();

const LEAF_NOISE = /* glsl */ `
varying vec3 vLeafPos;
float leafHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float leafNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(leafHash(i), leafHash(i + vec3(1, 0, 0)), f.x), mix(leafHash(i + vec3(0, 1, 0)), leafHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(leafHash(i + vec3(0, 0, 1)), leafHash(i + vec3(1, 0, 1)), f.x), mix(leafHash(i + vec3(0, 1, 1)), leafHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

// Vertex-coloured foliage with wind sway (per-instance phase), alpha-tested flower/leaf cards and
// procedural leafy noise that breaks up the low-poly canopy facets.
function treeMaterial(uniforms, map) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, map, alphaTest: 0.45, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uNight = uniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vLeafPos;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 ip = instanceMatrix[3].xyz;
  float sway = max(0.0, position.y - 2.5) * 0.018;
  float ph = ip.x * 0.071 + ip.z * 0.053;
  transformed.x += sin(uTime * 1.3 + ph) * sway + sin(uTime * 2.9 + ph * 2.0) * sway * 0.3;
  transformed.z += cos(uTime * 1.1 + ph * 1.3) * sway * 0.7;
}
#endif`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
#ifdef USE_INSTANCING
vLeafPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
vLeafPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uNight;\n${LEAF_NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb *= 0.66 + 0.5 * leafNoise(vLeafPos * 1.9) + 0.16 * leafNoise(vLeafPos * 5.3);
// Foliage reads much darker than walls and paving at night.
diffuseColor.rgb *= 1.0 - 0.55 * uNight;`,
      );
  };
  mat.customProgramCacheKey = () => 'city-tree-2';
  return mat;
}

function petalTexture() {
  const S = 128;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const rng = makeRng(8);
  for (let i = 0; i < 900; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.pow(rng(), 0.7) * S * 0.48;
    const x = S / 2 + Math.cos(a) * d;
    const y = S / 2 + Math.sin(a) * d;
    const alpha = 0.9 * (1 - d / (S * 0.5));
    ctx.fillStyle = `rgba(${140 + rng() * 40},${110 + rng() * 30},${200 + rng() * 40},${alpha})`;
    ctx.fillRect(x, y, 1.5 + rng() * 2, 1.5 + rng() * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// One InstancedMesh per LOD geometry. Slots [0, n) are live; `ids` maps slot -> item.
class Bucket {
  constructor(group, geo, material, cap, shadow) {
    cap = Math.max(1, cap);
    const m = new THREE.InstancedMesh(geo, material, cap);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.visible = false;
    m.frustumCulled = false;
    m.castShadow = !!shadow;
    m.receiveShadow = true;
    group.add(m);
    this.mesh = m;
    this.ids = new Int32Array(cap);
    this.n = 0;
    this.lo = Infinity;
    this.hi = -1;
  }

  _touch(s) {
    if (s < this.lo) this.lo = s;
    if (s > this.hi) this.hi = s;
  }

  // Uploads only the slot range touched since the last flush.
  flush() {
    const m = this.mesh;
    m.count = this.n;
    m.visible = this.n > 0;
    const hi = Math.min(this.hi, this.n - 1);
    if (hi >= this.lo) {
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(this.lo * 16, (hi - this.lo + 1) * 16);
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.clearUpdateRanges();
      m.instanceColor.addUpdateRange(this.lo * 3, (hi - this.lo + 1) * 3);
      m.instanceColor.needsUpdate = true;
    }
    this.lo = Infinity;
    this.hi = -1;
  }
}

// Distance-LOD instancing with incremental updates. Every item sits in at most one bucket; a
// refresh moves only the items whose LOD level changed (swap-remove from the old bucket, append to
// the new one), so swinging across the city costs a distance test per tree instead of re-copying
// every instance matrix. levels: [{dist, bucket(item) -> Bucket, far?}]; `far` levels read the
// item's canonical far-blob matrix/colour (one bucket shared by all species).
class InstanceLOD {
  constructor(items, levels) {
    const N = items.length;
    this.items = items;
    this.levels = levels.map((l) => ({ d2: l.dist * l.dist, far: !!l.far, bucket: items.map(l.bucket) }));
    this.x = new Float32Array(N);
    this.z = new Float32Array(N);
    this.matrices = new Float32Array(N * 16);
    this.colors = new Float32Array(N * 3);
    // Items with a far fit (broadleaf trees) read the fitted blob on `far` levels; others (palms)
    // keep their ordinary matrix there.
    this.hasFar = new Uint8Array(N);
    const hasFar = levels.some((l) => l.far);
    this.farMatrices = hasFar ? new Float32Array(N * 16) : null;
    this.farColors = hasFar ? new Float32Array(N * 3) : null;
    this.cur = new Int8Array(N).fill(-1);
    this.slot = new Int32Array(N);
    items.forEach((it, i) => {
      this.x[i] = it.x;
      this.z[i] = it.z;
      _q.setFromAxisAngle(_up, it.rot);
      _s.set(it.s, it.s, it.s);
      _p.set(it.x, it.y, it.z);
      _m.compose(_p, _q, _s).toArray(this.matrices, i * 16);
      this.colors.set(it.c, i * 3);
      if (hasFar && it.far) {
        this.hasFar[i] = 1;
        // Canonical unit blob -> this species' far blob: offset to the crown centre, stretched.
        const f = it.far;
        _p.set(f.cx * it.s, f.cy * it.s, f.cz * it.s).applyQuaternion(_q).add(_v.set(it.x, it.y, it.z));
        _s.set(f.hx * it.s, f.hy * it.s, f.hz * it.s);
        _m.compose(_p, _q, _s).toArray(this.farMatrices, i * 16);
        this.farColors[i * 3] = f.color.r * it.c[0];
        this.farColors[i * 3 + 1] = f.color.g * it.c[1];
        this.farColors[i * 3 + 2] = f.color.b * it.c[2];
      }
    });
    this.buckets = [...new Set(this.levels.flatMap((l) => l.bucket))];
  }

  _remove(b, s) {
    const last = --b.n;
    if (s !== last) {
      const moved = b.ids[last];
      b.ids[s] = moved;
      this.slot[moved] = s;
      const m = b.mesh.instanceMatrix.array;
      const c = b.mesh.instanceColor.array;
      m.copyWithin(s * 16, last * 16, last * 16 + 16);
      c.copyWithin(s * 3, last * 3, last * 3 + 3);
      b._touch(s);
    }
  }

  _add(b, i, far) {
    far = far && this.hasFar[i] === 1;
    const s = b.n++;
    b.ids[s] = i;
    this.slot[i] = s;
    const mSrc = far ? this.farMatrices : this.matrices;
    const cSrc = far ? this.farColors : this.colors;
    b.mesh.instanceMatrix.array.set(mSrc.subarray(i * 16, i * 16 + 16), s * 16);
    b.mesh.instanceColor.array.set(cSrc.subarray(i * 3, i * 3 + 3), s * 3);
    b._touch(s);
  }

  refresh(cx, cz) {
    const lv = this.levels;
    const L = lv.length;
    const cur = this.cur;
    for (let i = 0, N = this.items.length; i < N; i++) {
      const dx = this.x[i] - cx;
      const dz = this.z[i] - cz;
      const d2 = dx * dx + dz * dz;
      let k = 0;
      while (k < L && d2 >= lv[k].d2) k++;
      if (k === L) k = -1;
      const old = cur[i];
      if (old === k) continue;
      cur[i] = k;
      const ob = old >= 0 ? lv[old].bucket[i] : null;
      const nb = k >= 0 ? lv[k].bucket[i] : null;
      // Same mesh and same instance data (palms use one model for two levels): nothing moves.
      if (ob && ob === nb && lv[old].far === lv[k].far) continue;
      if (ob) this._remove(ob, this.slot[i]);
      if (nb) this._add(nb, i, lv[k].far);
    }
    for (const b of this.buckets) b.flush();
  }
}

// Planting plan: street trees along the built pavements, parks, woods, school grounds and
// suburban gardens, avoiding buildings, carriageways and paths.
export function planTrees(ctx) {
  const { data, world, sidewalkPaths, quality, urbanAt, heightAt } = ctx;
  const rng = makeRng(2026);
  const trees = [];
  const density = quality.trees;
  const roads = data.roads;
  const roadGrid = new SegmentGrid(40);
  roads.forEach((r, ri) => roadGrid.addPolyline(r.pts, ri));
  const pathGrid = new SegmentGrid(40);
  for (const p of data.paths) pathGrid.addPolyline(p.pts, p.w);
  const occupied = new Map();
  const cellKey = (x, z) => Math.floor(x / 4) * 100003 + Math.floor(z / 4);

  const clearOfRoads = (x, z, margin) => {
    let ok = true;
    roadGrid.query(x, z, 14, (seg, d) => {
      if (ok && d < roads[seg.ref].w / 2 + margin) ok = false;
    });
    if (ok) {
      pathGrid.query(x, z, 8, (seg, d) => {
        if (ok && d < seg.ref / 2 + 1.2) ok = false;
      });
    }
    return ok;
  };
  const clearOfBuildings = (x, z, r) => {
    if (world.buildingAt(x, z)) return false;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      if (world.buildingAt(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
    }
    return true;
  };
  const add = (species, x, z, y, s) => {
    const k = cellKey(x, z);
    if (occupied.has(k)) return false;
    occupied.set(k, 1);
    const shade = 0.85 + rng() * 0.3;
    trees.push({ species, x, y: y + heightAt(x, z), z, s, rot: rng() * Math.PI * 2, c: [shade, shade * (0.95 + rng() * 0.1), shade] });
    return true;
  };

  // Street trees: one species per street name (avenues are planted uniformly).
  for (const sp of sidewalkPaths) {
    const r = roads[sp.road];
    if (r.cls === 'trunk' && !r.name) continue;
    const pts = sp.pts;
    const mx = pts[Math.floor(pts.length / 4) * 2];
    const mz = pts[Math.floor(pts.length / 4) * 2 + 1];
    const urban = urbanAt(mx, mz);
    const avenue = /Avenue|Takawira|Park Lane|Drive/.test(r.name || '');
    if (urban > 0.55 && !avenue) continue;
    const spacing = urban > 0.55 ? 15 : 12;
    const prob = (urban > 0.55 ? 0.7 : 0.82) * density;
    const hr = hashString(r.name || String(sp.road));
    const streetRng = makeRng(hr);
    const species = /Takawira|Nelson Mandela|Josiah Tongogara|Herbert Chitepo|Selous|Baines|Fife|Kwame|Jason Moyo|Park Lane/.test(r.name || '')
      ? 'jacaranda'
      : pickFrom(streetRng, { jacaranda: 6, flame: 0.7, msasa: 0.6, green: 2 });
    let acc = spacing * 0.5;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i];
      const az = pts[i + 1];
      const dx = pts[i + 2] - ax;
      const dz = pts[i + 3] - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      // Towards the kerb: the road centreline is on the -side of the pavement.
      const nx = (dz / len) * sp.side;
      const nz = (-dx / len) * sp.side;
      const off = -(sp.width / 2 - Math.min(0.8, sp.width * 0.3));
      for (let t = acc; t < len; t += spacing) {
        if (rng() > prob) continue;
        const x = ax + (dx / len) * t + nx * off;
        const z = az + (dz / len) * t + nz * off;
        if (!clearOfBuildings(x, z, 2.2)) continue;
        add(species, x, z, KERB_HEIGHT, 0.85 + rng() * 0.3);
      }
      acc = (acc - len) % spacing;
      if (acc < 0) acc += spacing;
    }
  }

  // Areas: parks, woods, grounds.
  const scatter = (ring, spacing, prob, mix, scale, edgeKeep = 3) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]);
      maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]);
      maxZ = Math.max(maxZ, ring[i + 1]);
    }
    for (let x = minX + spacing / 2; x < maxX; x += spacing) {
      for (let z = minZ + spacing / 2; z < maxZ; z += spacing) {
        if (rng() > prob * density) continue;
        const px = x + (rng() - 0.5) * spacing * 0.8;
        const pz = z + (rng() - 0.5) * spacing * 0.8;
        if (!pointInRing(px, pz, ring) || distToRing(px, pz, ring) < edgeKeep) continue;
        if (!clearOfRoads(px, pz, 2) || !clearOfBuildings(px, pz, 2.5)) continue;
        add(pickFrom(rng, mix), px, pz, 0, scale * (0.85 + rng() * 0.35));
      }
    }
  };
  for (const a of data.areas) {
    const ring = cleanRing(a.pts);
    if (ring.length < 6) continue;
    if (a.name === 'Africa Unity Square') {
      scatter(ring, 11, 0.8, { jacaranda: 10, cypress: 1.2, palm: 0.8, green: 1 }, 1.05, 4);
    } else if (a.name === 'Harare Gardens') {
      scatter(ring, 15, 0.8, { jacaranda: 4, green: 3, eucalyptus: 2, msasa: 1.5, flame: 1, cypress: 1, palm: 0.8 }, 1.25, 3);
    } else if (a.kind === 'park') {
      scatter(ring, 17, 0.6, { jacaranda: 4, green: 3, msasa: 1, flame: 1 }, 1.1);
    } else if (a.kind === 'wood') {
      scatter(ring, 11, 0.75, { msasa: 4, green: 3, eucalyptus: 1 }, 1.0, 1);
    } else if (a.kind === 'scrub') {
      scatter(ring, 22, 0.4, { msasa: 3, green: 2 }, 0.85, 1);
    } else if (a.kind === 'school' || a.kind === 'hospital' || a.kind === 'golf') {
      scatter(ring, 24, 0.35, { jacaranda: 3, green: 3, eucalyptus: 2, flame: 1 }, 1.1);
    } else if (a.kind === 'grass') {
      scatter(ring, 14, 0.45, { jacaranda: 3, green: 2, flame: 1 }, 1.0, 2);
    }
  }

  // Suburban gardens (the Avenues and the edges of the map).
  const { minX, maxX, minZ, maxZ } = data.meta.bounds;
  for (let x = minX; x < maxX; x += 15) {
    for (let z = minZ; z < maxZ; z += 15) {
      if (rng() > 0.3 * density) continue;
      const px = x + rng() * 15;
      const pz = z + rng() * 15;
      if (urbanAt(px, pz) > 0.35) continue;
      if (!clearOfRoads(px, pz, 3.5) || !clearOfBuildings(px, pz, 3)) continue;
      add(pickFrom(rng, { green: 5, jacaranda: 3, msasa: 0.8, flame: 0.4, eucalyptus: 0.8 }), px, pz, 0, 0.8 + rng() * 0.35);
    }
  }
  for (const [x, z] of data.trees) add('green', x, z, 0, 1);
  return trees;
}

function pickFrom(rng, weights) {
  let t = rng() * Object.values(weights).reduce((a, b) => a + b, 0);
  for (const k in weights) {
    t -= weights[k];
    if (t <= 0) return k;
  }
  return Object.keys(weights)[0];
}

// Builds the instanced meshes. Returns {count, update(cameraPosition)}.
export function createVegetation(group, trees, uniforms, quality, shadows, drawDistance) {
  const leaves = leafTexture();
  const mat = treeMaterial(uniforms, leaves);
  const near = quality.trees >= 1 ? 170 : 110;
  const mid = quality.trees >= 1 ? 450 : 300;
  const far = Math.min(2600, drawDistance);
  const counts = new Map();
  for (const t of trees) counts.set(t.species, (counts.get(t.species) || 0) + 1);
  // Per species: near + mid models; one far-blob mesh shared by all broadleaf species. Palms keep
  // their full model out to `mid` and a light one beyond.
  const models = new Map();
  let broadleaf = 0;
  for (const [name, n] of counts) {
    if (name === 'palm') {
      const b0 = new Bucket(group, modelFor(name, 0), mat, n, shadows);
      models.set(name, [b0, b0, new Bucket(group, modelFor(name, 1), mat, n, false)]);
    } else {
      models.set(name, [new Bucket(group, modelFor(name, 0), mat, n, shadows), new Bucket(group, modelFor(name, 1), mat, n, false), null]);
      broadleaf += n;
    }
  }
  const farBlob = broadleaf ? new Bucket(group, farBlobGeometry(), mat, broadleaf, false) : null;
  const fits = new Map();
  const items = trees.map((t) => {
    if (t.species === 'palm') return t;
    let fit = fits.get(t.species);
    if (!fit) fits.set(t.species, (fit = farBlobFit(t.species)));
    return { ...t, far: fit };
  });
  const bucketAt = (k) => (it) => models.get(it.species)[k] || farBlob;
  const fields = [new InstanceLOD(items, [
    { dist: near, bucket: bucketAt(0) },
    { dist: mid, bucket: bucketAt(1) },
    { dist: far, bucket: bucketAt(2), far: true },
  ])];
  // Alpha-tested shadows (dappled light under the canopies).
  const depth = new THREE.MeshDepthMaterial({ map: leaves, alphaTest: 0.45, depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  for (const b of fields[0].buckets) b.mesh.customDepthMaterial = depth;

  // Purple petal carpets under the jacarandas close to the camera.
  const jac = trees.filter((t) => t.species === 'jacaranda').map((t) => ({ ...t, y: t.y + 0.02, s: t.s * (1.6 + (t.rot % 1) * 0.8), c: [1, 1, 1] }));
  if (jac.length) {
    const disc = new THREE.CircleGeometry(4, 10).rotateX(-Math.PI / 2);
    const petalMat = new THREE.MeshStandardMaterial({
      map: petalTexture(), transparent: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const petals = new Bucket(group, disc, petalMat, jac.length, false);
    fields.push(new InstanceLOD(jac, [{ dist: 160, bucket: () => petals }]));
  }

  let lastX = Infinity;
  let lastZ = Infinity;
  return {
    count: trees.length,
    update(cam) {
      const dx = cam.x - lastX;
      const dz = cam.z - lastZ;
      if (dx * dx + dz * dz < 12 * 12) return;
      lastX = cam.x;
      lastZ = cam.z;
      for (const f of fields) f.refresh(cam.x, cam.z);
    },
  };
}
