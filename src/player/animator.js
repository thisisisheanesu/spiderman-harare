import * as THREE from 'three';
import { PIVOT_Y } from './model.js';
import { solveTwoBone } from './ik.js';

// Animation state machine for the rigged Spider-Man: the shared mocap / keyframed clips played through
// one AnimationMixer, chosen and cross-faded from the traversal state, plus procedural layers on top.
//
//   ground   idle (+ idle_look now and then) / walk / run / sprint as a phase-synchronised 1D blend on
//            player.groundSpeed: every gait clip starts its cycle on the left heel strike, so they share
//            one phase, advanced at groundSpeed / (the blend's stride length) - the planted foot moves
//            at the ground speed (no foot sliding) at any blend. Standing turns step in place
//            (turn_left / turn_right); runs bank into turns (lean from speed x turn rate); a skid
//            plants back in a crouch. Landings: land (knee dip), land_hard (superhero landing), roll.
//   perch    crouch_idle, facing out.
//   air      jump_start (take-off) -> jump_air; flights after a web -> fall (the tucked superhero
//            crouch); long fast drops -> skydive, belly down; tricks spin the tuck / the spread.
//   dive     dive, head first along the velocity.
//   swing    the swing cycle (legs back -> tuck -> legs forward) driven by where the body is on its
//            arc, not by time; the body hangs along the rope from the web hand, the legs trail with
//            speed. Left-hand webs play the mirrored clip.
//   zip      zip (pulling on the lines), leaning towards the target.
//   wall     fast along the wall: a wall-run (the gait blend with the wall as the floor); slow: the
//            crawl (climb), turned towards where it goes; hands and feet on the wall.
//   vault    climb_up over the obstacle, time-scaled to the vault.
// Arms: while a web line is out (being shot or holding), that hand is IK'd onto the line towards its
// anchor (two-bone IK, elbow as the clip bends it), with the "thwip" hand from web_shoot while it
// flies - the web really leaves the palm and the swing really hangs from it.
// Cross-fades: every clip keys every bone, weights ease exponentially to the target mix and are
// normalised to 1 (no bind-pose leak); the body's orientation and pivot offset ease too.

const TAU = Math.PI * 2;
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// [slot, clip, one-shot]
const SLOTS = [
  ['idle', 'idle'],
  ['look', 'idle_look'],
  ['walk', 'walk'],
  ['run', 'run'],
  ['sprint', 'sprint'],
  ['turnL', 'turn_left'],
  ['turnR', 'turn_right'],
  ['crouch', 'crouch_idle'],
  ['jump', 'jump_start', true],
  ['air', 'jump_air'],
  ['fall', 'fall'],
  ['skydive', 'skydive'],
  ['dive', 'dive'],
  ['land', 'land', true],
  ['landHard', 'land_hard', true],
  ['roll', 'roll', true],
  ['swingR', 'swing'],
  ['swingL', 'swing_m'],
  ['zip', 'zip'],
  ['climb', 'climb'],
  ['vault', 'climb_up', true],
];

// Gait clips: stride length (m per cycle) = speed_mps x duration on the reference rig.
const STRIDE = { walk: 1.05 * 1.333, run: 6.26 * 0.933, sprint: 9.44 * 0.667 };
const CLIMB_SPEED = 0.48; // m/s the crawl covers at timeScale 1 (hands and feet planted)
const CLIMB_GAP = 0.36; // m from the model's origin to its hands / feet on the wall
const WALL_RUN_TILT = 0.42; // rad: the wall-run body leans this far up from the wall's normal
const WALL_RUN_ABOVE = 4.2; // m/s along the wall: run (with hysteresis down to WALL_RUN_BELOW)
const WALL_RUN_BELOW = 3.4;
const IDLE_LOOK_AFTER = 7; // s standing still before a look round

// Clip windows for the one-shots: [start, end] in clip seconds.
const JUMP_WIN = [0.14, 0.62];
const LAND_WIN = [0.05, 0.95];
const HARD_WIN = [0.04, 1.2];
const ROLL_WIN = [0.34, 1.34];
const VAULT_WIN = [0.0, 0.55];

