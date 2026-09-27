import * as THREE from 'three';
import { findSwingAnchor, findZipTarget, probeLedge, findPerchEdge, groundBelow } from './anchors.js';

// Traversal physics and the player state machine:
//   ground → run (auto-vault low ledges, auto wall-climb), jump, roll / superhero landings
//   air / dive → air control, wall stick, mantle
//   swing → rope pendulum with reel-in, pumping, steering, boosted releases
//   zip → pull to a point; roof edges end in a vault + perch, walls in a wall crawl
//   wall → crawl / run on walls, wrap outer corners, vault over the top, wall jumps
//   perch → crouched on a ledge facing out
// Movement is sub-stepped (≤ 0.3 m per step) so nothing tunnels even at dive speed.

const G = 26;
const RUN_SPEED = 10;
const SPRINT_SPEED = 14;
const SPRINT_AFTER = 1.0;
const GROUND_ACCEL = 9;
const GROUND_FRICTION = 12;
const JUMP_V = 15.5;
const JUMP_HOLD_GRAVITY = 0.62;
const AIR_ACCEL = 11;
const AIR_DRAG = G / (38 * 38);
const DIVE_G = G * 1.5;
const DIVE_DRAG = DIVE_G / (56 * 56);
const SWING_G = 34;
const SWING_PUMP = 8;
const SWING_STEER = 7;
const SWING_MAX = 45;
const ROPE_REEL = 24;
const CENTER_Y = 0.95;
const ROPE_CLEARANCE = 1.45;
const ZIP_MAX = 42;
const ZIP_ACCEL = 150;
const WALL_UP = 9;
const WALL_UP_SPRINT = 12;
const WALL_SIDE = 7.5;
const WALL_DOWN = 9;
const VAULT_MAX = 1.25;
const MAX_STEP = 0.3;
const BOUNDS_MARGIN = 150;

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _segA = new THREE.Vector3();
const _segB = new THREE.Vector3();
const _center = new THREE.Vector3();
const _ledge = new THREE.Vector3();
const _camDir = new THREE.Vector3();

