import { pointInRing } from './polygon.js';
import { MISC_CELLS, miscUV } from './facades.js';
import { tint } from './palette.js';

// Rooftop clutter for flat roofs: lift/stair rooms, JoJo water tanks (on steel stands or on the lift
// room), AC condenser units, satellite dishes (pointing north at the geostationary arc: the sun and
// the satellites are to the north in Harare), solar geysers, antennas and vent pipes. Lift rooms,
// geysers, antennas and vents are merged into the chunk meshes; the tanks, AC units and dishes are
// street-prop models (public/models/props) recorded here and instanced by props.js. Solid items
// also go into `col` (physics), and the tops of lift rooms, tank stands and masts are web-swing
// anchors {x, y, z, kind, radius}.

const METAL_DARK = tint('#4a4f53');
const METAL = tint('#9aa0a4');
const CONCRETE = tint('#cfcbc2');

// Model placements [name, x, y, z, rot, scale] and anchors collected while the buildings are
// emitted; props.js takes them (takeRooftopItems) when it builds the street furniture.
let items = { props: [], anchors: [] };
export function takeRooftopItems() {
  const out = items;
  items = { props: [], anchors: [] };
  return out;
}
const anchor = (x, y, z, kind, radius = 0, b = -1) => items.anchors.push({ x, y, z, kind, radius, b });

// JoJo tank model sizes (props.json): radius ~0.83 m; heights 2.1 m (tank) / 4.16 m (on its stand).
const TANK_R = 0.83;

function doorQuad(gb, L, x, y, z, w, h, nx, nz) {
  // Door on a wall facing (nx, nz), centred at (x, z), bottom at y.
  const [u0, v0, u1, v1] = miscUV(MISC_CELLS.door);
  const tx = -nz;
  const tz = nx;
  const o = 0.02;
  gb.setLayer(L.misc);
  gb.quad(
    x + nx * o - (tx * w) / 2, y, z + nz * o - (tz * w) / 2,
    x + nx * o + (tx * w) / 2, y, z + nz * o + (tz * w) / 2,
    x + nx * o + (tx * w) / 2, y + h, z + nz * o + (tz * w) / 2,
    x + nx * o - (tx * w) / 2, y + h, z + nz * o - (tz * w) / 2,
    nx, 0, nz, u0, v0, u1, v1,
  );
}

// Box in a rotated frame (rot about Y around its centre). Uses the buffer's transform.
function rbox(gb, x, y, z, w, h, d, rot, uvScale, bottom = false) {
  gb.setTransform(x, y, z, rot);
  gb.box(0, 0, 0, w, h, d, uvScale, bottom);
  gb.clearTransform();
}

function liftRoom(gb, col, L, x, y, z, w, d, h, rot, wallTint, seed) {
  gb.brush(wallTint, L.blank, seed, 2);
  rbox(gb, x, y, z, w, h, d, rot, 3.4);
  gb.brush(CONCRETE, L.concrete, seed, 2);
  rbox(gb, x, y + h, z, w + 0.3, 0.18, d + 0.3, rot, 4);
  // Door on the local +z face.
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const nx = s;
  const nz = c;
  gb.brush([255, 255, 255], L.misc, seed, 2);
  doorQuad(gb, L, x + nx * (d / 2), y, z + nz * (d / 2), 1.0, 2.1, nx, nz);
  // Louvre above the door.
  const [u0, v0, u1, v1] = miscUV(MISC_CELLS.louvre);
  const tx = -nz;
  const tz = nx;
  const px = x + nx * (d / 2 + 0.02);
  const pz = z + nz * (d / 2 + 0.02);
  gb.quad(px - tx * 0.5, y + 2.35, pz - tz * 0.5, px + tx * 0.5, y + 2.35, pz + tz * 0.5, px + tx * 0.5, y + 2.85, pz + tz * 0.5, px - tx * 0.5, y + 2.85, pz - tz * 0.5, nx, 0, nz, u0, v0, u1, v1);
  rbox(col, x, y, z, w, h + 0.18, d, rot, 1);
  // Web anchors on the corners of its roof slab.
  for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) {
    anchor(x + c * lx + s * lz, y + h + 0.18, z - s * lx + c * lz, 'roofRoom');
  }
}

// JoJo tank (model), on a 2 m steel stand when `stand`. Scale s ~ radius / 0.83.
function tank(col, x, y, z, s, stand, rot, bid) {
  const h = (stand ? 4.16 : 2.1) * s;
  items.props.push([stand ? 'water_tank_stand' : 'water_tank', x, y, z, rot, s]);
  col.box(x, y, z, TANK_R * 2 * s, h, TANK_R * 2 * s, 1);
  if (y + h > 8) anchor(x, y + h, z, 'tank', TANK_R * s, bid);
}

