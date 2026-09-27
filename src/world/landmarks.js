import { cleanRing, edgeNormals, offsetRing, orientedBox, isConvex } from './polygon.js';
import { MISC_CELLS, miscUV } from './facades.js';
import { tint } from './palette.js';
import { makeRng } from '../core/rng.js';
import { lonLatToXZ } from '../core/geo.js';
import { GeoBuffer } from './geoBuffer.js';

// Researched Harare landmarks (keys from tools/landmark_overrides.json, echoed as buildings[].lm),
// following the photo notes in docs/references/PHOTOS.md: facade/material choices and custom
// geometry for their silhouettes. Anything that sticks out of the plain footprint extrusion is
// also written to the building's collider buffer so physics matches what you see.

const STYLE = {
  rbz: { upper: 'curtain', ground: 'lobby', glass: 6, tint: '#aeb0ac', parapet: false, clutter: 0.3 },
  rbz_podium: { upper: 'bands', ground: 'lobby', glass: 6, tint: '#a3a8a6' },
  joina_city: { upper: 'bands', ground: 'lobby', glass: 1, tint: '#b9bab6', parapet: false, clutter: 0 },
  joina_city_podium: { ground: 'shop', letters: ['JOINA CITY', '#b9bab6', '#1d3d6b'] },
  karigamombe: { upper: 'curtain', ground: 'lobby', glass: 1, tint: '#b8b5b3', clutter: 0 },
  livingstone_house: { upper: 'grid', tint: '#dfdfda', glass: 4 },
  monomotapa: { upper: 'bands', tint: '#cdbd9c', glass: 0, thicken: 7, clutter: 0.3 },
  meikles: { upper: 'grid', tint: '#e3e0da', glass: 4 },
  meikles_south: { upper: 'bands', tint: '#9c9a92', letters: ['MEIKLES HOTEL', '#8f8d86', '#f1efe8'] },
  eastgate_block_n: { upper: 'eastgate', ground: 'shop', tint: '#ece6de', parapet: false, clutter: 0 },
  eastgate_block_s: { upper: 'eastgate', ground: 'shop', tint: '#ece6de', parapet: false, clutter: 0 },
  eastgate: { upper: 'curtain', ground: 'shop', roofLayer: 'curtain', roofKind: 0, glass: 0, clutter: 0 },
  town_house: { upper: 'colonial', ground: 'colshop', tint: '#e8d9b5', clutter: 0 },
  munhumutapa_building: { upper: 'colonial', ground: null, tint: '#e2d596', clutter: 0 },
  parliament_house: { upper: 'colonial', ground: null, tint: '#dcd2b8', roof: 'hip', clutter: 0 },
  anglican_cathedral: { upper: 'stone', ground: null, tint: '#a89a86', clutter: 0 },
  sacred_heart_cathedral: { upper: 'stone', ground: null, tint: '#cdbfa2', clutter: 0 },
  harare_station: { upper: 'brick', ground: 'colshop', tint: '#ffffff', roof: 'hip', verandah: true, postColor: '#365374' },
  pearl_house: { upper: 'grid', tint: '#c29a4e', letters: ['PEARL', '#b08a45', '#f3ead2'] },
  social_security_centre: { upper: 'grid', tint: '#a9a497', glass: 1 },
  zanu_pf_hq: { upper: 'grid', tint: '#a09a8c', clutter: 0 },
  rainbow_towers: { upper: 'blank', ground: 'lobby', tint: '#dad19e', clutter: 0.3 },
  rainbow_towers_hotel: { upper: 'curtain', glass: 5, tint: '#d6c48c' },
  old_mutual_centre: { glass: 3 },
  national_gallery: { upper: 'blank', tint: '#d9d4ca', clutter: 0 },
};

const PALM_KEYS = new Set(['town_house', 'parliament_house', 'meikles', 'rainbow_towers', 'rainbow_towers_hotel', 'harare_station', 'monomotapa', 'rbz', 'national_gallery']);

export class Landmarks {
  constructor(data, signs) {
    this.data = data;
    this.signs = signs;
    this.palms = [];
    // Street-level solids for pedestrian avoidance ({x, z, r}; merged into city.obstacles).
    this.obstacles = [];
    this.jets = new GeoBuffer(512);
  }

