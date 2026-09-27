import * as THREE from 'three';
import { CROSS, WALK } from './walkways.js';
import { walkClipFor } from './appearance.js';

// Crowd simulation: agents walk the pedestrian network (edge + arc length + lateral offset inside the
// edge's validated band), wait at kerbs for a gap or a red light, dodge each other and the stalls,
// stand in chatting groups, sell at stalls, and react to Spider-Man.

const TAU = Math.PI * 2;
const HASH_SIZE = 4096;
const HASH_CELL = 2.5;
const LOOK = 2.6; // avoidance look-ahead (m)
const PLAN = 8; // choose the next edge this far before a node (m)

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

// Heading (0 = facing -z) of a direction in the xz plane.
export function headingOf(dx, dz) {
  return Math.atan2(-dx, -dz);
}

function approach(v, target, maxStep) {
  return v < target ? Math.min(target, v + maxStep) : Math.max(target, v - maxStep);
}

// Stable playback rate for a person's voice, 0.94..1.06, from their (seeded) look.
function voiceRateOf(look) {
  const k = Math.sin((look.build + 1.3) * 7919.13 + look.scale * 1047.29 + look.speed * 357.11) * 43758.5453;
  return 0.94 + 0.12 * (k - Math.floor(k));
}

// Clip swaps fade over this long (s); sitting down or getting up takes a little longer.
const FADE = 0.25;
const FADE_SIT = 0.45;
// A clip a variant was not baked with falls back to the next one along.
const FALLBACK = { flee_run: 'walk', call_out: 'wave', carry_on_head: 'walk', walk_slow: 'walk', sit_talk: 'sit_idle', phone_call: 'idle_relaxed', idle_look: 'idle_relaxed', idle_arms_folded: 'idle_relaxed' };
const SEATED = new Set(['sit_idle', 'sit_talk', 'sit_ground']);

export class Agent {
  static humans = null; // humans.js, set by npcs.js (head heights)

  constructor() {
    this.id = 0;
    this.position = new THREE.Vector3();
    this.heading = 0;
    this.gender = 'female';
    this.state = 'walk'; // walk | wait | cross | idle | chat | vendor | react | flee
    this.name = '';
    this.role = '';
    this.look = null;
    this.pose = { headYaw: 0, headPitch: 0, sit: 0 };
    // Animation state (bodies.js draws it): current clip and time, the clip it fades from, one-shots.
    this.anim = { clip: null, t: 0, rate: 1, prev: null, pt: 0, prate: 1, blend: 0, fade: FADE, once: null, onceUntil: 0, moving: false, nodAt: 0 };
    this.phone = false;
    this.vx = 0;
    this.vz = 0;
  }

  reset(id, look, kind) {
    this.id = id;
    this.look = look;
    this.gender = look.gender;
    this.name = look.name;
    this.kind = kind; // walker | group | idle | vendor | rank | hwindi
    this.state = kind === 'walker' ? 'walk' : kind === 'vendor' ? 'vendor' : kind === 'group' ? 'chat' : 'idle';
    this.role = '';
    this.edge = -1;
    this.next = -1; // edge chosen for the coming node (-1 = not chosen yet)
    this.nextLo = 0;
    this.nextHi = 0;
    this.fwd = true;
    this.s = 0;
    this.lat = 0;
    this.latGoal = 0;
    // Where in the lane this person likes to walk: on pavements from a little kerbside of the
    // middle to the building line (away from lamp posts and trees); on paths, a side of the centre.
    this.lanePref = Math.random() * 1.2 - 0.2;
    this.pathPref = Math.random() * 2 - 1;
    this.speed = 0;
    this.prefSpeed = look.speed;
    this.walkClip = look.variant ? walkClipFor(look.variant, look.load) : 'walk';
    this.talkClip = Math.random() < 0.5 ? 'talk' : 'talk_2';
    this.tempo = 0.92 + Math.random() * 0.16; // personal pace of standing clips
    this.forceClip = null;
    this.follow = null; // walking with a group (pupils): the one they keep up with
    this.followId = -1;
    this.waitT = 0;
    this.checkT = 0;
    this.blocked = 0;
    this.slow = 1;
    this.hurry = 0;
    this.carT = 0;
    this.carAhead = false;
    this.carWait = 0;
    this.timer = 0;
    this.home = null;
    this.group = null;
    this.stall = null;
    this.rank = null;
    this.lounge = false;
    this.habit = null; // 'text' | 'call' | 'fold' | null
    this.habitT = 0;
    this.glance = 0;
    this.glanceT = 0;
    this.react = null;
    this.reactCool = 0;
    this.resume = null;
    this.talkUntil = 0;
    this.voice = null;
    this.voiceRate = voiceRateOf(look);
    this.dest = null; // hwindi: the destination clip he calls
    this.nextBubble = 0;
    this.nextGreet = 0;
    this.nextCall = 0;
    this.lastSpoke = -1e9;
    this.crossRoad = -1; // out on a carriageway: index of the road being crossed
    this.vx = 0;
    this.vz = 0;
    const p = this.pose;
    p.headYaw = 0;
    p.headPitch = 0;
    p.sit = 0;
    const an = this.anim;
    an.clip = null;
    an.prev = null;
    an.blend = 0;
    an.once = null;
    an.moving = kind === 'walker';
    an.nodAt = 0;
    this.phone = false;
  }

