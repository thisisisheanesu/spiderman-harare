import { GeoBuffer } from './geoBuffer.js';
import { cleanRing, signedArea, edgeNormals, offsetRing, orientedBox, isConvex } from './polygon.js';
import { hashString, makeRng } from '../core/rng.js';
import { PALETTE, tint } from './palette.js';
import { glassPresetFor, MISC_CELLS, miscUV } from './facades.js';
import { addRooftopClutter } from './rooftops.js';
import { TINTABLE } from './render/pbrLibrary.js';

// Buildings: every footprint becomes textured walls (texture-array facade styles with windows that
// line up with the floors), a flat roof with a parapet (or a hip roof for small suburban houses),
// street-level shopfronts, canopies / colonial verandahs over the pavement and rooftop clutter.
// Geometry is merged per spatial chunk so the whole city is a few dozen draw calls.

const PARAPET = 0.35;
export const CHUNK = 400;

// Spatial chunks of merged geometry. Each chunk has a `base` buffer (walls, roofs, landmark
// silhouettes: always drawn) and a `detail` buffer (rooftop clutter, parapet caps, canopies,
// street furniture, signs: drawn only near the camera). Chunks are `size` metres inside `core`
// (the dense CBD, where shadows and detail need fine culling) and twice that outside it, where the
// low-rise suburbs are mostly seen from afar: fewer draw calls for the same city.
export class ChunkGrid {
  constructor(size = CHUNK, core = null) {
    this.size = size;
    this.core = core;
    this.map = new Map();
  }

  _entry(x, z) {
    const c = this.core;
    const inCore = !c || (x >= c.minX && x < c.maxX && z >= c.minZ && z < c.maxZ);
    const size = inCore ? this.size : this.size * 2;
    const ix = Math.floor(x / size);
    const iz = Math.floor(z / size);
    const k = (inCore ? 0 : 1) + 2 * (ix * 100003 + iz);
    let e = this.map.get(k);
    if (!e) {
      e = { base: new GeoBuffer(8192), detail: new GeoBuffer(8192), cx: (ix + 0.5) * size, cz: (iz + 0.5) * size, half: size / 2 };
      this.map.set(k, e);
    }
    return e;
  }

  at(x, z) {
    return this._entry(x, z).base;
  }

  detailAt(x, z) {
    return this._entry(x, z).detail;
  }
}

// Facade pattern names used by the landmark research -> our layer names.
const PATTERN_LAYER = { fins: 'fins', curtain: 'curtain', grid: 'grid', bands: 'bands', colonial: 'colonial', brick: 'brick' };

const COLONIAL_ZONE = (x, z) => x < -380 && z > -120 && z < 900;

function floorsOf(b, top) {
  let fl = b.fl || Math.round(top / 3.3);
  fl = Math.max(1, fl);
  let fh = top / fl;
  if (fh < 2.7 || fh > 4.6) {
    fl = Math.max(1, Math.round(top / 3.4));
    fh = top / fl;
  }
  return { fl, fh };
}

