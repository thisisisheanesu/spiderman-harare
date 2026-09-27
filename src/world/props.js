import * as THREE from 'three';
import { makeRng } from '../core/rng.js';
import { cleanRing, orientedBox, pointInRing, edgeNormals } from './polygon.js';
import { isMajor, KERB_HEIGHT, sidewalkWidth } from './streetMetrics.js';
import { adUV } from './signs.js';
import { tint } from './palette.js';
import { makeCanvas } from './atlas.js';
import { PropSet, PROP_META, propPoint } from './propModels.js';
import { ShopSigns } from './shops.js';
import { takeRooftopItems } from './rooftops.js';

// Street furniture, rooftop props and the real shop signs.
//
// Models (public/models/props, instanced by propModels.js): Harare's grey galvanised street lamps
// (double-arm solar poles in the medians of the dual carriageways with an arm over each
// carriageway and the panel facing north, single-arm poles at the kerb elsewhere; ~40 % dead, as in
// the real CBD), litter bins, timber benches, painted and concrete bollards, planters, bus shelters
// at the ranks and stops, green ZESA boxes, manhole covers, roadworks cones and barriers, JoJo
// tanks / AC units / dishes on the roofs (placed by rooftops.js), and shopkeepers' crates, chairs,
// drums, boxes and tyres outside the real shops that sell from the pavement.
// Procedural (merged into the city chunks): First Street Mall's brick palm planters, the railway
// platform canopies and the billboards. Shop signs: shops.js, from data/shops.json.
//
// Everything solid at street level is reported as {x, z, r} obstacles (pedestrian avoidance) and
// every high point as a web anchor {x, y, z, kind, radius}: lamp pole tops and arm tips ('lamp'),
// billboard tops ('billboard'), rooftop lift/stair rooms ('roofRoom'), tanks on stands and on lift
// rooms ('tank'), masts ('mast') and the parapet corners of buildings >= 30 m ('parapet'); trees
// are added by vegetation.js (addTreeAnchors).

const DARK = tint('#3d4246');
const SHELTER_BLUE = tint('#365374');

// Raised brick planter (First Street Mall) that a Washingtonia palm grows out of.
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

// Long steel canopy (railway platforms): posts, sloped iron roof, bench.
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
  gb.brush(frame, L.corrugated, 11, 2);
  gb.quad(-len / 2 - 0.2, h + 0.05, -d / 2, len / 2 + 0.2, h + 0.05, -d / 2, len / 2 + 0.2, h - 0.25, d / 2, -len / 2 - 0.2, h - 0.25, d / 2, 0, 0.995, 0.1, 0, 0, len / 3, 1);
  gb.quad(-len / 2 - 0.2, h - 0.25, d / 2, len / 2 + 0.2, h - 0.25, d / 2, len / 2 + 0.2, h + 0.05, -d / 2, -len / 2 - 0.2, h + 0.05, -d / 2, 0, -1, 0, 0, 0, len / 3, 1);
  gb.brush(tint('#cfc9bd'), L.concrete, 11, 2);
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

// Local (lx, lz) in a frame at (x, z) rotated by rot about Y (same convention as GeoBuffer and
// Object3D.rotation.y: local +Z faces (sin rot, cos rot)).
function local(x, z, rot, lx, lz, out) {
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  out.x = x + c * lx + sn * lz;
  out.z = z - sn * lx + c * lz;
  return out;
}

// Circles already taken by furniture, so props don't stand inside each other.
class Occupancy {
  constructor(cell = 8) {
    this.cell = cell;
    this.map = new Map();
  }

  _key(gx, gz) {
    return gx * 73856093 + gz;
  }

  add(x, z, r) {
    const k = this._key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let a = this.map.get(k);
    if (!a) this.map.set(k, (a = []));
    a.push(x, z, r);
  }

  free(x, z, r) {
    const gx = Math.floor(x / this.cell);
    const gz = Math.floor(z / this.cell);
    for (let i = gx - 1; i <= gx + 1; i++) {
      for (let j = gz - 1; j <= gz + 1; j++) {
        const a = this.map.get(this._key(i, j));
        if (!a) continue;
        for (let k = 0; k < a.length; k += 3) {
          const d = r + a[k + 2];
          if ((a[k] - x) ** 2 + (a[k + 1] - z) ** 2 < d * d) return false;
        }
      }
    }
    return true;
  }
}

