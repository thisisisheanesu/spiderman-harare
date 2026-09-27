import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng, hashString } from '../core/rng.js';
import { pointInRing, cleanRing, distToRing } from './polygon.js';
import { SegmentGrid } from './lines.js';
import { makeCanvas } from './atlas.js';
import { KERB_HEIGHT } from './streetMetrics.js';

// Trees of late-September Harare: jacarandas in full purple bloom lining the avenues and filling
// the parks, African flame trees (Spathodea) with orange-red flower clusters, msasa with their
// wine-red spring flush, plain green bauhinia/eucalyptus, and a few palms. Instanced per species
// with a distance LOD (detailed near the camera, a single blob far away) rebuilt as the camera moves.

const SPECIES = {
  jacaranda: {
    trunk: '#5f5048', height: [8, 12], radius: [4.5, 6.5], blobs: 9, flat: 0.62,
    colors: ['#9580cf', '#a48fdc', '#8872c0', '#b19ee3', '#7d68b0', '#6f8f4a'],
    weights: [3, 3, 2, 2, 2, 1],
  },
  flame: {
    trunk: '#6d655e', height: [9, 13], radius: [3.5, 5], blobs: 8, flat: 0.85,
    colors: ['#3f6a2e', '#4d7a35', '#355d28', '#e2552c', '#f07a2a', '#c93a22'],
    weights: [3, 3, 2, 1.2, 1, 0.8],
  },
  msasa: {
    trunk: '#4c4038', height: [7, 11], radius: [4, 6], blobs: 8, flat: 0.55,
    colors: ['#8d3b33', '#a9573b', '#c0784a', '#6e2e2e', '#6b7d3a', '#9a6a3a'],
    weights: [2, 2, 1.5, 1.2, 1.5, 1],
  },
  green: {
    trunk: '#6a5d52', height: [7, 12], radius: [3, 5], blobs: 7, flat: 0.9,
    colors: ['#4f6f35', '#5f7f3e', '#6e8a48', '#44612e', '#7a8f5a', '#8a9a68'],
    weights: [3, 3, 2, 2, 1, 1],
  },
  eucalyptus: {
    trunk: '#cfc6b6', height: [14, 22], radius: [3, 4.5], blobs: 7, flat: 1.25,
    colors: ['#7d8f6c', '#8a9a78', '#6f8060', '#98a584'],
    weights: [3, 2, 2, 1],
  },
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

function colorize(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), _c);
    _c.toArray(col, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function trunkGeometry(def, h, rng, forks) {
  const parts = [];
  const trunkH = h * 0.42;
  const base = new THREE.CylinderGeometry(0.16, 0.26, trunkH, 6, 1, true);
  base.translate(0, trunkH / 2, 0);
  parts.push(base);
  for (let i = 0; i < forks; i++) {
    const a = (i / forks) * Math.PI * 2 + rng() * 0.8;
    const len = h * 0.32;
    const br = new THREE.CylinderGeometry(0.07, 0.13, len, 5, 1, true);
    br.translate(0, len / 2, 0);
    br.rotateZ(0.55 + rng() * 0.25);
    br.rotateY(a);
    br.translate(0, trunkH * 0.95, 0);
    parts.push(br);
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  const tc = new THREE.Color(def.trunk);
  return colorize(g, (x, y, z, c) => c.copy(tc).multiplyScalar(0.8 + Math.min(0.3, y * 0.05)));
}

// Canopy of jittered icosahedron blobs, one colour per blob; normals point away from the canopy
// centre so the crown shades as one soft mass (the shader adds leafy noise on top).
function canopyGeometry(def, h, r, rng, blobs, detail) {
  const cy = h - r * def.flat * 0.75;
  const palette = def.colors.map((c) => new THREE.Color(c));
  const total = def.weights.reduce((a, b) => a + b, 0);
  const pickColor = () => {
    let t = rng() * total;
    for (let i = 0; i < palette.length; i++) {
      t -= def.weights[i];
      if (t <= 0) return palette[i];
    }
    return palette[0];
  };
  const parts = [];
  for (let i = 0; i < blobs; i++) {
    const a = rng() * Math.PI * 2;
    const d = i === 0 ? 0 : r * (0.35 + rng() * 0.45);
    const br = r * (i === 0 ? 0.7 : 0.42 + rng() * 0.22);
    const bx = Math.cos(a) * d;
    const bz = Math.sin(a) * d;
    const by = cy + (rng() - 0.35) * r * def.flat * 0.5 - (d / r) * r * 0.2 * def.flat;
    const g = new THREE.IcosahedronGeometry(br, detail);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const j = 0.88 + rng() * 0.24;
      pos.setXYZ(k, pos.getX(k) * j, pos.getY(k) * j * def.flat, pos.getZ(k) * j);
    }
    g.translate(bx, by, bz);
    const base = pickColor();
    parts.push(colorize(g, (x, y, z, c) => {
      c.copy(base).multiplyScalar(0.92 + rng() * 0.16);
      c.multiplyScalar(0.72 + 0.38 * Math.min(1, Math.max(0, (y - (cy - r * 0.6)) / (r * 1.2))));
    }));
  }
  const geo = mergeGeometries(parts);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  for (let k = 0; k < pos.count; k++) {
    _p.set(pos.getX(k), (pos.getY(k) - cy) / Math.max(0.6, def.flat), pos.getZ(k)).normalize();
    nrm.setXYZ(k, _p.x, _p.y, _p.z);
  }
  return geo;
}

function treeGeometry(name, lod, detail = 0) {
  const def = SPECIES[name];
  const rng = makeRng(hashString(name) + lod);
  const h = (def.height[0] + def.height[1]) / 2;
  const r = (def.radius[0] + def.radius[1]) / 2;
  if (lod === 1) {
    const trunk = trunkGeometry(def, h, rng, 0);
    const canopy = canopyGeometry(def, h, r, rng, 1, 0);
    const pos = canopy.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setXYZ(k, pos.getX(k) * 1.35, pos.getY(k), pos.getZ(k) * 1.35);
    return mergeGeometries([trunk, canopy.toNonIndexed()]);
  }
  const trunk = trunkGeometry(def, h, rng, name === 'eucalyptus' ? 2 : 3);
  const canopy = canopyGeometry(def, h, r, rng, detail ? Math.ceil(def.blobs * 0.7) : def.blobs, detail);
  return mergeGeometries([trunk, canopy.toNonIndexed()]);
}

function palmGeometry(lod) {
  const rng = makeRng(404 + lod);
  const h = 11;
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.2, 0.3, h, lod ? 4 : 7, 4, true);
  const tp = trunk.attributes.position;
  for (let k = 0; k < tp.count; k++) {
    const y = tp.getY(k) + h / 2;
    tp.setX(k, tp.getX(k) + Math.sin(y * 0.12) * 0.35);
  }
  trunk.translate(0, h / 2, 0);
  parts.push(colorize(trunk.toNonIndexed(), (x, y, z, c) => c.set('#8a7862').multiplyScalar(0.8 + (y % 0.6) * 0.3)));
  const fronds = lod ? 7 : 12;
  const topX = Math.sin(h * 0.12) * 0.35;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rng() * 0.3;
    const len = 3.6 + rng() * 1;
    const segs = 3;
    const pos = [];
    const droop = 0.5 + rng() * 0.4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const w0 = 0.55 * Math.sin(Math.PI * Math.max(t0, 0.08));
      const w1 = 0.55 * Math.sin(Math.PI * Math.min(t1, 0.95));
      const p = (t) => [t * len, 0.8 * t - droop * t * t * 2.2];
      const [d0, y0] = p(t0);
      const [d1, y1] = p(t1);
      const q = (d, y, w) => [topX + ca * d - sa * w, h + y, ca * w + sa * d];
      const A = q(d0, y0, -w0);
      const B = q(d0, y0, w0);
      const C = q(d1, y1, w1);
      const D = q(d1, y1, -w1);
      pos.push(...A, ...B, ...C, ...A, ...C, ...D);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const nrm = g.attributes.normal;
    for (let k = 0; k < nrm.count; k++) if (nrm.getY(k) < 0) nrm.setXYZ(k, -nrm.getX(k), -nrm.getY(k), -nrm.getZ(k));
    const shade = 0.8 + rng() * 0.4;
    parts.push(colorize(g, (x, y, z, c) => c.set('#5a7a34').multiplyScalar(shade)));
  }
  return mergeGeometries(parts);
}

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

