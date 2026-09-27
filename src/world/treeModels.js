import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng, hashString } from '../core/rng.js';
import { makeCanvas } from './atlas.js';

// Tree models for the city. A canopy is a cluster of low-poly blobs (the solid mass) wrapped in
// alpha-tested cards carrying flower/leaf clusters (fluffy silhouette, dappled shadows). All
// parts are vertex-coloured; trunks and blobs sample the opaque white corner of the leaf texture.

export const SPECIES = {
  // In bloom the canopy reads pale lavender-blue rather than saturated purple (PHOTOS.md §22).
  jacaranda: {
    trunk: '#5a4632', height: [8, 12], radius: [4.5, 6.5], blobs: 8, flat: 0.62, tile: 'flowers', cards: 96,
    colors: ['#a498d0', '#b3a9df', '#9387c2', '#c0b8ea', '#8b7fb6', '#6f8f4a'],
    weights: [3, 3, 2, 2, 2, 0.6],
  },
  flame: {
    trunk: '#6d655e', height: [9, 13], radius: [3.5, 5], blobs: 7, flat: 0.85, tile: 'leaves', cards: 72,
    colors: ['#3f6a2e', '#4d7a35', '#355d28', '#d9542e', '#c94a2a'],
    weights: [4, 4, 3, 1, 0.8],
  },
  msasa: {
    trunk: '#4c4038', height: [7, 11], radius: [4, 6], blobs: 7, flat: 0.55, tile: 'leaves', cards: 72,
    colors: ['#9a3b3f', '#b5553f', '#c9804f', '#5f7a3a', '#6f8a3e', '#a5463f'],
    weights: [1.6, 1.2, 0.8, 2.5, 2, 1],
  },
  green: {
    trunk: '#6a5d52', height: [7, 12], radius: [3, 5], blobs: 6, flat: 0.9, tile: 'leaves', cards: 64,
    colors: ['#4f6f35', '#5f7f3e', '#6e8a48', '#44612e', '#7a8f5a', '#8a9a68'],
    weights: [3, 3, 2, 2, 1, 1],
  },
  cypress: {
    trunk: '#4a3d33', height: [18, 24], radius: [1.8, 2.4], blobs: 6, flat: 3.2, tile: 'leaves', cards: 40, column: true,
    colors: ['#46643c', '#4f6e42', '#3f5b37', '#587848'],
    weights: [3, 3, 2, 2],
  },
  eucalyptus: {
    trunk: '#cfc6b6', height: [14, 22], radius: [3, 4.5], blobs: 6, flat: 1.25, tile: 'leaves', cards: 40,
    colors: ['#7d8f6c', '#8a9a78', '#6f8060', '#98a584'],
    weights: [3, 2, 2, 1],
  },
};

// Leaf texture layout (u ranges): flowers 0..0.5, leaves 0.5..1; opaque white in the top-right corner.
const TILES = { flowers: [0.02, 0.48], leaves: [0.52, 0.98] };
const SOLID_UV = [0.975, 0.975];

