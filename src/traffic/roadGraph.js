import { Path, reversed, offsetLeft, trimmed, bezier, polylineDistance } from './polyline.js';
import { laneOffset, allowsDirection, kerbOffset } from '../world/streetMetrics.js';

// Drivable road network built from data.nodes / data.roads: one Lane per lane and direction (keep left),
// trimmed back from every junction, plus curved Connectors across each junction box. Service lanes are left
// out so through traffic never threads parking aisles and back alleys.

export const ROAD_CLASSES = {
  trunk: { rank: 5, weight: 1, speed: 70 },
  primary: { rank: 4, weight: 1, speed: 60 },
  secondary: { rank: 3, weight: 0.9, speed: 60 },
  tertiary: { rank: 2, weight: 0.75, speed: 50 },
  unclassified: { rank: 1, weight: 0.3, speed: 40 },
  residential: { rank: 1, weight: 0.3, speed: 40 },
};

// Two connectors whose paths pass closer than this (metres) cannot be used at the same time: a car's
// width plus the sweep of its corners through a turn.
const CLEARANCE = 2.6;
// Roads shorter than MERGE_MAX whose lanes would shrink below MERGE_SLACK after trimming are folded
// into the junction at either end.
const MERGE_MAX = 16;
const MERGE_SLACK = 4;
const SLOT_SPACING = 18;
export const GRID = 50;

export class Lane extends Path {
  constructor(pts, road, roadIndex, dir, laneIndex, from, to) {
    super(pts);
    this.isLane = true;
    this.road = road;
    this.roadIndex = roadIndex;
    this.dir = dir;
    this.laneIndex = laneIndex;
    this.from = from;
    this.to = to;
    const cls = ROAD_CLASSES[road.cls];
    this.rank = cls.rank;
    this.speedLimit = Math.min(road.speed || cls.speed, 70) / 3.6;
    this.out = [];
    this.siblings = null;
    this.junction = null;
    // Metres of this lane already promised to vehicles committed into it from a junction.
    this.reserved = 0;
    this.stops = [];
    // Vehicles that just changed out of this lane and still overlap it sideways.
    this.ghosts = [];
    this.sink = false;
    this.internal = false;
    this.signal = null;
    this.signalGroup = -1;
    this.priority = 0;
  }
}

export class Connector extends Path {
  constructor(pts, from, to, node, turn) {
    super(pts);
    this.isLane = false;
    this.from = from;
    this.to = to;
    this.node = node;
    this.turn = turn;
    this.local = 0;
    this.speedLimit = 20;
    this.conflictFree = true;
  }
}

export class Junction {
  constructor(node, x, z) {
    this.node = node;
    this.x = x;
    this.z = z;
    this.conns = [];
    this.conflict = null;
    this.requests = [];
    this.occupants = [];
    this.maxRank = 0;
    this.degree = 0;
    this.nodes = [];
    this.ends = [];
  }

  conflicts(a, b) {
    return this.conflict[a.local * this.conns.length + b.local] === 1;
  }
}

function roadDirAt(road, atA) {
  // Unit direction pointing away from the node along the road, measured over the first ~8 m.
  const p = road.pts;
  const n = p.length / 2;
  let ox;
  let oz;
  let i;
  let step;
  if (atA) {
    ox = p[0];
    oz = p[1];
    i = 1;
    step = 1;
  } else {
    ox = p[(n - 1) * 2];
    oz = p[(n - 1) * 2 + 1];
    i = n - 2;
    step = -1;
  }
  let tx = p[i * 2];
  let tz = p[i * 2 + 1];
  while (Math.hypot(tx - ox, tz - oz) < 8 && i + step >= 0 && i + step < n) {
    i += step;
    tx = p[i * 2];
    tz = p[i * 2 + 1];
  }
  const l = Math.hypot(tx - ox, tz - oz) || 1;
  return { x: (tx - ox) / l, z: (tz - oz) / l };
}