  adjustSpec(b, spec) {
    const st = STYLE[b.lm];
    if (!st) return;
    for (const k of ['upper', 'glass', 'parapet', 'clutter', 'postColor']) if (st[k] !== undefined) spec[k] = st[k];
    if (st.ground !== undefined) spec.ground = st.ground;
    if (st.tint) spec.tint = tint(st.tint);
    if (st.verandah) spec.verandah = true;
    if (st.roofLayer) {
      spec.roofLayer = st.roofLayer;
      spec.roofKind = st.roofKind;
    }
    if (st.roof === 'hip' && spec.obb && isConvex(b.fp)) {
      spec.roof = 'hip';
      spec.roofLayer = 'tiles';
      spec.roofTint = tint('#9c5a40');
      spec.parapet = false;
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
    const st = STYLE[b.lm];
    // A volume that is not the mapped footprint (Monomotapa's thickened slab) is indexed for
    // buildingAt / roofHeightAt / buildingsNear too (its physics is the copied visual geometry).
    if (spec.fp && spec.fullCollider && b.id >= 0) {
      registerVolume(world, { id: b.id, oid: b.oid, fp: fp.slice(), h: b.h, name: b.name, lm: b.lm, core: b.core, synthetic: 1 });
    }
    switch (b.lm) {
      case 'rbz':
        rbzTower(gb, col, L, fp, b, seed);
        break;
      case 'joina_city':
        joinaCrown(gb, col, L, obb, b.h, seed);
        break;
      case 'karigamombe':
        spireTower(gb, col, L, fp, b.h, seed);
        break;
      case 'eastgate_block_n':
      case 'eastgate_block_s':
        eastgateRoof(gb, col, L, obb, b.h, seed);
        break;
      case 'town_house':
        clockTower(gb, col, L, fp, spec, world, seed, /Nyerere/, 26);
        break;
      case 'munhumutapa_building':
        clockTower(gb, col, L, fp, spec, world, seed, /Samora/, 30);
        break;
      case 'anglican_cathedral':
        churchTowers(gb, col, L, obb, spec, world, seed, true);
        break;
      case 'sacred_heart_cathedral':
        churchTowers(gb, col, L, obb, spec, world, seed, false);
        break;
      case 'zanu_pf_hq':
        gableCrown(gb, col, L, obb, b.h, seed);
        break;
      case 'pearl_house':
        pearlSculpture(gb, col, L, obb, b.h, seed);
        break;
      case 'harare_station':
        cupola(gb, col, L, obb, spec.ridgeY ?? b.h, seed);
        break;
      case 'parliament_house': {
        const c = colonnade(gb, col, L, streetFace(fp, world, /Mandela/), spec, seed);
        for (let k = 0; c && k < c.n; k++) {
          const u = -c.w / 2 + (k * c.w) / (c.n - 1);
          this.obstacles.push({ x: c.x + c.ex * u + c.nx * (c.depth - 0.3), z: c.z + c.ez * u + c.nz * (c.depth - 0.3), r: 0.35 });
        }
        break;
      }
      case 'national_gallery':
        this._mural(gb, fp, b, world);
        break;
      case 'monomotapa':
        this._roofSign(gb, col, L, obb, b.h, 'MONOMOTAPA', this.data.features.find((f) => f.key === 'harare_gardens'));
        break;
      default:
        break;
    }
    if (st?.letters) this._parapetLetters(gb, fp, b.h, world, ...st.letters);
    if (PALM_KEYS.has(b.lm)) this._palmsAlong(fp, world);
  }

  // Name lettering along the top band of the longest street-facing wall.
  _parapetLetters(gb, fp, h, world, text, bg, fg) {
    const face = streetFace(fp, world);
    if (!face) return;
    const sign = this.signs.lettering(text, bg, fg);
    if (!sign) return;
    const w = Math.min(face.len * 0.8, text.length * 1.9 + 2);
    const hh = w / 4;
    wallBoard(gb, face, h - hh - 0.3, w, hh, sign, 0.08);
  }

  _mural(gb, fp, b, world) {
    const face = streetFace(fp, world, /Nyerere/);
    if (!face) return;
    const sign = this.signs.custom(drawMosaic);
    if (!sign) return;
    const w = Math.min(20, face.len * 0.85);
    wallBoard(gb, face, Math.max(3.5, b.h - w / 4 - 0.6), w, w / 4, sign, 0.06);
  }

  // Letters on a frame standing on the roof, facing `toward` (a feature point) if given.
  _roofSign(gb, col, L, obb, h, text, toward) {
    if (!obb) return;
    const sign = this.signs.lettering(text, '#f4efe2', '#8a2f25');
    if (!sign) return;
    let nx = -obb.uz;
    let nz = obb.ux;
    if (toward && (toward.x - obb.cx) * nx + (toward.z - obb.cz) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const w = Math.min(obb.len * 0.6, 22);
    const hh = w / 4;
    const x = obb.cx + nx * (obb.wid / 2 - 1.5);
    const z = obb.cz + nz * (obb.wid / 2 - 1.5);
    gb.brush(tint('#4a4f53'), L.metal, 3, 2);
    for (const t of [-0.4, 0, 0.4]) gb.beam(x - nz * w * t, h, z + nx * w * t, x - nz * w * t, h + hh + 0.8, z + nx * w * t, 0.25, 2);
    wallBoard(gb, { x, z, nx, nz, ex: -nz, ez: nx }, h + 0.8, w, hh, sign, 0.2);
    // Physics: the board and the three posts under it (open between them, as drawn).
    col.setTransform(x, h, z, Math.atan2(nx, nz));
    col.box(0, 0.8, 0, w, hh, 0.4, 1, true);
    for (const t of [-0.4, 0, 0.4]) col.box(w * t, 0, 0, 0.3, 0.8, 0.3, 1);
    col.clearTransform();
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
        this.palms.push({ species: 'palm', x, y: 0.15, z, s: 0.85 + ((t * 7) % 3) * 0.1, rot: t, c: [1, 1, 1] });
      }
    }
  }

  // One-off pieces that are not buildings: the Rainbow Towers hotel tower (synthetic, it is not in
  // the footprint data, so it is also registered with world.addBuilding), the Mbuya Nehanda statue
  // and the Africa Unity Square fountain (its water jets go to this.jets).
  extras(chunks, colliderFor, L, emit, paths, G, world) {
    const data = this.data;
    if ((data.meta.landmarks || []).some((l) => l.key === 'rainbow_towers')) {
      const c = lonLatToXZ(31.0359, -17.8314);
      const a = (25 * Math.PI) / 180;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      const hl = 27.5;
      const hw = 10;
      const fp = [
        c.x - ux * hl + uz * hw, c.z - uz * hl - ux * hw,
        c.x + ux * hl + uz * hw, c.z + uz * hl - ux * hw,
        c.x + ux * hl - uz * hw, c.z + uz * hl + ux * hw,
        c.x - ux * hl - uz * hw, c.z - uz * hl + ux * hw,
      ];
      const rec = { id: -7, oid: 'rainbow-towers-hotel', fp, h: 75, fl: 19, core: 1, lm: 'rainbow_towers_hotel', name: 'Rainbow Towers Hotel', synthetic: 1, cx: c.x, cz: c.z };
      emit(rec, { fullCollider: true });
      registerVolume(world, rec);
    }
    const statue = data.features.find((f) => f.key === 'mbuya_nehanda_statue');
    if (statue) {
      nehanda(chunks.detailAt(statue.x, statue.z), colliderFor(-8), L, statue.x, statue.z);
      this.obstacles.push({ x: statue.x, z: statue.z, r: 2.2 });
    }
    const fountain = data.features.find((f) => f.kind === 'fountain');
    if (fountain) {
      fountainAt(chunks.detailAt(fountain.x, fountain.z), colliderFor(-9), this.jets, L, fountain.x, fountain.z, paths, G);
      this.obstacles.push({ x: fountain.x, z: fountain.z, r: 8.2 });
    }
  }
}

