import { ROAD_CLASSES } from './roadGraph.js';
import { GREEN, AMBER, NONE } from './signals.js';
import { laneOffset } from '../world/streetMetrics.js';

// Microscopic traffic: IDM car following along lanes and junction connectors, junction reservations
// (requests granted first-come-first-served with priority for the main road and against right turns,
// gated by the robots and by space on the exit lane), MOBIL-style overtaking lane changes and kerb stops.

export const GAP_NONE = 0;
export const GAP_LEADER = 1;
export const GAP_LINE = 2;
export const GAP_STOP = 3;
export const GAP_OBSTACLE = 4;

const LOOKAHEAD = 90;
const REQUEST_TIME = 2.8;

function removeFrom(list, v) {
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1);
}

// Keeps path.vehicles ordered front-most first.
function insertSorted(list, v) {
  let k = list.length;
  while (k > 0 && list[k - 1].s < v.s) k--;
  list.splice(k, 0, v);
}

function lastOf(list) {
  return list.length ? list[list.length - 1] : null;
}

function idm(v, v0, gap, leaderSpeed, s0) {
  const sp = v.speed;
  const r = sp / v0;
  const free = 1 - r * r * r * r;
  if (gap === Infinity) return v.a * free;
  const sStar = s0 + Math.max(0, sp * v.T + (sp * (sp - leaderSpeed)) / (2 * Math.sqrt(v.a * v.b)));
  const q = sStar / Math.max(gap, 0.05);
  return v.a * (free - q * q);
}

export class Simulation {
  constructor(graph, signals, rng) {
    this.graph = graph;
    this.signals = signals;
    this.rng = rng;
    this.vehicles = [];
    this.time = 0;
    this.busy = new Set();
    this._g = { gap: Infinity, speed: 0, kind: GAP_NONE, leader: null };
    this._blocked = [];
    this._w = new Float32Array(16);
    this._lc = 0;
  }

  add(v, lane, s, speed) {
    v.path = lane;
    v.s = s;
    v.speed = speed;
    v.prev = null;
    v.prev2 = null;
    insertSorted(lane.vehicles, v);
    v.next = this.choose(v, lane);
    this.vehicles.push(v);
  }

  remove(v) {
    removeFrom(v.path.vehicles, v);
    if (v.reqJ) removeFrom(v.reqJ.requests, v);
    if (v.grantJ) removeFrom(v.grantJ.occupants, v);
    if (v.boxJ) removeFrom(v.boxJ.occupants, v);
    this._unreserve(v, v.resLane2);
    this._unreserve(v, v.resLane);
    v.reqJ = v.grantJ = v.boxJ = null;
    removeFrom(this.vehicles, v);
  }

