import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

// The realistic traffic models (public/models/vehicles, see its README) baked for batched drawing:
// every glTF mesh of every model, LOD, toggle node and wheel is re-baked into ONE vertex layout so all of
// them can live in the same THREE.BatchedMesh with one material (vehicleMaterial.js):
//
//   position, normal, uv      float, in the vehicle's root space (metres, faces -Z, origin on the ground
//                             under the middle of the length); wheels around their hub, figures around
//                             their pelvis
//   aBase  (uint8 x4, norm)   rgb = sqrt(linear base colour factor), a = roughness
//   aMat   (uint8 x4)         x = material slot (MAT), y = albedo array layer, z = normal array layer
//                             (NO_LAYER = none), w = metalness x 100
//
// Textures go into two DataArrayTextures: `albedo` (sRGB: the shared lamp atlas, liveries, number plates
// four to a layer, NPC atlases four to a layer) and `normal` (linear: paint normal maps with the paint's
// greyscale detail map in alpha, tyre normals). Glass is baked separately (it is blended, second batch).
//
// Drivers, kombi / bus passengers and the hwindi are NPC LOD1 meshes (public/models/humans) posed once
// with the shared clips ('drive', 'sit_idle', 'call_out', 'wave') and baked the same way (slot FIGURE),
// with the legs of seated people dropped (they are under the dash).

export const MODELS = [
  'kombi',
  'hatch_fit',
  'sedan_corolla',
  'sedan_mercedes',
  'wagon_wish',
  'pickup_hilux',
  'suv_landcruiser',
  'taxi',
  'police_landcruiser',
  'bus_zupco',
  'truck_isuzu',
];

// Material slots (aMat.x). The shader (vehicleMaterial.js) switches on these.
export const MAT = {
  PAINT: 0,
  CHROME: 1,
  TRIM: 2,
  TYRE: 3,
  RIM: 4,
  HEAD: 5,
  TAIL: 6,
  IND_L: 7,
  IND_R: 8,
  PLATE: 9,
  INTERIOR: 10,
  LIVERY: 11,
  BEACON_B: 12,
  BEACON_R: 13,
  FIGURE: 14,
  LED: 15,
  GLASS: 16,
};
export const NO_LAYER = 255;

const BY_NAME = {
  paint: MAT.PAINT,
  chrome: MAT.CHROME,
  trim: MAT.TRIM,
  tyre: MAT.TYRE,
  rim: MAT.RIM,
  light_front: MAT.HEAD,
  light_rear: MAT.TAIL,
  indicator: MAT.IND_L,
  plate: MAT.PLATE,
  interior: MAT.INTERIOR,
  livery: MAT.LIVERY,
  beacon_blue: MAT.BEACON_B,
  beacon_red: MAT.BEACON_R,
  glass: MAT.GLASS,
};

// Crew placement per model, vehicle space (x right, y up, -z forward; right-hand drive, so the driver
// sits on +x). driver / mate = hip joint of the seated driver / front passenger. door = kombi sliding door
// (kerb side, -x): x at the body side, z at its middle.
const CREW = {
  kombi: { driver: [0.4, 0.93, -1.47], mate: [-0.42, 0.93, -1.47], door: [-0.845, -0.25] },
  hatch_fit: { driver: [0.36, 0.5, 0.02], mate: [-0.36, 0.5, 0.02] },
  sedan_corolla: { driver: [0.37, 0.46, 0.0], mate: [-0.37, 0.46, 0.0] },
  taxi: { driver: [0.37, 0.46, 0.0], mate: [-0.37, 0.46, 0.0] },
  sedan_mercedes: { driver: [0.38, 0.44, -0.05], mate: [-0.38, 0.44, -0.05] },
  wagon_wish: { driver: [0.37, 0.52, -0.12], mate: [-0.37, 0.52, -0.12] },
  pickup_hilux: { driver: [0.4, 0.8, -0.42], mate: [-0.4, 0.8, -0.42] },
  suv_landcruiser: { driver: [0.43, 0.83, -0.2], mate: [-0.43, 0.83, -0.2] },
  police_landcruiser: { driver: [0.43, 0.83, -0.2], mate: [-0.43, 0.83, -0.2] },
  bus_zupco: { driver: [0.72, 1.28, -4.95] },
  truck_isuzu: { driver: [0.52, 1.3, -2.72], mate: [-0.45, 1.3, -2.72] },
};