function acUnit(x, y, z, rot) {
  items.props.push(['ac_unit', x, y, z, rot, 1]);
}

function hvac(gb, col, L, x, y, z, rot, seed) {
  gb.brush(tint('#c9ccce'), L.metal, seed, 2);
  rbox(gb, x, y, z, 3.2, 1.5, 1.8, rot, 2);
  rbox(col, x, y, z, 3.2, 1.5, 1.8, rot, 1);
  const [u0, v0, u1, v1] = miscUV(MISC_CELLS.vent);
  gb.brush([255, 255, 255], L.misc, seed, 2);
  gb.setTransform(x, y, z, rot);
  for (const sz of [1, -1]) gb.quad(-1.4, 0.2, 0.91 * sz, 1.4, 0.2, 0.91 * sz, 1.4, 1.3, 0.91 * sz, -1.4, 1.3, 0.91 * sz, 0, 0, sz, u0, v0, u1, v1);
  gb.brush(METAL_DARK, L.metal, seed, 2);
  gb.cylinder(0.8, 1.5, 0, 0.55, 0.12, 10, 1, true);
  gb.cylinder(-0.8, 1.5, 0, 0.55, 0.12, 10, 1, true);
  gb.clearTransform();
}

// Solar water heater: tilted panel facing north (-z) + horizontal tank along its top edge.
function solarGeyser(gb, L, x, y, z, seed) {
  const w = 2.0;
  const len = 1.2;
  const tilt = 0.45;
  const h1 = 0.3 + Math.sin(tilt) * len;
  const zs = z + Math.cos(tilt) * len * 0.5;
  const zn = z - Math.cos(tilt) * len * 0.5;
  gb.brush([255, 255, 255], L.solar, seed, 0, 4, 1);
  // Panel: low edge north (zn, y+0.3), high edge south (zs, y+h1); normal points north-up.
  const ny = Math.cos(tilt);
  const nz = -Math.sin(tilt);
  gb.quad(x - w / 2, y + 0.3, zn, x + w / 2, y + 0.3, zn, x + w / 2, y + h1, zs, x - w / 2, y + h1, zs, 0, ny, nz, 0, 0, 2, 1.2);
  gb.brush(METAL, L.metal, seed, 2);
  gb.quad(x - w / 2, y + 0.3, zn, x - w / 2, y + h1, zs, x + w / 2, y + h1, zs, x + w / 2, y + 0.3, zn, 0, -ny, -nz, 0, 0, 1, 1);
  for (const dx of [-w / 2 + 0.1, w / 2 - 0.1]) gb.box(x + dx, y, zs, 0.06, h1, 0.06, 1);
  // Tank (a horizontal cylinder approximated by an 8-sided prism along x).
  const r = 0.26;
  const cy = y + h1 + r * 0.7;
  const cz = zs + 0.1;
  gb.brush(tint('#dfe0dc'), L.tank, seed, 2);
  const segs = 8;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    gb.quad(
      x - w / 2, cy + Math.sin(a0) * r, cz + Math.cos(a0) * r,
      x + w / 2, cy + Math.sin(a0) * r, cz + Math.cos(a0) * r,
      x + w / 2, cy + Math.sin(a1) * r, cz + Math.cos(a1) * r,
      x - w / 2, cy + Math.sin(a1) * r, cz + Math.cos(a1) * r,
      0, Math.sin(am), Math.cos(am), 0, i / segs, 1, (i + 1) / segs,
    );
  }
}

function antenna(gb, L, x, y, z, h, seed, bid) {
  gb.brush(METAL, L.metal, seed, 2);
  gb.cylinder(x, y, z, 0.05, h, 5, 1, true);
  anchor(x, y + h, z, 'mast', 0, bid);
  for (let k = 0; k < 3; k++) {
    const yy = y + h * (0.55 + k * 0.15);
    const w = 1.4 - k * 0.35;
    gb.box(x, yy, z, w, 0.04, 0.04, 1);
    gb.box(x, yy, z, 0.04, 0.04, w * 0.6, 1);
  }
}

// DStv-style dish (model) on its ballast frame, facing north with a little scatter.
function dish(x, y, z, rot, s) {
  items.props.push(['satellite_dish', x, y, z, rot, s]);
}

function ventPipes(gb, L, x, y, z, seed) {
  gb.brush(METAL_DARK, L.metal, seed, 2);
  gb.cylinder(x, y, z, 0.08, 0.9, 6, 1, false);
  gb.cylinder(x, y + 0.9, z, 0.16, 0.12, 6, 1, true, 0.12);
}

