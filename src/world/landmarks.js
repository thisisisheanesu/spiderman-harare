import { cleanRing, edgeNormals, offsetRing, orientedBox } from './polygon.js';
import { MISC_CELLS, miscUV } from './facades.js';
import { tint } from './palette.js';
import { makeRng } from '../core/rng.js';
import { lonLatToXZ } from '../core/geo.js';

// Researched Harare landmarks (keys from tools/landmark_overrides.json, echoed as buildings[].lm):
// style tweaks for their facades and custom geometry for their silhouettes. Anything that sticks
// out of the plain footprint extrusion is also written to the building's collider buffer.

const STYLE = {
  rbz: { upper: 'granite', ground: 'lobby', glass: 4, tint: '#d8cfc4' },
  rbz_podium: { upper: 'granite', ground: 'lobby', glass: 4, tint: '#d8cfc4' },
  joina_city: { glass: 6 },
  eastgate_block_n: { upper: 'eastgate', ground: 'shop', tint: '#d4cdc2', parapet: false, clutter: 0 },
  eastgate_block_s: { upper: 'eastgate', ground: 'shop', tint: '#d4cdc2', parapet: false, clutter: 0 },
  eastgate: { upper: 'curtain', ground: 'shop', roofLayer: 'curtain', roofKind: 0, glass: 0, clutter: 0 },
  town_house: { upper: 'colonial', ground: 'colshop', clutter: 0 },
  parliament_house: { upper: 'colonial', ground: 'colshop', verandah: true, clutter: 0 },
  anglican_cathedral: { upper: 'colonial', ground: null, tint: '#c9b294', clutter: 0 },
  sacred_heart_cathedral: { upper: 'brick', ground: null, tint: '#ffffff', clutter: 0 },
  main_post_office: { upper: 'colonial' },
  harare_station: { upper: 'colonial', ground: 'colshop', verandah: true },
  meikles: { upper: 'balcony', glass: 0 },
  meikles_south: { upper: 'balcony', glass: 0 },
  monomotapa: { upper: 'balcony', glass: 0, thicken: 7 },
  rainbow_towers: { upper: 'curtain', glass: 5, tint: '#d9b866' },
  zanu_pf_hq: { clutter: 0.3 },
  old_mutual_centre: { glass: 3 },
};

const PALM_KEYS = new Set(['town_house', 'parliament_house', 'meikles', 'rainbow_towers', 'harare_station', 'monomotapa']);

export class Landmarks {
  constructor(data) {
    this.data = data;
    this.palms = [];
  }

  adjustSpec(b, spec) {
    const st = STYLE[b.lm];
    if (!st) return;
    if (st.upper) spec.upper = st.upper;
    if (st.ground !== undefined) spec.ground = st.ground;
    if (st.glass !== undefined) spec.glass = st.glass;
    if (st.tint) spec.tint = tint(st.tint);
    if (st.parapet !== undefined) spec.parapet = st.parapet;
    if (st.clutter !== undefined) spec.clutter = st.clutter;
    if (st.verandah) spec.verandah = true;
    if (st.roofLayer) {
      spec.roofLayer = st.roofLayer;
      spec.roofKind = st.roofKind;
    }
    if (st.thicken) {
      // Monomotapa: the mapped footprint is a thin curved sliver; extrude a proper crescent slab.
      const fp = cleanRing(b.fp);
      spec.fp = offsetRing(fp, edgeNormals(fp, true), st.thicken);
      spec.fullCollider = true;
    }
  }