// Seated passengers baked into blocks (vehicle space hips + yaw), several variants per vehicle.
const KOMBI_SEATS = [
  [-0.05, 0.98, -0.62], [0.42, 0.98, -0.62],
  [-0.48, 0.98, 0.2], [0.02, 0.98, 0.2], [0.48, 0.98, 0.2],
  [-0.48, 0.98, 1.0], [0.02, 0.98, 1.0], [0.48, 0.98, 1.0],
];
const BUS_SEATS = [
  [-0.75, 1.4, -2.9], [0.75, 1.4, -2.4], [-0.75, 1.4, -1.6], [0.3, 1.4, -1.1], [0.75, 1.4, -0.1],
  [-0.75, 1.4, 0.6], [-0.3, 1.4, 1.6], [0.75, 1.4, 2.4], [-0.75, 1.4, 3.5], [0.75, 1.4, 4.2],
];

// NPC variants used as crew (LOD1 files, cached through game.assets so the npcs system shares them).
const CREW_NPCS = [
  'man_hoodie',
  'man_polo_chinos',
  'man_tshirt_jeans_cap',
  'man_shirt_tie',
  'man_business_suit',
  'man_elder_flatcap',
  'man_overalls',
  'woman_casual_tee',
  'woman_blouse_skirt',
  'woman_dress_bright',
  'woman_zambia_wrap',
  'woman_elder',
];
const DRIVERS = ['man_polo_chinos', 'man_tshirt_jeans_cap', 'man_shirt_tie', 'man_business_suit', 'man_elder_flatcap', 'woman_blouse_skirt'];
const BUS_DRIVER = 'man_shirt_tie';
const HWINDI = 'man_hoodie';
const LEG_BONES = ['calf_l', 'calf_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r'];

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _nm = new THREE.Matrix3();

// ---- geometry builder ------------------------------------------------------------------------------