// Trim for one road end so its lanes stop clear of every other road meeting it.
function endTrim(e, ends) {
  let t = ends.length === 1 ? Math.max(3, e.road.w * 0.5) : 1.2;
  for (const o of ends) {
    if (o === e) continue;
    const cos = e.dir.x * o.dir.x + e.dir.z * o.dir.z;
    if (cos < -0.94) continue;
    const sin = Math.max(0.35, Math.abs(e.dir.x * o.dir.z - e.dir.z * o.dir.x));
    t = Math.max(t, 1.2 + (o.road.w / 2 + (e.road.w / 2) * Math.max(0, cos)) / sin);
  }
  return t;
}

function turnKind(angle) {
  const a = Math.abs(angle);
  if (a > 2.6) return 'uturn';
  if (a < 0.6) return 'straight';
  // Negative cross product (x east, z south) = turning left.
  return angle < 0 ? 'left' : 'right';
}

export class RoadGraph {
  constructor(data) {
    this.data = data;
    this.nodes = data.nodes;
    this.lanes = [];
    this.connectors = [];
    // Node index -> Junction (several nodes share one when they were merged); junctionList has each once.
    this.junctions = new Array(data.nodes.length).fill(null);
    this.junctionList = [];
    this.slots = [];
    this.slotGrid = new Map();
    this._build();
  }