  // Custom silhouette pieces after the standard building has been emitted.
  decorate(b, spec, gb, col, L, world) {
    const fp = cleanRing(spec.fp || b.fp);
    const obb = orientedBox(fp);
    const seed = b.seed;
    switch (b.lm) {
      case 'rbz':
        rbzTaper(gb, col, L, fp, b, spec, seed);
        break;
      case 'joina_city':
        ringCrown(gb, col, L, obb, b.h, seed);
        break;
      case 'eastgate_block_n':
      case 'eastgate_block_s':
        chimneyRoof(gb, col, L, obb, b.h, seed);
        break;
      case 'town_house':
        clockTower(gb, col, L, fp, spec, world, seed);
        break;
      case 'anglican_cathedral':
        endTowers(gb, col, L, obb, spec, 1, 8, 28, seed, world);
        break;
      case 'sacred_heart_cathedral':
        endTowers(gb, col, L, obb, spec, 2, 5, 24, seed, world);
        break;
      case 'zanu_pf_hq':
        gableCrown(gb, col, L, obb, b.h, spec, seed);
        break;
      default:
        break;
    }
    if (PALM_KEYS.has(b.lm)) this._palmsAlong(fp, world);
  }

  _palmsAlong(fp, world) {
    const normals = edgeNormals(fp, true);
    const n = fp.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = fp[i * 2];
      const az = fp[i * 2 + 1];
      const dx = fp[j * 2] - ax;
      const dz = fp[j * 2 + 1] - az;
      const len = Math.hypot(dx, dz);
      if (len < 12) continue;
      const nx = normals[i * 2];
      const nz = normals[i * 2 + 1];
      for (let t = 5; t < len - 4; t += 9) {
        const x = ax + (dx / len) * t + nx * 3.2;
        const z = az + (dz / len) * t + nz * 3.2;
        const road = world.nearestRoad(x, z, 20);
        if (!road || road.dist < road.road.w / 2 + 1.2 || road.dist > road.road.w / 2 + 9) continue;
        if (world.buildingAt(x, z)) continue;
        this.palms.push({ x, y: 0.15, z, s: 0.85 + ((t * 7) % 3) * 0.1, rot: t, c: [1, 1, 1] });
      }
    }
  }

  // One-off pieces that are not buildings: the Rainbow Towers hotel tower (synthetic, it is not in
  // the footprint data), the Mbuya Nehanda statue and the Africa Unity Square fountain.
  extras(chunks, colliderFor, L, emit, paths, G) {
    const data = this.data;
    const lm = (data.meta.landmarks || []).find((l) => l.key === 'rainbow_towers');
    if (lm) {
      const c = lonLatToXZ(31.0359, -17.8314);
      const a = (25 * Math.PI) / 180;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      const L2 = 27.5;
      const W2 = 10;
      const fp = [
        c.x - ux * L2 + uz * W2, c.z - uz * L2 - ux * W2,
        c.x + ux * L2 + uz * W2, c.z + uz * L2 - ux * W2,
        c.x + ux * L2 - uz * W2, c.z + uz * L2 + ux * W2,
        c.x - ux * L2 - uz * W2, c.z - uz * L2 + ux * W2,
      ];
      emit({ id: -7, oid: 'rainbow-towers-hotel', fp, h: 75, fl: 19, core: 1, lm: 'rainbow_towers', cx: c.x, cz: c.z }, { fullCollider: true });
    }
    const statue = data.features.find((f) => f.key === 'mbuya_nehanda_statue');
    if (statue) nehanda(chunks.detailAt(statue.x, statue.z), colliderFor(-8), L, statue.x, statue.z);
    const fountain = data.features.find((f) => f.kind === 'fountain');
    if (fountain) fountainAt(chunks.detailAt(fountain.x, fountain.z), colliderFor(-9), L, fountain.x, fountain.z, paths, G);
  }
}

