#!/usr/bin/env node
/* Optimise the Blender-exported facade kit into game-ready GLBs and write kit.json.
 *
 *   NODE_PATH=<dir>/node_modules FACADE_WORK=<scratch> node tools/facades/optimize_kit.cjs
 *
 * Needs (outside the repo): @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4
 * meshoptimizer sharp.
 * Input : $FACADE_WORK/kit_raw/<type>.glb + <type>.json, common.glb + common.json (tools/facades/kit_blender.py),
 *         public/models/facades/tex/*.webp (tools/facades/atlas_post.py)
 * Output: public/models/facades/<type>.glb, common.glb, kit.json
 *
 * Geometry: welded, deduplicated, reordered, EXT_meshopt_compression (FILTER). POSITION / TEXCOORD stay float32
 * (no dequantisation node transforms: a module's geometry is in metres in its own node space); NORMAL is int8
 * (KHR_mesh_quantization, required). Materials carry no textures except the downloaded attachments (WebP):
 * kit.json names the PBR material + tint of every role so the city can share one material per PBR texture set.
 */
const fs = require('fs');
const path = require('path');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } = require('@gltf-transform/extensions');
const { dedup, prune, reorder, quantize, textureCompress, weld } = require('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder } = require('meshoptimizer');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..', '..');
const WORK = process.env.FACADE_WORK || '/tmp/facade-work';
const RAW = path.join(WORK, 'kit_raw');
const OUT = path.join(ROOT, 'public', 'models', 'facades');
const MATS = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'textures', 'materials.json'), 'utf8'))
  .materials.map((m) => [m.name, m]));
const REFS = JSON.parse(fs.readFileSync(path.join(__dirname, 'refs.json'), 'utf8'));
const TYPES_PY = JSON.parse(fs.readFileSync(path.join(RAW, 'types.json'), 'utf8'));

const srgb2lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexLin = (h) => [1, 3, 5].map((i) => srgb2lin(parseInt(h.slice(i, i + 2), 16) / 255));
const r4 = (x) => Math.round(x * 1e4) / 1e4;

function roleInfo(role, spec) {
  const [pbr, tint] = spec;
  const m = MATS[pbr];
  const out = { pbr };
  if (tint) {
    out.tint = tint;
    out.tintLinear = hexLin(tint).map(r4);
  }
  if (m && tint && !['glass', 'glass_spandrel', 'sign'].includes(role)) {
    out.factor = out.tintLinear.map((t, i) => r4(t / Math.max(1e-4, m.avgColorLinear[i])));
  }
  out.uv = role === 'sign' ? 'unit' : 'metres';
  return out;
}

async function optimise(io, src, dst, { texMax = 0, materialNames = null } = {}) {
  const doc = await io.readBinary(fs.readFileSync(src));
  for (const mat of doc.getRoot().listMaterials()) {
    const name = mat.getName();
    const role = name.includes('__') ? name.split('__')[1] : name;
    mat.setName(role);
    const ex = materialNames ? materialNames(role) : null;
    if (ex) mat.setExtras(ex);
    // keep the preview colour in [0, 1] (the real tint factor lives in kit.json / extras.factor)
    const bc = mat.getBaseColorFactor();
    mat.setBaseColorFactor(bc.map((v, i) => (i < 3 ? Math.min(1, v) : v)));
  }
  // three.js GLTFLoader strips '.' from node names (PropertyBinding.sanitizeNodeName): use '_' instead
  for (const node of doc.getRoot().listNodes()) node.setName(node.getName().replace(/\./g, '_'));
  for (const mesh of doc.getRoot().listMeshes()) mesh.setName(mesh.getName().replace(/\./g, '_'));
  // TEXCOORD_1 (room coordinates) only matters on glass primitives
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const role = prim.getMaterial() ? prim.getMaterial().getName() : '';
      if (role !== 'glass' && prim.getAttribute('TEXCOORD_1')) prim.setAttribute('TEXCOORD_1', null);
    }
  }
  await doc.transform(dedup(), weld(), prune({ keepExtras: true, keepAttributes: true }));
  if (texMax) {
    await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texMax, texMax], quality: 84 }));
  }
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }), quantize({ pattern: /^NORMAL$/, quantizeNormal: 8 }));
  const quantized = doc.getRoot().listMeshes().some((m) => m.listPrimitives().some((p) => {
    const n = p.getAttribute('NORMAL');
    return n && n.getComponentType() !== 5126;
  }));
  if (quantized) doc.createExtension(KHRMeshQuantization).setRequired(true);
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  fs.writeFileSync(dst, await io.writeBinary(doc));
  return fs.statSync(dst).size;
}

