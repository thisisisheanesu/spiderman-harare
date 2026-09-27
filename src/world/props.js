import * as THREE from 'three';
import { makeRng } from '../core/rng.js';
import { cleanRing, orientedBox, pointInRing } from './polygon.js';
import { isMajor } from './streetMetrics.js';
import { MISC_CELLS, miscUV } from './facades.js';
import { adUV } from './signs.js';
import { tint } from './palette.js';
import { makeCanvas } from './atlas.js';

// Street furniture merged into the city chunks: streetlights (about 40% are dead, as in the real
// CBD), litter bins, benches, bollards, kombi-rank shelters and billboards. Lit lamps also get an
// additive light pool on the ground at night (one instanced mesh).

const POLE = tint('#8c9297');
const DARK = tint('#3d4246');
const CONCRETE = tint('#cfc9bd');
const BIN_COLORS = ['#2e5d34', '#262626', '#c85a1a', '#2e5d34'].map((c) => tint(c));
const SHELTER_GREY = tint('#5f6b73');
const SHELTER_BLUE = tint('#365374');

// Galvanised pole with a single outreach arm; newer ones carry a solar panel on top.
function streetlight(gb, L, x, y, z, rot, lit, seed, solar, h = 9) {
  gb.setTransform(x, y, z, rot);
  gb.brush(POLE, L.metal, seed, 2);
  gb.box(0, 0, 0, 0.32, 0.6, 0.32, 1);
  gb.cylinder(0, 0, 0, 0.1, h, 6, 2, false, 0.065);
  if (solar) {
    // Tilted to face north (the sun's side in Harare).
    gb.clearTransform();
    gb.brush([255, 255, 255], L.solar, seed, 0, 4, 1);
    const top = y + h + 0.35;
    gb.quad(x - 0.6, top - 0.25, z - 0.45, x + 0.6, top - 0.25, z - 0.45, x + 0.6, top + 0.25, z + 0.45, x - 0.6, top + 0.25, z + 0.45, 0, 0.87, -0.49, 0, 0, 1, 1);
    gb.brush(POLE, L.metal, seed, 2);
    gb.quad(x - 0.6, top - 0.25, z - 0.45, x - 0.6, top + 0.25, z + 0.45, x + 0.6, top + 0.25, z + 0.45, x + 0.6, top - 0.25, z - 0.45, 0, -0.87, 0.49, 0, 0, 1, 1);
    gb.setTransform(x, y, z, rot);
    gb.box(0, h, 0, 0.08, 0.35, 0.08, 1);
  }
  gb.box(0, h - 0.25, 0.95, 0.07, 0.07, 1.9, 1);
  gb.brush(DARK, L.metal, seed, 2);
  gb.box(0, h - 0.42, 2.05, 0.34, 0.2, 0.72, 1, true);
  const [u0, v0, u1, v1] = miscUV(MISC_CELLS.lamp);
  gb.brush([255, 255, 255], L.misc, seed, lit ? 3 : 2);
  gb.quad(-0.14, h - 0.43, 1.75, 0.14, h - 0.43, 1.75, 0.14, h - 0.43, 2.35, -0.14, h - 0.43, 2.35, 0, -1, 0, u0, v0, u1, v1);
  gb.clearTransform();
}

// Tall grey median pole with two outreach arms, one over each carriageway.
function doubleLight(gb, L, x, y, z, rot, lit, seed, solar) {
  const h = 10;
  gb.setTransform(x, y, z, rot);
  gb.brush(POLE, L.metal, seed, 2);
  gb.box(0, 0, 0, 0.36, 0.6, 0.36, 1);
  gb.cylinder(0, 0, 0, 0.12, h, 6, 2, false, 0.08);
  const [u0, v0, u1, v1] = miscUV(MISC_CELLS.lamp);
  for (const s of [1, -1]) {
    gb.brush(POLE, L.metal, seed, 2);
    gb.box(0, h - 0.25, 1.0 * s, 0.07, 0.07, 2.0, 1);
    gb.brush(DARK, L.metal, seed, 2);
    gb.box(0, h - 0.42, 2.1 * s, 0.34, 0.2, 0.72, 1, true);
    gb.brush([255, 255, 255], L.misc, seed, lit ? 3 : 2);
    gb.quad(-0.14, h - 0.43, 2.1 * s - 0.3, 0.14, h - 0.43, 2.1 * s - 0.3, 0.14, h - 0.43, 2.1 * s + 0.3, -0.14, h - 0.43, 2.1 * s + 0.3, 0, -1, 0, u0, v0, u1, v1);
  }
  if (solar) {
    gb.brush([255, 255, 255], L.solar, seed, 0, 4, 1);
    gb.quad(-0.7, h + 0.3, -0.5, 0.7, h + 0.3, -0.5, 0.7, h + 0.7, 0.5, -0.7, h + 0.7, 0.5, 0, 0.93, -0.37, 0, 0, 1, 1);
  }
  gb.clearTransform();
}

