import * as THREE from 'three';
import { makeRng } from '../../core/rng.js';

// Tileable value-noise texture (RGBA8, 256 x 256, repeat, mipmapped) for large-scale variation,
// weathering and blend masks in the city shaders. Four independent fbm channels:
//   r, g: smooth 4-octave fbm (macro tint / blotches)   b: 5-octave fbm (streaks when stretched)
//   a: high-frequency 3-octave fbm (paint wear, speckle)
// Values are stretched to cover ~0..1 (mean ~0.5).
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const channel = (seed, octaves, base) => {
    const rng = makeRng(seed);
    const acc = new Float32Array(size * size);
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const cells = base << o;
      const amp = Math.pow(0.55, o);
      norm += amp;
      const grid = new Float32Array(cells * cells);
      for (let i = 0; i < grid.length; i++) grid[i] = rng();
      for (let y = 0; y < size; y++) {
        const gy = (y / size) * cells;
        const y0 = Math.floor(gy);
        const fy = gy - y0;
        const sy = fy * fy * (3 - 2 * fy);
        const r0 = (y0 % cells) * cells;
        const r1 = ((y0 + 1) % cells) * cells;
        for (let x = 0; x < size; x++) {
          const gx = (x / size) * cells;
          const x0 = Math.floor(gx);
          const fx = gx - x0;
          const sx = fx * fx * (3 - 2 * fx);
          const c0 = x0 % cells;
          const c1 = (x0 + 1) % cells;
          const a = grid[r0 + c0];
          const b = grid[r0 + c1];
          const c = grid[r1 + c0];
          const d = grid[r1 + c1];
          acc[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
        }
      }
    }
    // Contrast-stretch to ~0..1 around the mean.
    let mean = 0;
    for (let i = 0; i < acc.length; i++) mean += acc[i] /= norm;
    mean /= acc.length;
    let dev = 0;
    for (let i = 0; i < acc.length; i++) dev += (acc[i] - mean) ** 2;
    dev = Math.sqrt(dev / acc.length) || 1;
    return (i) => Math.max(0, Math.min(255, Math.round((0.5 + ((acc[i] - mean) / dev) * 0.2) * 255)));
  };
  const r = channel(11, 4, 4);
  const g = channel(23, 4, 4);
  const b = channel(37, 5, 8);
  const a = channel(51, 3, 32);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = r(i);
    data[i * 4 + 1] = g(i);
    data[i * 4 + 2] = b(i);
    data[i * 4 + 3] = a(i);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  tex.bytes = size * size * 4 * 1.334;
  return tex;
}