// Which shops put stock out on the pavement, and what.
const SHOPFRONT = [
  { re: /liquor|bar|wholesale|grocery|supermarket/, p: 0.4, set: 'crates' },
  { re: /fast_food|restaurant|cafe|bakery/, p: 0.3, set: 'chairs' },
  { re: /salon|phone|telecom|electronics|clothing|shoes|retail|printing|stationery/, p: 0.22, set: 'chair' },
  { re: /auto_parts|car_dealer/, p: 0.6, set: 'tyres' },
  { re: /hardware|furniture|department|mall/, p: 0.3, set: 'boxes' },
  { re: /butcher|market/, p: 0.5, set: 'market' },
];
// Props that stand where the pedestrian lane may put a stall (hidden there once stalls exist).
const CLUTTER = new Set(['crate_plastic_red', 'crate_plastic_yellow', 'chair_monobloc', 'drum_plastic_blue', 'cardboard_box', 'tyre_old', 'trash_bag']);

// Builds the street furniture. ctx: the city build context plus sidewalkPaths, medians, urbanAt,
// frontages (buildings.js), signs (SignPainter: billboard posters), heightAt, colliderFor, and
// optionally uniforms (city uniforms: uNight), group (parent Object3D), shopData (parsed shops.json).
// Returns at once {lightPools, palms, obstacles, anchors, shops, group, ready, update, setNight,
// shopNear, stats}; `ready` resolves when the models and the shop signs are built (obstacles,
// anchors and shops are complete from then on).
export function buildProps(ctx) {
  const { data, chunks, colliderFor, L, sidewalkPaths, medians, urbanAt, quality, world, frontages, signs, heightAt, carriageways, game } = ctx;
  const level = game?.quality?.level || 'high';
  const uniforms = ctx.uniforms || game?.city?.uniforms || { uNight: { value: 0 } };
  const set = new PropSet({ level, shadows: !!game?.quality?.shadows });
  const rng = makeRng(4242);
  const density = quality.props;
  const roads = data.roads;
  const pools = [];
  const palms = [];
  const obstacles = [];
  const anchors = [];
  const occ = new Occupancy();
  const tmp = { x: 0, y: 0, z: 0 };
  const obstacle = (x, z, r) => obstacles.push({ x, z, r });
  const localObstacle = (x, z, rot, lx, lz, r) => {
    local(x, z, rot, lx, lz, tmp);
    obstacles.push({ x: tmp.x, z: tmp.z, r });
  };
  const offRoad = (x, z, margin) => !carriageways || !carriageways.contains(x, z, margin);
  const groundY = (x, z) => heightAt(x, z) + KERB_HEIGHT;
  // A model instance that pedestrians walk around (unless solid = false) and that later props avoid.
  const place = (name, x, y, z, rot = 0, s = 1, lit = 0, solid = true) => {
    if (set.add(name, x, y, z, rot, s, lit) < 0) return;
    const r = PROP_META[name].base * s;
    occ.add(x, z, r);
    if (solid) obstacle(x, z, r);
  };
  const propAnchors = (name, x, y, z, rot, kind) => {
    for (const [lx, ly, lz] of PROP_META[name].anchors) {
      propPoint(x, y, z, rot, 1, lx, ly, lz, tmp);
      anchors.push({ x: tmp.x, y: tmp.y, z: tmp.z, kind, radius: 0 });
    }
  };
  // A bus shelter model with its obstacles (bench / back panel, front posts) and a roof collider.
  const busShelter = (x, y, z, rot) => {
    set.add('bus_shelter', x, y, z, rot, 1, 0);
    occ.add(x, z, 2.2);
    for (const lx of [-1.4, 0, 1.4]) localObstacle(x, z, rot, lx, -0.5, 0.45);
    for (const lx of [-1.95, 1.95]) localObstacle(x, z, rot, lx, 0.75, 0.15);
    const col = colliderFor(-5);
    col.setTransform(x, y, z, rot);
    col.box(0, 2.5, 0, 4.3, 0.3, 2.1, 1);
    col.clearTransform();
  };
  // Free pavement: not in a building, not on a carriageway, clear of other furniture.
  const clear = (x, z, r, margin = 0.2) => !world.buildingAt(x, z) && offRoad(x, z, margin) && occ.free(x, z, r);

  // Dual carriageways (a median along most of the road, between two one-way carriageways) get
  // median lights instead of kerb lamps; short median fragments at junctions don't count.
  const polyLen = (pts) => {
    let len = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) len += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
    return len;
  };
  const medianLen = new Map();
  for (const m of medians) medianLen.set(m.road, (medianLen.get(m.road) || 0) + polyLen(m.pts));
  const medianRoads = new Set();
  for (const [ri, len] of medianLen) if (len > 0.5 * polyLen(roads[ri].pts)) medianRoads.add(ri);

  // Single-arm lamps at the kerb, arm over the road; bins, ZESA boxes and manholes on the pavement.
  let boxAcc = 60;
  let holeAcc = 25;
  let worksAcc = 12;
  for (const sp of sidewalkPaths) {
    const r = roads[sp.road];
    const urban = urbanAt(sp.pts[0], sp.pts[1]);
    const lit = isMajor(r) || urban > 0.4;
    const lamps = lit && !medianRoads.has(sp.road) && !(sp.side < 0 && r.w < 12 && !r.oneway);
    const spacing = isMajor(r) ? 34 : 42;
    let acc = sp.side > 0 ? spacing * 0.5 : spacing;
    const pts = sp.pts;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i];
      const az = pts[i + 1];
      const dx = pts[i + 2] - ax;
      const dz = pts[i + 3] - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const ux = dx / len;
      const uz = dz / len;
      // Towards the road: -side * left(d).
      const tx = (-sp.side * dz) / len;
      const tz = (sp.side * dx) / len;
      const rotRoad = Math.atan2(tx, tz);
      if (lamps) {
        for (let t = acc; t < len; t += spacing) {
          const px = ax + ux * t + tx * (sp.width / 2 - 0.4);
          const pz = az + uz * t + tz * (sp.width / 2 - 0.4);
          if (world.buildingAt(px, pz)) continue;
          const on = rng() < 0.6 ? 1 : 0;
          const py = groundY(px, pz);
          place('street_lamp_single', px, py, pz, rotRoad, 1, on);
          anchors.push({ x: px, y: py + 8, z: pz, kind: 'lamp', radius: 0 });
          if (on) pools.push(px + tx * 2.05, pz + tz * 2.05);
          if (urban > 0.5 && rng() < 0.4 * density) {
            const bx = px + ux * 3;
            const bz = pz + uz * 3;
            if (clear(bx, bz, 0.35)) {
              place('bin_metal', bx, groundY(bx, bz), bz, rotRoad + Math.PI);
              if (rng() < 0.2) {
                const gx = bx + ux * 0.6 - tx * 0.3;
                const gz = bz + uz * 0.6 - tz * 0.3;
                if (clear(gx, gz, 0.26)) place('trash_bag', gx, groundY(gx, gz), gz, rng() * 6.28, rng.range(0.85, 1.1));
              }
            }
          }
        }
        acc = (acc - len) % spacing;
        if (acc < 0) acc += spacing;
      }
      if (urban < 0.5) continue;
      // Green ZESA kiosks against the building line, about every 150 m.
      boxAcc -= len;
      if (boxAcc < 0 && len > 6) {
        boxAcc = rng.range(120, 190) / density;
        const t = len * 0.5;
        const bx = ax + ux * t - tx * (sp.width / 2 - 0.45);
        const bz = az + uz * t - tz * (sp.width / 2 - 0.45);
        if (clear(bx, bz, 0.55, 0.8)) place('electrical_box', bx, groundY(bx, bz), bz, rotRoad);
      }
      // Manhole covers in the paving.
      holeAcc -= len;
      if (holeAcc < 0 && len > 4) {
        holeAcc = rng.range(45, 90) / density;
        const t = len * rng.range(0.2, 0.8);
        const hx = ax + ux * t + tx * rng.range(-0.4, 0.4);
        const hz = az + uz * t + tz * rng.range(-0.4, 0.4);
        if (clear(hx, hz, 0.4, 0.5)) {
          set.add('manhole_cover', hx, groundY(hx, hz) - 0.06, hz, rng() * 6.28, 1, 0);
          occ.add(hx, hz, 0.35);
          // Now and then it is open for repairs: cones around it and a concrete barrier.
          if (--worksAcc < 0) {
            worksAcc = rng.int(28, 45);
            for (let k = 0; k < 3; k++) {
              const a = (k / 3) * Math.PI * 2 + rng() * 0.5;
              const cx = hx + Math.cos(a) * 0.75;
              const cz = hz + Math.sin(a) * 0.75;
              if (!world.buildingAt(cx, cz) && offRoad(cx, cz, 0.1)) place('traffic_cone', cx, groundY(cx, cz), cz, rng() * 6.28);
            }
            const bx = hx - tx * 1.2;
            const bz = hz - tz * 1.2;
            if (clear(bx, bz, 0.8, 0.5)) place('barrier_concrete', bx, groundY(bx, bz), bz, Math.atan2(-uz, ux));
          }
        }
      }
    }
  }

  // Dual-carriageway medians: double-arm lights every ~36 m (most with a solar panel, facing
  // north) alternating with small palms; a concrete barrier on the median noses. Both halves of a
  // median report it, so placements are de-duplicated on a coarse grid.
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
      const ux = dx / len;
      const uz = dz / len;
      // Midline of the median: the outer edge of this half.
      const ox = md.side * uz * (md.width / 2);
      const oz = -md.side * ux * (md.width / 2);
      if (i === 0 && md.width > 0.6 && len > 4 && claim(ax + ux * 1.6 + ox, az + uz * 1.6 + oz, 8)) {
        const x = ax + ux * 1.6 + ox;
        const z = az + uz * 1.6 + oz;
        if (!world.buildingAt(x, z)) place('barrier_concrete', x, groundY(x, z), z, Math.atan2(-uz, ux));
      }
      let t = acc;
      for (; t < len; t += 18) {
        const x = ax + ux * t + ox;
        const z = az + uz * t + oz;
        const k = count++ % 2;
        if (k === 0 && claim(x, z, 16)) {
          const on = rng() < 0.6 ? 1 : 0;
          const y = groundY(x, z);
          // Arms (local +-X) across the road: local X -> (cos a, -sin a) = +-(-uz, ux).
          const a0 = Math.atan2(-ux, -uz);
          let name = 'street_lamp_double';
          let rot = a0;
          if (rng() < 0.7) {
            // Pick the solar variant + turn whose panel faces most nearly north (-z): the plain
            // variant's panel faces local -Z (north score cos a), the _ew one local +X (sin a).
            let best = -2;
            for (const a of [a0, a0 + Math.PI]) {
              if (Math.cos(a) > best) {
                best = Math.cos(a);
                name = 'street_lamp_double_solar';
                rot = a;
              }
              if (Math.sin(a) > best) {
                best = Math.sin(a);
                name = 'street_lamp_double_solar_ew';
                rot = a;
              }
            }
          }
          place(name, x, y, z, rot, 1, on);
          propAnchors(name, x, y, z, rot, 'lamp');
          if (on) {
            for (const s of [1, -1]) {
              local(x, z, rot, 2.05 * s, 0, tmp);
              pools.push(tmp.x, tmp.z);
            }
          }
        } else if (k === 1 && md.width > 0.7 && claim(x, z, 16)) {
          palms.push({ species: 'palm', x, y: groundY(x, z), z, s: 0.55 + rng() * 0.2, rot: rng() * 6.28, c: [1, 1, 1] });
          occ.add(x, z, 0.5);
        }
      }
      acc = t - len;
    }
  }

  // First Street Mall and the other pedestrian streets: brick planters with palms and timber
  // benches down the middle, a bin by every other planter, painted bollards across the ends;
  // benches beside park footpaths.
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
          if (!world.buildingAt(x, z)) place('bollard_painted', x, heightAt(x, z), z, rng() * 6.28);
        }
      }
    }
    if (p.cls === 'pedestrian' && p.w >= 6) mallLamps(p);
    const gap = p.cls === 'pedestrian' || p.cls === 'footway' ? 30 : 0;
    if (!gap) continue;
    let nPl = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i];
      const az = pts[i + 1];
      const dx = pts[i + 2] - ax;
      const dz = pts[i + 3] - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const nx = -dz / len;
      const nz = dx / len;
      for (let t = gap / 2; t < len - 3; t += gap / density) {
        const cx = ax + (dx / len) * t;
        const cz = az + (dz / len) * t;
        if (p.cls === 'pedestrian') {
          // Mall: a raised brick planter with a Washingtonia palm, benches either side.
          if (world.buildingAt(cx, cz)) continue;
          planter(chunks.detailAt(cx, cz), colliderFor(-10), L, cx, cz, Math.atan2(dx, dz));
          obstacle(cx, cz, 1.85);
          occ.add(cx, cz, 1.85);
          palms.push({ species: 'palm', x: cx, y: 0.55, z: cz, s: 0.9 + rng() * 0.3, rot: rng() * 6.28, c: [1, 1, 1], planted: true });
          for (const sgn of [1, -1]) {
            const x = cx + nx * 2.35 * sgn;
            const z = cz + nz * 2.35 * sgn;
            const rot = Math.atan2(nx * sgn, nz * sgn);
            set.add('bench_timber', x, heightAt(x, z), z, rot, 1, 0);
            occ.add(x, z, 1.2);
            for (const u of [-0.8, 0, 0.8]) localObstacle(x, z, rot, u, 0, 0.42);
          }
          if (nPl++ % 2 === 0) {
            const bx = cx + (dx / len) * 2.2;
            const bz = cz + (dz / len) * 2.2;
            if (clear(bx, bz, 0.35)) place('bin_metal', bx, heightAt(bx, bz), bz, rng() * 6.28);
          }
        } else {
          const sgn = rng() < 0.5 ? 1 : -1;
          const x = cx + nx * (p.w / 2 + 1.1) * sgn;
          const z = cz + nz * (p.w / 2 + 1.1) * sgn;
          if (world.buildingAt(x, z) || !occ.free(x, z, 1.2)) continue;
          const rot = Math.atan2(-nx * sgn, -nz * sgn);
          set.add('bench_timber', x, heightAt(x, z), z, rot, 1, 0);
          occ.add(x, z, 1.2);
          for (const u of [-0.8, 0, 0.8]) localObstacle(x, z, rot, u, 0, 0.42);
          if (rng() < 0.3) {
            local(x, z, rot, 1.9, 0, tmp);
            if (clear(tmp.x, tmp.z, 0.35)) place('bin_metal', tmp.x, heightAt(tmp.x, tmp.z), tmp.z, rot);
          }
        }
      }
    }
  }

  // Kombi ranks: rows of bus shelters along the bays, concrete bollards around the edge and the
  // traders' crates, drums and chairs at the corners. Railway platforms: long blue steel canopies.
  // Mapped rank / platform outlines often spill over the streets around them, so anything that
  // would stand on a carriageway is left out.
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
      if (rank) {
        const n = Math.max(1, Math.floor(len / 4.3));
        for (let i = 0; i < n; i++) {
          const u = -((n - 1) * 4.3) / 2 + i * 4.3;
          local(x, z, rot, u, 0, tmp);
          const sx = tmp.x;
          const sz = tmp.z;
          let ok = !world.buildingAt(sx, sz);
          for (const [lx, lz] of [[-2.2, -1.1], [2.2, -1.1], [2.2, 1.1], [-2.2, 1.1]]) {
            local(sx, sz, rot, lx, lz, tmp);
            if (!offRoad(tmp.x, tmp.z, 0.3) || world.buildingAt(tmp.x, tmp.z)) ok = false;
          }
          if (ok) busShelter(sx, heightAt(sx, sz), sz, rot);
        }
        continue;
      }
      const d = Math.min(3, obb.wid - 0.5);
      let clearRow = true;
      for (let u = -len / 2; u <= len / 2 + 0.01 && clearRow; u += Math.max(1, len / Math.ceil(len / 3))) {
        for (const w of [-d / 2, d / 2]) {
          local(x, z, rot, u, w, tmp);
          if (!offRoad(tmp.x, tmp.z, 0.3)) clearRow = false;
        }
      }
      if (!clearRow) continue;
      shelter(chunks.detailAt(x, z), colliderFor(-5), L, x, z, rot, len, d, SHELTER_BLUE);
      const np = Math.max(2, Math.round(len / 3.5) + 1);
      for (let i = 0; i < np; i++) {
        const px = -len / 2 + (i * len) / (np - 1);
        localObstacle(x, z, rot, px, -d / 2 + 0.2, 0.12);
        localObstacle(x, z, rot, px, d / 2 - 0.2, 0.12);
      }
      for (let u = -len / 2 + 0.6; u <= len / 2 - 0.6; u += 0.6) localObstacle(x, z, rot, u, -d / 2 + 0.5, 0.3);
    }
    if (!rank) continue;
    let corner = 0;
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const ax = ring[i];
      const az = ring[i + 1];
      const len = Math.hypot(ring[j] - ax, ring[j + 1] - az);
      for (let t = 1; t < len - 1; t += 3) {
        const x = ax + ((ring[j] - ax) / len) * t;
        const z = az + ((ring[j + 1] - az) / len) * t;
        if (world.buildingAt(x, z) || !offRoad(x, z, 0.4)) continue;
        place('bollard_concrete', x, heightAt(x, z), z, rng() * 6.28);
      }
      // A trader's corner: a drum, a stack of crates, a chair and a few boxes, just inside.
      if (corner++ < 6 && rng() < 0.7) traderCorner(ax, az, ring);
    }
  }

  // Tall single-arm lamps down the pedestrian malls (First Street), alternating sides a metre in
  // from the shopfronts, arms over the middle.
  function mallLamps(p) {
    const pts = p.pts;
    let acc = 8;
    let side = 1;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i];
      const az = pts[i + 1];
      const dx = pts[i + 2] - ax;
      const dz = pts[i + 3] - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const nx = -dz / len;
      const nz = dx / len;
      let t = acc;
      for (; t < len; t += 28) {
        const s0 = side;
        side = -side;
        const off = p.w / 2 - 1.1;
        const x = ax + (dx / len) * t + nx * off * s0;
        const z = az + (dz / len) * t + nz * off * s0;
        if (world.buildingAt(x, z) || !occ.free(x, z, 0.5)) continue;
        // Arm (local +Z) towards the middle of the mall.
        const rot = Math.atan2(-nx * s0, -nz * s0);
        const on = rng() < 0.75 ? 1 : 0;
        const y = heightAt(x, z);
        place('street_lamp_single', x, y, z, rot, 1, on);
        anchors.push({ x, y: y + 8, z, kind: 'lamp', radius: 0 });
        if (on) {
          local(x, z, rot, 0, 2.05, tmp);
          pools.push(tmp.x, tmp.z);
        }
      }
      acc = t - len;
    }
  }

  function traderCorner(ax, az, ring) {
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < ring.length; i += 2) {
      cx += ring[i];
      cz += ring[i + 1];
    }
    cx /= ring.length / 2;
    cz /= ring.length / 2;
    const d = Math.hypot(cx - ax, cz - az) || 1;
    const x = ax + ((cx - ax) / d) * 3.5;
    const z = az + ((cz - az) / d) * 3.5;
    stockPile(x, z, Math.atan2(cx - ax, cz - az), 'market');
  }

  // A small pile of pavement stock around (x, z), its front (+Z) turned towards `rot`.
  function stockPile(x, z, rot, kind) {
    const put = (name, lx, lz, ly = 0, turn = 0, s = 1) => {
      local(x, z, rot, lx, lz, tmp);
      const r = PROP_META[name].base * s;
      if (ly === 0 && !clear(tmp.x, tmp.z, r, 0.3)) return false;
      const y = pavementY(tmp.x, tmp.z) + ly;
      if (ly === 0) place(name, tmp.x, y, tmp.z, rot + turn, s);
      else set.add(name, tmp.x, y, tmp.z, rot + turn, s, 0);
      return true;
    };
    const crates = (lx, lz, n) => {
      const name = rng() < 0.5 ? 'crate_plastic_red' : 'crate_plastic_yellow';
      const h = PROP_META[name].h - 0.01;
      if (!put(name, lx, lz, 0, rng() * 0.3)) return;
      for (let k = 1; k < n; k++) put(name, lx, lz, h * k, rng() * 0.3);
    };
    switch (kind) {
      case 'crates':
        crates(-0.3, 0, rng.int(2, 4));
        if (rng() < 0.6) crates(0.3, 0.05, rng.int(1, 3));
        break;
      case 'chairs':
        put('chair_monobloc', -0.5, 0.1, 0, Math.PI + rng.range(-0.4, 0.4));
        put('chair_monobloc', 0.5, 0.1, 0, Math.PI + rng.range(-0.4, 0.4));
        break;
      case 'chair':
        put('chair_monobloc', 0, 0, 0, rng.range(-0.8, 0.8));
        break;
      case 'tyres':
        for (let k = 0; k < rng.int(2, 4); k++) put('tyre_old', -0.9 + k * 0.35, 0, 0, Math.PI / 2 + rng.range(-0.15, 0.15));
        break;
      case 'boxes':
        put('cardboard_box', -0.3, 0, 0, rng() * 0.6);
        put('cardboard_box', 0.15, 0.1, 0, rng() * 0.6, 0.9);
        if (rng() < 0.5) put('cardboard_box', -0.1, 0.05, PROP_META.cardboard_box.h - 0.01, rng() * 0.6, 0.85);
        break;
      default:
        put('drum_plastic_blue', -0.7, 0, 0, rng() * 6.28);
        crates(0, 0, rng.int(1, 3));
        put('chair_monobloc', 0.7, 0.2, 0, rng.range(-1, 1));
        if (rng() < 0.6) put('cardboard_box', 0.1, 0.6, 0, rng() * 6.28);
        break;
    }
  }

  // Ground height at (x, z): raised by the kerb on a road's pavement strip, street level elsewhere
  // (malls, squares, ranks, forecourts).
  function pavementY(x, z) {
    const nr = world.nearestRoad(x, z, 12);
    const d = nr ? nr.dist - nr.road.w / 2 : -1;
    return heightAt(x, z) + (d > 0 && d < sidewalkWidth(nr.road) + 0.05 ? KERB_HEIGHT : 0);
  }

  // Bus stops along the main roads outside the rank areas: a shelter at the kerb every ~400 m.
  let stopAcc = 150;
  for (const sp of sidewalkPaths) {
    const r = roads[sp.road];
    if (!(r.cls === 'trunk' || r.cls === 'primary' || r.cls === 'secondary') || sp.width < 3.2) continue;
    const pts = sp.pts;
    let run = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i];
      const az = pts[i + 1];
      const dx = pts[i + 2] - ax;
      const dz = pts[i + 3] - az;
      const len = Math.hypot(dx, dz);
      run += len;
      stopAcc -= len;
      if (stopAcc > 0 || len < 14 || run < 30) continue;
      const tx = (-sp.side * dz) / len;
      const tz = (sp.side * dx) / len;
      const rot = Math.atan2(tx, tz);
      const x = ax + (dx / len) * (len / 2) + tx * (sp.width / 2 - 1.15);
      const z = az + (dz / len) * (len / 2) + tz * (sp.width / 2 - 1.15);
      let ok = occ.free(x, z, 2.3);
      for (const [lx, lz] of [[-2.2, -1.1], [2.2, -1.1], [2.2, 1.0], [-2.2, 1.0], [0, -1.1]]) {
        local(x, z, rot, lx, lz, tmp);
        if (!offRoad(tmp.x, tmp.z, 0.05) || world.buildingAt(tmp.x, tmp.z)) ok = false;
      }
      if (!ok) continue;
      stopAcc = rng.range(350, 480);
      busShelter(x, groundY(x, z), z, rot);
    }
  }

  // Billboards: on posts beside major roads away from the core, and on low CBD roofs.
  let ad = 0;
  const placed = [];
  const farFromOthers = (x, z, d) => placed.every(([px, pz]) => Math.hypot(px - x, pz - z) > d);
  const boardAnchors = (x, y, z, rot) => {
    for (const lx of [-3.3, 3.3]) {
      local(x, z, rot, lx, -0.15, tmp);
      anchors.push({ x: tmp.x, y: y + 3.6, z: tmp.z, kind: 'billboard', radius: 0 });
    }
  };
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
    let ok = !world.buildingAt(x, z) && !world.buildingAt(x + (dx / len) * 3.5, z + (dz / len) * 3.5) && !world.buildingAt(x - (dx / len) * 3.5, z - (dz / len) * 3.5);
    const road = world.nearestRoad(x, z, 12);
    if (road && road.dist < road.road.w / 2 + 2.5) ok = false;
    if (!ok) continue;
    placed.push([x, z]);
    // Face the road, angled a little so passing traffic sees it.
    const rot = Math.atan2(-ox, -oz) + 0.35 * (rng() - 0.5);
    billboard(chunks.at(x, z), colliderFor(-6), L, x, 0, z, rot, ad++ % 8, signs.adLayers, 21, 4.5);
    for (const px of [-6.4 / 3, 6.4 / 3]) localObstacle(x, z, rot, px, -0.15, 0.25);
    boardAnchors(x, 4.5, z, rot);
  }
  for (const f of frontages) {
    const b = f.b;
    if (b.h < 6 || b.h > 16 || f.len < 8 || !f.street.road || !isMajor(f.street.road) || !farFromOthers(f.ax, f.az, 220)) continue;
    const mx = (f.ax + f.bx) / 2 - f.nx * 1.2;
    const mz = (f.az + f.bz) / 2 - f.nz * 1.2;
    if (world.roofHeightAt(mx, mz) !== b.h) continue;
    placed.push([mx, mz]);
    const rot = Math.atan2(f.nx, f.nz);
    billboard(chunks.at(mx, mz), colliderFor(b.id), L, mx, b.h + 0.35, mz, rot, ad++ % 8, signs.adLayers, 22, 1.4);
    boardAnchors(mx, b.h + 0.35 + 1.4, mz, rot);
  }

  // Rooftop models and anchors recorded while the buildings were emitted.
  const roof = takeRooftopItems();
  for (const [name, x, y, z, rot, s] of roof.props) set.add(name, x, y, z, rot, s, 0);
  for (const a of roof.anchors) anchors.push(a);

  // Parapet corners of the tall buildings: the high points that carry swings along avenues whose
  // own roofs are low.
  for (const b of data.buildings) {
    if (b.h < 30 || !b.fp || b.fp.length < 6) continue;
    const ring = cleanRing(b.fp);
    const n = ring.length / 2;
    if (n < 3) continue;
    const nrm = edgeNormals(ring, true);
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n;
      const j = (i + 1) % n;
      const ex = ring[j * 2] - ring[i * 2];
      const ez = ring[j * 2 + 1] - ring[i * 2 + 1];
      const el = Math.hypot(ex, ez);
      const pl = Math.hypot(ring[i * 2] - ring[p * 2], ring[i * 2 + 1] - ring[p * 2 + 1]);
      if (el < 2 || pl < 2) continue;
      // Convex corner: the next edge turns away from the previous edge's outward normal.
      if ((ex / el) * nrm[p * 2] + (ez / el) * nrm[p * 2 + 1] > -0.2) continue;
      anchors.push({ x: ring[i * 2], y: b.h + 0.35, z: ring[i * 2 + 1], kind: 'parapet', radius: 0, b: b.id });
    }
  }

  // Night light pools under working lamps.
  const nPools = pools.length / 2;
  const geo = new THREE.PlaneGeometry(19, 19).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: poolTexture(), color: new THREE.Color('#ff9d4a'), transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true,
  });
  const lightPools = new THREE.InstancedMesh(geo, mat, Math.max(1, nPools));
  const m = new THREE.Matrix4();
  for (let i = 0; i < nPools; i++) {
    m.makeTranslation(pools[i * 2], heightAt(pools[i * 2], pools[i * 2 + 1]) + 0.2, pools[i * 2 + 1]);
    lightPools.setMatrixAt(i, m);
  }
  lightPools.count = nPools;
  lightPools.visible = false;
  lightPools.renderOrder = 2;

  // The models and the shop signs arrive asynchronously; the group is in the city from the start.
  const group = new THREE.Group();
  group.name = 'streetProps';
  (ctx.group || game?.city?.group || game?.scene)?.add(group);
  set.prefetch(game.assets);
  const shops = [];
  let shopSigns = null;
  let stalls = false;
  let external = false;
  let lastFrame = -1;
  const fwd = new THREE.Vector3();
  const tick = (cam, dt) => {
    set.update(cam);
    if (shopSigns) {
      game.camera?.getWorldDirection(fwd);
      shopSigns.update(cam, dt, fwd);
    }
    // Traders' clutter gives way to the pedestrian lane's stalls once those exist.
    if (!stalls) {
      const list = game?.npcs?.vendors?.stalls;
      if (list) {
        stalls = true;
        if (list.length) set.hideNear(CLUTTER, list, 3);
      }
    }
  };
  const result = {
    lightPools, palms, obstacles, anchors, shops, group, set,
    stats: { props: set.stats, signs: null, anchors: 0 },
    // Per frame from City.update (LOD, sign text cache).
    update(cam, dt = 1 / 60) {
      external = true;
      tick(cam, dt);
    },
    // City.setNight: lens / sign glow read the shared uNight uniform; only a private one needs this.
    setNight(t) {
      if (!ctx.uniforms && !game?.city?.uniforms) uniforms.uNight.value = t;
    },
    // Nearest named business within r m of (x, z) ({name, cat, x, z, road, ...}) or null.
    shopNear(x, z, r = 30) {
      return shopSigns ? shopSigns.near(x, z, r) : null;
    },
  };

  const shopClutter = (json) => {
    const r2 = makeRng(77);
    for (const s of json.shops) {
      if (s.floor) continue;
      const kind = s.kind || json.styles[s.style]?.kind;
      // Planters or bollards in front of the banks, hotels and fuel forecourts.
      if (s.cat === 'bank' || s.cat === 'hotel') {
        if (kind === 'board' || r2() > 0.55) continue;
        for (const sg of [-1, 1]) {
          const x = s.x + s.nx * 1.1 + s.ax * sg * (s.w / 2 + 0.2);
          const z = s.z + s.nz * 1.1 + s.az * sg * (s.w / 2 + 0.2);
          if (clear(x, z, 0.9, 0.6)) {
            const y = pavementY(x, z);
            place('planter_concrete', x, y, z, Math.atan2(s.nx, s.nz));
            set.add(r2() < 0.5 ? 'plant_aloe_pot' : 'plant_leafy_pot', x, y + 0.12, z, r2() * 6.28, 1.1, 0);
          }
        }
        continue;
      }
      if (s.cat === 'fuel') {
        for (let k = -2; k <= 2; k++) {
          const x = s.x + s.nx * ((s.off ?? 3) + 1.5) + s.ax * k * 1.4;
          const z = s.z + s.nz * ((s.off ?? 3) + 1.5) + s.az * k * 1.4;
          if (clear(x, z, 0.2, 0.3)) place('bollard_painted', x, pavementY(x, z), z, r2() * 6.28);
        }
        continue;
      }
      const rule = SHOPFRONT.find((q) => q.re.test(s.cat));
      if (!rule || r2() > rule.p * density) continue;
      const u = (r2() - 0.5) * Math.max(0, s.w - 1.5);
      const x = s.x + s.nx * 0.9 + s.ax * u;
      const z = s.z + s.nz * 0.9 + s.az * u;
      if (world.buildingAt(x, z) || !offRoad(x, z, 1.2)) continue;
      stockPile(x, z, Math.atan2(s.nx, s.nz), rule.set);
    }
  };

  result.ready = (async () => {
    try {
      const json = await (ctx.shopData ?? game.assets.json('data/shops.json'));
      if (json?.shops?.length) {
        shopSigns = new ShopSigns({ json, frontages, buildings: data.buildings, heightAt, uniforms, level, nodes: data.nodes });
        for (const o of shopSigns.obstacles) {
          obstacles.push(o);
          occ.add(o.x, o.z, o.r);
        }
        shopClutter(json);
        for (const s of shopSigns.shops) shops.push(s);
        const cam = game.camera?.position || { x: 0, z: 0 };
        shopSigns.build(game.renderer, cam.x, cam.z);
        group.add(shopSigns.group);
        // Until the city calls update() itself, the sign mesh drives the LOD / text cache.
        shopSigns.mesh.onBeforeRender = (renderer, scene, camera) => {
          if (external || lastFrame === game.frame) return;
          lastFrame = game.frame;
          tick(camera.position, 1 / 60);
        };
        result.signs = shopSigns;
        result.stats.signs = shopSigns.stats;
        result.stats.signTextureBytes = shopSigns.textureBytes;
      }
    } catch (err) {
      console.warn('[props] shop signs unavailable', err);
    }
    try {
      await set.load(game.assets, uniforms);
      group.add(set.group);
      set.update(game.camera?.position || { x: 0, z: 0 });
    } catch (err) {
      // Street furniture is decoration: a failure must not stop the city from starting.
      console.warn('[props] prop models unavailable', err);
    }
    result.stats.anchors = anchors.length;
    return result;
  })();
  return result;
}

