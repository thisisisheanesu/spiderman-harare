import * as THREE from 'three';
import { encodeLayer } from './bcEncode.js';

// The CC0 PBR materials of public/textures (see its README) packed into texture arrays, so the
// merged city meshes keep one material (and one draw call) per chunk:
//   A array (sRGB):   rgb = albedo, a = roughness (ORM.g; sRGB textures store alpha linearly)
//   B array (linear): rg = tangent-space normal xy (OpenGL, +Y up), b = ambient occlusion (ORM.r),
//                     a = metalness (ORM.b)          -- omitted on 'low' (no normal mapping on phones)
// Every layer is resampled to one square size; tileSizeMetres keeps non-square sources right.
// Compressed variant ('high' on desktop GPUs with S3TC + RGTC): 1024 px layers encoded at load in
// web workers (render/bcEncode.js): A = BC3 (albedo with its AO folded in, roughness), B = BC5
// (normal xy); metalness becomes a per-material constant (only aluminium and zinc carry any).
// Materials missing from a (reduced) set resolve to a stand-in through FALLBACK, so callers can ask
// for any name at any quality level.

// Walls, roofs, frames and glass for the facade material. Order = layer index.
export const FACADE_SET = [
  'concrete_painted', 'plaster_smooth', 'plaster_textured', 'plaster_peeling', 'brick_face_salmon', 'brick_face_red',
  'granite_cladding_light', 'granite_dark_tiles', 'stone_cladding_sand', 'metal_panel', 'window_frame_aluminium',
  'shutter_rolldown', 'concrete_raw', 'concrete_board_formed', 'roof_membrane', 'roof_gravel', 'corrugated_weathered',
  'ibr_sheet_painted', 'clay_tile_roof', 'window_glass',
];
// Phones: fewer layers, albedo + roughness only.
export const FACADE_SET_LOW = [
  'concrete_painted', 'plaster_smooth', 'brick_face_salmon', 'brick_face_red', 'granite_cladding_light', 'metal_panel',
  'window_frame_aluminium', 'shutter_rolldown', 'concrete_raw', 'roof_membrane', 'corrugated_weathered', 'clay_tile_roof',
  'window_glass',
];

export const GROUND_SET = [
  'asphalt_bleached', 'asphalt_patch', 'asphalt_cracked', 'pavement_slabs', 'pavers_interlocking', 'pavers_herringbone_red',
  'kerb_concrete', 'kerb_painted_bw', 'grass_dry', 'grass_patchy', 'grass_green', 'soil_red', 'gravel_grey',
];
export const GROUND_SET_LOW = [
  'asphalt_bleached', 'asphalt_patch', 'pavement_slabs', 'pavers_herringbone_red', 'kerb_painted_bw', 'grass_dry',
  'grass_green', 'soil_red',
];

// Materials authored near-neutral (tags "tintable"): their albedo is re-centred on the target
// colour (see materials.js cityAlbedo); the others keep their own colour and a tint multiplies it.
export const TINTABLE = new Set([
  'concrete_raw', 'concrete_board_formed', 'concrete_weathered', 'concrete_painted', 'plaster_smooth', 'plaster_textured',
  'plaster_peeling', 'brick_painted', 'block_painted', 'granite_cladding_light', 'metal_panel', 'window_frame_aluminium',
  'shutter_rolldown', 'ibr_sheet_painted', 'kerb_concrete', 'plastic_matte',
]);

const FALLBACK = {
  plaster_textured: 'plaster_smooth',
  plaster_peeling: 'plaster_smooth',
  granite_dark_tiles: 'granite_cladding_light',
  stone_cladding_sand: 'granite_cladding_light',
  concrete_board_formed: 'concrete_raw',
  concrete_weathered: 'concrete_raw',
  roof_gravel: 'roof_membrane',
  ibr_sheet_painted: 'corrugated_weathered',
  fibre_cement_roof: 'corrugated_weathered',
  corrugated_galvanised: 'corrugated_weathered',
  corrugated_rusty: 'corrugated_weathered',
  clay_tile_roof_old: 'clay_tile_roof',
  brick_painted: 'concrete_painted',
  block_painted: 'concrete_painted',
  asphalt_cracked: 'asphalt_bleached',
  pavers_interlocking: 'pavement_slabs',
  kerb_concrete: 'pavement_slabs',
  kerb_painted_yellow: 'kerb_painted_bw',
  grass_patchy: 'grass_dry',
  dirt_dry: 'soil_red',
  gravel_grey: 'soil_red',
  concrete_painted: 'plaster_smooth',
  metal_panel: 'window_frame_aluminium',
  shutter_rolldown: 'metal_panel',
};

