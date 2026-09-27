import { pointInPoly, polyArea } from '../core/geo.js';
import { Vehicle } from './vehicle.js';

// Kombi culture: rank stops on the kerbside lanes next to every rank (moving kombis pull in there to
// load), rows of parked kombis filling the rank yards with their hwindi touting outside, and the calls
// themselves — a speech bubble plus a hoot when the player is within earshot.

const CALL_RANGE = 40;
const RANK_KERB_RANGE = 70;
const PARKED_RANGE = 460;
const LOAD_KINDS = new Set(['seats', 'board', 'fare', 'cant', 'dest']);

export class KombiLife {
  constructor(traffic) {
    this.traffic = traffic;
    this.ranks = [];
    this.parked = [];
    this.near = [];
    this._scan = 0;
    this._cd = 0;
  }

  setup(maxParked) {
    const { game, graph, rng, mix, models } = this.traffic;
    const data = game.data;
    for (const r of data.ranks || []) {
      if (this.ranks.some((q) => Math.hypot(q.x - r.x, q.z - r.z) < 40)) continue;
      this.ranks.push({ name: r.name, x: r.x, z: r.z });
    }
    this.loadCalls = mix.calls.filter((c) => LOAD_KINDS.has(c.kind));
    this.driveCalls = mix.calls.filter((c) => c.kind === 'dest' || c.kind === 'depart');
    const kombiDef = mix.types.find((t) => t.type === 'kombi');

    for (const rank of this.ranks) {
      this._kerbStops(rank, graph);
      if (!kombiDef) continue;
      const area = this._rankArea(rank, data.areas || []);
      if (!area) continue;
      const budget = Math.min(maxParked - this.parked.length, Math.round(Math.sqrt(polyArea(area.pts)) * 0.35));
      for (const spot of this._bays(area, data.areas, graph, game.world, rng).slice(0, Math.max(0, budget))) {
        const v = new Vehicle();
        mix.dress(v, kombiDef, rng, models);
        v.parked = true;
        v.position.set(spot.x, 0, spot.z);
        v.heading = spot.heading;
        v.odo = rng() * 10;
        v.hwindi = rng() < 0.6;
        v.callT = rng.range(1, 14);
        this.parked.push(v);
      }
    }
  }

  // Loading bays on the kerbside lanes of the streets around a rank.
  _kerbStops(rank, graph) {
    const tmp = { s: 0, d2: 0 };
    const seen = new Set();
    const cands = [];
    for (const lane of graph.lanes) {
      if (lane.laneIndex !== 0 || lane.length < 30) continue;
      const p = lane.pts;
      if (Math.abs(p[0] - rank.x) > 400 && Math.abs(p[p.length - 2] - rank.x) > 400) continue;
      lane.project(rank.x, rank.z, tmp);
      if (tmp.d2 < RANK_KERB_RANGE * RANK_KERB_RANGE) cands.push({ lane, s: tmp.s, d2: tmp.d2 });
    }
    cands.sort((a, b) => a.d2 - b.d2);
    for (const c of cands) {
      if (seen.size >= 4) break;
      const key = `${c.lane.roadIndex}:${c.lane.dir}`;
      if (seen.has(key)) continue;
      seen.add(key);
      c.lane.stops.push({ s: Math.max(12, Math.min(c.lane.length - 14, c.s)), rank });
    }
  }