// Decides how a building looks. Deterministic per building (seeded by its Overture id).
export function planBuilding(b, ctx) {
  const rng = makeRng(hashString(b.oid || String(b.id)));
  b.seed = rng.int(0, 255);
  const area = Math.abs(signedArea(b.fp));
  const obb = orientedBox(b.fp);
  const core = !!b.core;
  const cls = b.cls || '';
  const residential = /apartments|residential|house|hotel|dormitory/.test(cls);
  const spec = {
    rng, area, obb,
    upper: 'punched', ground: null, tint: null, glass: 0, cls: residential ? 1 : 0,
    roof: 'flat', roofLayer: 'roofFlat', roofTint: tint(rng.pick(PALETTE.roofFlat)),
    parapet: area > 30, verandah: false, canopy: 0, clutter: 0, solar: false,
  };
  const pick = (weights) => {
    let t = 0;
    for (const k in weights) t += weights[k];
    let r = rng() * t;
    for (const k in weights) {
      r -= weights[k];
      if (r <= 0) return k;
    }
    return Object.keys(weights)[0];
  };
  const lmStyle = b.lm ? ctx.landmarkStyles.get(b.lm) : null;

  if (lmStyle) {
    spec.upper = PATTERN_LAYER[lmStyle.pattern] || 'bands';
    spec.tint = tint(lmStyle.facade || '#dcd6ca');
    spec.glass = glassPresetFor(lmStyle.glass);
    spec.ground = b.h > 8 ? (lmStyle.pattern === 'colonial' ? 'colshop' : 'lobby') : null;
    spec.cls = /hotel|monomotapa|meikles|holiday|rainbow/.test(b.lm) ? 1 : 0;
    spec.clutter = 0.6;
    spec.canopy = 0.3;
  } else if (core && b.h >= 28) {
    spec.upper = pick({ bands: 3, punched: 1.5, grid: 2, curtain: 1.2, fins: 1.5, pair: 1, balcony: residential ? 4 : 0 });
    spec.ground = rng() < 0.35 ? 'lobby' : 'shop';
    spec.clutter = 1;
    spec.canopy = 0.55;
  } else if (core && b.h >= 10) {
    spec.upper = pick({ bands: 3, punched: 3, pair: 2, grid: 1.5, fins: 1, brick: 1.2, balcony: residential ? 5 : 0.6, curtain: 0.4 });
    spec.ground = 'shop';
    spec.clutter = 0.8;
    spec.canopy = 0.55;
  } else if (core) {
    const colonial = COLONIAL_ZONE(b.cx, b.cz) ? rng() < 0.7 : rng() < 0.22;
    if (colonial) {
      spec.upper = 'colonial';
      spec.ground = 'colshop';
      spec.verandah = true;
      spec.tint = tint(rng.pick(PALETTE.colonial));
    } else {
      spec.upper = pick({ punched: 3, pair: 1.5, brick: 1.5, blank: 1, bands: 1 });
      spec.ground = 'shop';
      spec.canopy = 0.4;
    }
    spec.clutter = 0.6;
  } else if ((residential && b.h < 9) || (b.h < 8 && area < 450 && !/school|college|church|religious|civic|commercial|retail|industrial|warehouse/.test(cls))) {
    spec.upper = 'house';
    spec.cls = 1;
    spec.tint = tint(rng.pick(PALETTE.residential));
    const conv = obb && isConvex(b.fp) && b.fp.length <= 16;
    if (conv && obb.wid > 3) {
      spec.roof = 'hip';
      const tiles = rng() < 0.4;
      spec.roofLayer = tiles ? 'tiles' : 'corrugated';
      spec.roofTint = tint(rng.pick(tiles ? PALETTE.tiles : PALETTE.corrugated));
      spec.parapet = false;
    }
  } else if (area > 900 && b.h < 11) {
    spec.upper = 'industrial';
    spec.cls = 3;
    spec.tint = tint(rng.pick(PALETTE.industrial));
    spec.clutter = 0.3;
  } else {
    spec.upper = residential ? pick({ balcony: 3, punched: 2, brick: 1 }) : pick({ pair: 2, punched: 2, brick: 1.5, bands: 1, grid: 0.6 });
    spec.clutter = b.h > 8 ? 0.5 : 0.2;
    if (/school|college|church|religious|civic|hospital|medical/.test(cls)) spec.cls = 3;
  }

  if (b.roofColor && spec.roof === 'hip') spec.roofTint = tint(b.roofColor, 0.7);
  if (!spec.tint) {
    if (spec.upper === 'brick') spec.tint = tint(rng.pick(PALETTE.brick));
    else if (spec.upper === 'curtain') spec.tint = tint(rng.pick(PALETTE.glassFrame));
    else spec.tint = tint(rng.pick(residential ? PALETTE.residential : PALETTE.office));
  }
  if (!lmStyle) {
    if (spec.upper === 'curtain') spec.glass = rng.pick([1, 2, 3, 4, 6, 1, 4]);
    else spec.glass = rng.pick([0, 0, 0, 4, 4, 1, 2, 3, 7]);
  }
  if (b.lm && ctx.landmarks) ctx.landmarks.adjustSpec(b, spec);
  spec.solar = spec.cls === 1 ? rng() < 0.6 : rng() < 0.2;
  if (ctx.pbr) pickSurfaces(spec, b, ctx.pbr, rng, residential);

  // Hip roofs: ridge a little above the physics roof (b.h), eaves below, so the average matches.
  // Landmarks (Parliament House, the station) get the exact shape instead: eaves at b.h, where
  // the physics extrusion ends, and the roof faces themselves in the collider (solidRoof).
  if (spec.roof === 'hip') {
    const pitch = spec.roofLayer === 'tiles' ? 0.52 : 0.38;
    const rise = Math.min(2.4, Math.max(0.6, (obb.wid / 2 + 0.4) * Math.tan(pitch)), b.h + 0.5 - 2.4);
    if (b.lm) {
      spec.eaveY = b.h;
      spec.ridgeY = b.h + Math.max(0.5, rise);
      spec.solidRoof = true;
    } else {
      spec.ridgeY = b.h + 0.5;
      spec.eaveY = spec.ridgeY - Math.max(0.5, rise);
    }
    spec.wallTop = spec.eaveY;
  } else {
    spec.wallTop = b.h;
  }
  const windowTop = spec.roof === 'hip' ? spec.wallTop : Math.max(2.6, b.h - (b.h > 6 ? 0.8 : 0.3));
  Object.assign(spec, floorsOf(b, windowTop));
  spec.windowTop = windowTop;
  return spec;
}

const pickW = (rng, weights) => {
  let t = 0;
  for (const k in weights) t += weights[k];
  let r = rng() * t;
  for (const k in weights) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return Object.keys(weights)[0];
};

