import { pointInPoly, polyArea } from '../core/geo.js';
import { Vehicle } from './vehicle.js';
import { gloss, shout } from '../npc/streetVoices.js';

// Kombi culture: rank stops on the kerbside lanes next to every rank (moving kombis pull in there to
// load), rows of parked kombis filling the rank yards with their hwindi touting outside, and the calls
// themselves — a speech bubble plus a hoot when the player is within earshot. Close by, a hwindi often
// calls his kombi's destination out loud with a real recorded Shona phrase ("KuMarondera!"), twice,
// from the door (streetVoices.js); the bubble then shows exactly that, otherwise the text-only calls.
// A kombi has one destination: its text calls name the same place as its recorded calls (v.call).
// Bubbles go through the street's shared bubble layer (bubbles.js -> src/npc/bubbles.js), which may refuse
// one (phones: few bubbles, near speakers only, ambient calls only now and then); the call and its hoot
// still happen.

const CALL_RANGE = 40;
const VOICE_RANGE = 30; // m: recorded destination calls
const VOICE_CHANCE = 0.6;
const VOICED_SHARE = 0.6; // kombis whose hwindi calls a recorded destination (decided at the first call)
const RANK_KERB_RANGE = 120;
const BAY_W = 3.2;
const BAY_DEPTH = 6.5;
const BAY_AISLE = 8;
// Points of a parked kombi's footprint (metres forward, metres left) that must lie in the yard.
const BAY_PROBES = [[0, 0], [2.3, 0.8], [2.3, -0.8], [-2.3, 0.8], [-2.3, -0.8]];
const PARKED_RANGE = 460;
// Loading calls besides the kombi's own destination (v.call; another route's name would contradict it).
const LOAD_KINDS = new Set(['seats', 'board', 'fare', 'cant']);

