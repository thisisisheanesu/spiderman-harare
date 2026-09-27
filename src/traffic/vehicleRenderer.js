import * as THREE from 'three';
import { createVehicleUniforms, createBodyMaterial, createGlassMaterial, FLAG } from './vehicleMaterial.js';

// Draws all traffic with two THREE.BatchedMesh (multi-draw: one draw call each):
//   opaque  bodies (LOD0 / LOD1 by distance), toggle variants (kombi liveries, slogan banners, route
//           cards, roof racks; bus destinations and stripes; Hilux cargo / sports bar), wheels (their own
//           instances: they roll and the front ones steer), drivers, passengers and the kombi hwindi
//   glass   the windows (blended, sorted back to front)
// plus two InstancedMeshes: soft contact shadows under every vehicle and headlight pools on the tarmac at
// night. Instances are handed out afresh every frame to the vehicles in view (immediate mode): add() per
// vehicle between begin() and end().

const ROAD_Y = 0.03;
const ALWAYS = 22; // m: vehicles this close are drawn even outside the view (their shadows reach in)
const PRESETS = {
  high: { lod0: 42, wheels: 170, wheelLod0: 13, figures: 42, draw: 470, beams: 200 },
  medium: { lod0: 32, wheels: 130, wheelLod0: 10, figures: 32, draw: 400, beams: 160 },
  low: { lod0: 18, wheels: 80, wheelLod0: 7, figures: 20, draw: 280, beams: 110 },
};

const _chassis = new THREE.Matrix4();
const _body = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _rot = new THREE.Matrix4();
const _out = new THREE.Matrix4();
const _flip = new THREE.Matrix4().makeRotationY(Math.PI);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _sphere = new THREE.Sphere();
const _col = new THREE.Vector4();
const WHITE = new THREE.Vector4(1, 1, 1, 0);