class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.base = [];
    this.mat = [];
    this.idx = [];
    this.count = 0;
  }

  get empty() {
    return this.idx.length === 0;
  }

  // Appends one vertex; info = {id, aLayer, nLayer, color (linear THREE.Color), rough, metal}.
  vertex(x, y, z, nx, ny, nz, u, v, info, id = info.id) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    const c = info.color;
    this.base.push(
      Math.round(Math.sqrt(Math.max(0, c.r)) * 255),
      Math.round(Math.sqrt(Math.max(0, c.g)) * 255),
      Math.round(Math.sqrt(Math.max(0, c.b)) * 255),
      Math.round(THREE.MathUtils.clamp(info.rough, 0, 1) * 255),
    );
    this.mat.push(id, info.aLayer ?? NO_LAYER, info.nLayer ?? NO_LAYER, Math.round(THREE.MathUtils.clamp(info.metal, 0, 1) * 100));
    return this.count++;
  }

  // Bakes a (possibly quantised) mesh geometry through `matrix`. info.uvRemap(u, v, out) optional;
  // info.split = true colours indicator vertices left / right by the sign of x; info.twoSided duplicates
  // the triangles facing the other way (the double-sided interior); keep(i) filters vertices.
  addGeometry(geometry, matrix, info, keep = null) {
    const p = geometry.attributes.position;
    let n = geometry.attributes.normal;
    if (!n) {
      geometry = geometry.clone();
      geometry.computeVertexNormals();
      n = geometry.attributes.normal;
    }
    const t = geometry.attributes.uv;
    _nm.getNormalMatrix(matrix);
    const flip = matrix.determinant() < 0;
    const uvOut = [0, 0];
    const sides = info.twoSided ? [1, -1] : [1];
    for (const side of sides) {
      const map = new Int32Array(p.count).fill(-1);
      for (let i = 0; i < p.count; i++) {
        if (keep && !keep(i)) continue;
        _v.fromBufferAttribute(p, i).applyMatrix4(matrix);
        _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize().multiplyScalar(side);
        let u = t ? t.getX(i) : 0;
        let w = t ? t.getY(i) : 0;
        if (info.uvRemap) {
          info.uvRemap(u, w, uvOut);
          u = uvOut[0];
          w = uvOut[1];
        }
        const id = info.split ? (_v.x < 0 ? MAT.IND_L : MAT.IND_R) : info.id;
        map[i] = this.vertex(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z, u, w, info, id);
      }
      const index = geometry.index;
      const triCount = index ? index.count / 3 : p.count / 3;
      const reverse = flip !== side < 0;
      for (let f = 0; f < triCount; f++) {
        const a = map[index ? index.getX(f * 3) : f * 3];
        const b = map[index ? index.getX(f * 3 + 1) : f * 3 + 1];
        const c = map[index ? index.getX(f * 3 + 2) : f * 3 + 2];
        if (a < 0 || b < 0 || c < 0) continue;
        if (reverse) this.idx.push(a, c, b);
        else this.idx.push(a, b, c);
      }
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('aBase', new THREE.BufferAttribute(new Uint8Array(this.base), 4, true));
    g.setAttribute('aMat', new THREE.BufferAttribute(new Uint8Array(this.mat), 4, false));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// ---- texture arrays --------------------------------------------------------------------------------

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true }) };
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true }) };
}

// Layers are reserved while geometry is baked (so vertices know their layer) and filled afterwards.
class LayerSet {
  constructor(size) {
    this.size = size;
    this.layers = 0;
    this.jobs = []; // {layer, image, x, y, w, h, kind, image2}
    this.keys = new Map();
    this.strips = null; // plate strips: {layer, used}
    this.quads = null; // figure quads
  }

  full(key, image, extra) {
    if (this.keys.has(key)) return this.keys.get(key);
    const layer = this.layers++;
    const S = this.size;
    this.jobs.push({ layer, image, x: 0, y: 0, w: S, h: S, ...extra });
    const r = { layer };
    this.keys.set(key, r);
    return r;
  }

  // Four 4:1 strips per layer (number plates, 512 x 128 in the files).
  strip(key, image) {
    if (this.keys.has(key)) return this.keys.get(key);
    if (!this.strips || this.strips.used === 4) this.strips = { layer: this.layers++, used: 0 };
    const k = this.strips.used++;
    const S = this.size;
    this.jobs.push({ layer: this.strips.layer, image, x: 0, y: (k * S) / 4, w: S, h: S / 4 });
    const r = { layer: this.strips.layer, remap: (u, v, out) => ((out[0] = u), (out[1] = (k + THREE.MathUtils.clamp(v, 0.002, 0.998)) / 4)) };
    this.keys.set(key, r);
    return r;
  }

  // Four square quads per layer (NPC atlases).
  quad(key, image) {
    if (this.keys.has(key)) return this.keys.get(key);
    if (!this.quads || this.quads.used === 4) this.quads = { layer: this.layers++, used: 0 };
    const k = this.quads.used++;
    const qx = k % 2;
    const qy = k >> 1;
    const S = this.size;
    this.jobs.push({ layer: this.quads.layer, image, x: (qx * S) / 2, y: (qy * S) / 2, w: S / 2, h: S / 2 });
    const r = {
      layer: this.quads.layer,
      remap: (u, v, out) => ((out[0] = (qx + THREE.MathUtils.clamp(u, 0.004, 0.996)) / 2), (out[1] = (qy + THREE.MathUtils.clamp(v, 0.004, 0.996)) / 2)),
    };
    this.keys.set(key, r);
    return r;
  }

