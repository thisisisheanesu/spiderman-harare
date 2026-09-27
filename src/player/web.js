import * as THREE from 'three';

// Web lines (camera-facing ribbons from a wrist to an anchor) and web splats where they stick.
// Lines animate their shot (~0.08 s), sag while slack, and after release drop and fade away.

const SEGMENTS = 18;
const SHOT_SPEED = 520; // m/s: a 40 m shot lands in ~0.08 s
const RELEASE_TIME = 0.45;
const SPLAT_COUNT = 16;
const SPLAT_LIFE = 9;

function ribbonAlphaTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 4;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 4);
  return new THREE.CanvasTexture(c);
}

function splatTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.translate(S / 2, S / 2);
  ctx.strokeStyle = 'rgba(245,248,255,0.95)';
  ctx.lineCap = 'round';
  const spokes = 9;
  const ang = [];
  for (let i = 0; i < spokes; i++) ang.push((i / spokes) * Math.PI * 2 + Math.sin(i * 7.3) * 0.2);
  ctx.lineWidth = 3;
  for (const a of ang) {
    const r = S * (0.36 + 0.1 * Math.sin(a * 5));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(Math.cos(a + 0.15) * r * 0.5, Math.sin(a + 0.15) * r * 0.5, Math.cos(a) * r, Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.lineWidth = 2;
  for (const f of [0.12, 0.21, 0.3]) {
    ctx.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a0 = ang[i % spokes];
      const a1 = ang[(i + 1) % spokes] + (i + 1 === spokes ? Math.PI * 2 : 0);
      const r = S * f;
      if (i === 0) ctx.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
      if (i < spokes) {
        const am = (a0 + a1) / 2;
        ctx.quadraticCurveTo(Math.cos(am) * r * 0.8, Math.sin(am) * r * 0.8, Math.cos(a1) * r, Math.sin(a1) * r);
      }
    }
    ctx.stroke();
  }
  const blob = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.1);
  blob.addColorStop(0, 'rgba(255,255,255,1)');
  blob.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = blob;
  ctx.beginPath();
  ctx.arc(0, 0, S * 0.1, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _s = new THREE.Vector3();
const _view = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

class WebLine {
  constructor(alphaMap) {
    const verts = (SEGMENTS + 1) * 2;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(verts * 2);
    const index = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      uv.set([0, i / SEGMENTS, 1, i / SEGMENTS], i * 4);
      if (i < SEGMENTS) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(index);
    this.material = new THREE.MeshBasicMaterial({
      color: '#f4f8ff',
      alphaMap,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    this.state = 'off';
    this.side = 'R';
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.progress = 0;
    this.travel = 0.08;
    this.slack = 0;
    this.fade = 0;
    this.drop = 0;
    this.splat = true;
  }
}

function markerTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.translate(S / 2, S / 2);
  ctx.lineCap = 'round';
  for (const [color, width] of [['rgba(10,12,20,0.55)', 7], ['#ffffff', 3]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(0, 0, S * 0.26, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * S * 0.33, Math.sin(a) * S * 0.33);
      ctx.lineTo(Math.cos(a) * S * 0.44, Math.sin(a) * S * 0.44);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Webs {
  constructor(scene) {
    // Zip aim marker: constant screen size, drawn on top.
    this.marker = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: markerTexture(),
        depthTest: false,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
        sizeAttenuation: false,
      }),
    );
    this.marker.scale.setScalar(0.045);
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    scene.add(this.marker);

    const alpha = ribbonAlphaTexture();
    this.lines = Array.from({ length: 5 }, () => new WebLine(alpha));
    for (const l of this.lines) scene.add(l.mesh);
    this.splats = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: splatTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      SPLAT_COUNT,
    );
    this.splats.frustumCulled = false;
    this.splatData = Array.from({ length: SPLAT_COUNT }, () => ({
      age: SPLAT_LIFE,
      pos: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      size: 1,
      spin: 0,
    }));
    this.nextSplat = 0;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < SPLAT_COUNT; i++) this.splats.setMatrixAt(i, _m);
    scene.add(this.splats);
  }

  // Fire a line from hand `side` ('L'|'R') to `to`. Returns the line (to update slack / release).
  shoot(side, from, to, normal, { splat = true } = {}) {
    const line = this.lines.find((l) => l.state === 'off') || this.lines.reduce((a, b) => (a.fade < b.fade ? a : b));
    line.state = 'shoot';
    line.side = side;
    line.from.copy(from);
    line.to.copy(to);
    line.normal.copy(normal);
    line.progress = 0;
    line.travel = Math.max(0.05, from.distanceTo(to) / SHOT_SPEED);
    line.slack = 0;
    line.fade = 1;
    line.drop = 0;
    line.splat = splat;
    line.mesh.visible = true;
    return line;
  }

  // Show the zip marker at `point` (null hides it).
  setAim(point) {
    this.marker.visible = !!point;
    if (point) this.marker.position.copy(point);
  }

  release(line) {
    if (!line || line.state === 'off' || line.state === 'loose') return;
    if (line.state === 'shoot') line.to.lerpVectors(line.from, line.to, line.progress);
    line.state = 'loose';
  }

  clear() {
    for (const l of this.lines) {
      l.state = 'off';
      l.mesh.visible = false;
    }
  }

  _addSplat(pos, normal) {
    const s = this.splatData[this.nextSplat];
    this.nextSplat = (this.nextSplat + 1) % SPLAT_COUNT;
    s.age = 0;
    s.pos.copy(pos).addScaledVector(normal, 0.04);
    s.normal.copy(normal);
    s.size = 0.8 + Math.random() * 0.4;
    s.spin = Math.random() * Math.PI * 2;
  }

  update(dt, camera, hands) {
    for (const l of this.lines) {
      if (l.state === 'off') continue;
      if (l.state !== 'loose') l.from.copy(hands[l.side]);
      if (l.state === 'shoot') {
        l.progress = Math.min(1, l.progress + dt / l.travel);
        if (l.progress >= 1) {
          l.state = 'taut';
          if (l.splat) this._addSplat(l.to, l.normal);
        }
      } else if (l.state === 'loose') {
        l.fade -= dt / RELEASE_TIME;
        l.drop += dt * 9;
        l.from.y -= l.drop * dt * 6;
        if (l.fade <= 0) {
          l.state = 'off';
          l.mesh.visible = false;
          continue;
        }
      }
      this._build(l, camera);
    }
    this._updateSplats(dt);
  }

  _build(l, camera) {
    const a = _a.copy(l.from);
    const b = _b;
    const shooting = l.state === 'shoot';
    const k = shooting ? 1 - (1 - l.progress) ** 2 : 1;
    b.lerpVectors(a, l.to, k);
    const len = a.distanceTo(b);
    const sag = l.state === 'loose' ? len * 0.12 * (1 - l.fade) + 0.3 : Math.min(len * 0.2, l.slack * 0.6);
    const wobble = shooting ? 0.25 * (1 - l.progress) : 0;
    const pos = l.mesh.geometry.attributes.position;
    _t.subVectors(b, a).normalize();
    for (let i = 0; i <= SEGMENTS; i++) {
      const s = i / SEGMENTS;
      _p.lerpVectors(a, b, s);
      _p.y -= sag * 4 * s * (1 - s);
      if (wobble) _p.y += Math.sin(s * 18 + l.progress * 30) * wobble * s * (1 - s);
      _view.subVectors(camera.position, _p);
      const dist = _view.length();
      const width = Math.max(0.018, dist * 0.0021) * (l.state === 'loose' ? l.fade : 1);
      _s.crossVectors(_t, _view);
      if (_s.lengthSq() < 1e-10) _s.set(0, 1, 0).cross(_t);
      _s.normalize().multiplyScalar(width);
      pos.setXYZ(i * 2, _p.x - _s.x, _p.y - _s.y, _p.z - _s.z);
      pos.setXYZ(i * 2 + 1, _p.x + _s.x, _p.y + _s.y, _p.z + _s.z);
    }
    pos.needsUpdate = true;
    l.material.opacity = 0.95 * Math.min(1, l.fade * 1.5);
  }

  _updateSplats(dt) {
    let dirty = false;
    for (let i = 0; i < SPLAT_COUNT; i++) {
      const s = this.splatData[i];
      if (s.age >= SPLAT_LIFE) continue;
      s.age += dt;
      dirty = true;
      const grow = Math.min(1, s.age / 0.12);
      const shrink = Math.min(1, (SPLAT_LIFE - s.age) / 0.6);
      const size = s.age >= SPLAT_LIFE ? 0 : s.size * grow * Math.max(0, shrink);
      _q.setFromUnitVectors(Z, s.normal);
      _q.multiply(_q2.setFromAxisAngle(Z, s.spin));
      _m.compose(s.pos, _q, _scale.set(size, size, size));
      this.splats.setMatrixAt(i, _m);
    }
    if (dirty) this.splats.instanceMatrix.needsUpdate = true;
  }
}
