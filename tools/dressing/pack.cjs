#!/usr/bin/env node
/* Pack Blender intermediates into game-ready files in public/models/dressing/ and (re)write dressing.json.
 *
 *   NODE_PATH=<dir>/node_modules node tools/dressing/pack.cjs [names...]
 *
 * Needs (outside the repo): @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4
 * meshoptimizer sharp.  Input: $DRESSING_WORK/<name>/{lod0.glb, lod1.glb, meta.json[, imp.png, imp_n.png]}.
 * Item metadata that is not measured (attach rule, tags, front axis, notes, source) comes from
 * tools/dressing/items.json and trees.json; measured values (height, radius, tris, bytes) from meta.json.
 *
 * Geometry: welded, reordered, EXT_meshopt_compression (FILTER). POSITION / TEXCOORD stay float32 (drop the
 * geometry straight into an InstancedMesh, in metres); NORMAL is int8 (KHR_mesh_quantization, required).
 * Textures: WebP (EXT_texture_webp, required). Foliage atlases 1024 px on LOD0 / 512 px on LOD1, everything
 * else <= 512 / 256 px unless the item sets texMax. Materials named foliage|frond|skirt|mesh|wire|grille
 * (or with alpha in the Blender export) become alphaMode MASK (cutoff 0.5), double-sided.
 */
const fs = require('fs');
const path = require('path');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP } = require('@gltf-transform/extensions');
const { weld, dedup, prune, reorder, quantize, flatten, join } = require('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder } = require('meshoptimizer');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..', '..');
const WORK = process.env.DRESSING_WORK || '/tmp/dressing-work';
const OUT = path.join(ROOT, 'public', 'models', 'dressing');
const MASK_RE = /foliage|frond|skirt|mesh|wire|grille|bars|leaf|shade|fringe|cutout/i;

function triCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      n += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return Math.round(n);
}


// Push-pull fill of fully transparent texels: they get the (coverage-weighted) average colour of the nearby
// opaque texels, smooth and blocky-free. Keeps mipmaps of alpha-tested cards free of dark / noisy fringes and
// makes the empty parts of the atlases compress to almost nothing.
async function smoothFill(buf) {
  const meta = await sharp(buf).metadata();
  if (!meta.hasAlpha) return null;
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  let w = W, h = H;
  let c = new Float32Array(W * H * 3), a = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const k = data[i * 4 + 3] > 24 ? 1 : 0;
    a[i] = k;
    c[i * 3] = data[i * 4] * k; c[i * 3 + 1] = data[i * 4 + 1] * k; c[i * 3 + 2] = data[i * 4 + 2] * k;
  }
  const levels = [{ w, h, c, a }];
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
    const nc = new Float32Array(nw * nh * 3), na = new Float32Array(nw * nh);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = Math.min(nh - 1, y >> 1) * nw + Math.min(nw - 1, x >> 1), i = y * w + x;
      na[j] += a[i]; nc[j * 3] += c[i * 3]; nc[j * 3 + 1] += c[i * 3 + 1]; nc[j * 3 + 2] += c[i * 3 + 2];
    }
    w = nw; h = nh; c = nc; a = na;
    levels.push({ w, h, c, a });
  }
  // pull: colour per level (premultiplied / weight), holes from the coarser level
  let prev = null;
  for (let L = levels.length - 1; L >= 0; L--) {
    const lv = levels[L];
    const col = new Float32Array(lv.w * lv.h * 3);
    for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
      const i = y * lv.w + x;
      if (lv.a[i] > 0) {
        col[i * 3] = lv.c[i * 3] / lv.a[i]; col[i * 3 + 1] = lv.c[i * 3 + 1] / lv.a[i]; col[i * 3 + 2] = lv.c[i * 3 + 2] / lv.a[i];
      } else if (prev) {
        const j = Math.min(prev.h - 1, y >> 1) * prev.w + Math.min(prev.w - 1, x >> 1);
        col[i * 3] = prev.col[j * 3]; col[i * 3 + 1] = prev.col[j * 3 + 1]; col[i * 3 + 2] = prev.col[j * 3 + 2];
      }
    }
    prev = { w: lv.w, h: lv.h, col };
  }
  for (let i = 0; i < W * H; i++) {
    if (data[i * 4 + 3] > 24) continue;
    data[i * 4] = prev.col[i * 3]; data[i * 4 + 1] = prev.col[i * 3 + 1]; data[i * 4 + 2] = prev.col[i * 3 + 2];
    data[i * 4 + 3] = 0;
  }
  return sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}