// Wall ring between y0..y1 on `ring` (outward normals) with a cap ring down to `inner` at y1.
function shellRing(gb, col, ring, inner, y0, y1, fh, layer, tintBytes, seed, tileW) {
  const normals = edgeNormals(ring, true);
  const n = ring.length / 2;
  gb.brush(tintBytes, layer, seed, 0, 0, 4);
  let u = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const bx = ring[j * 2];
    const bz = ring[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.1) continue;
    const nb = Math.max(1, Math.round(len / tileW));
    gb.wall(ax, az, bx, bz, y0, y1, normals[i * 2], normals[i * 2 + 1], u, u + nb, y0 / fh, y1 / fh);
    col.wall(ax, az, bx, bz, y0, y1, normals[i * 2], normals[i * 2 + 1], 0, 1, 0, 1);
    u += nb;
  }
  gb.setKind(2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const q = [ring[i * 2], y1, ring[i * 2 + 1], ring[j * 2], y1, ring[j * 2 + 1], inner[j * 2], y1, inner[j * 2 + 1], inner[i * 2], y1, inner[i * 2 + 1]];
    gb.quad(...q, 0, 1, 0, 0, 0, 1, 0.2);
    col.quad(...q, 0, 1, 0, 0, 0, 1, 1);
  }
}

// Reserve Bank: broad granite base stepping in twice towards the top, a coronet of fins set back
// from the roof edge and a mast (off-centre so the roof centre stays clear for spawning).
function rbzTaper(gb, col, L, fp, b, spec, seed) {
  const normals = edgeNormals(fp, true);
  const outer = offsetRing(fp, normals, 3.2);
  const mid = offsetRing(fp, normals, 1.6);
  shellRing(gb, col, outer, mid, 0, b.h - 24, spec.fh, L.granite, spec.tint, seed, 1.8);
  shellRing(gb, col, mid, fp, b.h - 24, b.h - 12, spec.fh, L.granite, spec.tint, seed, 1.8);
  // Coronet of fins set back from the roof edge (the edge stays clear for perching).
  const crown = offsetRing(fp, normals, -6);
  const n = crown.length / 2;
  gb.brush(spec.tint, L.concrete, seed, 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = crown[i * 2];
    const az = crown[i * 2 + 1];
    const bx = crown[j * 2];
    const bz = crown[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const ex = (bx - ax) / len;
    const ez = (bz - az) / len;
    const nx = normals[i * 2];
    const nz = normals[i * 2 + 1];
    const fins = Math.max(1, Math.round(len / 2.4));
    for (let k = 0; k < fins; k++) {
      const t = ((k + 0.5) / fins) * len;
      const x = ax + ex * t;
      const z = az + ez * t;
      gb.setTransform(x, b.h, z, Math.atan2(nx, nz));
      gb.box(0, 0, 0, 0.45, 5.5, 0.9, 4);
      gb.clearTransform();
      col.setTransform(x, b.h, z, Math.atan2(nx, nz));
      col.box(0, 0, 0, 0.45, 5.5, 0.9, 1);
      col.clearTransform();
    }
    // Ring beam tying the fins together.
    gb.setTransform((ax + bx) / 2, b.h + 5.5, (az + bz) / 2, Math.atan2(nx, nz));
    gb.box(0, 0, 0, len + 0.6, 0.55, 0.7, 4);
    gb.clearTransform();
  }
  const obb = orientedBox(fp);
  const mx = obb.cx + obb.ux * 4;
  const mz = obb.cz + obb.uz * 4;
  gb.brush(tint('#9aa0a4'), L.metal, seed, 2);
  gb.cylinder(mx, b.h, mz, 0.35, 16, 6, 2, false, 0.12);
  gb.box(mx, b.h, mz, 1.4, 1.2, 1.4, 1);
  // Red aircraft warning light (lit at night).
  gb.brush(tint('#ff3020'), L.misc, seed, 3);
  gb.box(mx, b.h + 16, mz, 0.35, 0.35, 0.35, 1);
  col.box(mx, b.h, mz, 1.4, 16, 1.4, 1);
}

function ringCrown(gb, col, L, obb, h, seed) {
  if (!obb) return;
  const R = 0.36 * Math.min(obb.len, obb.wid);
  gb.brush(tint('#dcd6ca'), L.concrete, seed, 2);
  for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = obb.cx + obb.ux * su * R * 0.7 - obb.uz * sv * R * 0.7;
    const z = obb.cz + obb.uz * su * R * 0.7 + obb.ux * sv * R * 0.7;
    gb.box(x, h, z, 0.9, 7.2, 0.9, 4);
    col.box(x, h, z, 0.9, 7.2, 0.9, 1);
  }
  const segs = 32;
  const y0 = h + 7;
  const y1 = h + 10;
  const ring = (r) => {
    const out = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      out.push(obb.cx + Math.cos(a) * r, obb.cz + Math.sin(a) * r);
    }
    return out;
  };
  const outer = ring(R);
  const inner = ring(R - 1.0);
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    const a = ((i + 0.5) / segs) * Math.PI * 2;
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    for (const [r, sgn] of [[outer, 1], [inner, -1]]) {
      gb.wall(r[i * 2], r[i * 2 + 1], r[j * 2], r[j * 2 + 1], y0, y1, nx * sgn, nz * sgn, 0, 1, 0, 0.75);
      col.wall(r[i * 2], r[i * 2 + 1], r[j * 2], r[j * 2 + 1], y0, y1, nx * sgn, nz * sgn, 0, 1, 0, 1);
    }
    for (const [y, ny] of [[y1, 1], [y0, -1]]) {
      const q = [outer[i * 2], y, outer[i * 2 + 1], outer[j * 2], y, outer[j * 2 + 1], inner[j * 2], y, inner[j * 2 + 1], inner[i * 2], y, inner[i * 2 + 1]];
      gb.quad(...q, 0, ny, 0, 0, 0, 1, 0.25);
      col.quad(...q, 0, ny, 0, 0, 0, 1, 1);
    }
  }
}

