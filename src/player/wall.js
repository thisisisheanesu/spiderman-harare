import * as THREE from 'three';
import { probeLedge } from './anchors.js';

// Wall crawling and running: W runs up (sprinting after a second), A/D run sideways relative to the
// camera, S slides down. Wraps around outer corners, turns into inner corners, gets round overhangs
// (onto a shop canopy, over a cornice, out onto an overhanging storey such as Joina City's drum),
// vaults onto the roof at the top and drops back to the street at the bottom. Jump kicks off
// (towards the camera's view).

const UP_SPEED = 9;
const UP_SPRINT = 12;
const SIDE_SPEED = 7.5;
const DOWN_SPEED = 9;
const GRIP = 10;
const TOP_REACH = 2.1;
const SNAP = 0.2; // max facade-hugging correction per step (m)
const CORNICE_REACH = 3.4; // blocked from above: a roof top this far above the feet is still vaulted
const OVERHANG_REACH = 4.2; // deepest overhang (from the body axis) a climb goes round
const OVERHANG_RETRY = 0.3; // s before looking for a way round again after finding none

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
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
    this.overhangWait = 0;
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
    // Climbing into something overhead: find a way round instead of pressing against it for ever.
    this.overhangWait -= h;
    if (res.ceiling && my > 0.3 && this.overhangWait <= 0) {
      if (this._overhang()) return;
      this.overhangWait = OVERHANG_RETRY;
    }
    // Ran into an inner corner: carry on up the new face.
    if (res.wall && res.wallNormal.dot(n) < 0.5 && c.wallImpact > 0.5) this.enter(res.wallNormal);
  }

  // Blocked from above while climbing. A roof edge within CORNICE_REACH (a cornice / cap overhangs
  // the wall): vault over it. Otherwise climb out round the lip of what is overhead: onto the wall
  // above it (a shop canopy) or its own outer face (a storey that bulges out, Joina City's drum) and
  // carry on up, or onto a steep roof rising from it; failing that, stand on top of it. False if
  // there is no way round.
  _overhang() {
    const c = this.c;
    const p = c.p;
    const world = c.world;
    const pos = p.position;
    const n = this.normal;
    const ledge = probeLedge(world, pos, n, p.radius, CORNICE_REACH, _ledge);
    if (ledge) {
      c.startVault(_b.copy(ledge).addScaledVector(n, -0.3), 0.4, 'ground', _a.copy(n).multiplyScalar(-6));
      return true;
    }
    // The underside overhead: above the head, or only above its wall side (a shallow band such as
    // the RBZ frieze catches the head's edge). Then how far out from the wall it reaches (lip,
    // measured from the body axis; negative for a band shallower than the body).
    let under = null;
    let s0 = 0;
    for (let k = 0; k <= 4 && !under; k++) {
      s0 = -0.1 * k;
      _c.set(pos.x + n.x * s0, pos.y + p.height - p.radius, pos.z + n.z * s0);
      under = world.raycast(_c, UP, p.radius + 0.6);
    }
    if (!under || under.normal.y > -0.5) return false;
    const soffit = under.point.y;
    let lip = NaN;
    for (let s = s0 + 0.2; s <= OVERHANG_REACH; s += 0.2) {
      _c.set(pos.x + n.x * s, soffit - 0.3, pos.z + n.z * s);
      if (!world.raycast(_c, UP, 0.6)) {
        lip = s;
        break;
      }
    }
    if (Number.isNaN(lip)) return false;
    // A face to climb on, seen from out past the lip just above the underside (over a canopy's
    // front upstand): the wall above a slab, or the overhang's own front.
    const out = Math.max(lip, 0) + 1.0;
    _c.set(pos.x + n.x * out, soffit + 1.2, pos.z + n.z * out);
    const face = world.raycast(_c, _a.copy(n).negate(), out + 0.8);
    if (face && Math.abs(face.normal.y) < 0.5) {
      n.set(face.normal.x, 0, face.normal.z).normalize();
      _b.copy(face.point).addScaledVector(n, p.radius + 0.05);
      // Feet just above the underside, or on the slab's top where the face rises from it.
      _c.set(_b.x, soffit + 1.2, _b.z);
      const foot = world.raycast(_c, DOWN, 1.25);
      _b.y = foot && foot.normal.y > 0.7 ? Math.max(soffit, foot.point.y) + 0.03 : soffit + 0.05;
      const dist = pos.distanceTo(_b);
      c.startVault(_b, Math.min(0.4, Math.max(0.2, 0.12 + 0.1 * dist)), 'wall', _a.set(0, UP_SPEED * 0.5, 0));
      // (Out from under it first, then up.)
      const deep = Math.min(1, Math.max(0, lip));
      c.vault.ctrl.copy(_b).addScaledVector(n, 0.5 + deep);
      c.vault.ctrl.y = pos.y - 0.4 * deep;
      return true;
    }
    if (face && face.normal.y >= 0.5) {
      // A steep roof rising from the lip (a clock tower's pyramid cap): up onto it.
      _b.copy(face.point).addScaledVector(face.normal, 0.05);
      c.startVault(_b, 0.35, 'ground', _a.copy(n).multiplyScalar(-3));
      c.vault.ctrl.set(pos.x + n.x * out, pos.y + 0.5, pos.z + n.z * out);
      return true;
    }
    // No face: stand on top, between the wall and the lip (clear of a front upstand), if there is
    // headroom.
    const land = Math.max(0, lip - 0.85);
    _c.set(pos.x + n.x * land, soffit + 2.4, pos.z + n.z * land);
    const top = world.raycast(_c, DOWN, 2.5);
    if (!top || top.normal.y < 0.7) return false;
    _b.copy(top.point);
    _c.set(_b.x, _b.y + 0.05, _b.z);
    if (world.raycast(_c, UP, p.height + 0.1)) return false;
    c.startVault(_b, 0.4, 'ground', _a.copy(n).multiplyScalar(-3));
    // Swing out past the lip first, then up and back in (not through the slab).
    const wide = lip * 2 + 1.5;
    c.vault.ctrl.set(pos.x + n.x * wide, pos.y - 0.2, pos.z + n.z * wide);
    return true;
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
