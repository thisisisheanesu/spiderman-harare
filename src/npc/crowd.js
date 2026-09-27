import * as THREE from 'three';
import { CROSS, WALK } from './walkways.js';
import { FLAG } from './bodies.js';

// Crowd simulation: agents walk the pedestrian network (edge + arc length + lateral offset inside the
// edge's validated band), wait at kerbs for a gap or a red light, dodge each other and the stalls,
// stand in chatting groups, sell at stalls, and react to Spider-Man.

const TAU = Math.PI * 2;
const HASH_SIZE = 4096;
const HASH_CELL = 2.5;
const LOOK = 2.6; // avoidance look-ahead (m)

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

// Arm poses: [shoulder pitch, shoulder roll, elbow] (see bodies.js for the conventions).
const ARMS = {
  text: [0.5, 0.1, 1.55],
  textL: [0.42, -0.12, 1.45],
  call: [0.3, 0.42, 2.55],
  photo: [1.3, -0.26, 0.6],
  cheer: [2.85, 0.32, 0.25],
  point: [1.55, 0.05, 0.05],
  wave: [2.55, 0.55, 0.6],
  steady: [2.8, 0.2, 1.35],
  cover: [2.25, -0.15, 2.1],
  talk: [0.55, 0.15, 1.25],
  fold: [0.38, -0.32, 1.95],
  rest: [0.85, 0.1, 0.75],
  prop: [-0.62, 0.3, 0.12], // sitting on the grass, leaning back on the hands
  hwindi: [2.4, 0.7, 0.5],
  bag: [0.05, 0.14, 0.12],
};

function setArm(arm, pose, w = 1) {
  arm[0] = pose[0];
  arm[1] = pose[1];
  arm[2] = pose[2];
  arm[3] = w;
}

export class Agent {
  constructor() {
    this.id = 0;
    this.position = new THREE.Vector3();
    this.heading = 0;
    this.gender = 'female';
    this.state = 'walk'; // walk | wait | cross | idle | chat | vendor | react | flee
    this.name = '';
    this.role = '';
    this.look = null;
    this.phase = 0;
    this.pose = { gait: 0, headYaw: 0, headPitch: 0, lean: 0, sit: 0, flags: 0, armR: new Float32Array(4), armL: new Float32Array(4) };
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
    this.phase = Math.random() * TAU;
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
    this.nextBubble = 0;
    this.nextGreet = 0;
    this.lastSpoke = -1e9;
    this.vx = 0;
    this.vz = 0;
    const p = this.pose;
    p.gait = 0;
    p.headYaw = 0;
    p.headPitch = 0;
    p.lean = 0;
    p.sit = 0;
    p.flags = 0;
    p.armR.fill(0);
    p.armL.fill(0);
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
    this._armR = new Float32Array(4);
    this._armL = new Float32Array(4);
    this._near = [];
    // Static obstacles (stalls) in a coarse grid; each is filed under every cell within look-ahead.
    this.obGrid = new Map();
    for (const o of obstacles) {
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
    a.position.y = W.heightOn(e, a.fwd ? a.s : e.len - a.s);
  }

  update(dt, ctx) {
    const list = this.agents;
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
    }
  }

