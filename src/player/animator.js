import * as THREE from 'three';
import { PIVOT_Y } from './model.js';
import {
  POSE_SIZE,
  poseIdle,
  poseRun,
  poseWalk,
  poseJump,
  poseFall,
  poseSkydive,
  poseDive,
  poseSwing,
  poseTuck,
  poseSpread,
  poseZip,
  posePerch,
  poseLandHard,
  poseVault,
  poseWall,
  poseWallRun,
} from './poses.js';

// Drives the skeleton from the controller: picks a procedural target pose for the current state,
// blends towards it (per-state rates, so landings snap and swings flow), and orients the whole body
// (upright, along the web, head-first along a dive, spinning through flips and rolls).

const HP = POSE_SIZE - 3;
const TAU = Math.PI * 2;
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _spin = new THREE.Quaternion();

function lerpPose(a, b, t) {
  for (let i = 0; i < POSE_SIZE; i++) a[i] += (b[i] - a[i]) * t;
}

// Quaternion for a body whose head points along `up` and chest faces `fwd` (model faces -Z).
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

export class Animator {
  constructor(rig, object) {
    this.bones = rig.bones;
    this.rest = rig.rest;
    this.object = object;
    this.cur = new Float32Array(POSE_SIZE);
    this.tgt = new Float32Array(POSE_SIZE);
    this.tmp = new Float32Array(POSE_SIZE);
    this.tmp2 = new Float32Array(POSE_SIZE);
    // Inputs for the pose functions (see poses.js).
    this.c = {
      time: 0,
      speed: 0,
      vy: 0,
      runPhase: 0,
      run01: 0,
      rising: 0,
      webSide: 1,
      zipT: 0,
      wallPhase: 0,
      wallMove: 0,
      wallLook: 0,
      actionT: 0,
    };
    this.body = new THREE.Quaternion();
    this.fallK = 0;
    poseIdle(this.cur, this.c);
  }

  update(dt, player, ctrl) {
    const rate = this._pose(dt, player, ctrl);
    const k = 1 - Math.exp(-rate * dt);
    lerpPose(this.cur, this.tgt, k);
    const cur = this.cur;
    const bones = this.bones;
    for (let i = 0; i < bones.length; i++) bones[i].rotation.set(cur[i * 3], cur[i * 3 + 1], cur[i * 3 + 2]);
    bones[0].position.set(this.rest[0].x + cur[HP], this.rest[0].y + cur[HP + 1], this.rest[0].z + cur[HP + 2]);
    this._orient(dt, player, ctrl);
  }

  // Writes the target pose; returns the blend rate (1/s).
  _pose(dt, player, ctrl) {
    const c = this.c;
    const v = player.velocity;
    const hs = Math.hypot(v.x, v.z);
    const tgt = this.tgt;
    const tmp = this.tmp;
    c.time += dt;
    c.speed = v.length();
    c.vy = v.y;
    this.fallK = 0;
    if (ctrl.vault.active) {
      poseVault(tgt, c);
      return 18;
    }
    switch (player.state) {
      case 'ground': {
        if (ctrl.landMode === 'hard') {
          c.actionT = ctrl.landT / ctrl.landDur;
          poseLandHard(tgt, c);
          return ctrl.landT < 0.12 ? 40 : 12;
        }
        if (ctrl.landMode === 'roll') {
          poseTuck(tgt, c);
          return 26;
        }
        // Walk below ~2.5 m/s, jog / run above, parkour sprint at the top (controller gaits).
        c.run01 = smooth(9, 13.5, hs);
        const walkK = 1 - smooth(2.2, 3.4, hs);
        const freq = walkK * Math.max(0.7, hs / 1.45) + (1 - walkK) * (0.9 + 0.16 * hs);
        c.runPhase = (c.runPhase + dt * TAU * freq) % TAU;
        poseIdle(tgt, c);
        const w = smooth(0.2, 1.0, hs);
        if (w > 0) {
          poseRun(tmp, c);
          if (walkK > 0) {
            poseWalk(this.tmp2, c);
            lerpPose(tmp, this.tmp2, walkK);
          }
          lerpPose(tgt, tmp, w);
        }
        if (ctrl.landMode === 'soft') {
          posePerch(tmp, c);
          lerpPose(tgt, tmp, 0.5 * (1 - ctrl.landT / ctrl.landDur));
          return 22;
        }
        return 12;
      }
      case 'perch':
        posePerch(tgt, c);
        return 8;
      case 'air': {
        if (ctrl.trick) {
          if (ctrl.trick === 'flip') poseTuck(tgt, c);
          else poseSpread(tgt, c);
          return 16;
        }
        if (v.y > 0.5 && ctrl.airTime < 1) {
          poseJump(tgt, c);
          return 10;
        }
        this.fallK = smooth(14, 26, -v.y) * smooth(0.6, 1.2, ctrl.airTime);
        poseFall(tgt, c);
        if (this.fallK > 0) {
          poseSkydive(tmp, c);
          lerpPose(tgt, tmp, this.fallK);
        }
        return 5;
      }
      case 'dive':
        poseDive(tgt, c);
        return 6;
      case 'swing':
        c.webSide = ctrl.swing.side;
        c.rising = v.y / Math.max(6, c.speed);
        poseSwing(tgt, c);
        return 9;
      case 'zip':
        c.zipT = ctrl.zip.progress;
        poseZip(tgt, c);
        return 14;
      case 'wall': {
        const n = ctrl.wall.normal;
        c.wallMove = smooth(0.3, 2.5, c.speed);
        c.wallPhase = (c.wallPhase + dt * TAU * (0.5 + 0.2 * c.speed)) % TAU;
        c.wallLook = clamp((v.x * -n.z + v.z * n.x) / 8, -1, 1);
        if (v.y > 7) poseWallRun(tgt, c);
        else poseWall(tgt, c);
        return 12;
      }
      default:
        poseIdle(tgt, c);
        return 10;
    }
  }