// Eastgate: red-tiled pitched roof along each slab with rows of brick chimney funnels.
function chimneyRoof(gb, col, L, obb, h, seed) {
  if (!obb) return;
  const rise = 3.2;
  const hl = obb.len / 2;
  const hw = obb.wid / 2 + 0.3;
  const P = (u, v, y) => [obb.cx + obb.ux * u - obb.uz * v, y, obb.cz + obb.uz * u + obb.ux * v];
  gb.brush(tint('#b0553a'), L.tiles, seed, 2);
  for (const s of [1, -1]) {
    const a = P(-hl, s * hw, h);
    const b = P(hl, s * hw, h);
    const c = P(hl, 0, h + rise);
    const d = P(-hl, 0, h + rise);
    const nl = Math.hypot(rise, hw);
    const nx = (-obb.uz * s * rise) / nl;
    const nz = (obb.ux * s * rise) / nl;
    gb.quad(...a, ...b, ...c, ...d, nx, hw / nl, nz, 0, 0, obb.len / 3, nl / 3);
    col.quad(...a, ...b, ...c, ...d, nx, hw / nl, nz, 0, 0, 1, 1);
  }
  gb.brush(tint('#cfc8bc'), L.concrete, seed, 2);
  for (const e of [-1, 1]) {
    const a = P(e * hl, -hw, h);
    const b = P(e * hl, hw, h);
    const c = P(e * hl, 0, h + rise);
    const i0 = gb.vertex(...a, obb.ux * e, 0, obb.uz * e, 0, 0);
    const i1 = gb.vertex(...b, obb.ux * e, 0, obb.uz * e, 1, 0);
    const i2 = gb.vertex(...c, obb.ux * e, 0, obb.uz * e, 0.5, 0.8);
    gb.tri(i0, i1, i2);
    gb.tri(i0, i2, i1);
    const j0 = col.vertex(...a, 0, 1, 0, 0, 0);
    const j1 = col.vertex(...b, 0, 1, 0, 0, 0);
    const j2 = col.vertex(...c, 0, 1, 0, 0, 0);
    col.tri(j0, j1, j2);
  }
  const n = Math.round(obb.len / 6);
  const rot = -obb.angle;
  for (let k = 0; k < n; k++) {
    const u = -hl + ((k + 0.5) / n) * obb.len;
    for (const v of [-1.3, 1.3]) {
      const [x, , z] = P(u, v, 0);
      gb.brush(tint('#ffffff'), L.brick, seed, 2);
      gb.setTransform(x, h + rise - 1.5, z, rot);
      gb.box(0, 0, 0, 1.5, 6.5, 1.5, 3);
      gb.brush(tint('#8f8a80'), L.concrete, seed, 2);
      gb.box(0, 6.5, 0, 1.9, 0.25, 1.9, 2);
      gb.clearTransform();
      col.setTransform(x, h + rise - 1.5, z, rot);
      col.box(0, 0, 0, 1.5, 6.75, 1.5, 1);
      col.clearTransform();
    }
  }
}