function bin(gb, L, x, y, z, color, seed) {
  gb.brush(color, L.metal, seed, 2);
  gb.cylinder(x, y, z, 0.27, 0.9, 8, 1, true, 0.3);
  gb.brush(DARK, L.metal, seed, 2);
  gb.cylinder(x, y + 0.9, z, 0.31, 0.06, 8, 1, true);
}

function bench(gb, L, x, z, rot, seed) {
  gb.setTransform(x, 0, z, rot);
  gb.brush(tint('#8a6a4a'), L.metal, seed, 2);
  gb.box(0, 0.42, 0, 1.8, 0.07, 0.45, 1);
  gb.box(0, 0.5, -0.2, 1.8, 0.4, 0.06, 1);
  gb.brush(CONCRETE, L.concrete, seed, 2);
  gb.box(-0.75, 0, 0, 0.14, 0.42, 0.45, 1);
  gb.box(0.75, 0, 0, 0.14, 0.42, 0.45, 1);
  gb.clearTransform();
}

function planter(gb, col, L, x, z, rot) {
  gb.setTransform(x, 0, z, rot);
  gb.brush(tint('#ffffff'), L.brick, 4, 2);
  gb.box(0, 0, 0, 2.6, 0.55, 2.6, 3);
  gb.brush(tint('#4a3a2c'), L.concrete, 4, 2);
  gb.box(0, 0.55, 0, 2.3, 0.02, 2.3, 2);
  gb.clearTransform();
  col.setTransform(x, 0, z, rot);
  col.box(0, 0, 0, 2.6, 0.55, 2.6, 1);
  col.clearTransform();
}

function bollard(gb, L, x, z, seed) {
  gb.brush(CONCRETE, L.concrete, seed, 2);
  gb.cylinder(x, 0, z, 0.15, 0.75, 6, 1, true, 0.13);
}

// Long steel shelter (kombi ranks, railway platforms): posts, sloped iron roof, bench.
function shelter(gb, col, L, x, z, rot, len, d, frame) {
  const h = 3.1;
  gb.setTransform(x, 0, z, rot);
  gb.brush(frame, L.metal, 11, 2);
  const n = Math.max(2, Math.round(len / 3.5) + 1);
  for (let i = 0; i < n; i++) {
    const px = -len / 2 + (i * len) / (n - 1);
    gb.box(px, 0, -d / 2 + 0.2, 0.12, h, 0.12, 1);
    gb.box(px, 0, d / 2 - 0.2, 0.12, h - 0.3, 0.12, 1);
  }
  gb.brush(frame === SHELTER_BLUE ? frame : tint('#c0c4c4'), L.corrugated, 11, 2);
  gb.quad(-len / 2 - 0.2, h + 0.05, -d / 2, len / 2 + 0.2, h + 0.05, -d / 2, len / 2 + 0.2, h - 0.25, d / 2, -len / 2 - 0.2, h - 0.25, d / 2, 0, 0.995, 0.1, 0, 0, len / 3, 1);
  gb.quad(-len / 2 - 0.2, h - 0.25, d / 2, len / 2 + 0.2, h - 0.25, d / 2, len / 2 + 0.2, h + 0.05, -d / 2, -len / 2 - 0.2, h + 0.05, -d / 2, 0, -1, 0, 0, 0, len / 3, 1);
  gb.brush(CONCRETE, L.concrete, 11, 2);
  gb.box(0, 0, -d / 2 + 0.5, len - 0.6, 0.45, 0.4, 2);
  gb.clearTransform();
  col.setTransform(x, 0, z, rot);
  col.box(0, h - 0.3, 0, len + 0.4, 0.35, d, 1);
  col.clearTransform();
}

