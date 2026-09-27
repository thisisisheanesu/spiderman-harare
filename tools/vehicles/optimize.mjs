// Compress the raw Blender exports into game assets: material fix-ups, WebP textures, meshopt geometry.
//
//   node tools/vehicles/optimize.mjs <rawDir> <outDir> [names...]
//
// Needs @gltf-transform/core, /extensions, /functions, meshoptimizer and sharp: `npm i` them in any scratch
// directory and point VEH_NODE at it (VEH_NODE=/tmp/veh-node node tools/vehicles/optimize.mjs ...).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// VEH_NODE = a directory whose node_modules has the tools (default: current directory)
const base = process.env.VEH_NODE || process.cwd();
const require = createRequire(path.join(base, 'package.json'));
const imp = (m) => import(pathToFileURL(require.resolve(m)).href);
const { NodeIO, PropertyType } = await imp('@gltf-transform/core');
const { ALL_EXTENSIONS } = await imp('@gltf-transform/extensions');
const F = await imp('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder } = await imp('meshoptimizer');
const sharp = (await imp('sharp')).default;

const [rawDir, outDir, ...only] = process.argv.slice(2);
if (!rawDir || !outDir) {
  console.error('usage: node optimize.mjs <rawDir> <outDir> [names...]');
  process.exit(1);
}
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// Night emissive for lamp materials. Exported emissiveFactor is 0 (daytime look); the game sets
// material.emissive to this colour (or emissiveIntensity) at night / when braking / indicating.
const NIGHT = {
  light_front: [1, 0.97, 0.9],
  light_rear: [1, 0.2, 0.15],
  indicator: [1, 0.6, 0.1],
  beacon_blue: [0.1, 0.3, 1],
  beacon_red: [1, 0.1, 0.05],
};

const files = fs.readdirSync(rawDir).filter((f) => f.endsWith('.glb'))
  .filter((f) => !only.length || only.includes(f.replace(/(_lod1)?\.glb$/, '')));
fs.mkdirSync(outDir, { recursive: true });
const report = {};
for (const f of files) {
  const lod1 = f.endsWith('_lod1.glb');
  const doc = await io.read(path.join(rawDir, f));
  const root = doc.getRoot();
  for (const m of root.listMaterials()) {
    const n = m.getName();
    const ex = { ...(m.getExtras() || {}) };
    if (n === 'glass') {
      m.setAlphaMode('BLEND');
      m.setDoubleSided(false);
    } else if (n === 'livery') {
      m.setAlphaMode('MASK');
      m.setAlphaCutoff(0.5);
      m.setDoubleSided(false);
    } else if (n === 'interior') {
      m.setDoubleSided(true);
      m.setAlphaMode('OPAQUE');
    } else {
      m.setAlphaMode('OPAQUE');
    }
    if (NIGHT[n]) {
      ex.emissiveNight = NIGHT[n];
      m.setEmissiveFactor([0, 0, 0]);
    }
    if (n === 'paint') ex.tintable = true;
    m.setExtras(ex);
  }
  await doc.transform(
    // never merge materials: their names are the integration contract (indicator == light_rear otherwise)
    F.dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
    F.prune({ keepLeaves: false, keepAttributes: false, keepExtras: true }),
    F.weld(),
    F.textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: lod1 ? [256, 256] : [1024, 1024],
      quality: 82,
      effort: 70,
    }),
    F.meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = path.join(outDir, f);
  await io.write(out, doc);
  const size = fs.statSync(out).size;
  let tris = 0;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() || 0) / 3;
  report[f] = { bytes: size, kb: +(size / 1024).toFixed(1), unique_tris: tris };
  console.log(f, report[f]);
}
fs.writeFileSync(path.join(rawDir, 'optimize_report.json'), JSON.stringify(report, null, 1));

// manifest.json: one entry per vehicle, read back from the written files (root-node extras, wheel pivots,
// toggle nodes, materials, triangle counts, sizes) so the game can size/place vehicles without loading them.
const manifest = { version: 1, units: 'metres', forward: '-Z', up: '+Y', vehicles: {} };
const outFiles = fs.readdirSync(outDir).filter((f) => f.endsWith('.glb')).sort();
for (const f of outFiles) {
  const lod1 = f.endsWith('_lod1.glb');
  const key = f.replace(/(_lod1)?\.glb$/, '');
  const doc = await io.read(path.join(outDir, f));
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const top = scene.listChildren()[0];
  const entry = manifest.vehicles[key] || (manifest.vehicles[key] = {});
  let tris = 0;
  const rendered = (node, acc) => {
    const mesh = node.getMesh();
    if (mesh) for (const p of mesh.listPrimitives()) acc.t += (p.getIndices()?.getCount() || 0) / 3;
    for (const c of node.listChildren()) rendered(c, acc);
    return acc;
  };
  tris = rendered(top, { t: 0 }).t;
  const toggles = {};
  const wheels = {};
  let bodyTris = 0;
  for (const n of top.listChildren()) {
    const ex = n.getExtras() || {};
    if (ex.toggle) toggles[n.getName()] = { group: ex.toggle, default_visible: !!ex.default_visible, tris: rendered(n, { t: 0 }).t };
    if (/^wheel_(f|r)(l|r)$/.test(n.getName())) wheels[n.getName()] = n.getTranslation().map((v) => +v.toFixed(4));
    if (n.getName() === 'body') bodyTris = rendered(n, { t: 0 }).t;
  }
  const togTris = Object.values(toggles).reduce((a, t) => a + t.tris, 0);
  const lod = {
    file: f,
    bytes: fs.statSync(path.join(outDir, f)).size,
    tris_total_all_nodes: tris,
    tris_body: bodyTris,
    tris_default_view: tris - togTris + Object.values(toggles).filter((t) => t.default_visible).reduce((a, t) => a + t.tris, 0),
  };
  // materials actually present in this file (LOD1 drops e.g. chrome on some models)
  lod.materials = root.listMaterials().map((m) => m.getName()).sort();
  if (lod1) entry.lod1 = lod;
  else {
    const ex = top.getExtras() || {};
    Object.assign(entry, {
      title: ex.title, real_model: ex.real_model,
      dimensions_m: { length: ex.length_m, width: ex.width_m, height: ex.height_m, wheelbase: ex.wheelbase_m,
        track_front: ex.track_front_m, track_rear: ex.track_rear_m },
      wheel_radius_m: ex.wheel_radius_m, front_axle_z_m: ex.front_axle_z_m, rear_axle_z_m: ex.rear_axle_z_m,
      steer_max_deg: ex.steer_max_deg,
      paints: (() => { try { return JSON.parse(ex.paints); } catch { return ex.paints; } })(),
      livery: ex.livery,
      materials: root.listMaterials().map((m) => m.getName()).sort(),   // LOD0 set; per-LOD list in lod0/lod1.materials
      wheels, toggles,
    });
    entry.lod0 = lod;
  }
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('manifest', Object.keys(manifest.vehicles).length, 'vehicles');
