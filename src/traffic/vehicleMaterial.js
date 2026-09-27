import * as THREE from 'three';
import { KOMBI_SLOGANS, DESTINATIONS } from '../data/streetlife.js';

// One material for every vehicle body (and the hwindi figures), so all models share a single shader.
// Per-vertex `vtag` (see modelKit TAG) + per-instance attributes:
//   instanceColor  paint colour
//   aColor2        rgb = accent colour (stripes, cargo, trousers); w = sticker rows packed as rowA + 64·rowB
//   aState         x = headlights (0..1), y = brake, z = left indicator, w = right indicator

export const NO_ROW = 63;

const BANNER_COLORS = ['#d6201f', '#1d4fb8', '#111111', '#e3b21b'];

// Canvas atlas with one sticker per row: kombi slogans, ZUPCO, TAXI and bus destination displays.
export function buildStickerAtlas() {
  const rows = [];
  rows.push({ key: 'ZUPCO', text: 'ZUPCO', bg: '#ffffff', fg: '#1c3f94', fill: 0.62 });
  rows.push({ key: 'TAXI', text: 'TAXI', bg: '#f2d21b', fg: '#141414' });
  const slogans = KOMBI_SLOGANS?.length ? KOMBI_SLOGANS : [{ text: 'MWARI VANOKWANISA' }, { text: 'ZVICHANAKA' }];
  slogans.forEach((s, i) => {
    const bg = BANNER_COLORS[i % BANNER_COLORS.length];
    rows.push({ key: `slogan:${i}`, text: s.text, bg, fg: bg === '#e3b21b' ? '#141414' : '#ffffff', slogan: true });
  });
  const dests = (DESTINATIONS || []).filter((d) => d.dir !== 'CBD').slice(0, 12);
  for (const d of dests.length ? dests : [{ name: 'Mbare' }, { name: 'Chitungwiza' }]) {
    rows.push({ key: `dest:${d.name}`, text: `CITY - ${d.name.toUpperCase()}`, bg: '#0a0a0a', fg: '#ffae1a', led: true });
  }

  const W = 512;
  const H = 48;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H * rows.length;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  rows.forEach((r, i) => {
    const y = i * H;
    ctx.fillStyle = r.bg;
    ctx.fillRect(0, y, W, H);
    ctx.fillStyle = r.fg;
    const font = r.led ? 'bold 30px monospace' : `bold ${r.fill ? 42 : 34}px Impact, "Arial Black", sans-serif`;
    ctx.font = font;
    const tw = ctx.measureText(r.text).width;
    const sx = r.fill ? (W * r.fill) / tw : Math.min(1, (W - 24) / tw);
    ctx.save();
    ctx.translate(W / 2, y + H / 2 + 1);
    ctx.scale(sx, 1);
    ctx.fillText(r.text, 0, 0);
    ctx.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  const index = new Map(rows.map((r, i) => [r.key, i]));
  return {
    texture,
    rows: rows.length,
    row: (key) => index.get(key) ?? NO_ROW,
    slogans: rows.map((r, i) => (r.slogan ? i : -1)).filter((i) => i >= 0),
    destinations: rows.map((r, i) => (r.led ? i : -1)).filter((i) => i >= 0),
  };
}

export function createVehicleMaterial(atlas) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAtlas = { value: atlas.texture };
    shader.uniforms.uAtlasRows = { value: atlas.rows };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float vtag;
attribute vec4 aState;
attribute vec4 aColor2;
varying float vTag;
varying vec4 vState;
varying vec2 vStickerUv;
varying float vRow;`,
      )
      .replace(
        '#include <color_vertex>',
        `vColor = vec4( color, 1.0 );
#ifdef USE_INSTANCING_COLOR
if ( abs( vtag - 1.0 ) < 0.5 || abs( vtag - 9.0 ) < 0.5 ) vColor.rgb *= instanceColor.rgb;
#endif
if ( abs( vtag - 6.0 ) < 0.5 ) vColor.rgb *= aColor2.rgb;
vTag = vtag;
vState = aState;
vStickerUv = uv;
vRow = vtag > 9.5 ? floor( aColor2.w / 64.0 + 0.001 ) : mod( aColor2.w + 0.001, 64.0 );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uAtlas;
uniform float uAtlasRows;
varying float vTag;
varying vec4 vState;
varying vec2 vStickerUv;
varying float vRow;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if ( vTag > 7.5 && floor( vRow ) < ${NO_ROW - 0.5} ) {
  vec2 auv = vec2( vStickerUv.x, 1.0 - ( floor( vRow ) + 1.0 - vStickerUv.y ) / uAtlasRows );
  diffuseColor.rgb = texture2D( uAtlas, auv ).rgb;
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
if ( abs( vTag - 4.0 ) < 0.5 ) roughnessFactor = 0.12;
else if ( abs( vTag - 1.0 ) < 0.5 ) roughnessFactor = 0.38;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
if ( abs( vTag - 2.0 ) < 0.5 ) totalEmissiveRadiance += vec3( 1.0, 0.93, 0.78 ) * ( 0.1 + 3.2 * vState.x );
else if ( abs( vTag - 3.0 ) < 0.5 ) totalEmissiveRadiance += vec3( 1.0, 0.02, 0.01 ) * ( 0.04 + 0.7 * vState.x + 1.5 * vState.y );
else if ( abs( vTag - 5.0 ) < 0.5 ) totalEmissiveRadiance += vec3( 1.0, 0.42, 0.02 ) * 3.0 * vState.z;
else if ( abs( vTag - 7.0 ) < 0.5 ) totalEmissiveRadiance += vec3( 1.0, 0.42, 0.02 ) * 3.0 * vState.w;
else if ( abs( vTag - 10.0 ) < 0.5 ) totalEmissiveRadiance += diffuseColor.rgb * ( 0.5 + 1.5 * vState.x );
else if ( abs( vTag - 4.0 ) < 0.5 ) {
  // Cheap sky reflection on glass (stronger at grazing angles), dimmed at night.
  float fr = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  totalEmissiveRadiance += mix( vec3( 0.2, 0.25, 0.3 ), vec3( 0.015, 0.02, 0.03 ), vState.x ) * ( 0.25 + 0.9 * fr * fr );
}`,
      );
  };
  // All vehicle bodies share one program; the cache key keeps it distinct from stock materials.
  mat.customProgramCacheKey = () => 'harare-vehicle-v1';
  return mat;
}