// Loads every material of `names` through game.assets and packs the arrays.
export class PbrSet {
  constructor(names, { size = 512, normals = true } = {}) {
    this.names = names.slice();
    this.size = size;
    this.normals = normals;
    this.index = {};
    names.forEach((n, i) => (this.index[n] = i));
    this.count = names.length;
    // Per layer: [1 / tileU, 1 / tileV, tintable, roughness mean]
    this.info = new Float32Array(this.count * 4);
    // Per layer: linear average albedo (to tint towards a target colour: target / avg).
    this.avg = new Float32Array(this.count * 3);
    this.metal = new Float32Array(this.count);
    this.compressed = false;
    this.bytes = 0;
    this.texA = null;
    this.texB = null;
  }

  // Layer index of a material name, following FALLBACK for names not in this set.
  id(name) {
    let n = name;
    for (let k = 0; k < 6 && this.index[n] === undefined; k++) n = FALLBACK[n];
    return this.index[n] ?? 0;
  }

  has(name) {
    return this.index[name] !== undefined;
  }

  tile(name) {
    const i = this.id(name);
    return [1 / this.info[i * 4], 1 / this.info[i * 4 + 1]];
  }

  avgColor(name) {
    const i = this.id(name);
    return [this.avg[i * 3], this.avg[i * 3 + 1], this.avg[i * 3 + 2]];
  }

