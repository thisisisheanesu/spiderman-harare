import * as THREE from 'three';
import { Painter, noiseTile } from './atlas.js';

// Ground surface layers (UV scale noted per layer: metres per tile).
function asphalt(p) {
  p.rect(0, 0, 1, 1, '#5d5c5a');
  p.grime(0.5, 1);
  p.speckle(p.S * 60, ['rgba(0,0,0,0.25)', 'rgba(255,255,255,0.12)', 'rgba(120,100,80,0.2)'], p.S / 400);
  // Patches and cracks.
  for (let i = 0; i < 4; i++) {
    const x = p.rng() * 0.8;
    const y = p.rng() * 0.8;
    p.rect(x, y, x + 0.1 + p.rng() * 0.15, y + 0.06 + p.rng() * 0.12, `rgba(${p.rng() < 0.5 ? '30,30,30' : '110,108,104'},0.35)`);
  }
  for (let i = 0; i < 10; i++) {
    let x = p.rng();
    let y = p.rng();
    p.c.strokeStyle = 'rgba(20,20,20,0.45)';
    p.c.lineWidth = p.S / 400;
    p.c.beginPath();
    p.c.moveTo(x * p.S, y * p.S);
    for (let k = 0; k < 6; k++) {
      x += (p.rng() - 0.5) * 0.06;
      y += (p.rng() - 0.5) * 0.06;
      p.c.lineTo(x * p.S, y * p.S);
    }
    p.c.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const x = p.rng() * p.S;
    const y = p.rng() * p.S;
    const g = p.c.createRadialGradient(x, y, 0, x, y, p.S * 0.06);
    g.addColorStop(0, 'rgba(15,15,15,0.4)');
    g.addColorStop(1, 'rgba(15,15,15,0)');
    p.c.fillStyle = g;
    p.c.fillRect(0, 0, p.S, p.S);
  }
}

function paving(p) {
  // 600 mm concrete slabs, red dust in the joints.
  p.rect(0, 0, 1, 1, '#b9ada0');
  const n = 5;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const t = 0.9 + p.rng() * 0.18;
      const v = Math.round(200 * t);
      p.rect(i / n + 0.004, j / n + 0.004, (i + 1) / n - 0.004, (j + 1) / n - 0.004, `rgb(${v},${Math.round(v * 0.96)},${Math.round(v * 0.9)})`);
    }
  }
  p.grime(0.35, 1);
  p.speckle(p.S * 30, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.1)', 'rgba(150,80,50,0.12)'], p.S / 350);
}

function bricks(p) {
  // Herringbone clay pavers (First Street Mall).
  p.rect(0, 0, 1, 1, '#6f5f55');
  const tones = ['#9b6d5a', '#a87a66', '#8f6555', '#b0856f', '#8a6858', '#a09080'];
  const u = 1 / 16;
  for (let i = -2; i < 18; i++) {
    for (let j = -2; j < 18; j++) {
      const x = (i + j) * u;
      const y = (j - i) * u * 0.5 + (i % 2) * u;
      p.rect(x + 0.003, y + 0.003, x + 2 * u - 0.003, y + u - 0.003, tones[Math.floor(p.rng() * tones.length)]);
      p.rect(x + u + 0.003, y + u + 0.003, x + 2 * u - 0.003, y + 3 * u - 0.003, tones[Math.floor(p.rng() * tones.length)]);
    }
  }
  p.grime(0.3, 1);
}

function grass(p) {
  p.rect(0, 0, 1, 1, '#7b8a4c');
  p.grime(0.5, 1);
  p.speckle(p.S * 120, ['rgba(50,70,25,0.35)', 'rgba(170,170,95,0.35)', 'rgba(125,135,65,0.35)', 'rgba(180,160,105,0.3)'], p.S / 300);
}

function dryGrass(p) {
  p.rect(0, 0, 1, 1, '#b39a67');
  p.grime(0.5, 1);
  p.speckle(p.S * 120, ['rgba(90,70,40,0.35)', 'rgba(210,190,130,0.35)', 'rgba(120,110,60,0.3)', 'rgba(160,80,50,0.2)'], p.S / 300);
}