  // Paints every job into one RGBA8 array. kind 'normalDetail': rgb from image, alpha = red of image2.
  build({ srgb, wrap, anisotropy }) {
    const S = this.size;
    const layers = Math.max(1, this.layers);
    const data = new Uint8Array(S * S * 4 * layers);
    const { ctx } = makeCanvas(S, S);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const read = (image, w, h) => {
      ctx.clearRect(0, 0, w, h);
      try {
        ctx.drawImage(image, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h).data;
      } catch (err) {
        console.warn('[traffic] texture read failed', err);
        return null;
      }
    };
    for (const job of this.jobs) {
      if (!job.image) continue;
      const px = read(job.image, job.w, job.h);
      if (!px) continue;
      let detail = null;
      if (job.image2) detail = read(job.image2, job.w, job.h);
      const base = job.layer * S * S * 4;
      for (let row = 0; row < job.h; row++) {
        const dst = base + ((job.y + row) * S + job.x) * 4;
        const src = row * job.w * 4;
        if (job.kind === 'normalDetail' || job.kind === 'normal') {
          for (let i = 0; i < job.w; i++) {
            const d = dst + i * 4;
            const s = src + i * 4;
            data[d] = px[s];
            data[d + 1] = px[s + 1];
            data[d + 2] = px[s + 2];
            data[d + 3] = detail ? detail[s] : 255;
          }
        } else data.set(px.subarray(src, src + job.w * 4), dst);
      }
    }
    const tex = new THREE.DataArrayTexture(data, S, S, layers);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = wrap;
    tex.anisotropy = anisotropy;
    tex.needsUpdate = true;
    // The pixels live on the GPU once uploaded; drop the CPU copy.
    tex.onUpdate = () => {
      tex.image.data = null;
      tex.onUpdate = null;
    };
    return tex;
  }
}

// ---- loading ---------------------------------------------------------------------------------------

