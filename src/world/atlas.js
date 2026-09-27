import * as THREE from 'three';
import { makeRng } from '../core/rng.js';

// Texture-array builder. Each layer is painted on two canvases:
//   color - the albedo (sRGB)
//   mask  - greyscale, stored in alpha: 0 = opaque surface, 128..255 = glass, where the value
//           encodes the height inside the pane (128 bottom .. 255 top) so the shader can draw
//           blinds and per-pane variation.
// Layers are square (size x size) and wrap (REPEAT), so UVs in "tiles" repeat for free.
export class LayerAtlas {
  constructor(size) {
    this.size = size;
    this.layers = [];
    this.index = {};
  }

  add(name, draw) {
    const S = this.size;
    const color = makeCanvas(S);
    const mask = makeCanvas(S);
    // Painted once, then read back (speckle, build): CPU-backed canvases avoid GPU readbacks.
    const c = color.getContext('2d', { willReadFrequently: true });
    const m = mask.getContext('2d', { willReadFrequently: true });
    m.fillStyle = '#000';
    m.fillRect(0, 0, S, S);
    draw(c, m, S);
    const id = this.layers.length;
    this.layers.push({ name, color, mask });
    this.index[name] = id;
    return id;
  }

  build(renderer) {
    const S = this.size;
    const n = this.layers.length;
    const data = new Uint8Array(S * S * 4 * n);
    this.layers.forEach((layer, li) => {
      const col = layer.color.getContext('2d').getImageData(0, 0, S, S).data;
      const msk = layer.mask.getContext('2d').getImageData(0, 0, S, S).data;
      const base = li * S * S * 4;
      // Flip rows so canvas top = v 1 (top of a wall tile).
      for (let y = 0; y < S; y++) {
        const src = (S - 1 - y) * S * 4;
        const dst = base + y * S * 4;
        for (let x = 0; x < S * 4; x += 4) {
          data[dst + x] = col[src + x];
          data[dst + x + 1] = col[src + x + 1];
          data[dst + x + 2] = col[src + x + 2];
          data[dst + x + 3] = msk[src + x];
        }
      }
      layer.color = layer.mask = null;
    });
    const tex = new THREE.DataArrayTexture(data, S, S, n);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    this.bytes = data.length * 1.34;
    return tex;
  }
}

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Shared tileable value-noise canvas (grey, mean ~0.5) used to dirty up painted surfaces.
let noiseCanvas = null;
export function noiseTile(size = 256) {
  if (noiseCanvas && noiseCanvas.width === size) return noiseCanvas;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rng = makeRng(1234);
  const octaves = [
    [8, 0.5],
    [16, 0.25],
    [32, 0.15],
    [128, 0.1],
  ];
  const acc = new Float32Array(size * size);
  for (const [cells, amp] of octaves) {
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rng();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * cells;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const a = grid[(y0 % cells) * cells + (x0 % cells)];
        const b = grid[(y0 % cells) * cells + ((x0 + 1) % cells)];
        const c2 = grid[((y0 + 1) % cells) * cells + (x0 % cells)];
        const d = grid[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
        acc[y * size + x] += amp * (a + (b - a) * sx + (c2 - a) * sy + (a - b - c2 + d) * sx * sy);
      }
    }
  }
  for (let i = 0; i < acc.length; i++) {
    const v = Math.max(0, Math.min(255, acc[i] * 255));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  noiseCanvas = c;
  return c;
}

// Painting helpers working in normalised tile coordinates (0..1, y down from the top of the tile).
export class Painter {
  constructor(ctx, mask, S, seed = 1) {
    this.c = ctx;
    this.m = mask;
    this.S = S;
    this.rng = makeRng(seed);
  }

  rect(x0, y0, x1, y1, fill) {
    const S = this.S;
    this.c.fillStyle = fill;
    this.c.fillRect(x0 * S, y0 * S, (x1 - x0) * S, (y1 - y0) * S);
  }

