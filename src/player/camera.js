import * as THREE from 'three';

// Cinematic third-person camera.
// Public API (game.cameraRig):
//   yaw, pitch   radians. yaw uses the player heading convention: the camera looks along
//                (-sin yaw, 0, -cos yaw), so yaw 0 looks north. pitch < 0 looks down.
//   shake(amount)   add trauma (0..1); decays quickly
//   fovKick(amount) add degrees of FOV that ease back out (dives, zips, boosted releases)
//   preset          0 = close, 1 = far (V toggles)
//   snap()          jump straight behind the player (used on teleports)
// Orbit with mouse / right stick; while swinging, diving or zipping the rig swings in behind the motion
// unless the player moved the camera in the last 1.5 s, and running on the ground it drifts in behind
// the runner (slowly: a walk leaves it alone). Distance and FOV grow with speed; on the web the boom
// also pulls back and trails the swing a little, so the arc and the anchor stay in frame. The
// camera never clips into buildings (pulled in at once when blocked, eased back out after a short
// hold so a lamp post or corner flicking past doesn't pump it in and out), and it rolls gently into
// swings.

const PRESETS = [
  { dist: 4.4, height: 1.55, side: 0.5 },
  { dist: 7.2, height: 1.9, side: 0.35 },
];
const SENSITIVITY = 0.0023;
const MANUAL_HOLD = 1.5;
const BASE_FOV = 68;
const PITCH_MIN = -1.35;
const PITCH_MAX = 0.95;
// Plunging down a tower face (controller.plunge): a cinematic three-quarter view from outside,
// looking back at the facade and down past the player at the street; when the web catches, the rig
// whips round behind the swing.
const PLUNGE_YAW = Math.PI - 0.55; // from the dive direction
const PLUNGE_PITCH = -0.9;
const PLUNGE_DIST = 3.2; // extra boom length
const WHIP_TIME = 1.4; // s of faster re-alignment after a plunge
// On a wall, the boom's horizontal direction must point at least this much out of the wall (dot
// with its normal); otherwise the rig turns towards facing the wall at this rate.
const WALL_BACK = 0.45;
const WALL_YAW_RATE = 3;
const SWING_PULLBACK = 1.6; // m of extra boom on the web
const LEAD = 0.035; // s of velocity the look target leads by
const RUN_FOLLOW = 0.09; // 1/s of yaw follow per m/s of running speed (ground, above RUN_FOLLOW_MIN)
const RUN_FOLLOW_MIN = 3;
const COL_HOLD = 0.35; // s a pulled-in boom waits before easing back out
const SOFT_IDS = new Set([-5, -6, -8, -9, -10]); // world collider ids of street furniture (city.js)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
function dampAngle(a, b, rate, dt) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-rate * dt));
}

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _want = new THREE.Vector3();
const _v = new THREE.Vector3();
const _look = new THREE.Vector3();

export class CameraRig {
  constructor() {
    this.yaw = 0;
    this.pitch = -0.18;
    this.preset = 0;
    this.follow = new THREE.Vector3();
    this.distance = PRESETS[0].dist;
    this._col = PRESETS[0].dist;
    this._fov = BASE_FOV;
    this._kick = 0;
    this._trauma = 0;
    this._roll = 0;
    this._time = 0;
    this._lastManual = -10;
    this._lastYaw = 0;
    this._diveK = 0;
    this._plungeK = 0;
    this._whip = 0;
    this._swingK = 0;
    this._colHold = 0;
  }

  async init(game) {
    this.game = game;
    game.events.on('player:land', (e) => {
      if (e.hard) this.shake(0.75);
      else if (e.speed > 10) this.shake(Math.min(0.3, e.speed / 80));
    });
    this.snap();
  }

  // Jump straight behind the player (spawn, teleports).
  snap() {
    const p = this.game?.player;
    if (!p) return;
    this.yaw = p.heading;
    this.pitch = -0.18;
    this.follow.copy(p.position).y += PRESETS[this.preset].height;
    this._lastYaw = this.yaw;
  }

  shake(amount) {
    this._trauma = Math.min(1, this._trauma + amount);
  }

  fovKick(amount) {
    // Bounded so mashing zip / dive can't stack the kicks into a fisheye.
    this._kick = clamp(this._kick + amount, -6, 10);
  }