// Billboard on two posts (or a roof frame), ad face towards local +z.
function billboard(gb, col, L, x, y, z, rot, ad, adLayers, seed, postH) {
  const w = 6.4;
  const h = 3.2;
  gb.setTransform(x, y, z, rot);
  gb.brush(DARK, L.metal, seed, 2);
  for (const px of [-w / 3, w / 3]) gb.box(px, 0, -0.15, 0.3, postH + 0.2, 0.3, 1);
  gb.brush(tint('#6e757a'), L.metal, seed, 2);
  gb.box(0, postH, -0.15, w + 0.3, h + 0.3, 0.2, 2);
  gb.box(0, postH - 0.35, 0.4, w, 0.06, 0.8, 1);
  const [u0, v0, u1, v1] = adUV(ad % 2);
  gb.brush([255, 255, 255], adLayers[Math.floor(ad / 2)], seed, 4);
  gb.quad(-w / 2, postH + 0.15, -0.04, w / 2, postH + 0.15, -0.04, w / 2, postH + 0.15 + h, -0.04, -w / 2, postH + 0.15 + h, -0.04, 0, 0, 1, u0, v0, u1, v1);
  gb.clearTransform();
  col.setTransform(x, y, z, rot);
  col.box(0, postH, -0.15, w + 0.3, h + 0.3, 0.3, 1);
  col.clearTransform();
}

