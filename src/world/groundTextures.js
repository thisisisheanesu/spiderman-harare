import * as THREE from 'three';
import { Painter } from './atlas.js';
import { polyArea } from '../core/geo.js';
import { GROUND_CANVAS_BASE, GROUND_PAINT } from './render/groundShader.js';

// Ground surfaces: the CC0 PBR ground set (render/pbrLibrary.js) for roads, pavements, kerbs,
// grass and soil; a few painted canvas layers for what has no PBR counterpart.

function ballast(p) {
  // u across the track bed (0..1 = 3.2 m), v along it (1 tile = 2.6 m, 4 sleepers).
  p.rect(0, 0, 1, 1, '#8a8278');
  p.speckle(p.S * 160, ['rgba(40,35,30,0.45)', 'rgba(200,190,175,0.4)', 'rgba(120,90,70,0.35)'], p.S / 180);
  for (let k = 0; k < 4; k++) {
    const y = (k + 0.25) / 4;
    p.rect(0.12, y, 0.88, y + 0.09, '#6b5a4a');
    p.rect(0.12, y + 0.075, 0.88, y + 0.09, 'rgba(0,0,0,0.3)');
  }
  p.rect(0.26, 0, 0.29, 1, 'rgba(90,60,40,0.6)');
  p.rect(0.71, 0, 0.74, 1, 'rgba(90,60,40,0.6)');
  p.grime(0.3, 1);
}

function rock(p) {
  p.rect(0, 0, 1, 1, '#9d968c');
  p.grime(0.6, 0.5);
  p.speckle(p.S * 100, ['rgba(30,30,30,0.35)', 'rgba(230,225,215,0.35)', 'rgba(160,110,90,0.25)'], p.S / 250);
  for (let i = 0; i < 14; i++) {
    const x = p.rng() * p.S;
    const y = p.rng() * p.S;
    const r = (0.02 + p.rng() * 0.05) * p.S;
    const g = p.c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(150,160,90,0.35)');
    g.addColorStop(1, 'rgba(150,160,90,0)');
    p.c.fillStyle = g;
    p.c.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
}

function flowers(p) {
  p.rect(0, 0, 1, 1, '#6b4a33');
  p.grime(0.3, 1);
  p.speckle(p.S * 5, ['rgba(60,110,50,0.9)', 'rgba(80,130,60,0.9)'], p.S / 90);
  p.speckle(p.S * 6, ['rgba(216,52,74,1)', 'rgba(242,194,48,1)', 'rgba(244,240,232,1)', 'rgba(224,96,154,1)', 'rgba(240,138,48,1)'], p.S / 120);
}

// Canvas-painted ground layers that have no PBR counterpart (UV scale: metres per tile).
const CANVAS_LAYERS = {
  ballast: [ballast, 2.6],
  rock: [rock, 7],
  flowers: [flowers, 3],
};

// Ground layer names -> PBR ground material (render/pbrLibrary.js GROUND_SET).
const PBR_LAYERS = {
  asphalt: 'asphalt_bleached',
  paving: 'pavement_slabs',
  bricks: 'pavers_herringbone_red',
  grass: 'grass_green',
  dryGrass: 'grass_dry',
  dirt: 'soil_red',
  concrete: 'pavers_interlocking',
  kerb: 'kerb_concrete',
  kerbPaint: 'kerb_painted_bw',
};

// Registers the canvas layers on `atlas` and returns {G: name -> ground layer code (see
// render/groundShader.js), scale: name -> metres per uv unit for canvas layers (PBR layers take
// world-space metres)}.
export function paintGroundLayers(atlas, set) {
  const scale = {};
  const G = {};
  let seed = 501;
  for (const [name, [draw, s]] of Object.entries(CANVAS_LAYERS)) {
    const i = atlas.add(name, (c, m, S) => draw(new Painter(c, m, S, seed++)));
    G[name] = GROUND_CANVAS_BASE + i;
    scale[name] = s;
  }
  for (const [name, mat] of Object.entries(PBR_LAYERS)) {
    G[name] = set.id(mat);
    scale[name] = 1;
  }
  G.paint = GROUND_PAINT;
  scale.paint = 1;
  return { G, scale };
}

// Low-res "how urban is it here" mask over the map (1 = paved city block, 0 = dry veld/gardens).
export function buildUrbanMask(buildings, bounds, res = 256) {
  const pad = 400;
  const x0 = bounds.minX - pad;
  const z0 = bounds.minZ - pad;
  const w = bounds.maxX - bounds.minX + 2 * pad;
  const h = bounds.maxZ - bounds.minZ + 2 * pad;
  // Built-up coverage per cell (core buildings' footprint area spread over their bounding box).
  const acc = new Float32Array(res * res);
  const cw = w / res;
  const ch = h / res;
  for (const b of buildings) {
    if (!b.core) continue;
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxZ - b.minZ);
    const fill = Math.min(1, polyArea(b.fp) / (bw * bh));
    for (let ix = Math.floor((b.minX - x0) / cw); ix <= Math.floor((b.maxX - x0) / cw); ix++) {
      for (let iz = Math.floor((b.minZ - z0) / ch); iz <= Math.floor((b.maxZ - z0) / ch); iz++) {
        if (ix < 0 || iz < 0 || ix >= res || iz >= res) continue;
        const ox = Math.min(b.maxX, x0 + (ix + 1) * cw) - Math.max(b.minX, x0 + ix * cw);
        const oz = Math.min(b.maxZ, z0 + (iz + 1) * ch) - Math.max(b.minZ, z0 + iz * ch);
        acc[iz * res + ix] += (Math.max(0, ox) * Math.max(0, oz) * fill) / (cw * ch);
      }
    }
  }
  // Two box blurs.
  const tmp = new Float32Array(res * res);
  const blur = (src, dst, r) => {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= res) continue;
          s += src[y * res + xx];
          n++;
        }
        tmp[y * res + x] = s / n;
      }
    }
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= res) continue;
          s += tmp[yy * res + x];
          n++;
        }
        dst[y * res + x] = s / n;
      }
    }
  };
  const out = new Float32Array(res * res);
  blur(acc, out, 3);
  blur(out, acc, 2);
  const data = new Uint8Array(res * res * 4);
  for (let i = 0; i < res * res; i++) {
    const v = Math.min(1, Math.max(0, (acc[i] - 0.06) * 4));
    data[i * 4] = Math.round(v * 255);
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  // DataTexture row 0 is v = 0, which is z0 here, so uv = (x - x0) / w, (z - z0) / h.
  const at = (x, z) => {
    const ix = Math.floor(((x - x0) / w) * res);
    const iz = Math.floor(((z - z0) / h) * res);
    if (ix < 0 || iz < 0 || ix >= res || iz >= res) return 0;
    return data[(iz * res + ix) * 4] / 255;
  };
  return { texture, rect: new THREE.Vector4(x0, z0, w, h), at };
}