  update(dt, game) {
    const input = game.input;
    const p = game.player;
    const cam = game.camera;
    this._time += dt;
    if (input.pressed('camera')) this.preset = (this.preset + 1) % PRESETS.length;
    const preset = PRESETS[this.preset];

    if (input.look.x || input.look.y) {
      this.yaw -= input.look.x * SENSITIVITY;
      this.pitch -= input.look.y * SENSITIVITY;
      this._lastManual = this._time;
    }
    this._autoAlign(dt, p);
    this.pitch = clamp(this.pitch, PITCH_MIN, PITCH_MAX);

    const v = p.velocity;
    const speed = v.length();
    const speedK = smoothstep(8, 42, speed);

    // Follow point: tight horizontally, softer vertically so bounces and landings don't jolt.
    // Diving, the rig centres on the body rather than looking over the shoulder.
    this._diveK = damp(this._diveK, p.state === 'dive' ? 1 : 0, 3, dt);
    _v.copy(p.position);
    _v.y += preset.height + (0.9 - preset.height) * this._diveK;
    if (p.state === 'wall') _v.addScaledVector(p.controller.wall.normal, 0.7);
    const catchUp = 14 + speed * (0.3 + 0.3 * this._diveK);
    this.follow.x = damp(this.follow.x, _v.x, catchUp, dt);
    this.follow.z = damp(this.follow.z, _v.z, catchUp, dt);
    this.follow.y = damp(this.follow.y, _v.y, p.state === 'swing' ? 9 : catchUp, dt);
    // Never let the follow point lag more than a few metres (teleports, 50 m/s dives).
    _v.sub(this.follow);
    const lag = _v.length();
    if (lag > 4) this.follow.addScaledVector(_v, (lag - 4) / lag);

    const plunging = p.state === 'dive' && !!p.controller?.plunge;
    this._plungeK = damp(this._plungeK, plunging ? 1 : 0, 2.5, dt);
    this._swingK = damp(this._swingK, p.state === 'swing' || (p.state === 'air' && p.controller?.flight) ? 1 : 0, 1.5, dt);
    let want = preset.dist + speedK * (p.state === 'dive' ? 0.5 : 3.4) + PLUNGE_DIST * this._plungeK + SWING_PULLBACK * this._swingK;
    if (p.state === 'perch') want += 1.0;
    this.distance = damp(this.distance, want, 3, dt);

    this._kick = damp(this._kick, 0, 2.5, dt);
    const fov = damp(this._fov, BASE_FOV + speedK * 12 + (p.state === 'dive' ? 3 : 0), 3, dt);
    this._fov = fov;
    const finalFov = fov + this._kick;
    if (Math.abs(cam.fov - finalFov) > 0.01) {
      cam.fov = finalFov;
      cam.updateProjectionMatrix();
    }

    _dir.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const world = game.world;

    // Over-the-shoulder pivot, kept out of walls.
    _pivot.copy(this.follow).addScaledVector(_right, preset.side * (1 - speedK));
    _v.subVectors(_pivot, p.position).setY(0);
    const off = _v.length();
    if (off > 1e-3) {
      _look.copy(p.position);
      _look.y = _pivot.y;
      _v.divideScalar(off);
      const hit = world.raycast(_look, _v, off + 0.3);
      if (hit) _pivot.copy(_look).addScaledVector(_v, Math.max(0, hit.distance - 0.3));
    }

    // Boom with collision: snap in when blocked, ease back out.
    _want.copy(_dir).negate();
    const hit = world.raycast(_pivot, _want, this.distance + 0.4);
    const allowed = hit ? Math.max(0.6, hit.distance - 0.4) : this.distance;
    if (allowed < this._col - 0.01) {
      // Buildings and terrain: at once (never inside a wall). Street furniture flicking past
      // (shelters, billboards, planters, statue, fountain): quickly but smoothly.
      this._col = hit && SOFT_IDS.has(hit.buildingId) ? damp(this._col, allowed, 16, dt) : allowed;
      this._colHold = COL_HOLD;
    } else if ((this._colHold -= dt) <= 0) {
      this._col = damp(this._col, allowed, 4, dt);
    }
    cam.position.copy(_pivot).addScaledVector(_want, this._col);
    if (cam.position.y < 0.35) cam.position.y = 0.35;

    // Trauma shake (squared for a punchy falloff).
    this._trauma = Math.max(0, this._trauma - dt * 1.4);
    const s = this._trauma * this._trauma;
    if (s > 0) {
      const t = this._time * 31;
      cam.position.addScaledVector(_right, s * 0.32 * (Math.sin(t) + 0.5 * Math.sin(t * 2.3 + 1)));
      cam.position.y += s * 0.32 * (Math.sin(t * 1.7 + 2) + 0.5 * Math.sin(t * 3.1));
    }

    _look.copy(_pivot).addScaledVector(_dir, 3).addScaledVector(v, LEAD * this._swingK);
    cam.lookAt(_look);

    // Roll into the swing (towards the anchor side) and into hard yaw turns.
    let roll = 0;
    if (p.state === 'swing') {
      _v.subVectors(p.controller.swing.anchor, p.position).normalize();
      roll = -_v.dot(_right) * 0.16;
    }
    const yawRate = (this.yaw - this._lastYaw) / Math.max(dt, 1e-3);
    this._lastYaw = this.yaw;
    if (p.state !== 'ground' && p.state !== 'perch') roll += clamp(yawRate * 0.04, -0.08, 0.08);
    roll += s * 0.04 * Math.sin(this._time * 23);
    this._roll = damp(this._roll, roll, 3, dt);
    if (Math.abs(this._roll) > 1e-4) cam.rotateZ(this._roll);
  }