// Index an extra volume with world.addBuilding. buildingAt() returns the first footprint that
// contains the point, and a synthetic volume can stand on a mapped one (the hotel tower rises
// out of the HICC podium's footprint), so the new record is moved to the front of its grid cells
// to win there. (Relies on CollisionWorld.bGrid; without it the record is still indexed.)
function registerVolume(world, rec) {
  if (!world?.addBuilding) return;
  world.addBuilding(rec);
  if (!(world.bGrid instanceof Map)) return;
  for (const arr of world.bGrid.values()) {
    const i = arr.indexOf(rec);
    if (i > 0) {
      arr.splice(i, 1);
      arr.unshift(rec);
    }
  }
}

// The longest wall facing a street (a street whose name matches `prefer` wins).
function streetFace(fp, world, prefer) {
  const normals = edgeNormals(fp, true);
  const n = fp.length / 2;
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = fp[i * 2];
    const az = fp[i * 2 + 1];
    const len = Math.hypot(fp[j * 2] - ax, fp[j * 2 + 1] - az);
    if (len < 6) continue;
    const nx = normals[i * 2];
    const nz = normals[i * 2 + 1];
    const x = (ax + fp[j * 2]) / 2;
    const z = (az + fp[j * 2 + 1]) / 2;
    const road = world.nearestRoad(x + nx * 10, z + nz * 10, 25);
    const score = len + (road ? 30 : 0) + (road && prefer?.test(road.name) ? 200 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { x, z, nx, nz, ex: (fp[j * 2] - ax) / len, ez: (fp[j * 2 + 1] - az) / len, len };
    }
  }
  return best;
}

// A flat board on a wall face (centre x, z; outward normal nx, nz; along ex, ez) with its text
// reading left to right for someone facing the wall. Backlit at night.
function wallBoard(gb, face, y0, w, h, sign, out) {
  let { ex, ez } = face;
  if (ex * face.nz - ez * face.nx < 0) {
    ex = -ex;
    ez = -ez;
  }
  const x = face.x + face.nx * out;
  const z = face.z + face.nz * out;
  const [u0, v0, u1, v1] = sign.uv;
  gb.brush(tint('#ffffff'), sign.layer, 7, 4);
  gb.quad(
    x - (ex * w) / 2, y0, z - (ez * w) / 2,
    x + (ex * w) / 2, y0, z + (ez * w) / 2,
    x + (ex * w) / 2, y0 + h, z + (ez * w) / 2,
    x - (ex * w) / 2, y0 + h, z - (ez * w) / 2,
    face.nx, 0, face.nz, u0, v0, u1, v1,
  );
}

// National Gallery's abstract mosaic mural: reds, blues and yellows on an ochre ground.
function drawMosaic(ctx, x, y, w, h) {
  const rng = makeRng(1957);
  ctx.fillStyle = '#c8b068';
  ctx.fillRect(x, y, w, h);
  const cols = ['#b8322a', '#2f5d9a', '#e0b43a', '#1f1f1f', '#e8e2d0', '#7a3a2a', '#3f8a6a'];
  for (let i = 0; i < 38; i++) {
    ctx.fillStyle = cols[i % cols.length];
    ctx.beginPath();
    const cx = x + rng() * w;
    const cy = y + rng() * h;
    const r = h * (0.08 + rng() * 0.3);
    if (rng() < 0.5) {
      ctx.arc(cx, cy, r, rng() * 6, rng() * 6 + 2.5);
      ctx.lineTo(cx, cy);
    } else {
      ctx.moveTo(cx - r, cy + r * 0.6);
      ctx.lineTo(cx + r * (rng() - 0.3), cy - r);
      ctx.lineTo(cx + r, cy + r * rng());
    }
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < w; i += 3) ctx.fillRect(x + i, y, 1, h);
  for (let j = 0; j < h; j += 3) ctx.fillRect(x, y + j, w, 1);
}

// Wall band on `ring` between y0..y1 (v 0..1 across the band) with top/bottom caps back to `inner`.
// The collider gets the same closed shape (outer wall + both caps), so a band standing proud of
// its wall is a solid ledge, never an open slot to fall into.
function band(gb, col, ring, inner, y0, y1, layer, tintBytes, seed, tileW) {
  const normals = edgeNormals(ring, true);
  const n = ring.length / 2;
  gb.brush(tintBytes, layer, seed, 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const bx = ring[j * 2];
    const bz = ring[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.1) continue;
    gb.wall(ax, az, bx, bz, y0, y1, normals[i * 2], normals[i * 2 + 1], 0, Math.max(1, Math.round(len / tileW)), 0, 1);
    col.wall(ax, az, bx, bz, y0, y1, normals[i * 2], normals[i * 2 + 1], 0, 1, 0, 1);
    for (const [y, ny] of [[y1, 1], [y0, -1]]) {
      const q = [ax, y, az, bx, y, bz, inner[j * 2], y, inner[j * 2 + 1], inner[i * 2], y, inner[i * 2 + 1]];
      gb.quad(...q, 0, ny, 0, 0, 0, 1, 0.1);
      col.quad(...q, 0, ny, 0, 0, 0, 1, 1);
    }
  }
}

// Unit vertex normals (bisectors of the adjacent edge normals) for vertex i.
function vertexNormal(normals, i, n) {
  const p = (i - 1 + n) % n;
  const vx = normals[i * 2] + normals[p * 2];
  const vz = normals[i * 2 + 1] + normals[p * 2 + 1];
  const vl = Math.hypot(vx, vz) || 1;
  return [vx / vl, vz / vl, normals[i * 2] * normals[p * 2] + normals[i * 2 + 1] * normals[p * 2 + 1]];
}

