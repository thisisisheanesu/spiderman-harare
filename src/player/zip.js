import * as THREE from 'three';
import { findZipTarget, groundBelow } from './anchors.js';

// Web-zip: fire two lines at the crosshair target (aim-assisted towards roof edges) and get yanked
// there. Roof edges end in a vault + perch, walls in a wall crawl, open surfaces in a landing.
// Pressing jump during the pull turns the arrival into a point-launch.

const MAX_SPEED = 42;
const ACCEL = 150;
const SHOT_SPEED = 520;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class ZipMove {
  constructor(ctrl) {
    this.c = ctrl;
    this.kind = '';
    this.point = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.dest = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, -1);
    this.speed = 0;
    this.delay = 0;
    this.dist0 = 1;
    this.progress = 0;
    this.timeLeft = 0;
    this.launch = false;
    this.lines = [];
    this.hit = { kind: '', point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  }

  // Where a zip fired now would go (also drives the aim marker); null if there is nothing in reach.
  target(out = this.hit) {
    const c = this.c;
    const cam = c.game.camera;
    cam.getWorldDirection(_camDir);
    _origin.copy(c.center).y += 0.5;
    return findZipTarget(c.world, cam.position, _camDir, _origin, out);
  }

  tryStart() {
    const c = this.c;
    const p = c.p;
    const hit = this.target();
    if (!hit) return;
    const origin = _origin.clone();
    if (p.state === 'swing') c.swing.release(false, true);
    c.dropWebs();
    this.kind = hit.kind;
    this.point.copy(hit.point);
    this.normal.copy(hit.normal);
    this.launch = false;
    // Where the feet end up: just below a roof edge (then vault up), chest-high against a wall (never
    // below the street), or on the surface.
    const r = p.radius;
    const dest = this.dest;
    if (hit.kind === 'edge') {
      dest.copy(hit.point).addScaledVector(hit.normal, r + 0.12);
      dest.y = hit.point.y - 1.55;
    } else if (hit.kind === 'wall') {
      dest.copy(hit.point).addScaledVector(hit.normal, r + 0.05);
      dest.y = Math.max(hit.point.y - c.centerHeight, groundBelow(c.world, dest.x, hit.point.y + 0.5, dest.z, 60));
    } else {
      dest.copy(hit.point).addScaledVector(hit.normal, 0.05);
    }
    this.dist0 = Math.max(1, p.position.distanceTo(this.dest));
    this.dir.subVectors(this.dest, p.position).normalize();
    this.speed = Math.max(10, p.velocity.dot(this.dir));
    this.delay = Math.max(0.05, hit.distance / SHOT_SPEED);
    this.timeLeft = this.delay + this.dist0 / (MAX_SPEED * 0.5) + 0.5;
    this.progress = 0;
    p.state = 'zip';
    c.clearActions();
    // One line from each wrist, landing a hand's width apart.
    _b.crossVectors(this.dir, UP);
    if (_b.lengthSq() < 1e-4) _b.set(1, 0, 0);
    _b.normalize().multiplyScalar(0.12);
    this.lines.push(p.webs.shoot('L', p.hands.L, _a.copy(hit.point).sub(_b), hit.normal));
    this.lines.push(p.webs.shoot('R', p.hands.R, _a.copy(hit.point).add(_b), hit.normal, { splat: false }));
    c.emit('player:webShot', { from: origin, to: hit.point.clone() });
    c.emit('player:zip', { from: origin, to: hit.point.clone() });
    c.game.cameraRig?.fovKick?.(5);
  }

  step(h) {
    const c = this.c;
    const p = c.p;
    const v = p.velocity;
    if (this.delay > 0) {
      // Lines still in flight: brake and hang for a beat.
      this.delay -= h;
      v.multiplyScalar(1 - Math.min(1, 4 * h));
      p.position.addScaledVector(v, h);
      c.collide();
      return;
    }
    this.timeLeft -= h;
    if (this.timeLeft <= 0) {
      // Snagged on something: let go rather than grinding against it.
      c.dropWebs();
      p.state = 'air';
      return;
    }
    const dir = _a.subVectors(this.dest, p.position);
    const dist = dir.length();
    this.progress = 1 - dist / this.dist0;
    this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * h);
    const step = this.speed * h;
    if (dist <= step + 0.05) {
      p.position.copy(this.dest);
      this._arrive();
      return;
    }
    dir.divideScalar(dist);
    this.dir.copy(dir);
    v.copy(dir).multiplyScalar(this.speed);
    p.position.addScaledVector(dir, step);
    const res = c.collide();
    if (res.wall && dist > 2.5 && c.wallImpact > this.speed * 0.5) {
      // Something got in the way: grab onto it.
      c.dropWebs();
      p.state = 'air';
      c.wall.enter(res.wallNormal);
    }
  }

  _arrive() {
    const c = this.c;
    const p = c.p;
    c.dropWebs();
    if (this.launch) {
      const hs = Math.hypot(this.dir.x, this.dir.z) || 1;
      c.launch((this.dir.x / hs) * 14, 17, (this.dir.z / hs) * 14);
      c.startTrick('flip');
      return;
    }
    if (this.kind === 'edge') {
      _a.copy(this.point).addScaledVector(this.normal, -0.3);
      _a.y = groundBelow(c.world, _a.x, _a.y + 1.5, _a.z, 3, _a.y);
      c.perchOut.copy(this.normal);
      c.startVault(_a, 0.3, 'perch', _b.set(0, 0, 0));
    } else if (this.kind === 'wall') {
      p.velocity.set(0, 0, 0);
      p.state = 'air';
      c.wall.enter(this.normal);
    } else {
      p.velocity.copy(this.dir).multiplyScalar(6).setY(0);
      p.state = this.normal.y > 0.7 ? 'ground' : 'air';
    }
  }

  dropLines() {
    for (const l of this.lines) this.c.p.webs.release(l);
    this.lines.length = 0;
  }
}
