import { closestOnSegment, lonLatToXZ, pointInPoly } from '../core/geo.js';
import { KOMBI_RANKS } from '../data/streetlife.js';

// Where the player is, as far as the street recordings are concerned. sample(x, z) fills
// {rank, market, park, street} with weights 0..1 that fade smoothly with distance:
//   rank    kombi ranks / bus termini (data.ranks, areas kind 'rank', the researched rank list)
//   market  markets (data.markets), First Street Mall, clusters of street-vendor stalls
//   park    park areas (Harare Gardens, Africa Unity Square, Greenwood Park, ...)
//   street  the rest of the CBD (strongest among the tall core blocks), minus the zones above
// Pure geometry, no audio: cheap enough to sample a few times a second.

const RANK_BIG = { rin: 30, rout: 125 }; // termini / bus stations
const RANK_STOP = { rin: 12, rout: 60, scale: 0.7 }; // a mapped kombi stop
const RANK_AREA = { rout: 85 }; // from the edge of a mapped rank area
const MARKET_POINT = { rin: 35, rout: 120 };
const MARKET_AREA = { rout: 90 };
const MALL = { rin: 12, rout: 70, scale: 0.85 }; // First Street Mall (pedestrian street lined with shops and vendors)
const PARK_AREA = { rout: 45 };
const STALL_RADIUS = 32; // m: vendor stalls counted around the player
const STALLS_FULL = 6; // this many stalls nearby = a busy vendor corner
const STALL_SCALE = 0.75;
const CBD_CELL = 100; // m
const STREET_FLOOR = 0.35; // street level outside the tall core (the Avenues, Kopje side)

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const fade = (d, rin, rout) => 1 - smooth((d - rin) / (rout - rin));

export class SoundZones {
  // stalls: optional [{x, z}] (npc vendor stalls), read lazily through the getter.
  constructor(data, getStalls) {
    this.getStalls = getStalls;
    this.points = { rank: [], market: [] };
    this.polys = { rank: [], market: [], park: [] };
    this.lines = { market: [] };
    this._addData(data || {});
    this._buildCbd(data || {});
    this._stallGrid = null;
    this.out = { rank: 0, market: 0, park: 0, street: 0 };
  }

  _addData(data) {
    for (const r of data.ranks || []) {
      const spec = r.kind === 'bus_stop' ? RANK_STOP : RANK_BIG;
      this.points.rank.push({ x: r.x, z: r.z, ...spec });
    }
    for (const k of KOMBI_RANKS || []) {
      if (!Number.isFinite(k.lat) || !Number.isFinite(k.lon)) continue;
      const { x, z } = lonLatToXZ(k.lon, k.lat);
      this.points.rank.push({ x, z, ...(k.size === 'large' ? RANK_BIG : { rin: 20, rout: 90, scale: 0.85 }) });
    }
    for (const a of data.areas || []) {
      if (a.kind === 'rank') this.polys.rank.push(poly(a.pts, RANK_AREA.rout));
      else if (a.kind === 'park') this.polys.park.push(poly(a.pts, PARK_AREA.rout));
    }
    for (const m of data.markets || []) {
      if (Array.isArray(m.pts) && m.pts.length >= 6) this.polys.market.push(poly(m.pts, MARKET_AREA.rout));
      if (Number.isFinite(m.x) && Number.isFinite(m.z)) this.points.market.push({ x: m.x, z: m.z, ...MARKET_POINT });
    }
    for (const p of data.paths || []) {
      if (p.cls === 'pedestrian' && /first street mall/i.test(p.name || '')) this.lines.market.push(line(p.pts, MALL.rout));
    }
  }