// Reserve Bank: teal curtain-glass octagon with slim granite piers on every facet edge, carved
// chevron friezes at ~level 6 and at the top (flaring out as a cornice), a recessed glass lobby
// storey and raked granite legs splaying down onto the podium.
function rbzTower(gb, col, L, fp, b, seed) {
  const granite = tint('#aeb0ac');
  const normals = edgeNormals(fp, true);
  const n = fp.length / 2;
  const podium = 20;
  const frieze = 24;
  gb.brush(granite, L.concrete, seed, 2);
  for (let i = 0; i < n; i++) {
    const [vx, vz] = vertexNormal(normals, i, n);
    const x = fp[i * 2] + vx * 0.2;
    const z = fp[i * 2 + 1] + vz * 0.2;
    gb.setTransform(x, 0, z, Math.atan2(vx, vz));
    gb.box(0, frieze, 0, 0.9, b.h - frieze, 0.9, 4);
    gb.clearTransform();
    gb.beam(x, frieze + 1, z, x + vx * 4.5, podium, z + vz * 4.5, 1.1, 3);
    col.setTransform(x, 0, z, Math.atan2(vx, vz));
    col.box(0, frieze, 0, 0.9, b.h - frieze, 0.9, 1);
    col.clearTransform();
    col.beam(x, frieze + 1, z, x + vx * 4.5, podium, z + vz * 4.5, 1.1, 1);
  }
  // The lobby glass sits only a little inside the footprint: the physics extrusion is the
  // footprint itself, so a deep recess would leave an invisible wall in front of the glass.
  const lobby = offsetRing(fp, normals, -0.3);
  gb.brush(tint('#ffffff'), L.lobby, seed, 0, 0, 4);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const len = Math.hypot(lobby[j * 2] - lobby[i * 2], lobby[j * 2 + 1] - lobby[i * 2 + 1]);
    gb.wall(lobby[i * 2], lobby[i * 2 + 1], lobby[j * 2], lobby[j * 2 + 1], podium, frieze, normals[i * 2], normals[i * 2 + 1], 0, Math.max(1, Math.round(len / 5)), 0, 1);
  }
  const skin = offsetRing(fp, normals, 0.35);
  band(gb, col, skin, fp, frieze, frieze + 3.5, L.frieze, granite, seed, 3);
  band(gb, col, skin, fp, b.h - 4.2, b.h - 0.6, L.frieze, granite, seed, 3);
  // Crown: a solid cornice ring (top face at b.h + 0.9) with its inner lip wall down to the roof.
  const lip = offsetRing(fp, normals, -0.4);
  band(gb, col, offsetRing(fp, normals, 0.9), lip, b.h - 0.6, b.h + 0.9, L.concrete, granite, seed, 4);
  gb.brush(granite, L.concrete, seed, 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    gb.wall(lip[i * 2], lip[i * 2 + 1], lip[j * 2], lip[j * 2 + 1], b.h, b.h + 0.9, -normals[i * 2], -normals[i * 2 + 1], 0, 1, 0, 0.2);
    col.wall(lip[i * 2], lip[i * 2 + 1], lip[j * 2], lip[j * 2 + 1], b.h, b.h + 0.9, -normals[i * 2], -normals[i * 2 + 1], 0, 1, 0, 1);
  }
}

// Joina City: the top storeys wrap into a full-width blue-grey glass drum, then a narrower ribbed
// silver drum capped by a thin overhanging disc, with two antenna masts. The mapped footprint is
// not round (its corners reach well past the drum), and physics extrudes that footprint up to the
// roof, so the shaft's walls run up to the roof too and the drum bulges out of them wherever it is
// wider: what you see is footprint extrusion + drum, which is exactly what the colliders are.
function joinaCrown(gb, col, L, obb, h, seed) {
  if (!obb) return;
  const R = Math.max(obb.len, obb.wid) / 2 + 0.6;
  const y0 = h - 10.5;
  const circle = (r, segs) => {
    const out = [];
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      out.push(obb.cx + Math.cos(a) * r, obb.cz + Math.sin(a) * r);
    }
    return out;
  };
  gb.brush(tint('#b9bab6'), L.bands, seed, 0, 0, 1);
  gb.cylinder(obb.cx, y0, obb.cz, R, h - y0, 32, 3.4, false);
  gb.brush(tint('#c9cac6'), L.concrete, seed, 2);
  // Soffit under the drum where it overhangs the facade.
  gb.polygon(circle(R, 32), null, y0, 4, false);
  gb.cylinder(obb.cx, h, obb.cz, R + 0.4, 0.6, 32, 4, true);
  col.cylinder(obb.cx, y0, obb.cz, R, h - y0, 32, 1, false);
  col.polygon(circle(R, 32), null, y0, 1, false);
  col.cylinder(obb.cx, h, obb.cz, R + 0.4, 0.6, 32, 1, true);
  const r2 = R * 0.6;
  gb.brush(tint('#b5c4d2'), L.metal, seed, 2);
  gb.cylinder(obb.cx, h + 0.6, obb.cz, r2, 6, 24, 1.2, false);
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const x = obb.cx + Math.cos(a) * r2;
    const z = obb.cz + Math.sin(a) * r2;
    gb.beam(x, h + 0.6, z, x, h + 6.6, z, 0.25, 2);
  }
  col.cylinder(obb.cx, h + 0.6, obb.cz, r2 + 0.1, 6, 24, 1, false);
  const r3 = r2 * 1.4;
  const disc = circle(r3, 32);
  gb.brush(tint('#d2d4d2'), L.metal, seed, 2);
  gb.cylinder(obb.cx, h + 6.6, obb.cz, r3, 1.0, 32, 2, true);
  gb.polygon(disc, null, h + 6.6, 4, false);
  col.cylinder(obb.cx, h + 6.6, obb.cz, r3, 1.0, 32, 1, true);
  col.polygon(disc, null, h + 6.6, 1, false);
  gb.brush(tint('#9aa0a4'), L.metal, seed, 2);
  for (const s of [-0.35, 0.35]) {
    const x = obb.cx + obb.ux * r3 * s;
    const z = obb.cz + obb.uz * r3 * s;
    gb.cylinder(x, h + 7.6, z, 0.18, 12, 6, 2, false, 0.06);
    col.cylinder(x, h + 7.6, z, 0.18, 12, 6, 1, false, 0.06);
  }
}

