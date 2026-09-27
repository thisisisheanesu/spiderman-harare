import * as THREE from 'three';

// The CC0 PBR materials of public/textures (see its README) packed into texture arrays, so the
// merged city meshes keep one material (and one draw call) per chunk:
//   A array (sRGB):   rgb = albedo, a = roughness (ORM.g; sRGB textures store alpha linearly)
//   B array (linear): rg = tangent-space normal xy (OpenGL, +Y up), b = ambient occlusion (ORM.r),
//                     a = metalness (ORM.b)          -- omitted on 'low' (no normal mapping on phones)
// Every layer is resampled to one square size; tileSizeMetres keeps non-square sources right.
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
  async load(assets, manifest, renderer) {
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
    for (let i = 0; i < this.count; i++) {
      const e = entries[i];
      const o = i * 4;
      if (e) {
        this.info[o] = 1 / e.tileSizeMetres[0];
        this.info[o + 1] = 1 / e.tileSizeMetres[1];
        this.info[o + 2] = e.tags?.includes('tintable') ? 1 : 0;
        this.info[o + 3] = e.roughnessMean ?? 0.8;
        this.avg.set(e.avgColorLinear || [0.5, 0.5, 0.5], i * 3);
      } else {
        this.info.set([0.5, 0.5, 1, 0.8], o);
        this.avg.set([0.5, 0.5, 0.5], i * 3);
      }
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
