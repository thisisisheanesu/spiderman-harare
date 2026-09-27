import * as THREE from 'three';
import { makeRng, hashString } from '../core/rng.js';
import { TRAFFIC } from '../data/streetlife.js';
import { RoadGraph, GRID } from './roadGraph.js';
import { Signals } from './signals.js';
import { Simulation, GAP_LEADER, GAP_OBSTACLE } from './simulation.js';
import { Vehicle } from './vehicle.js';
import { TrafficMix } from './vehicleTypes.js';
import { buildStickerAtlas } from './vehicleMaterial.js';
import { VehicleRenderer } from './vehicleRenderer.js';
import { SpeechBubbles } from './bubbles.js';
import { KombiLife } from './kombi.js';
import { streetVoices } from '../npc/streetVoices.js';

// Harare traffic: Honda Fits, Corollas, Hiluxes, Land Cruisers, ZUPCO buses and swarms of kombis
// driving on the LEFT through the real road graph, stopping at robots, loading at ranks.
//
// Public API (game.traffic):
//   vehicles                 [{position, heading, speed, type, length, width, height, parked}] — the active
//                            vehicles around the player plus parked rank kombis (position = body centre at
//                            road level; roof at position.y + height)
//   vehiclesNear(x, z, r)    vehicles whose footprint reaches within r of (x, z)
//   signalAt(node, fromNode) 'green' | 'amber' | 'red' | null for traffic entering `node` from `fromNode`
//   honk(vehicle)            hoot (rate-limited); returns true if it sounded
// Emits audio through game.audio.playSfx('horn' | 'kombiHoot', pos), playExtra (hwindi destination
// calls, via src/npc/streetVoices.js) and setAmbience('traffic', level).
// Vehicles brake for Spider-Man standing in the road and, anywhere in the simulated area, for the
// pedestrians game.npcs.crossers reports out on a carriageway (per-lane occupancy, see _markCrossers).
// On the Kopje (Skipper Hoste Drive) they drive on game.city.heightAt and pitch with the slope.

const SPAWN_RADIUS = 400;
const DESPAWN_RADIUS = 460;
const HIDDEN_SPAWN = 250;
const TELEPORT = 300;
const OBSTACLE_RANGE = 110;
const PLAYER_RANGE = 60;
// The city lays the carriageway this far above the Kopje's bare hillside (terrain.js roadHeightAt).
const ROAD_LIFT = 0.12;
// Crossing pedestrians: how far ahead along its route a vehicle looks for a blocked lane (m), and how
// far beside a lane's edge a crosser already counts (more when walking toward it).
const CROSS_LOOK = 45;
const CROSS_REACH = 0.9;
const CROSS_REACH_APPROACH = 2.6;

const _a = { x: 0, z: 0, dx: 0, dz: 0 };
const _b = { x: 0, z: 0, dx: 0, dz: 0 };
const _c = { x: 0, z: 0, dx: 0, dz: 0 };
const _proj = { s: 0, d2: 0 };

const DENSITY = TRAFFIC?.densityByHour;
const DENSITY_HOURS = DENSITY ? Object.keys(DENSITY).map(Number).sort((a, b) => a - b) : [];