  // Fetch + decode (through the shared asset loader), then resample into the arrays.
  // compressSize: build BC3/BC5 arrays of that size when the GPU supports them.
  async load(assets, manifest, renderer, { compressSize = 0 } = {}) {
    const ext = renderer.extensions;
    const canCompress = compressSize > 0 && this.normals && ext.has('WEBGL_compressed_texture_s3tc') && ext.has('WEBGL_compressed_texture_s3tc_srgb') && ext.has('EXT_texture_compression_rgtc');
    if (canCompress) this.size = compressSize;
    const S = this.size;
    const byName = manifest?.materials ? Object.fromEntries(manifest.materials.map((m) => [m.name, m])) : {};
    const entries = this.names.map((n) => byName[n]);
    const base = 'textures/';
    const jobs = entries.map((e) => {
      if (!e) return Promise.resolve(null);
      const albedo = assets.textureAsync(base + e.files.albedo, { srgb: true });
      const orm = assets.textureAsync(base + e.files.orm, {});
      const normal = this.normals ? assets.textureAsync(base + e.files.normal, {}) : Promise.resolve(null);
      return Promise.all([albedo, orm, normal]).catch((err) => {
        console.warn('[city] PBR material failed to load', e.name, err);
        return null;
      });
    });
    const loaded = await Promise.all(jobs);

    const loadedEntries = { entries, loaded };
    if (canCompress) {
      try {
        await this._buildCompressed(loadedEntries, renderer);
        return this;
      } catch (err) {
        console.warn('[city] texture compression failed, using uncompressed 512 px layers', err);
        this.size = 512;
        return this.load(assets, manifest, renderer, {});
      }
    }
    const dataA = new Uint8Array(S * S * 4 * this.count);
    const dataB = this.normals ? new Uint8Array(S * S * 4 * this.count) : null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Draws an image into the S x S canvas; rows flipped so v = 0 is the bottom (texture convention
    // with flipY = true, which is what the maps were authored for).
    const read = (img) => {
      ctx.save();
      ctx.clearRect(0, 0, S, S);
      ctx.translate(0, S);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, 0, S, S);
      ctx.restore();
      return ctx.getImageData(0, 0, S, S).data;
    };
    this._fillInfo(entries);
    for (let i = 0; i < this.count; i++) {
      const maps = loaded[i];
      const off = i * S * S * 4;
      if (!maps) {
        // Missing material: flat mid grey, rough, flat normal.
        for (let p = 0; p < S * S; p++) {
          dataA.set([188, 188, 188, 204], off + p * 4);
          if (dataB) dataB.set([128, 128, 255, 0], off + p * 4);
        }
        continue;
      }
      const [albedo, orm, normal] = maps;
      const a = read(albedo.image);
      for (let p = 0; p < S * S * 4; p += 4) {
        dataA[off + p] = a[p];
        dataA[off + p + 1] = a[p + 1];
        dataA[off + p + 2] = a[p + 2];
      }
      const r = read(orm.image);
      for (let p = 0; p < S * S * 4; p += 4) dataA[off + p + 3] = r[p + 1];
      if (dataB) {
        const nrm = normal ? read(normal.image) : null;
        for (let p = 0; p < S * S * 4; p += 4) {
          dataB[off + p] = nrm ? nrm[p] : 128;
          dataB[off + p + 1] = nrm ? nrm[p + 1] : 128;
          dataB[off + p + 2] = r[p];
          dataB[off + p + 3] = r[p + 2];
        }
      }
    }
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const make = (data, srgb) => {
      const t = new THREE.DataArrayTexture(data, S, S, this.count);
      t.format = THREE.RGBAFormat;
      t.type = THREE.UnsignedByteType;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = aniso;
      t.needsUpdate = true;
      return t;
    };
    this.texA = make(dataA, true);
    this.texB = dataB ? make(dataB, false) : null;
    this.bytes = (dataA.length + (dataB ? dataB.length : 0)) * 1.334;
    // Release the CPU copies once the GPU has them.
    const drop = (t) => {
      t.onUpdate = () => {
        t.image.data = null;
        t.onUpdate = null;
      };
    };
    drop(this.texA);
    if (this.texB) drop(this.texB);
    return this;
  }
}

PbrSet.prototype._fillInfo = function (entries) {
  for (let i = 0; i < this.count; i++) {
    const e = entries[i];
    const o = i * 4;
    if (e) {
      this.info[o] = 1 / e.tileSizeMetres[0];
      this.info[o + 1] = 1 / e.tileSizeMetres[1];
      this.info[o + 2] = e.tags?.includes('tintable') ? 1 : 0;
      this.info[o + 3] = e.roughnessMean ?? 0.8;
      this.avg.set(e.avgColorLinear || [0.5, 0.5, 0.5], i * 3);
      this.metal[i] = e.metalnessMean ?? 0;
    } else {
      this.info.set([0.5, 0.5, 1, 0.8], o);
      this.avg.set([0.5, 0.5, 0.5], i * 3);
    }
  }
};