const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _r = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _spin = new THREE.Quaternion();
const _target = new THREE.Vector3();
const _shoulder = new THREE.Vector3();
const SIDES = ['L', 'R'];
const STILL_KEYS = ['idle', 'turnL', 'turnR'];

// Quaternion for a body whose head points along `up` and chest faces `fwd` (the model faces -Z).
function basis(up, fwd, out) {
  _z.copy(fwd).negate().addScaledVector(up, fwd.dot(up));
  if (_z.lengthSq() < 1e-6) {
    _z.set(Math.abs(up.x) < 0.9 ? 1 : 0, 0, Math.abs(up.x) < 0.9 ? 0 : 1);
    _z.addScaledVector(up, -_z.dot(up));
  }
  _z.normalize();
  _x.crossVectors(up, _z);
  _m.makeBasis(_x, up, _z);
  return out.setFromRotationMatrix(_m);
}

class Slot {
  constructor(key, action, once) {
    this.key = key;
    this.action = action;
    this.dur = action.getClip().duration;
    this.once = !!once;
    this.time = 0;
    this.rate = 1;
    this.w = 0;
    this.target = 0;
  }
}

class Arm {
  constructor(side, bones) {
    const s = side === 'L' ? '_l' : '_r';
    this.upper = bones['upperarm' + s];
    this.lower = bones['lowerarm' + s];
    this.hand = bones['hand' + s];
    this.middle = bones['middle_01' + s];
    this.length = this.lower.position.length() + this.hand.position.length();
    this.w = 0;
    this.want = 0;
    this.shooting = 0; // 0..1: the "thwip" hand
    this.target = new THREE.Vector3();
    this.fingers = [];
    for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      for (let i = 1; i <= 3; i++) {
        const b = bones[`${f}_0${i}${s}`];
        if (b) this.fingers.push({ bone: b, thwip: new THREE.Quaternion() });
      }
    }
  }
}

export class Animator {
  constructor(model, object) {
    this.model = model;
    this.object = object;
    this.bones = model.bones;
    this.mixer = new THREE.AnimationMixer(model.root);
    this.slots = {};
    this.list = [];
    for (const [key, name, once] of SLOTS) {
      const clip = model.clips[name] || model.clips[name.replace(/_m$/, '')];
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
      action.enabled = false;
      action.weight = 0;
      const slot = new Slot(key, action, once);
      this.slots[key] = slot;
      this.list.push(slot);
    }
    this.arms = { L: new Arm('L', this.bones), R: new Arm('R', this.bones) };
    this._thwipPose(model.clips);
    // Bones the procedural layers write: restored to the mixer's output before each mixer update
    // (the mixer only writes bones whose blended value changed).
    this.thighs = [this.bones.thigh_l, this.bones.thigh_r];
    this.overlay = this.thighs.slice();
    for (const arm of Object.values(this.arms)) {
      this.overlay.push(arm.upper, arm.lower);
      for (const f of arm.fingers) this.overlay.push(f.bone);
    }
    this.saved = this.overlay.map((b) => b.quaternion.clone());

    this.mode = '';
    this.prevState = '';
    this.modeT = 0;
    this.phase = 0; // shared gait phase (0..1, left heel strike at 0)
    this.idleClock = 0;
    this.lookT = -1;
    this.landKind = null;
    this.landT = 0;
    this.jumpT = 10;
    this.swingT = 0.3;
    this.wallRun = false;
    this.fallK = 0;
    this.flightK = 0;
    this.lean = 0;
    this.trail = 0;
    this._trailK = 0;
    this.fade = 10;
    // Body orientation / placement (eased).
    this.body = new THREE.Quaternion();
    this.offset = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._fwd = new THREE.Vector3(0, 0, -1);
    this._offset = new THREE.Vector3();
    this._rate = 14;
    this.stats = { mixerMs: 0 };
  }