export function leafTexture() {
  const W = 256;
  const H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const rng = makeRng(55);
  const tile = (x0, draw) => {
    for (let i = 0; i < 170; i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * 56;
      draw(x0 + 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, d / 54);
    }
  };
  // Flower panicles: clusters of small florets.
  tile(0, (x, y, d) => {
    for (let k = 0; k < 4; k++) {
      const g = Math.round(200 + rng() * 55 - d * 35);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.beginPath();
      ctx.arc(x + (rng() - 0.5) * 6, y + (rng() - 0.5) * 6, 1.2 + rng() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  tile(128, (x, y, d) => {
    const g = Math.round(185 + rng() * 70 - d * 40);
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng() * Math.PI);
    ctx.beginPath();
    ctx.ellipse(0, 0, 4 + rng() * 4, 1.8 + rng() * 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  ctx.fillStyle = '#fff';
  ctx.fillRect(W - 10, 0, 10, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Color();

// Adds position/normal/uv/color arrays to a geometry built from an arbitrary primitive.
function finish(geo, colorFn, uv = SOLID_UV) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    colorFn(pos.getX(i), pos.getY(i), pos.getZ(i), _c);
    _c.toArray(col, i * 3);
    uvs[i * 2] = uv[0];
    uvs[i * 2 + 1] = uv[1];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return g;
}

function trunkGeometry(def, h, rng, forks) {
  const parts = [];
  const trunkH = h * (def.column ? 0.2 : 0.42);
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
  const tc = new THREE.Color(def.trunk);
  return finish(mergeGeometries(parts.map((p) => p.toNonIndexed())), (x, y, z, c) => c.copy(tc).multiplyScalar(0.8 + Math.min(0.3, y * 0.05)));
}

function pickColor(def, rng) {
  const total = def.weights.reduce((a, b) => a + b, 0);
  let t = rng() * total;
  for (let i = 0; i < def.colors.length; i++) {
    t -= def.weights[i];
    if (t <= 0) return new THREE.Color(def.colors[i]);
  }
  return new THREE.Color(def.colors[0]);
}

// Canopy: blobs (one colour each) + optional cards. Normals point away from the canopy centre so
// the crown shades as one soft mass.
function canopyGeometry(def, h, r, rng, blobs, detail, cards, blobScale = 1) {
  const cy = h - r * def.flat * 0.75;
  const parts = [];
  const info = [];
  for (let i = 0; i < blobs; i++) {
    const a = rng() * Math.PI * 2;
    const d = i === 0 || def.column ? 0 : r * (0.35 + rng() * 0.45);
    const br = r * (i === 0 ? 0.7 : 0.42 + rng() * 0.22) * blobScale;
    const bx = Math.cos(a) * d;
    const bz = Math.sin(a) * d;
    // Columnar trees (cypress) stack their blobs into a tapering spire.
    const by = def.column
      ? h * (0.3 + (0.6 * i) / Math.max(1, blobs - 1))
      : cy + (rng() - 0.35) * r * def.flat * 0.5 - (d / r) * r * 0.2 * def.flat;
    const r0 = def.column ? br * (1.15 - (0.55 * i) / blobs) : br;
    const g = detail < 0 ? new THREE.OctahedronGeometry(r0, 0) : new THREE.IcosahedronGeometry(r0, detail);
    const pos = g.attributes.position;
    const stretch = def.column ? 1.6 : def.flat;
    for (let k = 0; k < pos.count; k++) {
      const j = 0.88 + rng() * 0.24;
      pos.setXYZ(k, pos.getX(k) * j, pos.getY(k) * j * stretch, pos.getZ(k) * j);
    }
    g.translate(bx, by, bz);
    const base = pickColor(def, rng);
    info.push({ x: bx, y: by, z: bz, r: br, color: base });
    g.deleteAttribute('uv');
    parts.push(finish(g, (x, y, z, c) => {
      c.copy(base).multiplyScalar((0.92 + rng() * 0.16) * 0.85);
      c.multiplyScalar(0.72 + 0.38 * Math.min(1, Math.max(0, (y - (cy - r * 0.6)) / (r * 1.2))));
    }));
  }
  if (cards) parts.push(cardGeometry(def, info, cy, r, rng, cards));
  const geo = mergeGeometries(parts);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  for (let k = 0; k < pos.count; k++) {
    // Columnar crowns shade like a cylinder, others like one squashed sphere.
    if (def.column) _p.set(pos.getX(k), 0.35, pos.getZ(k)).normalize();
    else _p.set(pos.getX(k), (pos.getY(k) - cy) / Math.max(0.6, def.flat), pos.getZ(k)).normalize();
    nrm.setXYZ(k, _p.x, _p.y, _p.z);
  }
  return geo;
}

// Approximate crown-top height (m) of a species' model at scale 1 (web anchors on tree tops).
export function treeHeight(name) {
  if (name === 'palm') return 11.5;
  const def = SPECIES[name];
  return def ? (def.height[0] + def.height[1]) / 2 : 9;
}

// Geometry for any species (palms included) at a LOD level.
export function modelFor(name, lod) {
  if (name === 'palm') return palmGeometry(Math.min(lod, 1));
  return treeGeometry(name, lod);
}

// Flower/leaf-cluster cards scattered over the blob surfaces, facing roughly outwards.
function cardGeometry(def, info, cy, r, rng, count) {
  const [u0, u1] = TILES[def.tile];
  const pos = [];
  const col = [];
  const uv = [];
  const total = info.reduce((a, b) => a + b.r * b.r, 0);
  for (let i = 0; i < count; i++) {
    let t = rng() * total;
    let blob = info[0];
    for (const b of info) {
      t -= b.r * b.r;
      if (t <= 0) {
        blob = b;
        break;
      }
    }
    _n.set(rng() * 2 - 1, rng() * 1.6 - 0.45, rng() * 2 - 1).normalize();
    const k = blob.r * (0.95 + rng() * 0.3);
    _p.set(blob.x + _n.x * k, blob.y + _n.y * k * (def.column ? 1.6 : def.flat), blob.z + _n.z * k);
    _n.x += (rng() - 0.5) * 0.8;
    _n.y += (rng() - 0.5) * 0.8;
    _n.z += (rng() - 0.5) * 0.8;
    _n.normalize();
    _t.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).cross(_n).normalize();
    _b.crossVectors(_n, _t);
    const s = r * (0.18 + rng() * 0.12);
    const corners = [[-1, -1, u0, 0.02], [1, -1, u1, 0.02], [1, 1, u1, 0.98], [-1, 1, u0, 0.98]];
    const shade = 0.9 + rng() * 0.2;
    for (const idx of [0, 1, 2, 0, 2, 3]) {
      const [a, b, u, v] = corners[idx];
      pos.push(_p.x + (_t.x * a + _b.x * b) * s, _p.y + (_t.y * a + _b.y * b) * s, _p.z + (_t.z * a + _b.z * b) * s);
      col.push(blob.color.r * shade, blob.color.g * shade, blob.color.b * shade);
      uv.push(u, v);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// lod 0 = near (blobs + leaf cards), 1 = mid (4 blobs), 2 = far (one blob).
function treeGeometry(name, lod) {
  const def = SPECIES[name];
  const rng = makeRng(hashString(name));
  const h = (def.height[0] + def.height[1]) / 2;
  const r = (def.radius[0] + def.radius[1]) / 2;
  if (lod === 2) {
    // Far away: one octahedron blob (8 triangles) stretched to the crown's footprint.
    const canopy = canopyGeometry(def, h, r, rng, 1, -1, 0);
    const pos = canopy.attributes.position;
    const sxz = def.column ? 1 : 1.35;
    const sy = def.column ? 2.2 : 1;
    for (let k = 0; k < pos.count; k++) pos.setXYZ(k, pos.getX(k) * sxz, pos.getY(k) * sy, pos.getZ(k) * sxz);
    return canopy;
  }
  const trunk = trunkGeometry(def, h, rng, def.column ? 0 : lod === 0 ? (name === 'eucalyptus' ? 2 : 3) : 1);
  const canopy = lod === 0 ? canopyGeometry(def, h, r, rng, def.blobs, 0, def.cards, 0.86) : canopyGeometry(def, h, r, rng, 4, 0, 0, 1.08);
  return mergeGeometries([trunk, canopy]);
}

// Canonical far-LOD blob shared by every broadleaf species (one instanced draw for all distant
// trees): a unit octahedron with spherical normals and the canopy's vertical shading gradient
// (mean 1). farBlobFit(name) maps it onto that species' own far blob: centre offset, half-sizes
// and mean colour (at scale 1, before the per-tree rotation and scale).
export function farBlobGeometry() {
  const g = new THREE.OctahedronGeometry(1, 0).toNonIndexed();
  g.deleteAttribute('uv');
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  for (let k = 0; k < pos.count; k++) {
    _p.set(pos.getX(k), pos.getY(k), pos.getZ(k)).normalize();
    nrm.setXYZ(k, _p.x, _p.y, _p.z);
  }
  return finish(g, (x, y, z, c) => c.setScalar((0.72 + 0.38 * (y * 0.5 + 0.5)) / 0.91));
}

export function farBlobFit(name) {
  const g = treeGeometry(name, 2);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const col = g.attributes.color;
  const color = new THREE.Color(0, 0, 0);
  for (let k = 0; k < col.count; k++) {
    color.r += col.getX(k);
    color.g += col.getY(k);
    color.b += col.getZ(k);
  }
  color.multiplyScalar(1 / Math.max(1, col.count));
  g.dispose();
  return {
    cx: (bb.min.x + bb.max.x) / 2, cy: (bb.min.y + bb.max.y) / 2, cz: (bb.min.z + bb.max.z) / 2,
    hx: (bb.max.x - bb.min.x) / 2, hy: (bb.max.y - bb.min.y) / 2, hz: (bb.max.z - bb.min.z) / 2,
    color,
  };
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
  trunk.deleteAttribute('uv');
  parts.push(finish(trunk, (x, y, z, c) => c.set('#8a7862').multiplyScalar(0.8 + (y % 0.6) * 0.3)));
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
    parts.push(finish(g, (x, y, z, c) => c.set('#5a7a34').multiplyScalar(shade)));
  }
  return mergeGeometries(parts);
}