// PBR materials per building (public/textures/README.md "Suggested mapping from the map data"):
// wall + accent (sills, spandrels, piers, stall risers), ground-floor cladding, roof, window frame
// colour and weathering. Landmarks may preset wallMat / accentMat / roofMat names.
function pickSurfaces(spec, b, pbr, rng, residential) {
  let wall = spec.wallMat;
  let accent = spec.accentMat;
  let frame = 0;
  let weather = 1;
  const older = !b.lm && (spec.upper === 'colonial' || spec.upper === 'brick' || rng() < 0.3);
  if (!wall) {
    switch (spec.upper) {
      case 'brick':
        wall = rng() < 0.55 ? 'brick_face_red' : 'brick_face_salmon';
        accent = 'plaster_smooth';
        frame = rng() < 0.75 ? 2 : 0;
        break;
      case 'curtain':
        wall = 'metal_panel';
        accent = rng() < 0.6 ? 'granite_cladding_light' : 'concrete_painted';
        frame = rng() < 0.5 ? 0 : 1;
        weather = 0;
        break;
      case 'bands':
        wall = pickW(rng, { concrete_painted: 3, plaster_smooth: 2, brick_face_salmon: 0.7, concrete_board_formed: 0.5 });
        accent = 'concrete_raw';
        frame = rng() < 0.6 ? 0 : 1;
        break;
      case 'punched':
      case 'pair':
        wall = pickW(rng, { plaster_smooth: 3, concrete_painted: 2, plaster_textured: 1.2, brick_face_salmon: 0.9, stone_cladding_sand: 0.4 });
        accent = 'concrete_painted';
        frame = residential ? (rng() < 0.7 ? 2 : 1) : rng.pick([0, 1, 2]);
        break;
      case 'fins':
      case 'grid':
        wall = pickW(rng, { concrete_painted: 3, concrete_board_formed: 1, granite_cladding_light: 0.8, plaster_smooth: 1 });
        accent = rng() < 0.5 ? 'concrete_board_formed' : 'concrete_raw';
        frame = rng() < 0.6 ? 0 : 1;
        break;
      case 'balcony':
        wall = rng() < 0.6 ? 'plaster_smooth' : 'concrete_painted';
        accent = 'concrete_painted';
        frame = rng() < 0.6 ? 2 : 1;
        break;
      case 'colonial':
        wall = rng() < 0.4 ? 'plaster_peeling' : 'plaster_smooth';
        accent = 'plaster_smooth';
        frame = rng() < 0.6 ? 2 : 3;
        weather = 2;
        break;
      case 'house':
        wall = rng() < 0.6 ? 'plaster_textured' : 'plaster_smooth';
        accent = 'plaster_smooth';
        frame = rng() < 0.6 ? 2 : 0;
        break;
      case 'industrial':
        wall = rng() < 0.45 ? 'corrugated_weathered' : 'concrete_painted';
        accent = 'concrete_raw';
        weather = 2;
        break;
      // Painted landmark artwork: the material lends its relief and grain.
      case 'eastgate':
        wall = 'brick_face_salmon';
        accent = 'concrete_board_formed';
        break;
      case 'stone':
        wall = 'stone_cladding_sand';
        break;
      case 'frieze':
        wall = 'granite_cladding_light';
        break;
      case 'lattice':
        wall = 'concrete_board_formed';
        break;
      default:
        wall = 'concrete_painted';
        accent = 'concrete_raw';
    }
  }
  if (older) weather = Math.min(3, weather + 1);
  spec.wallMat = wall;
  spec.accentMat = accent || 'concrete_painted';
  // Non-tintable materials (face brick, stone, corrugated sheet) keep their own colour: the
  // building tint becomes a near-white multiplier for them.
  spec.wallTint = TINTABLE.has(wall) ? spec.tint : tint(rng.pick(PALETTE.brick), 0.92 + rng() * 0.12);
  // Street level: shop piers in the wall material or granite; stall risers in dark granite / tiles.
  if (!spec.groundMat) {
    spec.groundMat = rng() < 0.55 ? wall : pickW(rng, { granite_cladding_light: 2, metal_panel: 1, concrete_painted: 1 });
    spec.groundAccent = rng() < 0.65 ? 'granite_dark_tiles' : 'granite_cladding_light';
    if (spec.ground === 'lobby') {
      spec.groundMat = 'granite_dark_tiles';
      spec.groundAccent = 'granite_cladding_light';
    }
  }
  spec.groundTint = TINTABLE.has(spec.groundMat) ? spec.tint : tint('#ffffff', 0.95);
  spec.flags = (frame << 2) | (weather << 4);
  spec.ids = { wall: pbr.id(wall), accent: pbr.id(spec.accentMat), ground: pbr.id(spec.groundMat), groundAccent: pbr.id(spec.groundAccent) };
  // Roofs.
  if (!spec.roofMat) {
    if (spec.roof === 'hip') {
      if (spec.roofLayer === 'tiles') {
        spec.roofMat = 'clay_tile_roof';
        spec.roofTint = tint(rng.pick(['#ffffff', '#f0e2da', '#e2d0c4', '#ffffff']), 0.9 + rng() * 0.15);
      } else if (b.roofColor || rng() < 0.55) {
        spec.roofMat = 'ibr_sheet_painted';
        spec.roofTint = tint(b.roofColor || rng.pick(['#8a3a2c', '#7a2f25', '#3f5f45', '#44566e', '#6d6f70', '#9a4a32']), b.roofColor ? 0.8 : 1);
      } else {
        spec.roofMat = 'corrugated_weathered';
        spec.roofTint = tint('#ffffff', 0.85 + rng() * 0.25);
      }
    } else if (spec.upper === 'industrial') {
      spec.roofMat = rng() < 0.6 ? 'corrugated_weathered' : 'roof_membrane';
      spec.roofTint = tint('#ffffff', 0.85 + rng() * 0.2);
    } else {
      spec.roofMat = pickW(rng, { roof_gravel: 4, roof_membrane: 3, concrete_raw: 2 });
      spec.roofTint = spec.roofMat === 'concrete_raw' ? tint(rng.pick(['#a39e96', '#b3ada4', '#98948e'])) : tint('#ffffff', 0.82 + rng() * 0.25);
    }
  }
  spec.ids.roof = pbr.id(spec.roofMat);
}

