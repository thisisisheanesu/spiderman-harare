import { GeoBuffer } from './geoBuffer.js';
import { cleanRing, orientedBox, pointInRing } from './polygon.js';
import { polylineNormals, arcLengths } from './lines.js';
import { ribbon, faceUp } from './roads.js';
import { tint } from './palette.js';

// Ground-level surfaces: land-use areas (lawns, dry veld, school grounds...), parking lots and kombi
// ranks with painted bays, footpaths / First Street Mall paving, and the railway (ballast bed in
// the ground mesh, steel rails + sleepers merged into the city chunks).

// [ground layer, tint, priority group] — "landuse" areas sit under parks/lots that overlap them.
const AREA_STYLE = {
  park: ['grass', '#e6dfb4', 'area'],
  grass: ['grass', '#efe2ae', 'area'],
  pitch: ['grass', '#e2e3a6', 'area'],
  golf: ['grass', '#d6e0a4', 'landuse'],
  wood: ['dryGrass', '#e8dcc4', 'landuse'],
  scrub: ['dryGrass', '#f4e8d4', 'landuse'],
  school: ['dryGrass', '#f1e2cc', 'landuse'],
  hospital: ['dryGrass', '#efe3d0', 'landuse'],
  parking: ['asphalt', '#e8e2da', 'area'],
  rank: ['concrete', '#ffffff', 'area'],
  platform: ['concrete', '#ece6dc', 'area'],
};

const PATH_STYLE = {
  pedestrian: ['bricks', '#ffffff'],
  footway: ['paving', '#f3ebe0'],
  cycleway: ['paving', '#e8e0d4'],
  path: ['dirt', '#e6d2bf'],
  track: ['dirt', '#e2c8b0'],
  unknown: ['dirt', '#e6d2bf'],
};

const RAIL_GAUGE = 1.067; // NRZ uses Cape gauge

export function buildGround(ctx) {
  const { data, G, groundScale, heightAt, skipArea, chunks, L } = ctx;
  const landuse = new GeoBuffer(1 << 14);
  const areas = new GeoBuffer(1 << 14);
  const paths = new GeoBuffer(1 << 15);
  const marks = new GeoBuffer(1 << 14);

  for (const a of data.areas) {
    const style = AREA_STYLE[a.kind];
    if (!style || skipArea(a)) continue;
    const ring = cleanRing(a.pts);
    if (ring.length < 6) continue;
    const [layer, color, group] = style;
    const gb = group === 'landuse' ? landuse : areas;
    gb.brush(tint(color), G[layer], 0, 0);
    gb.polygon(ring, null, 0, groundScale[layer]);
    if (a.kind === 'parking' || a.kind === 'rank') paintBays(marks, G, ring, a.kind === 'rank', ctx.carriageways);
  }

  for (const p of data.paths) {
    const style = PATH_STYLE[p.cls];
    if (!style || p.pts.length < 4) continue;
    const [layer, color] = style;
    paths.brush(tint(color), G[layer], 0, 0);
    const w = p.cls === 'pedestrian' ? p.w : Math.min(p.w, 3);
    ribbon(paths, p.pts, polylineNormals(p.pts), -w / 2, w / 2, heightAt, groundScale[layer]);
  }

  const { minX, maxX, minZ, maxZ } = data.meta.bounds;
  const m = 500;
  for (const r of data.rail) {
    const pts = clipPolyline(r.pts, minX - m, maxX + m, minZ - m, maxZ + m);
    for (const part of pts) {
      railBed(paths, G, part);
      rails(chunks, L, part);
    }
  }
  return { landuse, areas, paths, marks };
}

// Ballast bed: u across the bed (0..1), v along it (one sleeper group per 2.6 m).
function railBed(gb, G, pts) {
  const nrm = polylineNormals(pts);
  const lens = arcLengths(pts);
  const hw = 1.7;
  gb.brush(tint('#ffffff'), G.ballast, 0, 0);
  const i0 = gb.iCount;
  let pa = -1;
  let pb = -1;
  for (let i = 0; i < pts.length / 2; i++) {
    const k = nrm[i * 3 + 2];
    const x = pts[i * 2];
    const z = pts[i * 2 + 1];
    const a = gb.vertex(x - nrm[i * 3] * hw * k, 0.02, z - nrm[i * 3 + 1] * hw * k, 0, 1, 0, 0, lens[i] / 2.6);
    const b = gb.vertex(x + nrm[i * 3] * hw * k, 0.02, z + nrm[i * 3 + 1] * hw * k, 0, 1, 0, 1, lens[i] / 2.6);
    if (pa >= 0) {
      gb.tri(pa, pb, b);
      gb.tri(pa, b, a);
    }
    pa = a;
    pb = b;
  }
  faceUp(gb, i0);
}

