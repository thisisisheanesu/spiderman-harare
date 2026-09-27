import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuffer } from './geoBuffer.js';
import { cleanRing, pointInRing, distToRing } from './polygon.js';
import { makeRng } from '../core/rng.js';
import { tint } from './palette.js';

// The Kopje: the granite hill where Salisbury was founded, rising ~50 m above the CBD's south-west
// corner. A heightfield dome (shaped by the wooded area polygon around the researched summit)
// strewn with granite boulders, with the Eternal Flame of Independence at the top. Everything is
// registered with the physics world so the player can climb it.

const PEAK = 50;
const RADIUS = 360;
const FALLBACK = { x: -1422, z: 1291 };

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

export class Kopje {
  constructor(data) {
    const f = data.features.find((p) => p.key === 'the_kopje' || p.kind === 'hill');
    this.center = f ? { x: f.x, z: f.z } : FALLBACK;
    const c = this.center;
    // The wooded hill outline: the wood/scrub area closest to the summit.
    let best = null;
    let bestD = 400;
    for (const a of data.areas) {
      if (a.kind !== 'wood' && a.kind !== 'scrub') continue;
      const ring = cleanRing(a.pts);
      const d = pointInRing(c.x, c.z, ring) ? 0 : distToRing(c.x, c.z, ring);
      if (d < bestD) {
        bestD = d;
        best = { area: a, ring };
      }
    }
    this.area = best?.area || null;
    this.ring = best?.ring || null;
    const r = this.ring;
    let minX = c.x - RADIUS;
    let maxX = c.x + RADIUS;
    let minZ = c.z - RADIUS;
    let maxZ = c.z + RADIUS;
    if (r) {
      minX = Infinity;
      maxX = -Infinity;
      minZ = Infinity;
      maxZ = -Infinity;
      for (let i = 0; i < r.length; i += 2) {
        minX = Math.min(minX, r[i]);
        maxX = Math.max(maxX, r[i]);
        minZ = Math.min(minZ, r[i + 1]);
        maxZ = Math.max(maxZ, r[i + 1]);
      }
    }
    this.box = { minX, maxX, minZ, maxZ };
    this.heightAt = this.heightAt.bind(this);
  }

  heightAt(x, z) {
    const b = this.box;
    if (x <= b.minX || x >= b.maxX || z <= b.minZ || z >= b.maxZ) return 0;
    const c = this.center;
    const d = Math.hypot(x - c.x, z - c.z) / RADIUS;
    if (d >= 1) return 0;
    let edge = 1;
    if (this.ring) {
      if (!pointInRing(x, z, this.ring)) return 0;
      edge = THREE.MathUtils.smoothstep(distToRing(x, z, this.ring), 0, 70);
    }
    const dome = Math.pow(1 - d * d, 1.6);
    const n = noise(x / 45, z / 45) * 0.6 + noise(x / 17, z / 17) * 0.4;
    return Math.max(0, (PEAK * dome + (n - 0.5) * 7 * dome) * edge);
  }

  // Built road surface height: a little above the hill so the carriageway never sinks into it.
  roadHeightAt(x, z) {
    const h = this.heightAt(x, z);
    return h > 0.05 ? h + 0.12 : 0;
  }

