#!/usr/bin/env node
/* Optimise the Blender-exported prop intermediates into game-ready GLBs.
 *
 *   NODE_PATH=<dir>/node_modules node tools/materials/optimize_props.cjs [names...]
 *
 * Needs (outside the repo, e.g. `npm install --prefix /tmp/gltf-tools @gltf-transform/core@4
 * @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp`).
 * Input : $PROPS_RAW (default $MAT_CACHE/props_raw)/<name>.glb + <name>.json (from props_blender.py)
 * Output: public/models/props/<name>.glb        LOD0  <= 3000 triangles, textures <= meta.tex px (WebP)
 *         public/models/props/<name>_lod1.glb   LOD1  <=  600 triangles, textures <= 128/256 px (WebP)
 *         public/models/props/props.json        manifest (merged with existing entries)
 *
 * Geometry: welded, meshopt-simplified (seam-aware), reordered, EXT_meshopt_compression (FILTER mode).
 * POSITION and TEXCOORD stay float32 on purpose: no quantization node transforms, so `mesh.geometry` can be
 * dropped straight into an InstancedMesh in metres. Only NORMAL is quantised (int8 normalised), which core glTF
 * does not allow, so every file declares KHR_mesh_quantization (required; three.js GLTFLoader supports it).
 * All textures, including the 128 px palette of the procedural props, are WebP q82. The palette swatches are
 * 16 px and the UVs sit at swatch centres, where lossy WebP stays within 2/255 of the PALETTE colours.
 * glb_declare_quantization.cjs --check validates the extension declaration of the shipped files.
 */
const fs = require('fs');
const path = require('path');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } = require('@gltf-transform/extensions');
const {
  weld, simplify, dedup, prune, reorder, quantize, textureCompress, join, flatten,
} = require('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } = require('meshoptimizer');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..', '..');
const CACHE = process.env.MAT_CACHE || '/tmp/spiderman-materials-cache';
const RAW = process.env.PROPS_RAW || path.join(CACHE, 'props_raw');
const OUT = path.join(ROOT, 'public', 'models', 'props');
const LOD0_MAX = 3000;
const LOD1_MAX = 600;

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

// gltf-transform's simplify() only forwards LockBorder; this wrapper adds meshoptimizer flags on hard cases:
// Prune (drop tiny disconnected bits) and Permissive (allow collapses across UV seams).
const EXTRA = { flags: [] };
const Simplifier = {
  get ready() { return MeshoptSimplifier.ready; },
  simplify: (indices, positions, stride, target, error, flags) =>
    MeshoptSimplifier.simplify(indices, positions, stride, target, error, [...(flags || []), ...EXTRA.flags]),
};

async function reduceTo(io, src, maxTris) {
  // Meshopt simplification to <= maxTris. Constrained error bounds first (best quality); if those stall above
  // the budget (UV seams, many loose parts), fall back to unconstrained error with Permissive / Prune flags and
  // binary-search the ratio for the largest result that fits.
  const base = await io.readBinary(src);
  const t0 = triCount(base);
  if (t0 <= maxTris) {
    await base.transform(weld());
    return { doc: base, tris: triCount(base), error: 0 };
  }
  const trial = async (ratio, error, flags) => {
    EXTRA.flags = flags || [];
    const doc = await io.readBinary(src);
    await doc.transform(weld(), simplify({ simplifier: Simplifier, ratio, error, lockBorder: false }));
    return { doc, tris: triCount(doc), error: flags && flags.length ? `${error}+${flags.join('+')}` : error };
  };
  const r0 = (maxTris / t0) * 0.98;
  let best = null;
  for (const error of [0.002, 0.01, 0.04, 0.15]) {
    const res = await trial(r0, error);
    if (res.tris <= maxTris) return res;
  }
  for (const flags of [[], ['Permissive'], ['Prune'], ['Prune', 'Permissive']]) {
    let lo = 0.002;
    let hi = r0;
    for (let i = 0; i < 9; i++) {
      const mid = i === 0 ? hi : Math.sqrt(lo * hi);
      const res = await trial(mid, 1, flags);
      if (res.tris <= maxTris) {
        if (!best || res.tris > best.tris) best = res;
        if (i === 0 || res.tris > maxTris * 0.9) break;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    if (best && best.tris >= maxTris * 0.45) return best;
  }
  if (best && best.tris > 0) return best;
  throw new Error(`could not reach triangle budget ${maxTris} (source ${t0})`);
}

async function finish(doc, texMax) {
  await doc.transform(
    dedup(),
    flatten(),
    join({ keepNamed: false }),
    prune(),
    // every texture -> WebP (the procedural palettes too; see the header comment)
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texMax, texMax], quality: 82 }),
  );
  await doc.transform(
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern: /^NORMAL$/, quantizeNormal: 8 }),
  );
  // gltf-transform 4.5 quantize() only declares KHR_mesh_quantization when POSITION is quantized; int8 NORMAL
  // alone still needs it to be valid glTF.
  const quantized = doc.getRoot().listMeshes().some((m) => m.listPrimitives().some((p) => {
    const n = p.getAttribute('NORMAL');
    return n && n.getComponentType() !== 5126;
  }));
  if (quantized) doc.createExtension(KHRMeshQuantization).setRequired(true);
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
}