// Which street (if any) an outer wall edge faces, and how much pavement lies in front of it.
// `streets` indexes carriageways and pedestrian malls (see StreetIndex in roads.js).
function streetFacing(streets, ax, az, bx, bz, nx, nz, L) {
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const hit = streets.nearest(mx + nx * 1.5, mz + nz * 1.5, 45);
  if (!hit) return null;
  const ex = (bx - ax) / L;
  const ez = (bz - az) / L;
  if (Math.abs(ex * hit.dx + ez * hit.dz) < 0.8) return null;
  const d = (hit.x - mx) * nx + (hit.z - mz) * nz;
  if (d < 0) return null;
  const avail = d - hit.w / 2;
  if (avail < (hit.mall ? -1 : 0.3) || avail > hit.sidewalk + 14) return null;
  return { road: hit.road, mall: hit.mall, avail: hit.mall ? 0 : avail };
}

// Emits one building into `gb`; solid extras (canopies, lift rooms...) go to `col`.
// Returns street frontages usable for shop signs.
export function emitBuilding(b, spec, gb, detail, col, ctx) {
  const { L, tileW, world, quality } = ctx;
  const seed = b.seed;
  const rng = spec.rng;
  const fp = cleanRing(spec.fp || b.fp);
  if (fp.length < 6) return [];
  const i0 = gb.iCount;
  const holes = (b.holes || []).map((h) => cleanRing(h)).filter((h) => h.length >= 6);
  const frontages = [];
  const { fh, wallTop } = spec;
  const flat = spec.roof === 'flat';
  // spec.roofY could end the standard walls below b.h, but physics extrudes every footprint up to
  // b.h, so anything built that way must fill the gap itself (no landmark does this now).
  const roofY = spec.roofY ?? b.h;
  const parapetTop = flat && spec.parapet ? roofY + PARAPET : Math.min(wallTop, roofY);
  const bandTint = tint('#ffffff', 0.93).map((v, i) => Math.round((v * spec.tint[i]) / 255));
  // Raised parts (minH: bridges, overhangs) float above the street like their physics extrusion.
  const base = b.minH || 0;

  const rings = [fp, ...holes];
  rings.forEach((ring, ri) => {
    const outer = ri === 0;
    const normals = edgeNormals(ring, outer);
    const n = ring.length / 2;
    let u0 = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2];
      const az = ring[i * 2 + 1];
      const bx = ring[j * 2];
      const bz = ring[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.12) continue;
      const nx = normals[i * 2];
      const nz = normals[i * 2 + 1];
      let y0 = base;
      const street = !base && outer && spec.ground && b.core && len > 2.5 ? streetFacing(ctx.streets, ax, az, bx, bz, nx, nz, len) : null;
      if (street && (spec.windowTop > fh * 1.6 || spec.fl === 1)) {
        const gl = spec.ground;
        const nb = Math.max(1, Math.round(len / tileW[gl]));
        gb.brush(spec.groundTint || spec.tint, L[gl], seed, 0, 2, spec.glass);
        emitShopWall(gb, spec, ctx, b, ax, az, bx, bz, fh, nx, nz, nb);
        y0 = fh;
        frontages.push({ b, ax, az, bx, bz, nx, nz, len, y: fh, street, canopy: null, seed });
      }
      const top = Math.min(spec.windowTop, roofY);
      if (top > y0 + 0.05) {
        const tiny = len < tileW[spec.upper] * 0.45;
        const layer = tiny ? 'blank' : spec.upper;
        const nb = tiny ? len / tileW.blank : Math.max(1, Math.round(len / tileW[layer]));
        gb.brush(spec.wallTint || spec.tint, L[layer], seed, 0, spec.cls, spec.glass);
        if (spec.ids) gb.surface(spec.ids.wall, spec.ids.accent, 0, spec.flags);
        gb.wall(ax, az, bx, bz, y0, top, nx, nz, u0, u0 + nb, y0 / fh, top / fh);
        u0 += Math.ceil(nb);
      }
      if (parapetTop > top + 0.02) {
        gb.brush(bandTint, L.concrete, seed, 2);
        gb.wall(ax, az, bx, bz, top, parapetTop, nx, nz, 0, len / tileW.concrete, top / 4, parapetTop / 4);
      }
    }
    // Parapet: inner face + cap (detail: only visible up close). In the CBD core the parapet is
    // solid as well (cap + outer face above the physics roof; the extrusion stops at b.h), so
    // feet perched on a roof edge stand on the lip instead of sinking behind it.
    if (flat && spec.parapet) {
      const solid = !!b.core;
      const inner = offsetRing(ring, normals, -0.28);
      detail.brush(bandTint, L.concrete, seed, 2);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = ring[i * 2];
        const az = ring[i * 2 + 1];
        const bx = ring[j * 2];
        const bz = ring[j * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.12) continue;
        const nx = normals[i * 2];
        const nz = normals[i * 2 + 1];
        const cx = inner[i * 2];
        const cz = inner[i * 2 + 1];
        const dx = inner[j * 2];
        const dz = inner[j * 2 + 1];
        detail.wall(cx, cz, dx, dz, roofY, parapetTop, -nx, -nz, 0, len / 4, 0, PARAPET / 4);
        detail.quad(ax, parapetTop, az, bx, parapetTop, bz, dx, parapetTop, dz, cx, parapetTop, cz, 0, 1, 0, 0, 0, len / 4, 0.07);
        if (solid) {
          col.quad(ax, parapetTop, az, bx, parapetTop, bz, dx, parapetTop, dz, cx, parapetTop, cz, 0, 1, 0, 0, 0, 1, 1);
          // (a fullCollider copy of the base buffer already holds the outer face)
          if (!spec.fullCollider) col.wall(ax, az, bx, bz, roofY, parapetTop, nx, nz, 0, 1, 0, 1);
        }
      }
      // Projecting coping / cornice along the outer walls: real relief that catches the sun and
      // throws a shadow line (detail layer: only drawn near the camera). Deeper on colonial fronts.
      if (outer && b.core && !b.lm && spec.ids && CORNICE[spec.upper]) {
        const [proj, h] = CORNICE[spec.upper];
        emitCornice(detail, ring, normals, parapetTop - h + 0.04, parapetTop + 0.04, proj, bandTint, L, seed, spec.ids.accent);
        // A second, slimmer band where the parapet meets the top floor.
        if (spec.upper === 'colonial' || spec.upper === 'bands') emitCornice(detail, ring, normals, Math.min(spec.windowTop, roofY) - 0.12, Math.min(spec.windowTop, roofY), proj * 0.6, bandTint, L, seed, spec.ids.accent);
      }
    }
  });

  if (flat) {
    const layer = spec.roofLayer || 'roofFlat';
    gb.brush(spec.roofTint, L[layer], seed, spec.roofKind ?? 2, spec.cls, spec.glass);
    if (spec.ids && layer === 'roofFlat') gb.surface(spec.ids.roof, 255, 0, 0);
    gb.polygon(fp, holes, roofY, tileW[layer]);
  } else {
    emitHipRoof(fp, spec, gb, L, tileW, seed, spec.solidRoof ? col : null);
  }
  if (base > 0) {
    gb.brush(bandTint, L.concrete, seed, 2);
    gb.polygon(fp, holes, base, tileW.concrete, false);
  }

  // Canopies / verandahs over the pavement on street frontages.
  for (const f of frontages) {
    const { street } = f;
    if (spec.verandah && street.avail > 1.6) {
      f.canopy = emitVerandah(f, spec, detail, col, L, rng, Math.min(3.2, street.avail - 0.35), ctx.obstacles);
    } else if (spec.canopy && street.avail > 1.9 && rng() < spec.canopy) {
      f.canopy = emitCanopy(f, spec, detail, col, L, rng, Math.min(3.0, street.avail - 0.5));
    }
  }

  if (spec.fullCollider) copyTriangles(gb, i0, col);
  if (b.lm && ctx.landmarks) ctx.landmarks.decorate(b, spec, gb, col, L, world);

  // Rooftop clutter on flat roofs.
  if (flat && spec.obb && spec.area > 45 && roofY > 5 && spec.clutter > 0) {
    const normals = edgeNormals(fp, true);
    const inner = offsetRing(fp, normals, -1.1);
    const holeRings = holes.map((h) => offsetRing(h, edgeNormals(h, false), -1.1));
    addRooftopClutter(detail, col, L, b, inner, holeRings, roofY, spec.obb, rng, {
      base: gb,
      liftRoom: b.h > 12 && spec.area > 140,
      clutter: spec.clutter * quality.props,
      solar: spec.solar,
      wallTint: bandTint,
    });
  }
  return frontages;
}