  // World height of the head joint (base of the skull) in the current animation frame: lower when sitting,
  // bobbing when walking. Voices come from the mouth, bubbles float above the head.
  get headY() {
    const H = Agent.humans;
    const L = this.look;
    const an = this.anim;
    if (H && an.clip && L.variant) return this.position.y + (H.jointY(0, an.clip, an.t, L.variant.index) + L.variant.ground) * L.scale;
    return this.position.y + L.height * 0.9;
  }

  get mouthY() {
    return this.headY + 0.03 * this.look.scale;
  }
}

export class Crowd {
  constructor(game, walkways, obstacles) {
    this.game = game;
    this.walk = walkways;
    this.agents = [];
    this.obstaclesOn = true; // stalls are packed away at night
    this.head = new Int32Array(HASH_SIZE);
    this.next = new Int32Array(1);
    this.humans = null; // set by npcs.js (clips for the animation state)
    this._near = [];
    // People out on a carriageway (crossing or fleeing across it), refreshed every frame for traffic.
    this.crossers = [];
    // Static obstacles in a coarse grid; each is filed under every cell within look-ahead. Stalls
    // (stall: true) are packed away at night; the city's street furniture stays.
    this.obGrid = new Map();
    for (const o of obstacles) o.stall = true;
    this.addObstacles(obstacles);
  }

  // Obstacles [{x, z, r}] walkers steer around (stalls, and the city's poles, trees and benches).
  addObstacles(list) {
    for (const o of list) {
      if (!(o && Number.isFinite(o.x + o.z) && o.r > 0)) continue;
      const reach = o.r + LOOK + 0.5;
      for (let gx = Math.floor((o.x - reach) / 8); gx <= Math.floor((o.x + reach) / 8); gx++) {
        for (let gz = Math.floor((o.z - reach) / 8); gz <= Math.floor((o.z + reach) / 8); gz++) {
          const k = this._cellKey(gx, gz);
          if (!this.obGrid.has(k)) this.obGrid.set(k, []);
          this.obGrid.get(k).push(o);
        }
      }
    }
  }

