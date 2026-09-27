import * as THREE from 'three';
import { makeRng, hashString } from '../core/rng.js';
import { makeCanvas } from './atlas.js';
import { PointGrid } from './pointGrid.js';

// Real business signage from public/data/shops.json (docs/references/BUSINESSES.md): one sign per
// entry on the facade of the building it occupies (fascia boards, lightboxes, painted walls,
// awnings, entrance boards, fuel totems, tower letters), snapped onto the building's canopy or
// verandah edge when its shopfront has one; plus black-on-white street-name plates on the building
// corners at junctions (medium / high).
//
// Rendering: every sign of the city is one merged BufferGeometry (one draw call). Sign faces are
// textured from a small text cache: a texture array of 4:1 slots holding the faces ((name, sub,
// style, aspect) — chains share one) of the ~130 signs nearest the camera, re-rasterised a couple
// per frame as the player moves (canvas text in brand colours, manual mip levels so an upload
// never regenerates the whole array). A per-face lookup texture maps face -> slot; faces without a
// slot draw as plain boards in their colours with a soft band where the lettering is. Lightboxes,
// fuel totems and hotel tower letters glow at night (shared uNight uniform).
//
// Public: shops [{name, cat, x, z, nx, nz, road, id, brand, kind, floor, verified, sub}] (all
// entries, at the sign anchor on the facade; (nx, nz) = the facade's outward normal),
// near(x, z, r) -> nearest entry within r or null (no allocation), group, update(camera, dt),
// fill(x, z), obstacles [{x, z, r}] (fuel totem legs), stats.

const CACHE = {
  low: { w: 256, h: 64, layers: 1, budget: 1.5, maxDist: 150 },
  medium: { w: 384, h: 96, layers: 2, budget: 2, maxDist: 220 },
  high: { w: 512, h: 128, layers: 2, budget: 2.5, maxDist: 260 },
};
const COLS = 4;
const ROWS = 16;
const PER_LAYER = COLS * ROWS;
const LOOKUP_W = 64;

const FONTS = {
  'bold-sans': (px) => `bold ${px}px Arial, Helvetica, sans-serif`,
  condensed: (px) => `bold ${px}px Arial, Helvetica, sans-serif`,
  serif: (px) => `bold ${px}px Georgia, 'Times New Roman', serif`,
  script: (px) => `italic bold ${px}px Georgia, serif`,
};

// Night glow per kind (x uNight; the face colour is the emission).
const GLOW = { lightbox: 0.85, tower: 0.9, totem: 0.95, fascia: 0.1, painted: 0.04, awning: 0.1, board: 0, blade: 0.6 };
const DEPTH = { lightbox: 0.22, fascia: 0.05, board: 0.03, blade: 0.12, totem: 0.3 };

const DEFAULT_STYLE = { bg: '#f4f1ea', fg: '#1a1a1a', font: 'bold-sans', case: 'title', kind: 'fascia' };

function rgbBytes(hex) {
  const v = parseInt((hex || '#888888').slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function shade(rgb, k) {
  return rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * k))));
}