function dirt(p) {
  p.rect(0, 0, 1, 1, '#a0644a');
  p.grime(0.45, 1);
  p.speckle(p.S * 80, ['rgba(60,30,20,0.3)', 'rgba(200,150,110,0.3)', 'rgba(120,120,110,0.25)'], p.S / 300);
}

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

function concrete(p) {
  p.rect(0, 0, 1, 1, '#b6b1a8');
  p.grime(0.4, 1);
  p.speckle(p.S * 40, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.1)'], p.S / 350);
  p.rect(0, 0.497, 1, 0.503, 'rgba(0,0,0,0.12)');
  p.rect(0.497, 0, 0.503, 1, 'rgba(0,0,0,0.12)');
}

function kerb(p) {
  p.rect(0, 0, 1, 1, '#c9c4ba');
  p.grime(0.35, 1);
  for (let x = 0; x < 1; x += 0.25) p.rect(x, 0, x + 0.006, 1, 'rgba(0,0,0,0.25)');
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

function macro(p) {
  const n = noiseTile();
  p.c.drawImage(n, 0, 0, p.S, p.S);
  p.c.globalCompositeOperation = 'overlay';
  p.c.drawImage(n, 0, 0, p.S * 2, p.S * 2);
  p.c.drawImage(n, -p.S, -p.S, p.S * 2, p.S * 2);
  p.c.globalCompositeOperation = 'source-over';
}

function paint(p) {
  p.rect(0, 0, 1, 1, '#f2f1ec');
  p.speckle(p.S * 50, ['rgba(80,80,80,0.5)', 'rgba(120,110,100,0.35)'], p.S / 150);
  p.grime(0.3, 1);
}

function flowers(p) {
  p.rect(0, 0, 1, 1, '#6b4a33');
  p.grime(0.3, 1);
  p.speckle(p.S * 5, ['rgba(60,110,50,0.9)', 'rgba(80,130,60,0.9)'], p.S / 90);
  p.speckle(p.S * 6, ['rgba(216,52,74,1)', 'rgba(242,194,48,1)', 'rgba(244,240,232,1)', 'rgba(224,96,154,1)', 'rgba(240,138,48,1)'], p.S / 120);
}

export const GROUND_LAYERS = {
  asphalt: [asphalt, 7],
  paving: [paving, 3],
  bricks: [bricks, 2.4],
  grass: [grass, 6],
  dryGrass: [dryGrass, 9],
  dirt: [dirt, 6],
  ballast: [ballast, 2.6],
  concrete: [concrete, 4],
  kerb: [kerb, 2],
  rock: [rock, 7],
  macro: [macro, 173],
  paint: [paint, 2],
  flowers: [flowers, 3],
};

export function paintGroundLayers(atlas) {
  const scale = {};
  let seed = 501;
  for (const [name, [draw, s]] of Object.entries(GROUND_LAYERS)) {
    atlas.add(name, (c, m, S) => draw(new Painter(c, m, S, seed++)));
    scale[name] = s;
  }
  return scale;
}

// Low-res "how urban is it here" mask over the map (1 = paved city block, 0 = dry veld/gardens).
export function buildUrbanMask(buildings, bounds, res = 256) {
  const pad = 400;
  const x0 = bounds.minX - pad;
  const z0 = bounds.minZ - pad;
  const w = bounds.maxX - bounds.minX + 2 * pad;
  const h = bounds.maxZ - bounds.minZ + 2 * pad;
  const acc = new Float32Array(res * res);
  for (const b of buildings) {
    if (!b.core) continue;
    const ix = Math.floor(((b.cx - x0) / w) * res);
    const iz = Math.floor(((b.cz - z0) / h) * res);
    if (ix < 0 || iz < 0 || ix >= res || iz >= res) continue;
    acc[iz * res + ix] += 1;
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
    const v = Math.min(1, acc[i] * 3.5);
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
