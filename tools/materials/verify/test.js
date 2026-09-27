import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const Q = new URLSearchParams(location.search);
const SCENE = Q.get('scene') || 'board';
const BASE = '/repo/public/';
const W = Number(Q.get('w') || 1600);
const H = Number(Q.get('h') || 900);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(Q.get('exposure') || 1.0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 500);
const manager = new THREE.LoadingManager();
const texLoader = new THREE.TextureLoader(manager);
const gltfLoader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
window.__errors = [];
manager.onError = (u) => window.__errors.push('load ' + u);

// ---------------------------------------------------------------- environment
const pmrem = new THREE.PMREMGenerator(renderer);
const hdr = await new HDRLoader().loadAsync(BASE + 'textures/env/harare_day_ibl_1k.hdr');
hdr.mapping = THREE.EquirectangularReflectionMapping;
const envRT = pmrem.fromEquirectangular(hdr);
scene.environment = envRT.texture;
scene.environmentIntensity = Number(Q.get('env') || 1.0);
scene.background = Q.get('bg') === 'sky' ? hdr : new THREE.Color(0x9fb4c8);
scene.backgroundBlurriness = 0.0;

const sun = new THREE.DirectionalLight(0xfff1dd, Number(Q.get('sun') || 2.6));
sun.position.set(-20, 30, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30; sun.shadow.camera.right = 30; sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

// ---------------------------------------------------------------- helpers
const MATS = await (await fetch(BASE + 'textures/materials.json')).json();
const byName = Object.fromEntries(MATS.materials.map((m) => [m.name, m]));

function tex(file, srgb, rx, ry) {
  const t = texLoader.load(BASE + 'textures/' + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.repeat.set(rx, ry);
  return t;
}

export function pbr(name, sw, sh, extra = {}) {
  const e = byName[name];
  const rx = sw / e.tileSizeMetres[0];
  const ry = sh / e.tileSizeMetres[1];
  const orm = tex(e.files.orm, false, rx, ry);
  return new THREE.MeshStandardMaterial({
    map: tex(e.files.albedo, true, rx, ry), normalMap: tex(e.files.normal, false, rx, ry),
    aoMap: orm, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, ...extra,
  });
}

function label(text, size = 0.22, color = '#fff') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, 512, 64);
  g.fillStyle = color; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 8, size), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
  return m;
}

// ---------------------------------------------------------------- scenes
async function board() {
  const names = MATS.materials.map((m) => m.name).filter((n) => !Q.get('filter') || n.includes(Q.get('filter')));
  const cols = Number(Q.get('cols') || 8);
  const S = 2.4; // each swatch is 2.4 x 2.4 m of surface
  const gap = 0.35;
  const rows = Math.ceil(names.length / cols);
  names.forEach((n, i) => {
    const e = byName[n];
    const c = i % cols;
    const r = Math.floor(i / cols);
    let mat;
    if (e.category === 'glass') {
      const t = tex(e.files.orm, false, S / 3, S / 3);
      mat = new THREE.MeshStandardMaterial({ color: 0x3a5560, roughnessMap: t, roughness: 1, metalness: 0,
        normalMap: tex(e.files.normal, false, S / 3, S / 3) });
    } else {
      mat = pbr(n, S, S);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(S, S), mat);
    m.position.set((c - (cols - 1) / 2) * (S + gap), (rows - 1 - r) * (S + gap + 0.3) + 1.6, 0);
    scene.add(m);
    const l = label(n, 0.22);
    l.position.set(m.position.x, m.position.y - S / 2 - 0.2, 0.01);
    scene.add(l);
  });
  const w = cols * (S + gap);
  const h = rows * (S + gap + 0.3);
  camera.fov = 30;
  const dist = Math.max(h / 2 / Math.tan(THREE.MathUtils.degToRad(15)), w / 2 / Math.tan(THREE.MathUtils.degToRad(15)) / camera.aspect) * 1.02;
  camera.position.set(0, h / 2 + 0.2, dist);
  camera.lookAt(0, h / 2 + 0.2, 0);
  camera.updateProjectionMatrix();
  const sp = (Q.get('sunpos') || '-40,50,25').split(',').map(Number);
  sun.position.set(sp[0], sp[1], sp[2]);
  sun.castShadow = false;
}