  touches(pts) {
    const b = this.box;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] > b.minX && pts[i] < b.maxX && pts[i + 1] > b.minZ && pts[i + 1] < b.maxZ) return true;
    }
    return false;
  }

  // Terrain + boulders into `ground` (ground material), the flame monument into `chunkGb`
  // (facade material); returns the collider geometry.
  build(ground, G, groundScale, chunkGb, L, quality) {
    const col = new GeoBuffer(1 << 15);
    const b = this.box;
    const step = quality.props >= 1 ? 5 : 8;
    const nx = Math.ceil((b.maxX - b.minX) / step);
    const nz = Math.ceil((b.maxZ - b.minZ) / step);
    const hs = new Float32Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) hs[j * (nx + 1) + i] = this.heightAt(b.minX + i * step, b.minZ + j * step);
    const H = (i, j) => hs[Math.min(nz, Math.max(0, j)) * (nx + 1) + Math.min(nx, Math.max(0, i))];
    const idx = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
    const s = 1 / groundScale.dryGrass;
    const earth = new THREE.Color();
    const grass = new THREE.Color('#fff4e0');
    const red = new THREE.Color('#e0b090');
    ground.brush([255, 255, 255], G.dryGrass, 0, 0);
    const vert = (i, j) => {
      const k = j * (nx + 1) + i;
      if (idx[k] >= 0) return idx[k];
      const x = b.minX + i * step;
      const z = b.minZ + j * step;
      const gx = (H(i + 1, j) - H(i - 1, j)) / (2 * step);
      const gz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
      const inv = 1 / Math.hypot(gx, 1, gz);
      const slope = Math.min(1, Math.hypot(gx, gz) * 1.6);
      earth.copy(grass).lerp(red, slope * 0.8);
      ground.setTint([earth.r * 255, earth.g * 255, earth.b * 255].map(Math.round));
      idx[k] = ground.vertex(x, H(i, j), z, -gx * inv, inv, -gz * inv, x * s, -z * s);
      return idx[k];
    };
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (H(i, j) + H(i + 1, j) + H(i, j + 1) + H(i + 1, j + 1) < 0.02) continue;
        const a = vert(i, j);
        const bb = vert(i + 1, j);
        const c = vert(i + 1, j + 1);
        const d = vert(i, j + 1);
        ground.tri(a, d, c);
        ground.tri(a, c, bb);
        const x0 = b.minX + i * step;
        const z0 = b.minZ + j * step;
        const x1 = x0 + step;
        const z1 = z0 + step;
        col.quad(x0, H(i, j), z0, x0, H(i, j + 1), z1, x1, H(i + 1, j + 1), z1, x1, H(i + 1, j), z0, 0, 1, 0, 0, 0, 1, 1);
      }
    }

    // Granite boulders, denser towards the summit.
    const rng = makeRng(1890);
    const ico = new THREE.IcosahedronGeometry(1, 1);
    ico.deleteAttribute('normal');
    ico.deleteAttribute('uv');
    const rock = mergeVertices(ico);
    const rp = rock.attributes.position;
    const c = this.center;
    const count = Math.round(70 * Math.max(0.5, quality.props));
    ground.brush(tint('#ffffff'), G.rock, 0, 0);
    for (let n = 0; n < count; n++) {
      const a = rng() * Math.PI * 2;
      const d = Math.pow(rng(), 0.8) * RADIUS * 0.7;
      const x = c.x + Math.cos(a) * d;
      const z = c.z + Math.sin(a) * d;
      const h = this.heightAt(x, z);
      if (h < 3) continue;
      const r = 1.5 + rng() * (d < 120 ? 7 : 4);
      const sx = r * (0.8 + rng() * 0.6);
      const sy = r * (0.5 + rng() * 0.4);
      const sz = r * (0.8 + rng() * 0.6);
      const rot = rng() * Math.PI;
      const cs = Math.cos(rot);
      const sn = Math.sin(rot);
      const base = ground.vCount;
      for (let k = 0; k < rp.count; k++) {
        const lx = rp.getX(k) * (0.85 + hash(k, n) * 0.3);
        const ly = rp.getY(k) * (0.85 + hash(n, k) * 0.3);
        const lz = rp.getZ(k) * (0.85 + hash(k + n, 3) * 0.3);
        const px = x + (lx * sx * cs - lz * sz * sn);
        const pz = z + (lx * sx * sn + lz * sz * cs);
        const py = h - sy * 0.35 + ly * sy;
        const nl = Math.hypot(lx / sx, ly / sy, lz / sz) || 1;
        ground.vertex(px, py, pz, ((lx / sx) * cs - (lz / sz) * sn) / nl, ly / sy / nl, ((lx / sx) * sn + (lz / sz) * cs) / nl, px / 7 + py / 9, -pz / 7 + py / 11);
      }
      const ri = rock.index.array;
      const P = ground.pos;
      const cBase = col.vCount;
      for (let k = 0; k < rp.count; k++) col.vertex(P[(base + k) * 3], P[(base + k) * 3 + 1], P[(base + k) * 3 + 2], 0, 1, 0, 0, 0);
      for (let k = 0; k < ri.length; k += 3) {
        ground.tri(base + ri[k], base + ri[k + 1], base + ri[k + 2]);
        col.tri(cBase + ri[k], cBase + ri[k + 1], cBase + ri[k + 2]);
      }
    }

    // Eternal Flame of Independence: stepped plinth, tapering column, bowl; the flame itself is a
    // separate animated mesh (see flame()).
    const top = this.summit();
    const y = top.y;
    chunkGb.brush(tint('#d9d2c4'), L.concrete, 90, 2);
    chunkGb.box(top.x, y - 1, top.z, 7, 1.6, 7, 4);
    chunkGb.box(top.x, y + 0.6, top.z, 4.6, 0.8, 4.6, 4);
    chunkGb.cylinder(top.x, y + 1.4, top.z, 0.9, 7.5, 8, 4, false, 0.55);
    chunkGb.brush(tint('#7a6a55'), L.metal, 90, 2);
    chunkGb.cylinder(top.x, y + 8.9, top.z, 0.55, 0.5, 10, 2, true, 1.05);
    col.box(top.x, y - 1, top.z, 7, 1.6, 7, 1);
    col.box(top.x, y + 0.6, top.z, 4.6, 9, 4.6, 1);
    // Toposcope table a little way off.
    chunkGb.brush(tint('#cfc6b4'), L.concrete, 91, 2);
    chunkGb.cylinder(top.x + 9, this.heightAt(top.x + 9, top.z + 4) - 0.3, top.z + 4, 1.1, 1.3, 12, 2, true);
    this.flamePos = new THREE.Vector3(top.x, y + 9.45, top.z);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(col.positionsOf(), 3));
    return geo;
  }

  summit() {
    const c = this.center;
    let best = { x: c.x, z: c.z, y: this.heightAt(c.x, c.z) };
    for (let k = 0; k < 200; k++) {
      const a = k * 2.399;
      const d = Math.sqrt(k) * 6;
      const x = c.x + Math.cos(a) * d;
      const z = c.z + Math.sin(a) * d;
      const y = this.heightAt(x, z);
      if (y > best.y) best = { x, z, y };
    }
    return best;
  }
}

// Flickering flame (always lit), animated by the city update.
export function createFlame(pos) {
  const geo = new THREE.ConeGeometry(0.5, 1.8, 7, 1, true);
  geo.translate(0, 0.9, 0);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.1, 0.35), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  const inner = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.0, 1.0), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  inner.scale.set(0.5, 0.7, 0.5);
  mesh.add(inner);
  return {
    mesh,
    update(t) {
      const f = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 29 + 1) * 0.06;
      mesh.scale.set(1 + Math.sin(t * 7) * 0.05, f, 1 + Math.cos(t * 9) * 0.05);
      mesh.rotation.y = t * 0.7;
    },
  };
}