async function main() {
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  fs.mkdirSync(OUT, { recursive: true });
  const want = process.argv.slice(2);
  const names = fs.readdirSync(RAW).filter((f) => f.endsWith('.glb') && !f.endsWith('.lod1src.glb')).map((f) => f.slice(0, -4))
    .filter((n) => !want.length || want.includes(n)).sort();
  const manPath = path.join(OUT, 'props.json');
  const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : { props: [] };
  const byName = new Map(man.props.map((p) => [p.name, p]));
  for (const name of names) {
    process.stdout.write(`${name}... `);
    const meta = JSON.parse(fs.readFileSync(path.join(RAW, name + '.json'), 'utf8'));
    const src = fs.readFileSync(path.join(RAW, name + '.glb'));
    const proc = meta.kind === 'procedural';
    // LOD0
    const l0 = await reduceTo(io, src, LOD0_MAX);
    await finish(l0.doc, proc ? 128 : meta.tex);
    const f0 = path.join(OUT, name + '.glb');
    fs.writeFileSync(f0, await io.writeBinary(l0.doc));
    // LOD1 (from the Blender planar-dissolve source when there is one: it keeps UV seams intact)
    const lod1Path = path.join(RAW, name + '.lod1src.glb');
    const src1 = fs.existsSync(lod1Path) ? fs.readFileSync(lod1Path) : src;
    const l1 = await reduceTo(io, src1, LOD1_MAX);
    await finish(l1.doc, proc ? 128 : (meta.tex >= 1024 ? 256 : 128));
    const f1 = path.join(OUT, name + '_lod1.glb');
    fs.writeFileSync(f1, await io.writeBinary(l1.doc));
    const s0 = fs.statSync(f0).size;
    const s1 = fs.statSync(f1).size;
    const entry = {
      name,
      file: name + '.glb',
      lod1: name + '_lod1.glb',
      height: meta.height,
      footprintRadius: meta.footprintRadius,
      baseRadius: meta.baseRadius ?? meta.footprintRadius,
      extent: meta.extent,
      tris: [l0.tris, l1.tris],
      bytes: [s0, s1],
      tags: meta.tags,
      anchors: meta.anchors || [],
      materials: l0.doc.getRoot().listMaterials().map((m) => m.getName()),
      source: meta.source,
      notes: meta.notes || '',
    };
    byName.set(name, entry);
    console.log(`${name.padEnd(26)} LOD0 ${String(l0.tris).padStart(5)} tris ${(s0 / 1024).toFixed(0).padStart(4)} KB (err ${l0.error})` +
      `   LOD1 ${String(l1.tris).padStart(4)} tris ${(s1 / 1024).toFixed(0).padStart(3)} KB`);
  }
  const props = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const out = {
    version: 1,
    generator: 'tools/materials/props_blender.py + optimize_props.cjs',
    conventions: {
      units: 'metres, y up, feet at y = 0, footprint centred on x = z = 0',
      front: '+Z is the front (bench seat side, lamp arm, shelter opening, AC grille). Rotate about Y to place.',
      compression: 'EXT_meshopt_compression (GLTFLoader.setMeshoptDecoder(MeshoptDecoder)); textures EXT_texture_webp',
      positions: 'POSITION / TEXCOORD float32 (no quantization node transform): geometry can be reused in InstancedMesh as is; NORMAL is int8 normalised, declared through KHR_mesh_quantization (required, supported by GLTFLoader)',
      lod: 'file = LOD0 (<= 3000 tris), lod1 = LOD1 (<= 600 tris, 128-256 px textures)',
      anchors: 'web-swing anchor points in the prop\'s local space [x, y, z] (street lamps: pole top and arm tips)',
      heights: 'height = top of the model (m); footprintRadius = max horizontal reach from the origin; baseRadius = radius of the part that touches the ground (for colliders / pedestrian avoidance)',
    },
    totalBytes: props.reduce((s, p) => s + p.bytes[0] + p.bytes[1], 0),
    props,
  };
  fs.writeFileSync(manPath, JSON.stringify(out, null, 1));
  console.log(`total ${(out.totalBytes / 1e6).toFixed(2)} MB in ${props.length} props`);
}

main().catch((e) => { console.error(e); process.exit(1); });
