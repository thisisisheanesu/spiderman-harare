import * as THREE from 'three';
import { MODEL_BUILDERS, buildHwindi, buildWheelGeometry } from './vehicleModels.js';
import { createVehicleMaterial, NO_ROW } from './vehicleMaterial.js';

// Draws every vehicle with one InstancedMesh per model, plus shared instanced wheels (spinning, front
// ones steering), hwindi figures and soft contact shadows. Instances are rewritten every frame for the
// vehicles inside the camera frustum only.

const ROAD_Y = 0.03;
const DETAIL_DIST = 220;
const NO_ROWS = NO_ROW + 64 * NO_ROW;

const _chassis = new THREE.Matrix4();
const _body = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _rot = new THREE.Matrix4();
const _out = new THREE.Matrix4();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _scale = new THREE.Vector3();
const _sphere = new THREE.Sphere();

function makeInstanced(geometry, material, capacity, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

function instancedAttr(geometry, name, capacity, size) {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
  attr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(name, attr);
  return attr;
}

// Instance buffers are sized for the worst case: upload only the instances written this frame.
function upload(attr, count) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count * attr.itemSize);
  attr.needsUpdate = true;
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 64, 4, 32, 64, 60);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 128);
  return new THREE.CanvasTexture(c);
}

// Two soft lobes of headlight spill on the tarmac, brightest just ahead of the bumper.
function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.globalCompositeOperation = 'lighter';
  for (const x of [21, 43]) {
    ctx.save();
    ctx.translate(x, 126);
    ctx.scale(1, 5.2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
    g.addColorStop(0, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-21, -24, 42, 24);
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class VehicleRenderer {
  constructor(scene, atlas, capacities, castShadows) {
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    scene.add(this.group);
    this.material = createVehicleMaterial(atlas);
    this.models = {};
    let total = 0;
    for (const [key, build] of Object.entries(MODEL_BUILDERS)) {
      const cap = capacities[key] ?? capacities.default;
      const spec = build();
      const mesh = makeInstanced(spec.geometry, this.material, cap, `vehicles-${key}`);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = castShadows;
      spec.key = key;
      spec.mesh = mesh;
      spec.capacity = cap;
      spec.state = instancedAttr(spec.geometry, 'aState', cap, 4);
      spec.color2 = instancedAttr(spec.geometry, 'aColor2', cap, 4);
      const w0 = spec.wheels[0];
      const w1 = spec.wheels[1];
      spec.axleMid = (w0.u + w1.u) / 2;
      this.models[key] = spec;
      this.group.add(mesh);
      total += cap;
    }

    const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.wheels = makeInstanced(buildWheelGeometry(), wheelMat, total * 4, 'vehicle-wheels');
    this.wheels.castShadow = castShadows;
    this.group.add(this.wheels);

    const hw = buildHwindi();
    this.hwindi = makeInstanced(hw.geometry, this.material, capacities.kombi + (capacities.kombiRack ?? 0), 'hwindi');
    this.hwindi.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.hwindi.instanceMatrix.count * 3), 3);
    // Figures never light up, but the shared shader expects the attribute.
    instancedAttr(hw.geometry, 'aState', this.hwindi.instanceMatrix.count, 4);
    this.hwindiColor2 = instancedAttr(hw.geometry, 'aColor2', this.hwindi.instanceMatrix.count, 4);
    this.hwindi.castShadow = castShadows;
    this.group.add(this.hwindi);

    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      color: '#000000',
      transparent: true,
      opacity: castShadows ? 0.45 : 0.7,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.shadows = makeInstanced(shadowGeo, shadowMat, total, 'vehicle-shadows');
    this.shadows.renderOrder = 1;
    this.group.add(this.shadows);

    const beamGeo = new THREE.PlaneGeometry(1, 1);
    beamGeo.rotateX(-Math.PI / 2);
    this.beamMat = new THREE.MeshBasicMaterial({
      map: beamTexture(),
      color: '#ffe2b0',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.beams = makeInstanced(beamGeo, this.beamMat, total, 'vehicle-headlight-pools');
    this.beams.renderOrder = 2;
    this.group.add(this.beams);
    this.frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    this._shared = [this.wheels, this.hwindi, this.shadows, this.beams];
  }

  begin(camera, night) {
    this._pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._pv);
    this.camPos = camera.position;
    this.beamMat.opacity = 0.5 * night;
    for (const k in this.models) this.models[k].mesh.count = 0;
    for (const m of this._shared) m.count = 0;
  }

  inView(x, y, z, r) {
    _sphere.center.set(x, y, z);
    _sphere.radius = r;
    return this.frustum.intersectsSphere(_sphere);
  }

  // head, brake, left, right: lamp intensities 0..1. hwindiPose: 0 none, 1 hanging out, 2 on the kerb.
  add(v, head, brake, left, right, hwindiPose, time) {
    const spec = v.model;
    const p = v.position;
    if (!this.inView(p.x, p.y + v.height / 2, p.z, v.length * 0.6 + 1.5)) return;
    const mesh = spec.mesh;
    const i = mesh.count;
    if (i >= spec.capacity) return;
    mesh.count = i + 1;
    _chassis.makeRotationY(v.heading).setPosition(p.x, ROAD_Y, p.z);
    _euler.set(v.pitch, v.heading, v.roll);
    _body.makeRotationFromEuler(_euler).setPosition(p.x, ROAD_Y, p.z);
    mesh.setMatrixAt(i, _body);
    mesh.setColorAt(i, v.color);
    const st = spec.state.array;
    st[i * 4] = head;
    st[i * 4 + 1] = brake;
    st[i * 4 + 2] = left;
    st[i * 4 + 3] = right;
    const c2 = spec.color2.array;
    c2[i * 4] = v.color2.r;
    c2[i * 4 + 1] = v.color2.g;
    c2[i * 4 + 2] = v.color2.b;
    c2[i * 4 + 3] = v.rows;

    if (this.shadows.count < this.shadows.instanceMatrix.count) {
      _local.makeScale(v.width * 1.35, 1, v.length * 1.12).setPosition(0, 0.02, 0);
      _out.multiplyMatrices(_chassis, _local);
      this.shadows.setMatrixAt(this.shadows.count++, _out);
    }

    const dx = p.x - this.camPos.x;
    const dz = p.z - this.camPos.z;
    if (dx * dx + dz * dz > DETAIL_DIST * DETAIL_DIST) return;

    if (head > 0.25 && this.beams.count < this.beams.instanceMatrix.count) {
      _local.makeScale(v.width * 2, 1, 11).setPosition(0, 0.03, -(v.length / 2 + 5.2));
      _out.multiplyMatrices(_chassis, _local);
      this.beams.setMatrixAt(this.beams.count++, _out);
    }

    for (const w of spec.wheels) {
      const spin = -v.odo / w.r;
      const x = spec.width / 2 - w.w / 2 - 0.03;
      for (let side = -1; side <= 1; side += 2) {
        if (this.wheels.count >= this.wheels.instanceMatrix.count) break;
        _local.makeRotationX(spin);
        if (w.front && v.steer) _local.premultiply(_rot.makeRotationY(v.steer));
        _local.scale(_scale.set(w.w, w.r, w.r)).setPosition(side * x, w.r, -w.u);
        _out.multiplyMatrices(_chassis, _local);
        this.wheels.setMatrixAt(this.wheels.count++, _out);
      }
    }

    if (hwindiPose && spec.door && this.hwindi.count < this.hwindi.instanceMatrix.count) {
      const k = this.hwindi.count++;
      const d = spec.door;
      if (hwindiPose === 1) {
        const sway = Math.sin(time * 3 + v.id) * 0.05;
        _euler.set(0, 0.35, 0.28 + sway);
        _local.makeRotationFromEuler(_euler).setPosition(d.x - 0.1, 0.4, d.z + 0.05);
      } else {
        const bob = Math.abs(Math.sin(time * 4 + v.id)) * 0.04;
        _euler.set(0, Math.PI / 2 + Math.sin(time * 0.7 + v.id) * 0.5, 0);
        _local.makeRotationFromEuler(_euler).setPosition(d.x - 0.55, bob, d.z);
      }
      _out.multiplyMatrices(_chassis, _local);
      this.hwindi.setMatrixAt(k, _out);
      this.hwindi.setColorAt(k, v.hwindiShirt);
      const c = this.hwindiColor2.array;
      c[k * 4] = v.hwindiTrousers.r;
      c[k * 4 + 1] = v.hwindiTrousers.g;
      c[k * 4 + 2] = v.hwindiTrousers.b;
      c[k * 4 + 3] = NO_ROWS;
    }
  }

  end() {
    for (const k in this.models) {
      const spec = this.models[k];
      const mesh = spec.mesh;
      mesh.visible = mesh.count > 0;
      if (!mesh.visible) continue;
      upload(mesh.instanceMatrix, mesh.count);
      upload(mesh.instanceColor, mesh.count);
      upload(spec.state, mesh.count);
      upload(spec.color2, mesh.count);
    }
    for (const m of this._shared) {
      m.visible = m.count > 0;
      if (m.visible) upload(m.instanceMatrix, m.count);
    }
    if (this.hwindi.visible) {
      upload(this.hwindi.instanceColor, this.hwindi.count);
      upload(this.hwindiColor2, this.hwindi.count);
    }
  }
}