// Wind weights in TEXCOORD_1: x = sway = (y / H)^1.5 (0 at the ground, 1 at the top of the model), y = flutter:
// 0 on rigid parts (bark, trunk, stubs), 0.6-1.0 on foliage cards (hash of the vertex position, so it doubles
// as a per-leaf phase seed), 0.3 on palm skirts.
function addWind(doc) {
  const root = doc.getRoot();
  let H = 0;
  for (const me of root.listMeshes()) for (const prim of me.listPrimitives()) {
    const p = prim.getAttribute('POSITION');
    for (let i = 0; i < p.getCount(); i++) H = Math.max(H, p.getElement(i, [])[1]);
  }
  const buffer = root.listBuffers()[0];
  for (const me of root.listMeshes()) for (const prim of me.listPrimitives()) {
    const name = (prim.getMaterial() && prim.getMaterial().getName()) || '';
    const flutter = /foliage|frond/i.test(name) ? 1 : (/skirt/i.test(name) ? 0.5 : 0);
    const p = prim.getAttribute('POSITION');
    const n = p.getCount();
    const arr = new Float32Array(n * 2);
    const v = [];
    for (let i = 0; i < n; i++) {
      p.getElement(i, v);
      arr[i * 2] = Math.pow(Math.min(1, Math.max(0, v[1] / H)), 1.5);
      const h = Math.sin(v[0] * 12.9898 + v[1] * 78.233 + v[2] * 37.719) * 43758.5453;
      arr[i * 2 + 1] = flutter ? flutter * (0.6 + 0.4 * (h - Math.floor(h))) : 0;
    }
    const acc = doc.createAccessor().setType('VEC2').setArray(arr).setBuffer(buffer);
    prim.setAttribute('TEXCOORD_1', acc);
  }
}

async function packGlb(io, src, dst, { lod, texMax, maskAll, double, atlas = 1024, dropNormals = false, wind = false }) {
  const doc = await io.read(src);
  const root = doc.getRoot();
  // materials
  const texLimit = new Map();
  for (const m of root.listMaterials()) {
    const name = m.getName() || '';
    const bc = m.getBaseColorTexture();
    const alphaInTex = bc && m.getAlphaMode() !== 'OPAQUE';
    const mask = maskAll || MASK_RE.test(name) || alphaInTex;
    if (mask) {
      m.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
    } else {
      m.setAlphaMode('OPAQUE');
      if (double !== undefined) m.setDoubleSided(!!double);
    }
    const isFoliage = /foliage|frond/i.test(name);
    if (dropNormals && m.getNormalTexture()) m.setNormalTexture(null);
    const lim = texMax || (isFoliage ? (lod === 0 ? atlas : 256) : (lod === 0 ? 512 : 256));
    for (const t of [bc, m.getNormalTexture(), m.getMetallicRoughnessTexture(), m.getOcclusionTexture(), m.getEmissiveTexture()]) {
      if (!t) continue;
      texLimit.set(t, Math.max(texLimit.get(t) || 0, t === m.getNormalTexture() ? Math.min(lim, 512) : lim));
    }
  }
  await doc.transform(dedup(), flatten(), join({ keepNamed: false }), weld(), prune());
  for (const me of root.listMeshes()) {
    for (const prim of me.listPrimitives()) {
      for (const sem of prim.listSemantics()) {
        if (!/^(POSITION|NORMAL|TEXCOORD_0|COLOR_0)$/.test(sem)) prim.setAttribute(sem, null);
      }
    }
  }
  if (wind) addWind(doc);
  // textures -> WebP
  for (const t of root.listTextures()) {
    const lim = texLimit.get(t) || 256;
    let img = t.getImage();
    const meta = await sharp(img).metadata();
    const isNormal = root.listMaterials().some((m) => m.getNormalTexture() === t);
    const cutout = root.listMaterials().some((m) => m.getBaseColorTexture() === t && m.getAlphaMode() === 'MASK');
    if (cutout) img = (await smoothFill(img)) || img;
    const out = await sharp(img).resize({ width: Math.min(lim, meta.width), height: Math.min(lim, meta.height), fit: 'inside' })
      .webp({ quality: isNormal ? 90 : (cutout ? 70 : 80), alphaQuality: cutout ? 70 : 85, effort: 6, smartSubsample: true }).toBuffer();
    t.setImage(out).setMimeType('image/webp');
    const uri = t.getURI();
    if (uri) t.setURI(uri.replace(/\.(png|jpe?g)$/i, '.webp'));
  }
  doc.createExtension(EXTTextureWebP).setRequired(true);
  // POSITION int16 + TEXCOORD int16 (dequantised by the mesh node's scale/offset and KHR_texture_transform, both
  // handled by GLTFLoader), NORMAL int8. For instancing, bake the node transform into the geometry first
  // (runtime/dressing.js geometries() does it).
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ quantizePosition: 16, quantizeTexcoord: 16, quantizeNormal: 8, quantizeColor: 8, pattern: /^(POSITION|NORMAL|TEXCOORD_\d)$/ }));
  const quantized = root.listMeshes().some((me) => me.listPrimitives().some((p) => {
    const n = p.getAttribute('NORMAL');
    return n && n.getComponentType() !== 5126;
  }));
  if (quantized) doc.createExtension(KHRMeshQuantization).setRequired(true);
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  fs.writeFileSync(dst, await io.writeBinary(doc));
  return { tris: triCount(doc), bytes: fs.statSync(dst).size };
}