// "TotalEnergies" -> ["Total", "Energies"], "Pizza Inn Express" -> ["Pizza Inn", "Express"].
function splitTwo(text) {
  const words = text.split(/\s+/);
  if (words.length > 1) {
    let best = 1;
    let bestD = Infinity;
    for (let k = 1; k < words.length; k++) {
      const d = Math.abs(words.slice(0, k).join(' ').length - words.slice(k).join(' ').length);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
  }
  const m = text.match(/^(.+?[a-z])([A-Z].*)$/);
  return m ? [m[1], m[2]] : [text];
}

// Font size (logical units) that fits `text` into maxW x maxH with the style's face.
function fit(ctx, text, font, maxW, maxH, squeeze = 1) {
  const face = FONTS[font] || FONTS['bold-sans'];
  let size = maxH;
  ctx.font = face(size);
  const w = ctx.measureText(text).width * squeeze;
  if (w > maxW) size = Math.max(4, (size * maxW) / w);
  ctx.font = face(size);
  return size;
}

function drawText(ctx, text, font, x, y, maxW, maxH, align = 'center') {
  const squeeze = font === 'condensed' ? 0.8 : 1;
  const size = fit(ctx, text, font, maxW, maxH, squeeze);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.translate(x, y + size * 0.04);
  ctx.scale(squeeze, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
  return size;
}

// Paints one sign face into the slot canvas (W x H px). Layout happens in logical units: the face
// is LW x 100 with LW = aspect * 100 (x right, y down), mapped onto the 4:1 slot (rotated 90 degrees
// for portrait faces, see the shader).
function drawFace(ctx, W, H, face) {
  const LH = 100;
  const LW = face.A * 100;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (face.rot) ctx.setTransform(0, -H / LW, W / LH, 0, 0, H);
  else ctx.setTransform(W / LW, 0, 0, H / LH, 0, 0);
  const st = face.style;
  const text = st.case === 'upper' ? face.name.toUpperCase() : face.name;
  const bg = st.bg || '#f4f1ea';
  const fg = st.fg || '#111111';
  const rng = makeRng(hashString(face.key));

  if (face.letters) {
    ctx.fillStyle = fg;
    if (face.vertical) {
      const chars = [...text.replace(/\s+/g, '')];
      const cell = LH / chars.length;
      for (let i = 0; i < chars.length; i++) drawText(ctx, chars[i], st.font, LW / 2, cell * (i + 0.5), LW * 0.92, cell * 0.92);
    } else {
      drawText(ctx, text, st.font, LW / 2, LH * 0.52, LW * 0.97, LH * 0.9);
    }
    return;
  }

  if (face.totem) {
    // Forecourt totem: brand panel over a price board.
    const split = LH * 0.6;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, LW, split);
    if (st.accent) {
      ctx.fillStyle = st.accent;
      ctx.fillRect(0, split - LH * 0.07, LW, LH * 0.07);
    }
    ctx.fillStyle = fg;
    const lines = text.length > 6 ? splitTwo(text) : [text];
    if (lines.length === 2) {
      drawText(ctx, lines[0], st.font, LW / 2, split * 0.3, LW * 0.9, split * 0.34);
      drawText(ctx, lines[1], st.font, LW / 2, split * 0.66, LW * 0.9, split * 0.34);
    } else {
      drawText(ctx, text, st.font, LW / 2, split * 0.47, LW * 0.88, split * 0.55);
    }
    ctx.fillStyle = '#16181a';
    ctx.fillRect(0, split, LW, LH - split);
    const rows = [['DIESEL', '1.62'], ['BLEND', '1.55']];
    rows.forEach(([label, price], k) => {
      const y = split + (LH - split) * (0.3 + k * 0.42);
      ctx.fillStyle = '#e8e8e8';
      drawText(ctx, label, 'bold-sans', LW * 0.05, y, LW * 0.42, (LH - split) * 0.24, 'left');
      ctx.fillStyle = '#ffb21a';
      drawText(ctx, price, 'bold-sans', LW * 0.95, y, LW * 0.44, (LH - split) * 0.34, 'right');
    });
    return;
  }

  if (face.kind === 'board') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, LW, LH);
    ctx.strokeStyle = fg;
    ctx.lineWidth = LH * 0.04;
    ctx.strokeRect(LH * 0.06, LH * 0.06, LW - LH * 0.12, LH * 0.88);
    ctx.fillStyle = fg;
    const lines = text.length > 14 && LW < 220 ? splitTwo(text) : [text];
    if (lines.length === 2) {
      drawText(ctx, lines[0], st.font, LW / 2, LH * 0.34, LW * 0.84, LH * 0.3);
      drawText(ctx, lines[1], st.font, LW / 2, LH * 0.68, LW * 0.84, LH * 0.3);
    } else {
      drawText(ctx, text, st.font, LW / 2, LH * (face.sub ? 0.4 : 0.5), LW * 0.84, LH * 0.46);
    }
    if (face.sub) drawText(ctx, face.sub, 'bold-sans', LW / 2, LH * 0.76, LW * 0.8, LH * 0.2);
    return;
  }

  // Fascia, lightbox, painted wall, awning.
  if (face.kind === 'lightbox') {
    const g = ctx.createLinearGradient(0, 0, 0, LH);
    g.addColorStop(0, bg);
    g.addColorStop(0.5, shadeHex(bg, 1.06));
    g.addColorStop(1, shadeHex(bg, 0.94));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = bg;
  }
  ctx.fillRect(0, 0, LW, LH);
  let x0 = LH * 0.14;
  if (face.brand && st.accent) {
    ctx.fillStyle = st.accent;
    const sq = LH * 0.62;
    ctx.fillRect(LH * 0.16, (LH - sq) / 2, sq, sq);
    x0 = LH * 0.16 + sq + LH * 0.16;
  } else if (st.accent) {
    ctx.fillStyle = st.accent;
    ctx.fillRect(0, LH * 0.87, LW, LH * 0.07);
  }
  if (face.kind === 'lightbox') {
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = LH * 0.05;
    ctx.strokeRect(LH * 0.025, LH * 0.025, LW - LH * 0.05, LH * 0.95);
  }
  const x1 = LW - LH * 0.14;
  const cx = (x0 + x1) / 2;
  const tw = Math.max(LH * 0.5, x1 - x0);
  ctx.fillStyle = fg;
  if (face.sub) {
    drawText(ctx, text, st.font, cx, LH * 0.38, tw, LH * 0.5);
    drawText(ctx, face.sub, 'bold-sans', cx, LH * 0.77, tw * 0.9, LH * 0.2);
  } else {
    let size = fit(ctx, text, st.font, tw, LH * 0.6, st.font === 'condensed' ? 0.8 : 1);
    if (size < LH * 0.36 && face.A < 3.4) {
      const [a, b] = splitTwo(text);
      if (b) {
        drawText(ctx, a, st.font, cx, LH * 0.31, tw, LH * 0.38);
        drawText(ctx, b, st.font, cx, LH * 0.71, tw, LH * 0.38);
        size = 0;
      }
    }
    if (size) drawText(ctx, text, st.font, cx, LH * 0.5, tw, LH * 0.6);
  }
  if (face.kind === 'painted') {
    // Hand-painted wall lettering: sun-faded, dusty.
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(${rng() < 0.5 ? '255,250,240' : '70,55,40'},${0.05 + rng() * 0.08})`;
      const w = LW * (0.05 + rng() * 0.25);
      ctx.fillRect(rng() * LW - w / 2, rng() * LH, w, LH * (0.04 + rng() * 0.2));
    }
  }
  ctx.fillStyle = 'rgba(40,30,20,0.10)';
  ctx.fillRect(0, LH * 0.92, LW, LH * 0.08);
}

// "Samora Machel Avenue" -> "SAMORA MACHEL AVE", "Fourth Street/ S.V Muzenda" -> "FOURTH ST".
function plateName(name) {
  const base = name.split('/')[0].replace(/\(.*?\)/g, '').trim();
  if (!base || /^\d/.test(base)) return '';
  return base
    .replace(/\bAvenue\b/i, 'Ave')
    .replace(/\bStreet\b/i, 'St')
    .replace(/\bRoad\b/i, 'Rd')
    .replace(/\bDrive\b/i, 'Dr')
    .replace(/\bTerrace\b/i, 'Tce')
    .replace(/\bLane\b/i, 'Ln')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function shadeHex(hex, k) {
  const [r, g, b] = shade(rgbBytes(hex), k);
  return `rgb(${r},${g},${b})`;
}

// Merged sign geometry: position, normal, aUv (face-local, v down), aFace (face index or -1),
// aCol (rgb + night glow), aFg (rgb + flags: 1 rotated face, 2 letters only, 4 face).
class SignGeo {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.face = [];
    this.col = [];
    this.fg = [];
    this.idx = [];
    this.n = 0;
  }

  _v(x, y, z, nx, ny, nz, u, v, face, col, glow, fg, flags) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.face.push(face);
    this.col.push(col[0], col[1], col[2], Math.round(glow * 255));
    this.fg.push(fg[0], fg[1], fg[2], flags);
    return this.n++;
  }

  // Quad bl, br, tr, tl ([x, y, z]); uv (0,1) at bl .. (1,0) at tr.
  quad(bl, br, tr, tl, n, face, col, glow, fg = col, flags = 0) {
    const a = this._v(...bl, ...n, 0, 1, face, col, glow, fg, flags);
    const b = this._v(...br, ...n, 1, 1, face, col, glow, fg, flags);
    const c = this._v(...tr, ...n, 1, 0, face, col, glow, fg, flags);
    const d = this._v(...tl, ...n, 0, 0, face, col, glow, fg, flags);
    this.idx.push(a, b, c, a, c, d);
  }

  // Box: front face at the plane through `c` (bottom-centre) with normal n (horizontal, [x, z]),
  // right vector r, extending `depth` back behind it. The front carries the face, the rest `frame`.
  box(c, r, n, w, h, depth, face, col, glow, fg, flags, frame, backFace = false) {
    const [cx, cy, cz] = c;
    const hw = w / 2;
    const P = (u, y, d) => [cx + r[0] * u - n[0] * d, cy + y, cz + r[1] * u - n[1] * d];
    const N = [n[0], 0, n[1]];
    this.quad(P(-hw, 0, 0), P(hw, 0, 0), P(hw, h, 0), P(-hw, h, 0), N, face, col, glow, fg, flags | (face >= 0 ? 4 : 0));
    if (depth <= 0) return;
    const fr = frame;
    this.quad(P(-hw, h, 0), P(hw, h, 0), P(hw, h, depth), P(-hw, h, depth), [0, 1, 0], -1, fr, 0);
    this.quad(P(-hw, 0, depth), P(hw, 0, depth), P(hw, 0, 0), P(-hw, 0, 0), [0, -1, 0], -1, fr, 0);
    this.quad(P(hw, 0, 0), P(hw, 0, depth), P(hw, h, depth), P(hw, h, 0), [r[0], 0, r[1]], -1, fr, 0);
    this.quad(P(-hw, 0, depth), P(-hw, 0, 0), P(-hw, h, 0), P(-hw, h, depth), [-r[0], 0, -r[1]], -1, fr, 0);
    if (backFace) {
      // Double-sided panel: the back reads correctly from behind (its own right vector).
      this.quad(P(hw, 0, depth), P(-hw, 0, depth), P(-hw, h, depth), P(hw, h, depth), [-n[0], 0, -n[1]], face, col, glow, fg, flags | (face >= 0 ? 4 : 0));
    }
  }

  // Axis box (poles, legs) centred on (x, z) from y0 to y1.
  post(x, z, y0, y1, s, col) {
    const r = [1, 0];
    const n = [0, 1];
    this.box([x, y0, z + s / 2], r, n, s, y1 - y0, s, -1, col, 0, col, 0, col, true);
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aFace', new THREE.Float32BufferAttribute(this.face, 1));
    g.setAttribute('aCol', new THREE.Uint8BufferAttribute(this.col, 4, true));
    g.setAttribute('aFg', new THREE.Uint8BufferAttribute(this.fg, 4, true));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function signMaterial(atlas, lookup, uniforms, pad) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uSignAtlas = { value: atlas };
    shader.uniforms.uFaceSlots = { value: lookup };
    shader.uniforms.uSlotPad = { value: pad };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform highp sampler2D uFaceSlots;
uniform vec2 uSlotPad;
attribute vec2 aUv;
attribute float aFace;
attribute vec4 aCol;
attribute vec4 aFg;
varying vec2 vFaceUv;
varying vec3 vAtlas;
varying vec4 vCol;
varying vec4 vFg;
varying float vHasTex;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFaceUv = aUv;
vCol = aCol;
vFg = aFg;
vHasTex = 0.0;
vAtlas = vec3(0.0);
if (aFace > -0.5) {
  int fi = int(aFace + 0.5);
  float slot = floor(texelFetch(uFaceSlots, ivec2(fi % ${LOOKUP_W}, fi / ${LOOKUP_W}), 0).r * 255.0 + 0.5) - 1.0;
  if (slot > -0.5) {
    int flags = int(aFg.a * 255.0 + 0.5);
    vec2 st = (flags & 1) != 0 ? vec2(aUv.y, 1.0 - aUv.x) : aUv;
    st = mix(uSlotPad, 1.0 - uSlotPad, st);
    int s = int(slot + 0.5);
    int k = s % ${PER_LAYER};
    vAtlas = vec3((vec2(float(k % ${COLS}), float(k / ${COLS})) + st) / vec2(${COLS}.0, ${ROWS}.0), float(s / ${PER_LAYER}));
    vHasTex = 1.0;
  }
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uSignAtlas;
uniform float uNight;
varying vec2 vFaceUv;
varying vec3 vAtlas;
varying vec4 vCol;
varying vec4 vFg;
varying float vHasTex;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
vec3 sCol = pow(vCol.rgb, vec3(2.2));
{
  int sFlags = int(vFg.a * 255.0 + 0.5);
  if ((sFlags & 4) != 0) {
    if (vHasTex > 0.5) {
      vec4 t = texture(uSignAtlas, vec3(vAtlas.xy, floor(vAtlas.z + 0.5)));
      if ((sFlags & 2) != 0 && t.a < 0.5) discard;
      sCol = t.rgb;
    } else {
      if ((sFlags & 2) != 0) discard;
      // Plain board: a soft band of the lettering colour where the name would be.
      vec2 d = abs(vFaceUv - 0.5);
      float band = (1.0 - smoothstep(0.3, 0.38, d.x)) * (1.0 - smoothstep(0.12, 0.2, d.y));
      sCol = mix(sCol, pow(vFg.rgb, vec3(2.2)), band * 0.5);
    }
  }
}
diffuseColor.rgb = sCol;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += sCol * (vCol.a * uNight * 1.7);`,
      );
  };
  mat.customProgramCacheKey = () => 'city-shop-signs-1';
  return mat;
}