function poolTexture() {
  const S = 128;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

export function buildProps(ctx) {
  const { data, chunks, colliderFor, L, sidewalkPaths, medians, urbanAt, quality, world, frontages, signs, heightAt } = ctx;
  const rng = makeRng(4242);
  const density = quality.props;
  const roads = data.roads;
  const pools = [];
  const palms = [];

  // Streetlights and bins along the built pavements.
  for (const sp of sidewalkPaths) {
    const r = roads[sp.road];
    const urban = urbanAt(sp.pts[0], sp.pts[1]);
    const lit = isMajor(r) || urban > 0.4;
    if (!lit) continue;
    if (sp.side < 0 && r.w < 12 && !r.oneway) continue;
    const spacing = (isMajor(r) ? 34 : 42) / Math.max(0.5, density);
    let acc = sp.side > 0 ? spacing * 0.5 : spacing;
    const pts = sp.pts;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i];
      const az = pts[i + 1];
      const dx = pts[i + 2] - ax;
      const dz = pts[i + 3] - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      // Towards the road: -side * left(d).
      const tx = (-sp.side * dz) / len;
      const tz = (sp.side * dx) / len;
      for (let t = acc; t < len; t += spacing) {
        const px = ax + (dx / len) * t + tx * (sp.width / 2 - 0.4);
        const pz = az + (dz / len) * t + tz * (sp.width / 2 - 0.4);
        if (world.buildingAt(px, pz)) continue;
        const on = rng() < 0.6;
        const seed = Math.floor(rng() * 255);
        streetlight(chunks.detailAt(px, pz), L, px, heightAt(px, pz) + 0.15, pz, Math.atan2(tx, tz), on, seed, isMajor(r) && rng() < 0.45);
        if (on) pools.push(px + tx * 2.05, pz + tz * 2.05);
        if (urban > 0.5 && rng() < 0.35 * density) {
          const bx = px + (dx / len) * 3;
          const bz = pz + (dz / len) * 3;
          if (!world.buildingAt(bx, bz)) bin(chunks.detailAt(bx, bz), L, bx, heightAt(bx, bz) + 0.15, bz, rng.pick(BIN_COLORS), seed);
        }
      }
      acc = (acc - len) % spacing;
      if (acc < 0) acc += spacing;
    }
  }

  // Dual-carriageway medians: double-arm lights (many solar-powered now) and small palms. Both
  // halves of a median report it, so placements are de-duplicated on a coarse grid.
  const taken = new Set();
  const claim = (x, z, cell) => {
    const k = `${Math.round(x / cell)},${Math.round(z / cell)}`;
    if (taken.has(k)) return false;
    taken.add(k);
    return true;
  };
  for (const md of medians) {
    const pts = md.pts;
    let acc = 12;
    let count = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i];
      const az = pts[i + 1];
      const dx = pts[i + 2] - ax;
      const dz = pts[i + 3] - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      // Midline of the median: the outer edge of this half.
      const ox = ((md.side * dz) / len) * (md.width / 2);
      const oz = ((-md.side * dx) / len) * (md.width / 2);
      let t = acc;
      for (; t < len; t += 18) {
        const x = ax + (dx / len) * t + ox;
        const z = az + (dz / len) * t + oz;
        const k = count++ % 2;
        if (k === 0 && claim(x, z, 16)) {
          const on = rng() < 0.6;
          doubleLight(chunks.detailAt(x, z), L, x, heightAt(x, z) + 0.15, z, Math.atan2(dz, -dx), on, 5, rng() < 0.7);
          if (on) {
            for (const s of [1, -1]) pools.push(x + (dz / len) * 2.1 * s, z - (dx / len) * 2.1 * s);
          }
        } else if (k === 1 && md.width > 0.7 && claim(x, z, 16)) {
          palms.push({ species: 'palm', x, y: heightAt(x, z) + 0.15, z, s: 0.55 + rng() * 0.2, rot: rng() * 6.28, c: [1, 1, 1] });
        }
      }
      acc = t - len;
    }
  }

  // First Street Mall and other pedestrian streets: planters with palms and benches down the
  // middle, bollards at the ends; benches beside park footpaths.
  for (const p of data.paths) {
    if (p.pts.length < 4) continue;
    const pts = p.pts;
    if (p.cls === 'pedestrian') {
      for (const end of [0, pts.length - 2]) {
        const o = end === 0 ? 2 : -2;
        const dx = pts[end + o] - pts[end];
        const dz = pts[end + o + 1] - pts[end + 1];
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        for (let k = -p.w / 2 + 0.8; k <= p.w / 2 - 0.8; k += 1.6) {
          const x = pts[end] + (dx / len) * 1.5 + nx * k;
          const z = pts[end + 1] + (dz / len) * 1.5 + nz * k;
          bollard(chunks.detailAt(x, z), L, x, z, 7);
        }
      }
    }
    const gap = p.cls === 'pedestrian' ? 30 : p.cls === 'footway' ? 30 : 0;
    if (!gap) continue;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i];
      const az = pts[i + 1];
      const dx = pts[i + 2] - ax;
      const dz = pts[i + 3] - az;
      const len = Math.hypot(dx, dz);
      const nx = -dz / len;
      const nz = dx / len;
      for (let t = gap / 2; t < len - 3; t += gap / density) {
        const cx = ax + (dx / len) * t;
        const cz = az + (dz / len) * t;
        if (p.cls === 'pedestrian') {
          // Mall: a raised brick planter with a Washingtonia palm, benches either side.
          if (world.buildingAt(cx, cz)) continue;
          planter(chunks.detailAt(cx, cz), colliderFor(-10), L, cx, cz, Math.atan2(dx, dz));
          palms.push({ species: 'palm', x: cx, y: 0.55, z: cz, s: 0.9 + rng() * 0.3, rot: rng() * 6.28, c: [1, 1, 1] });
          for (const sgn of [1, -1]) {
            const x = cx + nx * 2.3 * sgn;
            const z = cz + nz * 2.3 * sgn;
            bench(chunks.detailAt(x, z), L, x, z, Math.atan2(nx * sgn, nz * sgn), 3);
          }
        } else {
          const sgn = rng() < 0.5 ? 1 : -1;
          const x = cx + nx * (p.w / 2 + 1.1) * sgn;
          const z = cz + nz * (p.w / 2 + 1.1) * sgn;
          if (world.buildingAt(x, z)) continue;
          bench(chunks.detailAt(x, z), L, x, z, Math.atan2(-nx * sgn, -nz * sgn), 3);
        }
      }
    }
  }

  // Kombi ranks: shelters along the bays, bollards around the edge. Railway platforms: long blue
  // steel canopies.
  for (const a of data.areas) {
    const rank = a.kind === 'rank' || (a.kind === 'platform' && /bus|terminus|square|rank/i.test(a.name || ''));
    if (!rank && a.kind !== 'platform') continue;
    const ring = cleanRing(a.pts);
    const obb = orientedBox(ring);
    if (!obb || obb.len < 15) continue;
    const rot = -obb.angle;
    const rows = rank ? Math.max(1, Math.floor(obb.wid / 26)) : 1;
    for (let k = 0; k < rows; k++) {
      const v = rank ? -obb.wid / 2 + 13 + k * 26 : 0;
      const len = rank ? Math.min(obb.len - 8, 36) : Math.min(obb.len - 4, 120);
      const x = obb.cx - obb.uz * v;
      const z = obb.cz + obb.ux * v;
      if (!pointInRing(x, z, ring) || world.buildingAt(x, z)) continue;
      shelter(chunks.detailAt(x, z), colliderFor(-5), L, x, z, rot, len, Math.min(3, obb.wid - 0.5), rank ? SHELTER_GREY : SHELTER_BLUE);
    }
    if (!rank) continue;
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const ax = ring[i];
      const az = ring[i + 1];
      const len = Math.hypot(ring[j] - ax, ring[j + 1] - az);
      for (let t = 1; t < len - 1; t += 3 / density) {
        const x = ax + ((ring[j] - ax) / len) * t;
        const z = az + ((ring[j + 1] - az) / len) * t;
        if (!world.buildingAt(x, z)) bollard(chunks.detailAt(x, z), L, x, z, 5);
      }
    }
  }

  // Billboards: on posts beside major roads away from the core, and on low CBD roofs.
  let ad = 0;
  const placed = [];
  const farFromOthers = (x, z, d) => placed.every(([px, pz]) => Math.hypot(px - x, pz - z) > d);
  for (const sp of sidewalkPaths) {
    const r = roads[sp.road];
    if (!(r.cls === 'trunk' || r.cls === 'primary' || r.cls === 'secondary') || sp.pts.length < 4) continue;
    const x0 = sp.pts[0];
    const z0 = sp.pts[1];
    const dx = sp.pts[2] - x0;
    const dz = sp.pts[3] - z0;
    const len = Math.hypot(dx, dz);
    if (len < 20 || urbanAt(x0, z0) > 0.45 || !farFromOthers(x0, z0, 260)) continue;
    const ox = (sp.side * dz) / len;
    const oz = (-sp.side * dx) / len;
    const x = x0 + (dx / len) * (len / 2) + ox * (sp.width / 2 + 3.5);
    const z = z0 + (dz / len) * (len / 2) + oz * (sp.width / 2 + 3.5);
    let clear = !world.buildingAt(x, z) && !world.buildingAt(x + (dx / len) * 3.5, z + (dz / len) * 3.5) && !world.buildingAt(x - (dx / len) * 3.5, z - (dz / len) * 3.5);
    const road = world.nearestRoad(x, z, 12);
    if (road && road.dist < road.road.w / 2 + 2.5) clear = false;
    if (!clear) continue;
    placed.push([x, z]);
    // Face the road, angled a little so passing traffic sees it.
    billboard(chunks.at(x, z), colliderFor(-6), L, x, 0, z, Math.atan2(-ox, -oz) + 0.35 * (rng() - 0.5), ad++ % 8, signs.adLayers, 21, 4.5);
  }
  for (const f of frontages) {
    const b = f.b;
    if (b.h < 6 || b.h > 16 || f.len < 8 || !f.street.road || !isMajor(f.street.road) || !farFromOthers(f.ax, f.az, 220)) continue;
    const mx = (f.ax + f.bx) / 2 - f.nx * 1.2;
    const mz = (f.az + f.bz) / 2 - f.nz * 1.2;
    if (world.roofHeightAt(mx, mz) !== b.h) continue;
    placed.push([mx, mz]);
    billboard(chunks.at(mx, mz), colliderFor(b.id), L, mx, b.h + 0.35, mz, Math.atan2(f.nx, f.nz), ad++ % 8, signs.adLayers, 22, 1.4);
  }

  // Night light pools under working lamps.
  const n = pools.length / 2;
  const geo = new THREE.PlaneGeometry(19, 19).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: poolTexture(), color: new THREE.Color('#ff9d4a'), transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true,
  });
  const lightPools = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    m.makeTranslation(pools[i * 2], 0.2, pools[i * 2 + 1]);
    lightPools.setMatrixAt(i, m);
  }
  lightPools.count = n;
  lightPools.visible = false;
  lightPools.renderOrder = 2;
  return { lightPools, palms };
}