  // The "thwip" hand (index and pinky out, middle and ring folded) from web_shoot, both hands.
  _thwipPose(clips) {
    const sample = (clip, bone, t, out) => {
      const track = clip?.tracks.find((k) => k.name === bone + '.quaternion');
      if (!track) return false;
      const v = track.createInterpolant().evaluate(t);
      out.set(v[0], v[1], v[2], v[3]).normalize();
      return true;
    };
    for (const [side, clip] of [['R', clips.web_shoot], ['L', clips.web_shoot_m]]) {
      const arm = this.arms[side];
      for (const f of arm.fingers) if (!sample(clip, f.bone.name, 0.25, f.thwip)) f.thwip.copy(f.bone.quaternion);
    }
  }

  // Jump straight to the pose for the current state (spawn, teleports).
  snap(player, ctrl) {
    this.mode = '';
    for (const s of this.list) s.w = 0;
    this.update(1, player, ctrl, true);
  }

  update(dt, p, ctrl, snap = false) {
    const t0 = performance.now();
    const mode = this._mode(p, ctrl);
    if (mode !== this.mode) {
      this._enter(mode);
      this.mode = mode;
      this.modeT = 0;
    } else this.modeT += dt;
    for (const s of this.list) s.target = 0;
    this._pose(dt, p, ctrl);
    this._mix(snap ? 1 : damp(this.fade, dt), dt);
    this._placeBody(dt, p, ctrl, snap);
    this.object.updateMatrixWorld(true);
    this._arms(dt, p, snap);
    this._legs(dt, p, ctrl);
    this.stats.mixerMs = performance.now() - t0;
    this.prevState = p.state;
  }

  // ------------------------------------------------------------------ state -> mode

  _mode(p, c) {
    const st = p.state;
    const prev = this.prevState;
    // Touchdown / take-off bookkeeping (the controller's own timers are shorter than the clips).
    if (st === 'ground' && prev && prev !== 'ground' && prev !== 'perch') {
      this.landKind = c.landMode;
      this.landT = 0;
    }
    if ((st === 'air' || st === 'dive') && (prev === 'ground' || prev === 'perch' || prev === 'wall') && p.velocity.y > 2) {
      this.jumpT = 0;
    }
    if (c.vault.active) {
      const vt = c.vault;
      if (vt.then === 'perch' && vt.from.distanceTo(vt.to) < 1.6) return 'perch';
      if (vt.then === 'wall') return 'wall';
      return 'vault';
    }
    switch (st) {
      case 'ground': {
        const k = this.landKind;
        const moving = p.groundSpeed > 1.2;
        if (k === 'hard' && this.landT < 1.05 && !(moving && this.landT > 0.5)) return 'landHard';
        if (k === 'roll' && this.landT < c.landDur + 0.08) return 'roll';
        if (k === 'soft' && this.landT < 0.7 && !(moving && this.landT > 0.18)) return 'land';
        this.landKind = null;
        return c.skid ? 'skid' : 'loco';
      }
      case 'perch':
        return 'perch';
      case 'air':
        if (c.trick) return c.trick === 'flip' ? 'flip' : 'spin';
        return this.jumpT < JUMP_WIN[1] - JUMP_WIN[0] ? 'jump' : 'air';
      case 'dive':
        return 'dive';
      case 'swing':
        return 'swing';
      case 'zip':
        return 'zip';
      case 'wall':
        return 'wall';
      default:
        return 'air';
    }
  }

  _enter(mode) {
    const s = this.slots;
    const start = (slot, t) => {
      if (slot) slot.time = t;
    };
    if (mode === 'jump') start(s.jump, JUMP_WIN[0]);
    else if (mode === 'land') start(s.land, LAND_WIN[0]);
    else if (mode === 'landHard') start(s.landHard, HARD_WIN[0]);
    else if (mode === 'roll') start(s.roll, ROLL_WIN[0]);
    else if (mode === 'vault') start(s.vault, VAULT_WIN[0]);
    else if (mode === 'swing') this.swingT = 0.3;
  }

  // ------------------------------------------------------------------ poses

  _set(key, w, time, rate) {
    const s = this.slots[key];
    if (!s) return;
    s.target += w;
    if (time !== undefined) s.time = time;
    if (rate !== undefined) s.rate = rate;
  }