export class ShopSigns {
  // opts: {json (shops.json), frontages (from buildings.js emitBuilding), buildings (data.buildings),
  //        heightAt(x, z), uniforms ({uNight}), level ('low'|'medium'|'high')}
  constructor({ json, frontages, buildings, heightAt, uniforms, level = 'high', nodes = null }) {
    this.level = level;
    this.cfg = CACHE[level] || CACHE.high;
    this.uniforms = uniforms;
    this.group = new THREE.Group();
    this.group.name = 'shopSigns';
    this.obstacles = [];
    this.styles = json.styles || {};
    this.shops = json.shops.map((s) => ({
      name: s.name, cat: s.cat, x: s.x, z: s.z, nx: s.nx, nz: s.nz, road: s.road || '', id: s.id, brand: s.brand || null,
      kind: s.kind || this.styles[s.style]?.kind || 'fascia', floor: s.floor || 0, verified: s.verified, sub: s.sub || null,
    }));
    this._grid = new PointGrid(this.shops, 32);
    this.faces = [];
    this._faceIndex = new Map();
    this.signs = { x: [], z: [], face: [] };
    this.stats = { signs: 0, faces: 0, snapped: 0, cached: 0, rastered: 0, triangles: 0 };

    const fronts = new Map();
    for (const f of frontages || []) {
      let arr = fronts.get(f.b.id);
      if (!arr) fronts.set(f.b.id, (arr = []));
      arr.push(f);
    }
    const geo = new SignGeo();
    for (const s of json.shops) {
      const style = this.styles[s.style] || DEFAULT_STYLE;
      const kind = s.kind || style.kind || 'fascia';
      if (!this._keep(s, kind)) continue;
      this._emit(geo, s, style, kind, fronts, buildings, heightAt);
      this.stats.signs++;
    }
    if (nodes && level !== 'low') this._streetPlates(geo, frontages || [], nodes, heightAt);
    this.geo = geo;
    this.stats.faces = this.faces.length;
    this.stats.triangles = geo.idx.length / 3;
  }