// Minimum-area oriented bounding box of a ring, long axis = (ux, uz).
function orientedBox(pts) {
  const n = pts.length / 2;
  let best = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = pts[j * 2] - pts[i * 2];
    let uz = pts[j * 2 + 1] - pts[i * 2 + 1];
    const l = Math.hypot(ux, uz);
    if (l < 1e-3) continue;
    ux /= l;
    uz /= l;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let k = 0; k < n; k++) {
      const u = pts[k * 2] * ux + pts[k * 2 + 1] * uz;
      const v = -pts[k * 2] * uz + pts[k * 2 + 1] * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, ux, uz, minU, maxU, minV, maxV };
  }
  if (!best) return null;
  let { ux, uz } = best;
  let len = best.maxU - best.minU;
  let wid = best.maxV - best.minV;
  const cu = (best.minU + best.maxU) / 2;
  const cv = (best.minV + best.maxV) / 2;
  const cx = cu * ux - cv * uz;
  const cz = cu * uz + cv * ux;
  if (wid > len) {
    [len, wid] = [wid, len];
    [ux, uz] = [-uz, ux];
  }
  return { cx, cz, ux, uz, len, wid };
}

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
    this.driveCalls = mix.calls.filter((c) => c.kind === 'depart');
    const kombiDef = mix.types.find((t) => t.type === 'kombi');

    const yards = [];
    for (const rank of this.ranks) {
      this._kerbStops(rank, graph);
      const area = kombiDef && this._rankArea(rank, data.areas || []);
      if (area) yards.push(this._bays(area, rank, data.areas, graph, game.world, rng));
    }
    // Share the parked budget between the yards, round-robin, so every rank gets its row of kombis.
    let left = maxParked;
    while (left > 0 && yards.some((y) => y.length)) {
      for (const spots of yards) {
        const spot = spots.pop();
        if (!spot || left <= 0) continue;
        left--;
        const v = new Vehicle();
        mix.dress(v, kombiDef, rng, models);
        v.parked = true;
        v.position.set(spot.x, this.traffic.groundAt?.(spot.x, spot.z) ?? 0, spot.z);
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
      const score = d - (a.name && rank.name?.startsWith(a.name.split(' ')[0]) ? 50 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  // Kombi bays in a rank yard. 'rank' yards use the bays the city paints (see paintBays in
  // src/world/ground.js: double rows across the long axis of the minimum-area box); open 'platform'
  // yards get plain rows. Bays inside buildings, on roads or on loading islands are skipped.
  _bays(area, rank, areas, graph, world, rng) {
    const pts = area.pts;
    const box = orientedBox(pts);
    if (!box) return [];
    const islands = areas.filter((q) => q.kind === 'platform' && q !== area && polyArea(q.pts) < 400);
    const free = (x, z) => pointInPoly(x, z, pts) && !world?.buildingAt?.(x, z) && !islands.some((q) => pointInPoly(x, z, q.pts));
    const vx = -box.uz;
    const vz = box.ux;
    const spots = [];
    const tryBay = (u, v, facing) => {
      const x = box.cx + box.ux * u + vx * v;
      const z = box.cz + box.uz * u + vz * v;
      const fx = vx * facing;
      const fz = vz * facing;
      for (const [a, b] of BAY_PROBES) if (!free(x + fx * a - fz * b, z + fz * a + fx * b)) return;
      if (graph.nearestLane(x, z, 4.5)) return;
      // Busiest around the rank point; the far corners of big yards stay patchy.
      const score = Math.hypot(x - rank.x, z - rank.z) * (0.5 + rng());
      spots.push({ x, z, heading: Math.atan2(-fx, -fz), score });
    };
    if (area.kind === 'rank' && box.wid >= 10) {
      for (let v0 = -box.wid / 2 + 1; v0 + 2 * BAY_DEPTH < box.wid / 2; v0 += 2 * BAY_DEPTH + BAY_AISLE) {
        for (let u = -box.len / 2 + 1; u + BAY_W < box.len / 2 - 1; u += BAY_W) {
          tryBay(u + BAY_W / 2, v0 + BAY_DEPTH / 2, -1);
          tryBay(u + BAY_W / 2, v0 + BAY_DEPTH * 1.5, 1);
        }
      }
    } else {
      // tryBay parks along v: kombis stand side by side along u, rows one kombi length apart along v.
      for (let v = -box.wid / 2 + 3; v < box.wid / 2 - 3; v += 6.4) {
        for (let u = -box.len / 2 + 2; u < box.len / 2 - 2; u += 2.7) tryBay(u, v, rng() < 0.5 ? 1 : -1);
      }
    }
    // Best bays last: the caller pops from the end.
    return spots.sort((a, b) => b.score - a.score);
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
      if (v.voiced === undefined) this._chooseVoice(v, rng);
      if (v.voiced && dx * dx + dz * dz < VOICE_RANGE * VOICE_RANGE && rng() < VOICE_CHANCE) {
        const life = this._voiceCall(v);
        if (life) {
          bubbles.show(v, v.voiceCall, life);
          if (!v.parked && rng() < 0.3) this.traffic.honk(v);
          continue;
        }
      }
      const loading = v.parked || v.dwell > 0;
      const pool = loading ? this.loadCalls : this.driveCalls;
      const call = rng() < (loading ? 0.45 : 0.7) || !pool.length ? v.call : rng.pick(pool);
      if (!call) continue;
      bubbles.show(v, call);
      if (!v.parked || rng() < 0.35) this.traffic.honk(v);
    }
  }

  // Once per kombi, at its first call once the recordings are loaded: its hwindi either calls a recorded
  // destination (which then replaces its route for the text-only calls too) or keeps his town route and
  // text-only calls. Undecided (undefined) until the street voices are ready.
  _chooseVoice(v, rng) {
    const sv = this.traffic.voices;
    if (!sv?.ready) return;
    v.voiced = false;
    if (rng() >= VOICED_SHARE) return;
    const id = sv.assignDestination();
    const clip = id && sv.clip(id);
    if (!clip) return;
    const call = shout(clip.text);
    v.dest = id;
    v.voiceCall = { id, text: `${call} ${call}`, en: shout(gloss(clip.en)), kind: 'dest' };
    v.call = v.voiceCall;
    v.voiced = true;
  }

  // The hwindi calls this kombi's destination (a real recording, twice, from the open door). Returns
  // how long the bubble should stay up, or 0 if nothing was played.
  _voiceCall(v) {
    const sv = this.traffic.voices;
    if (!sv?.canSpeak('hwindi')) return 0;
    const clip = v.dest && sv.clip(v.dest);
    if (!clip || clip.id === sv.lastId) return 0;
    // His own voice (stable per kombi, 0.94..1.06), raised a little for the call.
    if (!v.voiceRate) v.voiceRate = 0.94 + ((v.id * 0.6180339887) % 1) * 0.12;
    const dur = sv.doubleCall(clip, (out) => this.doorPosition(v, out), { rate: v.voiceRate * 1.04, volume: 1.15 });
    if (!dur) return 0;
    return dur + 0.9;
  }

  // World position of the kombi's sliding door at head height (false once the vehicle is gone).
  doorPosition(v, out) {
    if (!v.parked && !v.path) return false;
    const d = v.model?.door;
    const lx = d ? d.x : -v.width / 2;
    const lz = d ? d.z : 0;
    const c = Math.cos(v.heading);
    const s = Math.sin(v.heading);
    out.set(v.position.x + lx * c + lz * s, v.position.y + 1.55, v.position.z - lx * s + lz * c);
    return true;
  }
}
