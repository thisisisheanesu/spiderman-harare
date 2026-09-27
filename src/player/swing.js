import * as THREE from 'three';
import { findSwingAnchor, groundBelow } from './anchors.js';

// Web swinging: a rope pendulum with reel-in, pumping and steering.
// The web visibly sticks to a roof edge (anchor), but the physics pivot sits at the same height pulled
// most of the way over the line of travel, so swings arc down the street instead of slamming into the
// building the web is attached to.

const SWING_G = 34;
const PUMP = 8;
const STEER = 7;
const MAX_SPEED = 45;
const REEL = 14;
const MAX_REEL = 30;
const CLEARANCE = 3.8; // lowest the body centre gets above the street/roof below the pivot (clears kombis)
const PLANAR = 0.85; // how far the pivot moves from the anchor towards the line of travel
const TURN_RATE = 1.4; // rad/s the swing bends towards the stick / camera direction
const HAND_UP = 1.1;
const TRICKS = ['flip', 'twirl', 'corkscrew'];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hand = new THREE.Vector3();

export class SwingMove {
  constructor(ctrl) {
    this.c = ctrl;
    this.anchor = new THREE.Vector3();
    this.pivot = new THREE.Vector3();
    this.ropeLen = 0;
    this.ropeTarget = 0;
    this.delay = 0;
    this.side = 1;
    this.time = 0;
    this.retry = 0;
    this.line = null;
    this.hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), side: 1, buildingId: -1 };
    this.query = { speed: 0, fall: 0, side: 1 };
  }

  // Where the player wants to go: input (camera-relative) blended with the current motion.
  _direction(out) {
    const c = this.c;
    const v = c.p.velocity;
    const hs = Math.hypot(v.x, v.z);
    out.copy(c.wish.lengthSq() > 0.04 ? c.wish : c.camFwd).setY(0).normalize();
    if (hs > 4) out.multiplyScalar(0.55).addScaledVector(_a.set(v.x / hs, 0, v.z / hs), 0.45).normalize();
    return out;
  }

  // Swing button pressed (fresh) or still held (retrying while no anchor was in reach).
  tryStart(fresh) {
    const c = this.c;
    const p = c.p;
    const st = p.state;
    if (st === 'ground' || st === 'perch' || st === 'wall') {
      if (!fresh) return;
      // Leap first; the web goes out near the top of the jump.
      if (st === 'wall') c.wall.jump();
      else if (st === 'perch') c.launch(c.perchOut.x * 6, 10, c.perchOut.z * 6);
      else c.launch(p.velocity.x, 13, p.velocity.z);
      this.retry = 0.2;
      return;
    }
    const dir = this._direction(_dir);
    const hand = _hand.copy(c.center);
    hand.y += HAND_UP;
    this.query.speed = p.velocity.length();
    this.query.fall = -p.velocity.y;
    this.query.side = -this.side;
    const hit = findSwingAnchor(c.world, hand, dir, this.query, this.hit);
    if (!hit || !this._start(hit, hand, dir)) this.retry = 0.12;
  }

  _start(hit, hand, dir) {
    const c = this.c;
    const p = c.p;
    const center = c.center;
    // Physics pivot: the anchor slid towards the line of travel.
    const rx = -dir.z;
    const rz = dir.x;
    const lat = (hit.point.x - center.x) * rx + (hit.point.z - center.z) * rz;
    this.pivot.copy(hit.point);
    this.pivot.x -= rx * lat * PLANAR;
    this.pivot.z -= rz * lat * PLANAR;
    const L0 = center.distanceTo(this.pivot);
    const floor = groundBelow(c.world, (center.x + this.pivot.x) / 2, this.pivot.y - 0.5, (center.z + this.pivot.z) / 2);
    const target = Math.min(L0, this.pivot.y - floor - CLEARANCE);
    if (target < 4) return false;
    if (p.state === 'dive') c.game.cameraRig?.fovKick?.(-3);
    this.anchor.copy(hit.point);
    this.ropeLen = L0;
    this.ropeTarget = target;
    this.delay = Math.max(0.05, hand.distanceTo(hit.point) / 520);
    this.side = hit.side;
    this.time = 0;
    p.state = 'swing';
    c.clearActions();
    const handKey = hit.side > 0 ? 'R' : 'L';
    this.line = p.webs.shoot(handKey, p.hands[handKey], hit.point, hit.normal);
    c.emit('player:webShot', { from: hand.clone(), to: hit.point.clone() });
    c.emit('player:swingStart', { anchor: hit.point.clone() });
    return true;
  }

  step(h) {
    const c = this.c;
    const p = c.p;
    const v = p.velocity;
    this.time += h;
    v.y -= SWING_G * h;
    if (this.delay > 0) {
      this.delay -= h;
    } else {
      const rope = _a.subVectors(this.pivot, c.center).normalize();
      // Forward input pumps along the arc; sideways input steers.
      const vt = _b.copy(v).addScaledVector(rope, -v.dot(rope));
      const vtl = vt.length();
      if (vtl > 0.5) v.addScaledVector(vt, (Math.max(0, c.wish.dot(vt) / vtl) * PUMP * h) / vtl);
      v.addScaledVector(_c.copy(c.wish).addScaledVector(rope, -c.wish.dot(rope)), STEER * h);
      c.steerTowardsWish(h, TURN_RATE);
    }
    // Reeling in (rope longer than the arc allows): the web yanks you up towards the pivot.
    const excess = this.ropeLen - this.ropeTarget;
    const reel = this.delay <= 0 && excess > 0 ? Math.min(MAX_REEL, Math.max(REEL, excess * 6)) : 0;
    this.ropeLen -= Math.min(Math.max(excess, 0), reel * h);
    p.position.addScaledVector(v, h);
    if (this.delay <= 0) {
      const d = _a.subVectors(c.center, this.pivot);
      const len = d.length();
      if (len > this.ropeLen) {
        d.divideScalar(len);
        p.position.addScaledVector(d, this.ropeLen - len);
        const vr = v.dot(d);
        if (vr > -reel) v.addScaledVector(d, -reel - vr);
      }
      if (this.line) this.line.slack = Math.max(0, this.ropeLen - len);
    }
    const sp = v.length();
    if (sp > MAX_SPEED) v.multiplyScalar(MAX_SPEED / sp);

    const res = c.collide();
    if (res.ground && c.impactVy >= -0.5) {
      this.release(false, true);
      c.land(Math.max(0, c.impactVy));
      return;
    }
    if (res.wall && c.wallImpact > 2) {
      this.release(false, true);
      c.obstacle(res.wallNormal, c.wallImpact);
      return;
    }
    // Past the top of the arc (or dangling): let go automatically.
    if (c.center.y > this.pivot.y - 1 || (this.time > 5 && sp < 4)) this.release(false);
  }

  // Let go. A release on the rising part of the arc flings you on; boost = jump pressed mid-swing.
  release(boost, quiet = false) {
    const c = this.c;
    const p = c.p;
    const v = p.velocity;
    p.state = 'air';
    if (!quiet) {
      const hs = Math.hypot(v.x, v.z);
      const sp = v.length();
      if (boost) {
        if (hs > 0.5) v.addScaledVector(_a.set(v.x / hs, 0, v.z / hs), 3);
        v.y = Math.max(v.y, 2) + 9;
        c.startTrick('flip');
        c.jumpHeld = true;
        c.emit('player:jump', { pos: p.position.clone() });
      } else if (v.y > 0 && sp > 14) {
        v.multiplyScalar(1.05);
        v.y += 2 + 0.12 * sp;
        if (sp > 24 && Math.random() < 0.55) c.startTrick(TRICKS[Math.floor(Math.random() * TRICKS.length)]);
      }
    }
    this.retry = 0.18;
    this.dropLine();
    c.emit('player:swingEnd', { pos: p.position.clone(), vel: v.clone() });
  }

  dropLine() {
    this.c.p.webs.release(this.line);
    this.line = null;
  }
}