async function packImpostor(src, dst, isNormal, alphaSrc) {
  // albedo keeps full resolution; the normal atlas (low frequency) ships at half resolution. Both get the
  // push-pull fill (the normal atlas uses the albedo alpha as its mask, then drops alpha).
  const meta = await sharp(src).metadata();
  let buf = fs.readFileSync(src);
  if (isNormal) {
    const alpha = await sharp(alphaSrc).ensureAlpha().extractChannel(3).raw().toBuffer();
    const rgb = await sharp(src).removeAlpha().raw().toBuffer();
    const rgba = Buffer.alloc(meta.width * meta.height * 4);
    for (let i = 0; i < meta.width * meta.height; i++) {
      rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = alpha[i];
    }
    buf = await sharp(rgba, { raw: { width: meta.width, height: meta.height, channels: 4 } }).png().toBuffer();
    buf = await smoothFill(buf);
    await sharp(buf).removeAlpha().resize({ width: meta.width >> 2, height: meta.height >> 2 }).webp({ quality: 85, effort: 6 }).toFile(dst);
  } else {
    buf = (await smoothFill(buf)) || buf;
    await sharp(buf).resize({ width: meta.width >> 1, height: meta.height >> 1 }).webp({ quality: 82, alphaQuality: 85, effort: 6 }).toFile(dst);
  }
  return fs.statSync(dst).size;
}