async function props(which) {
  const man = await (await fetch(BASE + 'models/props/props.json')).json();
  let list = man.props.filter((p) => (which === 'tall' ? p.height > 2.0 : p.height <= 2.0));
  if (Q.get('part')) {
    const half = Math.ceil(list.length / 2);
    list = Q.get('part') === '1' ? list.slice(0, half) : list.slice(half);
  }
  if (Q.get('only')) list = man.props.filter((p) => Q.get('only').split(',').includes(p.name));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), pbr('pavement_slabs', 60, 30));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  let x = 0;
  const lod = Q.get('lod') === '1';
  const loads = list.map((p) => gltfLoader.loadAsync(BASE + 'models/props/' + (lod ? p.lod1 : p.file)).then((g) => ({ p, g })));
  const res = await Promise.all(loads);
  const gapX = which === 'tall' ? 1.2 : 0.35;
  const xs = [];
  for (const { p } of res) {
    const w = Math.max(p.extent[0], 0.3);
    xs.push(x + w / 2);
    x += w + gapX;
  }
  const off = x / 2;
  res.forEach(({ p, g }, i) => {
    const o = g.scene;
    o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    o.position.set(xs[i] - off, 0, 0);
    scene.add(o);
    const l = label(p.name, which === 'tall' ? 0.3 : 0.12);
    l.position.set(xs[i] - off, 0.02, 1.3 + (i % 2) * (which === 'tall' ? 0.45 : 0.2));
    l.rotation.x = -Math.PI / 2 + 0.6;
    scene.add(l);
    for (const a of p.anchors || []) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.08), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
      s.position.set(xs[i] - off + a[0], a[1], a[2]);
      scene.add(s);
    }
  });
  // 1.75 m reference person
  const ref = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.31, 4, 12), new THREE.MeshStandardMaterial({ color: 0xd04040, roughness: 0.6 }));
  ref.position.set(-off - 0.8, 0.875, 0);
  ref.castShadow = true;
  scene.add(ref);
  window.__stats = res.map(({ p, g }) => {
    let tris = 0;
    g.scene.traverse((m) => { if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
    const box = new THREE.Box3().setFromObject(g.scene);
    return { name: p.name, tris, min: box.min.toArray().map((v) => +v.toFixed(2)), max: box.max.toArray().map((v) => +v.toFixed(2)) };
  });
  const span = x;
  if (which === 'tall') {
    camera.fov = 40;
    camera.position.set(0, 6.5, span * 0.62 + 6);
    camera.lookAt(0, 4.2, 0);
  } else {
    camera.fov = 30;
    const hf = Math.atan(Math.tan(THREE.MathUtils.degToRad(15)) * camera.aspect);
    const d = (span / 2) / Math.tan(hf) * 1.02;
    camera.position.set(0, d * 0.35, d);
    camera.lookAt(0, 0.35, 0);
  }
  camera.updateProjectionMatrix();
  sun.shadow.camera.left = -span; sun.shadow.camera.right = span;
  sun.shadow.camera.updateProjectionMatrix();
}

async function hdriCheck() {
  const g = new THREE.SphereGeometry(0.8, 64, 32);
  [[1, 0.02], [1, 0.3], [0, 0.05], [0, 0.5], [0, 1]].forEach(([m, r], i) => {
    const s = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: m ? 0xffffff : 0xb0b0b0, metalness: m, roughness: r }));
    s.position.set((i - 2) * 2, 1, 0);
    s.castShadow = true;
    scene.add(s);
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), pbr('asphalt_bleached', 40, 40));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  camera.position.set(0, 2.2, 7.5);
  camera.lookAt(0, 0.9, 0);
  scene.background = hdr;
}

if (SCENE === 'board') await board();
else if (SCENE === 'props' || SCENE === 'tall') await props(SCENE === 'props' ? 'small' : 'tall');
else if (SCENE === 'hdri') await hdriCheck();
else if (SCENE === 'street') await (await import('./street.js')).street({ THREE, scene, camera, pbr, byName, tex, texLoader, sun, BASE, Q, renderer });

if (Q.get('orbit')) new OrbitControls(camera, renderer.domElement);
await new Promise((r) => { if (manager.itemsLoaded >= manager.itemsTotal) r(); manager.onLoad = r; setTimeout(r, 20000); });
renderer.render(scene, camera);
await new Promise((r) => setTimeout(r, 300));
renderer.render(scene, camera);
window.__info = renderer.info.render;
window.__done = true;
if (Q.get('orbit')) renderer.setAnimationLoop(() => renderer.render(scene, camera));