// Town House: clock tower over the entrance on its main street front.
function clockTower(gb, col, L, fp, spec, world, seed) {
  const normals = edgeNormals(fp, true);
  const n = fp.length / 2;
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const len = Math.hypot(fp[j * 2] - fp[i * 2], fp[j * 2 + 1] - fp[i * 2 + 1]);
    const mx = (fp[i * 2] + fp[j * 2]) / 2 + normals[i * 2] * 8;
    const mz = (fp[i * 2 + 1] + fp[j * 2 + 1]) / 2 + normals[i * 2 + 1] * 8;
    const road = world.nearestRoad(mx, mz, 30);
    const score = len + (road && /Nyerere/.test(road.name) ? 100 : road ? 20 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  const j = (best + 1) % n;
  const nx = normals[best * 2];
  const nz = normals[best * 2 + 1];
  const x = (fp[best * 2] + fp[j * 2]) / 2 - nx * 3;
  const z = (fp[best * 2 + 1] + fp[j * 2 + 1]) / 2 - nz * 3;
  const rot = Math.atan2(nx, nz);
  const H = 26;
  const w = 7;
  gb.brush(spec.tint, L.colonial, seed, 0, 3, 0);
  gb.setTransform(x, 0, z, rot);
  gb.box(0, 0, 0, w, H, w, 3.8);
  gb.brush(tint('#ffffff'), L.misc, seed, 2);
  const [u0, v0, u1, v1] = miscUV(MISC_CELLS.clock);
  const cy = H - 4.5;
  const cs = 2.2;
  const o = w / 2 + 0.03;
  gb.quad(-cs, cy, o, cs, cy, o, cs, cy + 2 * cs, o, -cs, cy + 2 * cs, o, 0, 0, 1, u0, v0, u1, v1);
  gb.quad(cs, cy, -o, -cs, cy, -o, -cs, cy + 2 * cs, -o, cs, cy + 2 * cs, -o, 0, 0, -1, u0, v0, u1, v1);
  gb.quad(o, cy, cs, o, cy, -cs, o, cy + 2 * cs, -cs, o, cy + 2 * cs, cs, 1, 0, 0, u0, v0, u1, v1);
  gb.quad(-o, cy, -cs, -o, cy, cs, -o, cy + 2 * cs, cs, -o, cy + 2 * cs, -cs, -1, 0, 0, u0, v0, u1, v1);
  gb.brush(tint('#efe3c2'), L.concrete, seed, 2);
  gb.box(0, H, 0, w + 0.6, 0.5, w + 0.6, 4);
  gb.brush(tint('#b25e3e'), L.tiles, seed, 2);
  pyramid(gb, 0, H + 0.5, 0, w / 2 + 0.3, 4.5);
  gb.clearTransform();
  col.setTransform(x, 0, z, rot);
  col.box(0, 0, 0, w + 0.6, H + 0.5, w + 0.6, 1);
  pyramid(col, 0, H + 0.5, 0, w / 2 + 0.3, 4.5);
  col.clearTransform();
}

function pyramid(gb, x, y, z, r, h) {
  const c = [[-r, -r], [r, -r], [r, r], [-r, r]];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = c[k];
    const [bx, bz] = c[(k + 1) % 4];
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const nl = Math.hypot(h, r);
    const a = gb.vertex(x + ax, y, z + az, (mx / r) * (h / nl), r / nl, (mz / r) * (h / nl), 0, 0);
    const b = gb.vertex(x + bx, y, z + bz, (mx / r) * (h / nl), r / nl, (mz / r) * (h / nl), 2 * r / 3, 0);
    const t = gb.vertex(x, y + h, z, (mx / r) * (h / nl), r / nl, (mz / r) * (h / nl), r / 3, nl / 3);
    // Outward-facing winding.
    const cross = (bx - ax) * (0 - az) - (bz - az) * (0 - ax);
    if (cross < 0) gb.tri(a, b, t);
    else gb.tri(a, t, b);
  }
}