  _pose(dt, p, c) {
    const v = p.velocity;
    const up = this._up.copy(Y);
    const fwd = this._fwd.set(-Math.sin(p.heading), 0, -Math.cos(p.heading));
    this._offset.set(0, 0, 0);
    this._rate = 14;
    this.landT += dt;
    this.jumpT += dt;
    this.flightK += ((c.flight ? 1 : 0) - this.flightK) * damp(4, dt);
    let lean = 0;
    let fallK = 0;
    switch (this.mode) {
      case 'loco':
        lean = this._loco(dt, p, c, 1);
        this.fade = 10;
        break;
      case 'skid':
        this._loco(dt, p, c, 0.35);
        this._set('land', 0.65, 0.3, 0);
        up.addScaledVector(fwd, -0.3).normalize();
        this.fade = 12;
        break;
      case 'land':
        this._oneShot('land', LAND_WIN, 1.25, dt);
        this.fade = 26;
        break;
      case 'landHard':
        this._oneShot('landHard', HARD_WIN, 1.15, dt);
        this.fade = 32;
        break;
      case 'roll':
        this._oneShot('roll', ROLL_WIN, (ROLL_WIN[1] - ROLL_WIN[0]) / Math.max(0.3, c.landDur), dt);
        this.fade = 22;
        break;
      case 'perch':
        this._set('crouch', 1);
        this.idleClock = 0;
        this._rate = 9;
        this.fade = 8;
        break;
      case 'vault': {
        const vt = c.vault;
        this._oneShot('vault', VAULT_WIN, (VAULT_WIN[1] - VAULT_WIN[0]) / Math.max(0.12, vt.dur), dt);
        _v.subVectors(vt.to, vt.from).setY(0);
        if (_v.lengthSq() > 0.01) fwd.copy(_v.normalize());
        this.fade = 20;
        break;
      }
      case 'jump':
        this._oneShot('jump', JUMP_WIN, 1.25, dt);
        this._rate = 8;
        this.fade = 18;
        break;
      case 'air':
      case 'flip':
      case 'spin': {
        fallK = smooth(14, 26, -v.y) * smooth(0.6, 1.2, c.airTime);
        const tuck = this.mode === 'flip' ? 1 : this.mode === 'spin' ? 0 : Math.max(this.flightK, smooth(2, 9, -v.y));
        const spread = this.mode === 'spin' ? 1 : fallK;
        const rest = 1 - spread;
        this._set('skydive', spread);
        this._set('fall', rest * tuck);
        this._set('air', rest * (1 - tuck));
        this._rate = 6;
        this.fade = this.mode === 'air' ? 5 : 14;
        break;
      }
      case 'dive':
        this._set('dive', 1);
        if (v.lengthSq() > 9) up.copy(v).normalize();
        fwd.set(0, -1, 0);
        if (Math.abs(up.y) > 0.97) fwd.set(-Math.sin(p.heading), 0, -Math.cos(p.heading));
        this._rate = 5;
        this.fade = 6;
        break;
      case 'swing':
        this._swing(dt, p, c, up, fwd);
        break;
      case 'zip': {
        this._set('zip', 1, undefined, 1.3);
        const dir = c.zip.dir;
        if (dir.y > -0.6) up.copy(Y).addScaledVector(dir, 1.3).normalize();
        fwd.copy(dir);
        if (Math.abs(fwd.dot(up)) > 0.95) fwd.set(-Math.sin(p.heading), 0, -Math.cos(p.heading));
        this._rate = 12;
        this.fade = 14;
        break;
      }
      case 'wall':
        this._wall(dt, p, c, up, fwd);
        break;
      default:
        this._set('idle', 1);
    }
    this.lean += (lean - this.lean) * damp(6, dt);
    if (Math.abs(this.lean) > 1e-3 && (this.mode === 'loco' || this.mode === 'skid')) {
      // Bank into the turn: the head goes to the inside.
      _r.crossVectors(fwd, Y).normalize(); // right
      up.addScaledVector(_r, -Math.tan(this.lean)).normalize();
    }
    this.fallK += (fallK - this.fallK) * damp(3, dt);
  }