  _move(a, dt, ctx) {
    const W = this.walk;
    const e = W.edges[a.edge];
    const ux = a.fwd ? e.ux : -e.ux;
    const uz = a.fwd ? e.uz : -e.uz;
    let target = a.prefSpeed;
    if (a.state === 'cross') target *= 1.25;
    if (a.state === 'flee') {
      target = 3.6 + (a.look.child ? 0.4 : 0);
      a.timer -= dt;
      if (a.timer <= 0) a.state = 'walk';
    }
    // Cars: hurry across when one bears down on the crossing; on the pavement, give a kombi that
    // mounts the kerb a wide berth.
    if ((a.checkT -= dt) <= 0) {
      a.checkT = a.state === 'cross' ? 0.4 : 0.6 + Math.random() * 0.4;
      a.hurry = this._vehicleThreat(a.position.x, a.position.z, a.state === 'cross' ? 7 : 1.5) ? 1 : 0;
    }
    if (a.hurry && a.state === 'cross') target = 3.2;

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
    a.lat = approach(a.lat, Math.max(-spread, Math.min(spread, a.latGoal)), 0.8 * dt);
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
    const cells = this.obstaclesOn && this.obGrid.get(this._cellKey(Math.floor(x / 8), Math.floor(z / 8)));
    if (cells) {
      for (const o of cells) {
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
    // Pass on the side with room; oncoming walkers both keep left.
    const passL = a.lat + side + clear;
    const passR = a.lat + side - clear;
    const okL = passL <= spread;
    const okR = passR >= -spread;
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
    a.s = Math.max(0, e.len - a.s);
    a.lat = -a.lat;
    a.latGoal = a.lat;
    a.blocked = 0;
    if (a.state === 'cross' || a.state === 'wait') a.state = 'walk';
  }

  // Reached the end of the edge: pick the next one (or turn back at a dead end).
  _arrive(a, ctx) {
    const W = this.walk;
    const e = W.edges[a.edge];
    const nodeId = a.fwd ? e.b : e.a;
    const node = W.nodes[nodeId];
    const ux = a.fwd ? e.ux : -e.ux;
    const uz = a.fwd ? e.uz : -e.uz;
    const opts = node.edges;
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
    const over = a.s - e.len;
    if (total <= 0) {
      this._turnAround(a);
      a.s = 0;
      return;
    }
    let r = Math.random() * total;
    for (let i = 0; i < opts.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        pick = opts[i];
        break;
      }
    }
    if (pick < 0) pick = opts[opts.length - 1];
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
    a.s = Math.min(Math.min(0.35, e.kerb - 0.3), a.s + a.speed * dt);
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
    // Running toward Spider-Man, or about to bolt into the road from the kerb? Turn around first.
    const toward = this._ux(a) * (px - a.position.x) + this._uz(a) * (pz - a.position.z) > 0;
    if (toward || a.state === 'wait') this._turnAround(a);
    if (a.state === 'react') a.state = 'walk';
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

  _animate(a, dt, ctx) {
    const p = a.pose;
    const L = a.look;
    const t = this.game.time;
    const sp = a.state === 'react' || a.state === 'wait' ? a.speed : Math.hypot(a.vx, a.vz);
    const gait = sp < 0.05 ? 0 : sp < 1.8 ? Math.min(1, sp / 1.1) : 1 + Math.min(1, (sp - 1.8) / 1.6);
    p.gait += (gait - p.gait) * Math.min(1, dt * 6);
    // Stride from the same hip swing the shader uses (four leg-lengths x sin(amplitude) per cycle,
    // plus flight when running) so feet do not slide.
    const walk = Math.min(1, p.gait);
    const run = Math.max(0, Math.min(1, p.gait - 1));
    const amp = (0.42 * walk + 0.36 * run) * (L.flags & FLAG.LONG ? 0.72 : 1);
    const stride = L.scale * Math.max(0.35, 3.36 * Math.sin(amp) + 0.9 * run);
    a.phase += sp > 0.05 ? (TAU * sp * dt) / stride : dt * 1.4;
    if (a.phase > 1e4) a.phase -= TAU * 1000;

    const R = this._armR;
    const Lw = this._armL;
    R[3] = 0;
    Lw[3] = 0;
    let headYaw = 0;
    let headPitch = 0;
    let lean = 0;
    let sit = 0;
    let flags = 0;

    // Habits for people standing around: texting, a phone call, folded arms.
    if (a.state === 'idle' || a.state === 'wait' || a.state === 'chat' || a.state === 'vendor' || a.state === 'walk') {
      if ((a.habitT -= dt) <= 0) {
        const r = Math.random();
        const still = a.state !== 'walk';
        a.habit = r < (still ? 0.28 : 0.12) ? 'text' : r < (still ? 0.38 : 0.16) ? 'call' : still && r < 0.55 && a.state !== 'chat' ? 'fold' : null;
        if (a.lounge && a.habit !== 'text') a.habit = null;
        a.habitT = 4 + Math.random() * 10;
      }
    } else a.habit = null;

    if (a.stall?.sit && a.state !== 'react') {
      sit = 1;
      setArm(R, ARMS.rest);
      setArm(Lw, ARMS.rest);
    } else if (a.lounge) {
      sit = 2;
      lean = -0.12;
      setArm(R, ARMS.prop);
      setArm(Lw, ARMS.prop);
    }
    if (L.flags & FLAG.LOAD && a.id % 3 !== 0) setArm(Lw, ARMS.steady);
    if (L.flags & FLAG.BAGHAND) setArm(Lw, ARMS.bag, 0.6);

    switch (a.habit) {
      case 'text':
        setArm(R, ARMS.text);
        if (!(L.flags & FLAG.LOAD)) setArm(Lw, ARMS.textL);
        headPitch = -0.42;
        flags |= FLAG.PHONE;
        break;
      case 'call':
        setArm(R, ARMS.call);
        headYaw = 0.25;
        flags |= FLAG.PHONE;
        break;
      case 'fold':
        if (!sit) {
          setArm(R, ARMS.fold);
          setArm(Lw, ARMS.fold);
        }
        break;
    }

    if (a.kind === 'hwindi' && a.state !== 'react') {
      const k = Math.sin(t * 7 + a.id);
      R[0] = ARMS.hwindi[0] + 0.25 * k;
      R[1] = ARMS.hwindi[1] + 0.2 * k;
      R[2] = ARMS.hwindi[2];
      R[3] = a.timer > 0 ? 1 : 0;
      a.timer -= dt;
      if (a.timer < -4 - (a.id % 5)) a.timer = 2 + (a.id % 3);
    }

    // Chatting groups look at whoever holds the floor; the speaker gestures.
    if (a.group && a.state === 'chat') {
      const g = a.group;
      const sp2 = g.members[g.speaker];
      if (sp2 === a) {
        a.talkUntil = Math.max(a.talkUntil, t + 0.1);
      } else if (sp2) {
        headYaw = wrapAngle(headingOf(sp2.position.x - a.position.x, sp2.position.z - a.position.z) - a.heading);
      }
    }

    // Glance around now and then; look at Spider-Man when he is close on foot.
    if ((a.glanceT -= dt) <= 0) {
      a.glance = Math.random() < 0.35 ? (Math.random() - 0.5) * 1.6 : 0;
      a.glanceT = 1.5 + Math.random() * 3;
    }
    const dxp = ctx.px - a.position.x;
    const dzp = ctx.pz - a.position.z;
    const d2 = dxp * dxp + dzp * dzp;
    let watching = a.state === 'react' && t >= a.react.start;
    if (!watching && ctx.playerOnFoot && d2 < 64) watching = true;
    if (watching) {
      const d = Math.sqrt(d2);
      headYaw = Math.max(-1.25, Math.min(1.25, wrapAngle(headingOf(dxp, dzp) - a.heading)));
      headPitch = Math.max(-0.5, Math.min(1.0, Math.atan2(ctx.py + 1.2 - (a.position.y + 1.55 * L.scale), d)));
    } else if (!a.habit && !a.group) headYaw = a.glance;

    if (a.state === 'react' && t >= a.react.start) {
      const k = Math.sin(t * 9 + a.id);
      const up = headPitch;
      switch (a.react.type) {
        case 'cheer':
          setArm(R, ARMS.cheer);
          setArm(Lw, ARMS.cheer);
          R[0] += 0.2 * k;
          Lw[0] -= 0.2 * k;
          break;
        case 'point':
          setArm(R, ARMS.point);
          R[0] += up;
          break;
        case 'photo':
          setArm(R, ARMS.photo);
          setArm(Lw, ARMS.photo);
          R[0] += up * 0.8;
          Lw[0] += up * 0.8;
          flags |= FLAG.PHONE;
          break;
        case 'wave':
          setArm(R, ARMS.wave);
          R[1] += 0.3 * k;
          break;
        case 'cover':
          setArm(R, ARMS.cover);
          setArm(Lw, ARMS.cover);
          sit = Math.max(sit, 0.18);
          lean = 0.25;
          headPitch = -0.3;
          break;
      }
    }

    // Talking (a real voice clip or group chatter): nods and a hand that moves with the words.
    if (a.talkUntil > t) {
      headPitch += 0.07 * Math.sin(t * 8.3 + a.id) + 0.04 * Math.sin(t * 13.1);
      if (R[3] < 0.5) {
        R[0] = ARMS.talk[0] + 0.25 * Math.sin(t * 4.3 + a.id);
        R[1] = ARMS.talk[1];
        R[2] = ARMS.talk[2] + 0.35 * Math.sin(t * 3.1);
        R[3] = 0.85;
      }
    }

    if (a.state === 'flee') lean = 0.1;
    const k = Math.min(1, dt * 7);
    for (let i = 0; i < 4; i++) {
      p.armR[i] += (R[i] - p.armR[i]) * k;
      p.armL[i] += (Lw[i] - p.armL[i]) * k;
    }
    p.headYaw += (headYaw - p.headYaw) * Math.min(1, dt * 5);
    p.headPitch += (headPitch - p.headPitch) * Math.min(1, dt * 5);
    p.lean += (lean - p.lean) * k;
    p.sit += (sit - p.sit) * Math.min(1, dt * 4);
    p.flags = flags;
  }
}