// Church towers at the street end of the long axis (1 central tower or 2 flanking ones).
function endTowers(gb, col, L, obb, spec, count, size, H, seed, world) {
  if (!obb) return;
  const hl = obb.len / 2;
  let end = 1;
  const pa = world.nearestRoad(obb.cx + obb.ux * hl, obb.cz + obb.uz * hl, 60);
  const pb = world.nearestRoad(obb.cx - obb.ux * hl, obb.cz - obb.uz * hl, 60);
  if (pb && (!pa || pb.dist < pa.dist)) end = -1;
  const rot = -obb.angle;
  const offs = count === 1 ? [0] : [-(obb.wid / 2 - size / 2), obb.wid / 2 - size / 2];
  for (const v of offs) {
    const u = end * (hl - size / 2);
    const x = obb.cx + obb.ux * u - obb.uz * v;
    const z = obb.cz + obb.uz * u + obb.ux * v;
    gb.brush(spec.tint, L[spec.upper], seed, 0, 3, 0);
    gb.setTransform(x, 0, z, rot);
    gb.box(0, 0, 0, size, H, size, 3.6);
    gb.brush(spec.tint, L.concrete, seed, 2);
    gb.box(0, H, 0, size + 0.5, 0.6, size + 0.5, 4);
    gb.brush(tint('#6a6660'), L.tiles, seed, 2);
    pyramid(gb, 0, H + 0.6, 0, size / 2, count === 1 ? 3 : 7);
    gb.clearTransform();
    col.setTransform(x, 0, z, rot);
    col.box(0, 0, 0, size + 0.5, H + 0.6, size + 0.5, 1);
    pyramid(col, 0, H + 0.6, 0, size / 2, count === 1 ? 3 : 7);
    col.clearTransform();
  }
}

// ZANU-PF HQ ("Shake Shake" building): tall gable crown like the beer carton top.
function gableCrown(gb, col, L, obb, h, spec, seed) {
  if (!obb) return;
  const hl = obb.len / 2 - 1;
  const hw = obb.wid / 2 - 1;
  const rise = 9;
  const P = (u, v, y) => [obb.cx + obb.ux * u - obb.uz * v, y, obb.cz + obb.uz * u + obb.ux * v];
  gb.brush(tint('#cfc6b3'), L.concrete, seed, 2);
  for (const s of [1, -1]) {
    const a = P(-hl, s * hw, h);
    const b = P(hl, s * hw, h);
    const c = P(hl, 0, h + rise);
    const d = P(-hl, 0, h + rise);
    const nl = Math.hypot(rise, hw);
    gb.quad(...a, ...b, ...c, ...d, (-obb.uz * s * rise) / nl, hw / nl, (obb.ux * s * rise) / nl, 0, 0, obb.len / 4, nl / 4);
    col.quad(...a, ...b, ...c, ...d, 0, 1, 0, 0, 0, 1, 1);
  }
  gb.brush(spec.tint, L.grid, seed, 0, 0, spec.glass);
  for (const e of [-1, 1]) {
    const a = P(e * hl, -hw, h);
    const b = P(e * hl, hw, h);
    const c = P(e * hl, 0, h + rise);
    const i0 = gb.vertex(...a, obb.ux * e, 0, obb.uz * e, 0, 0);
    const i1 = gb.vertex(...b, obb.ux * e, 0, obb.uz * e, obb.wid / 2.4, 0);
    const i2 = gb.vertex(...c, obb.ux * e, 0, obb.uz * e, obb.wid / 4.8, rise / 3.4);
    gb.tri(i0, i1, i2);
    gb.tri(i0, i2, i1);
    const j0 = col.vertex(...a, 0, 1, 0, 0, 0);
    const j1 = col.vertex(...b, 0, 1, 0, 0, 0);
    const j2 = col.vertex(...c, 0, 1, 0, 0, 0);
    col.tri(j0, j1, j2);
  }
}