  _orient(dt, player, ctrl) {
    const obj = this.object;
    const v = player.velocity;
    const up = _up.copy(Y);
    const fwd = _fwd.set(-Math.sin(player.heading), 0, -Math.cos(player.heading));
    let rate = 14;
    obj.position.copy(player.position);
    obj.position.y += PIVOT_Y;
    switch (player.state) {
      case 'swing':
        // Hang from the rope's physics pivot (the web can meet a low anchor at a flatter angle).
        up.subVectors(ctrl.swing.pivot, obj.position).normalize();
        fwd.copy(v).addScaledVector(up, -v.dot(up));
        if (fwd.lengthSq() < 0.25) fwd.set(-Math.sin(player.heading), 0, -Math.cos(player.heading));
        fwd.normalize();
        rate = 10;
        break;
      case 'dive':
        if (v.lengthSq() > 9) up.copy(v).normalize();
        fwd.set(0, -1, 0);
        if (Math.abs(up.y) > 0.97) fwd.set(-Math.sin(player.heading), 0, -Math.cos(player.heading));
        rate = 5;
        break;
      case 'zip':
        up.copy(ctrl.zip.dir);
        fwd.set(0, -1, 0);
        if (Math.abs(up.y) > 0.97) fwd.set(-Math.sin(player.heading), 0, -Math.cos(player.heading));
        rate = 12;
        break;
      case 'air':
        rate = 6;
        break;
      case 'wall': {
        // Lean into the wall, more so when sprinting up it.
        const n = ctrl.wall.normal;
        const run = v.y > 7;
        up.addScaledVector(n, run ? -0.3 : -0.12).normalize();
        fwd.copy(n).negate();
        if (run) obj.position.addScaledVector(n, 0.12);
        break;
      }
      case 'perch':
        rate = 9;
        break;
      default:
    }
    basis(up, fwd, _q);
    if (this.fallK > 0) {
      // Belly-down skydive: head points along the heading, chest faces the ground.
      basis(_fwd.set(-Math.sin(player.heading), 0, -Math.cos(player.heading)), _up.set(0, -1, 0), _q2);
      _q.slerp(_q2, this.fallK);
    }
    this.body.slerp(_q, 1 - Math.exp(-rate * dt));
    obj.quaternion.copy(this.body);

    // Tricks and rolls spin the body on top of its orientation.
    let spin = 0;
    let axis = X;
    if (ctrl.trick && player.state === 'air') {
      const t = clamp(ctrl.trickT / ctrl.trickDur, 0, 1);
      const e = t * t * (3 - 2 * t);
      if (ctrl.trick === 'flip') spin = -TAU * e;
      else {
        spin = TAU * e;
        axis = ctrl.trick === 'twirl' ? Y : Z;
      }
    } else if (player.state === 'ground' && ctrl.landMode === 'roll') {
      const t = clamp(ctrl.landT / ctrl.landDur, 0, 1);
      spin = -TAU * (1 - (1 - t) ** 2);
      obj.position.y -= 0.42 * Math.sin(Math.PI * t);
    }
    if (spin) obj.quaternion.multiply(_spin.setFromAxisAngle(axis, spin));
  }
}