  _autoAlign(dt, p) {
    this._whip = Math.max(0, this._whip - dt);
    const st = p.state;
    const ctrl = p.controller;
    if (this._time - this._lastManual < MANUAL_HOLD) return;
    if (st === 'wall' && ctrl) {
      // Clinging to a wall with the view looking along it or out of it (a swing that ended against
      // a facade at an angle): the boom runs into the wall and jams the camera against the
      // player's back. Turn round until the boom clears the wall.
      const n = ctrl.wall.normal;
      const back = Math.sin(this.yaw) * n.x + Math.cos(this.yaw) * n.z;
      if (back < WALL_BACK) this.yaw = dampAngle(this.yaw, Math.atan2(n.x, n.z), WALL_YAW_RATE, dt);
    }
    const v = p.velocity;
    const hs = Math.hypot(v.x, v.z);
    if (st === 'dive' && ctrl?.plunge) {
      const out = ctrl.perchOut;
      this.yaw = dampAngle(this.yaw, Math.atan2(-out.x, -out.z) + PLUNGE_YAW, 2.6, dt);
      this.pitch = damp(this.pitch, PLUNGE_PITCH, 2.6, dt);
      this._whip = WHIP_TIME;
      return;
    }
    if (st === 'perch') {
      // Settle into a wide look out over the city, like a perch shot.
      this.yaw = dampAngle(this.yaw, p.heading, 0.8, dt);
      this.pitch = damp(this.pitch, -0.12, 0.8, dt);
      return;
    }
    if (st === 'ground' || st === 'wall') {
      // Ease back to a level view after dives and falls (looking up a wall while climbing it).
      this.pitch = damp(this.pitch, st === 'wall' && v.y > 3 ? 0.3 : -0.2, 0.8, dt);
      // Running: drift round behind the runner (faster the faster he goes; walking leaves it be). Only
      // with the stick mostly forward: following a strafe would turn the run into a circle.
      const m = ctrl?.move;
      const fwd = !m || m.y > 0.7 * Math.hypot(m.x, m.y);
      if (st === 'ground' && hs > RUN_FOLLOW_MIN && fwd && !ctrl?.skid) {
        this.yaw = dampAngle(this.yaw, p.heading, RUN_FOLLOW * (hs - RUN_FOLLOW_MIN), dt);
      }
      return;
    }
    if (hs < 3) return;
    const k = clamp(hs / 20, 0.3, 1);
    const yawRate = (st === 'air' ? 1.0 : st === 'dive' ? 2.6 : 1.7) * (1 + 2 * (this._whip / WHIP_TIME));
    this.yaw = dampAngle(this.yaw, Math.atan2(-v.x, -v.z), yawRate * k, dt);
    let pitch = -0.2;
    if (st === 'swing') pitch = -0.2 - 0.12 * clamp(v.length() / 45, 0, 1);
    else if (st === 'dive') pitch = clamp(Math.atan2(v.y, hs) * 0.8, -1.25, -0.35);
    else if (st === 'air') pitch = clamp(Math.atan2(v.y, hs) * 0.4, -0.7, -0.1);
    this.pitch = damp(this.pitch, pitch, st === 'dive' ? 3 : 1.2, dt);
  }
}

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
