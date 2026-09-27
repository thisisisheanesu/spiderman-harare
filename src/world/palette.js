import * as THREE from 'three';

// Colour palettes for the city (sRGB hex) + conversion to the linear byte tints used as vertex
// colours (vertex colours are treated as linear by three.js).

export const PALETTE = {
  office: ['#e9e2d0', '#ddd3bd', '#efe8d8', '#d8ccb0', '#cfc6b4', '#e3dccb', '#c9c5bd', '#d5d2cb', '#bfbab0', '#e6e2da', '#d9c9a6', '#cdb892', '#c2b49a', '#e0d6c4'],
  residential: ['#efe4cf', '#e8d8b8', '#f1e9d8', '#dccfb5', '#e6cfb8', '#cfd8bf', '#c9d5dc', '#e8cfc5', '#f3eee4', '#e2d2a8', '#eadfca', '#d9e0d2'],
  colonial: ['#efe3c2', '#e8d5ae', '#f0e6d0', '#e5cfa6', '#dfc3a0', '#e9dcc0', '#d8c4a4', '#f2ead8', '#e6c9a8', '#d7b98f'],
  brick: ['#ffffff', '#f3ece8', '#e9e0da', '#f7f0e4'],
  glassFrame: ['#d0d4d6', '#b9c0c4', '#aeb5b9', '#dfe2e3', '#c4c0b6'],
  industrial: ['#d9d9d6', '#cfd5d8', '#e2ddd2', '#c9ced1', '#d6cbb8'],
  roofFlat: ['#d4d0c8', '#c8c4bb', '#bdb9b0', '#d9d3c6', '#b5b0a6', '#c9c0b0', '#a9a49b'],
  corrugated: ['#c7cacc', '#a9704a', '#9e4535', '#587a55', '#5a7394', '#5d5f61', '#7a5442', '#b8bcbd', '#8f5b3c'],
  tiles: ['#b25e3e', '#8b4e38', '#555352', '#a4432f', '#c0714a', '#7d4a3a'],
  tanks: ['#3f6b3a', '#2f3133', '#3f6b3a', '#d8cfb8', '#3f6b3a', '#6b7a8a'],
  shopCanopy: ['#d9d4c9', '#c9c3b6', '#b8b1a3', '#8a8f93', '#e2ddd2', '#6f7c6a'],
  verandahPost: ['#35503f', '#f0ece2', '#6b2f2a', '#2f3f55'],
};

const cache = new Map();
const _c = new THREE.Color();

// Linear 0..255 bytes for an sRGB hex colour, optionally scaled.
export function tint(hex, mul = 1) {
  const key = mul === 1 ? hex : `${hex}*${mul}`;
  let v = cache.get(key);
  if (!v) {
    _c.set(hex).multiplyScalar(mul);
    v = [_c.r, _c.g, _c.b].map((x) => Math.max(0, Math.min(255, Math.round(x * 255))));
    cache.set(key, v);
  }
  return v;
}

export const WHITE = [255, 255, 255];