// Karigamombe: blue glass tower with wide light-grey corner piers, a set-back glass lantern and a
// white needle spire.
function spireTower(gb, col, L, fp, h, seed) {
  const normals = edgeNormals(fp, true);
  const n = fp.length / 2;
  gb.brush(tint('#c7c3c0'), L.concrete, seed, 2);
  for (let i = 0; i < n; i++) {
    const [vx, vz, straight] = vertexNormal(normals, i, n);
    if (straight > 0.8) continue;
    const x = fp[i * 2] - vx * 0.6;
    const z = fp[i * 2 + 1] - vz * 0.6;
    gb.setTransform(x, 0, z, Math.atan2(vx, vz));
    gb.box(0, 0, 0, 2.8, h + 1.2, 2.8, 4);
    gb.clearTransform();
    col.setTransform(x, 0, z, Math.atan2(vx, vz));
    col.box(0, 0, 0, 2.8, h + 1.2, 2.8, 1);
    col.clearTransform();
  }
  const lantern = offsetRing(fp, normals, -3.5);
  gb.brush(tint('#dfe6ec'), L.curtain, seed, 0, 0, 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const len = Math.hypot(lantern[j * 2] - lantern[i * 2], lantern[j * 2 + 1] - lantern[i * 2 + 1]);
    gb.wall(lantern[i * 2], lantern[i * 2 + 1], lantern[j * 2], lantern[j * 2 + 1], h, h + 4.5, normals[i * 2], normals[i * 2 + 1], 0, Math.max(1, Math.round(len / 1.6)), 0, 1);
    col.wall(lantern[i * 2], lantern[i * 2 + 1], lantern[j * 2], lantern[j * 2 + 1], h, h + 4.5, normals[i * 2], normals[i * 2 + 1], 0, 1, 0, 1);
  }
  gb.brush(tint('#cfd3d6'), L.concrete, seed, 2);
  gb.polygon(lantern, null, h + 4.5, 4);
  col.polygon(lantern, null, h + 4.5, 1);
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += lantern[i * 2] / n;
    cz += lantern[i * 2 + 1] / n;
  }
  gb.brush(tint('#f4f4f0'), L.metal, seed, 2);
  gb.cylinder(cx, h + 4.5, cz, 0.7, 11, 8, 2, false, 0.03);
  col.cylinder(cx, h + 4.5, cz, 0.5, 11, 6, 1, false, 0.1);
}

// Eastgate: a thin tile roof strip along each slab carrying one even row of pale cylindrical
// chimney stacks with flared caps, and full-height X-lattice service towers along both long faces.
function eastgateRoof(gb, col, L, obb, h, seed) {
  if (!obb) return;
  const hl = obb.len / 2;
  const P = (u, v) => [obb.cx + obb.ux * u - obb.uz * v, obb.cz + obb.uz * u + obb.ux * v];
  const rot = -obb.angle;
  const hw = 3;
  const rise = 1.2;
  gb.brush(tint('#b0553a'), L.tiles, seed, 2);
  for (const s of [1, -1]) {
    const [ax, az] = P(-hl + 1, s * hw);
    const [bx, bz] = P(hl - 1, s * hw);
    const [cx, cz] = P(hl - 1, 0);
    const [dx, dz] = P(-hl + 1, 0);
    const nl = Math.hypot(rise, hw);
    gb.quad(ax, h, az, bx, h, bz, cx, h + rise, cz, dx, h + rise, dz, (-obb.uz * s * rise) / nl, hw / nl, (obb.ux * s * rise) / nl, 0, 0, obb.len / 3, nl / 3);
    col.quad(ax, h, az, bx, h, bz, cx, h + rise, cz, dx, h + rise, dz, 0, 1, 0, 0, 0, 1, 1);
  }
  const n = Math.max(4, Math.round((obb.len - 6) / 6));
  for (let k = 0; k < n; k++) {
    const [x, z] = P(-hl + 3 + ((k + 0.5) / n) * (obb.len - 6), 0);
    gb.brush(tint('#c9b8a0'), L.concrete, seed, 2);
    gb.cylinder(x, h + rise - 0.3, z, 0.95, 3.4, 10, 2, false);
    gb.brush(tint('#5a5550'), L.concrete, seed, 2);
    gb.cylinder(x, h + rise + 2.6, z, 0.97, 0.3, 10, 2, false);
    gb.brush(tint('#d6c8b2'), L.concrete, seed, 2);
    gb.cylinder(x, h + rise + 3.1, z, 0.95, 0.5, 10, 2, true, 1.35);
    col.cylinder(x, h, z, 1.1, rise + 3.6, 6, 1, true);
    if (k < n - 1) {
      // Small triangular roof vent between stacks.
      const [vx, vz] = P(-hl + 3 + ((k + 1) / n) * (obb.len - 6), 0);
      gb.brush(tint('#8f918f'), L.metal, seed, 2);
      gb.setTransform(vx, h + rise, vz, rot);
      gb.box(0, 0, 0, 0.8, 0.6, 1.4, 1);
      gb.clearTransform();
    }
  }
  const towers = Math.max(2, Math.round(obb.len / 30));
  for (let k = 0; k < towers; k++) {
    const u = -hl + ((k + 0.5) / towers) * obb.len;
    for (const s of [1, -1]) {
      const [x, z] = P(u, s * (obb.wid / 2 + 1));
      gb.brush(tint('#ffffff'), L.lattice, seed, 2);
      gb.setTransform(x, 0, z, rot);
      gb.box(0, 0, 0, 4, h + 3.4, 2, 4);
      gb.clearTransform();
      col.setTransform(x, 0, z, rot);
      col.box(0, 0, 0, 4, h + 3.4, 2, 1);
      col.clearTransform();
    }
  }
}

// Square clock tower over the entrance on the main street front.
function clockTower(gb, col, L, fp, spec, world, seed, prefer, H) {
  const face = streetFace(fp, world, prefer);
  if (!face) return;
  const x = face.x - face.nx * 3;
  const z = face.z - face.nz * 3;
  const rot = Math.atan2(face.nx, face.nz);
  const w = 7;
  gb.brush(spec.tint, L.colonial, seed, 0, 3, 0);
  gb.setTransform(x, 0, z, rot);
  gb.box(0, 0, 0, w, H, w, 3.8);
  clockFaces(gb, L, w, H - 4.5, seed);
  gb.brush(tint('#efe3c2'), L.concrete, seed, 2);
  gb.box(0, H, 0, w + 0.6, 0.5, w + 0.6, 4);
  gb.brush(tint('#b25e3e'), L.tiles, seed, 2);
  pyramid(gb, 0, H + 0.5, 0, w / 2 + 0.3, 4.5);
  gb.clearTransform();
  col.setTransform(x, 0, z, rot);
  col.box(0, 0, 0, w, H, w, 1);
  col.box(0, H, 0, w + 0.6, 0.5, w + 0.6, 1, true);
  pyramid(col, 0, H + 0.5, 0, w / 2 + 0.3, 4.5);
  col.clearTransform();
}