export class Controller {
  constructor(player, game) {
    this.p = player;
    this.game = game;
    this.world = game.world;
    this.wish = new THREE.Vector3();
    this.move = { x: 0, y: 0 };
    this.camFwd = new THREE.Vector3(0, 0, -1);
    this.camRight = new THREE.Vector3(1, 0, 0);

    this.anchor = new THREE.Vector3();
    this.ropeLen = 0;
    this.ropeTarget = 0;
    this.ropeDelay = 0;
    this.webSide = 1;
    this.swingTime = 0;
    this.swingRetry = 0;
    this.swingLine = null;
    this.swingHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), side: 1, buildingId: -1 };

    this.zipHit = { kind: '', point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
    this.zip = { kind: '', point: new THREE.Vector3(), normal: new THREE.Vector3(), dest: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, delay: 0, dist0: 1, launch: false, lines: [] };
    this.zipProgress = 0;

    this.wallN = new THREE.Vector3(0, 0, 1);
    this.lastWallN = new THREE.Vector3();
    this.wallCooldown = 0;
    this.wallClimbTime = 0;

    this.perchOut = new THREE.Vector3(0, 0, -1);
    this.perchHit = { point: new THREE.Vector3(), outward: new THREE.Vector3() };
    this.idleTime = 0;
    this.perchCheck = 0;

    this.vault = { active: false, from: new THREE.Vector3(), ctrl: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 0.3, then: 'ground', exit: new THREE.Vector3() };

    this.landMode = null;
    this.landT = 0;
    this.landDur = 0;
    this.trick = null;
    this.trickT = 0;
    this.trickDur = 0;
    this.runTime = 0;
    this.coyote = 0;
    this.jumpHeld = false;
    this.airTime = 0;
    this.impactVy = 0;
    this.wallImpact = 0;
  }

  reset() {
    this._dropWebs();
    this.vault.active = false;
    this.landMode = null;
    this.trick = null;
    this.airTime = 0;
  }

  emit(type, payload) {
    this.game.events.emit(type, payload);
  }

  get center() {
    return _center.copy(this.p.position).setY(this.p.position.y + CENTER_Y);
  }

  update(dt) {
    const p = this.p;
    const input = this.game.input;
    this._readInput(input);
    this.wallCooldown -= dt;
    this.coyote -= dt;
    this.swingRetry -= dt;
    if (this.landMode) {
      this.landT += dt;
      if (this.landT >= this.landDur) this.landMode = null;
    }
    if (this.trick) {
      this.trickT += dt;
      if (this.trickT >= this.trickDur) this.trick = null;
    }
    if (p.state === 'air' || p.state === 'dive') this.airTime += dt;
    else this.airTime = 0;

    this._buttons(input);

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
        else if (st === 'swing') this._swing(h);
        else if (st === 'zip') this._zip(h);
        else if (st === 'wall') this._wall(h);
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
    const st = this.p.state;
    if (this.vault.active) return;
    if (input.released('jump')) this.jumpHeld = false;
    if (input.pressed('zip')) this._tryZip();
    if (input.pressed('jump')) this._jumpPressed();
    if (input.pressed('dive')) this._divePressed();
    const swingDown = input.down('swing');
    if (this.p.state === 'swing') {
      if (!swingDown) this._releaseSwing(false);
    } else if (swingDown && st !== 'zip' && (input.pressed('swing') || this.swingRetry <= 0)) {
      this._trySwing(input.pressed('swing'));
    }
  }

  _jumpPressed() {
    const p = this.p;
    const v = p.velocity;
    switch (p.state) {
      case 'ground':
        if (this.landMode === 'hard' && this.landT < 0.3) return;
        this._launch(v.x, JUMP_V, v.z);
        break;
      case 'air':
        if (this.coyote > 0) this._launch(v.x, JUMP_V, v.z);
        break;
      case 'perch':
        _a.copy(this.perchOut).multiplyScalar(5).addScaledVector(this.camFwd, 3);
        this._launch(_a.x, JUMP_V * 0.85, _a.z);
        break;
      case 'wall':
        this._wallJump();
        break;
      case 'swing':
        this._releaseSwing(true);
        break;
      case 'zip':
        this.zip.launch = true;
        break;
      default:
    }
  }

  _launch(vx, vy, vz) {
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
    } else if (p.state === 'air') {
      p.state = 'dive';
      this._diveKick();
    } else if (p.state === 'perch') {
      v.copy(this.perchOut).multiplyScalar(7);
      v.y = 3;
      p.state = 'dive';
      this.emit('player:jump', { pos: p.position.clone() });
    }
  }

  _diveKick() {
    const v = this.p.velocity;
    const hs = Math.hypot(v.x, v.z);
    const dir = hs > 2 ? _a.set(v.x / hs, 0, v.z / hs) : _a.copy(this.camFwd);
    if (hs < 8) v.addScaledVector(dir, 8 - hs);
    v.y = Math.min(v.y, -6);
    this.game.cameraRig?.fovKick?.(6);
  }

  // ---------------------------------------------------------------- collision helpers

  // Resolve the capsule against the city; records impact speeds and removes velocity into contacts.
  _collide() {
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

  _groundProbe(maxDrop) {
    const p = this.p;
    _a.set(p.position.x, p.position.y + 0.3, p.position.z);
    const hit = this.world.raycast(_a, _b.set(0, -1, 0), maxDrop + 0.3);
    return hit && hit.normal.y > 0.6 ? hit : null;
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
      const k = 1 - Math.exp(-GROUND_ACCEL * h);
      // Turn the existing velocity towards the wish instead of braking through zero: tight turns.
      const hs = Math.hypot(v.x, v.z);
      const wx = this.wish.x / wishLen;
      const wz = this.wish.z / wishLen;
      if (hs > 1) {
        const turn = 1 - Math.exp(-14 * h);
        const nx = v.x / hs + (wx - v.x / hs) * turn;
        const nz = v.z / hs + (wz - v.z / hs) * turn;
        const nl = Math.hypot(nx, nz) || 1;
        v.x = (nx / nl) * hs;
        v.z = (nz / nl) * hs;
      }
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
    const res = this._collide();
    if (!res.ground) {
      const g = this._groundProbe(0.5);
      if (g) {
        p.position.y = g.point.y;
      } else {
        p.state = 'air';
        v.y = 0;
        this.coyote = 0.14;
        return;
      }
    }
    if (res.wall && !hard && wishLen > 0.3 && this.wish.dot(res.wallNormal) < -0.45 * wishLen) {
      this._obstacle(res.wallNormal, Math.max(Math.hypot(v.x, v.z), this.wallImpact));
    }
  }

  // Ran or fell into an obstacle: vault it if low, otherwise stick to it and climb.
  _obstacle(n, speed) {
    const p = this.p;
    const ledge = probeLedge(this.world, p.position, n, p.radius, VAULT_MAX, _ledge);
    if (ledge) {
      _a.copy(n).negate().multiplyScalar(Math.max(speed, 6));
      this._startVault(_b.copy(ledge).addScaledVector(n, -0.55), 0.22 + 0.1 * ((ledge.y - p.position.y) / VAULT_MAX), 'ground', _a);
      return;
    }
    this._enterWall(n);
    if (p.state === 'wall' && this.move.y > 0.3) p.velocity.y = Math.max(p.velocity.y, speed * 0.85, WALL_UP);
  }

  // ---------------------------------------------------------------- air & dive

  _air(h, dive) {
    const p = this.p;
    const v = p.velocity;
    let g = dive ? DIVE_G : G;
    if (!dive && this.jumpHeld && v.y > 0) g *= JUMP_HOLD_GRAVITY;
    v.y -= g * h;
    const sp = v.length();
    v.multiplyScalar(1 - (dive ? DIVE_DRAG : AIR_DRAG) * sp * h);
    const hs0 = Math.hypot(v.x, v.z);
    const accel = dive ? 14 : AIR_ACCEL;
    v.x += this.wish.x * accel * h;
    v.z += this.wish.z * accel * h;
    const hs1 = Math.hypot(v.x, v.z);
    const cap = Math.max(hs0, dive ? 22 : 10);
    if (hs1 > cap) {
      v.x *= cap / hs1;
      v.z *= cap / hs1;
    }
    p.position.addScaledVector(v, h);
    const res = this._collide();
    if (res.ground && this.impactVy >= -0.5) {
      this._land(Math.max(0, this.impactVy));
    } else if (res.wall && !res.ground) {
      this._touchWall(res.wallNormal);
    }
  }

  _touchWall(n) {
    const pushing = this.wish.dot(n) < -0.3;
    const sameWall = this.wallCooldown > 0 && n.dot(this.lastWallN) > 0.8;
    if (sameWall || (this.wallImpact < 1.5 && !pushing)) return;
    this._obstacle(n, this.wallImpact);
  }

  _land(vy) {
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

  // ---------------------------------------------------------------- swing

  _swingDirection(out) {
    const v = this.p.velocity;
    const hs = Math.hypot(v.x, v.z);
    const wl = this.wish.length();
    out.copy(wl > 0.2 ? this.wish : this.camFwd).normalize();
    if (hs > 4) out.multiplyScalar(0.55).addScaledVector(_e.set(v.x / hs, 0, v.z / hs), 0.45);
    return out.normalize();
  }

  _trySwing(fresh) {
    const p = this.p;
    const st = p.state;
    if (st === 'ground' || st === 'perch' || st === 'wall') {
      if (!fresh) return;
      if (st === 'wall') this._wallJump();
      else if (st === 'perch') this._launch(this.perchOut.x * 6, 9, this.perchOut.z * 6);
      else this._launch(p.velocity.x, 11, p.velocity.z);
    }
    const dir = this._swingDirection(_c);
    const hand = _d.copy(this.center);
    hand.y += 1.1;
    const hit = findSwingAnchor(this.world, hand, dir, p.velocity.length(), -this.webSide, this.swingHit);
    if (!hit || !this._startSwing(hit, hand)) this.swingRetry = 0.12;
  }

  _startSwing(hit, hand) {
    const p = this.p;
    const center = this.center;
    const L0 = center.distanceTo(hit.point);
    const floor = groundBelow(this.world, (center.x + hit.point.x) / 2, hit.point.y - 0.5, (center.z + hit.point.z) / 2);
    const target = Math.min(L0, hit.point.y - floor - ROPE_CLEARANCE);
    if (target < 4) return false;
    if (p.state === 'dive') this.game.cameraRig?.fovKick?.(-3);
    this.anchor.copy(hit.point);
    this.ropeLen = L0;
    this.ropeTarget = target;
    this.ropeDelay = Math.max(0.05, L0 / 520);
    this.webSide = hit.side;
    this.swingTime = 0;
    p.state = 'swing';
    this.trick = null;
    this.landMode = null;
    const side = hit.side > 0 ? 'R' : 'L';
    this.swingLine = p.webs.shoot(side, p.hands[side], hit.point, hit.normal);
    this.emit('player:webShot', { from: hand.clone(), to: hit.point.clone() });
    this.emit('player:swingStart', { anchor: hit.point.clone() });
    return true;
  }

  _swing(h) {
    const p = this.p;
    const v = p.velocity;
    this.swingTime += h;
    v.y -= SWING_G * h;
    const center = this.center;
    const rope = _a.subVectors(this.anchor, center);
    const dist = rope.length();
    rope.divideScalar(dist);
    if (this.ropeDelay > 0) {
      this.ropeDelay -= h;
    } else {
      const vt = _b.copy(v).addScaledVector(rope, -v.dot(rope));
      const vtl = vt.length();
      if (vtl > 0.5) {
        vt.divideScalar(vtl);
        const pump = Math.max(0, this.wish.dot(vt));
        v.addScaledVector(vt, pump * SWING_PUMP * h);
      }
      const steer = _c.copy(this.wish).addScaledVector(rope, -this.wish.dot(rope));
      v.addScaledVector(steer, SWING_STEER * h);
      if (this.ropeLen > this.ropeTarget) this.ropeLen = Math.max(this.ropeTarget, this.ropeLen - ROPE_REEL * h);
    }
    p.position.addScaledVector(v, h);
    if (this.ropeDelay <= 0) {
      const d = _a.subVectors(this.center, this.anchor);
      const len = d.length();
      if (len > this.ropeLen) {
        d.divideScalar(len);
        p.position.addScaledVector(d, this.ropeLen - len);
        const vr = v.dot(d);
        if (vr > 0) v.addScaledVector(d, -vr);
      }
      if (this.swingLine) this.swingLine.slack = Math.max(0, this.ropeLen - len);
    }
    const sp = v.length();
    if (sp > SWING_MAX) v.multiplyScalar(SWING_MAX / sp);

    const res = this._collide();
    if (res.ground && this.impactVy >= -0.5) {
      this._releaseSwing(false, true);
      this._land(Math.max(0, this.impactVy));
      return;
    }
    if (res.wall && this.wallImpact > 2) {
      this._releaseSwing(false, true);
      p.state = 'air';
      this._obstacle(res.wallNormal, this.wallImpact);
      return;
    }
    // Past the top of the arc (or hanging too long): let go automatically.
    if (this.center.y > this.anchor.y - 1 || (this.swingTime > 5 && v.length() < 4)) this._releaseSwing(false);
  }

  _releaseSwing(boost, quiet = false) {
    const p = this.p;
    const v = p.velocity;
    p.state = 'air';
    if (!quiet) {
      const hs = Math.hypot(v.x, v.z);
      const sp = v.length();
      if (boost) {
        if (hs > 0.5) v.addScaledVector(_a.set(v.x / hs, 0, v.z / hs), 3);
        v.y = Math.max(v.y, 2) + 9;
        this._startTrick('flip');
        this.jumpHeld = true;
        this.emit('player:jump', { pos: p.position.clone() });
      } else if (v.y > 0 && sp > 14) {
        v.multiplyScalar(1.06);
        v.y += 3.5;
        if (sp > 24 && Math.random() < 0.55) this._startTrick(Math.random() < 0.5 ? 'twirl' : 'flip');
      }
    }
    this.swingRetry = 0.18;
    p.webs.release(this.swingLine);
    this.swingLine = null;
    this.emit('player:swingEnd', { pos: p.position.clone(), vel: v.clone() });
  }

  _startTrick(type) {
    this.trick = type;
    this.trickT = 0;
    this.trickDur = type === 'flip' ? 0.62 : 0.8;
  }

  // ---------------------------------------------------------------- zip

  _tryZip() {
    const p = this.p;
    const cam = this.game.camera;
    cam.getWorldDirection(_camDir);
    const origin = this.center.clone();
    origin.y += 0.5;
    const hit = findZipTarget(this.world, cam.position, _camDir, origin, this.zipHit);
    if (!hit) return;
    if (p.state === 'swing') this._releaseSwing(false, true);
    this._dropWebs();
    const z = this.zip;
    z.kind = hit.kind;
    z.point.copy(hit.point);
    z.normal.copy(hit.normal);
    z.launch = false;
    const r = p.radius;
    if (hit.kind === 'edge') z.dest.copy(hit.point).addScaledVector(hit.normal, r + 0.12).setY(hit.point.y - 1.55);
    else if (hit.kind === 'wall') z.dest.copy(hit.point).addScaledVector(hit.normal, r + 0.05).setY(hit.point.y - CENTER_Y);
    else z.dest.copy(hit.point).addScaledVector(hit.normal, 0.05);
    z.dist0 = Math.max(1, p.position.distanceTo(z.dest));
    z.dir.subVectors(z.dest, p.position).normalize();
    z.speed = Math.max(10, p.velocity.dot(z.dir));
    z.delay = Math.max(0.05, hit.distance / 520);
    this.zipProgress = 0;
    p.state = 'zip';
    this.trick = null;
    this.landMode = null;
    // Two lines, one from each wrist, landing a hand's width apart.
    _b.crossVectors(z.dir, UP);
    if (_b.lengthSq() < 1e-4) _b.set(1, 0, 0);
    _b.normalize().multiplyScalar(0.12);
    z.lines[0] = p.webs.shoot('L', p.hands.L, _c.copy(hit.point).sub(_b), hit.normal);
    z.lines[1] = p.webs.shoot('R', p.hands.R, _c.copy(hit.point).add(_b), hit.normal, { splat: false });
    this.emit('player:webShot', { from: origin, to: hit.point.clone() });
    this.emit('player:zip', { from: origin, to: hit.point.clone() });
    this.game.cameraRig?.fovKick?.(5);
  }

  _zip(h) {
    const p = this.p;
    const z = this.zip;
    const v = p.velocity;
    if (z.delay > 0) {
      z.delay -= h;
      v.multiplyScalar(1 - Math.min(1, 4 * h));
      p.position.addScaledVector(v, h);
      this._collide();
      return;
    }
    const dir = _a.subVectors(z.dest, p.position);
    const dist = dir.length();
    this.zipProgress = 1 - dist / z.dist0;
    z.speed = Math.min(ZIP_MAX, z.speed + ZIP_ACCEL * h);
    const step = z.speed * h;
    if (dist <= step + 0.05) {
      p.position.copy(z.dest);
      this._arriveZip();
      return;
    }
    dir.divideScalar(dist);
    z.dir.copy(dir);
    v.copy(dir).multiplyScalar(z.speed);
    p.position.addScaledVector(dir, step);
    const res = this._collide();
    if (res.wall && dist > 2.5 && this.wallImpact > z.speed * 0.5) {
      // Something got in the way: grab it.
      this._dropWebs();
      p.state = 'air';
      this._enterWall(res.wallNormal);
    }
  }

  _arriveZip() {
    const p = this.p;
    const z = this.zip;
    this._dropWebs();
    const v = p.velocity;
    if (z.launch) {
      const hs = Math.hypot(z.dir.x, z.dir.z) || 1;
      this._launch((z.dir.x / hs) * 14, 17, (z.dir.z / hs) * 14);
      this._startTrick('flip');
      return;
    }
    if (z.kind === 'edge') {
      _b.copy(z.point).addScaledVector(z.normal, -0.3);
      _b.y = z.point.y;
      this.perchOut.copy(z.normal);
      this._startVault(_b, 0.3, 'perch', _c.set(0, 0, 0));
    } else if (z.kind === 'wall') {
      v.set(0, 0, 0);
      p.state = 'air';
      this._enterWall(z.normal);
    } else {
      v.copy(z.dir).multiplyScalar(6);
      v.y = 0;
      p.state = z.normal.y > 0.7 ? 'ground' : 'air';
    }
  }

  _dropWebs() {
    const p = this.p;
    for (const l of this.zip.lines) p.webs?.release(l);
    this.zip.lines.length = 0;
    if (this.swingLine) {
      p.webs?.release(this.swingLine);
      this.swingLine = null;
    }
  }

  // ---------------------------------------------------------------- walls

  _enterWall(n) {
    const p = this.p;
    const v = p.velocity;
    const wn = this.wallN.set(n.x, 0, n.z);
    if (wn.lengthSq() < 1e-4) return;
    wn.normalize();
    // Make sure there is actually a wall to hold on to at chest height.
    const hit = this.world.raycast(this.center, _a.copy(wn).negate(), p.radius + 1.0);
    if (!hit || Math.abs(hit.normal.y) > 0.5) return;
    wn.set(hit.normal.x, 0, hit.normal.z).normalize();
    p.position.addScaledVector(wn, p.radius + 0.05 - hit.distance);
    v.addScaledVector(wn, -v.dot(wn));
    v.y = clamp(v.y, -6, 14);
    const was = p.state;
    p.state = 'wall';
    this.wallClimbTime = 0;
    this.trick = null;
    this.landMode = null;
    if (was !== 'wall') this.emit('player:wallStart', { pos: p.position.clone(), normal: wn.clone() });
  }

  _wallSide(out) {
    const n = this.wallN;
    out.copy(this.camRight).addScaledVector(n, -this.camRight.dot(n));
    if (out.lengthSq() < 0.1) out.crossVectors(UP, n);
    return out.normalize();
  }

  _wall(h) {
    const p = this.p;
    const v = p.velocity;
    const n = this.wallN;
    const side = this._wallSide(_d);
    const my = this.move.y;
    const mx = this.move.x;
    if (my > 0.1) this.wallClimbTime += h;
    else this.wallClimbTime = 0;
    const upSpeed = my > 0 ? WALL_UP + (WALL_UP_SPRINT - WALL_UP) * smooth(0.8, 1.6, this.wallClimbTime) : WALL_DOWN;
    _e.copy(UP).multiplyScalar(my * upSpeed).addScaledVector(side, mx * WALL_SIDE);
    const k = 1 - Math.exp(-10 * h);
    v.x += (_e.x - v.x) * k;
    v.y += (_e.y - v.y) * k;
    v.z += (_e.z - v.z) * k;
    v.addScaledVector(n, -v.dot(n));
    p.position.addScaledVector(v, h);

    if (v.y > 0.5) {
      const ledge = probeLedge(this.world, p.position, n, p.radius, 2.1, _ledge);
      if (ledge) {
        _a.copy(n).negate().multiplyScalar(my > 0.5 ? 6 : 0);
        this._startVault(_b.copy(ledge).addScaledVector(n, -0.3), 0.32, 'ground', _a);
        return;
      }
    }

    const hit = this.world.raycast(this.center, _a.copy(n).negate(), p.radius + 0.9);
    if (!hit || Math.abs(hit.normal.y) > 0.5) {
      if (!this._wrapCorner(v.dot(side), side)) this._leaveWall(0.4);
      return;
    }
    n.set(hit.normal.x, 0, hit.normal.z).normalize();
    p.position.addScaledVector(n, p.radius + 0.05 - hit.distance);

    const res = this._collide();
    if (res.ground && v.y <= 0.1) {
      p.state = 'ground';
      return;
    }
    if (res.wall && res.wallNormal.dot(n) < 0.5 && this.wallImpact > 0.5) this._enterWall(res.wallNormal);
  }

  // Slid past an outer corner: find the adjacent face and continue on it.
  _wrapCorner(lateral, side) {
    const p = this.p;
    if (Math.abs(lateral) < 0.8) return false;
    const dir = _b.copy(side).multiplyScalar(Math.sign(lateral));
    const n = this.wallN;
    const o = _c.copy(this.center).addScaledVector(n, -(p.radius + 0.5));
    const hit = this.world.raycast(o, _e.copy(dir).negate(), 2.5);
    if (!hit || Math.abs(hit.normal.y) > 0.5 || hit.normal.dot(n) > 0.5) return false;
    const nn = _e.set(hit.normal.x, 0, hit.normal.z).normalize();
    p.position.copy(hit.point).addScaledVector(nn, p.radius + 0.05);
    p.position.y -= CENTER_Y;
    const v = p.velocity;
    const vy = v.y;
    v.copy(n).multiplyScalar(-Math.abs(lateral));
    v.y = vy;
    n.copy(nn);
    return true;
  }

  _leaveWall(push) {
    const p = this.p;
    p.velocity.addScaledVector(this.wallN, push);
    this.lastWallN.copy(this.wallN);
    this.wallCooldown = 0.25;
    p.state = 'air';
  }

  _wallJump() {
    const p = this.p;
    const n = this.wallN;
    const away = _a.copy(n);
    if (this.camFwd.dot(n) > 0.2) away.addScaledVector(this.camFwd, 1.2).normalize();
    this.lastWallN.copy(n);
    this.wallCooldown = 0.35;
    this._launch(away.x * 10, 10.5, away.z * 10);
  }

  // ---------------------------------------------------------------- vault & perch

  _startVault(to, dur, then, exitVel) {
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
    this.trick = null;
    this.landMode = null;
  }

  _updateVault(dt) {
    const p = this.p;
    const vt = this.vault;
    vt.t += dt;
    const s = Math.min(1, vt.t / vt.dur);
    const e = s * s * (3 - 2 * s);
    // Quadratic Bézier from → ctrl → to.
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
      this._launch(this.perchOut.x * 5, 5.5, this.perchOut.z * 5);
    } else {
      p.state = 'ground';
      p.position.addScaledVector(this.perchOut, -0.3);
    }
  }

  // Standing still near a drop: crouch on the edge facing out.
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
    this._startVault(e.point, 0.22, 'perch', _a.set(0, 0, 0));
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
        if (p.state === 'swing') this._releaseSwing(false, true);
        this._dropWebs();
        pos.y = b.h + 0.02;
        v.y = Math.max(0, v.y);
        p.state = 'ground';
      }
    }
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
      p.heading = Math.atan2(this.wallN.x, this.wallN.z);
    } else if (p.state === 'perch') {
      p.heading = Math.atan2(-this.perchOut.x, -this.perchOut.z);
    } else if (!this.vault.active) {
      if (Math.hypot(v.x, v.z) > 0.8) p.heading = Math.atan2(-v.x, -v.z);
      else if (p.state === 'ground' && this.wish.lengthSq() > 0.04) p.heading = Math.atan2(-this.wish.x, -this.wish.z);
    }
  }
}