  update(dt) {
    this.time += dt;
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) this._request(vs[i]);
    for (const j of this.busy) this._grant(j);
    for (let i = 0; i < vs.length; i++) this._accel(vs[i]);
    for (let i = vs.length - 1; i >= 0; i--) this._move(vs[i], dt);
    const n = vs.length;
    for (let k = Math.ceil(n / 10); k > 0 && n; k--) {
      this._lc = (this._lc + 1) % n;
      this._laneChange(vs[this._lc]);
    }
  }

  // Picks the connector at the end of `lane`: mostly straight on, favouring main roads, avoiding dead ends.
  choose(v, lane) {
    const outs = lane.out;
    if (outs.length <= 1) return outs[0] || null;
    const w = this._w;
    let total = 0;
    for (let i = 0; i < outs.length && i < w.length; i++) {
      const c = outs[i];
      let x = c.turn === 'straight' ? 1 : c.turn === 'uturn' ? 0.03 : c.turn === 'left' ? 0.45 : 0.38;
      x *= ROAD_CLASSES[c.to.road.cls].weight + 0.25;
      if (c.to.sink) x *= 0.02;
      else if (c.to.out.length === 1 && c.to.out[0].turn === 'uturn') x *= 0.1;
      w[i] = x;
      total += x;
    }
    let r = this.rng() * total;
    for (let i = 0; i < outs.length && i < w.length; i++) {
      r -= w[i];
      if (r <= 0) return outs[i];
    }
    return outs[outs.length - 1];
  }

  distToLine(v) {
    const p = v.path;
    return p.isLane ? p.length - v.s : p.length - v.s + p.to.length;
  }

  _request(v) {
    if (v.reqJ || v.dwell > 0) return;
    const c = v.next;
    if (!c || c.conflictFree) return;
    const lane = c.from;
    const j = lane.junction;
    if (v.grantJ === j) return;
    if (this.distToLine(v) > Math.max(12, v.speed * REQUEST_TIME + 6)) return;
    if (!this._firstInLine(v, lane, j)) return;
    const sig = this.signals.state(lane);
    v.reqJ = j;
    v.reqConn = c;
    v.reqKey = this.time + (lane.priority || sig !== NONE ? 0 : 3) + (c.turn === 'right' ? (sig === NONE ? 2 : 6) : 0);
    v.runRed = v.wild && this.rng() < v.runRedChance;
    j.requests.push(v);
    this.busy.add(j);
  }

  // Everyone ahead of v up to the stop line already holds (or does not need) a grant for junction j.
  _firstInLine(v, lane, j) {
    const list = v.path.vehicles;
    for (let k = 0; k < list.length; k++) {
      const u = list[k];
      if (u === v) break;
      if (u.grantJ !== j && !(u.next && u.next.conflictFree)) return false;
    }
    if (!v.path.isLane) {
      for (const u of lane.vehicles) if (u.grantJ !== j && !(u.next && u.next.conflictFree)) return false;
    }
    return true;
  }

  _grant(j) {
    const reqs = j.requests;
    if (!reqs.length) {
      this.busy.delete(j);
      return;
    }
    for (const v of reqs) v.reqReady = this._ready(v);
    for (let i = 1; i < reqs.length; i++) {
      const v = reqs[i];
      let k = i - 1;
      while (k >= 0 && reqs[k].reqKey > v.reqKey) {
        reqs[k + 1] = reqs[k];
        k--;
      }
      reqs[k + 1] = v;
    }
    const blocked = this._blocked;
    blocked.length = 0;
    const occ = j.occupants;
    for (let i = 0; i < reqs.length; i++) {
      const v = reqs[i];
      if (!v.reqReady) continue;
      const c = v.reqConn;
      let ok = true;
      for (let k = 0; k < occ.length && ok; k++) {
        const o = occ[k];
        const oc = o.grantJ === j ? o.grantConn : o.boxConn;
        if (oc && j.conflicts(oc, c)) ok = false;
      }
      for (let k = 0; k < blocked.length && ok; k++) if (j.conflicts(blocked[k], c)) ok = false;
      if (!ok) {
        blocked.push(c);
        continue;
      }
      reqs.splice(i, 1);
      i--;
      v.reqJ = null;
      v.grantJ = j;
      v.grantConn = c;
      occ.push(v);
      this._reserve(v, c.to, v.length + 2);
    }
  }

  // A vehicle can hold space on two lanes at once: the one it is driving into and, when that lane is
  // short, the exit of the next junction it was already granted.
  _reserve(v, lane, len) {
    lane.reserved += len;
    if (!v.resLane) {
      v.resLane = lane;
      v.resLen = len;
    } else {
      v.resLane2 = lane;
      v.resLen2 = len;
    }
  }

  _unreserve(v, lane) {
    if (!lane) return;
    if (v.resLane === lane) {
      lane.reserved = Math.max(0, lane.reserved - v.resLen);
      v.resLane = v.resLane2;
      v.resLen = v.resLen2;
    } else if (v.resLane2 === lane) {
      lane.reserved = Math.max(0, lane.reserved - v.resLen2);
    } else return;
    v.resLane2 = null;
    v.resLen2 = 0;
  }

  _ready(v) {
    const c = v.reqConn;
    const lane = c.from;
    if (!this._exitFree(c.to, v)) return false;
    const dist = this.distToLine(v);
    const sig = this.signals.state(lane);
    if (sig === NONE) return lane.priority === 1 || (dist < 7 && v.speed < 4.5);
    if (sig === GREEN) return true;
    const waitingTurn = c.turn === 'right' && v.lineWait > 1.5;
    if (sig === AMBER) return waitingTurn || v.speed * v.speed > 7 * Math.max(dist - 0.5, 0.1);
    return v.runRed || (waitingTurn && this.signals.clearance(lane));
  }

  // "Don't block the box": only enter when the exit lane has room for the whole vehicle.
  _exitFree(out, v) {
    const need = v.length + 1.5;
    const last = lastOf(out.vehicles);
    if (out.length < need) return (!last || last.speed > 2) && out.reserved < 0.01;
    if (last && last.speed > 3) return out.reserved + need < out.length;
    const free = (last ? last.s - last.length : out.length + 20) - out.reserved;
    return free >= need;
  }

  _setGap(gap, speed, kind, leader) {
    const g = this._g;
    g.gap = gap;
    g.speed = speed;
    g.kind = kind;
    g.leader = leader;
  }

  // Nearest constraint ahead: the vehicle in front (possibly across the junction), or the stop line.
  _leader(v) {
    const path = v.path;
    const list = path.vehicles;
    const idx = list.indexOf(v);
    if (idx > 0) {
      const l = list[idx - 1];
      this._setGap(l.s - l.length - v.s, l.speed, GAP_LEADER, l);
      return;
    }
    let dist = path.length - v.s;
    let lane = path;
    if (!path.isLane) {
      lane = path.to;
      const l = lastOf(lane.vehicles);
      if (l) {
        this._setGap(dist + l.s - l.length, l.speed, GAP_LEADER, l);
        return;
      }
      dist += lane.length;
    }
    const c = v.next;
    if (!c || (!c.conflictFree && v.grantJ !== lane.junction)) {
      this._setGap(dist - 0.3, 0, GAP_LINE, null);
      return;
    }
    this._setGap(Infinity, 0, GAP_NONE, null);
    if (dist > LOOKAHEAD) return;
    let l = lastOf(c.vehicles);
    if (l) {
      this._setGap(dist + l.s - l.length, l.speed, GAP_LEADER, l);
      return;
    }
    dist += c.length;
    if (dist > LOOKAHEAD) return;
    l = lastOf(c.to.vehicles);
    if (l) this._setGap(dist + l.s - l.length, l.speed, GAP_LEADER, l);
  }

  _accel(v) {
    if (v.dwell > 0) {
      v.acc = 0;
      v.hardGap = 0;
      return;
    }
    const path = v.path;
    const onLane = path.isLane;
    const lane = onLane ? path : path.to;
    let v0 = Math.min(lane.speedLimit * v.speedFactor, v.maxSpeed);
    if (!onLane) v0 = Math.min(v0, path.speedLimit * (v.wild ? 1.15 : 1));
    const c = v.next;
    if (c) {
      const d = onLane ? path.length - v.s : path.length - v.s + lane.length;
      const vc = c.speedLimit * (v.wild ? 1.15 : 1);
      if (vc < v0) v0 = Math.min(v0, Math.sqrt(vc * vc + 2 * v.b * Math.max(0, d - 1)));
    }
    v0 = Math.max(v0, 1.5);
    this._leader(v);
    const g = this._g;
    let acc = idm(v, v0, g.gap, g.speed, g.kind === GAP_LINE ? 0.6 : v.s0);
    let hard = g.kind === GAP_LINE ? g.gap : g.gap - 0.25;
    v.gapKind = g.kind;
    v.leader = g.leader;
    if (v.stopS >= 0 && path === v.stopLane) {
      const gs = v.stopS - v.s;
      const a2 = idm(v, v0, gs, 0, 0.3);
      if (a2 < acc) {
        acc = a2;
        v.gapKind = GAP_STOP;
      }
      hard = Math.min(hard, gs + 0.5);
    }
    if (v.obstacleGap < Infinity) {
      const a3 = idm(v, v0, v.obstacleGap, 0, 1.0);
      if (a3 < acc) {
        acc = a3;
        v.gapKind = GAP_OBSTACLE;
      }
      hard = Math.min(hard, v.obstacleGap);
    }
    v.acc = Math.max(-9, Math.min(v.a, acc));
    v.hardGap = hard;
  }

  _move(v, dt) {
    if (v.lcCooldown > 0) v.lcCooldown -= dt;
    if (v.dwell > 0) {
      v.speed = 0;
      v.dwell -= dt;
      if (v.dwell <= 0) {
        v.dwell = 0;
        v.stopS = -1;
        v.stopLane = null;
        v.leaveT = 2.5;
      }
      return;
    }
    v.speed = Math.max(0, v.speed + v.acc * dt);
    let ds = v.speed * dt;
    if (ds > v.hardGap) {
      ds = Math.max(0, v.hardGap);
      v.speed = Math.min(v.speed, ds / dt);
    }
    v.s += ds;
    v.odo += ds;
    if (v.stopS >= 0 && v.path === v.stopLane && v.s >= v.stopS - 0.8 && v.speed < 0.5) {
      v.dwell = v.stopDwell;
      v.speed = 0;
    }
    while (v.s >= v.path.length) {
      const p = v.path;
      if (p.isLane) {
        const c = v.next;
        if (!c || (!c.conflictFree && v.grantJ !== p.junction)) {
          v.s = p.length - 0.01;
          v.speed = 0;
          break;
        }
        v.s -= p.length;
        removeFrom(p.vehicles, v);
        c.vehicles.push(v);
        this._releaseBox(v);
        if (v.grantJ === p.junction) {
          v.boxJ = v.grantJ;
          v.boxConn = v.grantConn;
          v.grantJ = null;
          v.grantConn = null;
        }
        v.path = c;
        v.next = this.choose(v, c.to);
      } else {
        const lane = p.to;
        v.s -= p.length;
        removeFrom(p.vehicles, v);
        insertSorted(lane.vehicles, v);
        this._unreserve(v, lane);
        v.path = lane;
        this._planStop(v, lane);
      }
      v.prev2 = v.prev;
      v.prev = p;
    }
    if (v.boxJ && v.path.isLane && v.s >= v.length) this._releaseBox(v);
    v.lineWait = v.gapKind === GAP_LINE && v.hardGap < 3 && v.speed < 0.5 ? v.lineWait + dt : 0;
    v.stuck = v.speed < 0.3 ? v.stuck + dt : 0;
  }

  _releaseBox(v) {
    if (!v.boxJ) return;
    removeFrom(v.boxJ.occupants, v);
    v.boxJ = null;
    v.boxConn = null;
  }

  // Kombis (and the odd bus / pirate taxi) pull in at ranks on this lane or at a random kerb.
  _planStop(v, lane) {
    if (!v.stopChance || lane.laneIndex !== 0 || lane.length < 30) return;
    let s = -1;
    let dwell = 0;
    let rank = false;
    for (const st of lane.stops) {
      if (this.rng() < (v.type === 'kombi' ? 0.8 : 0.35)) {
        s = st.s;
        dwell = this.rng.range(8, 18);
        rank = true;
        break;
      }
    }
    if (s < 0 && this.rng() < v.stopChance) {
      s = this.rng.range(10, lane.length - 14);
      dwell = this.rng.range(3, 8);
    }
    if (s < 0) return;
    v.stopLane = lane;
    v.stopS = s;
    v.stopDwell = dwell;
    v.atRank = rank;
  }

  // Pull out around a slow or loading vehicle when the neighbouring lane has a safe gap. Kombis accept
  // much tighter gaps, which makes the car they cut in front of hoot.
  _laneChange(v) {
    const lane = v.path;
    if (v.lcCooldown > 0 || !lane.isLane || lane.siblings.length < 2) return;
    if (v.reqJ || v.grantJ || v.dwell > 0 || v.stopS >= 0 || Math.abs(v.lateral) > 0.3) return;
    if (v.s < v.length + 3 || lane.length - v.s < 25) return;
    const l = v.leader;
    if (v.gapKind !== GAP_LEADER || !l || l.path !== lane) return;
    const gap = l.s - l.length - v.s;
    const desired = Math.min(lane.speedLimit * v.speedFactor, v.maxSpeed);
    const slow = l.dwell > 0 || (l.stopS >= 0 && l.speed < 3) || (l.speed < desired * (v.wild ? 0.85 : 0.6) && gap < (v.wild ? 25 : 18));
    if (!slow) return;
    const i = lane.laneIndex;
    for (let d = 1; d >= -1; d -= 2) {
      const ti = i + d;
      const t = lane.siblings[ti];
      if (!t) continue;
      const s2 = (v.s * t.length) / lane.length;
      if (t.length - s2 < 25) continue;
      const list = t.vehicles;
      let k = 0;
      while (k < list.length && list[k].s > s2) k++;
      const lead = k > 0 ? list[k - 1] : null;
      const fol = k < list.length ? list[k] : null;
      const gapF = lead ? lead.s - lead.length - s2 : Infinity;
      const gapB = fol ? s2 - v.length - fol.s : Infinity;
      if (gapF < 4 + v.speed * 0.8) continue;
      if (lead && (lead.dwell > 0 || (lead.speed <= l.speed + 0.5 && gapF < gap + 10))) continue;
      if (fol && (fol.grantJ || gapB < 1.5 + fol.speed * (v.wild ? 0.35 : 1.0))) continue;
      removeFrom(lane.vehicles, v);
      list.splice(k, 0, v);
      v.lateral += laneOffset(lane.road, lane.laneIndex) - laneOffset(t.road, t.laneIndex);
      v.path = t;
      v.s = s2;
      v.next = this.choose(v, t);
      v.blink = ti < i ? -1 : 1;
      v.blinkT = 2.5;
      v.lcCooldown = 4;
      if (v.wild && fol && gapB < fol.speed * 1.2) fol.honkIn = 0.3 + this.rng() * 0.4;
      return;
    }
  }
}