  vgrad(x0, y0, x1, y1, top, bottom) {
    const S = this.S;
    const g = this.c.createLinearGradient(0, y0 * S, 0, y1 * S);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    this.c.fillStyle = g;
    this.c.fillRect(x0 * S, y0 * S, (x1 - x0) * S, (y1 - y0) * S);
  }

  hgrad(x0, y0, x1, y1, left, right) {
    const S = this.S;
    const g = this.c.createLinearGradient(x0 * S, 0, x1 * S, 0);
    g.addColorStop(0, left);
    g.addColorStop(1, right);
    this.c.fillStyle = g;
    this.c.fillRect(x0 * S, y0 * S, (x1 - x0) * S, (y1 - y0) * S);
  }

  // Glass pane: painted colour + mask gradient (255 at the top .. 128 at the bottom).
  glass(x0, y0, x1, y1, top = '#5d6b76', bottom = '#35414a') {
    this.vgrad(x0, y0, x1, y1, top, bottom);
    const S = this.S;
    const g = this.m.createLinearGradient(0, y0 * S, 0, y1 * S);
    g.addColorStop(0, '#fff');
    g.addColorStop(1, '#808080');
    this.m.fillStyle = g;
    this.m.fillRect(x0 * S, y0 * S, (x1 - x0) * S, (y1 - y0) * S);
  }

  // Opaque rect that also clears the mask (frames/mullions/bars over glass).
  solid(x0, y0, x1, y1, fill) {
    this.rect(x0, y0, x1, y1, fill);
    const S = this.S;
    this.m.fillStyle = '#000';
    this.m.fillRect(x0 * S, y0 * S, (x1 - x0) * S, (y1 - y0) * S);
  }

  line(x0, y0, x1, y1, stroke, width) {
    const S = this.S;
    this.c.strokeStyle = stroke;
    this.c.lineWidth = width * S;
    this.c.beginPath();
    this.c.moveTo(x0 * S, y0 * S);
    this.c.lineTo(x1 * S, y1 * S);
    this.c.stroke();
  }

  // Multiplies tileable noise over the whole layer (strength 0..1).
  grime(strength = 0.25, scale = 1) {
    const S = this.S;
    const n = noiseTile();
    this.c.save();
    this.c.globalCompositeOperation = 'multiply';
    this.c.globalAlpha = strength;
    const w = S * scale;
    for (let x = 0; x < S; x += w) for (let y = 0; y < S; y += w) this.c.drawImage(n, x, y, w, w);
    this.c.restore();
  }

  // Fine speckle (aggregate, render texture). Written straight into the pixels: thousands of
  // fillRect calls are very slow on software canvases.
  speckle(count, colors, size = 1.5) {
    const S = this.S;
    const img = this.c.getImageData(0, 0, S, S);
    const d = img.data;
    const cols = colors.map((c) => c.match(/[\d.]+/g).map(Number));
    for (let i = 0; i < count; i++) {
      const [r, g, b, a] = cols[Math.floor(this.rng() * cols.length)];
      const s = Math.max(1, Math.round(size * (0.5 + this.rng())));
      const x0 = Math.floor(this.rng() * S);
      const y0 = Math.floor(this.rng() * S);
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          const o = (((y0 + dy) % S) * S + ((x0 + dx) % S)) * 4;
          d[o] += (r - d[o]) * a;
          d[o + 1] += (g - d[o + 1]) * a;
          d[o + 2] += (b - d[o + 2]) * a;
        }
      }
    }
    this.c.putImageData(img, 0, 0);
  }

  // Soft vertical streaks (rain/dirt runs) below y0.
  streaks(y0, y1, count, color, alpha = 0.12) {
    const S = this.S;
    this.c.save();
    for (let i = 0; i < count; i++) {
      const x = this.rng() * S;
      const w = (0.004 + this.rng() * 0.012) * S;
      const len = (0.3 + this.rng() * 0.7) * (y1 - y0) * S;
      const g = this.c.createLinearGradient(0, y0 * S, 0, y0 * S + len);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      this.c.globalAlpha = alpha * (0.4 + this.rng());
      this.c.fillStyle = g;
      this.c.fillRect(x, y0 * S, w, len);
    }
    this.c.restore();
  }
}