  // Play a one-shot through [win[0], win[1]] at `rate` (clamped at the end).
  _oneShot(key, win, rate, dt) {
    const s = this.slots[key];
    if (!s) return this._set('idle', 1);
    s.target += 1;
    s.rate = 0;
    s.time = Math.min(win[1], s.time + dt * rate);
  }

  // Ground gaits: returns the bank angle (rad, + = leaning left).
  _loco(dt, p, c, weight) {
    const speed = p.groundSpeed;
    const move = smooth(0.1, 0.55, speed);
    let ww = 0;
    let wr = 0;
    let wsp = 0;
    if (speed < 1.9) ww = 1;
    else if (speed < 4.6) {
      wr = smooth(1.9, 4.6, speed);
      ww = 1 - wr;
    } else if (speed < 8) wr = 1;
    else if (speed < 11) {
      wsp = smooth(8, 11, speed);
      wr = 1 - wsp;
    } else wsp = 1;
    const stride = ww * STRIDE.walk + wr * STRIDE.run + wsp * STRIDE.sprint;
    const freq = move > 0 ? Math.max(0.3, speed / stride) : 0;
    this.phase = (this.phase + freq * dt) % 1;
    this._gait(weight * move, ww, wr, wsp);
    // Standing still: the hero stance, now and then a look round; turning on the spot steps round.
    const still = weight * (1 - move);
    this.idleClock = move > 0.5 ? 0 : this.idleClock + dt;
    if (this.lookT < 0 && this.idleClock > IDLE_LOOK_AFTER) this.lookT = 0;
    let look = 0;
    if (this.lookT >= 0) {
      this.lookT += dt;
      const dur = this.slots.look?.dur || 5;
      if (this.lookT >= dur || move > 0.3) {
        this.lookT = -1;
        this.idleClock = 0;
      } else {
        look = smooth(0, 0.4, this.lookT) * smooth(dur, dur - 0.4, this.lookT);
        this._set('look', 0, this.lookT, 0);
      }
    }
    const turn = smooth(2.2, 4.5, Math.abs(p.turnRate)) * (1 - smooth(0.6, 1.8, speed));
    const idle = still * (1 - turn);
    this._set('idle', idle * (1 - look));
    this._set('look', idle * look);
    if (turn > 0) {
      const key = p.turnRate > 0 ? 'turnL' : 'turnR';
      const s = this.slots[key];
      if (s) {
        s.rate = 1.4;
        this._set(key, still * turn);
      }
    }
    for (const key of STILL_KEYS) {
      const s = this.slots[key];
      if (s) s.rate = key === 'idle' ? 1 : 1.4;
    }
    // Bank: the lean a runner needs for this turn (v x omega against g), kept modest.
    return clamp(p.turnRate * speed * 0.011, -0.26, 0.26) * smooth(2.5, 5, speed);
  }

  // The gait clips at the shared phase with weights (walk, run, sprint) x w.
  _gait(w, ww, wr, wsp) {
    const ph = this.phase;
    const s = this.slots;
    if (s.walk) this._set('walk', w * ww, ph * s.walk.dur, 0);
    if (s.run) this._set('run', w * wr, ph * s.run.dur, 0);
    if (s.sprint) this._set('sprint', w * wsp, ph * s.sprint.dur, 0);
  }

  _swing(dt, p, c, up, fwd) {
    const sw = c.swing;
    const v = p.velocity;
    const key = sw.side >= 0 ? 'swingR' : 'swingL';
    // Hang along the rope from the pivot (the web hand is IK'd onto the line).
    const center = _w.copy(p.position);
    center.y += PIVOT_Y;
    up.subVectors(sw.anchor, center);
    const len = up.length();
    if (len > 0.1) up.divideScalar(len);
    else up.copy(Y);
    fwd.copy(v).addScaledVector(up, -v.dot(up));
    if (fwd.lengthSq() < 0.25) fwd.set(-Math.sin(p.heading), 0, -Math.cos(p.heading));
    fwd.normalize();
    // Where on the arc: behind the anchor (legs back) -> the bottom (tuck) -> ahead (legs forward).
    let tc = 0.32;
    if (sw.taut >= 0 && len > 0.5) {
      const hs = Math.hypot(v.x, v.z);
      const hx = hs > 1 ? v.x / hs : fwd.x;
      const hz = hs > 1 ? v.z / hs : fwd.z;
      const theta = Math.atan2(-(up.x * hx + up.z * hz), up.y); // (up points at the anchor)
      tc = clamp(0.56 + (theta / 1.1) * 0.44, 0.04, 0.98);
    }
    this.swingT += (tc - this.swingT) * damp(7, dt);
    this._set(key, 1, this.swingT, 0);
    this.trail = clamp((v.length() - 8) / 22, 0, 1);
    this._rate = 10;
    this.fade = 9;
  }