// Mbuya Nehanda: bronze figure with a raised arm on a granite pedestal.
function nehanda(gb, col, L, x, z) {
  gb.brush(tint('#8d8478'), L.concrete, 5, 2);
  gb.box(x, 0, z, 3, 1.5, 3, 2);
  gb.brush(tint('#5c4630'), L.metal, 5, 2);
  gb.cylinder(x, 1.5, z, 0.6, 2.2, 10, 1, true, 0.22);
  gb.cylinder(x, 3.62, z, 0.2, 0.42, 8, 1, true, 0.19);
  gb.setTransform(x + 0.3, 3.1, z, 0.3);
  gb.box(0, 0, 0, 0.14, 1.2, 0.14, 1);
  gb.clearTransform();
  col.box(x, 0, z, 3, 1.5, 3, 1);
  col.box(x, 1.5, z, 1.2, 2.6, 1.2, 1);
}

// Africa Unity Square fountain: round basin, water, tiered centre with jets, ring of flower beds.
function fountainAt(gb, col, L, x, z, paths, G) {
  const R = 8.5;
  gb.brush(tint('#d8d0c2'), L.concrete, 6, 2);
  gb.cylinder(x, 0, z, R, 0.55, 28, 2, false);
  gb.cylinder(x, 0.55, z, R + 0.35, 0.08, 28, 2, true);
  gb.brush(tint('#ffffff'), L.water, 6, 0, 4, 6);
  gb.cylinder(x, 0.3, z, R - 0.05, 0.05, 28, 3, true);
  gb.brush(tint('#d8d0c2'), L.concrete, 6, 2);
  gb.cylinder(x, 0.3, z, 1.1, 1.3, 12, 2, true, 0.8);
  gb.cylinder(x, 1.6, z, 2.6, 0.3, 16, 2, true, 2.8);
  gb.cylinder(x, 1.9, z, 0.35, 1.0, 8, 2, true, 0.3);
  gb.brush(tint('#eef6ff'), L.misc, 6, 4);
  const rng = makeRng(12);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    gb.cylinder(x + Math.cos(a) * 5, 0.3, z + Math.sin(a) * 5, 0.06, 1.2 + rng() * 0.8, 5, 1, true, 0.02);
  }
  gb.cylinder(x, 2.9, z, 0.08, 2.2, 5, 1, true, 0.03);
  col.cylinder(x, 0, z, R + 0.35, 0.63, 16, 1, true);
  // Flower beds ringing the basin.
  paths.brush(tint('#ffffff'), G.flowers, 0, 0);
  const segs = 36;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    if (i % 9 === 0) continue;
    const r0 = R + 1.2;
    const r1 = R + 3.2;
    const q = [x + Math.cos(a0) * r0, 0.04, z + Math.sin(a0) * r0, x + Math.cos(a1) * r0, 0.04, z + Math.sin(a1) * r0,
      x + Math.cos(a1) * r1, 0.04, z + Math.sin(a1) * r1, x + Math.cos(a0) * r1, 0.04, z + Math.sin(a0) * r1];
    paths.quad(...q, 0, 1, 0, q[0] / 3, -q[2] / 3, q[6] / 3, -q[8] / 3);
  }
}