  // Black-on-white street-name plates on the building corners at junctions (PHOTOS.md s.20: "R.
  // MUGABE RD"), one per corner and street, from the frontages that face a named street.
  _streetPlates(geo, frontages, nodes, heightAt) {
    const seen = new Set();
    const style = { bg: '#f2f1ec', fg: '#141414', font: 'bold-sans', case: 'upper', kind: 'board' };
    const bg = rgbBytes(style.bg);
    const fg = rgbBytes(style.fg);
    for (const f of frontages) {
      const r = f.street?.road;
      if (!r?.name || !f.b.core || f.len < 4 || r.a === undefined) continue;
      const name = plateName(r.name);
      if (!name) continue;
      for (const end of [0, 1]) {
        const cx = end ? f.bx : f.ax;
        const cz = end ? f.bz : f.az;
        let near = Infinity;
        for (const ni of [r.a, r.b]) near = Math.min(near, Math.hypot(nodes[ni][0] - cx, nodes[ni][1] - cz));
        if (near > 16) continue;
        const key = `${name}|${Math.round(cx / 8)}|${Math.round(cz / 8)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // 0.9 m in from the corner, on the first-floor wall just above the shop signs / canopy.
        const ex = ((end ? f.ax - f.bx : f.bx - f.ax) / f.len) * 0.9;
        const ez = ((end ? f.az - f.bz : f.bz - f.az) / f.len) * 0.9;
        const w = 1.3;
        const x = cx + ex + (ex / 0.9) * (w / 2);
        const z = cz + ez + (ez / 0.9) * (w / 2);
        const y = f.y + 0.85;
        if (y + 0.3 > f.b.h) continue;
        const id = this._faceFor({ style: 'street_plate', name, sub: null }, style, 'board', w / 0.26, {});
        const n = [f.nx, f.nz];
        const rr = [f.nz, -f.nx];
        const g0 = heightAt ? heightAt(x, z) : 0;
        geo.box([x + f.nx * 0.04, g0 + y, z + f.nz * 0.04], rr, n, w, 0.26, 0.02, id, bg, 0.05, fg, 0, shade(bg, 0.6));
        this.signs.x.push(x);
        this.signs.z.push(z);
        this.signs.face.push(id);
        this.stats.plates = (this.stats.plates || 0) + 1;
      }
    }
  }

  // Phones: researched and chain signs only, no entrance boards.
  _keep(s, kind) {
    if (this.level !== 'low') return true;
    return (s.verified === 'web' || !!s.brand) && kind !== 'board';
  }

  _faceFor(s, style, kind, A, extra) {
    const rot = A < 1;
    const aspect = rot ? Math.max(1, Math.round((1 / A) * 4) / 4) : Math.max(1, Math.round(A * 4) / 4);
    const key = `${s.style}|${s.name}|${s.sub || ''}|${kind}|${aspect}|${rot ? 1 : 0}`;
    let id = this._faceIndex.get(key);
    if (id === undefined) {
      id = this.faces.length;
      this._faceIndex.set(key, id);
      this.faces.push({
        key, name: s.name, sub: s.sub || null, style, kind, brand: !!s.brand, rot,
        A: rot ? 1 / aspect : aspect, pinned: !!extra.pinned, letters: !!extra.letters, vertical: !!extra.vertical,
        totem: !!extra.totem, slot: -1, dist: Infinity, want: false,
      });
    }
    return id;
  }

  // Frontage (buildings.js) carrying this sign's facade, and the position along it.
  _frontage(s, fronts) {
    const list = fronts.get(s.b);
    if (!list) return null;
    let best = null;
    let bestD = 0.6;
    for (const f of list) {
      if (f.nx * s.nx + f.nz * s.nz < 0.95) continue;
      const ex = (f.bx - f.ax) / f.len;
      const ez = (f.bz - f.az) / f.len;
      const t = (s.x - f.ax) * ex + (s.z - f.az) * ez;
      if (t < -0.5 || t > f.len + 0.5) continue;
      const d = Math.abs((s.x - f.ax) * f.nx + (s.z - f.az) * f.nz);
      if (d < bestD) {
        bestD = d;
        best = { f, t, ex, ez };
      }
    }
    return best;
  }

  _emit(geo, s, style, kind, fronts, buildings, heightAt) {
    const nx = s.nx;
    const nz = s.nz;
    const n = [nx, nz];
    const r = [s.ax ?? nz, s.az ?? -nx];
    const b = buildings[s.b];
    const bg = rgbBytes(style.bg);
    const fg = rgbBytes(style.fg);
    const accent = style.accent ? rgbBytes(style.accent) : null;
    const rng = makeRng(hashString(s.id || s.name));
    let x = s.x;
    let z = s.z;
    let w = s.w;
    let h = s.h;
    let y = s.y;
    const g0 = heightAt ? heightAt(x, z) : 0;
    const fuel = kind === 'blade' && s.cat === 'fuel';
    let glow = GLOW[fuel ? 'totem' : kind] ?? 0;
    // Hotels light their tower letters; a few lightboxes are dead (load-shedding, broken tubes).
    if (kind === 'tower' && s.cat !== 'hotel') glow = 0;
    if (kind === 'lightbox' && rng() < 0.12) glow = 0;
    const push = (id, sx, sz) => {
      this.signs.x.push(sx);
      this.signs.z.push(sz);
      this.signs.face.push(id);
    };

    if (fuel || kind === 'blade') {
      const off = fuel ? s.off ?? 3 : 0.15 + w / 2;
      const tw = w;
      const px = x + nx * off;
      const pz = z + nz * off;
      const gy = heightAt ? heightAt(px, pz) : 0;
      const id = this._faceFor(s, style, kind, tw / h, { totem: fuel });
      const flags = this.faces[id].rot ? 1 : 0;
      const frame = accent ? shade(accent, 0.9) : shade(bg, 0.7);
      if (fuel) {
        // Forecourt totem on two legs, both faces printed.
        const grey = [150, 154, 158];
        for (const u of [-tw * 0.34, tw * 0.34]) {
          geo.post(px + r[0] * u, pz + r[1] * u, gy, gy + y, 0.16, grey);
          this.obstacles.push({ x: px + r[0] * u, z: pz + r[1] * u, r: 0.2 });
        }
        geo.box([px + n[0] * 0.15, gy + y, pz + n[1] * 0.15], r, n, tw, h, 0.3, id, bg, glow, fg, flags, frame, true);
        geo.box([px + n[0] * 0.17, gy + y + h, pz + n[1] * 0.17], r, n, tw + 0.08, 0.1, 0.34, -1, frame, 0, frame, 0, frame);
      } else {
        // Projecting blade: panel perpendicular to the wall, printed on both sides.
        geo.box([px + r[0] * 0.06, gy + y, pz + r[1] * 0.06], [-n[0], -n[1]], r, w, h, 0.12, id, bg, glow, fg, flags, frame, true);
      }
      push(id, px, pz);
      return;
    }

    // Painted lettering and raised tower letters are single faces; boards and boxes have depth.
    const depth = kind === 'painted' || kind === 'tower' ? 0 : DEPTH[kind] ?? 0.05;
    let out = kind === 'painted' ? 0.025 : kind === 'tower' ? 0.12 : 0.02;
    const hit = this._frontage(s, fronts);
    if (hit && kind !== 'tower') {
      const { f, ex, ez } = hit;
      // Keep the whole sign on this frontage and exactly on its wall line.
      if (w > f.len - 0.2) w = Math.max(0.8, f.len - 0.2);
      const t = Math.min(Math.max(hit.t, w / 2 + 0.1), f.len - w / 2 - 0.1);
      x = f.ax + ex * t;
      z = f.az + ez * t;
      const cn = f.canopy;
      if (kind === 'awning') {
        if (cn) y = Math.min(y, f.y - 0.2 - h);
      } else if (kind !== 'board' && cn) {
        // On the canopy's front edge (the slab + upstand), or the verandah fascia.
        if (cn.verandah) {
          out = cn.front + 0.05;
          y = cn.top - 0.3;
        } else {
          out = cn.front + 0.11;
          y = cn.top - 0.25;
        }
        if (y + h > b.h + 0.9) h = Math.max(0.55, b.h + 0.9 - y);
        this.stats.snapped++;
      } else if (kind !== 'board') {
        // Above the shopfront glazing: the display windows end ~0.78 m under the ground-floor band's
        // top (facade shader), leaving the fascia strip the sign covers.
        y = Math.max(y, (f.glassTop ?? f.y - 0.76) + 0.03);
      }
    }
    // Raised building parts (overhangs, bridges: minH > 0) have no wall below minH.
    if (b?.minH > 0 && y < b.minH + 0.2) y = b.minH + 0.2;
    if (kind !== 'tower' && !(hit?.f.canopy && kind !== 'board' && kind !== 'awning') && b && y + h > b.h + 0.3) {
      h = Math.max(0.5, Math.min(h, b.h + 0.3 - y));
      if (y + h > b.h + 0.3) y = Math.max(0.5, b.h + 0.3 - h);
    }
    const letters = kind === 'tower' && style.letters !== false;
    const vertical = !!s.vertical;
    const id = this._faceFor(s, style, kind, w / h, { letters, vertical, pinned: kind === 'tower' });
    const flags = (this.faces[id].rot ? 1 : 0) | (letters ? 2 : 0);
    const frame = kind === 'lightbox' ? (accent && rng() < 0.5 ? accent : [58, 62, 66]) : shade(bg, 0.75);
    const base = [x + nx * out, g0 + y, z + nz * out];

    if (kind === 'awning') {
      // Fabric awning sloping out over the door: printed slope, valance, side cheeks.
      const proj = 1.0;
      const drop = 0.7;
      const top = g0 + y + h;
      const bx = x + nx * 0.03;
      const bz = z + nz * 0.03;
      const P = (u, o, yy) => [bx + r[0] * u + nx * o, yy, bz + r[1] * u + nz * o];
      const hw = w / 2;
      const len = Math.hypot(proj, drop);
      const N = [(nx * drop) / len, proj / len, (nz * drop) / len];
      geo.quad(P(-hw, proj, top - drop), P(hw, proj, top - drop), P(hw, 0, top), P(-hw, 0, top), N, id, bg, glow, fg, 4 | flags);
      const val = shade(bg, 0.85);
      geo.quad(P(-hw, proj, top - drop - 0.22), P(hw, proj, top - drop - 0.22), P(hw, proj, top - drop), P(-hw, proj, top - drop), [nx, 0, nz], -1, val, glow);
      for (const sg of [-1, 1]) {
        const a = geo._v(...P(sg * hw, 0, top), r[0] * sg, 0, r[1] * sg, 0, 0, -1, val, 0, val, 0);
        const bI = geo._v(...P(sg * hw, proj, top - drop), r[0] * sg, 0, r[1] * sg, 0, 0, -1, val, 0, val, 0);
        const c = geo._v(...P(sg * hw, 0, top - drop), r[0] * sg, 0, r[1] * sg, 0, 0, -1, val, 0, val, 0);
        if (sg > 0) geo.idx.push(a, bI, c);
        else geo.idx.push(a, c, bI);
      }
      push(id, x + nx, z + nz);
      return;
    }

    geo.box([base[0] + nx * depth, base[1], base[2] + nz * depth], r, n, w, h, depth, id, bg, glow, fg, flags, frame);
    push(id, x, z);
  }

  // Creates the text cache, material and mesh. Paints the faces nearest (x, z) straight away.
  build(renderer, x = 0, z = 0) {
    const { w: SW, h: SH, layers } = this.cfg;
    this.renderer = renderer;
    const S = SW * COLS;
    const atlas = new THREE.DataArrayTexture(null, S, SH * ROWS, layers);
    atlas.format = THREE.RGBAFormat;
    atlas.type = THREE.UnsignedByteType;
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    atlas.magFilter = THREE.LinearFilter;
    atlas.generateMipmaps = true;
    atlas.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    atlas.source.dataReady = false;
    atlas.needsUpdate = true;
    renderer.initTexture(atlas);
    // Storage for the full mip chain is allocated; the slots' levels are written by hand from now on.
    atlas.generateMipmaps = false;
    this.atlas = atlas;
    this.slotCount = PER_LAYER * layers;
    this.slotFace = new Int32Array(this.slotCount).fill(-1);
    // Mip levels written per slot: while the slot's origin and size stay whole texels.
    const ctz = (v) => Math.log2(v & -v);
    this.levels = Math.min(Math.floor(Math.log2(SH)), ctz(SW), ctz(SH)) + 1;
    const rows = Math.max(1, Math.ceil(this.faces.length / LOOKUP_W));
    this.lookup = new THREE.DataTexture(new Uint8Array(LOOKUP_W * rows * 4), LOOKUP_W, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.lookup.minFilter = this.lookup.magFilter = THREE.NearestFilter;
    this.lookup.generateMipmaps = false;
    this.lookup.needsUpdate = true;
    this.textureBytes = S * SH * ROWS * 4 * layers * 1.33;

    // Slot canvas + its mip chain, and one upload source per level.
    this.canvases = [];
    this.sources = [];
    for (let k = 0; k < this.levels; k++) {
      const c = makeCanvas(Math.max(1, SW >> k), Math.max(1, SH >> k));
      this.canvases.push({ c, ctx: c.getContext('2d', { willReadFrequently: true }) });
      const src = new THREE.DataTexture(new Uint8Array(c.width * c.height * 4), c.width, c.height);
      this.sources.push(src);
    }

    const geometry = this.geo.toGeometry();
    this.geo = null;
    this.material = signMaterial(atlas, this.lookup, this.uniforms, new THREE.Vector2(1.5 / SW, 1.5 / SH));
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'shopSigns';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.group.add(this.mesh);

    this.sx = Float32Array.from(this.signs.x);
    this.sz = Float32Array.from(this.signs.z);
    this.sf = Int32Array.from(this.signs.face);
    this.signs = null;
    this._order = [];
    this._queue = [];
    this._lastX = Infinity;
    this._lastZ = Infinity;
    this._timer = 0;
    // Pinned faces (tower letters) keep their slot for good.
    for (let i = 0; i < this.faces.length; i++) if (this.faces[i].pinned) this._raster(i, this._freeSlot());
    this._select(x, z);
    this._drain(Infinity);
    return this;
  }

  _freeSlot() {
    for (let s = 0; s < this.slotCount; s++) if (this.slotFace[s] < 0) return s;
    return -1;
  }

  // Which faces deserve a slot: the nearest ones (by their nearest sign) within maxDist.
  // Signs behind the camera (forward (fx, fz)) count as 1.5 x farther.
  _select(cx, cz, fx = 0, fz = 0) {
    const faces = this.faces;
    for (const f of faces) {
      f.dist = Infinity;
      f.want = false;
    }
    const N = this.sf.length;
    for (let i = 0; i < N; i++) {
      const dx = this.sx[i] - cx;
      const dz = this.sz[i] - cz;
      const d = (dx * dx + dz * dz) * (dx * fx + dz * fz < 0 ? 2.25 : 1);
      const f = faces[this.sf[i]];
      if (d < f.dist) f.dist = d;
    }
    const max2 = this.cfg.maxDist * this.cfg.maxDist;
    const order = this._order;
    order.length = 0;
    for (let i = 0; i < faces.length; i++) if (!faces[i].pinned && faces[i].dist < max2) order.push(i);
    order.sort((a, b) => faces[a].dist - faces[b].dist);
    let pinned = 0;
    for (const f of faces) if (f.pinned) pinned++;
    const cap = Math.min(order.length, this.slotCount - pinned);
    const queue = this._queue;
    queue.length = 0;
    for (let k = 0; k < cap; k++) {
      const f = faces[order[k]];
      f.want = true;
      if (f.slot < 0) queue.push(order[k]);
    }
    this._qi = 0;
  }

  // Rasterises queued faces until the time budget (ms) is used up.
  _drain(budget) {
    const t0 = performance.now();
    let dirty = false;
    while (this._qi < this._queue.length) {
      const fi = this._queue[this._qi++];
      const face = this.faces[fi];
      if (face.slot >= 0 || !face.want) continue;
      let slot = this._freeSlot();
      if (slot < 0) {
        // Evict the farthest unwanted face.
        let worst = -1;
        let worstD = -1;
        for (let s = 0; s < this.slotCount; s++) {
          const f = this.faces[this.slotFace[s]];
          if (f.pinned || f.want) continue;
          if (f.dist > worstD) {
            worstD = f.dist;
            worst = s;
          }
        }
        if (worst < 0) break;
        this.faces[this.slotFace[worst]].slot = -1;
        this._setLookup(this.slotFace[worst], -1);
        slot = worst;
      }
      this._raster(fi, slot);
      dirty = true;
      if (performance.now() - t0 > budget) break;
    }
    if (dirty) this.lookup.needsUpdate = true;
  }

  _setLookup(fi, slot) {
    this.lookup.image.data[fi * 4] = slot + 1;
  }

  _raster(fi, slot) {
    if (slot < 0) return;
    const face = this.faces[fi];
    const { w: SW, h: SH } = this.cfg;
    const c0 = this.canvases[0];
    drawFace(c0.ctx, SW, SH, face);
    const layer = Math.floor(slot / PER_LAYER);
    const k = slot % PER_LAYER;
    const px = (k % COLS) * SW;
    const py = Math.floor(k / COLS) * SH;
    let fgRgb = null;
    if (face.letters) fgRgb = rgbBytes(face.style.fg);
    for (let lv = 0; lv < this.levels; lv++) {
      const { c, ctx } = this.canvases[lv];
      if (lv > 0) {
        const prev = this.canvases[lv - 1].c;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, c.width, c.height);
      }
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const src = this.sources[lv];
      const out = src.image.data;
      out.set(data);
      if (fgRgb) {
        // Letters only: give transparent texels the letter colour so filtering has no dark fringe.
        for (let i = 0; i < out.length; i += 4) {
          out[i] = fgRgb[0];
          out[i + 1] = fgRgb[1];
          out[i + 2] = fgRgb[2];
        }
      }
      _dst.set(px >> lv, py >> lv, layer);
      this.renderer.copyTextureToTexture(src, this.atlas, null, _dst, 0, lv);
    }
    face.slot = slot;
    if (this.slotFace[slot] < 0) this.stats.cached++;
    this.slotFace[slot] = fi;
    this._setLookup(fi, slot);
    this.stats.rastered++;
  }

  // Keeps the cache on the faces nearest the camera: re-selects every few metres (or half second)
  // and rasterises a couple of faces per frame within the time budget.
  // fwd: optional horizontal view direction {x, z} (prioritises the signs in front).
  update(cam, dt = 0, fwd = null) {
    if (!this.atlas) return;
    this._timer += dt;
    const dx = cam.x - this._lastX;
    const dz = cam.z - this._lastZ;
    if (dx * dx + dz * dz > 36 || this._timer > 0.5) {
      this._timer = 0;
      this._lastX = cam.x;
      this._lastZ = cam.z;
      this._select(cam.x, cam.z, fwd?.x || 0, fwd?.z || 0);
    }
    if (this._qi < this._queue.length) this._drain(this.cfg.budget);
  }

  // Fills the cache for (x, z) at once (tests, or right after a teleport while the screen is dark).
  fill(x, z) {
    this._select(x, z);
    this._drain(Infinity);
    this._lastX = x;
    this._lastZ = z;
  }

  cachedCount() {
    let n = 0;
    for (let s = 0; s < this.slotCount; s++) if (this.slotFace[s] >= 0) n++;
    return n;
  }

  // Nearest business entry within r of (x, z), or null. No allocation.
  near(x, z, r = 30) {
    const list = this._grid.near(x, z, r);
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }
}

const _dst = new THREE.Vector3();