  _wall(dt, p, c, up, fwd) {
    const n = c.wall.normal;
    const v = p.velocity;
    const ws = v.length();
    this.wallRun = this.wallRun ? ws > WALL_RUN_BELOW && v.y > -3 : ws > WALL_RUN_ABOVE && v.y > -2;
    if (c.vault.active) this.wallRun = false;
    if (this.wallRun) {
      // The wall is the floor: the gait blend, body out from the wall, leaning up the run.
      let wr = 0;
      let wsp = 0;
      if (ws < 8) wr = 1;
      else if (ws < 11) {
        wsp = smooth(8, 11, ws);
        wr = 1 - wsp;
      } else wsp = 1;
      const stride = wr * STRIDE.run + wsp * STRIDE.sprint;
      this.phase = (this.phase + (ws / stride) * dt) % 1;
      this._gait(1, 0, wr, wsp);
      fwd.copy(v).multiplyScalar(1 / Math.max(ws, 1e-3));
      up.copy(n).multiplyScalar(Math.cos(WALL_RUN_TILT)).addScaledVector(Y, Math.sin(WALL_RUN_TILT)).normalize();
      // Feet on the facade (the capsule's centre is radius + 5 cm out from it).
      this._offset.copy(n).multiplyScalar(PIVOT_Y * up.dot(n) - (p.radius + 0.05) + 0.04);
      this._rate = 10;
    } else {
      // Crawl: facing the wall, head turned towards where it goes, hands and feet on it.
      const s = this.slots.climb;
      const dir = v.y < -0.5 ? -1 : 1;
      const rate = ws < 0.15 ? 0 : dir * clamp(ws / CLIMB_SPEED, 0.5, 4.5);
      if (s) {
        s.rate = rate;
        this._set('climb', 1);
      }
      fwd.copy(n).negate();
      if (ws > 0.5 && v.y > -0.5) up.addScaledVector(_v.copy(v).divideScalar(ws), 0.9 * smooth(0.5, 2, ws));
      up.addScaledVector(n, -up.dot(n)).normalize();
      this._offset.copy(n).multiplyScalar(CLIMB_GAP - (p.radius + 0.05));
      this._rate = 9;
    }
    this.fade = 9;
  }

  // ------------------------------------------------------------------ mixing

  _mix(k, dt) {
    let total = 0;
    for (const s of this.list) {
      s.w += (s.target - s.w) * k;
      if (s.w < 1e-3 && s.target === 0) s.w = 0;
      total += s.w;
      // Free-running clips advance by their own rate (gait / swing / one-shot slots set time and
      // rate 0 themselves).
      if (s.rate !== 0 && s.w > 0) {
        s.time += dt * s.rate;
        if (s.once) s.time = Math.min(s.time, s.dur - 1e-3);
        else s.time = ((s.time % s.dur) + s.dur) % s.dur;
      }
    }
    if (total < 1e-4) {
      const idle = this.slots.idle;
      idle.w = total = 1;
    }
    // Put back what the procedural layers changed, so the mixer (which writes only changed values)
    // starts from its own output.
    for (let i = 0; i < this.overlay.length; i++) this.overlay[i].quaternion.copy(this.saved[i]);
    for (const s of this.list) {
      const a = s.action;
      const w = s.w / total;
      if (w > 1e-4) {
        a.enabled = true;
        a.weight = w;
        a.time = Math.min(s.time, s.dur - 1e-4);
      } else if (a.enabled) {
        a.enabled = false;
        a.weight = 0;
      }
    }
    this.mixer.update(0);
    for (let i = 0; i < this.overlay.length; i++) this.saved[i].copy(this.overlay[i].quaternion);
  }

