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
// Emits audio through game.audio.playSfx('horn' | 'kombiHoot', pos) and setAmbience('traffic', level).

const SPAWN_RADIUS = 400;
const DESPAWN_RADIUS = 460;
const HIDDEN_SPAWN = 250;
const TELEPORT = 300;
const OBSTACLE_RANGE = 110;
const PLAYER_RANGE = 60;

const _a = { x: 0, z: 0, dx: 0, dz: 0 };
const _b = { x: 0, z: 0, dx: 0, dz: 0 };

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
    this.kombis = new KombiLife(this);
    this.kombis.setup(maxParked);
    game.events?.on('player:land', (e) => this._onLand(e));
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
    if (!initial && d < HIDDEN_SPAWN && this.renderer.inView(slot.x, 1, slot.z, 7)) return;
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
      const stuck = v.stuck > 130 || (v.stuck > 70 && (d > 90 || !this.renderer.inView(v.position.x, 1, v.position.z, v.length)));
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
    const onRoad = !!pl && pl.state === 'ground' && pl.position.y < 1;
    const px = this.focus.x;
    const pz = this.focus.z;
    const npcs = game.npcs;
    const npcQuery = typeof npcs?.npcsNear === 'function';
    const frame = game.frame || 0;
    for (const v of this.sim.vehicles) {
      v.obstacleGap = Infinity;
      v.blockedBy = 0;
      const dx = v.position.x - px;
      const dz = v.position.z - pz;
      const d2 = dx * dx + dz * dz;
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
        if (along > -1 && along < 35 && Math.abs(lat) < half + 0.8) {
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
    v.position.set((_a.x + _b.x) / 2 - fx * mid + fz * lat, 0, (_a.z + _b.z) / 2 - fz * mid - fx * lat);
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
