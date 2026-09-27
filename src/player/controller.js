import * as THREE from 'three';
import { closestOnSegment } from '../core/geo.js';
import { probeLedge, findPerchEdge } from './anchors.js';
import { SwingMove } from './swing.js';
import { ZipMove } from './zip.js';
import { WallMove } from './wall.js';

// Traversal state machine. Owns ground / air / dive movement, landings, vaults and perching, and
// delegates swinging, zipping and wall movement to their move modules. Movement is sub-stepped
// (≤ 0.3 m per step) so nothing tunnels through walls even at dive speed.
//   ground → walk / run / parkour sprint (see _ground), auto-vault and wall-run while sprinting, jump,
//            roll / superhero landings
//   air / dive → air control, grab walls, mantle ledges, head-first dive with a forward carve
//   perch → crouched on a ledge facing out; step off, leap, dive or swing away
//
// Ground locomotion (Marvel's Spider-Man style: the swing trigger sprints on the ground and swings in
// the air):
//   stick < WALK_INPUT (or Alt held / CapsLock on) → walk (~1.6 m/s)
//   stick beyond it, keyboard W                    → run (~7 m/s), a fast superhero jog
//   swing held on the ground                       → parkour sprint (~13 m/s): auto-vaults and runs up
//                                                    walls on contact; keep holding through a jump or
//                                                    off a ledge and the web goes out once airborne
// Speed eases in and out (ACCEL / BRAKE, exponential near the target), the turn rate is limited by a
// lateral acceleration (LAT_ACCEL), so the turning radius grows with speed, and reversing at speed
// skids to a stop and pivots. Exposed for animation: player.locomotion ('idle' | 'walk' | 'run' |
// 'sprint'), player.groundSpeed (m/s), player.turnRate (rad/s, + = turning left / CCW).