  // Is (x, z) within `pad` of an obstacle (spawn check)?
  obstacleAt(x, z, pad) {
    const cells = this.obGrid.get(this._cellKey(Math.floor(x / 8), Math.floor(z / 8)));
    if (!cells) return false;
    for (const o of cells) {
      if (o.stall && !this.obstaclesOn) continue;
      const r = o.r + pad;
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < r * r) return true;
    }
    return false;
  }

  _cellKey(gx, gz) {
    return gx * 73856093 + gz * 19349663;
  }

  _hash(x, z) {
    const gx = Math.floor(x / HASH_CELL);
    const gz = Math.floor(z / HASH_CELL);
    return ((gx * 73856093) ^ (gz * 19349663)) & (HASH_SIZE - 1);
  }

  rebuildHash(list) {
    if (this.next.length < list.length) this.next = new Int32Array(list.length * 2);
    this.head.fill(-1);
    this.agents = list;
    for (let i = 0; i < list.length; i++) {
      const h = this._hash(list[i].position.x, list[i].position.z);
      this.next[i] = this.head[h];
      this.head[h] = i;
    }
  }

  // Agents within r of (x, z) (r <= ~2 cells), written into `out`.
  near(x, z, r, out) {
    out.length = 0;
    const list = this.agents;
    const r2 = r * r;
    const c = Math.ceil(r / HASH_CELL);
    const gx0 = Math.floor(x / HASH_CELL);
    const gz0 = Math.floor(z / HASH_CELL);
    for (let gx = gx0 - c; gx <= gx0 + c; gx++) {
      for (let gz = gz0 - c; gz <= gz0 + c; gz++) {
        let i = this.head[((gx * 73856093) ^ (gz * 19349663)) & (HASH_SIZE - 1)];
        while (i >= 0) {
          const b = list[i];
          if (!b) break;
          const dx = b.position.x - x;
          const dz = b.position.z - z;
          if (dx * dx + dz * dz <= r2 && Math.floor(b.position.x / HASH_CELL) === gx && Math.floor(b.position.z / HASH_CELL) === gz) out.push(b);
          i = this.next[i];
        }
      }
    }
    return out;
  }

  // Place a walker on edge ei at arc length s (from the travel start); lateral offset `lat`, or the
  // walker's own preferred lane when omitted.
  putOnEdge(a, ei, fwd, s, lat) {
    const e = this.walk.edges[ei];
    a.edge = ei;
    a.next = -1;
    a.fwd = fwd;
    a.s = s;
    a.latGoal = this._laneGoal(a, e);
    a.lat = lat ?? a.latGoal;
    this._place(a);
    a.heading = headingOf(this._ux(a), this._uz(a));
  }

  _laneGoal(a, e) {
    const out = e.kind === WALK ? e.side * (a.fwd ? 1 : -1) : 0;
    let g = (out ? out * a.lanePref : a.pathPref) * e.spread;
    // Pedestrian streets have benches down the middle: walk either side of them.
    if (e.keepOut && Math.abs(g) < e.keepOut) g = (g < 0 ? -1 : 1) * Math.min(e.spread, e.keepOut);
    return g;
  }

  _ux(a) {
    const e = this.walk.edges[a.edge];
    return a.fwd ? e.ux : -e.ux;
  }

  _uz(a) {
    const e = this.walk.edges[a.edge];
    return a.fwd ? e.uz : -e.uz;
  }

  // Position from (edge, s, lat) in the travel frame: start + u*s + left*lat.
  _place(a) {
    const W = this.walk;
    const e = W.edges[a.edge];
    const start = W.nodes[a.fwd ? e.a : e.b];
    const ux = a.fwd ? e.ux : -e.ux;
    const uz = a.fwd ? e.uz : -e.uz;
    a.position.x = start.x + ux * a.s + uz * a.lat;
    a.position.z = start.z + uz * a.s - ux * a.lat;
    // Kerb / road level, lifted onto the Kopje where Skipper Hoste Drive climbs it.
    a.position.y = W.heightOn(e, a.fwd ? a.s : e.len - a.s) + W.hill(a.position.x, a.position.z, true);
  }

  update(dt, ctx) {
    const list = this.agents;
    const edges = this.walk.edges;
    const crossers = this.crossers;
    crossers.length = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      switch (a.state) {
        case 'walk':
        case 'cross':
        case 'flee':
          this._move(a, dt, ctx);
          break;
        case 'wait':
          this._wait(a, dt, ctx);
          break;
        case 'react':
          this._reacting(a, dt, ctx);
          break;
        default:
          this._stand(a, dt, ctx);
      }
      this._animate(a, dt, ctx);
      a.crossRoad = -1;
      if ((a.state === 'cross' || a.state === 'flee') && a.edge >= 0) {
        const e = edges[a.edge];
        if (e.kind === CROSS && e.road >= 0) {
          a.crossRoad = e.road;
          crossers.push(a);
        }
      }
    }
  }

  _move(a, dt, ctx) {
    const W = this.walk;
    const e = W.edges[a.edge];
    const ux = a.fwd ? e.ux : -e.ux;
    const uz = a.fwd ? e.uz : -e.uz;
    const L = a.look;
    let target = a.prefSpeed;
    // Pupils walking together keep up with the one in front (and wait for the others).
    const lead = a.follow && a.follow.id === a.followId && a.follow.edge >= 0 ? a.follow : null;
    if (a.follow && !lead) a.follow = null;
    if (lead && a.state !== 'flee') {
      const ahead = (lead.position.x - a.position.x) * ux + (lead.position.z - a.position.z) * uz;
      const gap = Math.hypot(lead.position.x - a.position.x, lead.position.z - a.position.z);
      if (gap > 12) a.follow = null;
      target = Math.min(L.walkMax, lead.prefSpeed * (ahead > 1.4 ? 1.25 : ahead < -0.6 ? 0.8 : 1));
    }
    // Speeds stay inside what the walk and run clips cover at a natural cadence (stride-matched).
    if (a.state === 'cross') target = Math.min(target * 1.2, L.walkMax);
    if (a.state === 'flee') {
      target = L.runSpeed || L.walkMax;
      a.timer -= dt;
      // Calm down, but whoever is out on a crossing by then still finishes crossing.
      if (a.timer <= 0) a.state = e.kind === CROSS ? 'cross' : 'walk';
    }
    // Cars: hurry across when one bears down on the crossing; on the pavement, give a kombi that
    // mounts the kerb a wide berth.
    if ((a.checkT -= dt) <= 0) {
      a.checkT = a.state === 'cross' ? 0.4 : 0.6 + Math.random() * 0.4;
      a.hurry = this._vehicleThreat(a.position.x, a.position.z, a.state === 'cross' ? 7 : 1.5) ? 1 : 0;
    }
    if (a.hurry && a.state === 'cross') target = L.runSpeed ? L.runSpeed * 0.85 : L.walkMax;

    const spread = e.spread;
    this._avoid(a, ux, uz, spread, ctx, dt);
    if (e.kind === CROSS && (a.carT -= dt) <= 0) {
      a.carT = 0.2;
      a.carAhead = this._carAt(a.position.x + ux * 0.9, a.position.z + uz * 0.9, 0.35);
    }
    if (e.kind === CROSS && a.carAhead) {
      // A car is in the way: wait for it, and head back to the kerb if it stays put.
      a.slow = 0;
      a.carWait += dt;
      if (a.carWait > 4) {
        a.carWait = 0;
        this._turnAround(a);
      }
    } else a.carWait = 0;
    if (a.hurry && a.state !== 'cross' && e.kind !== CROSS) {
      // Keep to the building side of the pavement (lateral sign of the edge's outer side).
      const out = (e.side || 0) * (a.fwd ? 1 : -1);
      a.latGoal = out * spread;
      a.slow = Math.min(a.slow, 0.5);
    }
    target *= a.slow;
    a.speed = approach(a.speed, target, (target > a.speed ? 1.6 : 4) * dt);
    const px = a.position.x;
    const pz = a.position.z;
    a.s += a.speed * dt;
    // (A group member lets the one in front choose first.)
    if (a.next < 0 && e.len - a.s < PLAN && !(lead && lead.edge === a.edge && lead.next < 0 && e.len - a.s > 1.5)) this._plan(a, ctx);
    const lo = a.next >= 0 ? a.nextLo : -spread;
    const hi = a.next >= 0 ? a.nextHi : spread;
    const goal = Math.max(lo, Math.min(hi, a.latGoal));
    // Outside the next edge's lane on a short last stretch: side-step fast enough to make the node.
    let rate = 0.8;
    if (a.lat < lo || a.lat > hi) rate = Math.min(2.5, Math.max(rate, (Math.abs(goal - a.lat) * Math.max(a.speed, 0.5)) / Math.max(0.5, e.len - a.s)));
    a.lat = approach(a.lat, goal, rate * dt);
    if (a.s >= e.len) this._arrive(a, ctx);
    this._place(a);
    // Hard guarantee: never step inside a building (the network is validated, avoidance may not be).
    if (W.world.buildingAt(a.position.x, a.position.z)) {
      a.lat *= 0.5;
      a.latGoal = 0;
      this._place(a);
      if (W.world.buildingAt(a.position.x, a.position.z)) {
        a.position.x = px;
        a.position.z = pz;
      }
    }
    a.vx = (a.position.x - px) / Math.max(dt, 1e-4);
    a.vz = (a.position.z - pz) / Math.max(dt, 1e-4);
    const want = headingOf(this._ux(a), this._uz(a));
    a.heading += wrapAngle(want - a.heading) * Math.min(1, dt * 6);
  }

  // Look ahead for the nearest agent, stall or player in our lane; steer around it or slow down.
  _avoid(a, ux, uz, spread, ctx, dt) {
    const lx = uz;
    const lz = -ux;
    let best = LOOK;
    let side = 0;
    let clear = 0.7;
    let other = null;
    let oncoming = false;
    let staticBlock = false;
    const x = a.position.x;
    const z = a.position.z;
    const near = this.near(x, z, LOOK, this._near);
    for (let i = 0; i < near.length; i++) {
      const b = near[i];
      if (b === a) continue;
      const rx = b.position.x - x;
      const rz = b.position.z - z;
      const ahead = rx * ux + rz * uz;
      if (ahead <= 0.05 || ahead >= best) continue;
      const sd = rx * lx + rz * lz;
      if (Math.abs(sd) > 0.68) continue;
      best = ahead;
      side = sd;
      other = b;
      clear = 0.72;
      oncoming = b.vx * ux + b.vz * uz < -0.3;
      staticBlock = b.vx * b.vx + b.vz * b.vz < 0.04;
    }
    const cells = this.obGrid.get(this._cellKey(Math.floor(x / 8), Math.floor(z / 8)));
    if (cells) {
      for (const o of cells) {
        if (o.stall && !this.obstaclesOn) continue;
        const rx = o.x - x;
        const rz = o.z - z;
        const ahead = rx * ux + rz * uz;
        const sd = rx * lx + rz * lz;
        if (ahead <= -o.r * 0.5 || ahead >= best + o.r || Math.abs(sd) > o.r + 0.4) continue;
        best = Math.max(0.1, ahead - o.r);
        side = sd;
        clear = o.r + 0.45;
        other = null;
        oncoming = false;
        staticBlock = true;
      }
    }
    if (ctx.playerOnFoot) {
      const rx = ctx.px - x;
      const rz = ctx.pz - z;
      const ahead = rx * ux + rz * uz;
      const sd = rx * lx + rz * lz;
      if (ahead > 0 && ahead < best && Math.abs(sd) < 0.9) {
        best = ahead;
        side = sd;
        clear = 0.95;
        staticBlock = true;
        other = null;
      }
    }
    a.slow = 1;
    if (best >= LOOK) {
      a.latGoal = this._laneGoal(a, this.walk.edges[a.edge]);
      a.blocked = 0;
      return;
    }
    // Pass on the side with room (within the lane that leads onto the next edge); oncoming walkers
    // both keep left.
    const passL = a.lat + side + clear;
    const passR = a.lat + side - clear;
    const okL = passL <= (a.next >= 0 ? a.nextHi : spread);
    const okR = passR >= (a.next >= 0 ? a.nextLo : -spread);
    if (okL && (oncoming || !okR || Math.abs(passL - a.lat) <= Math.abs(passR - a.lat))) a.latGoal = passL;
    else if (okR) a.latGoal = passR;
    else {
      // No room: follow or stop, and give up and turn around if the way stays blocked.
      const follow = other ? Math.max(0, other.vx * ux + other.vz * uz) : 0;
      a.slow = best < 0.8 ? 0 : Math.min(1, follow / Math.max(0.3, a.prefSpeed) + (best - 0.8) * 0.4);
      if (a.state !== 'cross') {
        a.blocked += dt;
        if (staticBlock && a.blocked > 1.5) this._turnAround(a);
      }
      return;
    }
    if (best < 1.1 && Math.abs(a.lat - a.latGoal) > 0.3) a.slow = 0.6;
  }

  _turnAround(a) {
    const e = this.walk.edges[a.edge];
    a.fwd = !a.fwd;
    a.next = -1;
    a.s = Math.max(0, e.len - a.s);
    a.lat = -a.lat;
    a.latGoal = a.lat;
    a.blocked = 0;
    // Someone turning back halfway across is still in the road: they stay 'cross' until the kerb.
    if (a.state === 'wait') a.state = 'walk';
  }

  // Choose the edge to take at the node ahead (-1: dead end, turn back).
  _chooseNext(a, ctx) {
    const W = this.walk;
    const e = W.edges[a.edge];
    const nodeId = a.fwd ? e.b : e.a;
    const node = W.nodes[nodeId];
    const ux = a.fwd ? e.ux : -e.ux;
    const uz = a.fwd ? e.uz : -e.uz;
    const opts = node.edges;
    // Walking in a group: take the way the one in front took (or is about to take).
    const lead = a.follow && a.follow.id === a.followId ? a.follow : null;
    if (lead && a.state !== 'flee') {
      if (lead.edge !== a.edge && opts.includes(lead.edge)) return lead.edge;
      if (lead.edge === a.edge && lead.next >= 0 && lead.fwd === a.fwd && opts.includes(lead.next)) return lead.next;
    }
    let total = 0;
    let pick = -1;
    const weights = this._weights || (this._weights = []);
    weights.length = 0;
    for (let i = 0; i < opts.length; i++) {
      const ei = opts[i];
      let w = 0;
      if (ei !== a.edge) {
        const n = W.edges[ei];
        const out = n.a === nodeId ? 1 : -1;
        const straight = (n.ux * out * ux + n.uz * out * uz);
        if (a.state === 'flee') {
          const far = W.nodes[out > 0 ? n.b : n.a];
          const d = Math.hypot(far.x - ctx.px, far.z - ctx.pz);
          w = n.kind === CROSS ? 0.05 : d * d;
        } else if (n.kind === CROSS) {
          w = a.look.child ? 0.25 : 0.4;
        } else {
          w = (0.2 + 0.8 * Math.max(0, straight)) * (0.25 + n.density);
          // Keep the crowd where the player is: wander away from the active area less often.
          const far = W.nodes[out > 0 ? n.b : n.a];
          if ((far.x - ctx.focus.x) ** 2 + (far.z - ctx.focus.z) ** 2 > ctx.r2) w *= 0.25;
        }
      }
      weights.push(w);
      total += w;
    }
    if (total <= 0) return -1;
    let r = Math.random() * total;
    for (let i = 0; i < opts.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        pick = opts[i];
        break;
      }
    }
    return pick < 0 ? opts[opts.length - 1] : pick;
  }

  // Commit to the next edge a few metres early and keep our lateral offset inside the band that maps
  // onto it (across it: |c*lat| <= its spread; along it: k*lat within the range _arrive allows), so
  // walkers drift into a narrow crossing or link in time instead of snapping onto it at the node.
  _plan(a, ctx) {
    const W = this.walk;
    const e = W.edges[a.edge];
    a.next = this._chooseNext(a, ctx);
    a.nextLo = -e.spread;
    a.nextHi = e.spread;
    if (a.next < 0) return;
    const n = W.edges[a.next];
    const ux = a.fwd ? e.ux : -e.ux;
    const uz = a.fwd ? e.uz : -e.uz;
    const out = n.a === (a.fwd ? e.b : e.a) ? 1 : -1;
    const c = (ux * n.ux + uz * n.uz) * out;
    const k = (uz * n.ux - ux * n.uz) * out;
    if (Math.abs(c) > 0.05) {
      const m = n.spread / Math.abs(c);
      a.nextLo = Math.max(a.nextLo, -m);
      a.nextHi = Math.min(a.nextHi, m);
    }
    // Along-edge range _arrive allows (a crossing's is the kerb strip where people wait).
    const sMin = n.kind === CROSS ? -Math.max(0, n.kerb - 0.3) : -0.5;
    const sMax = n.kind === CROSS ? Math.max(0, Math.min(n.kerb - 0.3, 0.3)) : Infinity;
    if (k > 0.05) {
      a.nextLo = Math.max(a.nextLo, sMin / k);
      a.nextHi = Math.min(a.nextHi, sMax / k);
    } else if (k < -0.05) {
      a.nextLo = Math.max(a.nextLo, sMax / k);
      a.nextHi = Math.min(a.nextHi, sMin / k);
    }
  }

  // Reached the end of the edge: move onto the chosen next one (or turn back at a dead end).
  _arrive(a, ctx) {
    const W = this.walk;
    const e = W.edges[a.edge];
    const nodeId = a.fwd ? e.b : e.a;
    const node = W.nodes[nodeId];
    const ux = a.fwd ? e.ux : -e.ux;
    const uz = a.fwd ? e.uz : -e.uz;
    const pick = a.next >= 0 ? a.next : this._chooseNext(a, ctx);
    a.next = -1;
    const over = a.s - e.len;
    if (pick < 0) {
      this._turnAround(a);
      a.s = 0;
      return;
    }
    const n = W.edges[pick];
    const fwd = n.a === nodeId;
    // Re-express the current position in the new edge's travel frame.
    const x = node.x + ux * over + uz * a.lat;
    const z = node.z + uz * over - ux * a.lat;
    const nux = fwd ? n.ux : -n.ux;
    const nuz = fwd ? n.uz : -n.uz;
    const rx = x - node.x;
    const rz = z - node.z;
    a.edge = pick;
    a.fwd = fwd;
    a.s = Math.max(-0.5, rx * nux + rz * nuz);
    a.lat = Math.max(-n.spread, Math.min(n.spread, rx * nuz - rz * nux));
    a.latGoal = this._laneGoal(a, n);
    if (n.kind === CROSS && a.state !== 'flee') {
      // Wait at the kerb, spread along it and behind whoever is already waiting.
      a.state = 'wait';
      a.waitT = 0;
      a.checkT = 0;
      this._place(a);
      const near = this.near(a.position.x, a.position.z, 1.4, this._near);
      let queued = 0;
      for (let i = 0; i < near.length; i++) if (near[i] !== a && near[i].state === 'wait') queued++;
      a.s = Math.max(-Math.max(0, n.kerb - 0.3), Math.min(a.s, n.kerb - 0.3, 0.3) - queued * 0.55);
      a.latGoal = (Math.random() * 2 - 1) * n.spread;
    } else if (a.state === 'cross' || a.state === 'wait') a.state = 'walk';
  }

  _wait(a, dt, ctx) {
    const e = this.walk.edges[a.edge];
    a.speed = approach(a.speed, 0, 4 * dt);
    a.s = Math.min(Math.min(0.35, Math.max(0, e.kerb - 0.3)), a.s + a.speed * dt);
    a.lat = approach(a.lat, Math.max(-e.spread, Math.min(e.spread, a.latGoal)), 0.8 * dt);
    this._place(a);
    a.vx = 0;
    a.vz = 0;
    a.waitT += dt;
    const want = headingOf(this._ux(a), this._uz(a));
    a.heading += wrapAngle(want - a.heading) * Math.min(1, dt * 5);
    if ((a.checkT -= dt) > 0) return;
    a.checkT = 0.3 + Math.random() * 0.3;
    if (this._canCross(a, e, ctx)) {
      a.state = 'cross';
      a.hurry = 0;
    } else if (a.waitT > 30) {
      this._turnAround(a);
    }
  }

  // Is (x, z) inside a vehicle's footprint grown by `pad`?
  _carAt(x, z, pad) {
    const cars = this.game.traffic?.vehiclesNear?.(x, z, pad + 0.5);
    if (!cars?.length) return false;
    for (let i = 0; i < cars.length; i++) {
      const v = cars[i];
      const dx = x - v.position.x;
      const dz = z - v.position.z;
      const fx = -Math.sin(v.heading);
      const fz = -Math.cos(v.heading);
      if (Math.abs(dx * fx + dz * fz) < (v.length || 4.5) / 2 + pad && Math.abs(dx * fz - dz * fx) < (v.width || 1.8) / 2 + pad) return true;
    }
    return false;
  }

  _canCross(a, e, ctx) {
    const traffic = ctx.traffic;
    const W = this.walk;
    const A = W.nodes[a.fwd ? e.a : e.b];
    const Bn = W.nodes[a.fwd ? e.b : e.a];
    // Never set off into a car stopped across the crossing, whatever the lights say.
    for (let k = 1; k <= 4; k++) {
      const f = k / 5;
      if (this._carAt(A.x + (Bn.x - A.x) * f, A.z + (Bn.z - A.z) * f, 0.6)) return false;
    }
    if (e.jn >= 0 && traffic?.signalAt) {
      const sig = traffic.signalAt(e.jn, e.from);
      if (sig === 'red') return true;
      if (sig === 'green' || sig === 'amber') return false;
    }
    const mx = (A.x + Bn.x) / 2;
    const mz = (A.z + Bn.z) / 2;
    const cars = traffic?.vehiclesNear?.(mx, mz, 30);
    if (!cars?.length) return true;
    const patient = a.waitT < 12;
    for (let i = 0; i < cars.length; i++) {
      const v = cars[i];
      const vx = v.position.x;
      const vz = v.position.z;
      // Distance from the car to the crossing line.
      const dx = Bn.x - A.x;
      const dz = Bn.z - A.z;
      let t = ((vx - A.x) * dx + (vz - A.z) * dz) / (e.len * e.len);
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(vx - A.x - dx * t, vz - A.z - dz * t);
      const speed = Math.abs(v.speed || 0);
      if (d < 3.2 + (v.length || 4) / 2) {
        if (speed > 0.3 || patient) return false;
        continue; // weave between stopped cars once we've waited a while
      }
      const toward = -Math.sin(v.heading) * (mx - vx) - Math.cos(v.heading) * (mz - vz);
      if (toward > 0 && speed > 0.8 && d < 4 + speed * (patient ? 2.8 : 1.6)) return false;
    }
    return true;
  }

  _vehicleThreat(x, z, r) {
    const cars = this.game.traffic?.vehiclesNear?.(x, z, r);
    if (!cars?.length) return false;
    for (let i = 0; i < cars.length; i++) if (Math.abs(cars[i].speed || 0) > 1.5) return true;
    return false;
  }

  // Standing agents: face their spot's heading (or their group), shuffle habits.
  _stand(a, dt, ctx) {
    a.speed = 0;
    a.vx = 0;
    a.vz = 0;
    if (a.home) {
      let want = a.home.heading;
      if (a.group) {
        want = headingOf(a.group.x - a.position.x, a.group.z - a.position.z);
      }
      a.heading += wrapAngle(want - a.heading) * Math.min(1, dt * 3);
    }
  }

  // --- Reactions -------------------------------------------------------------------------------

  startReaction(a, type, dur, delay) {
    // Someone halfway across the road finishes crossing first.
    if (a.state === 'cross') return;
    if (a.state === 'react') {
      a.react.type = type;
      a.react.start = Math.min(a.react.start, this.game.time + delay);
      a.react.until = this.game.time + delay + dur;
      return;
    }
    a.resume = a.state;
    a.state = 'react';
    a.react = { type, start: this.game.time + delay, until: this.game.time + delay + dur };
  }

  startFlee(a, dur, px, pz) {
    if (a.edge < 0) {
      this.startReaction(a, 'cover', dur, 0.1);
      return;
    }
    // Running toward Spider-Man, or about to bolt into the road from the kerb (also while turned to
    // watch him)? Turn around first.
    const toward = this._ux(a) * (px - a.position.x) + this._uz(a) * (pz - a.position.z) > 0;
    const atKerb = a.state === 'wait' || (a.state === 'react' && a.resume === 'wait');
    if (toward || atKerb) this._turnAround(a);
    a.next = -1; // route away from him from the next node on
    a.state = 'flee';
    a.timer = dur;
    a.react = null;
  }

  _reacting(a, dt, ctx) {
    const t = this.game.time;
    const r = a.react;
    if (t > r.until && r.next) {
      this.startReaction(a, r.next.type, r.next.dur, 0);
      a.react.next = null;
      return;
    }
    if (t > r.until) {
      a.state = a.resume || 'walk';
      a.react = null;
      if (a.state === 'walk' && a.edge < 0) a.state = 'idle';
      return;
    }
    a.speed = approach(a.speed, 0, 5 * dt);
    if (a.edge >= 0 && a.speed > 0.01) {
      a.s += a.speed * dt;
      if (a.s < this.walk.edges[a.edge].len) this._place(a);
    }
    a.vx = 0;
    a.vz = 0;
    if (t < r.start) return;
    // Turn to face Spider-Man (people sitting down only turn their heads).
    if (a.pose.sit < 0.5) {
      const want = headingOf(ctx.px - a.position.x, ctx.pz - a.position.z);
      a.heading += wrapAngle(want - a.heading) * Math.min(1, dt * 4);
    }
  }

  // --- Animation -------------------------------------------------------------------------------

  // Which clip this person plays now, how fast, and where they look. Walking clips are stride-matched:
  // playback rate = ground speed / (clip speed x the variant's stride scale x the person's scale).
  _animate(a, dt, ctx) {
    const H = this.humans;
    const L = a.look;
    const V = L.variant;
    const an = a.anim;
    const p = a.pose;
    const t = this.game.time;
    if (!H || !V) return;
    const sp = a.state === 'react' || a.state === 'wait' ? a.speed : Math.hypot(a.vx, a.vz);
    const mobile = a.state === 'walk' || a.state === 'cross' || a.state === 'flee' || a.state === 'react' || a.state === 'wait';
    an.moving = mobile && (an.moving ? sp > 0.08 : sp > 0.22);

    // Standing habits: a phone call, folded arms, looking about.
    if (a.state === 'idle' || a.state === 'wait' || a.state === 'chat' || a.state === 'vendor') {
      if ((a.habitT -= dt) <= 0) {
        const r = Math.random();
        const guard = L.archetype === 'security_guard' || L.archetype === 'police';
        if (guard) a.habit = r < 0.45 ? 'fold' : r < 0.8 ? 'look' : null;
        else if (a.state === 'chat') a.habit = null;
        else a.habit = r < 0.2 ? 'call' : r < 0.36 ? 'fold' : r < 0.48 ? 'look' : null;
        if (a.lounge || a.stall?.sit) a.habit = null;
        a.habitT = 5 + Math.random() * 12;
      }
    } else a.habit = null;

    let name = 'idle_relaxed';
    let rate = a.tempo;
    let phone = false;
    let sit = 0;
    const reacting = a.state === 'react' && t >= a.react.start;
    if (an.moving) {
      if (L.runSpeed && sp > Math.max(2.2, L.walkMax * 1.05)) {
        name = 'flee_run';
        rate = sp / (H.clips.flee_run.speed * V.stride * L.scale);
      } else {
        name = a.walkClip;
        rate = Math.min(2.2, Math.max(0.3, sp / ((H.clips[name]?.speed || 1.05) * V.stride * L.scale)));
      }
    } else if (a.stall?.sit) {
      sit = 1;
      name = a.talkUntil > t ? 'sit_talk' : 'sit_idle';
    } else if (a.lounge) {
      sit = 2;
      name = 'sit_ground';
    } else if (reacting) {
      switch (a.react.type) {
        case 'point':
          name = 'point';
          break;
        case 'photo':
          name = 'phone_film';
          phone = true;
          break;
        case 'wave':
          name = 'wave';
          break;
        case 'cheer':
          name = 'cheer';
          break;
        case 'cover':
          // Flinch, then stand braced.
          if (!an.once && an.clip?.name !== 'hit_head' && t - a.react.start < 0.2) this._once(a, 'hit_head');
          name = 'idle_arms_folded';
          break;
        default:
          name = 'idle_relaxed';
      }
    } else if (a.kind === 'hwindi' && a.timer > 0) {
      name = 'call_out';
    } else if (a.talkUntil > t) {
      name = a.talkClip;
    } else if (a.habit === 'call') {
      name = 'phone_call';
      phone = true;
    } else if (a.habit === 'fold') {
      name = 'idle_arms_folded';
    } else if (a.habit === 'look') {
      name = 'idle_look';
    } else if (a.group && a.state === 'chat') {
      // Listeners nod along now and then.
      if (t > an.nodAt) {
        if (an.nodAt) this._once(a, 'nod_yes');
        an.nodAt = t + 5 + Math.random() * 12;
      }
    }
    if (a.kind === 'hwindi' && a.state !== 'react') {
      a.timer -= dt;
      if (a.timer < -4 - (a.id % 5)) a.timer = 2 + (a.id % 3);
    }
    if (an.once && !an.moving && !sit && t < an.onceUntil) name = an.once;
    else an.once = null;
    if (a.forceClip) name = a.forceClip; // (testing: window.__game.npcs.list[i].forceClip = 'wave')
    this._play(a, name, rate);
    a.phone = phone;
    p.sit = sit;
    if (an.prev) {
      an.pt += dt * an.prate;
      an.blend -= dt / an.fade;
      if (an.blend <= 0) {
        an.blend = 0;
        an.prev = null;
      }
    }
    an.t += dt * an.rate;
    if (an.t > 1e4) an.t %= an.clip.dur;

    // Where they look: at Spider-Man when he is close on foot or they react to him, at whoever holds
    // the floor in a chat, or a glance around now and then.
    let headYaw = 0;
    let headPitch = 0;
    if (a.group && a.state === 'chat') {
      const g = a.group;
      const sp2 = g.members[g.speaker];
      if (sp2 === a) a.talkUntil = Math.max(a.talkUntil, t + 0.1);
      else if (sp2) headYaw = wrapAngle(headingOf(sp2.position.x - a.position.x, sp2.position.z - a.position.z) - a.heading);
    }
    if ((a.glanceT -= dt) <= 0) {
      a.glance = Math.random() < 0.35 ? (Math.random() - 0.5) * 1.4 : 0;
      a.glanceT = 1.5 + Math.random() * 3;
    }
    const dxp = ctx.px - a.position.x;
    const dzp = ctx.pz - a.position.z;
    const d2 = dxp * dxp + dzp * dzp;
    let watching = reacting;
    if (!watching && ctx.playerOnFoot && d2 < 64 && a.state !== 'flee') watching = true;
    if (watching) {
      const d = Math.sqrt(d2);
      headYaw = Math.max(-1.1, Math.min(1.1, wrapAngle(headingOf(dxp, dzp) - a.heading)));
      headPitch = Math.max(-0.45, Math.min(0.85, Math.atan2(ctx.py + 1.2 - a.mouthY, d)));
      // Clips that already aim the head or hands forward (filming, pointing) only need the pitch.
      if (name === 'phone_film' || name === 'point') headYaw *= 0.4;
    } else if (!a.habit && !a.group && an.moving) headYaw = a.glance * 0.6;
    else if (!a.habit && !a.group && !an.moving) headYaw = a.glance;
    if (a.state === 'flee' || name === 'hit_head') {
      headYaw = 0;
      headPitch = 0;
    }
    p.headYaw += (headYaw - p.headYaw) * Math.min(1, dt * 5);
    p.headPitch += (headPitch - p.headPitch) * Math.min(1, dt * 5);
  }

  // Start a one-shot clip (nod, flinch) over whatever the person is doing while standing.
  _once(a, name) {
    const clip = this.humans?.clips[name];
    if (!clip || !a.look.variant?.has(name)) return;
    a.anim.once = name;
    a.anim.onceUntil = this.game.time + clip.dur / a.tempo - 0.1;
  }

  // Switch to clip `name` (fading from the current one) or just update the playback rate.
  _play(a, name, rate) {
    const H = this.humans;
    const V = a.look.variant;
    while (!V.has(name)) name = FALLBACK[name] || (V.has('walk') ? 'walk' : 'walk_female');
    const clip = H.clips[name];
    const an = a.anim;
    if (clip !== an.clip) {
      if (an.clip) {
        // A swap in the middle of a fade drops the older clip.
        an.prev = an.clip;
        an.pt = an.t;
        an.prate = an.rate;
        an.blend = 1;
        an.fade = SEATED.has(name) || SEATED.has(an.clip.name) ? FADE_SIT : FADE;
      }
      an.clip = clip;
      // Loops start somewhere in their cycle (so a crowd never moves in step); one-shots at the start.
      an.t = clip.loop && !an.moving ? Math.random() * clip.dur : 0;
    }
    an.rate = rate;
  }
}