// Four clock faces on a square tower of width w (local frame), bottom edge at height y.
function clockFaces(gb, L, w, y, seed) {
  gb.brush(tint('#ffffff'), L.misc, seed, 2);
  const [u0, v0, u1, v1] = miscUV(MISC_CELLS.clock);
  const cs = Math.min(2.2, w * 0.32);
  const o = w / 2 + 0.03;
  gb.quad(-cs, y, o, cs, y, o, cs, y + 2 * cs, o, -cs, y + 2 * cs, o, 0, 0, 1, u0, v0, u1, v1);
  gb.quad(cs, y, -o, -cs, y, -o, -cs, y + 2 * cs, -o, cs, y + 2 * cs, -o, 0, 0, -1, u0, v0, u1, v1);
  gb.quad(o, y, cs, o, y, -cs, o, y + 2 * cs, -cs, o, y + 2 * cs, cs, 1, 0, 0, u0, v0, u1, v1);
  gb.quad(-o, y, -cs, -o, y, cs, -o, y + 2 * cs, cs, -o, y + 2 * cs, -cs, -1, 0, 0, u0, v0, u1, v1);
}

function pyramid(gb, x, y, z, r, h) {
  const c = [[-r, -r], [r, -r], [r, r], [-r, r]];
  const nl = Math.hypot(h, r);
  for (let k = 0; k < 4; k++) {
    const [ax, az] = c[k];
    const [bx, bz] = c[(k + 1) % 4];
    const nx = (((ax + bx) / 2 / r) * h) / nl;
    const ny = r / nl;
    const nz = (((az + bz) / 2 / r) * h) / nl;
    const a = gb.vertex(x + ax, y, z + az, nx, ny, nz, 0, 0);
    const b = gb.vertex(x + bx, y, z + bz, nx, ny, nz, (2 * r) / 3, 0);
    const t = gb.vertex(x, y + h, z, nx, ny, nz, r / 3, nl / 3);
    if ((bx - ax) * -az - (bz - az) * -ax < 0) gb.tri(a, b, t);
    else gb.tri(a, t, b);
  }
}

// Church towers at the street end of the long axis: one central tower with clock faces and a
// green copper pyramid + cross (Anglican cathedral), or two flanking towers with crenellated tops
// and corner pinnacles (Sacred Heart).
function churchTowers(gb, col, L, obb, spec, world, seed, copper) {
  if (!obb) return;
  const hl = obb.len / 2;
  const pa = world.nearestRoad(obb.cx + obb.ux * hl, obb.cz + obb.uz * hl, 60);
  const pb = world.nearestRoad(obb.cx - obb.ux * hl, obb.cz - obb.uz * hl, 60);
  const end = pb && (!pa || pb.dist < pa.dist) ? -1 : 1;
  const rot = -obb.angle;
  const size = copper ? 8 : 5.5;
  const H = copper ? 28 : 26;
  const offs = copper ? [0] : [-(obb.wid / 2 - size / 2), obb.wid / 2 - size / 2];
  for (const v of offs) {
    const u = end * (hl - size / 2);
    const x = obb.cx + obb.ux * u - obb.uz * v;
    const z = obb.cz + obb.uz * u + obb.ux * v;
    gb.brush(spec.tint, L.stone, seed, 0, 3, 0);
    gb.setTransform(x, 0, z, rot);
    gb.box(0, 0, 0, size, H, size, 4);
    col.setTransform(x, 0, z, rot);
    col.box(0, 0, 0, size, H, size, 1);
    col.box(0, H, 0, size + 0.5, 0.6, size + 0.5, 1, true);
    gb.brush(spec.tint, L.concrete, seed, 2);
    gb.box(0, H, 0, size + 0.5, 0.6, size + 0.5, 4);
    if (copper) {
      clockFaces(gb, L, size, H - 9, seed);
      gb.brush(tint('#7d8a71'), L.metal, seed, 2);
      pyramid(gb, 0, H + 0.6, 0, size / 2 + 0.2, 6);
      pyramid(col, 0, H + 0.6, 0, size / 2 + 0.2, 6);
      gb.brush(tint('#d8d2c2'), L.metal, seed, 2);
      gb.box(0, H + 6.4, 0, 0.18, 2.2, 0.18, 1);
      gb.box(0, H + 7.6, 0, 1.0, 0.18, 0.18, 1);
    } else {
      gb.brush(spec.tint, L.stone, seed, 0, 3, 0);
      const r = size / 2 + 0.25;
      // Merlons and corner pinnacles are solid too: perched feet stand between them, not in them.
      for (const k of [-2, 0, 2]) {
        const o = k * r * 0.4;
        for (const [dx, dz] of [[o, r - 0.2], [o, -r + 0.2], [r - 0.2, o], [-r + 0.2, o]]) {
          gb.box(dx, H + 0.6, dz, 0.5, 0.8, 0.5, 2);
          col.box(dx, H + 0.6, dz, 0.5, 0.8, 0.5, 1);
        }
      }
      for (const [dx, dz] of [[r, r], [-r, r], [r, -r], [-r, -r]]) {
        gb.cylinder(dx, H + 0.6, dz, 0.35, 2.4, 6, 2, true, 0.02);
        col.cylinder(dx, H + 0.6, dz, 0.35, 2.4, 6, 1, true, 0.02);
      }
    }
    gb.clearTransform();
    col.clearTransform();
  }
}