function loaderFor(game) {
  if (game?.assets?.gltf) return game.assets;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const cache = new Map();
  return {
    gltf: (url) => {
      if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
      return cache.get(url);
    },
    json: (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  };
}

function materialInfo(mat, id) {
  return {
    id,
    color: mat.color ? mat.color.clone() : new THREE.Color(1, 1, 1),
    rough: mat.roughness ?? 0.6,
    metal: mat.metalness ?? 0,
    aLayer: NO_LAYER,
    nLayer: NO_LAYER,
  };
}

// Relative transform from `node` space into `ref` space (both already updateMatrixWorld'ed).
function relative(node, ref, out = new THREE.Matrix4()) {
  return out.copy(ref.matrixWorld).invert().multiply(node.matrixWorld);
}

export async function loadVehicleLibrary(game, opts = {}) {
  const assets = loaderFor(game);
  const texSize = opts.textureSize || 512;
  const albedo = new LayerSet(texSize);
  const normal = new LayerSet(texSize);
  const emissive = {};

  const manifest = (await assets.json('models/vehicles/manifest.json')) || { vehicles: {} };
  const files = await Promise.all(
    MODELS.map((name) =>
      Promise.all([assets.gltf(`models/vehicles/${name}.glb`), assets.gltf(`models/vehicles/${name}_lod1.glb`)]).catch((err) => {
        console.warn(`[traffic] vehicle model ${name} failed to load`, err);
        return null;
      }),
    ),
  );

  // Texture layers come from LOD0 (LOD1's textures are the same layouts at 256 px).
  const infoFor = (name, mat) => {
    const id = BY_NAME[mat.name];
    if (id === undefined) return null;
    const info = materialInfo(mat, id);
    if (mat.userData?.emissiveNight && emissive[mat.name] === undefined) emissive[mat.name] = mat.userData.emissiveNight;
    switch (mat.name) {
      case 'paint':
        info.color.setRGB(1, 1, 1);
        if (mat.normalMap?.image) {
          info.nLayer = normal.full(`paint:${name}`, mat.normalMap.image, { kind: 'normalDetail', image2: mat.map?.image }).layer;
        }
        break;
      case 'tyre':
        if (mat.normalMap?.image) info.nLayer = normal.full(`tyre:${mat.normalMap.name || name}`, mat.normalMap.image, { kind: 'normal' }).layer;
        break;
      case 'light_front':
      case 'light_rear':
      case 'indicator':
        if (mat.map?.image) info.aLayer = albedo.full('lamps', mat.map.image).layer;
        info.split = mat.name === 'indicator';
        break;
      case 'plate':
        if (mat.map?.image) {
          const s = albedo.strip(`plate:${name}`, mat.map.image);
          info.aLayer = s.layer;
          info.uvRemap = s.remap;
        }
        break;
      case 'livery':
        if (mat.map?.image) info.aLayer = albedo.full(`livery:${name}`, mat.map.image).layer;
        break;
      case 'interior':
        info.twoSided = true;
        break;
      default:
    }
    return info;
  };

  const models = {};
  const infoCache = new Map();
  for (let mi = 0; mi < MODELS.length; mi++) {
    const name = MODELS[mi];
    const pair = files[mi];
    if (!pair) continue;
    const meta = manifest.vehicles?.[name] || {};
    const lods = [];
    // LOD0 materials define the layers / factors; LOD1 meshes reuse them by material name.
    const lod0Infos = new Map();
    for (let lod = 0; lod < 2; lod++) {
      const root = pair[lod].scene.getObjectByName(name) || pair[lod].scene.children[0];
      root.updateMatrixWorld(true);
      const info = (mat) => {
        const key = `${name}:${mat.name}`;
        if (lod === 0 || !lod0Infos.has(mat.name)) {
          if (!infoCache.has(key)) infoCache.set(key, infoFor(name, mat));
          lod0Infos.set(mat.name, infoCache.get(key));
        }
        return lod0Infos.get(mat.name);
      };
      // Bakes the meshes under `node` into (opaque, glass) builders, relative to `ref`.
      const bake = (node, ref, opaque, glass, override = null) => {
        node.traverse((o) => {
          if (!o.isMesh) return;
          const m = relative(o, ref);
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          const groups = Array.isArray(o.material) && o.geometry.groups.length ? o.geometry.groups : null;
          if (groups) console.warn('[traffic] multi-material mesh not expected', o.name);
          const inf = info(mats[0]);
          if (!inf) return;
          if (inf.id === MAT.GLASS) glass?.addGeometry(o.geometry, m, inf);
          else opaque.addGeometry(o.geometry, m, override ? { ...inf, ...override(inf) } : inf);
        });
      };
      const body = new GeoBuilder();
      const bodyGlass = new GeoBuilder();
      const bodyNode = root.getObjectByName('body');
      if (bodyNode) bake(bodyNode, root, body, bodyGlass);
      const toggles = {};
      for (const o of root.children) {
        if (!o.userData?.toggle) continue;
        const b = new GeoBuilder();
        const gl = new GeoBuilder();
        // Bus destination displays are LEDs: they glow.
        const led = name === 'bus_zupco' && o.userData.toggle === 'dest';
        bake(o, root, b, gl, led ? (inf) => (inf.id === MAT.LIVERY ? { id: MAT.LED } : {}) : null);
        toggles[o.name] = {
          group: o.userData.toggle,
          defaultVisible: !!o.userData.default_visible,
          geometry: b.empty ? null : b.build(),
          glass: gl.empty ? null : gl.build(),
        };
      }
      const wheels = {};
      for (const key of ['wheel_fr', 'wheel_rr']) {
        const node = root.getObjectByName(key);
        if (!node) continue;
        const b = new GeoBuilder();
        bake(node, node, b, null);
        wheels[key === 'wheel_fr' ? 'front' : 'rear'] = b.build();
      }
      lods.push({ body: body.build(), glass: bodyGlass.empty ? null : bodyGlass.build(), toggles, wheels });
    }

    const root0 = pair[0].scene.getObjectByName(name) || pair[0].scene.children[0];
    const ud = root0.userData || {};
    let paints = meta.paints;
    if (!paints && typeof ud.paints === 'string') {
      try {
        paints = JSON.parse(ud.paints);
      } catch {
        paints = null;
      }
    }
    const dims = meta.dimensions_m || { length: ud.length_m || 4.4, width: ud.width_m || 1.7, height: ud.height_m || 1.5 };
    const bbox = meta.lod0?.bbox_m;
    const front = bbox ? -bbox.min[2] : dims.length / 2;
    const rear = bbox ? bbox.max[2] : dims.length / 2;
    const fz = meta.front_axle_z_m ?? -dims.length * 0.3;
    const rz = meta.rear_axle_z_m ?? dims.length * 0.3;
    const wheelPos = meta.wheels || {};
    const r = meta.wheel_radius_m || 0.3;
    const hub = (k, sx, z) => (wheelPos[k] ? wheelPos[k].slice() : [sx * (dims.width / 2 - 0.15), r, z]);
    models[name] = {
      key: name,
      title: meta.title || name,
      lods,
      paints: paints?.length ? paints : ['#eeeeea'],
      // Simulation dimensions: bumper to bumper (incl. push bars / hitches), body width and roof height.
      length: front + rear,
      front,
      rear,
      width: dims.width,
      height: dims.height,
      wheelRadius: r,
      steerMax: THREE.MathUtils.degToRad(meta.steer_max_deg || 35),
      frontAxleZ: fz,
      rearAxleZ: rz,
      // Arc distance from the front bumper back to the front axle, and between the axles.
      frontAxle: front + fz,
      wheelbase: rz - fz,
      // Axle midpoint ahead of the model origin (m): the origin sits axleMid behind it.
      axleMid: -(fz + rz) / 2,
      hubs: [hub('wheel_fl', -1, fz), hub('wheel_fr', 1, fz), hub('wheel_rl', -1, rz), hub('wheel_rr', 1, rz)],
      crew: CREW[name] || { driver: [0.37, 0.5, 0] },
      door: name === 'kombi' ? { x: CREW.kombi.door[0], z: CREW.kombi.door[1] } : null,
      toggleGroups: groupsOf(lods[0].toggles),
      toggleDefaults: Object.keys(lods[0].toggles).filter((k) => lods[0].toggles[k].defaultVisible),
    };
  }

  // Crew figures (optional: the traffic still drives without them).
  let figures = null;
  try {
    figures = await bakeFigures(assets, albedo, models, opts);
  } catch (err) {
    console.warn('[traffic] crew figures unavailable', err);
  }

  const anisotropy = opts.anisotropy ?? 4;
  const textures = {
    albedo: albedo.build({ srgb: true, wrap: THREE.ClampToEdgeWrapping, anisotropy }),
    normal: normal.build({ srgb: false, wrap: THREE.RepeatWrapping, anisotropy }),
  };
  return { models, figures, textures, emissive };
}

function groupsOf(toggles) {
  const out = {};
  for (const [node, t] of Object.entries(toggles)) (out[t.group] ||= []).push(node);
  for (const k in out) out[k].sort();
  return out;
}

// ---- crew figures ----------------------------------------------------------------------------------

async function bakeFigures(assets, albedo, models, opts) {
  const anim = await assets.gltf('models/anims/humans_anims.glb');
  let refHip = 0.973;
  anim.scene.traverse((o) => {
    if (o.userData?.hipHeight) refHip = o.userData.hipHeight;
  });
  const clips = new Map(anim.animations.map((c) => [c.name, c]));
  const variants = new Map();
  await Promise.all(
    CREW_NPCS.map(async (id) => {
      try {
        variants.set(id, await assets.gltf(`models/humans/npc_${id}_lod1.glb`));
      } catch (err) {
        console.warn(`[traffic] crew NPC ${id} missing`, err);
      }
    }),
  );
  if (!variants.size || !clips.get('drive')) return null;

  // Poses one NPC and returns its skinned triangles in figure space (pelvis at the origin, facing -Z),
  // plus the pelvis height above the soles.
  const posed = new Map();
  const pose = (id, clipName, time) => {
    const key = `${id}|${clipName}|${time}`;
    if (posed.has(key)) return posed.get(key);
    const gltf = variants.get(id);
    const clip0 = clips.get(clipName);
    if (!gltf || !clip0) return null;
    const scene = SkeletonUtils.clone(gltf.scene);
    let hip = refHip;
    scene.traverse((o) => {
      if (o.userData?.hipHeight) hip = o.userData.hipHeight;
    });
    const s = hip / refHip;
    const clip = clip0.clone();
    for (const t of clip.tracks) if (t.name.endsWith('.position')) for (let i = 0; i < t.values.length; i++) t.values[i] *= s;
    const mixer = new THREE.AnimationMixer(scene);
    mixer.clipAction(clip).play();
    mixer.setTime(time);
    scene.updateMatrixWorld(true);
    const meshes = [];
    let pelvis = null;
    scene.traverse((o) => {
      if (o.isSkinnedMesh) meshes.push(o);
      if (o.isBone && o.name === 'pelvis') pelvis = o;
    });
    const origin = pelvis ? pelvis.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, hip, 0);
    const out = { meshes: [], minY: Infinity, pelvisY: origin.y };
    for (const mesh of meshes) {
      const g = mesh.geometry;
      const P = g.attributes.position;
      const N = g.attributes.normal;
      const SI = g.attributes.skinIndex;
      const SW = g.attributes.skinWeight;
      const bones = mesh.skeleton.bones;
      const inv = mesh.skeleton.boneInverses;
      const legs = new Set(LEG_BONES.map((b) => bones.findIndex((x) => x.name === b)).filter((i) => i >= 0));
      const pos = new Float32Array(P.count * 3);
      const nrm = new Float32Array(P.count * 3);
      const leg = new Uint8Array(P.count);
      const idx = new THREE.Vector4();
      const wt = new THREE.Vector4();
      const blend = new THREE.Matrix4();
      const world = new THREE.Matrix4();
      const nmat = new THREE.Matrix3();
      for (let i = 0; i < P.count; i++) {
        idx.fromBufferAttribute(SI, i);
        wt.fromBufferAttribute(SW, i);
        blend.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        let legW = 0;
        for (let k = 0; k < 4; k++) {
          const w = wt.getComponent(k);
          if (!w) continue;
          const bi = idx.getComponent(k);
          _m.multiplyMatrices(bones[bi].matrixWorld, inv[bi]);
          const e = blend.elements;
          const f = _m.elements;
          for (let q = 0; q < 16; q++) e[q] += f[q] * w;
          if (legs.has(bi)) legW += w;
        }
        // mesh space -> world: matrixWorld * bindMatrixInverse * blend * bindMatrix
        world.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse).multiply(blend).multiply(mesh.bindMatrix);
        _v.fromBufferAttribute(P, i).applyMatrix4(world);
        nmat.getNormalMatrix(world);
        _n.fromBufferAttribute(N, i).applyMatrix3(nmat).normalize();
        pos[i * 3] = _v.x - origin.x;
        pos[i * 3 + 1] = _v.y - origin.y;
        pos[i * 3 + 2] = _v.z - origin.z;
        nrm[i * 3] = _n.x;
        nrm[i * 3 + 1] = _n.y;
        nrm[i * 3 + 2] = _n.z;
        leg[i] = legW > 0.5 ? 1 : 0;
        out.minY = Math.min(out.minY, _v.y);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      if (g.attributes.uv) geo.setAttribute('uv', g.attributes.uv);
      geo.setIndex(g.index);
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      out.meshes.push({ geo, mat, leg });
    }
    out.minY -= origin.y;
    mixer.stopAllAction();
    posed.set(key, out);
    return out;
  };

  const figInfo = (id, mat) => {
    const info = materialInfo(mat, MAT.FIGURE);
    info.rough = Math.max(0.6, info.rough);
    info.metal = 0;
    if (mat.map?.image) {
      const q = albedo.quad(`npc:${id}`, mat.map.image);
      info.aLayer = q.layer;
      info.uvRemap = q.remap;
    }
    return info;
  };

  // Adds a posed figure to builder b, pelvis at `at` (vehicle / figure space), turned by yaw.
  const place = (b, id, clipName, time, at, yaw = 0, seated = true) => {
    const p = pose(id, clipName, time);
    if (!p) return null;
    _m2.makeRotationY(yaw).setPosition(at[0], at[1], at[2]);
    for (const part of p.meshes) {
      const info = figInfo(id, part.mat);
      b.addGeometry(part.geo, _m2, info, seated ? (i) => !part.leg[i] : null);
    }
    return p;
  };

  const single = (id, clipName, time, seated) => {
    const b = new GeoBuilder();
    const p = place(b, id, clipName, time, [0, 0, 0], 0, seated);
    if (!p || b.empty) return null;
    return { geometry: b.build(), pelvisY: -p.minY };
  };

  const figures = { drivers: [], mates: [], kombiPassengers: [], busPassengers: [], hwindiLean: [], hwindiKerb: [], busDriver: null };
  for (const id of DRIVERS) {
    const f = single(id, 'drive', 0, true);
    if (f) figures.drivers.push(f);
  }
  figures.busDriver = single(BUS_DRIVER, 'drive', 0.5, true) || figures.drivers[0] || null;
  for (const [id, t] of [['woman_casual_tee', 0], ['man_tshirt_jeans_cap', 0.6], ['woman_dress_bright', 1.1]]) {
    const f = single(id, 'sit_idle', t, true);
    if (f) figures.mates.push(f);
  }
  // Hwindi: leaning out of the sliding door window, beckoning (two frames), or standing on the kerb
  // waving (three frames); the renderer steps through the frames.
  const leanDur = clips.get('call_out')?.duration || 2.5;
  for (const t of [0.15, 0.45 * leanDur]) {
    // (lower legs dropped: they are behind the door)
    const f = single(HWINDI, clips.has('call_out') ? 'call_out' : 'idle', t, true);
    if (f) figures.hwindiLean.push(f);
  }
  const waveDur = clips.get('wave')?.duration || 2.5;
  for (const t of [0.1, 0.35 * waveDur, 0.65 * waveDur]) {
    const f = single(HWINDI, clips.has('wave') ? 'wave' : 'idle', t, false);
    if (f) figures.hwindiKerb.push(f);
  }
  // Passenger blocks: several seated people baked together in vehicle space.
  const riders = CREW_NPCS.filter((id) => id !== HWINDI);
  const block = (seats, seed, fill, clip) => {
    const b = new GeoBuilder();
    let k = seed;
    for (let i = 0; i < seats.length; i++) {
      if (((i * 7 + seed * 3) % 10) / 10 >= fill) continue;
      const id = riders[k++ % riders.length];
      const t = ((i * 0.37 + seed * 0.21) % 1) * (clips.get(clip)?.duration || 1.6);
      place(b, id, clip, t, seats[i], ((i + seed) % 3 - 1) * 0.12, true);
    }
    return b.empty ? null : b.build();
  };
  if (models.kombi) {
    for (let s = 0; s < 3; s++) {
      const g = block(KOMBI_SEATS, s, 0.62, s === 1 ? 'sit_talk' : 'sit_idle');
      if (g) figures.kombiPassengers.push(g);
    }
  }
  if (models.bus_zupco) {
    for (let s = 0; s < 2; s++) {
      const g = block(BUS_SEATS, s + 4, 0.7, 'sit_idle');
      if (g) figures.busPassengers.push(g);
    }
  }
  return figures;
}