function makeInstanced(geometry, material, capacity, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

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

// A batch whose instances are reassigned every frame.
class Batch {
  constructor(geometries, material, capacity, name) {
    let verts = 0;
    let indices = 0;
    for (const g of geometries) {
      verts += g.attributes.position.count;
      indices += g.index.count;
    }
    this.mesh = new THREE.BatchedMesh(capacity, Math.max(3, verts), Math.max(3, indices), material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false; // the batch's own bounds go stale as instances move
    this.mesh.perObjectFrustumCulled = false; // add() culls per vehicle
    this.mesh.sortObjects = false;
    this.ids = new Map();
    for (const g of geometries) this.ids.set(g, this.mesh.addGeometry(g));
    const first = this.ids.values().next().value;
    this.capacity = capacity;
    this.visible = new Uint8Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.mesh.addInstance(first);
      this.mesh.setVisibleAt(i, false);
    }
    this.used = 0;
    this.prevUsed = 0;
    this.tris = 0;
    this.triCount = new Map();
    for (const g of geometries) this.triCount.set(this.ids.get(g), g.index.count / 3);
  }

  id(geometry) {
    return geometry ? this.ids.get(geometry) ?? -1 : -1;
  }

  begin() {
    this.prevUsed = this.used;
    this.used = 0;
    this.tris = 0;
  }

  put(gid, matrix, color) {
    if (gid < 0 || this.used >= this.capacity) return -1;
    const i = this.used++;
    const m = this.mesh;
    m.setGeometryIdAt(i, gid);
    m.setMatrixAt(i, matrix);
    if (color) m.setColorAt(i, color);
    if (!this.visible[i]) {
      this.visible[i] = 1;
      m.setVisibleAt(i, true);
    }
    this.tris += this.triCount.get(gid) || 0;
    return i;
  }

  end() {
    const m = this.mesh;
    for (let i = this.used; i < this.prevUsed; i++) {
      if (!this.visible[i]) continue;
      this.visible[i] = 0;
      m.setVisibleAt(i, false);
    }
    // Geometry ids change from frame to frame (LOD, variants): rebuild the multi-draw list.
    m._visibilityChanged = true;
    m.visible = this.used > 0;
  }
}

export class VehicleRenderer {
  // opts: {renderer, capacity (vehicles), castShadows, receiveShadows, level: 'high'|'medium'|'low'}
  constructor(scene, lib, opts = {}) {
    this.scene = scene;
    this.lib = lib;
    this.renderer = opts.renderer;
    this.cfg = PRESETS[opts.level] || PRESETS.high;
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    scene.add(this.group);
    this.uniforms = createVehicleUniforms(lib);
    this.bodyMat = createBodyMaterial(this.uniforms);
    this.glassMat = createGlassMaterial();
    this.models = lib.models;

    // Geometry ids per model: gid[lod] = {body, glass, toggles: {node: {geo, glass}}, front, rear}.
    const opaque = [];
    const glass = [];
    const add = (list, g) => {
      if (g && !list.includes(g)) list.push(g);
      return g;
    };
    for (const m of Object.values(lib.models)) {
      for (const l of m.lods) {
        add(opaque, l.body);
        add(glass, l.glass);
        for (const t of Object.values(l.toggles)) {
          add(opaque, t.geometry);
          add(glass, t.glass);
        }
        add(opaque, l.wheels.front);
        add(opaque, l.wheels.rear);
      }
    }
    const fig = lib.figures;
    if (fig) {
      for (const f of [...fig.drivers, ...fig.mates, ...fig.hwindiLean, ...fig.hwindiKerb]) add(opaque, f.geometry);
      if (fig.busDriver) add(opaque, fig.busDriver.geometry);
      for (const g of [...fig.kombiPassengers, ...fig.busPassengers]) add(opaque, g);
    }
    const cap = Math.max(16, opts.capacity || 200);
    this.opaque = new Batch(opaque, this.bodyMat, cap * 7 + 300, 'traffic-opaque');
    this.glass = new Batch(glass, this.glassMat, cap + 16, 'traffic-glass');
    this.glass.mesh.sortObjects = true; // blended: back to front
    this.opaque.mesh.castShadow = !!opts.castShadows;
    this.opaque.mesh.receiveShadow = !!opts.receiveShadows;
    this.glass.mesh.receiveShadow = !!opts.receiveShadows;
    this.glass.mesh.renderOrder = 1;
    this._cullShadows(this.opaque.mesh);
    this.group.add(this.opaque.mesh, this.glass.mesh);

    for (const m of Object.values(lib.models)) {
      m.gid = m.lods.map((l) => ({
        body: this.opaque.id(l.body),
        glass: this.glass.id(l.glass),
        toggles: Object.fromEntries(Object.entries(l.toggles).map(([k, t]) => [k, { geo: this.opaque.id(t.geometry), glass: this.glass.id(t.glass) }])),
        front: this.opaque.id(l.wheels.front),
        rear: this.opaque.id(l.wheels.rear),
      }));
    }
    const figId = (f) => (f ? this.opaque.id(f.geometry) : -1);
    this.fig = {
      drivers: fig ? fig.drivers.map(figId) : [],
      mates: fig ? fig.mates.map(figId) : [],
      busDriver: fig ? figId(fig.busDriver) : -1,
      hwindiLean: fig ? fig.hwindiLean.map(figId) : [],
      hwindiKerb: fig ? fig.hwindiKerb.map(figId) : [],
      kerbPelvis: fig?.hwindiKerb[0]?.pelvisY ?? 0.9,
      leanPelvis: fig?.hwindiLean[0]?.pelvisY ?? 0.9,
      kombiPassengers: fig ? fig.kombiPassengers.map((g) => this.opaque.id(g)) : [],
      busPassengers: fig ? fig.busPassengers.map((g) => this.opaque.id(g)) : [],
    };

    const total = cap;
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      color: '#000000',
      transparent: true,
      opacity: opts.castShadows ? 0.5 : 0.72,
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
    this._shared = [this.shadows, this.beams];
    this.camPos = new THREE.Vector3();
    this.stats = { vehicles: 0, instances: 0, tris: 0 };
    this._envT = 0;
  }

  // The shadow pass sees only the instances inside the light's frustum (the sun's shadow box follows the
  // player), so far traffic costs nothing there.
  _cullShadows(mesh) {
    mesh.onBeforeShadow = function (renderer, object, camera, shadowCamera, geometry, depthMaterial) {
      this.perObjectFrustumCulled = true;
      this._visibilityChanged = true;
      this.onBeforeRender(renderer, null, shadowCamera, geometry, depthMaterial);
      this.perObjectFrustumCulled = false;
      this._visibilityChanged = true;
    };
  }

  begin(camera, night, dt = 0) {
    this._pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._pv);
    this.camPos.copy(camera.position);
    this.night = night;
    this.uniforms.uNight.value = night;
    this.beamMat.opacity = 0.5 * night;
    this.opaque.begin();
    this.glass.begin();
    for (const m of this._shared) m.count = 0;
    this.stats.vehicles = 0;
    this._environment(dt, night);
  }

  inView(x, y, z, r) {
    _sphere.center.set(x, y, z);
    _sphere.radius = r;
    return this.frustum.intersectsSphere(_sphere);
  }

  // Reflections: the city's scene.environment when there is one; until then (or without it) a small
  // PMREM of a sky / street gradient, dimmed at night, so chrome, paint and glass never read black.
  _environment(dt, night) {
    const env = this.scene.environment;
    const mats = [this.bodyMat, this.glassMat];
    if (env) {
      if (this.bodyMat.envMap) {
        for (const m of mats) {
          m.envMap = null;
          m.needsUpdate = true;
        }
      }
      return;
    }
    this._envT -= dt;
    if (!this._fallback || this._envT <= 0) {
      this._envT = 4;
      this._buildFallback();
    }
    if (this.bodyMat.envMap !== this._fallback) {
      for (const m of mats) {
        m.envMap = this._fallback;
        m.needsUpdate = true;
      }
    }
    const k = 0.9 * (1 - 0.8 * night);
    this.bodyMat.envMapIntensity = k;
    this.glassMat.envMapIntensity = k * 1.2;
  }

  _buildFallback() {
    const r = this.renderer;
    if (!r) return;
    const pal = this._palette;
    const key = pal?.zenith?.isColor ? `${pal.zenith.getHex()},${pal.horizon.getHex()},${pal.ground.getHex()}` : 'default';
    if (this._fallback && this._fallbackKey === key) return;
    this._fallbackKey = key;
    if (!this._envScene) {
      const geo = new THREE.SphereGeometry(10, 32, 16);
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
      this._envSphere = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
      this._envScene = new THREE.Scene();
      this._envScene.add(this._envSphere);
      this._pmrem = new THREE.PMREMGenerator(r);
    }
    const zen = new THREE.Color(pal?.zenith ?? '#5d8fd0');
    const hor = new THREE.Color(pal?.horizon ?? '#cfd9e2');
    const gnd = new THREE.Color(pal?.ground ?? '#4a4640');
    const city = hor.clone().lerp(gnd, 0.55);
    const pos = this._envSphere.geometry.attributes.position;
    const col = this._envSphere.geometry.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 10;
      if (y > 0.35) c.copy(hor).lerp(zen, Math.min(1, (y - 0.35) / 0.5));
      else if (y > 0.04) c.copy(city).lerp(hor, (y - 0.04) / 0.31);
      else c.copy(gnd).lerp(city, Math.max(0, (y + 0.3) / 0.34));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    const old = this._fallbackRT;
    this._fallbackRT = this._pmrem.fromScene(this._envScene, 0, 0.1, 100);
    this._fallback = this._fallbackRT.texture;
    if (old) {
      // Swap the texture in place so the materials keep their program.
      for (const m of [this.bodyMat, this.glassMat]) if (m.envMap === old.texture) m.envMap = this._fallback;
      old.dispose();
    }
  }

  setSkyPalette(palette) {
    this._palette = palette;
  }

  // flags: FLAG bits (lamps). hwindiPose: 0 none, 1 leaning out of the door, 2 on the kerb.
  add(v, flags, hwindiPose, time) {
    const m = v.model;
    if (!m?.gid) return;
    const p = v.position;
    const dx = p.x - this.camPos.x;
    const dz = p.z - this.camPos.z;
    const d2 = dx * dx + dz * dz;
    const cfg = this.cfg;
    if (d2 > cfg.draw * cfg.draw) return;
    if (d2 > ALWAYS * ALWAYS && !this.inView(p.x, p.y + v.height / 2, p.z, v.length * 0.6 + 1.5)) return;
    const d = Math.sqrt(d2);
    const lod = d < cfg.lod0 ? 0 : 1;
    const g = m.gid[lod];
    this.stats.vehicles++;

    // Chassis (wheels, shadow, kerbside hwindi) follows the road, pitched along the Kopje's slope; the
    // body adds its own pitch and roll on the suspension.
    const slope = v.slope || 0;
    const y = p.y + ROAD_Y;
    _euler.set(slope, v.heading, 0);
    _chassis.makeRotationFromEuler(_euler).setPosition(p.x, y, p.z);
    _euler.set(slope + v.pitch, v.heading, v.roll);
    _body.makeRotationFromEuler(_euler).setPosition(p.x, y, p.z);

    const c = v.color;
    _col.set(c.r, c.g, c.b, flags);
    const O = this.opaque;
    O.put(g.body, _body, _col);
    this.glass.put(g.glass, _body, null);
    const tg = v.toggles;
    if (tg) {
      for (let i = 0; i < tg.length; i++) {
        const t = g.toggles[tg[i]];
        if (!t) continue;
        O.put(t.geo, _body, _col);
        if (t.glass >= 0) this.glass.put(t.glass, _body, null);
      }
    }

    if (this.shadows.count < this.shadows.instanceMatrix.count) {
      _local.makeScale(v.width * 1.3, 1, v.length * 1.08).setPosition(0, 0.02, 0);
      _out.multiplyMatrices(_chassis, _local);
      this.shadows.setMatrixAt(this.shadows.count++, _out);
    }
    if (flags & FLAG.HEAD && d < cfg.beams && this.beams.count < this.beams.instanceMatrix.count) {
      _local.makeScale(v.width * 2, 1, 11).setPosition(0, 0.03, -(m.front + 5.2));
      _out.multiplyMatrices(_chassis, _local);
      this.beams.setMatrixAt(this.beams.count++, _out);
    }

    if (d < cfg.wheels) {
      const wl = d < cfg.wheelLod0 ? m.gid[0] : m.gid[1];
      const spin = -(v.odo || 0) / m.wheelRadius;
      const steer = Math.max(-m.steerMax, Math.min(m.steerMax, v.steer || 0));
      for (let k = 0; k < 4; k++) {
        const h = m.hubs[k];
        const front = k < 2;
        _local.makeRotationX(spin);
        if (!(k & 1)) _local.multiply(_flip); // left wheels: the right wheel turned round, spun after
        if (front && steer) _local.premultiply(_rot.makeRotationY(steer));
        _local.setPosition(h[0], h[1], h[2]);
        _out.multiplyMatrices(_chassis, _local);
        O.put(front ? wl.front : wl.rear, _out, WHITE);
      }
    }

    if (d < cfg.figures && v.crew) this._crew(v, m, hwindiPose, time);
  }

  _crew(v, m, hwindiPose, time) {
    const O = this.opaque;
    const F = this.fig;
    const cr = v.crew;
    const seat = m.crew;
    if (cr.driver >= 0 && seat.driver) {
      const gid = v.type === 'bus' ? F.busDriver : F.drivers[cr.driver % F.drivers.length];
      if (gid >= 0) {
        _local.makeTranslation(seat.driver[0], seat.driver[1], seat.driver[2]);
        _out.multiplyMatrices(_body, _local);
        O.put(gid, _out, WHITE);
      }
    }
    if (cr.mate >= 0 && seat.mate && F.mates.length) {
      _local.makeTranslation(seat.mate[0], seat.mate[1], seat.mate[2]);
      _out.multiplyMatrices(_body, _local);
      O.put(F.mates[cr.mate % F.mates.length], _out, WHITE);
    }
    if (cr.passengers >= 0) {
      const list = v.type === 'bus' ? F.busPassengers : F.kombiPassengers;
      if (list.length) O.put(list[cr.passengers % list.length], _body, WHITE);
    }
    const door = m.door;
    if (!hwindiPose || !door) return;
    const phase = time * 1.6 + v.id * 0.37;
    if (hwindiPose === 1 && F.hwindiLean.length) {
      // Inside the sliding door, forearms on the window sill, head and arms out, beckoning.
      const f = Math.floor(phase) % F.hwindiLean.length;
      _local.makeRotationY(Math.PI / 2);
      _local.setPosition(door.x + 0.34, F.leanPelvis + 0.28, door.z);
      _out.multiplyMatrices(_body, _local);
      O.put(F.hwindiLean[f], _out, WHITE);
    } else if (hwindiPose === 2 && F.hwindiKerb.length) {
      // On the kerb beside the door, facing the pavement, waving people in.
      const f = Math.floor(phase * 1.4) % F.hwindiKerb.length;
      _local.makeRotationY(Math.PI / 2 + Math.sin(time * 0.5 + v.id) * 0.45);
      _local.setPosition(door.x - 0.62, F.kerbPelvis + 0.02, door.z + 0.1);
      _out.multiplyMatrices(_chassis, _local);
      O.put(F.hwindiKerb[f], _out, WHITE);
    }
  }

  end() {
    this.opaque.end();
    this.glass.end();
    for (const m of this._shared) {
      m.visible = m.count > 0;
      if (m.visible) upload(m.instanceMatrix, m.count);
    }
    this.stats.instances = this.opaque.used + this.glass.used;
    this.stats.tris = this.opaque.tris + this.glass.tris;
  }
}
