import * as THREE from 'three';
import { probeLedge, findPerchEdge } from './anchors.js';
import { SwingMove } from './swing.js';
import { ZipMove } from './zip.js';
import { WallMove } from './wall.js';

// Traversal state machine. Owns ground / air / dive movement, landings, vaults and perching, and
// delegates swinging, zipping and wall movement to their move modules. Movement is sub-stepped
// (≤ 0.3 m per step) so nothing tunnels through walls even at dive speed.
//   ground → run (auto-vault low ledges, auto wall-climb), jump, roll / superhero landings
//   air / dive → air control, grab walls, mantle ledges, head-first dive with a forward carve
//   perch → crouched on a ledge facing out; step off, leap, dive or swing away

const G = 26;
const RUN_SPEED = 10;
const SPRINT_SPEED = 14;
const SPRINT_AFTER = 1.0;
const GROUND_ACCEL = 9;
const GROUND_TURN = 14;
const GROUND_FRICTION = 12;
const JUMP_V = 15.5;
const JUMP_HOLD_GRAVITY = 0.62;
const AIR_ACCEL = 11;
const AIR_DRAG = G / (38 * 38);
const AIR_TURN = 1.2;
const DIVE_G = G * 1.5;
const DIVE_DRAG = DIVE_G / (56 * 56);
const DIVE_GLIDE = 16;
const CENTER_Y = 0.95;
const VAULT_MAX = 1.25;
const MAX_STEP = 0.3;
const BOUNDS_MARGIN = 150;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _segA = new THREE.Vector3();
const _segB = new THREE.Vector3();
const _center = new THREE.Vector3();
const _ledge = new THREE.Vector3();

export class Controller {
  constructor(player, game) {
    this.p = player;
    this.game = game;
    this.world = game.world;
    this.centerHeight = CENTER_Y;
    this.wish = new THREE.Vector3();
    this.move = { x: 0, y: 0 };
    this.camFwd = new THREE.Vector3(0, 0, -1);
    this.camRight = new THREE.Vector3(1, 0, 0);
    this.swing = new SwingMove(this);
    this.zip = new ZipMove(this);
    this.wall = new WallMove(this);

    this.perchOut = new THREE.Vector3(0, 0, -1);
    this.perchHit = { point: new THREE.Vector3(), outward: new THREE.Vector3() };
    this.idleTime = 0;
    this.perchCheck = 0;
    this.vault = { active: false, from: new THREE.Vector3(), ctrl: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 0.3, then: 'ground', exit: new THREE.Vector3() };

    this.landMode = null; // 'soft' | 'roll' | 'hard' while a landing plays out
    this.landT = 0;
    this.landDur = 0;
    this.trick = null; // 'flip' | 'twirl' | 'corkscrew' after a release
    this.trickT = 0;
    this.trickDur = 0;
    this.runTime = 0;
    this.coyote = 0;
    this.jumpHeld = false;
    this.airTime = 0;
    this.impactVy = 0;
    this.wallImpact = 0;
  }

  get center() {
    return _center.copy(this.p.position).setY(this.p.position.y + CENTER_Y);
  }

  reset() {
    this.dropWebs();
    this.vault.active = false;
    this.clearActions();
    this.airTime = 0;
  }

  clearActions() {
    this.landMode = null;
    this.trick = null;
  }

  emit(type, payload) {
    this.game.events.emit(type, payload);
  }

