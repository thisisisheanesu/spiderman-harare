import { sidewalkWidth, sidewalkCenterOffset, KERB_HEIGHT } from '../world/streetMetrics.js';
import { closestOnSegment } from '../core/geo.js';

// Pedestrian network: a graph of straight edges covering both pavements of every road that has one,
// zebra crossings at junctions, pedestrian streets (First Street Mall), park footways and the short
// links between them. Every edge is validated against the building footprints and the carriageways,
// and carries a lateral "spread" (how far walkers may drift from its centreline and still be on the
// pavement), so agents that stay within it never enter a building or step onto the road.
//
// Edge kinds.
export const WALK = 0; // pavement along a road
export const CROSS = 1; // crossing a carriageway (at a junction, or where a path meets a road)
export const PATH = 2; // pedestrian street / footway / park path
export const LINK = 3; // connector between pavement corners and paths

const SAMPLE = 1.5; // validation step along pavements and paths (m)
const CELL = 40; // spatial grid for edges and carriageway segments
const MAX_EDGE = 16;
const BODY = 0.3; // clearance kept from walls and kerbs

const PATH_CLASSES = { pedestrian: 3.2, footway: 1.1, path: 0.5, steps: 0.4 };

function gridKey(gx, gz) {
  return gx * 100003 + gz;
}

// Carriageway lookup (service lanes excluded: pedestrians walk across driveways and lanes).
class Carriageways {
  constructor(roads) {
    this.roads = roads;
    this.grid = new Map();
    roads.forEach((r, ri) => {
      if (r.cls === 'service') return;
      const p = r.pts;
      const pad = r.w / 2 + sidewalkWidth(r) + 1;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const x0 = Math.floor((Math.min(p[i], p[i + 2]) - pad) / CELL);
        const x1 = Math.floor((Math.max(p[i], p[i + 2]) + pad) / CELL);
        const z0 = Math.floor((Math.min(p[i + 1], p[i + 3]) - pad) / CELL);
        const z1 = Math.floor((Math.max(p[i + 1], p[i + 3]) + pad) / CELL);
        for (let gx = x0; gx <= x1; gx++) {
          for (let gz = z0; gz <= z1; gz++) {
            const k = gridKey(gx, gz);
            let arr = this.grid.get(k);
            if (!arr) this.grid.set(k, (arr = []));
            arr.push(ri, i);
          }
        }
      }
    });
  }

  // Index of a road whose carriageway (plus margin) covers (x, z), or -1.
  at(x, z, margin = 0) {
    const arr = this.grid.get(gridKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!arr) return -1;
    for (let k = 0; k < arr.length; k += 2) {
      const r = this.roads[arr[k]];
      const p = r.pts;
      const i = arr[k + 1];
      const half = r.w / 2 + margin;
      const ax = p[i];
      const az = p[i + 1];
      const dx = p[i + 2] - ax;
      const dz = p[i + 3] - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - ax - dx * t;
      const ez = z - az - dz * t;
      if (ex * ex + ez * ez < half * half) return arr[k];
    }
    return -1;
  }

  // Surface height at (x, z): raised pavement beside a road that has one, else the flat ground.
  groundY(x, z) {
    const arr = this.grid.get(gridKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!arr) return 0;
    let kerb = false;
    for (let k = 0; k < arr.length; k += 2) {
      const r = this.roads[arr[k]];
      const p = r.pts;
      const i = arr[k + 1];
      const c = closestOnSegment(x, z, p[i], p[i + 1], p[i + 2], p[i + 3]);
      const d = Math.sqrt(c.d2);
      if (d < r.w / 2) return 0;
      if (d < r.w / 2 + sidewalkWidth(r)) kerb = true;
    }
    return kerb ? KERB_HEIGHT : 0;
  }
}

