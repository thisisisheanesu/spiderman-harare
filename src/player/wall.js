import * as THREE from 'three';
import { probeLedge } from './anchors.js';

// Wall crawling and running: W runs up (sprinting after a second), A/D run sideways relative to the
// camera, S slides down. Wraps around outer corners, turns into inner corners, vaults onto the roof
// at the top and drops back to the street at the bottom. Jump kicks off (towards the camera's view).

const UP_SPEED = 9;
const UP_SPRINT = 12;
const SIDE_SPEED = 7.5;
const DOWN_SPEED = 9;
const GRIP = 10;
const TOP_REACH = 2.1;
const SNAP = 0.2; // max facade-hugging correction per step (m)

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _side = new THREE.Vector3();
const _want = new THREE.Vector3();
const _ledge = new THREE.Vector3();

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class WallMove {
  constructor(ctrl) {
    this.c = ctrl;
    this.normal = new THREE.Vector3(0, 0, 1);
    this.lastNormal = new THREE.Vector3();
    this.cooldown = 0;
    this.climbTime = 0;
  }

  // Would touching a wall with this normal (at this impact speed) make us grab it?
  wantsToGrab(n, impact) {
    const c = this.c;
    if (this.cooldown > 0 && n.dot(this.lastNormal) > 0.8) return false;
    return impact > 1.5 || c.wish.dot(n) < -0.3;
  }

  // Stick to the wall facing normal n, if there is one to hold at chest height.
  enter(n) {
    const c = this.c;
    const p = c.p;
    const v = p.velocity;
    const wn = _a.set(n.x, 0, n.z);
    if (wn.lengthSq() < 1e-4) return;
    wn.normalize().negate();
    const hit = c.world.raycast(c.center, wn, p.radius + 1.0);
    if (!hit || Math.abs(hit.normal.y) > 0.5) return;
    this.normal.set(hit.normal.x, 0, hit.normal.z).normalize();
    p.position.addScaledVector(this.normal, p.radius + 0.05 - hit.distance);
    v.addScaledVector(this.normal, -v.dot(this.normal));
    v.y = Math.min(Math.max(v.y, -6), 14);
    const was = p.state;
    p.state = 'wall';
    this.climbTime = 0;
    c.clearActions();
    if (was !== 'wall') c.emit('player:wallStart', { pos: p.position.clone(), normal: this.normal.clone() });
  }

  // Sideways direction on the wall that matches the camera's right.
  _sideDir(out) {
    const c = this.c;
    const n = this.normal;
    out.copy(c.camRight).addScaledVector(n, -c.camRight.dot(n));
    if (out.lengthSq() < 0.1) out.crossVectors(UP, n);
    return out.normalize();
  }

  step(h) {
    const c = this.c;
    const p = c.p;
    const v = p.velocity;
    const n = this.normal;
    const side = this._sideDir(_side);
    const my = c.move.y;
    if (my > 0.1) this.climbTime += h;
    else this.climbTime = 0;
    const up = my > 0 ? UP_SPEED + (UP_SPRINT - UP_SPEED) * smooth(0.8, 1.6, this.climbTime) : DOWN_SPEED;
    _want.copy(UP).multiplyScalar(my * up).addScaledVector(side, c.move.x * SIDE_SPEED);
    const k = 1 - Math.exp(-GRIP * h);
    v.x += (_want.x - v.x) * k;
    v.y += (_want.y - v.y) * k;
    v.z += (_want.z - v.z) * k;
    v.addScaledVector(n, -v.dot(n));
    p.position.addScaledVector(v, h);

    // Top of the wall within reach while climbing: vault onto the roof.
    if (v.y > 0.5) {
      const ledge = probeLedge(c.world, p.position, n, p.radius, TOP_REACH, _ledge);
      if (ledge) {
        _a.copy(n).multiplyScalar(my > 0.5 ? -6 : 0);
        c.startVault(_b.copy(ledge).addScaledVector(n, -0.3), 0.32, 'ground', _a);
        return;
      }
    }

    const hit = c.world.raycast(c.center, _a.copy(n).negate(), p.radius + 0.9);
    if (!hit || Math.abs(hit.normal.y) > 0.5) {
      if (!this._wrapCorner(v.dot(side), side)) this.leave(0.4);
      return;
    }
    n.set(hit.normal.x, 0, hit.normal.z).normalize();
    // Hug the facade, easing over setbacks instead of snapping.
    p.position.addScaledVector(n, Math.max(-SNAP, Math.min(SNAP, p.radius + 0.05 - hit.distance)));

    const res = c.collide();
    if (res.ground && v.y <= 0.1) {
      p.state = 'ground';
      return;
    }
    // Ran into an inner corner: carry on up the new face.
    if (res.wall && res.wallNormal.dot(n) < 0.5 && c.wallImpact > 0.5) this.enter(res.wallNormal);
  }

  // Ran past an outer corner: find the adjacent face and continue on it.
  _wrapCorner(lateral, side) {
    const c = this.c;
    const p = c.p;
    if (Math.abs(lateral) < 0.8) return false;
    const n = this.normal;
    const dir = _b.copy(side).multiplyScalar(-Math.sign(lateral));
    const o = _c.copy(c.center).addScaledVector(n, -(p.radius + 0.5));
    const hit = c.world.raycast(o, dir, 2.5);
    if (!hit || Math.abs(hit.normal.y) > 0.5 || hit.normal.dot(n) > 0.5) return false;
    const nn = _a.set(hit.normal.x, 0, hit.normal.z).normalize();
    p.position.copy(hit.point).addScaledVector(nn, p.radius + 0.05);
    p.position.y -= c.centerHeight;
    const v = p.velocity;
    const vy = v.y;
    v.copy(n).multiplyScalar(-Math.abs(lateral));
    v.y = vy;
    n.copy(nn);
    return true;
  }

  leave(push) {
    const c = this.c;
    c.p.velocity.addScaledVector(this.normal, push);
    this.lastNormal.copy(this.normal);
    this.cooldown = 0.25;
    c.p.state = 'air';
  }

  // Swing held on a tall wall: spring off it sideways (the way the view leans along the wall) and
  // up, so the next web carries on instead of climbing the whole tower.
  launchOff() {
    const c = this.c;
    const n = this.normal;
    const t = _a.copy(c.camFwd).addScaledVector(n, -c.camFwd.dot(n)).setY(0);
    if (t.lengthSq() < 0.04) t.crossVectors(UP, n);
    t.normalize();
    this.lastNormal.copy(n);
    this.cooldown = 0.35;
    c.launch(n.x * 10 + t.x * 10, 11, n.z * 10 + t.z * 10);
  }

  // Kick off the wall: away from it, or towards where the camera looks if that is away from it.
  jump() {
    const c = this.c;
    const n = this.normal;
    const away = _a.copy(n);
    if (c.camFwd.dot(n) > 0.2) away.addScaledVector(c.camFwd, 1.2).normalize();
    this.lastNormal.copy(n);
    this.cooldown = 0.35;
    c.launch(away.x * 10, 10.5, away.z * 10);
  }
}