  _build() {
    const { roads, nodes } = this.data;
    const drivable = (r) => ROAD_CLASSES[r.cls] && r.len >= 1;
    const endsAt = (keyOf) => {
      const incident = new Map();
      roads.forEach((r, ri) => {
        if (!drivable(r)) return;
        const ka = keyOf(r.a);
        const kb = keyOf(r.b);
        if (ka === kb) return;
        for (const [node, atA, key] of [[r.a, true, ka], [r.b, false, kb]]) {
          if (!incident.has(key)) incident.set(key, []);
          incident.get(key).push({ road: r, ri, atA, node, dir: roadDirAt(r, atA) });
        }
      });
      return incident;
    };

    // Crossings mapped as several nodes a few metres apart become one junction box, so no vehicle ever
    // waits on a sliver of road that lies inside another junction.
    const parent = Int32Array.from(nodes, (_, i) => i);
    const find = (n) => {
      while (parent[n] !== n) {
        parent[n] = parent[parent[n]];
        n = parent[n];
      }
      return n;
    };
    const raw = new Map();
    for (const ends of endsAt((n) => n).values()) for (const e of ends) raw.set(`${e.ri}:${e.atA ? 'a' : 'b'}`, endTrim(e, ends));
    roads.forEach((r, ri) => {
      if (!drivable(r) || r.len > MERGE_MAX) return;
      if (r.len - raw.get(`${ri}:a`) - raw.get(`${ri}:b`) < MERGE_SLACK) parent[find(r.a)] = find(r.b);
    });
    const incident = endsAt(find);

    // How far each road end is pulled back from its node so turning paths fit inside the junction box.
    const trim = new Map();
    const byKey = new Map();
    for (const [key, ends] of incident) {
      const members = [...new Set(ends.map((e) => e.node))];
      let x = 0;
      let z = 0;
      for (const n of members) {
        x += nodes[n][0] / members.length;
        z += nodes[n][1] / members.length;
      }
      const j = new Junction(key, x, z);
      j.nodes = members;
      j.ends = ends;
      j.degree = ends.length;
      for (const e of ends) j.maxRank = Math.max(j.maxRank, ROAD_CLASSES[e.road.cls].rank);
      for (const n of members) this.junctions[n] = j;
      this.junctionList.push(j);
      byKey.set(key, j);
      for (const e of ends) trim.set(`${e.ri}:${e.atA ? 'a' : 'b'}`, Math.min(endTrim(e, ends), 24, e.road.len * 0.42));
    }

    // Lanes.
    const groups = new Map(); // `${ri}:${dir}` -> [lanes by index]
    roads.forEach((r, ri) => {
      if (!drivable(r) || find(r.a) === find(r.b)) return;
      const perDir = Math.max(1, r.lanes || 1);
      for (const dir of [1, -1]) {
        if (!allowsDirection(r, dir)) continue;
        const base = dir === 1 ? r.pts : reversed(r.pts);
        const from = dir === 1 ? r.a : r.b;
        const to = dir === 1 ? r.b : r.a;
        const t0 = trim.get(`${ri}:${dir === 1 ? 'a' : 'b'}`);
        const t1 = trim.get(`${ri}:${dir === 1 ? 'b' : 'a'}`);
        const list = [];
        for (let li = 0; li < perDir; li++) {
          const pts = trimmed(offsetLeft(Float32Array.from(base), laneOffset(r, li)), t0, t1);
          const lane = new Lane(pts, r, ri, dir, li, from, to);
          lane.index = this.lanes.length;
          lane.junction = this.junctions[to];
          lane.kerbSpace = Math.max(0, kerbOffset(r) - Math.abs(laneOffset(r, 0)));
          this.lanes.push(lane);
          list.push(lane);
        }
        for (const l of list) l.siblings = list;
        groups.set(`${ri}:${dir}`, list);
      }
    });

    // Connectors, junction by junction.
    for (const [key, ends] of incident) {
      const j = byKey.get(key);
      const ins = [];
      const outs = [];
      for (const e of ends) {
        const dirIn = e.atA ? -1 : 1;
        const g = groups.get(`${e.ri}:${dirIn}`);
        if (g) ins.push(g);
        const go = groups.get(`${e.ri}:${-dirIn}`);
        if (go) outs.push(go);
      }
      for (const inG of ins) {
        const inRank = inG[0].rank;
        for (const l of inG) l.priority = inRank >= j.maxRank ? 1 : 0;
        // U-turns (back along the same road, or a hairpin onto the other carriageway) only where
        // there is no other way out.
        const options = [];
        const hairpins = [];
        for (const outG of outs) {
          const a = inG[0];
          const b = outG[0];
          const ax = a.pts[a.pts.length - 2] - a.pts[a.pts.length - 4];
          const az = a.pts[a.pts.length - 1] - a.pts[a.pts.length - 3];
          const bx = b.pts[2] - b.pts[0];
          const bz = b.pts[3] - b.pts[1];
          const turn = b.roadIndex === a.roadIndex ? 'uturn' : turnKind(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
          (turn === 'uturn' ? hairpins : options).push({ outG, turn });
        }
        if (!options.length) options.push(...hairpins);
        const only = options.length === 1;
        const linked = new Set();
        for (const { outG, turn } of options) {
          const nIn = inG.length;
          const nOut = outG.length;
          const pairs = [];
          if (only || turn === 'straight' || turn === 'uturn') {
            for (let i = 0; i < nIn; i++) pairs.push([i, Math.min(i, nOut - 1)]);
          } else if (turn === 'left') {
            pairs.push([0, 0]);
          } else {
            pairs.push([nIn - 1, nOut - 1]);
          }
          for (const [i, o] of pairs) {
            this._connect(j, inG[i], outG[o], only && turn !== 'uturn' ? 'straight' : turn);
            linked.add(i);
          }
        }
        // A lane left without any exit (e.g. the middle lane at a T) may use every exit.
        for (let i = 0; i < inG.length; i++) {
          if (linked.has(i)) continue;
          for (const { outG, turn } of options) this._connect(j, inG[i], outG[Math.min(i, outG.length - 1)], turn);
        }
      }
      this._conflicts(j);
    }

    for (const l of this.lanes) l.sink = l.out.length === 0;
    this._slots();
  }

  _connect(j, from, to, turn) {
    const fp = from.pts;
    const n = fp.length;
    const p0x = fp[n - 2];
    const p0z = fp[n - 1];
    let d0x = p0x - fp[n - 4];
    let d0z = p0z - fp[n - 3];
    let l = Math.hypot(d0x, d0z) || 1;
    d0x /= l;
    d0z /= l;
    const tp = to.pts;
    const p3x = tp[0];
    const p3z = tp[1];
    let d3x = tp[2] - p3x;
    let d3z = tp[3] - p3z;
    l = Math.hypot(d3x, d3z) || 1;
    d3x /= l;
    d3z /= l;
    const chord = Math.hypot(p3x - p0x, p3z - p0z);
    const phi = Math.abs(Math.atan2(d0x * d3z - d0z * d3x, d0x * d3x + d0z * d3z));
    // Handle length of a circular-arc Bézier: 4/3·tan(φ/4)·R with R = chord / (2·sin(φ/2)).
    let k = phi < 0.05 ? chord / 3 : ((4 / 3) * Math.tan(phi / 4) * chord) / (2 * Math.sin(phi / 2));
    if (turn === 'uturn') k = Math.max(k, 3);
    const segs = Math.max(3, Math.min(14, Math.ceil(chord / 1.5)));
    const c = new Connector(bezier(p0x, p0z, d0x, d0z, p3x, p3z, d3x, d3z, k, segs), from, to, j.node, turn);
    c.speedLimit = Math.min(from.speedLimit, to.speedLimit, cornerSpeed(c.pts));
    c.local = j.conns.length;
    c.index = this.connectors.length;
    j.conns.push(c);
    from.out.push(c);
    this.connectors.push(c);
  }

  _conflicts(j) {
    const n = j.conns.length;
    j.conflict = new Uint8Array(n * n);
    for (let a = 0; a < n; a++) {
      const ca = j.conns[a];
      for (let b = a + 1; b < n; b++) {
        const cb = j.conns[b];
        if (ca.from === cb.from) continue;
        const hit = ca.to === cb.to || polylineDistance(ca.pts, cb.pts, CLEARANCE) < CLEARANCE;
        if (!hit) continue;
        j.conflict[a * n + b] = 1;
        j.conflict[b * n + a] = 1;
        ca.conflictFree = false;
        cb.conflictFree = false;
      }
    }
  }

  // Candidate spawn points every SLOT_SPACING metres along every lane, bucketed on a grid.
  _slots() {
    for (const lane of this.lanes) {
      if (lane.length < 10 || lane.sink) continue;
      const w = ROAD_CLASSES[lane.road.cls].weight;
      const p = { x: 0, z: 0, dx: 0, dz: 0 };
      for (let s = 5; s < lane.length - 5; s += SLOT_SPACING) {
        lane.sample(s, p);
        const slot = { lane, s, x: p.x, z: p.z, weight: w };
        this.slots.push(slot);
        const k = Math.floor(p.x / GRID) * 100003 + Math.floor(p.z / GRID);
        if (!this.slotGrid.has(k)) this.slotGrid.set(k, []);
        this.slotGrid.get(k).push(slot);
      }
    }
  }

  slotsInCell(gx, gz) {
    return this.slotGrid.get(gx * 100003 + gz);
  }

  // Nearest lane (optionally filtered) to a point: {lane, s, dist} or null.
  nearestLane(x, z, maxDist, filter) {
    let best = null;
    let bestD2 = maxDist * maxDist;
    const tmp = { s: 0, d2: 0 };
    for (let gx = Math.floor((x - maxDist) / GRID); gx <= Math.floor((x + maxDist) / GRID); gx++) {
      for (let gz = Math.floor((z - maxDist) / GRID); gz <= Math.floor((z + maxDist) / GRID); gz++) {
        const cell = this.slotsInCell(gx, gz);
        if (!cell) continue;
        for (const slot of cell) {
          if (filter && !filter(slot.lane)) continue;
          slot.lane.project(x, z, tmp);
          if (tmp.d2 < bestD2) {
            bestD2 = tmp.d2;
            best = { lane: slot.lane, s: tmp.s, dist: Math.sqrt(tmp.d2) };
          }
        }
      }
    }
    return best;
  }

  // Incoming lanes of `node` that come from `fromNode`.
  lanesInto(node, fromNode) {
    const j = this.junctions[node];
    if (!j) return [];
    const out = [];
    for (const c of j.conns) if (c.from.from === fromNode && !out.includes(c.from)) out.push(c.from);
    return out;
  }
}

// Comfortable cornering speed (m/s) from the tightest bend of a sampled path.
function cornerSpeed(pts) {
  let minR = Infinity;
  for (let i = 2; i + 3 < pts.length; i += 2) {
    const ax = pts[i] - pts[i - 2];
    const az = pts[i + 1] - pts[i - 1];
    const bx = pts[i + 2] - pts[i];
    const bz = pts[i + 3] - pts[i + 1];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < 1e-4 || lb < 1e-4) continue;
    const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
    if (turn < 1e-3) continue;
    minR = Math.min(minR, (la + lb) / 2 / turn);
  }
  return Math.max(3, Math.sqrt(2.6 * minR));
}