async function main() {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
  });
  fs.mkdirSync(OUT, { recursive: true });
  const trees = JSON.parse(fs.readFileSync(path.join(__dirname, 'trees.json'), 'utf8')).trees;
  const itemsCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'items.json'), 'utf8')).items;
  const cfgBy = new Map([...trees.map((t) => [t.name, { ...t, group: 'vegetation' }]), ...itemsCfg.map((i) => [i.name, i])]);
  const want = process.argv.slice(2);
  const manPath = path.join(OUT, 'dressing.json');
  const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : { items: [] };
  const byName = new Map(man.items.map((e) => [e.name, e]));
  const order = [...cfgBy.keys()];
  for (const name of order) {
    if (want.length && !want.includes(name)) continue;
    const wd = path.join(WORK, name);
    if (!fs.existsSync(path.join(wd, 'meta.json'))) { console.log('skip (not built)', name); continue; }
    const meta = JSON.parse(fs.readFileSync(path.join(wd, 'meta.json'), 'utf8'));
    const cfg = cfgBy.get(name);
    process.stdout.write(name + '... ');
    const veg = meta.kind === 'tree';
    const atlas = cfg.atlas || (veg ? (/shrub/.test(name) ? 512 : 768) : 1024);
    const r0 = await packGlb(io, path.join(wd, 'lod0.glb'), path.join(OUT, name + '.glb'), { lod: 0, texMax: cfg.texMax, maskAll: cfg.maskAll, double: cfg.doubleSided, atlas, dropNormals: veg, wind: veg });
    let r1 = null;
    if (fs.existsSync(path.join(wd, 'lod1.glb'))) {
      r1 = await packGlb(io, path.join(wd, 'lod1.glb'), path.join(OUT, name + '_lod1.glb'), { lod: 1, texMax: cfg.texMax1 || (cfg.texMax ? Math.max(64, cfg.texMax / 2) : undefined), maskAll: cfg.maskAll, double: cfg.doubleSided, dropNormals: veg, wind: veg });
    }
    const e = {
      name,
      group: cfg.group || (meta.kind === 'tree' ? 'vegetation' : 'dressing'),
      file: name + '.glb',
      lod1: r1 ? name + '_lod1.glb' : null,
      height: meta.height,
      footprintRadius: meta.radius,
      baseRadius: meta.baseRadius ?? meta.trunkRadius ?? null,
      extent: meta.extent || null,
      attach: cfg.attach || 'ground',
      front: '+Z',
      tris: [r0.tris, r1 ? r1.tris : null],
      bytes: [r0.bytes, r1 ? r1.bytes : null],
      tags: cfg.tags || meta.tags || [],
    };
    if (meta.impostor) {
      const a = await packImpostor(path.join(wd, 'imp.png'), path.join(OUT, name + '_imp.webp'), false);
      const n = await packImpostor(path.join(wd, 'imp_n.png'), path.join(OUT, name + '_imp_n.webp'), true, path.join(wd, 'imp.png'));
      e.impostor = { ...meta.impostor, px: meta.impostor.px.map((v) => v >> 1), albedo: name + '_imp.webp', normal: name + '_imp_n.webp', bytes: a + n };
    }
    if (meta.crown) e.crown = meta.crown;
    if (meta.trunkRadius !== undefined) e.trunkRadius = meta.trunkRadius;
    if (cfg.kind === 'broadleaf' || cfg.kind === 'palm' || cfg.kind === 'shrub' || cfg.wind) e.wind = true;
    for (const k of ['anchor', 'mount', 'tile', 'variants', 'anchors', 'note', 'notes', 'source', 'recolor', 'lights', 'decal', 'size']) {
      if (cfg[k] !== undefined) e[k] = cfg[k];
      if (meta[k] !== undefined) e[k] = meta[k];
    }
    byName.set(name, e);
    console.log(`LOD0 ${r0.tris} tris ${(r0.bytes / 1024).toFixed(0)} KB` + (r1 ? ` | LOD1 ${r1.tris} tris ${(r1.bytes / 1024).toFixed(0)} KB` : '') + (e.impostor ? ` | imp ${(e.impostor.bytes / 1024).toFixed(0)} KB` : ''));
  }
  const items = [...byName.values()].sort((a, b) => (a.group + a.name).localeCompare(b.group + b.name));
  const total = fs.readdirSync(OUT).filter((f) => /\.(glb|webp)$/.test(f)).reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
  const out = {
    version: 1,
    units: 'metres, +Y up, front +Z; origin at the foot (ground items) or at the wall-contact point (wall/window items)',
    wind: 'TEXCOORD_1 (uv1): x = sway weight 0..1 (0 at the ground), y = flutter weight 0..1 (0 = rigid, also a phase seed)',
    lodDistances: { lod0: 45, lod1: 160, impostor: 1200, phoneLod0: 25, phoneLod1: 90 },
    totalBytes: total,
    items,
  };
  fs.writeFileSync(manPath, JSON.stringify(out, null, 1) + '\n');
  console.log(`dressing.json: ${items.length} items, ${(total / 1048576).toFixed(2)} MB in ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