// Compressed arrays: per layer, read the maps at S px, pack RGBA (albedo * AO, roughness) and
// (normal xy), encode in workers, assemble one CompressedArrayTexture per map type.
PbrSet.prototype._buildCompressed = async function ({ entries, loaded }, renderer) {
  const S = this.size;
  this._fillInfo(entries);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const read = (img) => {
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.translate(0, S);
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, 0, S, S);
    ctx.restore();
    return ctx.getImageData(0, 0, S, S).data;
  };
  const pack = (i) => {
    const a = new Uint8Array(S * S * 4);
    const n = new Uint8Array(S * S * 4);
    const maps = loaded[i];
    if (!maps) {
      for (let p = 0; p < S * S * 4; p += 4) {
        a[p] = a[p + 1] = a[p + 2] = 188;
        a[p + 3] = 204;
        n[p] = n[p + 1] = 128;
      }
      return { a, n };
    }
    const [albedo, orm, normal] = maps;
    const al = read(albedo.image);
    const r = read(orm.image);
    for (let p = 0; p < S * S * 4; p += 4) {
      const ao = 0.5 + (0.5 * r[p]) / 255;
      a[p] = al[p] * ao;
      a[p + 1] = al[p + 1] * ao;
      a[p + 2] = al[p + 2] * ao;
      a[p + 3] = r[p + 1];
    }
    const nm = normal ? read(normal.image) : null;
    for (let p = 0; p < S * S * 4; p += 4) {
      n[p] = nm ? nm[p] : 128;
      n[p + 1] = nm ? nm[p + 1] : 128;
    }
    return { a, n };
  };
  const results = await encodeLayers(this.count, pack, S);
  const levels = results[0].a.length;
  const mipsA = [];
  const mipsB = [];
  let bytes = 0;
  for (let l = 0; l < levels; l++) {
    const w = Math.max(1, S >> l);
    const la = results[0].a[l].length;
    const ln = results[0].n[l].length;
    const A = new Uint8Array(la * this.count);
    const B = new Uint8Array(ln * this.count);
    for (let i = 0; i < this.count; i++) {
      A.set(results[i].a[l], i * la);
      B.set(results[i].n[l], i * ln);
    }
    mipsA.push({ data: A, width: w, height: w });
    mipsB.push({ data: B, width: w, height: w });
    bytes += A.length + B.length;
  }
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const make = (mips, format, srgb) => {
    const t = new THREE.CompressedArrayTexture(mips, S, S, this.count, format);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = false;
    t.anisotropy = aniso;
    t.needsUpdate = true;
    return t;
  };
  this.texA = make(mipsA, THREE.RGBA_S3TC_DXT5_Format, true);
  this.texB = make(mipsB, THREE.RED_GREEN_RGTC2_Format, false);
  this.compressed = true;
  this.bytes = bytes;
};

// Encodes `count` layers (pack(i) -> {a, n} RGBA arrays) on a small worker pool, falling back to
// the main thread. Resolves to [{a: [levels], n: [levels]}].
async function encodeLayers(count, pack, S) {
  const results = new Array(count);
  let workers = [];
  try {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let k = 0; k < n; k++) workers.push(new Worker(new URL('./bcWorker.js', import.meta.url), { type: 'module' }));
  } catch {
    workers = [];
  }
  if (!workers.length) {
    for (let i = 0; i < count; i++) {
      const { a, n } = pack(i);
      results[i] = { a: encodeLayer(a, S, 'bc3'), n: encodeLayer(n, S, 'bc5') };
      await new Promise((r) => setTimeout(r, 0));
    }
    return results;
  }
  return new Promise((resolve, reject) => {
    let next = 0;
    let done = 0;
    const feed = (w) => {
      if (next >= count) return;
      const i = next++;
      const { a, n } = pack(i);
      w.postMessage({ id: i, S, a, n }, [a.buffer, n.buffer]);
    };
    for (const w of workers) {
      w.onmessage = (e) => {
        const { id, a, n, error } = e.data;
        if (error) {
          for (const x of workers) x.terminate();
          reject(new Error(error));
          return;
        }
        results[id] = { a, n };
        if (++done === count) {
          for (const x of workers) x.terminate();
          resolve(results);
        } else {
          feed(w);
        }
      };
      w.onerror = (err) => {
        for (const x of workers) x.terminate();
        reject(err);
      };
    }
    for (const w of workers) feed(w);
  });
}

// Interior-mapping atlas (glass/interiors.json): 4 x 2 rooms rendered in Blender.
export async function loadInteriors(assets, small) {
  const meta = (await assets.json('textures/glass/interiors.json')) || { atlas: 'glass/interiors_atlas.webp', atlasSmall: 'glass/interiors_atlas_small.webp', grid: [4, 2] };
  const url = 'textures/' + (small ? meta.atlasSmall : meta.atlas);
  const tex = await assets.textureAsync(url, { srgb: true, anisotropy: 4 });
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const [w, h] = small ? meta.sizeSmall || [1024, 512] : meta.size || [2048, 1024];
  return { tex, grid: meta.grid || [4, 2], bytes: w * h * 4 * 1.334, cells: meta.cells || [] };
}