function convModule(key, m, prefix) {
  const out = {
    node: m.node.replace(/\./g, '_'),
    lod1Node: m.lod1_node ? m.lod1_node.replace(/\./g, '_') : null,
    kind: m.kind,
    floor: m.floor,
    width: r4(m.w),
    height: r4(m.h),
    depth: m.bounds ? { out: r4(m.bounds.max[2]), in: r4(-m.bounds.min[2]) } : undefined,
    pivot: 'bottom-left of the tiling rectangle on the wall plane (x right along the wall seen from the street, y up, +z outward)',
    stretch: { x: m.stretch.x.map(r4), y: m.stretch.y.map(r4) },
    lod1: m.lod1,
    materials: m.materials,
    tris: m.tris,
    anchors: m.anchors,
    notes: m.notes,
  };
  if (m.interior) out.interior = m.interior;
  if (m.recess) out.recess = m.recess;
  if (m.depth && !out.depth) out.depth = { out: m.depth, in: 0 };
  if (m.kind === 'corner') {
    out.pivot = 'the footprint corner; x along the OUTGOING wall (the next wall to the right seen from outside), the incoming wall lies along -z';
  }
  if (!out.depth) delete out.depth;
  return out;
}

async function main() {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  fs.mkdirSync(OUT, { recursive: true });
  const kit = {
    version: 1,
    generator: 'tools/facades (fetch_assets.py, kit_blender.py, atlas_post.py, optimize_kit.cjs)',
    conventions: {
      units: 'metres. Module space = glTF space: x along the wall to the right (seen from the street), y up, +z outward (towards the street). The wall plane / footprint line is z = 0: projections have z > 0, recesses z < 0.',
      pivot: 'every module node sits at the file origin with identity transform; its pivot is the bottom-left corner of its tiling rectangle [0, width] x [0, height] on the wall plane (corner modules: the footprint corner).',
      stretch: 'scale a module by (targetWidth / width, targetHeight / height, 1) within stretch.x / stretch.y (metres). UVs of role materials are in metres: recompute them after stretching (tools/facades/kit_builder.js does: front / top faces u = u * sx + offsetAlongWall, front / side faces v = v * sy + floorBase) so textures stay continuous across bays and floors.',
      materials: 'glTF materials are named by ROLE (wall, trim, accent, plinth, frame, glass, glass_spandrel, metal, roof_sheet, sign, atlas) and hold no textures. types[t].materials[role] gives the PBR set from public/textures/materials.json (texture.repeat = 1 / tileSizeMetres) and the default tint; factor = tintLinear / avgColorLinear is the colour multiplier (may exceed 1; the GLB preview colour is clamped). Palettes list alternative tints seen in the photos.',
      glass: 'role glass = interior-mapped window (tools/materials/interior_glass.js). TEXCOORD_0 = wall metres (grime), TEXCOORD_1 (three.js uv1) = room coordinates: x = 2 * roomIndex + u (u 0..1 across the room behind the window), y = 0..1 floor to ceiling. winUv = (fract(uv1.x / 2) * 2 ... ) i.e. roomIndex = floor(uv1.x / 2), winUv = (uv1.x - 2 * roomIndex, uv1.y). winData (cell, mirror, light, depth) is chosen per room by the builder (types[t].glassCells, roomDepth).',
      sign: 'role sign = fascia boards / name panels / canopy fascias: TEXCOORD_0 is 0..1 across the board, for shop-sign textures (anchors.sign gives the rectangle).',
      lod: 'LOD0 = the module node (<= ~60 m). LOD1 = <node>.lod1: a flat quad (or 2-quad box for corners) UV-mapped into types[t].atlas (orthographic bake of LOD0: albedo, normal, ORM, mask). LOD2 = impostor: types[t].impostor, a tileable 2-bay elevation (ground / 2 middle floors / cap) for plain extruded walls far away.',
      atlasTextures: 'albedo sRGB RGB (AO partly baked in); normal tangent-space OpenGL (+Y up) RGB, alpha = height above the wall plane (h = (a - 0.5) * 3 m); orm R=AO G=roughness B=metalness; mask R/G/B = weights of the tintable roles wall/trim/accent, A = glass (lossless). Re-tint: albedo_lin * (1 + sum_i mask_i * (factor_i / defaultFactor_i - 1)).',
      anchors: 'attachment points in module space: ac [[x, y, z]] = bottom-centre of an air-conditioner (place common.ac_window there), bars [{x0, y0, x1, y1, z}] = window rectangles for burglar bars, shutter [{...}] = shop opening for common.shutter, sign [{...}] = sign board rectangle, canopy [[x, y, z]] = underside of a pavement canopy, verandah [[x, y, z]].',
      compression: 'EXT_meshopt_compression (GLTFLoader.setMeshoptDecoder(MeshoptDecoder)), NORMAL int8 via KHR_mesh_quantization, POSITION/TEXCOORD float32; common.glb textures are WebP (EXT_texture_webp).',
    },
    budget: {},
    materials: {},
    types: {},
    common: {},
  };
  const usedPbr = new Set();
  let total = 0;
  const typeNames = Object.keys(TYPES_PY);
  for (const t of typeNames) {
    const rawJson = path.join(RAW, `${t}.json`);
    if (!fs.existsSync(rawJson)) continue;
    const meta = JSON.parse(fs.readFileSync(rawJson, 'utf8'));
    const T = TYPES_PY[t];
    const roles = {};
    for (const [role, spec] of Object.entries(T.materials)) {
      roles[role] = roleInfo(role, spec);
      usedPbr.add(spec[0]);
    }
    const bytes = await optimise(io, path.join(RAW, `${t}.glb`), path.join(OUT, `${t}.glb`), {
      materialNames: (role) => (roles[role] ? { role, ...roles[role] } : { role }),
    });
    const modules = {};
    for (const [k, m] of Object.entries(meta.modules)) modules[k] = convModule(k, m);
    const A = meta.atlas;
    const I = meta.impostor;
    const tex = (kind, which) => `tex/${t}_${kind}_${which}.webp`;
    const texBytes = meta.texBytes || {};
    const atlasRects = {};
    for (const [k, r] of Object.entries(A.rects)) {
      const [u0, v0, u1, v1] = r.uv;
      atlasRects[k] = { px: r.px, uv: [r4(u0), r4(1 - v1), r4(u1), r4(1 - v0)] };
    }
    kit.types[t] = {
      title: T.title,
      file: `${t}.glb`,
      bay: T.W, floor: T.H, groundFloor: T.Hg, cap: T.hc,
      materials: roles,
      palette: T.palette,
      glassCells: T.glass_cells,
      roomDepth: T.room_depth,
      rules: T.rules,
      references: REFS.types[t] || [],
      modules,
      atlas: {
        albedo: tex('atlas', 'albedo'), normal: tex('atlas', 'normal'), orm: tex('atlas', 'orm'), mask: tex('atlas', 'mask'),
        size: [A.res, A.res], metres: r4(A.size_m), pxPerMetre: r4(A.px_per_m),
        rects: atlasRects,
        note: 'rects.px = [x, y, w, h] in albedo pixels from the top-left; rects.uv = [u0, v0, u1, v1] in glTF / three.js (flipY=false) UV space. Normal / ORM / mask are half resolution.',
      },
      impostor: {
        albedo: tex('imp', 'albedo'), normal: tex('imp', 'normal'), orm: tex('imp', 'orm'), mask: tex('imp', 'mask'),
        size: [256, 512], bays: I.bays, widthMetres: r4(I.width_m), heightMetres: r4(I.height_m),
        rows: Object.fromEntries(Object.entries(I.rows_v).map(([k, v]) => [k, [r4(1 - v[1]), r4(1 - v[0])]])),
        rowsMetres: I.rows_m,
        middleFloors: 2,
        ground: I.ground, middleModules: I.middle,
        note: 'u repeats every 2 bays (wrapS = RepeatWrapping); rows[k] = [v0, v1] in glTF/three.js UV space (v = 0 at the TOP of the image, flipY=false; with TextureLoader flipY=true use 1 - v). The middle row holds 2 floors: map each pair of middle floors onto it (an odd last floor maps to half the row).',
      },
      bytes: { glb: bytes, textures: texBytes },
    };
    const tb = Object.values(texBytes).reduce((s, o) => s + Object.values(o).reduce((a, b) => a + b, 0), 0);
    total += bytes + tb;
    console.log(`${t.padEnd(13)} glb ${(bytes / 1024).toFixed(0).padStart(4)} KB  tex ${(tb / 1024).toFixed(0).padStart(4)} KB  modules ${Object.keys(modules).length}`);
  }
  // common attachments
  const cmeta = JSON.parse(fs.readFileSync(path.join(RAW, 'common.json'), 'utf8'));
  const commonRoles = {};
  for (const [role, spec] of Object.entries(TYPES_PY.__common__.materials)) commonRoles[role] = roleInfo(role, spec);
  const cbytes = await optimise(io, path.join(RAW, 'common.glb'), path.join(OUT, 'common.glb'), {
    texMax: 256,
    materialNames: (role) => (commonRoles[role] ? { role, ...commonRoles[role], retint: 'use the building\'s own role tint' } : { role, source: 'embedded textures' }),
  });
  total += cbytes;
  const cm = {};
  for (const [k, m] of Object.entries(cmeta.modules)) cm[k] = convModule(k, m);
  kit.common = { file: 'common.glb', materials: commonRoles, modules: cm, bytes: cbytes, credits: REFS.attachments };
  console.log(`common        glb ${(cbytes / 1024).toFixed(0).padStart(4)} KB`);
  for (const name of usedPbr) {
    const m = MATS[name];
    if (!m) continue;
    kit.materials[name] = { files: m.files, tileSizeMetres: m.tileSizeMetres, avgColor: m.avgColor, avgColorLinear: m.avgColorLinear };
  }
  kit.materials.corrugated_weathered = kit.materials.corrugated_weathered || (() => {
    const m = MATS.corrugated_weathered;
    return { files: m.files, tileSizeMetres: m.tileSizeMetres, avgColor: m.avgColor, avgColorLinear: m.avgColorLinear };
  })();
  kit.materials._note = 'files are relative to public/textures/ (shared with the city; not duplicated here)';
  kit.budget = { totalBytes: total, note: 'GLBs + atlas / impostor textures of public/models/facades (the shared PBR textures of public/textures are not counted)' };
  fs.writeFileSync(path.join(OUT, 'kit.json'), JSON.stringify(kit, null, 1));
  console.log(`total ${(total / 1e6).toFixed(2)} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