// Interior-atlas cell (public/textures/glass/interiors.json) for a shop category (shops.json).
const SHOP_CELL = {
  supermarket: 4, grocery: 4, wholesale: 4, liquor: 4, pharmacy: 4, butcher: 4, bakery: 4, market: 4, retail: 4, clinic: 4,
  clothing: 5, shoes: 5, department: 5, jewellery: 5, salon: 5, fast_food: 5, restaurant: 5, cafe: 5, bar: 5, cinema: 5,
  hardware: 6, auto_parts: 6, electronics: 6, phone: 6, telecom: 6, furniture: 6, stationery: 6, printing: 6, books: 6,
  bank: 0, money: 0, finance: 0, insurance: 0, travel: 0, courier: 0, office: 0, government: 0, hotel: 0, mall: 4,
};

// Ground-floor shopfront wall, one quad per bay so each bay can show the interior of the real
// business trading there (shops.json, matched by building, facade normal and anchor position).
function emitShopWall(gb, spec, ctx, b, ax, az, bx, bz, fh, nx, nz, nb) {
  const ids = spec.ids;
  const surface = (hint) => {
    if (ids) gb.surface(ids.ground, ids.groundAccent, hint, spec.flags);
  };
  const shops = ctx.shopsByBuilding?.get(b.id);
  const len = Math.hypot(bx - ax, bz - az);
  const ex = (bx - ax) / len;
  const ez = (bz - az) / len;
  const here = [];
  if (shops) {
    for (const s of shops) {
      if (s.floor > 0 || s.nx * nx + s.nz * nz < 0.9) continue;
      const along = (s.x - ax) * ex + (s.z - az) * ez;
      const off = Math.abs((s.x - ax) * nx + (s.z - az) * nz);
      if (off > 1.2 || along < -1 || along > len + 1) continue;
      const cell = SHOP_CELL[s.cat];
      if (cell !== undefined) here.push({ along, half: (s.w || 4) / 2 + 0.6, hint: cell + 1 });
    }
  }
  if (!here.length) {
    surface(0);
    gb.wall(ax, az, bx, bz, 0, fh, nx, nz, 0, nb, 0, 1);
    return;
  }
  for (let k = 0; k < nb; k++) {
    const t0 = (k / nb) * len;
    const t1 = ((k + 1) / nb) * len;
    const mid = (t0 + t1) / 2;
    let hint = 0;
    let best = Infinity;
    for (const h of here) {
      const d = Math.abs(h.along - mid);
      if (d < h.half && d < best) {
        best = d;
        hint = h.hint;
      }
    }
    surface(hint);
    gb.wall(ax + ex * t0, az + ez * t0, ax + ex * t1, az + ez * t1, 0, fh, nx, nz, k, k + 1, 0, 1);
  }
}