  _rankArea(rank, areas) {
    let best = null;
    let bestScore = Infinity;
    for (const a of areas) {
      if (a.kind !== 'rank' && a.kind !== 'platform') continue;
      const area = polyArea(a.pts);
      if (area < 400) continue;
      let cx = 0;
      let cz = 0;
      const n = a.pts.length / 2;
      for (let i = 0; i < n; i++) {
        cx += a.pts[i * 2] / n;
        cz += a.pts[i * 2 + 1] / n;
      }
      const inside = pointInPoly(rank.x, rank.z, a.pts);
      const d = inside ? 0 : Math.hypot(cx - rank.x, cz - rank.z);
      if (d > 80) continue;
      const score = d - (a.name && rank.name.startsWith(a.name.split(' ')[0]) ? 50 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  // Rows of kombi-sized bays aligned with the yard's longest edge, clear of buildings, roads and islands.
  _bays(area, areas, graph, world, rng) {
    const pts = area.pts;
    const n = pts.length / 2;
    let ax = 1;
    let az = 0;
    let longest = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = pts[j * 2] - pts[i * 2];
      const ez = pts[j * 2 + 1] - pts[i * 2 + 1];
      const l = Math.hypot(ex, ez);
      if (l > longest) {
        longest = l;
        ax = ex / l;
        az = ez / l;
      }
    }
    const bx = -az;
    const bz = ax;
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = pts[i * 2] * ax + pts[i * 2 + 1] * az;
      const b = pts[i * 2] * bx + pts[i * 2 + 1] * bz;
      minA = Math.min(minA, a);
      maxA = Math.max(maxA, a);
      minB = Math.min(minB, b);
      maxB = Math.max(maxB, b);
    }
    const islands = areas.filter((q) => q.kind === 'platform' && q !== area && polyArea(q.pts) < 400);
    const free = (x, z) =>
      pointInPoly(x, z, pts) && !world?.buildingAt?.(x, z) && !islands.some((q) => pointInPoly(x, z, q.pts));
    const spots = [];
    for (let b = minB + 2; b < maxB - 1.5; b += 2.7) {
      const flip = rng() < 0.5;
      for (let a = minA + 3; a < maxA - 3; a += 6.4) {
        const x = a * ax + b * bx;
        const z = a * az + b * bz;
        if (rng() > 0.7) continue;
        if (!free(x, z) || !free(x + ax * 2.4, z + az * 2.4) || !free(x - ax * 2.4, z - az * 2.4)) continue;
        if (!free(x + bx * 0.9, z + bz * 0.9) || !free(x - bx * 0.9, z - bz * 0.9)) continue;
        if (graph.nearestLane(x, z, 4.5)) continue;
        const fx = flip ? -ax : ax;
        const fz = flip ? -az : az;
        spots.push({ x, z, heading: Math.atan2(-fx, -fz) });
      }
    }
    // Shuffle so a small budget spreads over the whole yard.
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    return spots;
  }

  nearRank(x, z, r = 300) {
    for (const q of this.ranks) if (Math.abs(q.x - x) < r && Math.abs(q.z - z) < r) return true;
    return false;
  }

  // Parked kombis close enough to draw and to count as traffic.
  refreshNear(focus) {
    this._scan = 0.5;
    this.near.length = 0;
    for (const v of this.parked) {
      if (Math.abs(v.position.x - focus.x) < PARKED_RANGE && Math.abs(v.position.z - focus.z) < PARKED_RANGE) this.near.push(v);
    }
  }

  update(dt, focus) {
    const { rng, bubbles } = this.traffic;
    this._scan -= dt;
    if (this._scan <= 0) this.refreshNear(focus);
    this._cd -= dt;
    this._calls(this.traffic.sim.vehicles, dt, focus, rng, bubbles);
    this._calls(this.near, dt, focus, rng, bubbles);
  }

  _calls(list, dt, focus, rng, bubbles) {
    const r2 = CALL_RANGE * CALL_RANGE;
    for (const v of list) {
      if (v.type !== 'kombi' || !v.hwindi) continue;
      const dx = v.position.x - focus.x;
      const dz = v.position.z - focus.z;
      if (dx * dx + dz * dz > r2) continue;
      v.callT -= dt;
      if (v.callT > 0) continue;
      if (this._cd > 0 || bubbles.active >= 2) {
        v.callT = rng.range(1.5, 4);
        continue;
      }
      v.callT = rng.range(7, 16);
      this._cd = rng.range(1.8, 3.2);
      const loading = v.parked || v.dwell > 0;
      const pool = loading ? this.loadCalls : this.driveCalls;
      const call = rng() < 0.45 || !pool.length ? v.call : rng.pick(pool);
      if (!call) continue;
      bubbles.show(v, call);
      if (!v.parked || rng() < 0.35) this.traffic.honk(v);
    }
  }
}