function sampleChain(v, d, out) {
  if (d >= 0 || !v.prev) return v.path.sample(d, out);
  const d1 = v.prev.length + d;
  if (d1 >= 0 || !v.prev2) return v.prev.sample(d1, out);
  return v.prev2.sample(v.prev2.length + d1, out);
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Traffic density factor for an hour of the day, from the researched curve (never quite empty).
function densityAt(hour) {
  const keys = DENSITY_HOURS;
  if (!keys.length || !Number.isFinite(hour)) return 1;
  let lo = keys[keys.length - 1];
  let hi = keys[0];
  for (const k of keys) {
    if (k <= hour) lo = k;
    if (k > hour) {
      hi = k;
      break;
    }
  }
  const span = (hi - lo + 24) % 24 || 24;
  const t = ((hour - lo + 24) % 24) / span;
  const d = DENSITY[lo] + (DENSITY[hi] - DENSITY[lo]) * t;
  return 0.72 + 0.28 * d;
}

export class Traffic {
  constructor() {
    this.vehicles = [];
    this.focus = new THREE.Vector3();
    this._lastFocus = new THREE.Vector3(Infinity, 0, 0);
    this.night = 0;
    this._amb = 0;
    this._ambT = 0;
    this._hornT = 0;
  }

  async init(game) {
    this.game = game;
    const q = game.quality || {};
    const scale = q.traffic ?? 1;
    this.rng = makeRng(hashString('harare-traffic'));
    this.graph = new RoadGraph(game.data);
    this.signals = new Signals(this.graph, game.data, this.rng);
    this.signals.buildMeshes(game.scene);
    this.sim = new Simulation(this.graph, this.signals, this.rng);
    this.atlas = buildStickerAtlas();
    this.mix = new TrafficMix(this.atlas);
    this.target = Math.max(12, Math.round(140 * scale));
    const maxParked = Math.round(120 * scale);
    this.renderer = new VehicleRenderer(
      game.scene,
      this.atlas,
      { default: this.target, kombi: this.target + maxParked, kombiRack: Math.ceil(this.target * 0.4) + maxParked },
      !!q.shadows,
    );
    this.models = this.renderer.models;
    this.bubbles = new SpeechBubbles(game.scene, 3);
    this.voices = streetVoices(game);
    this._prepareGround(game);
    this._prepareCrossings();
    this.kombis = new KombiLife(this);
    this.kombis.setup(maxParked);
    game.events?.on('player:land', (e) => this._onLand(e));
  }

  // Road surface height: 0 except on the Kopje, where the carriageway lies ROAD_LIFT above the hill.
  // Lanes and connectors that touch the hill are flagged so only vehicles on them sample it.
  _prepareGround(game) {
    const city = game.city;
    this.groundAt = (x, z) => {
      const h = city?.heightAt?.(x, z) ?? 0;
      return h > 0.05 ? h + ROAD_LIFT : 0;
    };
    const p = { x: 0, z: 0, dx: 0, dz: 0 };
    for (const path of [...this.graph.lanes, ...this.graph.connectors]) {
      path.hill = false;
      for (let s = 0; s <= path.length + 4.9 && !path.hill; s += 5) {
        path.sample(Math.min(s, path.length), p);
        if (this.groundAt(p.x, p.z) > 0) path.hill = true;
      }
    }
  }

  // Per-lane occupancy for crossing pedestrians: lanes by road, each lane's half width, the connectors
  // leading into it, and the blocked stretch markers (reset every frame).
  _prepareCrossings() {
    this.lanesByRoad = new Map();
    for (const lane of this.graph.lanes) {
      if (!this.lanesByRoad.has(lane.roadIndex)) this.lanesByRoad.set(lane.roadIndex, []);
      this.lanesByRoad.get(lane.roadIndex).push(lane);
      const n = lane.siblings.length;
      lane.halfW = lane.road.w / (lane.road.oneway ? n : 2 * n) / 2;
      lane.ins = [];
    }
    for (const c of this.graph.connectors) c.to.ins.push(c);
    for (const path of [...this.graph.lanes, ...this.graph.connectors]) {
      path.blockLo = Infinity;
      path.blockHi = -Infinity;
    }
    this._marked = [];
  }

  update(dt, game) {
    this.focus.copy(game.player?.position ?? game.camera.position);
    game.camera.updateMatrixWorld();
    this.renderer.begin(game.camera, this.night);
    const teleported = this._lastFocus.distanceToSquared(this.focus) > TELEPORT * TELEPORT;
    this._lastFocus.copy(this.focus);
    this._updateNight(dt);
    this.signals.update(this.sim.time);
    this.signals.updateLamps(game.camera.position);
    if (teleported) this._repopulate();
    else {
      this._despawn();
      this._spawn(false);
    }
    this._obstacles(dt, game);
    this.sim.update(dt);
    this._drivers(dt);
    this.kombis.update(dt, this.focus);
    this.bubbles.update(dt, game.camera);
    this._render();
    this._ambience(dt, game);
    this._publish();
  }

  vehiclesNear(x, z, r) {
    const out = [];
    for (const v of this.vehicles) {
      const dx = v.position.x - x;
      const dz = v.position.z - z;
      const rr = r + v.length / 2;
      if (dx * dx + dz * dz <= rr * rr) out.push(v);
    }
    return out;
  }

  signalAt(node, fromNode) {
    return this.signals?.signalAt(node, fromNode) ?? null;
  }

  honk(v) {
    if (!v || v.honkCd > 0 || this._hornT > 0) return false;
    v.honkCd = 2.5 + this.rng() * 2.5;
    this._hornT = 0.35;
    const cam = this.game.camera.position;
    if (cam.distanceToSquared(v.position) > 170 * 170) return true;
    const big = v.type === 'bus' || v.type === 'truck';
    const small = v.type === 'hatch' || v.type === 'mushikashika';
    this.game.audio?.playSfx?.(v.type === 'kombi' ? 'kombiHoot' : 'horn', v.position, {
      volume: big ? 1 : 0.85,
      pitch: big ? 0.72 : small ? 1.12 : 1,
    });
    return true;
  }

  // ---- population ------------------------------------------------------------------------------

  _desired() {
    return Math.round(this.target * densityAt(this.game.sky?.timeOfDay));
  }

  _spawn(initial) {
    const want = this._desired();
    let tries = initial ? want * 40 : 6;
    while (this.sim.vehicles.length < want && tries-- > 0) this._trySpawn(initial);
  }

  _trySpawn(initial) {
    const f = this.focus;
    // Uniform in radius rather than area: denser near the player, where the streets are actually seen.
    const r = SPAWN_RADIUS * this.rng();
    const ang = this.rng() * Math.PI * 2;
    const cell = this.graph.slotsInCell(Math.floor((f.x + Math.cos(ang) * r) / GRID), Math.floor((f.z + Math.sin(ang) * r) / GRID));
    if (!cell) return;
    const slot = cell[Math.floor(this.rng() * cell.length)];
    if (this.rng() > slot.weight) return;
    const d = Math.hypot(slot.x - f.x, slot.z - f.z);
    if (d > SPAWN_RADIUS || d < 15) return;
    if (!initial && d < HIDDEN_SPAWN && this.renderer.inView(slot.x, 1 + this.groundAt(slot.x, slot.z), slot.z, 7)) return;
    const lane = slot.lane;
    for (const u of lane.vehicles) if (Math.abs(u.s - slot.s) < 16) return;
    const def = this.mix.pickType(this.rng, this.kombis.nearRank(slot.x, slot.z) ? 2.5 : 1);
    const v = new Vehicle();
    this.mix.dress(v, def, this.rng, this.models);
    const s = Math.min(lane.length - 1, Math.max(slot.s, v.length + 1));
    if (s < v.length) return;
    for (const u of lane.vehicles) if (u.s > s - v.length - 8 && u.s - u.length < s + 8) return;
    this.sim.add(v, lane, s, Math.min(lane.speedLimit * 0.6, 9));
    v.callT = this.rng.range(1, 12);
    this._pose(v, 0);
  }

  _despawn() {
    const vs = this.sim.vehicles;
    for (let i = vs.length - 1; i >= 0; i--) {
      const v = vs[i];
      const d = Math.hypot(v.position.x - this.focus.x, v.position.z - this.focus.z);
      // Gridlock breaker: a vehicle that has not moved for a long time is quietly recycled.
      const stuck = v.stuck > 130 || (v.stuck > 70 && (d > 90 || !this.renderer.inView(v.position.x, v.position.y + 1, v.position.z, v.length)));
      if (d > DESPAWN_RADIUS || stuck) this._remove(v);
    }
  }

  _remove(v) {
    this.bubbles.release(v);
    this.sim.remove(v);
  }

  _repopulate() {
    const vs = this.sim.vehicles;
    while (vs.length) this._remove(vs[vs.length - 1]);
    this.kombis.refreshNear(this.focus);
    this._spawn(true);
  }

  _publish() {
    const out = this.vehicles;
    out.length = 0;
    for (const v of this.sim.vehicles) out.push(v);
    for (const v of this.kombis.near) out.push(v);
  }

  // ---- per-vehicle behaviour around the player ---------------------------------------------------

  // Brake for Spider-Man standing in the road and for pedestrians crossing in front.
  _obstacles(dt, game) {
    const pl = game.player;
    const px = this.focus.x;
    const pz = this.focus.z;
    const onRoad = !!pl && pl.state === 'ground' && pl.position.y - this.groundAt(px, pz) < 1;
    const npcs = game.npcs;
    // Crossing pedestrians as per-lane occupancy: every vehicle sees them, at any distance, for the cost
    // of a few comparisons each. Without that list (older / placeholder npcs) nearby vehicles query
    // npcsNear instead.
    const crossers = Array.isArray(npcs?.crossers) ? npcs.crossers : null;
    if (crossers) this._markCrossers(crossers);
    const npcQuery = !crossers && typeof npcs?.npcsNear === 'function';
    const frame = game.frame || 0;
    for (const v of this.sim.vehicles) {
      v.obstacleGap = Infinity;
      v.blockedBy = 0;
      const dx = v.position.x - px;
      const dz = v.position.z - pz;
      const d2 = dx * dx + dz * dz;
      if (crossers) {
        const g = this._crossGap(v);
        if (g < Infinity) {
          v.obstacleGap = Math.max(0, g);
          v.blockedBy = 2;
        }
      }
      if (d2 > OBSTACLE_RANGE * OBSTACLE_RANGE) {
        v.npcGap = Infinity;
        continue;
      }
      const fx = -Math.sin(v.heading);
      const fz = -Math.cos(v.heading);
      const half = v.width / 2;
      const frontX = v.position.x + fx * v.length * 0.5;
      const frontZ = v.position.z + fz * v.length * 0.5;
      if (onRoad && d2 < PLAYER_RANGE * PLAYER_RANGE) {
        const rx = px - frontX;
        const rz = pz - frontZ;
        const along = rx * fx + rz * fz;
        const lat = rx * fz - rz * fx;
        if (along > -1 && along < 35 && Math.abs(lat) < half + 0.8 && Math.max(0, along - 1.2) < v.obstacleGap) {
          v.obstacleGap = Math.max(0, along - 1.2);
          v.blockedBy = 1;
        }
      }
      if (!npcQuery) continue;
      if ((v.id + frame) % 4 === 0) {
        let best = Infinity;
        const list = npcs.npcsNear(frontX + fx * 7, frontZ + fz * 7, 8.5) || [];
        for (const n of list) {
          const rx = n.position.x - frontX;
          const rz = n.position.z - frontZ;
          const along = rx * fx + rz * fz;
          const lat = rx * fz - rz * fx;
          if (along > -0.5 && along < 16 && Math.abs(lat) < half + 0.5) best = Math.min(best, along - 1.2);
        }
        v.npcGap = best;
      } else if (v.npcGap < Infinity) v.npcGap -= v.speed * dt;
      if (v.npcGap < v.obstacleGap) {
        v.obstacleGap = Math.max(0, v.npcGap);
        v.blockedBy = 2;
      }
    }
  }

  // Marks, on every lane of the road each crosser is crossing, the arc length where they are (or are
  // about to be) in it; a crosser just beyond a lane's end (in the junction mouth) marks the connectors
  // into / out of it instead.
  _markCrossers(list) {
    for (const p of this._marked) {
      p.blockLo = Infinity;
      p.blockHi = -Infinity;
    }
    this._marked.length = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!(a.id > 0) || !(a.crossRoad >= 0)) continue;
      const lanes = this.lanesByRoad.get(a.crossRoad);
      if (!lanes) continue;
      for (let k = 0; k < lanes.length; k++) this._markLane(lanes[k], a);
    }
  }

  _markLane(lane, a) {
    const x = a.position.x;
    const z = a.position.z;
    lane.project(x, z, _proj);
    const s = _proj.s;
    const inside = s > 0.01 && s < lane.length - 0.01;
    lane.sample(inside ? s : s <= 0.01 ? 0 : lane.length, _c);
    const rx = x - _c.x;
    const rz = z - _c.z;
    const lat = rx * _c.dz - rz * _c.dx;
    // Walking toward the lane's centreline: they will be in it by the time a car gets there.
    const toward = lat * (a.vx * _c.dz - a.vz * _c.dx) < -0.05;
    const reach = lane.halfW + (toward ? CROSS_REACH_APPROACH : CROSS_REACH);
    if (Math.abs(lat) > reach) return;
    if (inside) {
      this._mark(lane, s);
      return;
    }
    const along = rx * _c.dx + rz * _c.dz;
    if (s <= 0.01) {
      if (along < -12) return;
      for (const c of lane.ins) this._mark(c, Math.max(0, c.length + Math.min(0, along)));
      this._mark(lane, 0);
    } else {
      if (along > 12) return;
      for (const c of lane.out) this._mark(c, Math.min(c.length, Math.max(0, along)));
    }
  }

  _mark(path, s) {
    if (path.blockLo === Infinity && path.blockHi === -Infinity) this._marked.push(path);
    if (s < path.blockLo) path.blockLo = s;
    if (s > path.blockHi) path.blockHi = s;
  }

  // Distance from the front bumper to the nearest crossing pedestrian ahead on v's route (minus a
  // margin), or Infinity.
  _crossGap(v) {
    const p = v.path;
    if (!p) return Infinity;
    const min = v.s - 0.5;
    const b = p.blockLo >= min ? p.blockLo : p.blockHi >= min ? p.blockHi : Infinity;
    if (b < Infinity) return b - v.s - 1.2;
    let dist = p.length - v.s;
    if (dist > CROSS_LOOK) return Infinity;
    const next = p.isLane ? v.next : p.to;
    if (!next) return Infinity;
    if (next.blockLo < Infinity) return dist + next.blockLo - 1.2;
    dist += next.length;
    if (!p.isLane || dist > CROSS_LOOK) return Infinity;
    const lane = next.to;
    return lane && lane.blockLo < Infinity ? dist + lane.blockLo - 1.2 : Infinity;
  }

  _drivers(dt) {
    this._hornT -= dt;
    for (const v of this.sim.vehicles) {
      if (v.leaveT > 0) v.leaveT -= dt;
      if (v.blinkT > 0) v.blinkT -= dt;
      if (v.honkCd > 0) v.honkCd -= dt;
      const pulling = v.dwell > 0 || (v.stopLane === v.path && v.stopS - v.s < 30);
      const want = pulling ? Math.max(0, Math.min(1.5, v.path.kerbSpace - v.width / 2 - 0.25)) : 0;
      v.kerbShift += Math.max(-0.9 * dt, Math.min(0.9 * dt, want - v.kerbShift));
      this._pose(v, dt);

      if (v.honkIn > 0 && (v.honkIn -= dt) <= 0) this.honk(v);
      if (v.blockedBy === 1 && v.gapKind === GAP_OBSTACLE && v.speed < 1) {
        v.blockedT += dt;
        if (v.blockedT > 1.2 && this.honk(v)) v.blockedT = -this.rng.range(1, 3);
      } else if (v.blockedT > 0) v.blockedT = 0;
      if (!v.wild && v.gapKind === GAP_LEADER && v.leader?.dwell > 0 && v.speed < 0.3) {
        v.impatience += dt;
        if (v.impatience > 3.5) {
          if (this.rng() < 0.6) this.honk(v);
          v.impatience = -8;
        }
      } else if (v.impatience > 0) v.impatience = 0;
    }
  }

  // Places the body from its two axle points along the route (so cars swing naturally through bends),
  // then adds lane-change / kerb offsets, steering, and a little pitch and roll.
  _pose(v, dt) {
    const dF = v.s - v.frontAxle;
    sampleChain(v, dF, _a);
    sampleChain(v, dF - v.wheelbase, _b);
    let fx = _a.x - _b.x;
    let fz = _a.z - _b.z;
    const l = Math.hypot(fx, fz) || 1;
    fx /= l;
    fz /= l;
    const lat = v.lateral + v.kerbShift;
    const mid = v.model.axleMid;
    let heading = Math.atan2(-fx, -fz);
    if (dt > 0) heading += Math.atan2((lat - v.latPrev) / dt, Math.max(v.speed, 3)) * 0.8;
    v.latPrev = lat;
    // On the Kopje: wheels on the road surface under each axle, body pitched along the slope.
    let y = 0;
    let slope = 0;
    if (v.path?.hill || v.prev?.hill || v.prev2?.hill) {
      const hF = this.groundAt(_a.x, _a.z);
      const hR = this.groundAt(_b.x, _b.z);
      const grade = (hF - hR) / Math.max(1, v.wheelbase);
      slope = Math.atan(grade);
      y = hF - (v.length / 2 - v.frontAxle) * grade;
    }
    v.slope = slope;
    v.position.set((_a.x + _b.x) / 2 - fx * mid + fz * lat, y, (_a.z + _b.z) / 2 - fz * mid - fx * lat);
    if (dt > 0) {
      const rate = wrapAngle(heading - v.heading) / dt;
      const k = Math.min(1, dt * 6);
      const steer = Math.max(-0.6, Math.min(0.6, Math.atan((rate * v.wheelbase) / Math.max(v.speed, 1))));
      v.steer += (steer - v.steer) * k;
      const pitch = Math.max(-0.035, Math.min(0.02, v.acc * 0.005));
      v.pitch += (pitch - v.pitch) * k;
      const roll = Math.max(-0.05, Math.min(0.05, -rate * v.speed * (v.type === 'kombi' ? 0.018 : 0.01)));
      v.roll += (roll - v.roll) * k;
    }
    v.heading = heading;
  }

  // ---- presentation ------------------------------------------------------------------------------

  _updateNight(dt) {
    const sky = this.game.sky;
    const hour = sky?.timeOfDay;
    let want = sky?.isNight ? 1 : 0;
    if (typeof sky?.nightFactor === 'number') want = Math.max(want, sky.nightFactor);
    if (typeof hour === 'number' && (hour < 6.2 || hour > 17.6)) want = 1;
    this.night += (want - this.night) * Math.min(1, dt * 2);
  }

  _render() {
    const r = this.renderer;
    const time = this.sim.time;
    const blinkOn = (time * 1.5) % 1 < 0.55 ? 1 : 0;
    const head = this.night;
    for (const v of this.sim.vehicles) {
      const brake = v.acc < -1.2 || (v.speed < 0.3 && v.dwell <= 0) ? 1 : 0;
      let bl = 0;
      if (v.dwell > 0) bl = v.type === 'kombi' ? 2 : -1;
      else if (v.stopLane === v.path && v.stopS - v.s < 45) bl = -1;
      else if (v.leaveT > 0) bl = 1;
      else if (v.blinkT > 0) bl = v.blink;
      else if (v.next && (v.next.turn === 'left' || v.next.turn === 'right') && this.sim.distToLine(v) < 35) bl = v.next.turn === 'left' ? -1 : 1;
      const left = bl === -1 || bl === 2 ? blinkOn : 0;
      const right = bl === 1 || bl === 2 ? blinkOn : 0;
      r.add(v, head, brake, left, right, v.hwindi ? (v.dwell > 0 ? 2 : 1) : 0, time);
    }
    for (const v of this.kombis.near) r.add(v, 0, 0, 0, 0, v.hwindi ? 2 : 0, time);
    r.end();
  }

  _ambience(dt, game) {
    this._ambT -= dt;
    if (this._ambT > 0) return;
    this._ambT = 0.25;
    const cam = game.camera.position;
    let sum = 0;
    for (const v of this.sim.vehicles) {
      const d = cam.distanceTo(v.position);
      if (d > 90) continue;
      const w = 1 - d / 90;
      sum += w * w * (0.3 + 0.7 * Math.min(1, v.speed / 12));
    }
    this._amb += (Math.min(1, sum / 3.5) - this._amb) * 0.5;
    game.audio?.setAmbience?.('traffic', this._amb);
  }

  // A hard landing next to the road makes the nearest drivers lean on their horns.
  _onLand(e) {
    if (!e?.hard || !e.pos) return;
    let n = 0;
    for (const v of this.sim.vehicles) {
      if (n >= 2) break;
      if (Math.abs(v.position.x - e.pos.x) < 18 && Math.abs(v.position.z - e.pos.z) < 18) {
        v.honkIn = 0.2 + n * 0.5;
        n++;
      }
    }
  }
}
