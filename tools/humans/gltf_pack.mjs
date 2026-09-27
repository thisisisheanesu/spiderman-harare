// Post-processing for the humans lane glbs (run with node from a dir where @gltf-transform/*,
// meshoptimizer and sharp are installed, e.g. NODE_PATH or a local node_modules):
//
//   node gltf_pack.mjs suits  classic.glb symbiote.glb out.glb        merge the symbiote material in as a
//                                                                    KHR_materials_variants variant + compress
//   node gltf_pack.mjs char   in.glb out.glb [maxTex=1024]           character: meshopt + WebP
//   node gltf_pack.mjs anims  in.glb out.glb                         animation-only file: resample + meshopt
//
// Compression: EXT_meshopt_compression (+ KHR_mesh_quantization) and EXT_texture_webp.
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsVariants, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, resample, quantize, meshopt, textureCompress, sparse } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});

const [mode, ...args] = process.argv.slice(2);

async function compress(doc, { maxTex = 1024, mrTex = null, quality = 88, anims = false } = {}) {
  await doc.transform(dedup(), prune({ keepAttributes: false, keepLeaves: true }));
  if (anims) await doc.transform(resample({ tolerance: 1e-4 }));
  // texture slots get disjoint rules so nothing is re-encoded twice
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(baseColor|emissive|occlusion)/,
    resize: [maxTex, maxTex], quality }));
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^normal/, resize: [maxTex, maxTex], quality: 92 }));
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^metallicRoughness/,
    resize: [mrTex || maxTex, mrTex || maxTex], quality }));
  await doc.transform(
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  return doc;
}

if (mode === 'suits') {
  const [classicPath, symPath, out] = args;
  const doc = await io.read(classicPath);
  const sym = await io.read(symPath);
  const root = doc.getRoot();
  const classic = root.listMaterials().find(m => m.getName() === 'suit_classic');
  const symSrc = sym.getRoot().listMaterials().find(m => m.getName() === 'suit_symbiote');
  if (!classic || !symSrc) throw new Error('materials not found');
  const copyTex = (t) => {
    if (!t) return null;
    // reuse identical images already in the doc (shared normal map)
    const img = t.getImage();
    for (const ex of root.listTextures()) {
      const a = ex.getImage();
      if (a && a.length === img.length && Buffer.compare(Buffer.from(a), Buffer.from(img)) === 0) return ex;
    }
    return doc.createTexture(t.getName() || 'tex').setImage(img).setMimeType(t.getMimeType()).setURI('');
  };
  // same geometry, same sidedness: the masked head has a few welded slits, so the suit must not
  // be back-face culled in one variant and not the other
  const m = doc.createMaterial('suit_symbiote')
    .setDoubleSided(classic.getDoubleSided())
    .setBaseColorFactor(symSrc.getBaseColorFactor())
    .setMetallicFactor(symSrc.getMetallicFactor())
    .setRoughnessFactor(symSrc.getRoughnessFactor())
    .setBaseColorTexture(copyTex(symSrc.getBaseColorTexture()))
    .setMetallicRoughnessTexture(copyTex(symSrc.getMetallicRoughnessTexture()))
    .setNormalTexture(copyTex(symSrc.getNormalTexture()));
  const ext = doc.createExtension(KHRMaterialsVariants);
  const vClassic = ext.createVariant('classic');
  const vSym = ext.createVariant('symbiote');
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    if (prim.getMaterial() !== classic) continue;
    const mv = ext.createMappingList()
      .addMapping(ext.createMapping().setMaterial(classic).addVariant(vClassic))
      .addMapping(ext.createMapping().setMaterial(m).addVariant(vSym));
    prim.setExtension('KHR_materials_variants', mv);
  }
  await compress(doc, { maxTex: 2048, mrTex: 1024 });
  await io.write(out, doc);
} else if (mode === 'char') {
  const [inp, out, maxTex] = args;
  const doc = await io.read(inp);
  await compress(doc, { maxTex: +(maxTex || 1024) });
  await io.write(out, doc);
} else if (mode === 'anims') {
  const [inp, out] = args;
  const doc = await io.read(inp);
  // Clips must only carry bone rotations + the pelvis translation: per-bone translation/scale
  // tracks would force the reference skeleton's bone lengths onto every character.
  let removed = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const path = ch.getTargetPath();
      if (path === 'scale' || (path === 'translation' && (!node || node.getName() !== 'pelvis'))) {
        const smp = ch.getSampler();
        anim.removeChannel(ch); ch.dispose();
        if (smp && smp.listParents().filter(p => p.propertyType === 'AnimationChannel').length === 0) { anim.removeSampler(smp); smp.dispose(); }
        removed++;
      }
    }
  }
  console.log('stripped channels', removed);
  await compress(doc, { anims: true });
  await io.write(out, doc);
} else {
  console.error('unknown mode'); process.exit(1);
}
console.log('wrote', args[args.length - 1] === undefined ? '' : args.filter(a => a.endsWith('.glb')).pop());