  update(dt) {
    const p = this.p;
    this._readInput(this.game.input);
    this.wall.cooldown -= dt;
    this.swing.retry -= dt;
    this.coyote -= dt;
    if (this.landMode && (this.landT += dt) >= this.landDur) this.landMode = null;
    if (this.trick && (this.trickT += dt) >= this.trickDur) this.trick = null;
    this.airTime = p.state === 'air' || p.state === 'dive' ? this.airTime + dt : 0;

    this._buttons(this.game.input);

    if (this.vault.active) {
      this._updateVault(dt);
    } else if (p.state === 'perch') {
      this._updatePerch();
    } else {
      const n = clamp(Math.ceil((p.velocity.length() * dt) / MAX_STEP), 1, 24);
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const st = p.state;
        if (st === 'ground') this._ground(h);
        else if (st === 'air' || st === 'dive') this._air(h, st === 'dive');
        else if (st === 'swing') this.swing.step(h);
        else if (st === 'zip') this.zip.step(h);
        else if (st === 'wall') this.wall.step(h);
        if (this.vault.active || p.state === 'perch') break;
      }
    }
    this._safety(dt);
    this._checkPerch(dt);
    this._updateHeading();
  }

  // ---------------------------------------------------------------- input

  _readInput(input) {
    const yaw = this.game.cameraRig?.yaw ?? this.p.heading;
    this.camFwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.camRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.move.x = input.move.x;
    this.move.y = input.move.y;
    this.wish.set(0, 0, 0).addScaledVector(this.camFwd, input.move.y).addScaledVector(this.camRight, input.move.x);
  }

  _buttons(input) {
    if (this.vault.active) return;
    if (input.released('jump')) this.jumpHeld = false;
    if (input.pressed('zip')) this.zip.tryStart();
    if (input.pressed('jump')) this._jumpPressed();
    if (input.pressed('dive')) this._divePressed();
    const st = this.p.state;
    const held = input.down('swing');
    if (st === 'swing') {
      if (!held) this.swing.release(false);
    } else if (held && st !== 'zip' && (input.pressed('swing') || this.swing.retry <= 0)) {
      this.swing.tryStart(input.pressed('swing'));
    }
  }

  _jumpPressed() {
    const p = this.p;
    const v = p.velocity;
    switch (p.state) {
      case 'ground':
        if (this.landMode !== 'hard' || this.landT > 0.3) this.launch(v.x, JUMP_V, v.z);
        break;
      case 'air':
        if (this.coyote > 0) this.launch(v.x, JUMP_V, v.z);
        break;
      case 'perch':
        _a.copy(this.perchOut).multiplyScalar(5).addScaledVector(this.camFwd, 3);
        this.launch(_a.x, JUMP_V * 0.85, _a.z);
        break;
      case 'wall':
        this.wall.jump();
        break;
      case 'swing':
        this.swing.release(true);
        break;
      case 'zip':
        this.zip.launch = true;
        break;
      default:
    }
  }

  launch(vx, vy, vz) {
    const p = this.p;
    p.velocity.set(vx, vy, vz);
    p.state = 'air';
    this.coyote = 0;
    this.jumpHeld = true;
    this.landMode = null;
    this.emit('player:jump', { pos: p.position.clone() });
  }

  _divePressed() {
    const p = this.p;
    const v = p.velocity;
    if (p.state === 'dive') {
      p.state = 'air';
      return;
    }
    if (p.state === 'perch') {
      // Swan dive off the ledge: a small hop out, then head-first.
      v.copy(this.perchOut).multiplyScalar(8);
      v.y = 4;
      this.emit('player:jump', { pos: p.position.clone() });
    } else {
      if (p.state === 'wall') this.wall.leave(4);
      else if (p.state !== 'air') return;
      const hs = Math.hypot(v.x, v.z);
      const dir = hs > 2 ? _a.set(v.x / hs, 0, v.z / hs) : _a.copy(this.camFwd);
      if (hs < 8) v.addScaledVector(dir, 8 - hs);
      v.y = Math.min(v.y, -6);
    }
    p.state = 'dive';
    this.trick = null;
    this.game.cameraRig?.fovKick?.(6);
  }

  // Rotate the horizontal velocity towards the input direction (keeps speed): swings and jumps go
  // where the stick / camera points instead of drifting.
  steerTowardsWish(h, rate) {
    const wl = this.wish.length();
    if (wl < 0.2) return;
    const v = this.p.velocity;
    const hs = Math.hypot(v.x, v.z);
    if (hs < 2) return;
    const cur = Math.atan2(v.x, v.z);
    let d = Math.atan2(this.wish.x, this.wish.z) - cur;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const a = cur + clamp(d, -rate * wl * h, rate * wl * h);
    v.x = Math.sin(a) * hs;
    v.z = Math.cos(a) * hs;
  }

  startTrick(type) {
    this.trick = type;
    this.trickT = 0;
    this.trickDur = type === 'flip' ? 0.62 : 0.8;
  }

  dropWebs() {
    this.zip.dropLines();
    this.swing.dropLine();
  }

  // ---------------------------------------------------------------- collision

  // Push the capsule out of the city; records impact speeds and removes velocity into contacts.
  collide() {
    const p = this.p;
    const r = p.radius;
    _segA.set(p.position.x, p.position.y + r, p.position.z);
    _segB.set(p.position.x, p.position.y + p.height - r, p.position.z);
    const res = this.world.collideCapsule(_segA, _segB, r);
    if (!res.hit) return res;
    p.position.set(_segA.x, _segA.y - r, _segA.z);
    const v = p.velocity;
    this.impactVy = -v.y;
    if (res.ground && v.y < 0) v.y = 0;
    if (res.ceiling && v.y > 0) v.y = 0;
    this.wallImpact = 0;
    if (res.wall) {
      const into = v.dot(res.wallNormal);
      if (into < 0) {
        this.wallImpact = -into;
        v.addScaledVector(res.wallNormal, -into);
      }
    }
    return res;
  }

  // Ran or flew into an obstacle: vault it if it is low, otherwise grab it and climb.
  obstacle(n, speed) {
    const p = this.p;
    const ledge = probeLedge(this.world, p.position, n, p.radius, VAULT_MAX, _ledge);
    if (ledge) {
      const rise = ledge.y - p.position.y;
      _a.copy(n).negate().multiplyScalar(Math.max(speed, 6));
      this.startVault(_b.copy(ledge).addScaledVector(n, -0.55), 0.22 + 0.1 * (rise / VAULT_MAX), 'ground', _a);
      return;
    }
    this.wall.enter(n);
    if (p.state === 'wall' && this.move.y > 0.3) p.velocity.y = Math.max(p.velocity.y, speed * 0.85);
  }

  // ---------------------------------------------------------------- ground

  _ground(h) {
    const p = this.p;
    const v = p.velocity;
    const hard = this.landMode === 'hard' && this.landT < 0.4;
    const wishLen = this.wish.length();
    if (wishLen > 0.05 && !hard) {
      this.runTime += h;
      const top = RUN_SPEED + (SPRINT_SPEED - RUN_SPEED) * smooth(SPRINT_AFTER, SPRINT_AFTER + 0.8, this.runTime);
      const wx = this.wish.x / wishLen;
      const wz = this.wish.z / wishLen;
      // Rotate the existing velocity towards the input rather than braking through zero.
      const hs = Math.hypot(v.x, v.z);
      if (hs > 1) {
        const turn = 1 - Math.exp(-GROUND_TURN * h);
        const nx = v.x / hs + (wx - v.x / hs) * turn;
        const nz = v.z / hs + (wz - v.z / hs) * turn;
        const nl = Math.hypot(nx, nz) || 1;
        v.x = (nx / nl) * hs;
        v.z = (nz / nl) * hs;
      }
      const k = 1 - Math.exp(-GROUND_ACCEL * h);
      v.x += (wx * top * wishLen - v.x) * k;
      v.z += (wz * top * wishLen - v.z) * k;
    } else {
      this.runTime = 0;
      const k = 1 - Math.exp(-(hard ? 7 : GROUND_FRICTION) * h);
      v.x -= v.x * k;
      v.z -= v.z * k;
    }
    if (this.landMode === 'roll') {
      const hs = Math.hypot(v.x, v.z);
      if (hs > 0.1 && hs < 7) {
        v.x *= 7 / hs;
        v.z *= 7 / hs;
      }
    }
    v.y = -4;
    p.position.addScaledVector(v, h);
    const res = this.collide();
    if (!res.ground) {
      // Stepped off something small: stick to the surface below, otherwise start falling.
      _a.set(p.position.x, p.position.y + 0.3, p.position.z);
      const g = this.world.raycast(_a, _down, 0.8);
      if (g && g.normal.y > 0.6) {
        p.position.y = g.point.y;
      } else {
        p.state = 'air';
        v.y = 0;
        this.coyote = 0.14;
        return;
      }
    }
    if (res.wall && !hard && wishLen > 0.3 && this.wish.dot(res.wallNormal) < -0.45 * wishLen) {
      this.obstacle(res.wallNormal, Math.max(Math.hypot(v.x, v.z), this.wallImpact));
    }
  }

  // ---------------------------------------------------------------- air & dive

  _air(h, dive) {
    const p = this.p;
    const v = p.velocity;
    let g = dive ? DIVE_G : G;
    if (!dive && this.jumpHeld && v.y > 0) g *= JUMP_HOLD_GRAVITY;
    v.y -= g * h;
    v.multiplyScalar(1 - (dive ? DIVE_DRAG : AIR_DRAG) * v.length() * h);
    // Air control steers but never adds speed beyond what you already carry.
    const hs0 = Math.hypot(v.x, v.z);
    const accel = dive ? 14 : AIR_ACCEL;
    v.x += this.wish.x * accel * h;
    v.z += this.wish.z * accel * h;
    if (hs0 > 10) this.steerTowardsWish(h, AIR_TURN);
    const hs1 = Math.hypot(v.x, v.z);
    const cap = Math.max(hs0, dive ? 22 : 10);
    if (hs1 > cap) {
      v.x *= cap / hs1;
      v.z *= cap / hs1;
    }
    if (dive && hs1 < DIVE_GLIDE) {
      // Head-first dives carve forward instead of dropping straight down the building face.
      const k = (DIVE_GLIDE - hs1) * (1 - Math.exp(-1.6 * h));
      v.x -= Math.sin(p.heading) * k;
      v.z -= Math.cos(p.heading) * k;
    }
    p.position.addScaledVector(v, h);
    const res = this.collide();
    if (res.ground && this.impactVy >= -0.5) this.land(Math.max(0, this.impactVy));
    else if (res.wall && !res.ground && this.wall.wantsToGrab(res.wallNormal, this.wallImpact)) this.obstacle(res.wallNormal, this.wallImpact);
  }

  // Touchdown: superhero landing on big impacts, a roll when carrying speed, a knee dip otherwise.
  // There is no fall damage.
  land(vy) {
    const p = this.p;
    const v = p.velocity;
    const wasDive = p.state === 'dive';
    const hs = Math.hypot(v.x, v.z);
    p.state = 'ground';
    this.trick = null;
    this.landT = 0;
    if (vy > 26 || (wasDive && vy > 16)) {
      this.landMode = 'hard';
      this.landDur = 0.8;
      v.x *= 0.2;
      v.z *= 0.2;
    } else if (vy > 13 && hs > 6) {
      this.landMode = 'roll';
      this.landDur = 0.5;
    } else if (vy > 4) {
      this.landMode = 'soft';
      this.landDur = 0.28;
    } else {
      this.landMode = null;
    }
    v.y = 0;
    this.emit('player:land', { pos: p.position.clone(), speed: vy, hard: this.landMode === 'hard' });
  }

  // ---------------------------------------------------------------- vault & perch

  // Scripted hop along a curve (ledges, wall tops, zip arrivals); physics resumes at the end.
  startVault(to, dur, then, exitVel) {
    const p = this.p;
    const vt = this.vault;
    vt.active = true;
    vt.from.copy(p.position);
    vt.to.copy(to);
    vt.ctrl.copy(p.position).lerp(to, 0.35);
    vt.ctrl.y = Math.max(p.position.y, to.y) + 0.45 + 0.25 * Math.abs(to.y - p.position.y);
    vt.t = 0;
    vt.dur = dur;
    vt.then = then;
    vt.exit.copy(exitVel);
    p.velocity.set(0, 0, 0);
    this.clearActions();
  }

  _updateVault(dt) {
    const p = this.p;
    const vt = this.vault;
    vt.t += dt;
    const s = Math.min(1, vt.t / vt.dur);
    const e = s * s * (3 - 2 * s);
    _a.lerpVectors(vt.from, vt.ctrl, e);
    _b.lerpVectors(vt.ctrl, vt.to, e);
    p.position.lerpVectors(_a, _b, e);
    if (s < 1) return;
    vt.active = false;
    p.velocity.copy(vt.exit);
    if (vt.then === 'perch') this.perchAt(vt.to, this.perchOut);
    else p.state = 'ground';
  }

  // Crouch on a ledge at `point` facing `outward` (horizontal).
  perchAt(point, outward) {
    const p = this.p;
    p.position.copy(point);
    p.velocity.set(0, 0, 0);
    this.perchOut.set(outward.x, 0, outward.z).normalize();
    p.state = 'perch';
    this.landMode = null;
    this.emit('player:perch', { pos: p.position.clone() });
  }

  _updatePerch() {
    const p = this.p;
    const wl = this.wish.length();
    if (wl < 0.3) return;
    if (this.wish.dot(this.perchOut) > 0.4 * wl) {
      this.launch(this.perchOut.x * 5, 5.5, this.perchOut.z * 5);
    } else {
      p.state = 'ground';
      p.position.addScaledVector(this.perchOut, -0.3);
    }
  }

  // Standing still near a drop: step to the lip and crouch facing out.
  _checkPerch(dt) {
    const p = this.p;
    const v = p.velocity;
    if (p.state !== 'ground' || this.landMode === 'hard' || this.vault.active || this.wish.lengthSq() > 0.01 || Math.hypot(v.x, v.z) > 0.8) {
      this.idleTime = 0;
      return;
    }
    this.idleTime += dt;
    this.perchCheck -= dt;
    if (this.idleTime < 0.25 || this.perchCheck > 0 || p.position.y < 3) return;
    this.perchCheck = 0.3;
    this.perchHit.outward.copy(this.camFwd);
    const e = findPerchEdge(this.world, p.position, this.perchHit);
    if (!e) return;
    this.perchOut.copy(e.outward);
    this.startVault(e.point, 0.22, 'perch', _a.set(0, 0, 0));
    this.vault.ctrl.y = p.position.y + 0.15;
  }

  // ---------------------------------------------------------------- housekeeping

  _safety(dt) {
    const p = this.p;
    const pos = p.position;
    const v = p.velocity;
    if (!this.vault.active && p.state !== 'perch') {
      const b = this.world.buildingAt(pos.x, pos.z);
      if (b && pos.y < b.h - 0.3 && pos.y + p.height > (b.minH || 0) + 0.1) {
        // Somehow inside a building volume: pop onto its roof.
        if (p.state === 'swing') this.swing.release(false, true);
        this.dropWebs();
        pos.y = b.h + 0.02;
        v.y = Math.max(0, v.y);
        p.state = 'ground';
      }
    }
    // Soft push back towards the map, hard stop further out.
    const { minX, maxX, minZ, maxZ } = this.world.bounds;
    const m = BOUNDS_MARGIN;
    const push = 6 * dt;
    if (pos.x < minX - m) v.x += (minX - m - pos.x) * push;
    if (pos.x > maxX + m) v.x -= (pos.x - maxX - m) * push;
    if (pos.z < minZ - m) v.z += (minZ - m - pos.z) * push;
    if (pos.z > maxZ + m) v.z -= (pos.z - maxZ - m) * push;
    pos.x = clamp(pos.x, minX - m - 250, maxX + m + 250);
    pos.z = clamp(pos.z, minZ - m - 250, maxZ + m + 250);
    if (pos.y < -2) {
      pos.y = 0.05;
      v.y = 0;
    }
  }

  _updateHeading() {
    const p = this.p;
    const v = p.velocity;
    if (p.state === 'wall') {
      p.heading = Math.atan2(this.wall.normal.x, this.wall.normal.z);
    } else if (p.state === 'perch') {
      p.heading = Math.atan2(-this.perchOut.x, -this.perchOut.z);
    } else if (!this.vault.active) {
      if (Math.hypot(v.x, v.z) > 0.8) p.heading = Math.atan2(-v.x, -v.z);
      else if (p.state === 'ground' && this.wish.lengthSq() > 0.04) p.heading = Math.atan2(-this.wish.x, -this.wish.z);
    }
  }
}
