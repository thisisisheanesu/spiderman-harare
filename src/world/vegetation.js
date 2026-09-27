import * as THREE from 'three';
import { makeRng, hashString } from '../core/rng.js';
import { pointInRing, cleanRing, distToRing } from './polygon.js';
import { SegmentGrid } from './lines.js';
import { makeCanvas } from './atlas.js';
import { KERB_HEIGHT } from './streetMetrics.js';
import { leafTexture, modelFor } from './treeModels.js';

// Trees of late-September Harare: jacarandas in full purple bloom lining the avenues and filling
// the parks, African flame trees (Spathodea) with orange-red flower clusters, msasa with their
// wine-red spring flush, plain green bauhinia/eucalyptus, and a few palms. Instanced per species
// with a three-level distance LOD rebuilt as the camera moves (models in treeModels.js).

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

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

// Distance-LOD instancing: all instances of one kind with one mesh per LOD level ({geo, dist,
// shadow}); the instance lists are rebuilt whenever the camera has moved far enough.
class InstanceLOD {
  constructor(group, levels, material, items) {
    this.items = items;
    this.matrices = new Float32Array(items.length * 16);
    this.colors = new Float32Array(items.length * 3);
    items.forEach((it, i) => {
      _q.setFromAxisAngle(_up, it.rot);
      _s.set(it.s, it.s, it.s);
      _p.set(it.x, it.y, it.z);
      _m.compose(_p, _q, _s).toArray(this.matrices, i * 16);
      this.colors[i * 3] = it.c[0];
      this.colors[i * 3 + 1] = it.c[1];
      this.colors[i * 3 + 2] = it.c[2];
    });
    const cap = Math.max(1, items.length);
    this.levels = levels.map(({ geo, dist, shadow }) => {
      const m = new THREE.InstancedMesh(geo, material, cap);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = !!shadow;
      m.receiveShadow = true;
      group.add(m);
      return { mesh: m, d2: dist * dist, n: 0 };
    });
  }

  refresh(cx, cz) {
    const lv = this.levels;
    for (const l of lv) l.n = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const dx = it.x - cx;
      const dz = it.z - cz;
      const d2 = dx * dx + dz * dz;
      let k = 0;
      while (k < lv.length && d2 >= lv[k].d2) k++;
      if (k === lv.length) continue;
      const l = lv[k];
      l.mesh.instanceMatrix.array.set(this.matrices.subarray(i * 16, i * 16 + 16), l.n * 16);
      l.mesh.instanceColor.array.set(this.colors.subarray(i * 3, i * 3 + 3), l.n * 3);
      l.n++;
    }
    // Upload only the part of the instance buffers that is in use.
    for (const l of lv) {
      const { mesh } = l;
      mesh.count = l.n;
      mesh.visible = l.n > 0;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, Math.max(16, l.n * 16));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, Math.max(3, l.n * 3));
      mesh.instanceColor.needsUpdate = true;
    }
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
  const pickMix = (mix) => {
    let t = rng() * Object.values(mix).reduce((a, b) => a + b, 0);
    for (const k in mix) {
      t -= mix[k];
      if (t <= 0) return k;
    }
    return 'green';
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
        add(pickMix(mix), px, pz, 0, scale * (0.85 + rng() * 0.35));
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
      add(pickMix({ green: 5, jacaranda: 3, msasa: 0.8, flame: 0.4, eucalyptus: 0.8 }), px, pz, 0, 0.8 + rng() * 0.35);
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
  const bySpecies = new Map();
  for (const t of trees) {
    let list = bySpecies.get(t.species);
    if (!list) bySpecies.set(t.species, (list = []));
    list.push(t);
  }
  const fields = [];
  for (const [name, items] of bySpecies) {
    const levels = name === 'palm'
      ? [{ geo: modelFor(name, 0), dist: mid, shadow: shadows }, { geo: modelFor(name, 1), dist: far }]
      : [{ geo: modelFor(name, 0), dist: near, shadow: shadows }, { geo: modelFor(name, 1), dist: mid }, { geo: modelFor(name, 2), dist: far }];
    fields.push(new InstanceLOD(group, levels, mat, items));
  }
  // Alpha-tested shadows (dappled light under the canopies).
  const depth = new THREE.MeshDepthMaterial({ map: leaves, alphaTest: 0.45, depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  for (const f of fields) for (const l of f.levels) l.mesh.customDepthMaterial = depth;

  // Purple petal carpets under the jacarandas close to the camera.
  const jac = trees.filter((t) => t.species === 'jacaranda').map((t) => ({ ...t, y: t.y + 0.02, s: t.s * (1.6 + (t.rot % 1) * 0.8), c: [1, 1, 1] }));
  if (jac.length) {
    const disc = new THREE.CircleGeometry(4, 10).rotateX(-Math.PI / 2);
    const petalMat = new THREE.MeshStandardMaterial({
      map: petalTexture(), transparent: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    fields.push(new InstanceLOD(group, [{ geo: disc, dist: 160 }], petalMat, jac));
  }

  let lastX = Infinity;
  let lastZ = Infinity;
  return {
    count: trees.length,
    update(cam) {
      const dx = cam.x - lastX;
      const dz = cam.z - lastZ;
      if (dx * dx + dz * dz < 20 * 20) return;
      lastX = cam.x;
      lastZ = cam.z;
      for (const f of fields) f.refresh(cam.x, cam.z);
    },
  };
}