// Cornice profiles per facade style: [projection m, height m].
const CORNICE = { bands: [0.18, 0.28], punched: [0.14, 0.22], pair: [0.14, 0.22], grid: [0.22, 0.3], fins: [0.16, 0.25], balcony: [0.16, 0.25], brick: [0.12, 0.2], colonial: [0.3, 0.38], blank: [0.1, 0.18] };

// Box profile along a ring (outward normals): front face, top and soffit.
function emitCornice(gb, ring, normals, y0, y1, proj, color, L, seed, mat) {
  const out = offsetRing(ring, normals, proj);
  const n = ring.length / 2;
  gb.brush(color, L.concrete, seed, 2);
  gb.surface(mat, 255, 0, 0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const bx = ring[j * 2];
    const bz = ring[j * 2 + 1];
    if (Math.hypot(bx - ax, bz - az) < 0.12) continue;
    const nx = normals[i * 2];
    const nz = normals[i * 2 + 1];
    const Ax = out[i * 2];
    const Az = out[i * 2 + 1];
    const Bx = out[j * 2];
    const Bz = out[j * 2 + 1];
    gb.wall(Ax, Az, Bx, Bz, y0, y1, nx, nz, 0, 1, 0, 1);
    gb.quad(ax, y1, az, bx, y1, bz, Bx, y1, Bz, Ax, y1, Az, 0, 1, 0, 0, 0, 1, 1);
    gb.quad(ax, y0, az, Ax, y0, Az, Bx, y0, Bz, bx, y0, bz, 0, -1, 0, 0, 0, 1, 1);
  }
}

// Copies triangles [i0, end) of `gb` into `col` (for pieces that are not in the physics data).
function copyTriangles(gb, i0, col) {
  const P = gb.pos;
  for (let t = i0; t < gb.iCount; t += 3) {
    const a = gb.idx[t] * 3;
    const b = gb.idx[t + 1] * 3;
    const c = gb.idx[t + 2] * 3;
    const va = col.vertex(P[a], P[a + 1], P[a + 2], 0, 1, 0, 0, 0);
    const vb = col.vertex(P[b], P[b + 1], P[b + 2], 0, 1, 0, 0, 0);
    const vc = col.vertex(P[c], P[c + 1], P[c + 2], 0, 1, 0, 0, 0);
    col.tri(va, vb, vc);
  }
}