// Unit direction of a road leaving node `atA ? a : b`, measured over the first few metres.
function endDirection(road, atA) {
  const p = road.pts;
  const n = p.length / 2;
  const x0 = atA ? p[0] : p[(n - 1) * 2];
  const z0 = atA ? p[1] : p[(n - 1) * 2 + 1];
  let dx = 0;
  let dz = 0;
  for (let k = 1; k < n; k++) {
    const i = atA ? k : n - 1 - k;
    dx = p[i * 2] - x0;
    dz = p[i * 2 + 1] - z0;
    if (dx * dx + dz * dz > 16) break;
  }
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

// Arc-length parameterised polyline of a road's centreline.
function polyline(pts) {
  const n = pts.length / 2;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  }
  return { pts, n, cum, len: cum[n - 1] };
}

// Point and left normal (of the a→b direction) at arc length t.
function sampleAt(pl, t, out) {
  const { pts, n, cum } = pl;
  let i = 0;
  while (i < n - 2 && cum[i + 1] < t) i++;
  const segLen = cum[i + 1] - cum[i] || 1;
  const f = Math.max(0, Math.min(1, (t - cum[i]) / segLen));
  const ax = pts[i * 2];
  const az = pts[i * 2 + 1];
  const dx = pts[i * 2 + 2] - ax;
  const dz = pts[i * 2 + 3] - az;
  const l = Math.hypot(dx, dz) || 1;
  out.x = ax + dx * f;
  out.z = az + dz * f;
  out.nx = dz / l;
  out.nz = -dx / l;
  return out;
}

export class Walkways {
  constructor(world, data) {
    this.world = world;
    this.data = data;
    this.roads = data.roads;
    this.carriage = new Carriageways(data.roads);
    this.nodes = []; // {x, z, y, edges: [edge index]}
    this.edges = []; // see _addEdge
    this.grid = new Map();
    this._s = { x: 0, z: 0, nx: 0, nz: 0 };
  }

  // Heavy one-off build, split into chunks so the loading screen keeps repainting.
  async build(yieldFn) {
    this.activity = this._activityField();
    this._roadEnds();
    let i = 0;
    for (const r of this.roads) {
      this._roadSides(r, i++);
      if (yieldFn && i % 300 === 0) await yieldFn();
    }
    this._junctions();
    this._paths();
    this._linkDeadEnds();
    this._validate();
    this._prune();
    this._finish();
  }

  groundY(x, z) {
    return this.carriage.groundY(x, z);
  }

  free(x, z) {
    return !this.world.buildingAt(x, z) && this.carriage.at(x, z, 0.05) < 0;
  }

