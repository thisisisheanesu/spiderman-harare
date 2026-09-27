// Real-time block compression for the PBR texture arrays (desktop 'high' profile), so the city can
// use 1024 px materials in the memory 512 px ones would take uncompressed:
//   BC3 (DXT5): rgb = albedo, a = roughness          1 byte / texel
//   BC5 (RGTC2): rg = tangent-space normal xy          1 byte / texel
// Colour endpoints: bounding box inset along the channel-covariance diagonal (J.M.P. van Waveren,
// "Real-Time DXT Compression", 2006); alpha / normal channels: 8-value BC4 blocks from min / max.
// Mip chains are box-filtered here (compressed textures cannot generateMipmap). Pure functions,
// used by bcWorker.js (and on the main thread as a fallback).

const P = new Int32Array(16 * 4);

function bc4Block(src, stride, off, w, x0, y0, ch, out, o) {
  let lo = 255;
  let hi = 0;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = src[off + ((y0 + y) * w + x0 + x) * stride + ch];
      P[y * 4 + x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  out[o] = hi;
  out[o + 1] = lo;
  let bits = 0;
  let nb = 0;
  let p = o + 2;
  const range = hi - lo;
  for (let i = 0; i < 16; i++) {
    let idx;
    if (range === 0) idx = 0;
    else {
      const t = Math.round(((P[i] - lo) * 7) / range);
      // t = 7 -> hi (index 0), t = 0 -> lo (index 1), 6..1 -> indices 2..7
      idx = t === 7 ? 0 : t === 0 ? 1 : 8 - t;
    }
    bits |= idx << nb;
    nb += 3;
    while (nb >= 8) {
      out[p++] = bits & 255;
      bits >>>= 8;
      nb -= 8;
    }
  }
}

function to565(r, g, b) {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

function bc1Colour(src, off, w, x0, y0, out, o) {
  let minR = 255;
  let minG = 255;
  let minB = 255;
  let maxR = 0;
  let maxG = 0;
  let maxB = 0;
  let sR = 0;
  let sG = 0;
  let sB = 0;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const i = off + ((y0 + y) * w + x0 + x) * 4;
      const r = src[i];
      const g = src[i + 1];
      const b = src[i + 2];
      const k = (y * 4 + x) * 4;
      P[k] = r;
      P[k + 1] = g;
      P[k + 2] = b;
      if (r < minR) minR = r;
      if (g < minG) minG = g;
      if (b < minB) minB = b;
      if (r > maxR) maxR = r;
      if (g > maxG) maxG = g;
      if (b > maxB) maxB = b;
      sR += r;
      sG += g;
      sB += b;
    }
  }
  // Pick the bounding-box diagonal that follows the colour covariance.
  const mR = sR / 16;
  const mG = sG / 16;
  const mB = sB / 16;
  let cRG = 0;
  let cGB = 0;
  for (let i = 0; i < 16; i++) {
    const dr = P[i * 4] - mR;
    const dg = P[i * 4 + 1] - mG;
    const db = P[i * 4 + 2] - mB;
    cRG += dr * dg;
    cGB += dg * db;
  }
  if (cRG < 0) {
    const t = minR;
    minR = maxR;
    maxR = t;
  }
  if (cGB < 0) {
    const t = minB;
    minB = maxB;
    maxB = t;
  }
  // Inset by 1/16 of the range (less error at the ends).
  const iR = (maxR - minR) >> 4;
  const iG = (maxG - minG) >> 4;
  const iB = (maxB - minB) >> 4;
  const aR = Math.max(0, Math.min(255, maxR - iR));
  const aG = Math.max(0, Math.min(255, maxG - iG));
  const aB = Math.max(0, Math.min(255, maxB - iB));
  const bR = Math.max(0, Math.min(255, minR + iR));
  const bG = Math.max(0, Math.min(255, minG + iG));
  const bB = Math.max(0, Math.min(255, minB + iB));
  let c0 = to565(aR, aG, aB);
  let c1 = to565(bR, bG, bB);
  // Expanded endpoint colours.
  const ex = (c, sh, bits) => {
    const v = (c >> sh) & ((1 << bits) - 1);
    return bits === 5 ? (v << 3) | (v >> 2) : (v << 2) | (v >> 4);
  };
  let r0 = ex(c0, 11, 5);
  let g0 = ex(c0, 5, 6);
  let b0 = ex(c0, 0, 5);
  let r1 = ex(c1, 11, 5);
  let g1 = ex(c1, 5, 6);
  let b1 = ex(c1, 0, 5);
  out[o] = c0 & 255;
  out[o + 1] = c0 >> 8;
  out[o + 2] = c1 & 255;
  out[o + 3] = c1 >> 8;
  const dR = r0 - r1;
  const dG = g0 - g1;
  const dB = b0 - b1;
  const dd = dR * dR + dG * dG + dB * dB;
  let bits = 0;
  for (let i = 15; i >= 0; i--) {
    let idx = 0;
    if (dd > 0) {
      const t = ((P[i * 4] - r1) * dR + (P[i * 4 + 1] - g1) * dG + (P[i * 4 + 2] - b1) * dB) / dd;
      // t ~ 1 -> c0 (0), 2/3 -> 2, 1/3 -> 3, 0 -> c1 (1)
      idx = t > 0.8333 ? 0 : t > 0.5 ? 2 : t > 0.1667 ? 3 : 1;
    }
    bits = (bits << 2) | idx;
  }
  out[o + 4] = bits & 255;
  out[o + 5] = (bits >>> 8) & 255;
  out[o + 6] = (bits >>> 16) & 255;
  out[o + 7] = (bits >>> 24) & 255;
}