// ZANU-PF HQ ("Shake Shake" building): steep dark slate gable top like the beer carton.
function gableCrown(gb, col, L, obb, h, seed) {
  if (!obb) return;
  const hl = obb.len / 2 - 1;
  const hw = obb.wid / 2 - 1;
  const rise = 9;
  const P = (u, v, y) => [obb.cx + obb.ux * u - obb.uz * v, y, obb.cz + obb.uz * u + obb.ux * v];
  gb.brush(tint('#4a4d48'), L.tiles, seed, 2);
  for (const s of [1, -1]) {
    const a = P(-hl, s * hw, h);
    const b = P(hl, s * hw, h);
    const c = P(hl, 0, h + rise);
    const d = P(-hl, 0, h + rise);
    const nl = Math.hypot(rise, hw);
    gb.quad(...a, ...b, ...c, ...d, (-obb.uz * s * rise) / nl, hw / nl, (obb.ux * s * rise) / nl, 0, 0, obb.len / 3, nl / 3);
    col.quad(...a, ...b, ...c, ...d, 0, 1, 0, 0, 0, 1, 1);
  }
  gb.brush(tint('#a09a8c'), L.concrete, seed, 2);
  for (const e of [-1, 1]) {
    const a = P(e * hl, -hw, h);
    const b = P(e * hl, hw, h);
    const c = P(e * hl, 0, h + rise);
    const i0 = gb.vertex(...a, obb.ux * e, 0, obb.uz * e, 0, 0);
    const i1 = gb.vertex(...b, obb.ux * e, 0, obb.uz * e, obb.wid / 4, 0);
    const i2 = gb.vertex(...c, obb.ux * e, 0, obb.uz * e, obb.wid / 8, rise / 4);
    gb.tri(i0, i1, i2);
    gb.tri(i0, i2, i1);
    const j0 = col.vertex(...a, 0, 1, 0, 0, 0);
    const j1 = col.vertex(...b, 0, 1, 0, 0, 0);
    const j2 = col.vertex(...c, 0, 1, 0, 0, 0);
    col.tri(j0, j1, j2);
  }
}

// Pearl House: the rooftop stick figure with splayed legs holding a gold sphere aloft.
function pearlSculpture(gb, col, L, obb, h, seed) {
  if (!obb) return;
  const x = obb.cx + obb.ux * Math.min(6, obb.len * 0.2);
  const z = obb.cz + obb.uz * Math.min(6, obb.len * 0.2);
  const sx = -obb.uz;
  const sz = obb.ux;
  const hip = h + 4.2;
  const neck = h + 7;
  gb.brush(tint('#e8ebec'), L.metal, seed, 2);
  for (const s of [-1, 1]) {
    gb.beam(x + sx * 2.2 * s, h, z + sz * 2.2 * s, x, hip, z, 0.3, 2);
    gb.beam(x, neck - 0.3, z, x + sx * 0.9 * s, h + 9.1, z + sz * 0.9 * s, 0.22, 2);
  }
  gb.beam(x, hip, z, x, neck, z, 0.34, 2);
  gb.cylinder(x, neck, z, 0.3, 0.6, 8, 1, true, 0.25);
  gb.brush(tint('#e0b33a'), L.metal, seed, 2);
  gb.cylinder(x, h + 9.1, z, 0.35, 0.25, 10, 1, true, 0.85);
  gb.cylinder(x, h + 9.35, z, 0.85, 0.9, 10, 1, false, 0.85);
  gb.cylinder(x, h + 10.25, z, 0.85, 0.3, 10, 1, true, 0.3);
  // Collider follows the figure: splayed legs, body, raised arms and the sphere.
  for (const s of [-1, 1]) {
    col.beam(x + sx * 2.2 * s, h, z + sz * 2.2 * s, x, hip, z, 0.3, 1);
    col.beam(x, neck - 0.3, z, x + sx * 0.9 * s, h + 9.1, z + sz * 0.9 * s, 0.22, 1);
  }
  col.beam(x, hip, z, x, neck + 0.6, z, 0.4, 1);
  col.cylinder(x, h + 9.1, z, 0.85, 1.45, 8, 1, true);
}

// Arcaded front: a row of cream columns carrying a first-floor balcony slab with a balustrade,
// standing just off the street face (Parliament House).
function colonnade(gb, col, L, face, spec, seed) {
  if (!face) return;
  const depth = 2.6;
  const h = Math.min(spec.fh, 4.2);
  const w = face.len - 1;
  const rot = Math.atan2(face.nx, face.nz);
  gb.setTransform(face.x, 0, face.z, rot);
  gb.brush(tint('#f1ead6'), L.concrete, seed, 2);
  const n = Math.max(3, Math.round(w / 3.2) + 1);
  for (let k = 0; k < n; k++) {
    const x = -w / 2 + (k * w) / (n - 1);
    gb.cylinder(x, 0, depth - 0.3, 0.28, h, 8, 2, false, 0.24);
    gb.box(x, 0, depth - 0.3, 0.8, 0.4, 0.8, 1);
    gb.box(x, h - 0.3, depth - 0.3, 0.7, 0.3, 0.7, 1);
  }
  gb.box(0, h, depth / 2, w + 0.6, 0.45, depth + 0.2, 3, true);
  gb.brush(tint('#e6ddc4'), L.concrete, seed, 2);
  gb.box(0, h + 0.45, depth - 0.05, w + 0.6, 0.12, 0.3, 2);
  for (let x = -w / 2; x <= w / 2; x += 0.45) gb.box(x, h + 0.57, depth - 0.05, 0.1, 0.75, 0.1, 1);
  gb.box(0, h + 1.3, depth - 0.05, w + 0.6, 0.1, 0.3, 2);
  gb.clearTransform();
  // Physics: the columns, the balcony slab (with its underside) and the balustrade along its edge.
  col.setTransform(face.x, 0, face.z, rot);
  for (let k = 0; k < n; k++) col.cylinder(-w / 2 + (k * w) / (n - 1), 0, depth - 0.3, 0.3, h, 6, 1, false);
  col.box(0, h, depth / 2, w + 0.6, 0.45, depth + 0.2, 1, true);
  col.box(0, h + 0.45, depth - 0.05, w + 0.6, 0.95, 0.3, 1);
  col.clearTransform();
  return { x: face.x, z: face.z, ex: face.nz, ez: -face.nx, nx: face.nx, nz: face.nz, w, n, depth };
}