  // ------------------------------------------------------------------ body

  _placeBody(dt, p, c, snap) {
    const obj = this.object;
    basis(this._up, this._fwd, _q);
    if (this.fallK > 0.001) {
      // Belly-down skydive: head along the heading, chest to the ground.
      basis(_u.set(-Math.sin(p.heading), 0, -Math.cos(p.heading)), _f.set(0, -1, 0), _q2);
      _q.slerp(_q2, this.fallK);
    }
    const k = snap ? 1 : damp(this._rate, dt);
    this.body.slerp(_q, k);
    this.offset.lerp(this._offset, snap ? 1 : damp(10, dt));
    obj.position.copy(p.position);
    obj.position.y += PIVOT_Y;
    obj.position.add(this.offset);
    obj.quaternion.copy(this.body);
    // Tricks spin the whole body on top of its orientation.
    if ((this.mode === 'flip' || this.mode === 'spin') && c.trick) {
      const t = clamp(c.trickT / c.trickDur, 0, 1);
      const e = t * t * (3 - 2 * t);
      if (c.trick === 'flip') _spin.setFromAxisAngle(X, -TAU * e);
      else _spin.setFromAxisAngle(c.trick === 'twirl' ? Y : Z, TAU * e);
      obj.quaternion.multiply(_spin);
    }
    this.model.root.position.y = -PIVOT_Y + this.model.groundOffset;
  }

  // Web hands: IK onto each line that is out (flying or holding), towards its anchor.
  _arms(dt, p, snap) {
    const arms = this.arms;
    arms.L.want = 0;
    arms.R.want = 0;
    arms.L.shooting = 0;
    arms.R.shooting = 0;
    const lines = p.webs?.lines;
    if (lines) {
      for (const l of lines) {
        if (l.state !== 'shoot' && l.state !== 'taut') continue;
        const arm = arms[l.side];
        if (!arm) continue;
        arm.want = 1;
        arm.target.copy(l.to);
        if (l.state === 'shoot') arm.shooting = 1;
      }
    }
    for (const side of SIDES) {
      const arm = arms[side];
      arm.w += (arm.want - arm.w) * (snap ? 1 : damp(arm.want > arm.w ? 28 : 7, dt));
      if (arm.w < 0.01) continue;
      arm.upper.getWorldPosition(_shoulder);
      _target.subVectors(arm.target, _shoulder);
      const d = _target.length();
      if (d < 0.05) continue;
      _target.multiplyScalar((arm.length * 0.97) / d).add(_shoulder);
      solveTwoBone(arm.upper, arm.lower, arm.hand, _target, arm.w, 0.99);
      if (arm.shooting > 0) {
        for (const f of arm.fingers) f.bone.quaternion.slerp(f.thwip, arm.w);
        arm.hand.updateMatrixWorld(true);
      }
    }
  }

  // Swinging fast, the legs trail behind the arc.
  _legs(dt, p) {
    const k = this.mode === 'swing' ? this.trail : 0;
    this._trailK += (k - this._trailK) * damp(4, dt);
    const a = -0.38 * this._trailK;
    if (Math.abs(a) < 1e-3) return;
    _r.set(1, 0, 0).applyQuaternion(this.object.quaternion); // body right
    for (const b of this.thighs) {
      b.getWorldQuaternion(_q);
      _v.copy(_r).applyQuaternion(_q2.copy(_q).invert());
      b.quaternion.multiply(_spin.setFromAxisAngle(_v, a));
      b.updateMatrixWorld(true);
    }
  }

  // Palm centres (web attachment points) in world space.
  palms(L, R) {
    this._palm(this.arms.L, L);
    this._palm(this.arms.R, R);
  }

  _palm(arm, out) {
    arm.hand.getWorldPosition(out);
    arm.middle.getWorldPosition(_v);
    out.lerp(_v, 0.55);
  }
}