  // Coarse grid of the tall CBD core (buildings[].core), blurred, so 'street' is strongest downtown.
  _buildCbd(data) {
    const b = data.meta?.bounds;
    if (!b) return;
    const nx = Math.max(1, Math.ceil((b.maxX - b.minX) / CBD_CELL));
    const nz = Math.max(1, Math.ceil((b.maxZ - b.minZ) / CBD_CELL));
    const count = new Float32Array(nx * nz);
    for (const bld of data.buildings || []) {
      if (!bld.core) continue;
      const x = bld.cx ?? bld.fp?.[0];
      const z = bld.cz ?? bld.fp?.[1];
      const i = Math.floor((x - b.minX) / CBD_CELL);
      const j = Math.floor((z - b.minZ) / CBD_CELL);
      if (i >= 0 && j >= 0 && i < nx && j < nz) count[j * nx + i]++;
    }
    const grid = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        let s = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii >= 0 && jj >= 0 && ii < nx && jj < nz) s += count[jj * nx + ii];
          }
        }
        grid[j * nx + i] = Math.min(1, s / 12);
      }
    }
    this.cbd = { grid, nx, nz, x0: b.minX, z0: b.minZ };
  }

  cbdAt(x, z) {
    const c = this.cbd;
    if (!c) return 1;
    const fx = Math.min(c.nx - 1, Math.max(0, (x - c.x0) / CBD_CELL - 0.5));
    const fz = Math.min(c.nz - 1, Math.max(0, (z - c.z0) / CBD_CELL - 0.5));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const i1 = Math.min(c.nx - 1, i + 1);
    const j1 = Math.min(c.nz - 1, j + 1);
    const tx = fx - i;
    const tz = fz - j;
    const g = c.grid;
    const a = g[j * c.nx + i] * (1 - tx) + g[j * c.nx + i1] * tx;
    const d = g[j1 * c.nx + i] * (1 - tx) + g[j1 * c.nx + i1] * tx;
    return a * (1 - tz) + d * tz;
  }

  // Vendor stalls hashed into a grid the first time they exist (npcs builds them during init).
  _stalls() {
    if (this._stallGrid) return this._stallGrid;
    const stalls = this.getStalls?.();
    if (!stalls?.length) return null;
    const cells = new Map();
    for (const s of stalls) {
      if (!Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
      const key = cellKey(Math.floor(s.x / STALL_RADIUS), Math.floor(s.z / STALL_RADIUS));
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(s.x, s.z);
    }
    this._stallGrid = cells;
    return cells;
  }

  _stallDensity(x, z) {
    const cells = this._stalls();
    if (!cells) return 0;
    const ci = Math.floor(x / STALL_RADIUS);
    const cj = Math.floor(z / STALL_RADIUS);
    let sum = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const pts = cells.get(cellKey(ci + di, cj + dj));
        if (!pts) continue;
        for (let k = 0; k < pts.length; k += 2) {
          const d = Math.hypot(pts[k] - x, pts[k + 1] - z);
          if (d < STALL_RADIUS) sum += 1 - (0.6 * d) / STALL_RADIUS;
        }
      }
    }
    return Math.min(1, sum / STALLS_FULL);
  }

  // Returns the shared {rank, market, park, street} object (overwritten by the next call).
  sample(x, z) {
    const o = this.out;
    o.rank = Math.max(maxPoints(this.points.rank, x, z), maxPolys(this.polys.rank, x, z));
    o.market = Math.max(
      maxPoints(this.points.market, x, z),
      maxPolys(this.polys.market, x, z),
      maxLines(this.lines.market, x, z, MALL),
      this._stallDensity(x, z) * STALL_SCALE,
    );
    o.park = maxPolys(this.polys.park, x, z);
    const other = Math.max(o.rank, o.market, o.park);
    o.street = (STREET_FLOOR + (1 - STREET_FLOOR) * this.cbdAt(x, z)) * (1 - 0.85 * other);
    return o;
  }
}

function cellKey(i, j) {
  return (i + 4096) * 8192 + (j + 4096);
}

function bounds(pts, margin) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minZ = Math.min(minZ, pts[i + 1]);
    maxZ = Math.max(maxZ, pts[i + 1]);
  }
  return { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };
}

function poly(pts, rout) {
  return { pts, rout, ...bounds(pts, rout) };
}

function line(pts, rout) {
  return { pts, ...bounds(pts, rout) };
}

// Distance from (x, z) to the nearest edge of a flat [x0, z0, x1, z1, ...] polyline (closed = ring).
function edgeDist(pts, x, z, closed) {
  let best = Infinity;
  const n = pts.length;
  const last = closed ? n : n - 2;
  for (let i = 0; i < last; i += 2) {
    const j = (i + 2) % n;
    const c = closestOnSegment(x, z, pts[i], pts[i + 1], pts[j], pts[j + 1]);
    if (c.d2 < best) best = c.d2;
  }
  return Math.sqrt(best);
}

function maxPoints(list, x, z) {
  let w = 0;
  for (const p of list) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d >= p.rout) continue;
    w = Math.max(w, fade(d, p.rin, p.rout) * (p.scale ?? 1));
  }
  return w;
}

function maxPolys(list, x, z) {
  let w = 0;
  for (const a of list) {
    if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) continue;
    if (pointInPoly(x, z, a.pts)) return 1;
    w = Math.max(w, fade(edgeDist(a.pts, x, z, true), 0, a.rout));
  }
  return w;
}

function maxLines(list, x, z, spec) {
  let w = 0;
  for (const l of list) {
    if (x < l.minX || x > l.maxX || z < l.minZ || z > l.maxZ) continue;
    w = Math.max(w, fade(edgeDist(l.pts, x, z, false), spec.rin, spec.rout) * (spec.scale ?? 1));
  }
  return w;
}