// Harare station: red cupola with white columns on a brick drum, straddling the roof ridge.
function cupola(gb, col, L, obb, y, seed) {
  if (!obb) return;
  gb.brush(tint('#ffffff'), L.brick, seed, 2);
  gb.cylinder(obb.cx, y - 1, obb.cz, 2.2, 2.2, 12, 3, false);
  gb.brush(tint('#f0ece2'), L.concrete, seed, 2);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    gb.cylinder(obb.cx + Math.cos(a) * 1.9, y + 1.2, obb.cz + Math.sin(a) * 1.9, 0.14, 2.2, 6, 1, false);
  }
  gb.brush(tint('#8a3a34'), L.metal, seed, 2);
  gb.cylinder(obb.cx, y + 3.4, obb.cz, 2.3, 0.9, 12, 2, false, 2.0);
  gb.cylinder(obb.cx, y + 4.3, obb.cz, 2.0, 1.4, 12, 2, true, 0.3);
  col.cylinder(obb.cx, y - 1, obb.cz, 2.3, 5.3, 8, 1, true);
  col.cylinder(obb.cx, y + 4.3, obb.cz, 2.0, 1.4, 8, 1, true, 0.3);
}

// Mbuya Nehanda: bronze figure with a raised arm on a granite pedestal.
function nehanda(gb, col, L, x, z) {
  gb.brush(tint('#8d8478'), L.concrete, 5, 2);
  gb.box(x, 0, z, 3, 1.5, 3, 2);
  gb.brush(tint('#5c4630'), L.metal, 5, 2);
  gb.cylinder(x, 1.5, z, 0.6, 2.2, 10, 1, true, 0.22);
  gb.cylinder(x, 3.62, z, 0.2, 0.42, 8, 1, true, 0.19);
  gb.beam(x + 0.15, 3.2, z, x + 0.45, 4.4, z + 0.1, 0.14, 1);
  col.box(x, 0, z, 3, 1.5, 3, 1);
  col.box(x, 1.5, z, 1.2, 2.6, 1.2, 1);
}

// Africa Unity Square fountain: round pool (turquoise inside) with a knee-high wall, a tall
// central jet with ring jets, a paved surround and flower beds.
function fountainAt(gb, col, jets, L, x, z, paths, G) {
  const R = 7.5;
  gb.brush(tint('#d8d0c2'), L.concrete, 6, 2);
  gb.cylinder(x, 0, z, R + 0.35, 0.6, 32, 2, false);
  gb.cylinder(x, 0.6, z, R + 0.35, 0.08, 32, 2, true);
  gb.brush(tint('#43add3'), L.concrete, 6, 2);
  const base = gb.vCount;
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    gb.vertex(x + Math.cos(a) * R, 0.05, z + Math.sin(a) * R, -Math.cos(a), 0, -Math.sin(a), i / 4, 0);
    gb.vertex(x + Math.cos(a) * R, 0.66, z + Math.sin(a) * R, -Math.cos(a), 0, -Math.sin(a), i / 4, 0.2);
  }
  for (let i = 0; i < 32; i++) {
    const a = base + i * 2;
    gb.tri(a, a + 3, a + 1);
    gb.tri(a, a + 2, a + 3);
  }
  gb.brush(tint('#7fd2ea'), L.water, 6, 2);
  gb.cylinder(x, 0.3, z, R, 0.05, 32, 3, true);
  gb.brush(tint('#d8d0c2'), L.concrete, 6, 2);
  gb.cylinder(x, 0.3, z, 1.0, 1.1, 12, 2, true, 0.7);
  // Physics: the knee wall (outer face, inner face, top), the water as a floor, the jet pedestal.
  const R0 = R + 0.35;
  col.cylinder(x, 0, z, R0, 0.68, 16, 1, false);
  col.cylinder(x, 0, z, R, 0.68, 16, 1, false);
  const pool = [];
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2;
    const a1 = ((i + 1) / 16) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    col.quad(x + c0 * R0, 0.68, z + s0 * R0, x + c1 * R0, 0.68, z + s1 * R0, x + c1 * R, 0.68, z + s1 * R, x + c0 * R, 0.68, z + s0 * R, 0, 1, 0, 0, 0, 1, 1);
    pool.push(x + c0 * R, z + s0 * R);
  }
  col.polygon(pool, null, 0.35, 1);
  col.cylinder(x, 0.3, z, 1.0, 1.1, 8, 1, true, 0.7);
  // Water jets (drawn translucent by the city, see createFountainJets).
  jets.brush(tint('#ffffff'), 0, 0, 0);
  jets.cylinder(x, 1.4, z, 0.45, 15, 10, 1, false, 0.12);
  jets.cylinder(x, 11.5, z, 0.15, 4.5, 10, 1, false, 1.6);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    jets.beam(x + Math.cos(a) * 4.5, 0.35, z + Math.sin(a) * 4.5, x + Math.cos(a) * 3.2, 2.8, z + Math.sin(a) * 3.2, 0.16, 1);
  }
  const ring = (r) => {
    const out = [];
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      out.push(x + Math.cos(a) * r, z + Math.sin(a) * r);
    }
    return out;
  };
  paths.brush(tint('#e8e4de'), G.concrete, 0, 0);
  paths.polygon(ring(R + 7), [ring(R + 0.3)], 0, 4);
  paths.brush(tint('#ffffff'), G.flowers, 0, 0);
  for (let i = 0; i < 36; i++) {
    if (i % 9 < 2) continue;
    const a0 = (i / 36) * Math.PI * 2;
    const a1 = ((i + 1) / 36) * Math.PI * 2;
    const r0 = R + 4;
    const r1 = R + 6.2;
    const q = [x + Math.cos(a0) * r0, 0.05, z + Math.sin(a0) * r0, x + Math.cos(a1) * r0, 0.05, z + Math.sin(a1) * r0,
      x + Math.cos(a1) * r1, 0.05, z + Math.sin(a1) * r1, x + Math.cos(a0) * r1, 0.05, z + Math.sin(a0) * r1];
    paths.quad(...q, 0, 1, 0, q[0] / 3, -q[2] / 3, q[6] / 3, -q[8] / 3);
  }
}