// Places clutter inside `inner` (roof polygon inset ~1 m) at roof height y. Lift rooms go to
// opts.base (they shape the skyline), the small stuff to `gb`.
export function addRooftopClutter(gb, col, L, b, inner, holes, y, obb, rng, opts) {
  const placed = [];
  const free = (x, z, r) => {
    if (!pointInRing(x, z, inner)) return false;
    if (holes) for (const h of holes) if (pointInRing(x, z, h)) return false;
    for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < p.r + r + 0.4) return false;
    // Keep a footprint's corners inside too.
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.785;
      if (!pointInRing(x + Math.cos(a) * r, z + Math.sin(a) * r, inner)) return false;
    }
    return true;
  };
  const sample = (r, tries = 14) => {
    for (let t = 0; t < tries; t++) {
      const u = (rng() - 0.5) * obb.len;
      const v = (rng() - 0.5) * obb.wid;
      const x = obb.cx + obb.ux * u - obb.uz * v;
      const z = obb.cz + obb.uz * u + obb.ux * v;
      if (free(x, z, r)) {
        placed.push({ x, z, r });
        return { x, z };
      }
    }
    return null;
  };
  const area = obb.len * obb.wid;
  const rot = -obb.angle;
  const seed = b.seed;

  if (opts.liftRoom && obb.len > 9 && obb.wid > 7) {
    const w = Math.min(6.5, 3 + obb.len * 0.08);
    const d = Math.min(5, 2.6 + obb.wid * 0.08);
    const h = 3.0 + (b.h > 40 ? 1.2 : 0);
    const r = Math.hypot(w, d) / 2;
    // Prefer the middle of the roof, but not exactly on the centroid (spawn points use it).
    const off = Math.min(obb.len * 0.25, 6);
    for (const sgn of [1, -1]) {
      const x = obb.cx + obb.ux * off * sgn;
      const z = obb.cz + obb.uz * off * sgn;
      if (free(x, z, r)) {
        placed.push({ x, z, r });
        liftRoom(opts.base, col, L, x, y, z, w, d, h, rot, opts.wallTint, seed);
        if (opts.clutter > 0.5 && rng() < 0.6) {
          // Tank on the lift room's roof slab: the highest thing on many CBD roofs.
          const lx = Math.min(w / 2 - 0.9, w * 0.25);
          tank(col, x + obb.ux * lx, y + h + 0.18, z + obb.uz * lx, rng.range(0.9, 1.05), false, rng() * 6.28, b.id);
        }
        break;
      }
    }
  }

  // JoJo tanks, 1-3 per roof (more on residential blocks), most of them up on stands.
  const nTanks = Math.min(4, Math.floor(area / 250) + (rng() < 0.6 ? 1 : 0) + (/apartments|residential|hotel|dormitory/.test(b.cls || '') ? 1 : 0));
  for (let i = 0; i < nTanks * opts.clutter; i++) {
    const s = rng.range(0.85, 1.12);
    const p = sample(TANK_R * s + 0.3);
    if (p) tank(col, p.x, y, p.z, s, rng() < 0.65, rng() * 6.28, b.id);
  }
  // Condenser units in rows along the roof's axis.
  const nAc = Math.min(8, Math.floor((area / 110) * opts.clutter));
  for (let i = 0; i < nAc; i++) {
    const p = sample(0.55, 6);
    if (p) acUnit(p.x, y, p.z, rot + (rng() < 0.5 ? 0 : Math.PI / 2) + (rng() < 0.5 ? Math.PI : 0));
  }
  if (area > 700 && rng() < 0.7 * opts.clutter) {
    const p = sample(2.0);
    if (p) hvac(gb, col, L, p.x, y, p.z, rot, seed);
  }
  if (opts.solar) {
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const p = sample(1.3);
      if (p) solarGeyser(gb, L, p.x, y, p.z, seed);
    }
  }
  if (rng() < 0.45 * opts.clutter) {
    const p = sample(0.4);
    if (p) antenna(gb, L, p.x, y, p.z, rng.range(3, b.h > 30 ? 10 : 6), seed, b.id);
  }
  const nDish = rng() < 0.5 ? rng.int(1, 3) : 0;
  for (let i = 0; i < nDish * opts.clutter; i++) {
    const p = sample(0.6, 6);
    if (p) dish(p.x, y, p.z, (rng() - 0.5) * 0.5, rng.range(0.85, 1.1));
  }
  const nVent = rng.int(0, 3);
  for (let i = 0; i < nVent * opts.clutter; i++) {
    const p = sample(0.3, 4);
    if (p) ventPipes(gb, L, p.x, y, p.z, seed);
  }
}