// Vertex-coloured foliage with wind sway (per-instance phase) and procedural leafy noise that
// breaks up the low-poly canopy facets.
function treeMaterial(uniforms, doubleSided) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
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
      .replace('#include <common>', `#include <common>\n${LEAF_NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb *= 0.62 + 0.55 * leafNoise(vLeafPos * 1.9) + 0.18 * leafNoise(vLeafPos * 5.3);`,
      );
  };
  mat.customProgramCacheKey = () => `city-tree-${doubleSided ? 2 : 1}`;
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

// Distance-LOD instancing: all instances of one kind, two meshes (near / far) whose instance
// lists are refreshed whenever the camera has moved far enough.
class InstanceLOD {
  constructor(group, nearGeo, farGeo, material, items, near, far, castShadow) {
    this.items = items;
    this.near2 = near * near;
    this.far2 = far * far;
    this.matrices = new Float32Array(items.length * 16);
    this.colors = new Float32Array(items.length * 3);
    items.forEach((it, i) => {
      _q.setFromAxisAngle(_up, it.rot);
      _s.set(it.s * (it.sx || 1), it.s, it.s * (it.sx || 1));
      _p.set(it.x, it.y, it.z);
      _m.compose(_p, _q, _s).toArray(this.matrices, i * 16);
      this.colors[i * 3] = it.c[0];
      this.colors[i * 3 + 1] = it.c[1];
      this.colors[i * 3 + 2] = it.c[2];
    });
    const make = (geo) => {
      if (!geo) return null;
      const m = new THREE.InstancedMesh(geo, material, Math.max(1, items.length));
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, items.length) * 3), 3);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.receiveShadow = true;
      group.add(m);
      return m;
    };
    this.nearMesh = make(nearGeo);
    this.nearMesh.castShadow = castShadow;
    this.farMesh = make(farGeo);
  }

  refresh(cx, cz) {
    const nm = this.nearMesh;
    const fm = this.farMesh;
    let n = 0;
    let f = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const dx = it.x - cx;
      const dz = it.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < this.near2) {
        nm.instanceMatrix.array.set(this.matrices.subarray(i * 16, i * 16 + 16), n * 16);
        nm.instanceColor.array.set(this.colors.subarray(i * 3, i * 3 + 3), n * 3);
        n++;
      } else if (fm && d2 < this.far2) {
        fm.instanceMatrix.array.set(this.matrices.subarray(i * 16, i * 16 + 16), f * 16);
        fm.instanceColor.array.set(this.colors.subarray(i * 3, i * 3 + 3), f * 3);
        f++;
      }
    }
    nm.count = n;
    nm.instanceMatrix.needsUpdate = true;
    nm.instanceColor.needsUpdate = true;
    if (fm) {
      fm.count = f;
      fm.instanceMatrix.needsUpdate = true;
      fm.instanceColor.needsUpdate = true;
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
      : pickFrom(streetRng, { jacaranda: 6, flame: 1.4, msasa: 0.8, green: 1.6 });
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
      scatter(ring, 11, 0.8, { jacaranda: 10, green: 1 }, 1.05, 4);
    } else if (a.name === 'Harare Gardens') {
      scatter(ring, 15, 0.8, { jacaranda: 4, green: 3, eucalyptus: 2, msasa: 1.5, flame: 1 }, 1.25, 3);
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
      add(pickMix({ green: 4, jacaranda: 3, msasa: 1, flame: 1, eucalyptus: 0.6 }), px, pz, 0, 0.8 + rng() * 0.35);
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

// Builds the instanced meshes. Returns {update(camera)}.
export function createVegetation(group, trees, palms, uniforms, quality, shadows) {
  const mat = treeMaterial(uniforms, false);
  const palmMat = treeMaterial(uniforms, true);
  const near = quality.trees >= 1 ? 320 : 220;
  const far = 2600;
  const fields = [];
  for (const name of Object.keys(SPECIES)) {
    const items = trees.filter((t) => t.species === name);
    if (!items.length) continue;
    fields.push(new InstanceLOD(group, treeGeometry(name, 0, quality.trees >= 1 ? 1 : 0), treeGeometry(name, 1), mat, items, near, far, shadows));
  }
  if (palms.length) fields.push(new InstanceLOD(group, palmGeometry(0), palmGeometry(1), palmMat, palms, near, far, shadows));

  // Purple petal carpets under the jacarandas close to the camera.
  const jac = trees.filter((t) => t.species === 'jacaranda').map((t) => ({ ...t, y: t.y + 0.02, s: t.s * (1.6 + (t.rot % 1) * 0.8), c: [1, 1, 1] }));
  if (jac.length) {
    const disc = new THREE.CircleGeometry(4, 10).rotateX(-Math.PI / 2);
    const petalMat = new THREE.MeshStandardMaterial({
      map: petalTexture(), transparent: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const field = new InstanceLOD(group, disc, null, petalMat, jac, 160, 0, false);
    field.nearMesh.receiveShadow = true;
    fields.push(field);
  }

  let lastX = Infinity;
  let lastZ = Infinity;
  return {
    count: trees.length + palms.length,
    update(cam) {
      const dx = cam.x - lastX;
      const dz = cam.z - lastZ;
      if (dx * dx + dz * dz < 25 * 25) return;
      lastX = cam.x;
      lastZ = cam.z;
      for (const f of fields) f.refresh(cam.x, cam.z);
    },
  };
}