// Next mip (box filter). normal: renormalise the xy of tangent-space normals.
function downsample(src, w, h, normal) {
  const nw = Math.max(1, w >> 1);
  const nh = Math.max(1, h >> 1);
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const x0 = Math.min(w - 1, x * 2);
      const x1 = Math.min(w - 1, x * 2 + 1);
      const y0 = Math.min(h - 1, y * 2);
      const y1 = Math.min(h - 1, y * 2 + 1);
      const a = (y0 * w + x0) * 4;
      const b = (y0 * w + x1) * 4;
      const c = (y1 * w + x0) * 4;
      const d = (y1 * w + x1) * 4;
      const o = (y * nw + x) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = (src[a + k] + src[b + k] + src[c + k] + src[d + k] + 2) >> 2;
      if (normal) {
        const nx = out[o] / 127.5 - 1;
        const ny = out[o + 1] / 127.5 - 1;
        const l = Math.hypot(nx, ny);
        if (l > 1) {
          out[o] = Math.round((nx / l + 1) * 127.5);
          out[o + 1] = Math.round((ny / l + 1) * 127.5);
        }
      }
    }
  }
  return out;
}

// Compresses one square RGBA layer (size S, a power of two >= 4) with its full mip chain.
// kind 'bc3' (rgba) or 'bc5' (rg). Returns [Uint8Array per level].
export function encodeLayer(rgba, S, kind) {
  const levels = [];
  let src = rgba;
  let w = S;
  let h = S;
  const normal = kind === 'bc5';
  for (;;) {
    const bw = Math.max(1, (w + 3) >> 2);
    const bh = Math.max(1, (h + 3) >> 2);
    const out = new Uint8Array(bw * bh * 16);
    // Pad tiny levels to a 4 x 4 block.
    let s = src;
    let sw = w;
    if (w < 4 || h < 4) {
      s = new Uint8Array(16 * 4);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) s.set(src.subarray(((y % h) * w + (x % w)) * 4, ((y % h) * w + (x % w)) * 4 + 4), (y * 4 + x) * 4);
      sw = 4;
    }
    let o = 0;
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        if (normal) {
          bc4Block(s, 4, 0, sw, bx * 4, by * 4, 0, out, o);
          bc4Block(s, 4, 0, sw, bx * 4, by * 4, 1, out, o + 8);
        } else {
          bc4Block(s, 4, 0, sw, bx * 4, by * 4, 3, out, o);
          bc1Colour(s, 0, sw, bx * 4, by * 4, out, o + 8);
        }
        o += 16;
      }
    }
    levels.push(out);
    if (w === 1 && h === 1) break;
    src = downsample(src, w, h, normal);
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return levels;
}