// Hip roof from the oriented box: every footprint vertex (pushed out for the eaves overhang)
// climbs to the nearest point of a ridge segment along the long axis.
function emitHipRoof(fp, spec, gb, L, tileW, seed, col) {
  const { obb, eaveY, ridgeY } = spec;
  const over = 0.45;
  const normals = edgeNormals(fp, true);
  const ring = offsetRing(fp, normals, over);
  const rl = Math.max(0, (obb.len - obb.wid) / 2);
  const n = ring.length / 2;
  const slope = (ridgeY - eaveY) / (obb.wid / 2 + over);
  const eave = eaveY - over * slope;
  const ridgePt = (x, z) => {
    const u = (x - obb.cx) * obb.ux + (z - obb.cz) * obb.uz;
    const t = Math.max(-rl, Math.min(rl, u));
    return [obb.cx + obb.ux * t, obb.cz + obb.uz * t];
  };
  const pbrRoof = spec.ids && spec.ids.roof !== undefined;
  const s = pbrRoof ? 1 : 1 / tileW[spec.roofLayer];
  gb.brush(spec.roofTint, L[spec.roofLayer], seed, 2);
  if (pbrRoof) gb.surface(spec.ids.roof, 255, 0, 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const bx = ring[j * 2];
    const bz = ring[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const [rax, raz] = ridgePt(ax, az);
    const [rbx, rbz] = ridgePt(bx, bz);
    const ex = (bx - ax) / len;
    const ez = (bz - az) / len;
    // Inward horizontal direction (towards the ridge).
    let ix = -ez;
    let iz = ex;
    if ((((rax + rbx) / 2 - (ax + bx) / 2) * ix + ((raz + rbz) / 2 - (az + bz) / 2) * iz) < 0) {
      ix = -ix;
      iz = -iz;
    }
    const uvOf = (x, z) => [((x - ax) * ex + (z - az) * ez) * s, ((x - ax) * ix + (z - az) * iz) * Math.hypot(1, slope) * s];
    // Face normal from the slope.
    const nl = Math.hypot(1, slope);
    const nx = -ix * slope / nl;
    const ny = 1 / nl;
    const nz = -iz * slope / nl;
    const same = Math.abs(rax - rbx) < 1e-3 && Math.abs(raz - rbz) < 1e-3;
    const a = gb.vertex(ax, eave, az, nx, ny, nz, ...uvOf(ax, az));
    const bI = gb.vertex(bx, eave, bz, nx, ny, nz, ...uvOf(bx, bz));
    const rb = gb.vertex(rbx, ridgeY, rbz, nx, ny, nz, ...uvOf(rbx, rbz));
    const up = (p, q, r) => {
      const P = gb.pos;
      const e1x = P[q * 3] - P[p * 3];
      const e1z = P[q * 3 + 2] - P[p * 3 + 2];
      const e2x = P[r * 3] - P[p * 3];
      const e2z = P[r * 3 + 2] - P[p * 3 + 2];
      return e1z * e2x - e1x * e2z > 0;
    };
    if (up(a, bI, rb)) gb.tri(a, bI, rb);
    else gb.tri(a, rb, bI);
    if (!same) {
      const ra = gb.vertex(rax, ridgeY, raz, nx, ny, nz, ...uvOf(rax, raz));
      if (up(a, rb, ra)) gb.tri(a, rb, ra);
      else gb.tri(a, ra, rb);
    }
    if (col) {
      const ca = col.vertex(ax, eave, az, 0, 1, 0, 0, 0);
      const cb = col.vertex(bx, eave, bz, 0, 1, 0, 0, 0);
      const cr = col.vertex(rbx, ridgeY, rbz, 0, 1, 0, 0, 0);
      col.tri(ca, cb, cr);
      if (!same) col.tri(ca, cr, col.vertex(rax, ridgeY, raz, 0, 1, 0, 0, 0));
    }
    // Fascia board under the eave edge.
    gb.setLayer(L.concrete);
    if (pbrRoof) gb.surface(255);
    gb.wall(ax, az, bx, bz, eave - 0.18, eave, -ix, -iz, 0, len / 4, 0, 0.05);
    gb.setLayer(L[spec.roofLayer]);
    if (pbrRoof) gb.surface(spec.ids.roof, 255, 0, 1);
  }
  // Soffit (underside of the overhang) so the eaves read from street level.
  gb.brush(tint('#d9d4c8'), L.concrete, seed, 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    gb.quad(
      fp[i * 2], eave - 0.18, fp[i * 2 + 1], fp[j * 2], eave - 0.18, fp[j * 2 + 1],
      ring[j * 2], eave - 0.18, ring[j * 2 + 1], ring[i * 2], eave - 0.18, ring[i * 2 + 1],
      0, -1, 0, 0, 0, 1, 0.1,
    );
  }
}

// Flat concrete canopy cantilevered over the pavement at first-floor level, with downlights.
function emitCanopy(f, spec, gb, col, L, rng, depth) {
  const { ax, az, bx, bz, nx, nz, len } = f;
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const rot = Math.atan2(nx, nz);
  const y = f.y - 0.05;
  const t = 0.28;
  const w = len - 0.05;
  const color = tint(rng.pick(PALETTE.shopCanopy));
  gb.setTransform(mx, 0, mz, rot);
  gb.brush(color, L.concrete, f.seed, 2);
  gb.box(0, y, depth / 2, w, t, depth, 4, true);
  gb.box(0, y + t, depth - 0.1, w, 0.45, 0.2, 4);
  // Downlights under the slab (most shops leave them on at night).
  gb.brush([255, 240, 210], L.misc, f.seed, rng() < 0.7 ? 3 : 2);
  const [u0, v0, u1, v1] = miscUV(MISC_CELLS.lamp);
  const n = Math.max(1, Math.floor(w / 3));
  for (let k = 0; k < n; k++) {
    const x = -w / 2 + (k + 0.5) * (w / n);
    gb.quad(x - 0.2, y - 0.01, depth * 0.55 - 0.2, x + 0.2, y - 0.01, depth * 0.55 - 0.2, x + 0.2, y - 0.01, depth * 0.55 + 0.2, x - 0.2, y - 0.01, depth * 0.55 + 0.2, 0, -1, 0, u0, v0, u1, v1);
  }
  gb.clearTransform();
  // Physics: the slab (with its underside, where heads and climbs meet it) plus the upstand along its
  // front edge (a face, not a box: 2 triangles).
  col.setTransform(mx, 0, mz, rot);
  col.box(0, y, depth / 2, w, t, depth, 1, true);
  col.quad(-w / 2, y + t, depth - 0.1, w / 2, y + t, depth - 0.1, w / 2, y + t + 0.45, depth - 0.1, -w / 2, y + t + 0.45, depth - 0.1, 0, 0, 1, 0, 0, 1, 1);
  col.clearTransform();
  return { depth, top: y + t, front: depth - 0.1, rot, mx, mz };
}

// Colonial verandah: light sloping iron roof on slender posts along the kerb. The posts are
// pushed to `obstacles` (pedestrian avoidance) when given.
function emitVerandah(f, spec, gb, col, L, rng, depth, obstacles) {
  const { ax, az, bx, bz, nx, nz, len } = f;
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const rot = Math.atan2(nx, nz);
  const y = Math.max(3.2, f.y + 0.15);
  const w = len - 0.05;
  const roofTint = tint(rng.pick(PALETTE.corrugated));
  const postTint = tint(spec.postColor || rng.pick(PALETTE.verandahPost));
  gb.setTransform(mx, 0, mz, rot);
  // Roof sheet (slopes 0.35 m down towards the street), top and underside.
  const y1 = y - 0.35;
  gb.brush(roofTint, L.corrugated, f.seed, 2);
  gb.quad(-w / 2, y, 0, w / 2, y, 0, w / 2, y1, depth, -w / 2, y1, depth, 0, 0.995, 0.1, 0, 0, w / 3, depth / 3);
  gb.quad(-w / 2, y - 0.04, 0, -w / 2, y1 - 0.04, depth, w / 2, y1 - 0.04, depth, w / 2, y - 0.04, 0, 0, -1, 0, 0, 0, depth / 3, w / 3);
  // Fascia + posts.
  gb.brush(postTint, L.metal, f.seed, 2);
  gb.box(0, y1 - 0.3, depth - 0.05, w, 0.3, 0.08, 2);
  const nPosts = Math.max(2, Math.round(w / 3.4) + 1);
  for (let k = 0; k < nPosts; k++) {
    const x = -w / 2 + 0.15 + (k * (w - 0.3)) / (nPosts - 1);
    gb.cylinder(x, 0, depth - 0.1, 0.07, y1 - 0.3, 6, 1, false);
    gb.box(x, 0, depth - 0.1, 0.2, 0.25, 0.2, 1);
    obstacles?.push({ x: mx + nz * x + nx * (depth - 0.1), z: mz - nx * x + nz * (depth - 0.1), r: 0.2 });
  }
  gb.clearTransform();
  // Physics: the sloping sheet itself (standing on it you are on the iron, not above it) + fascia.
  col.setTransform(mx, 0, mz, rot);
  col.quad(-w / 2, y, 0, w / 2, y, 0, w / 2, y1, depth, -w / 2, y1, depth, 0, 1, 0, 0, 0, 1, 1);
  col.box(0, y1 - 0.3, depth - 0.05, w, 0.3, 0.08, 1);
  col.clearTransform();
  return { depth, top: y1, front: depth - 0.05, rot, mx, mz, verandah: true };
}