const G = 26;
const G_FLIGHT = 20; // gravity in a flight after letting go of a web (graceful arcs between swings)
const WALK_INPUT = 0.55;
const WALK_SPEED = 1.6;
const WALK_MIN = 1.0; // slowest walk (stick just past the dead zone)
const RUN_SPEED = 7;
const JOG_MIN = 3.6; // stick just past WALK_INPUT
const SPRINT_SPEED = 13;
const ACCEL = { walk: 5, run: 14, sprint: 9 }; // m/s² max acceleration per gait
const SPEED_RATE = 4.5; // 1/s: exponential approach once near the target speed
const BRAKE = 20; // m/s² max braking (no input, or slowing to a lower gait)
const SKID_ANGLE = 2.0; // rad: reversing further than this above SKID_SPEED skids and pivots
const SKID_SPEED = 4.5;
const SKID_BRAKE = 26;
const LAT_ACCEL = 26; // m/s² cornering grip: max turn rate = LAT_ACCEL / speed...
const TURN_MAX = 9; // ...capped at this (rad/s) when slow
const TURN_GAIN = 10; // 1/s: turn rate per radian still to turn
const UPHILL = 0.35; // speed lost per unit of uphill slope (rise / run)
// Gait thresholds on groundSpeed (m/s), with hysteresis.
const IDLE_BELOW = 0.25;
const RUN_ABOVE = 2.6;
const RUN_BELOW = 2.2;
const SPRINT_ABOVE = 9.5;
const SPRINT_BELOW = 8.5;
const JUMP_V = 15.5;
const JUMP_HOLD_GRAVITY = 0.62;
const AIR_ACCEL = 11;
const AIR_DRAG = G / (38 * 38);
const AIR_TURN = 1.2;
const DIVE_G = G * 1.5;
const DIVE_DRAG = DIVE_G / (46 * 46); // head-first terminal speed ~46 m/s
const DIVE_GLIDE = 16;
const CENTER_Y = 0.95;
const VAULT_MAX = 1.25;
const MAX_STEP = 0.3;
const EDGE_FOOTING = 0.45; // contact pushes at least this much upwards (sine) count as ground
const BOUNDS_MARGIN = 150;
// Leaving a perch with a big drop below (the RBZ crown) turns into a head-first plunge down the
// facade: little horizontal drift, no forward carve, until close to what is below or a web catches.
const PLUNGE_DROP = 45;
const PLUNGE_OUT = 7; // m/s outward hop when diving off
const PLUNGE_HS = 8; // max horizontal drift while plunging
const PLUNGE_DRIFT = 3.5; // ...and the least
const PLUNGE_END = 16; // m above the roof / street below: hand over to the normal dive carve
const PLUNGE_RUN_HS = 10; // running / jumping off a tower's roof: the plunge keeps up to this drift
const DROP_WAIT = 0.1; // s over a big drop after leaving a roof before that plunge starts

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
    this._listenKeys();
    this.swing = new SwingMove(this);
    this.zip = new ZipMove(this);
    this.wall = new WallMove(this);

    this.perchOut = new THREE.Vector3(0, 0, -1);
    this.perchHit = { point: new THREE.Vector3(), outward: new THREE.Vector3() };
    this.idleTime = 0;
    this.perchCheck = 0;
    // Scripted hop (Bézier from → ctrl → to), then state `then` with velocity `exit`.
    this.vault = {
      active: false,
      from: new THREE.Vector3(),
      ctrl: new THREE.Vector3(),
      to: new THREE.Vector3(),
      t: 0,
      dur: 0.3,
      then: 'ground',
      exit: new THREE.Vector3(),
    };

    this.landMode = null; // 'soft' | 'roll' | 'hard' while a landing plays out
    this.landT = 0;
    this.landDur = 0;
    this.trick = null; // 'flip' | 'twirl' | 'corkscrew' after a release
    this.trickT = 0;
    this.trickDur = 0;
    this.standTime = 0;
    // Ground locomotion (see _ground): travel direction, gait, skid, walk modifier.
    this.moveDir = new THREE.Vector3(0, 0, -1);
    this.locomotion = 'idle';
    this.groundSpeed = 0;
    this.turnRate = 0;
    this.skid = false;
    this.sprint = false;
    this.walkLock = false; // CapsLock on (walk)
    this.altHeld = false;
    this._lastHeading = 0;
    // Post-swing flight (lighter gravity) and short pushes applied over a few frames (boosts).
    this.flight = false;
    this.pushV = new THREE.Vector3();
    this.pushT = 0;
    this.wallTime = 0;
    this.coyote = 0;
    this.jumpHeld = false;
    this.airTime = 0;
    this.impactVy = 0;
    this.wallImpact = 0;
    this.plunge = false;
    this.plungeArmed = false;
    this.plungeHs = PLUNGE_HS;
    this.fromRoof = false; // airborne straight off a roof / the ground (not a swing, zip or wall)
    this.dropTime = 0;
    this.contact = {
      hit: false,
      ground: false,
      wall: false,
      ceiling: false,
      delta: new THREE.Vector3(),
      groundNormal: new THREE.Vector3(0, 1, 0),
      wallNormal: new THREE.Vector3(),
    };
  }

  get center() {
    return _center.copy(this.p.position).setY(this.p.position.y + CENTER_Y);
  }

  reset() {
    this.dropWebs();
    this.vault.active = false;
    this.clearActions();
    this.airTime = 0;
    this.swing.lateBoost = 0;
  }

  clearActions() {
    this.landMode = null;
    this.trick = null;
    this.plunge = false;
    this.plungeArmed = false;
  }

  emit(type, payload) {
    this.game.events.emit(type, payload);
  }

  update(dt) {
    const p = this.p;
    this._readInput(this.game.input);
    this.wall.cooldown -= dt;
    this.swing.retry -= dt;
    this.swing.lateBoost -= dt;
    this.swing.sinceRelease += dt;
    this.swing.updateLaunch(dt);
    this.coyote -= dt;
    if (this.landMode && (this.landT += dt) >= this.landDur) this.landMode = null;
    if (this.trick && (this.trickT += dt) >= this.trickDur) this.trick = null;
    this.airTime = p.state === 'air' || p.state === 'dive' ? this.airTime + dt : 0;
    this.standTime = p.state === 'ground' || p.state === 'perch' ? this.standTime + dt : 0;
    this.wallTime = p.state === 'wall' ? this.wallTime + dt : 0;

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
    if (p.state === 'swing' || p.state === 'zip' || p.state === 'wall' || p.state === 'perch') this.fromRoof = false;
    if (p.state !== 'air' && p.state !== 'dive') {
      this.flight = false;
      this.pushT = 0;
    }
    this._safety(dt);
    this._checkPerch(dt);
    this._updateHeading(dt);
    this._updateGait(dt);
  }

  // ---------------------------------------------------------------- input

  _readInput(input) {
    const yaw = this.game.cameraRig?.yaw ?? this.p.heading;
    this.camFwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.camRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.move.x = input.move.x;
    this.move.y = input.move.y;
    this.wish.set(0, 0, 0).addScaledVector(this.camFwd, input.move.y).addScaledVector(this.camRight, input.move.x);
    // Walk modifier: Alt held, or CapsLock on (read from the key events' modifier state, so it is
    // right on every platform), see _listenKeys.
    const keys = input.keys;
    this.altHeld = !!keys && (keys.has('AltLeft') || keys.has('AltRight'));
  }

  // CapsLock state for the walk toggle, and Alt kept from focusing the browser's menu bar.
  _listenKeys() {
    if (typeof window === 'undefined' || this._keysBound) return;
    this._keysBound = true;
    const onKey = (e) => {
      if (e.getModifierState) this.walkLock = e.getModifierState('CapsLock');
      if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
  }

  _buttons(input) {
    if (this.vault.active) return;
    if (input.released('jump')) this.jumpHeld = false;
    if (input.pressed('zip')) this.zip.tryStart();
    if (input.pressed('jump')) this._jumpPressed();
    if (input.pressed('dive')) this._divePressed();
    const st = this.p.state;
    const held = input.down('swing');
    // On the ground the swing trigger is the parkour sprint (with the stick pushed); see tryStart
    // for what it does standing still.
    this.sprint = held && (st === 'ground' || st === 'perch');
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
        if (this.landMode === 'hard' && this.landT < 0.3) break;
        // Sprinting (swing held): a web launch, up and on into the swing; else a plain jump.
        if (!this.sprint || !this.swing.webLaunch()) this.launch(v.x, JUMP_V, v.z);
        break;
      case 'air':
        // Tapped just after a swing let go by itself: still the boosted release.
        if (this.swing.lateBoost > 0) this.swing.boost();
        else if (this.coyote > 0) this.launch(v.x, JUMP_V, v.z);
        break;
      case 'perch':
        _a.copy(this.perchOut).multiplyScalar(5).addScaledVector(this.camFwd, 3);
        this.leaveHighPerch(_a.x, JUMP_V * 0.85, _a.z);
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

  // Add velocity dv over `time` seconds (boosted releases), instead of in one frame.
  push(dv, time) {
    this.pushV.copy(dv).divideScalar(time);
    this.pushT = time;
  }

  launch(vx, vy, vz) {
    const p = this.p;
    // (Off the ground, or a coyote-time jump just after running off an edge.)
    this.fromRoof = p.state === 'ground' || (p.state === 'air' && this.fromRoof);
    this.dropTime = 0;
    p.velocity.set(vx, vy, vz);
    p.state = 'air';
    this.coyote = 0;
    this.jumpHeld = true;
    this.flight = false;
    this.landMode = null;
    this.plunge = false;
    this.plungeArmed = false;
    this.emit('player:jump', { pos: p.position.clone() });
  }

  // Leap / step off a perch; over a big drop the fall turns into a head-first plunge.
  leaveHighPerch(vx, vy, vz) {
    const high = this.p.state === 'perch' && this._perchDrop() > PLUNGE_DROP;
    this.launch(vx, vy, vz);
    this.plungeArmed = high;
  }

  _perchDrop() {
    const p = this.p;
    const x = p.position.x + this.perchOut.x * 2.5;
    const z = p.position.z + this.perchOut.z * 2.5;
    return p.position.y - this.floorAt(x, z);
  }

  // Nothing to land on for PLUNGE_DROP below the feet (a lookup first; a ray cast confirms, since
  // landmark crowns and ledges stick out of the footprints the lookup knows). The caller also waits
  // DROP_WAIT with this true, as the capsule can still be riding a roof's lip past the edge.
  _bigDrop() {
    const pos = this.p.position;
    if (pos.y - this.floorAt(pos.x, pos.z) <= PLUNGE_DROP) return false;
    return !this.world.raycast(_a.copy(pos), _down, PLUNGE_DROP);
  }

  // Roof / terrain height under x, z (lookups only, no ray cast).
  floorAt(x, z) {
    const g = this.game.city?.heightAt?.(x, z);
    return Math.max(this.world.roofHeightAt(x, z), Number.isFinite(g) ? g : 0);
  }

  _startPlunge() {
    const v = this.p.velocity;
    this.plungeHs = clamp(Math.hypot(v.x, v.z), PLUNGE_HS, PLUNGE_RUN_HS);
    this.p.state = 'dive';
    this.plunge = true;
    this.fromRoof = false;
    this.plungeArmed = false;
    this.trick = null;
    this.game.cameraRig?.fovKick?.(6);
  }

  _divePressed() {
    const p = this.p;
    const v = p.velocity;
    if (p.state === 'dive') {
      p.state = 'air';
      this.plunge = false;
      return;
    }
    if (p.state === 'perch') {
      // Swan dive off the ledge: a small hop out, then head-first (straight down a tall facade).
      const high = this._perchDrop() > PLUNGE_DROP;
      // The hop out, pushed over a few frames (the legs extend) rather than in one.
      v.set(0, 0, 0);
      this.push(_b.copy(this.perchOut).multiplyScalar(high ? PLUNGE_OUT : 8).setY(4), 0.15);
      this.emit('player:jump', { pos: p.position.clone() });
      if (high) {
        this._startPlunge();
        return;
      }
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
  // (`toward`: steer towards this direction instead, at the input's strength.)
  steerTowardsWish(h, rate, toward = this.wish) {
    const wl = this.wish.length();
    if (wl < 0.2) return;
    const v = this.p.velocity;
    const hs = Math.hypot(v.x, v.z);
    if (hs < 2) return;
    const cur = Math.atan2(v.x, v.z);
    let d = Math.atan2(toward.x, toward.z) - cur;
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
    this.swing.dropLaunch();
  }

  // ---------------------------------------------------------------- collision

  // Push the capsule out of the city; records impact speeds and removes velocity into contacts.
  // The result is the controller's own copy (world.collideCapsule recycles its result objects), so
  // callers may hold it until the next collide().
  collide() {
    const p = this.p;
    const r = p.radius;
    _segA.set(p.position.x, p.position.y + r, p.position.z);
    _segB.set(p.position.x, p.position.y + p.height - r, p.position.z);
    const hit = this.world.collideCapsule(_segA, _segB, r);
    const res = this.contact;
    res.hit = hit.hit;
    res.ground = hit.ground;
    res.wall = hit.wall;
    res.ceiling = !!hit.ceiling;
    res.delta.copy(hit.delta);
    res.groundNormal.copy(hit.groundNormal);
    res.wallNormal.copy(hit.wallNormal);
    if (!res.hit) return res;
    p.position.set(_segA.x, _segA.y - r, _segA.z);
    const v = p.velocity;
    this.impactVy = -v.y;
    // Feet on a convex edge (an eave, a kerb-like step, a roof lip) push out diagonally, which the
    // world reads as a wall below 53 degrees; mostly-upwards pushes while coming down are footing.
    if (!res.ground && v.y <= 0 && res.delta.y > EDGE_FOOTING * res.delta.length()) res.ground = true;
    if (res.ground && v.y < 0) v.y = 0;
    if (res.ceiling && v.y > 0) v.y = 0;
    this.wallImpact = 0;
    // A wall contact from something below the knee (a step's edge) is not a wall to stop at: the
    // capsule rides up over it. (Still needed with push-direction contacts: the edge of a 0.2-0.3 m
    // step pushes out at ~30 degrees, which would otherwise stop a run dead.)
    if (res.wall && !this._wallAtKnee(res.wallNormal)) res.wall = false;
    if (res.wall) {
      const into = v.dot(res.wallNormal);
      if (into < 0) {
        this.wallImpact = -into;
        v.addScaledVector(res.wallNormal, -into);
      }
    }
    return res;
  }

  _wallAtKnee(n) {
    const p = this.p;
    _a.set(p.position.x, p.position.y + 0.3, p.position.z);
    const hit = this.world.raycast(_a, _b.copy(n).negate(), p.radius + 0.3);
    return !!hit && Math.abs(hit.normal.y) < 0.5;
  }

  // Ran or flew into an obstacle: vault it if it is low, otherwise grab it and climb (unless climb is
  // false: running without the sprint only vaults).
  obstacle(n, speed, climb = true) {
    const p = this.p;
    const ledge = probeLedge(this.world, p.position, n, p.radius, VAULT_MAX, _ledge);
    if (ledge) {
      const rise = ledge.y - p.position.y;
      _a.copy(n).negate().multiplyScalar(Math.max(speed, 6));
      this.startVault(_b.copy(ledge).addScaledVector(n, -0.55), 0.22 + 0.1 * (rise / VAULT_MAX), 'ground', _a);
      return;
    }
    if (!climb) return;
    this.wall.enter(n);
    if (p.state === 'wall' && this.move.y > 0.3) p.velocity.y = Math.max(p.velocity.y, speed * 0.85);
  }

  // ---------------------------------------------------------------- ground

  // Target gait from the input: null (no input / recovering from a hard landing), 'walk', 'run' or
  // 'sprint', with its target speed in this._target.
  _gaitIntent(mag) {
    if (mag < 0.05) return null;
    if (this.sprint) {
      this._target = SPRINT_SPEED;
      return 'sprint';
    }
    if (mag < WALK_INPUT || this.altHeld || this.walkLock) {
      this._target = WALK_MIN + (WALK_SPEED + 0.2 - WALK_MIN) * clamp((Math.min(mag, WALK_INPUT) - 0.1) / (WALK_INPUT - 0.1), 0, 1);
      return 'walk';
    }
    this._target = JOG_MIN + (RUN_SPEED - JOG_MIN) * clamp((mag - WALK_INPUT) / 0.35, 0, 1);
    return 'run';
  }

  _ground(h) {
    const p = this.p;
    const v = p.velocity;
    const hard = this.landMode === 'hard' && this.landT < 0.4;
    let speed = Math.hypot(v.x, v.z);
    const dir = this.moveDir;
    if (speed > 0.3) dir.set(v.x / speed, 0, v.z / speed);
    else dir.set(-Math.sin(p.heading), 0, -Math.cos(p.heading));
    const mag = this.wish.length();
    const gait = hard ? null : this._gaitIntent(mag);
    let a;
    this.skid = false;
    if (gait) {
      const wx = this.wish.x / mag;
      const wz = this.wish.z / mag;
      const cur = Math.atan2(dir.x, dir.z);
      let diff = Math.atan2(wx, wz) - cur;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > SKID_ANGLE && speed > SKID_SPEED) {
        // Reversing at speed: plant and skid to a stop, then pivot and go.
        this.skid = true;
        a = -SKID_BRAKE;
      } else {
        const omega = Math.min(TURN_MAX, LAT_ACCEL / Math.max(speed, 0.5));
        const turn = clamp(diff * TURN_GAIN, -omega, omega) * h;
        const ang = cur + turn;
        dir.set(Math.sin(ang), 0, Math.cos(ang));
        // Cornering hard costs a little speed; so does running uphill.
        let target = this._target * (1 - 0.3 * smooth(0.5, 1.6, Math.abs(diff)));
        const gn = this.contact.groundNormal;
        if (gn.y > 0.5 && gn.y < 0.999) {
          const up = -(gn.x * dir.x + gn.z * dir.z) / gn.y;
          if (up > 0) target *= Math.max(0.5, 1 - UPHILL * up);
        }
        a = speed < target ? Math.min(ACCEL[gait], (target - speed) * SPEED_RATE) : -Math.min(BRAKE, (speed - target) * SPEED_RATE * 1.5 + 1);
      }
    } else {
      a = -Math.min(hard ? 14 : BRAKE, speed * 6 + 3);
    }
    speed = Math.max(0, speed + a * h);
    if (this.landMode === 'roll' && speed > 0.1 && speed < 7) speed = 7;
    v.x = dir.x * speed;
    v.z = dir.z * speed;
    v.y = -4;
    p.position.addScaledVector(v, h);
    const x = p.position.x;
    const y = p.position.y;
    const z = p.position.z;
    const res = this.collide();
    // Standing on a slope: lift straight up instead of along its normal, which would slide an idle
    // player downhill (the Kopje, pitched landmark roofs).
    const d = res.delta;
    if (res.ground && !res.wall && d.y > 0.6 * d.length()) p.position.set(x, y + d.lengthSq() / d.y, z);
    if (!res.ground) {
      // Stepped off something small: stick to the surface below, otherwise start falling.
      _a.set(p.position.x, p.position.y + 0.3, p.position.z);
      const g = this.world.raycast(_a, _down, 0.8);
      if (g && g.normal.y > 0.6) {
        p.position.y = g.point.y;
        v.y = 0;
      } else {
        p.state = 'air';
        v.y = 0;
        this.coyote = 0.14;
        this.fromRoof = true;
        this.dropTime = 0;
        return;
      }
    }
    // Into a wall: walking just stops (sliding along it); running vaults low obstacles; the sprint
    // also runs up walls.
    if (res.wall && !hard && gait && gait !== 'walk' && mag > 0.3 && this.wish.dot(res.wallNormal) < -0.45 * mag) {
      this.obstacle(res.wallNormal, Math.max(Math.hypot(v.x, v.z), this.wallImpact), gait === 'sprint');
      if (p.state !== 'ground') return;
    }
    // Held back by something the contacts don't count as a wall (a knee-high lip): the speed is what
    // was actually covered, so nothing runs on the spot at full speed.
    if (res.hit && speed > 0.5) {
      const moved = ((p.position.x - x) * dir.x + (p.position.z - z) * dir.z + speed * h) / h;
      if (moved < speed * 0.6) {
        // Running into a lip / parapet: vault it (as with a wall) rather than stall against it.
        const dl = Math.hypot(d.x, d.z);
        if (gait && gait !== 'walk' && dl > 1e-4 && !hard) {
          this.obstacle(_b.set(d.x / dl, 0, d.z / dl), speed, false);
          if (this.vault.active) return;
        }
        const k = Math.max(0, moved) / speed;
        v.x *= k;
        v.z *= k;
      }
    }
  }

  // player.locomotion / groundSpeed / turnRate for the animation system.
  _updateGait(dt) {
    const p = this.p;
    const v = p.velocity;
    const gs = Math.hypot(v.x, v.z);
    const grounded = p.state === 'ground' || p.state === 'perch';
    this.groundSpeed = grounded ? gs : 0;
    let dh = p.heading - this._lastHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this._lastHeading = p.heading;
    const rate = grounded ? dh / Math.max(dt, 1e-3) : 0;
    this.turnRate += (rate - this.turnRate) * Math.min(1, dt * 12);
    let g = this.locomotion;
    if (!grounded || gs < IDLE_BELOW) g = 'idle';
    else if (g === 'idle') g = gs > SPRINT_ABOVE ? 'sprint' : gs > RUN_ABOVE ? 'run' : 'walk';
    else if (g === 'walk') g = gs > SPRINT_ABOVE ? 'sprint' : gs > RUN_ABOVE ? 'run' : 'walk';
    else if (g === 'run') g = gs > SPRINT_ABOVE ? 'sprint' : gs < RUN_BELOW ? 'walk' : 'run';
    else if (g === 'sprint') g = gs < RUN_BELOW ? 'walk' : gs < SPRINT_BELOW ? 'run' : 'sprint';
    this.locomotion = g;
  }

  // ---------------------------------------------------------------- air & dive

  _air(h, dive) {
    const p = this.p;
    const v = p.velocity;
    if (this.plungeArmed && v.y < -1) {
      this._startPlunge();
      dive = true;
    } else if (!dive && this.fromRoof && v.y < -1) {
      // Ran or jumped off a tower's roof (not from a perch): the same head-first plunge down its
      // face, so holding swing catches a web back up it instead of falling past every roof in
      // reach with nothing to swing from.
      this.dropTime = this._bigDrop() ? this.dropTime + h : 0;
      if (this.dropTime > DROP_WAIT) {
        const hs = Math.hypot(v.x, v.z);
        if (hs > 1) this.perchOut.set(v.x / hs, 0, v.z / hs);
        else this.perchOut.set(-Math.sin(p.heading), 0, -Math.cos(p.heading));
        this._startPlunge();
        dive = true;
      }
    }
    let g = dive ? DIVE_G : this.flight ? G_FLIGHT : G;
    // Floatier rise only while the jump button that launched us is still held (launches by swing /
    // wall moves set jumpHeld too, and without the button check it stuck until the next Space tap,
    // making every later swing release climb half as high again).
    if (!dive && this.jumpHeld && v.y > 0 && this.game.input.down('jump')) g *= JUMP_HOLD_GRAVITY;
    v.y -= g * h;
    if (this.pushT > 0) {
      v.addScaledVector(this.pushV, Math.min(h, this.pushT));
      this.pushT -= h;
    }
    v.multiplyScalar(1 - (dive ? DIVE_DRAG : AIR_DRAG) * v.length() * h);
    // Air control steers but never adds speed beyond what you already carry.
    const hs0 = Math.hypot(v.x, v.z);
    // (A plunge is cinematic: the drift stays straight out from the facade whatever the stick says.)
    const accel = this.plunge ? 0 : dive ? 14 : AIR_ACCEL;
    v.x += this.wish.x * accel * h;
    v.z += this.wish.z * accel * h;
    if (hs0 > 10 && !this.plunge) this.steerTowardsWish(h, AIR_TURN);
    const hs1 = Math.hypot(v.x, v.z);
    const cap = Math.max(hs0, dive ? 22 : 10);
    if (hs1 > cap) {
      v.x *= cap / hs1;
      v.z *= cap / hs1;
    }
    if (dive && this.plunge) {
      // Plunging down a facade: a steady drift out from it (air drag would stall it against the
      // piers); near the bottom the normal carve takes over.
      const drift = clamp(hs1, PLUNGE_DRIFT, this.plungeHs);
      if (hs1 > 0.1 && drift !== hs1) {
        v.x *= drift / hs1;
        v.z *= drift / hs1;
      }
      if (p.position.y - this.floorAt(p.position.x, p.position.z) < PLUNGE_END) this.plunge = false;
    } else if (dive && hs1 < DIVE_GLIDE) {
      // Head-first dives carve forward instead of dropping straight down the building face.
      const k = (DIVE_GLIDE - hs1) * (1 - Math.exp(-1.6 * h));
      v.x -= Math.sin(p.heading) * k;
      v.z -= Math.cos(p.heading) * k;
    }
    p.position.addScaledVector(v, h);
    const res = this.collide();
    if (res.ground && this.impactVy >= -0.5) {
      this.land(Math.max(0, this.impactVy));
    } else if (res.wall && !res.ground && this.wall.wantsToGrab(res.wallNormal, this.wallImpact)) {
      this.obstacle(res.wallNormal, this.wallImpact);
    }
  }

  // Touchdown: superhero landing on big impacts, a roll when carrying speed, a knee dip otherwise.
  // There is no fall damage.
  land(vy) {
    const p = this.p;
    const v = p.velocity;
    const wasDive = p.state === 'dive';
    const hs = Math.hypot(v.x, v.z);
    p.state = 'ground';
    // Run on the way we were going (or facing), not the last ground direction.
    if (hs > 0.3) this.moveDir.set(v.x / hs, 0, v.z / hs);
    else this.moveDir.set(-Math.sin(p.heading), 0, -Math.cos(p.heading));
    this.trick = null;
    this.plunge = false;
    this.plungeArmed = false;
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

  // Scripted hop along a curve (ledges, wall tops, zip arrivals, round overhangs); physics resumes at
  // the end in state `then` ('ground' | 'perch' | 'wall').
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
    // (Out round an overhang: carry on climbing the face wall.normal already points out of.)
    else if (vt.then === 'wall') p.state = 'wall';
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
      this.leaveHighPerch(this.perchOut.x * 5, 5.5, this.perchOut.z * 5);
    } else {
      p.state = 'ground';
      p.position.addScaledVector(this.perchOut, -0.3);
    }
  }

  // Standing still near a drop: step to the lip and crouch facing out.
  _checkPerch(dt) {
    const p = this.p;
    const v = p.velocity;
    const idle = p.state === 'ground' && this.landMode !== 'hard' && !this.vault.active;
    if (!idle || this.wish.lengthSq() > 0.01 || Math.hypot(v.x, v.z) > 0.8) {
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
        // Somehow inside a building volume: pop onto the roof if it is close, else out of the
        // nearest facade.
        if (p.state === 'swing') this.swing.release(false, true);
        this.dropWebs();
        if (b.h - pos.y >= 2.5) this._pushOutOf(b);
        // Still inside something (a close roof, or the neighbour of a terrace)? Stand on top of it.
        const inside = this.world.buildingAt(pos.x, pos.z);
        if (inside && pos.y < inside.h) {
          pos.y = inside.h + 0.02;
          v.y = Math.max(0, v.y);
          p.state = 'ground';
        } else {
          p.state = 'air';
        }
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

  _pushOutOf(b) {
    const p = this.p;
    const pos = p.position;
    const fp = b.fp;
    const n = fp.length / 2;
    let best = null;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const c = closestOnSegment(pos.x, pos.z, fp[i * 2], fp[i * 2 + 1], fp[j * 2], fp[j * 2 + 1]);
      if (!best || c.d2 < best.d2) best = c;
    }
    const dx = best.x - pos.x;
    const dz = best.z - pos.z;
    const d = Math.hypot(dx, dz) || 1;
    pos.x = best.x + (dx / d) * (p.radius + 0.05);
    pos.z = best.z + (dz / d) * (p.radius + 0.05);
    p.velocity.set(0, Math.min(p.velocity.y, 0), 0);
  }

  _updateHeading() {
    const p = this.p;
    const v = p.velocity;
    if (p.state === 'wall') {
      p.heading = Math.atan2(this.wall.normal.x, this.wall.normal.z);
    } else if (p.state === 'perch') {
      p.heading = Math.atan2(-this.perchOut.x, -this.perchOut.z);
    } else if (!this.vault.active) {
      // On the ground the body faces the travel direction, which turns at a limited rate (so a
      // standing turn pivots instead of snapping round).
      if (p.state === 'ground') {
        if (Math.hypot(v.x, v.z) > 0.3 || this.wish.lengthSq() > 0.0025) p.heading = Math.atan2(-this.moveDir.x, -this.moveDir.z);
      } else if (Math.hypot(v.x, v.z) > 0.8) p.heading = Math.atan2(-v.x, -v.z);
    }
  }
}
