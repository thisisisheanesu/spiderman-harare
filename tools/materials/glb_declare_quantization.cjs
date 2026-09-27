#!/usr/bin/env node
/* Declare KHR_mesh_quantization in GLBs that use quantized vertex attributes without it (dependency-free).
 *
 *   node tools/materials/glb_declare_quantization.cjs [--check] [file.glb | dir ...]
 *   (no paths = public/models/props)
 *
 * Why: core glTF 2.0 only allows float32 POSITION / NORMAL / TANGENT (and float or normalized u8/u16 TEXCOORD).
 * optimize_props.cjs quantizes NORMAL to int8 but keeps POSITION float32, and gltf-transform 4.5's quantize()
 * only adds the extension when POSITION itself is quantized (it tests the POSITION accessor for every semantic),
 * so the shipped props were invalid glTF (Khronos validator: MESH_PRIMITIVE_ATTRIBUTES_ACCESSOR_INVALID_FORMAT).
 * three.js loads them either way; strict loaders / Blender / validators do not.
 *
 * The fix only rewrites the JSON chunk (extensionsUsed / extensionsRequired); the binary chunk is untouched, so no
 * meshopt re-encode happens and positions stay float32 (no dequantization node transforms are involved).
 * --check lists the files that need it and exits 1 if any do.
 */
const fs = require('fs');
const path = require('path');

const EXT = 'KHR_mesh_quantization';
const FLOAT = 5126;

function needsQuantization(json) {
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const sets = [prim.attributes || {}, ...(prim.targets || [])];
      for (const attrs of sets) {
        for (const [sem, ai] of Object.entries(attrs)) {
          const a = json.accessors[ai];
          if (!a) continue;
          if ((sem === 'POSITION' || sem === 'NORMAL' || sem === 'TANGENT') && a.componentType !== FLOAT) return true;
          if (sem.startsWith('TEXCOORD_') && a.componentType !== FLOAT &&
              !(a.normalized && (a.componentType === 5121 || a.componentType === 5123))) return true;
        }
      }
    }
  }
  return false;
}

function patch(file, checkOnly) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${file}: first chunk is not JSON`);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const used = json.extensionsUsed || [];
  if (!needsQuantization(json) || used.includes(EXT)) return false;
  if (checkOnly) return true;
  json.extensionsUsed = [...used, EXT];
  json.extensionsRequired = [...(json.extensionsRequired || []), EXT];
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (text.length % 4)) % 4;
  if (pad) text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
  const rest = buf.subarray(20 + jsonLen); // BIN chunk (header + data), unchanged
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + text.length + rest.length, 8);
  header.writeUInt32LE(text.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  fs.writeFileSync(file, Buffer.concat([header, text, rest]));
  return true;
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  let targets = args.filter((a) => !a.startsWith('--'));
  if (!targets.length) targets = [path.resolve(__dirname, '..', '..', 'public', 'models', 'props')];
  const files = targets.flatMap((t) => (fs.statSync(t).isDirectory()
    ? fs.readdirSync(t).filter((f) => f.endsWith('.glb')).map((f) => path.join(t, f)) : [t]));
  let n = 0;
  for (const f of files) {
    if (patch(f, checkOnly)) {
      n++;
      console.log(`${checkOnly ? 'needs' : 'patched'} ${path.relative(process.cwd(), f)}`);
    }
  }
  console.log(`${n} of ${files.length} GLBs ${checkOnly ? 'need' : 'got'} ${EXT}`);
  if (checkOnly && n) process.exit(1);
  if (!checkOnly) for (const dir of new Set(files.map((f) => path.dirname(f)))) syncManifestBytes(dir);
}

// The JSON chunk grows by a few bytes: keep props.json `bytes` / `totalBytes` in step (when the folder has one).
function syncManifestBytes(dir) {
  const manPath = path.join(dir, 'props.json');
  if (!fs.existsSync(manPath)) return;
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  let changed = false;
  for (const p of man.props || []) {
    const b = [p.file, p.lod1].map((f) => (fs.existsSync(path.join(dir, f)) ? fs.statSync(path.join(dir, f)).size : null));
    if (b.every((x) => x !== null) && JSON.stringify(b) !== JSON.stringify(p.bytes)) { p.bytes = b; changed = true; }
  }
  const total = (man.props || []).reduce((s, p) => s + p.bytes[0] + p.bytes[1], 0);
  if (man.totalBytes !== total) { man.totalBytes = total; changed = true; }
  if (changed) {
    fs.writeFileSync(manPath, JSON.stringify(man, null, 1));
    console.log(`updated bytes in ${path.relative(process.cwd(), manPath)} (total ${(total / 1e6).toFixed(2)} MB)`);
  }
}

if (require.main === module) main();
module.exports = { needsQuantization, patch, syncManifestBytes };