// Two steel rails per track, merged into the city chunks (facade material, metal layer).
function rails(chunks, L, pts) {
  const steel = tint('#6f6a64');
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const az = pts[i + 1];
    const bx = pts[i + 2];
    const bz = pts[i + 3];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const gb = chunks.detailAt((ax + bx) / 2, (az + bz) / 2);
    const rot = Math.atan2(-(bz - az), bx - ax);
    gb.brush(steel, L.metal, 0, 2);
    gb.setTransform((ax + bx) / 2, 0, (az + bz) / 2, rot);
    for (const o of [-RAIL_GAUGE / 2, RAIL_GAUGE / 2]) gb.box(0, 0.02, o, len + 0.02, 0.16, 0.07, 2);
    gb.clearTransform();
  }
}

// Cuts a polyline to a rectangle (keeps whole segments that touch it), returns pieces.
function clipPolyline(p, x0, x1, z0, z1) {
  const out = [];
  let cur = null;
  const inside = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const keep = inside(p[i], p[i + 1]) || inside(p[i + 2], p[i + 3]);
    if (keep) {
      if (!cur) {
        cur = [p[i], p[i + 1]];
        out.push(cur);
      }
      cur.push(p[i + 2], p[i + 3]);
    } else {
      cur = null;
    }
  }
  return out;
}

// Parking / kombi bays: double rows of bay lines across the lot's long axis. The area polygons
// themselves draw under the asphalt (polygon offset), but paint is drawn over everything, so bay
// lines are clipped wherever a carriageway (street or service aisle) crosses the lot.
function paintBays(gb, G, ring, rank, carriageways) {
  const obb = orientedBox(ring);
  if (!obb || obb.wid < 10) return;
  const bayW = rank ? 3.2 : 2.6;
  const depth = rank ? 6.5 : 5;
  const aisle = rank ? 8 : 6.5;
  gb.brush(rank ? tint('#f0d040') : tint('#f4f3ee'), G.paint, 0, 0);
  const vx = -obb.uz;
  const vz = obb.ux;
  const at = (u, v) => [obb.cx + obb.ux * u + vx * v, obb.cz + obb.uz * u + vz * v];
  for (let v0 = -obb.wid / 2 + 1; v0 + 2 * depth < obb.wid / 2; v0 += 2 * depth + aisle) {
    for (let u = -obb.len / 2 + 1; u < obb.len / 2 - 1; u += bayW) {
      const [ax, az] = at(u, v0);
      const [bx, bz] = at(u, v0 + 2 * depth);
      if (!pointInRing(ax, az, ring) || !pointInRing(bx, bz, ring)) continue;
      offRoadLine(gb, ax, az, bx, bz, 0.12, carriageways);
    }
    const [cx0, cz0] = at(-obb.len / 2 + 1, v0 + depth);
    const [cx1, cz1] = at(obb.len / 2 - 1, v0 + depth);
    if (pointInRing(cx0, cz0, ring) && pointInRing(cx1, cz1, ring)) offRoadLine(gb, cx0, cz0, cx1, cz1, 0.12, carriageways);
  }
}

// A paint line sampled every ~1 m; only the runs of samples that are off the carriageways are drawn.
function offRoadLine(gb, ax, az, bx, bz, w, carriageways) {
  if (!carriageways) {
    line(gb, ax, az, bx, bz, w);
    return;
  }
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
  let start = -1;
  for (let k = 0; k <= n + 1; k++) {
    const off = k <= n && !carriageways.contains(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, 0.15);
    if (off) {
      if (start < 0) start = k;
      continue;
    }
    if (start >= 0 && k - 1 > start) {
      const t0 = start / n;
      const t1 = (k - 1) / n;
      line(gb, ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, w);
    }
    start = -1;
  }
}

function line(gb, ax, az, bx, bz, w) {
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const nx = (-(bz - az) / len) * (w / 2);
  const nz = ((bx - ax) / len) * (w / 2);
  gb.quad(ax - nx, 0.01, az - nz, bx - nx, 0.01, bz - nz, bx + nx, 0.01, bz + nz, ax + nx, 0.01, az + nz, 0, 1, 0, 0, 0, len / 2, 0.1);
}