  // Pedestrian activity per 40 m cell: named businesses, dense-core buildings and kombi ranks.
  _activityField() {
    const cnt = new Map();
    const add = (x, z, w) => {
      const k = gridKey(Math.floor(x / CELL), Math.floor(z / CELL));
      cnt.set(k, (cnt.get(k) || 0) + w);
    };
    for (const p of this.data.pois || []) add(p.x, p.z, 1);
    for (const b of this.data.buildings) if (b.core) add(b.cx ?? b.fp[0], b.cz ?? b.fp[1], 0.6);
    const ranks = this.data.ranks || [];
    return (x, z) => {
      const gx = Math.floor(x / CELL);
      const gz = Math.floor(z / CELL);
      let s = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) s += cnt.get(gridKey(gx + dx, gz + dz)) || 0;
      let a = 0.12 + Math.min(1, s / 28) * 0.88;
      for (const rk of ranks) {
        const d = Math.hypot(rk.x - x, rk.z - z);
        if (d < 110) a += 0.8 * (1 - d / 110);
      }
      return a;
    };
  }

  _node(x, z, y) {
    const id = this.nodes.length;
    this.nodes.push({ x, z, y, edges: [] });
    return id;
  }

  _addEdge(a, b, kind, spread, extra) {
    if (a === b) return -1;
    const na = this.nodes[a];
    const nb = this.nodes[b];
    const len = Math.hypot(nb.x - na.x, nb.z - na.z);
    if (len < 0.05) return -1;
    const e = {
      a,
      b,
      len,
      kind,
      spread: Math.max(0, spread),
      density: 0,
      road: -1, // crossings: the road being crossed
      jn: -1, // crossings at junctions: road-graph node and the far node of the crossed road
      from: -1,
      kerb: 0, // crossings: length at each end that is still pavement
      ...extra,
    };
    const id = this.edges.length;
    this.edges.push(e);
    na.edges.push(id);
    nb.edges.push(id);
    return id;
  }

  // Road ends grouped per road-graph node, sorted by angle, for roads that have pavements.
  _roadEnds() {
    this.ends = new Map();
    this.roads.forEach((r, ri) => {
      if (sidewalkWidth(r) <= 0 || r.len < 2) return;
      for (const atA of [true, false]) {
        const node = atA ? r.a : r.b;
        const d = endDirection(r, atA);
        const end = { road: ri, atA, node, dx: d.x, dz: d.z, ang: Math.atan2(d.z, d.x), o: sidewalkCenterOffset(r), trim: [0, 0], cornerNode: [-1, -1] };
        if (!this.ends.has(node)) this.ends.set(node, []);
        this.ends.get(node).push(end);
      }
    });
    // Corner point of each wedge between angularly adjacent ends. side +1 of an end faces the next
    // end (increasing angle), side -1 the previous one. Normal of side +1 is (-dz, dx).
    this.corners = [];
    for (const [node, list] of this.ends) {
      list.sort((p, q) => p.ang - q.ang);
      const nx = this.data.nodes[node][0];
      const nz = this.data.nodes[node][1];
      const k = list.length;
      for (let i = 0; i < k; i++) {
        const A = list[i];
        const B = list[(i + 1) % k];
        let wedge = B.ang - A.ang;
        if (k === 1 || wedge <= 0) wedge += Math.PI * 2;
        const pax = nx - A.dz * A.o;
        const paz = nz + A.dx * A.o;
        const pbx = nx + B.dz * B.o;
        const pbz = nz - B.dx * B.o;
        const maxA = Math.min(22, this.roads[A.road].len * 0.45);
        const maxB = Math.min(22, this.roads[B.road].len * 0.45);
        let cx;
        let cz;
        let ta = 0;
        let tb = 0;
        if (k === 1) {
          // Dead end: each side just ends at the node.
          A.cornerNode[1] = this._cornerAt(pax, paz, 0, nx, nz);
          A.cornerNode[0] = this._cornerAt(pbx, pbz, 0, nx, nz);
          continue;
        }
        if (wedge < Math.PI - 0.12) {
          // Inside corner: intersect the two pavement centrelines.
          const det = -A.dx * B.dz + B.dx * A.dz;
          const rx = pbx - pax;
          const rz = pbz - paz;
          ta = (rx * -B.dz + B.dx * rz) / det;
          tb = (A.dx * rz - A.dz * rx) / det;
          ta = Math.max(0, Math.min(maxA, ta));
          tb = Math.max(0, Math.min(maxB, tb));
          cx = (pax + A.dx * ta + pbx + B.dx * tb) / 2;
          cz = (paz + A.dz * ta + pbz + B.dz * tb) / 2;
        } else if (wedge > Math.PI + 0.12) {
          // Outside of a bend: round the corner through a point on the bisector.
          let bx = -A.dz - B.dz;
          let bz = A.dx + B.dx;
          const bl = Math.hypot(bx, bz) || 1;
          bx /= bl;
          bz /= bl;
          const o = Math.max(A.o, B.o);
          cx = nx + bx * o;
          cz = nz + bz * o;
        } else {
          cx = (pax + pbx) / 2;
          cz = (paz + pbz) / 2;
        }
        if (!this.free(cx, cz)) {
          // The corner building reaches into the pavement: cut the corner along the kerbs instead.
          const f = Math.min((this.roads[A.road].w / 2 + 0.55) / A.o, (this.roads[B.road].w / 2 + 0.55) / B.o);
          cx = nx + (cx - nx) * f;
          cz = nz + (cz - nz) * f;
          ta *= f;
          tb *= f;
        }
        A.trim[1] = ta;
        B.trim[0] = tb;
        const c = this._cornerAt(cx, cz, wedge, nx, nz);
        A.cornerNode[1] = c;
        B.cornerNode[0] = c;
      }
    }
  }

  _cornerAt(x, z, wedge, jx, jz) {
    if (!this.free(x, z)) return -1;
    const id = this._node(x, z, KERB_HEIGHT);
    Object.assign(this.nodes[id], { corner: wedge, jx, jz });
    this.corners.push(id);
    return id;
  }

  // Pavement on both sides of a road: validated samples, grouped into runs, emitted as edge chains
  // that join the junction corners.
  _roadSides(r, ri) {
    const sw = sidewalkWidth(r);
    if (sw <= 0 || r.len < 2) return;
    const endA = this.ends.get(r.a)?.find((e) => e.road === ri && e.atA);
    const endB = this.ends.get(r.b)?.find((e) => e.road === ri && !e.atA);
    if (!endA || !endB) return;
    const pl = polyline(r.pts);
    const oc = sidewalkCenterOffset(r);
    const kerbHug = r.w / 2 + 0.55;
    const hFull = Math.max(0.2, sw / 2 - BODY);
    const busy = r.cls === 'residential' || r.cls === 'unclassified' ? 0.55 : 1;
    const s = this._s;
    // Road side +1 = left of a→b. At node a that is the end's side -1 (index 0), at node b side +1 (index 1).
    for (const side of [1, -1]) {
      const ia = side === 1 ? 0 : 1;
      const ib = side === 1 ? 1 : 0;
      const t0 = endA.trim[ia];
      const t1 = pl.len - endB.trim[ib];
      if (t1 - t0 < 1) continue;
      // Crossing points sit just beyond the corner so the zebra is at the mouth of the junction.
      const tcA = Math.max(endA.trim[0], endA.trim[1]) + 1.2;
      const tcB = pl.len - Math.max(endB.trim[0], endB.trim[1]) - 1.2;
      const ts = [t0, t1];
      for (let t = t0 + SAMPLE; t < t1 - SAMPLE * 0.5; t += SAMPLE) ts.push(t);
      if (tcA > t0 + 0.3 && tcA < t1 - 0.3) ts.push(tcA);
      if (tcB > t0 + 0.3 && tcB < t1 - 0.3) ts.push(tcB);
      ts.sort((p, q) => p - q);
      const samples = ts.map((t) => {
        sampleAt(pl, t, s);
        const nx = s.nx * side;
        const nz = s.nz * side;
        // A pavement whose far edge runs into another carriageway is a median strip: nobody walks there.
        const beyond = oc + sw / 2 + 4.5;
        if (this.carriage.at(s.x + nx * beyond, s.z + nz * beyond, 0) >= 0) return null;
        let off = oc;
        let h = hFull;
        if (!this._bandFree(s.x, s.z, nx, nz, off, h)) {
          off = kerbHug;
          h = 0.15;
          if (!this._bandFree(s.x, s.z, nx, nz, off, h)) return null;
        }
        return { t, x: s.x + nx * off, z: s.z + nz * off, off, h, cross: t === tcA ? endA : t === tcB ? endB : null };
      });
      this._emitRuns(samples, WALK, KERB_HEIGHT, (x, z) => busy * this.activity(x, z), { road: ri, side }, (first, last, j, k, nodeOf) => {
        if (samples[j].t - t0 < 6) this._join(endA.cornerNode[ia], first);
        if (t1 - samples[k].t < 6) this._join(last, endB.cornerNode[ib]);
        for (let i = j; i <= k; i++) {
          const c = samples[i].cross;
          if (!c) continue;
          c.crossNode = c.crossNode || [-1, -1];
          c.crossNode[c === endA ? ia : ib] = nodeOf(i);
        }
      });
    }
  }

  // Turn an array of samples ({x, z, h, off?, cross?} or null where blocked) into chains of edges.
  // A node is emitted at run ends, at flagged samples, where the offset or direction changes and at
  // least every MAX_EDGE metres; each edge's spread is the narrowest band among its samples.
  _emitRuns(samples, kind, y, densityAt, props, onRun) {
    let j = 0;
    while (j < samples.length) {
      if (!samples[j]) {
        j++;
        continue;
      }
      let k = j;
      while (k + 1 < samples.length && samples[k + 1]) k++;
      if (k > j) {
        const ids = new Map();
        let prevI = j;
        let spread = samples[j].h;
        ids.set(j, this._node(samples[j].x, samples[j].z, y));
        let acc = 0;
        for (let i = j + 1; i <= k; i++) {
          const p = samples[i];
          const q = samples[i - 1];
          spread = Math.min(spread, p.h);
          acc += Math.hypot(p.x - q.x, p.z - q.z);
          let brk = i === k || p.cross || p.mark || acc >= MAX_EDGE;
          if (!brk && p.off !== undefined && Math.abs(p.off - q.off) > 0.01) brk = true;
          if (!brk) {
            const n = samples[i + 1];
            const ax = p.x - q.x;
            const az = p.z - q.z;
            const bx = n.x - p.x;
            const bz = n.z - p.z;
            const cos = (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1);
            brk = cos < 0.998;
          }
          if (!brk) continue;
          const id = this._node(p.x, p.z, y);
          ids.set(i, id);
          const a = samples[prevI];
          this._addEdge(ids.get(prevI), id, kind, spread, { ...props, density: densityAt((a.x + p.x) / 2, (a.z + p.z) / 2) });
          prevI = i;
          spread = p.h;
          acc = 0;
        }
        onRun?.(ids.get(j), ids.get(k), j, k, (i) => ids.get(i) ?? -1);
      }
      j = k + 1;
    }
  }

  // Band test across a pavement: centre and both edges must be clear of buildings and carriageways.
  _bandFree(x, z, nx, nz, off, h) {
    const e = h + BODY * 0.8;
    return (
      this.free(x + nx * off, z + nz * off) &&
      this.free(x + nx * (off - e), z + nz * (off - e)) &&
      this.free(x + nx * (off + e), z + nz * (off + e))
    );
  }

  // Link two nodes if the straight line between them is clear.
  _join(a, b) {
    if (a < 0 || b < 0 || a === b) return -1;
    const na = this.nodes[a];
    const nb = this.nodes[b];
    if (Math.hypot(na.x - nb.x, na.z - nb.z) < 0.3) {
      this._merge(a, b);
      return -1;
    }
    if (this._segmentHitsBuilding(na.x, na.z, nb.x, nb.z)) return -1;
    return this._addEdge(a, b, LINK, 0.15, { density: 0.3 });
  }

  // Fold node `drop` into node `keep` (they sit at the same spot).
  _merge(keep, drop) {
    const k = this.nodes[keep];
    for (const ei of this.nodes[drop].edges) {
      const e = this.edges[ei];
      if (e.a === drop) e.a = keep;
      if (e.b === drop) e.b = keep;
      if (e.a === e.b) e.dead = true;
      else k.edges.push(ei);
    }
    this.nodes[drop].edges = [];
    // Anything that referenced the dropped node (crossing endpoints) follows it.
    for (const list of this.ends.values()) {
      for (const end of list) {
        if (end.crossNode?.[0] === drop) end.crossNode[0] = keep;
        if (end.crossNode?.[1] === drop) end.crossNode[1] = keep;
        if (end.cornerNode[0] === drop) end.cornerNode[0] = keep;
        if (end.cornerNode[1] === drop) end.cornerNode[1] = keep;
      }
    }
  }

  // Zebra crossings at junctions with three or more pavement roads.
  _junctions() {
    for (const [node, list] of this.ends) {
      if (list.length < 3) continue;
      for (const e of list) {
        const c = e.crossNode;
        if (!c || c[0] < 0 || c[1] < 0) continue;
        const r = this.roads[e.road];
        const far = e.atA ? r.b : r.a;
        const p = this.nodes[c[0]];
        const q = this.nodes[c[1]];
        if (this._segmentHitsBuilding(p.x, p.z, q.x, q.z)) continue;
        this._addEdge(c[0], c[1], CROSS, 0.6, { road: e.road, jn: node, from: far, kerb: sidewalkWidth(r) / 2 });
      }
    }
  }

  // Pedestrian streets, footways and park paths. Stretches over a carriageway become crossings.
  _paths() {
    const joins = [];
    const s = this._s;
    (this.data.paths || []).forEach((p, pi) => {
      const weight = PATH_CLASSES[p.cls];
      if (!weight || p.pts.length < 4) return;
      const pl = polyline(p.pts);
      const hMax = Math.max(0.3, (p.w || 2) / 2 - 0.5);
      const ts = [];
      for (let t = 0; t < pl.len; t += SAMPLE) ts.push(t);
      ts.push(pl.len);
      // Classify: null = blocked by a building, {road} = over a carriageway, else a walkable sample.
      const samples = ts.map((t) => {
        sampleAt(pl, t, s);
        if (this.world.buildingAt(s.x, s.z)) return null;
        const road = this.carriage.at(s.x, s.z, 0.2);
        if (road >= 0) return { road };
        let h = hMax;
        while (h >= 0.3 && !this._bandFree(s.x, s.z, s.nx, s.nz, 0, h)) h *= 0.5;
        return { x: s.x, z: s.z, h: h >= 0.3 ? h : 0, mark: this._isVertex(pl, t) };
      });
      // Walkable runs become PATH chains; a carriageway stretch between two runs becomes a crossing.
      const walk = samples.map((q) => (q && q.road === undefined ? q : null));
      const runEnds = [];
      this._emitRuns(walk, PATH, 0, (x, z) => weight * this.activity(x, z), { path: pi }, (first, last, j, k) => {
        runEnds.push({ first, last, j, k });
        joins.push(first, last);
      });
      for (let i = 0; i + 1 < runEnds.length; i++) {
        const A = runEnds[i];
        const B = runEnds[i + 1];
        let road = -1;
        let blocked = false;
        for (let m = A.k + 1; m < B.j; m++) {
          if (!samples[m]) blocked = true;
          else if (samples[m].road !== undefined) road = samples[m].road;
        }
        const gap = Math.hypot(this.nodes[A.last].x - this.nodes[B.first].x, this.nodes[A.last].z - this.nodes[B.first].z);
        if (!blocked && road >= 0 && gap < 40) this._addEdge(A.last, B.first, CROSS, 0.8, { road });
      }
    });
    // Tie path ends into the rest of the network (pavements or other paths) by splitting the nearest edge.
    this._buildGrid();
    for (const id of joins) this._linkNearest(id, 14);
  }

  _isVertex(pl, t) {
    const { cum, n } = pl;
    for (let i = 1; i < n - 1; i++) if (Math.abs(cum[i] - t) < SAMPLE * 0.5) return true;
    return false;
  }

  _buildGrid() {
    this.grid.clear();
    this.edges.forEach((e, i) => this._gridInsert(e, i));
  }

  _gridInsert(e, i) {
    const a = this.nodes[e.a];
    const b = this.nodes[e.b];
    for (let gx = Math.floor(Math.min(a.x, b.x) / CELL); gx <= Math.floor(Math.max(a.x, b.x) / CELL); gx++) {
      for (let gz = Math.floor(Math.min(a.z, b.z) / CELL); gz <= Math.floor(Math.max(a.z, b.z) / CELL); gz++) {
        const k = gridKey(gx, gz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(i);
      }
    }
  }

  forEdgesNear(x, z, r, fn) {
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++) {
      for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++) {
        const arr = this.grid.get(gridKey(gx, gz));
        if (!arr) continue;
        for (const i of arr) {
          if (seen.has(i)) continue;
          seen.add(i);
          fn(this.edges[i], i);
        }
      }
    }
  }

  // Nearest point on a walkable edge (not a crossing) within r: {edge, t, x, z, d}.
  nearestEdge(x, z, r, skipNode = -1) {
    let best = null;
    let bestD2 = r * r;
    this.forEdgesNear(x, z, r, (e, i) => {
      if (e.kind === CROSS || e.a === skipNode || e.b === skipNode) return;
      const a = this.nodes[e.a];
      const b = this.nodes[e.b];
      const c = closestOnSegment(x, z, a.x, a.z, b.x, b.z);
      if (c.d2 < bestD2) {
        bestD2 = c.d2;
        best = { edge: i, t: c.t, x: c.x, z: c.z, d: Math.sqrt(c.d2) };
      }
    });
    return best;
  }

  _linkNearest(id, r) {
    const n = this.nodes[id];
    const near = this.nearestEdge(n.x, n.z, r, id);
    if (!near) return;
    const e = this.edges[near.edge];
    let target;
    if (near.t * e.len < 0.8) target = e.a;
    else if ((1 - near.t) * e.len < 0.8) target = e.b;
    else target = this._split(near.edge, near.t);
    if (target === id || this.nodes[id].edges.some((k) => this.edges[k].a === target || this.edges[k].b === target)) return;
    const t = this.nodes[target];
    if (this._segmentHitsBuilding(n.x, n.z, t.x, t.z)) return;
    const road = this._roadAlong(n.x, n.z, t.x, t.z);
    this._addEdge(id, target, road >= 0 ? CROSS : LINK, road >= 0 ? 0.5 : 0.15, { road, density: 0.3 });
  }

  _split(ei, t) {
    const e = this.edges[ei];
    const a = this.nodes[e.a];
    const b = this.nodes[e.b];
    const id = this._node(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, a.y);
    // Shorten e to a→id, add id→b with the same properties.
    const oldB = e.b;
    const nb = this.nodes[oldB];
    nb.edges.splice(nb.edges.indexOf(ei), 1);
    e.b = id;
    e.len = Math.hypot(this.nodes[id].x - a.x, this.nodes[id].z - a.z);
    this.nodes[id].edges.push(ei);
    const { a: _a, b: _b, len: _l, ...props } = e;
    const ni = this._addEdge(id, oldB, e.kind, e.spread, props);
    if (ni >= 0) this._gridInsert(this.edges[ni], ni);
    return id;
  }

  // Pavements that stop short (a building on the corner, a pedestrian plaza at the end of a street)
  // get joined to the closest reachable edge nearby, as a crossing if the link runs over a road.
  _linkDeadEnds() {
    const n0 = this.nodes.length;
    for (let id = 0; id < n0; id++) {
      const node = this.nodes[id];
      if (node.edges.length !== 1) continue;
      const own = this.edges[node.edges[0]];
      const other = own.a === id ? own.b : own.a;
      const cands = [];
      this.forEdgesNear(node.x, node.z, 10, (e, i) => {
        if (e.kind === CROSS || e.dead || e.a === id || e.b === id || e.a === other || e.b === other) return;
        if (own.road >= 0 && e.road === own.road && e.side === own.side) return;
        const a = this.nodes[e.a];
        const b = this.nodes[e.b];
        const c = closestOnSegment(node.x, node.z, a.x, a.z, b.x, b.z);
        if (c.d2 < 100) cands.push({ i, t: c.t, d2: c.d2 });
      });
      cands.sort((p, q) => p.d2 - q.d2);
      for (const c of cands.slice(0, 4)) {
        const e = this.edges[c.i];
        const a = this.nodes[e.a];
        const b = this.nodes[e.b];
        const x = a.x + (b.x - a.x) * c.t;
        const z = a.z + (b.z - a.z) * c.t;
        if (this._segmentHitsBuilding(node.x, node.z, x, z)) continue;
        let target;
        if (c.t * e.len < 0.8) target = e.a;
        else if ((1 - c.t) * e.len < 0.8) target = e.b;
        else target = this._split(c.i, c.t);
        const road = this._roadAlong(node.x, node.z, x, z);
        this._addEdge(id, target, road >= 0 ? CROSS : LINK, road >= 0 ? 0.5 : 0.15, { road, density: 0.3 });
        break;
      }
    }
  }

  _segmentHitsBuilding(ax, az, bx, bz) {
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.6);
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      if (this.world.buildingAt(ax + (bx - ax) * f, az + (bz - az) * f)) return true;
    }
    return false;
  }

  // Road whose carriageway the segment runs over, or -1.
  _roadAlong(ax, az, bx, bz) {
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.6);
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      const r = this.carriage.at(ax + (bx - ax) * f, az + (bz - az) * f, 0);
      if (r >= 0) return r;
    }
    return -1;
  }

  // Final check of every edge band at 0.5 m steps: narrow the spread where it grazes a wall or kerb,
  // drop the edge if even its centreline does.
  _validate() {
    for (const e of this.edges) {
      if (e.dead) continue;
      const a = this.nodes[e.a];
      const b = this.nodes[e.b];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const nx = -dz / len;
      const nz = dx / len;
      const steps = Math.ceil(len / 0.5);
      const road = e.kind === CROSS;
      const ok = (x, z) => !this.world.buildingAt(x, z) && (road || this.carriage.at(x, z, 0) < 0);
      for (let i = 0; i <= steps && !e.dead; i++) {
        const x = a.x + (dx * i) / steps;
        const z = a.z + (dz * i) / steps;
        if (!ok(x, z)) {
          e.dead = true;
          break;
        }
        while (e.spread > 0.05) {
          const m = e.spread + BODY * 0.5;
          if (ok(x + nx * m, z + nz * m) && ok(x - nx * m, z - nz * m)) break;
          e.spread = e.spread > 0.2 ? e.spread * 0.5 : 0;
        }
      }
    }
  }

  // Remove isolated scraps of network (agents stranded on a few metres of pavement look broken).
  _prune() {
    const comp = new Int32Array(this.nodes.length).fill(-1);
    const sizes = [];
    for (let s = 0; s < this.nodes.length; s++) {
      if (comp[s] >= 0) continue;
      const c = sizes.length;
      let len = 0;
      const stack = [s];
      comp[s] = c;
      while (stack.length) {
        const u = stack.pop();
        for (const ei of this.nodes[u].edges) {
          const e = this.edges[ei];
          const v = e.a === u ? e.b : e.a;
          if (e.a === u) len += e.len;
          if (comp[v] < 0) {
            comp[v] = c;
            stack.push(v);
          }
        }
      }
      sizes.push(len);
    }
    for (const e of this.edges) if (sizes[comp[e.a]] < 60) e.dead = true;
  }

  // Compact: drop dead edges, give each edge its direction, and rebuild the grid.
  _finish() {
    const keep = [];
    const remap = new Int32Array(this.edges.length).fill(-1);
    this.edges.forEach((e, i) => {
      if (e.dead) return;
      remap[i] = keep.length;
      keep.push(e);
    });
    this.edges = keep;
    for (const n of this.nodes) n.edges = n.edges.map((i) => remap[i]).filter((i) => i >= 0);
    for (const e of this.edges) {
      const a = this.nodes[e.a];
      const b = this.nodes[e.b];
      e.len = Math.hypot(b.x - a.x, b.z - a.z);
      e.ux = (b.x - a.x) / e.len;
      e.uz = (b.z - a.z) / e.len;
      if (e.kind === CROSS) e.density = 0;
    }
    this._buildGrid();
  }

  // World point at arc length s along edge e (from node a) and lateral offset lat (+ = left of a→b).
  pointOn(e, s, lat, out) {
    const a = this.nodes[e.a];
    out.x = a.x + e.ux * s + e.uz * lat;
    out.z = a.z + e.uz * s - e.ux * lat;
    return out;
  }

  // Surface height of a point on an edge (kerbs step down onto crossings).
  heightOn(e, s) {
    if (e.kind !== CROSS) return this.nodes[e.a].y;
    const ya = this.nodes[e.a].y;
    const yb = this.nodes[e.b].y;
    const k = Math.max(0.4, e.kerb || 0.4);
    if (s < k) return ya;
    if (s > e.len - k) return yb;
    return 0;
  }
}
