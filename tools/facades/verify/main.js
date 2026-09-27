// Facade kit verification page (headless, SwiftShader). Scenes (URL query):
//   scene=lineup&type=brick[&lod=1]                 every module of a type, LOD0 (or LOD1 atlas quads) + impostor strip
//   scene=building&ids=2200,2190&types=2200:brick   real footprints / heights from public/data/harare.json
//        &view=street|roof|far|cam  [&cam=x,y,z&look=x,y,z&fov=50] [&lod=0|1|2] [&radius=90 auto-types neighbours]
//   night=1  time of day at night (lit windows)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FacadeKit } from '/repo/tools/facades/kit_builder.js';

const Q = Object.fromEntries(new URLSearchParams(location.search));
const W = Number(Q.w || 960);
const H = Number(Q.h || 540);
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(Q.exposure || 1.0);
renderer.shadowMap.enabled = Q.shadows !== '0';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(Number(Q.fov || 55), W / H, 0.3, 3000);

async function setupLights(center, radius) {
  const night = Q.night === '1';
  scene.background = new THREE.Color(night ? 0x0b1020 : 0x9fb9d6);
  scene.fog = new THREE.Fog(scene.background, radius * 3, radius * 9);
  const hdr = await new HDRLoader().loadAsync('/repo/public/textures/env/harare_day_ibl_1k.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = night ? 0.05 : 0.9;
  const hemi = new THREE.HemisphereLight(0xbcd3ee, 0x8a7c68, night ? 0.05 : 0.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(night ? 0x8090b0 : 0xfff1dc, night ? 0.08 : 3.0);
  const az = Number(Q.sunaz ?? 35) * Math.PI / 180; // degrees from north towards east (sun is in the north in Harare)
  const el = Number(Q.sunel ?? 55) * Math.PI / 180;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  sun.position.copy(center).addScaledVector(dir, radius * 2 + 50);
  sun.target.position.copy(center);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(2048, 2048);
  const r = radius * 1.2;
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: radius * 5 + 200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
}

function ground(center, size, texBase) {
  const tl = new THREE.TextureLoader();
  const t = (f, srgb) => {
    const x = tl.load(texBase + f);
    x.wrapS = x.wrapT = THREE.RepeatWrapping;
    x.repeat.set(size / 1.8, size / 1.8);
    x.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    x.anisotropy = 8;
    return x;
  };
  const mat = new THREE.MeshStandardMaterial({ map: t('paving/pavement_slabs_albedo.webp', true), normalMap: t('paving/pavement_slabs_normal.webp'),
    roughnessMap: t('paving/pavement_slabs_orm.webp'), roughness: 1, color: 0xd8d4cc });
  const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  g.rotation.x = -Math.PI / 2;
  g.position.set(center.x, 0, center.z);
  g.receiveShadow = true;
  scene.add(g);
}

// rough automatic type choice for context buildings (the city will make its own choice)
function autoType(b) {
  const h = b.h;
  const r = (b.id * 2654435761 >>> 0) / 4294967296;
  if (h >= 55) return r < 0.5 ? 'curtain' : 'glassgranite';
  if (h >= 20) return ['ribbon', 'fins', 'eggcrate', 'brick', 'ribbon', 'brick'][Math.floor(r * 6)];
  if (h >= 9) return ['brick', 'deco', 'avenues', 'ribbon', 'deco'][Math.floor(r * 5)];
  return ['colonial', 'deco', 'colonial', 'brick'][Math.floor(r * 4)];
}

function flatRoof(b, mat) {
  const pts = [];
  for (let i = 0; i < b.fp.length; i += 2) pts.push(new THREE.Vector2(b.fp[i], -b.fp[i + 1]));
  const shape = new THREE.Shape(pts);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = b.h - 0.6;
  m.receiveShadow = true;
  return m;
}

async function main() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const texBase = '/repo/public/textures/';
  const kit = await FacadeKit.load({ base: '/repo/public/models/facades/', textures: texBase, gltfLoader: loader, renderer });
  window.__info = { stats: [] };
  const lod = Q.lod !== undefined ? Number(Q.lod) : -1;
  const pickLevel = (b) => (lod === 0 ? b.lod0 : lod === 1 ? b.lod1 : lod === 2 ? b.lod2 : b.lod);
  // generic shop-sign atlas (4 x 4 boards) for the sign role
  const sc = document.createElement('canvas');
  sc.width = 1024;
  sc.height = 512;
  const cx = sc.getContext('2d');
  const names = ['CASH & CARRY', 'PHARMACY', 'BOUTIQUE', 'HARDWARE', 'BUTCHERY', 'CELL SHOP', 'SUPERMARKET', 'SALON',
    'FURNISHERS', 'BAKERY', 'WHOLESALERS', 'OUTFITTERS', 'OPTICIANS', 'TAKEAWAY', 'BANK', 'SHOES'];
  const cols = [['#c8201e', '#ffffff'], ['#f2c21a', '#1b1b1b'], ['#1f6e3a', '#ffffff'], ['#1d4f9a', '#ffffff'], ['#f4f1e8', '#b01818'], ['#222222', '#f2c21a']];
  names.forEach((n, i) => {
    const x = (i % 4) * 256;
    const y = Math.floor(i / 4) * 128;
    const [bg, fg] = cols[i % cols.length];
    cx.fillStyle = bg;
    cx.fillRect(x, y, 256, 128);
    cx.fillStyle = fg;
    cx.font = 'bold 34px sans-serif';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText(n, x + 128, y + 64, 236);
  });
  const signTex = new THREE.CanvasTexture(sc);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.flipY = false;
  const signMaterial = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.55, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: Q.night === '1' ? 0.5 : 0 });
  const signOpts = { signMaterial, signAtlas: { cols: 4, rows: 4 } };
  if (Q.night === '1') kit.setNight(1);

  if ((Q.scene || 'lineup') === 'lineup') {
    const t = Q.type || 'brick';
    const T = kit.json.types[t];
    let x = 0;
    const group = new THREE.Group();
    const add = (src, key, level) => {
      const mod = kit.modules[src][key];
      const parts = level === 1 ? mod.lod1 : mod.lod0;
      if (!parts) return;
      // reuse the building assembler on a 1-edge "footprint" would stretch; draw the raw module instead
      for (const p of parts) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(p.nrm, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2));
        g.setIndex(p.index);
        let mat;
        if (p.role === 'atlas') {
          mat = kit.atlasMaterial(t, 'atlas');
          const n = p.count;
          for (let k = 0; k < 3; k++) g.setAttribute('aTint' + k, new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
          g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(n), 1));
        } else if (p.role === 'glass') {
          const n = p.count;
          const wu = new Float32Array(n * 2);
          const wd = new Float32Array(n * 4);
          for (let i = 0; i < n; i++) {
            const room = Math.floor(p.uv1[i * 2] / 2 + 1e-4);
            wu[i * 2] = p.uv1[i * 2] - room * 2;
            wu[i * 2 + 1] = p.uv1[i * 2 + 1];
            wd.set([mod.meta.interior === 'shop' ? 4 + (x | 0) % 4 : (x | 0) % 2, 0, 1, T.roomDepth], i * 4);
          }
          g.setAttribute('winUv', new THREE.BufferAttribute(wu, 2));
          g.setAttribute('winData', new THREE.BufferAttribute(wd, 4));
          mat = kit.glassMaterial(T.materials.glass.tint);
        } else if (T.materials[p.role] || kit.json.common.materials[p.role]) {
          if (p.role === 'sign' || p.role === 'glass_spandrel') mat = new THREE.MeshStandardMaterial({ color: p.role === 'sign' ? 0xe6e2d6 : 0x223344, roughness: 0.2 });
          else {
            const info = T.materials[p.role] || kit.json.common.materials[p.role];
            mat = kit.pbrMaterial(info.pbr, { metal: p.role === 'frame' || p.role === 'metal' ? 0.35 : 1 });
            const f = kit.roleFactor(t, p.role, {});
            g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.count * 3).map((_, i) => f[i % 3]), 3));
          }
        } else mat = p.material;
        const m = new THREE.Mesh(g, mat);
        m.castShadow = m.receiveShadow = true;
        m.position.x = x;
        group.add(m);
      }
      x += (mod.meta.width || 0.6) + 0.9;
    };
    const level = lod === 1 ? 1 : 0;
    for (const key of Object.keys(kit.modules[t])) add(t, key, level);
    if (Q.common === '1') for (const key of Object.keys(kit.modules.common)) add('common', key, level);
    scene.add(group);
    // impostor strip: a 4-bay x 6-floor wall
    const fp = [x + 1, 0, x + 1 + 4 * T.bay, 0, x + 1 + 4 * T.bay, -8, x + 1, -8];
    const b = kit.build(fp, T.groundFloor + 4 * T.floor + T.cap, { type: t, seed: 7, ...signOpts });
    const imp = lod === 1 ? b.lod1 : lod === 2 ? b.lod2 : b.lod0;
    scene.add(imp);
    window.__info.stats.push(b.stats);
    const cx = (x + 4 * T.bay) / 2;
    const center = new THREE.Vector3(cx, 4, 0);
    await setupLights(center, x / 2 + 20);
    ground(center, 400, texBase);
    camera.position.set(cx - 2, Number(Q.camy || 6), Number(Q.dist || x * 0.72 + 6));
    camera.lookAt(cx, 4.5, 0);
  } else {
    const data = await (await fetch('/repo/public/data/harare.json')).json();
    const byId = new Map(data.buildings.map((b) => [b.id, b]));
    const ids = (Q.ids || '2200').split(',').map(Number);
    const forced = Object.fromEntries((Q.types || '').split(',').filter(Boolean).map((s) => s.split(':')).map(([a, b]) => [Number(a), b]));
    // spec = {"<id>": {type, h, middle, ground, materials, tints, canopy, verandah}} per-building overrides
    const spec = Q.spec ? JSON.parse(Q.spec) : {};
    const main = ids.map((i) => byId.get(i));
    const c = new THREE.Vector3();
    for (const b of main) {
      for (let i = 0; i < b.fp.length; i += 2) c.add(new THREE.Vector3(b.fp[i], 0, b.fp[i + 1]));
    }
    c.divideScalar(main.reduce((s, b) => s + b.fp.length / 2, 0));
    const radius = Number(Q.radius || 0);
    const list = [...main];
    if (radius > 0) {
      for (const b of data.buildings) {
        if (ids.includes(b.id) || b.minH) continue;
        const bx = b.fp[0];
        const bz = b.fp[1];
        if (Math.hypot(bx - c.x, bz - c.z) < radius) list.push(b);
      }
    }
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.9 });
    for (const b of list) {
      const sp = spec[b.id] || {};
      const type = sp.type || forced[b.id] || (ids.includes(b.id) ? Q.type : null) || autoType(b);
      if (sp.h) b.h = sp.h;
      const built = kit.build(b.fp, b.h, { type, seed: b.id, closedShops: Q.night === '1' ? 0.7 : 0.12, ...signOpts, ...sp });
      scene.add(pickLevel(built));
      scene.add(flatRoof(b, roofMat));
      window.__info.stats.push({ id: b.id, name: b.name, type, h: b.h, ...built.stats, plan: built.plan });
    }
    await setupLights(c, 120);
    ground(c, 800, texBase);
    // camera
    const b0 = main[0];
    if (Q.cam) {
      const [x, y, z] = Q.cam.split(',').map(Number);
      const [lx, ly, lz] = (Q.look || `${c.x},${b0.h / 2},${c.z}`).split(',').map(Number);
      camera.position.set(x, y, z);
      camera.lookAt(lx, ly, lz);
    } else {
      // face the longest edge of the first building
      let best = null;
      for (let i = 0; i < b0.fp.length; i += 2) {
        const j = (i + 2) % b0.fp.length;
        const L = Math.hypot(b0.fp[j] - b0.fp[i], b0.fp[j + 1] - b0.fp[i + 1]);
        if (!best || L > best.L) best = { L, a: [b0.fp[i], b0.fp[i + 1]], b: [b0.fp[j], b0.fp[j + 1]] };
      }
      const mx = (best.a[0] + best.b[0]) / 2;
      const mz = (best.a[1] + best.b[1]) / 2;
      let nx = -(best.b[1] - best.a[1]) / best.L;
      let nz = (best.b[0] - best.a[0]) / best.L;
      // outward = away from the centroid
      if ((mx - c.x) * nx + (mz - c.z) * nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const view = Q.view || 'street';
      const d = view === 'street' ? 22 : view === 'roof' ? 45 : 180;
      const y = view === 'street' ? 1.7 : view === 'roof' ? b0.h + 6 : b0.h * 0.9 + 30;
      const side = Number(Q.side || 0.45);
      camera.position.set(mx + nx * d + (best.b[0] - best.a[0]) / best.L * d * side, y, mz + nz * d + (best.b[1] - best.a[1]) / best.L * d * side);
      camera.lookAt(mx, view === 'street' ? Math.min(b0.h * 0.45, 14) : b0.h * 0.5, mz);
    }
  }
  // wait until every texture used by the scene has its image
  const pending = () => {
    let n = 0;
    scene.traverse((o) => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) {
        for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) if (m[k] && !m[k].image) n++;
        if (m.userData.uniforms && !m.userData.uniforms.uMask.value.image) n++;
        if (m.userData.interior && !m.userData.interior.uAtlas.value.image) n++;
      }
    });
    return n;
  };
  for (let i = 0; i < 300 && pending() > 0; i++) await new Promise((r) => setTimeout(r, 200));
  window.__info.pendingTextures = pending();
  renderer.render(scene, camera);
  await new Promise((r) => setTimeout(r, 300));
  await new Promise((r) => setTimeout(r, 500));
  renderer.render(scene, camera);
  window.__info.render = renderer.info.render;
  window.__done = true;
}

main().catch((e) => {
  window.__errors.push(String(e.stack || e));
  window.__done = true;
});
