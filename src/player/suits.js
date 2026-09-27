import * as THREE from 'three';
import { ATLAS, ATLAS_SIZE } from './model.js';

// Procedural suit textures (painted into the atlas layout of model.js) and the character material.
// Both suits live in one material: a shader blend lets the new suit spread out from the chest emblem
// with a glowing front, like the symbiote taking over (or peeling back).

export const SUITS = ['classic', 'symbiote'];

const CLASSIC = { red: '#c8141f', blue: '#1b3f9e', web: '#1a0608', line: '#0b0b12' };
const SYMBIOTE = { base: '#0b0b0f', web: '#26282f', white: '#f4f4f0' };
const EMBLEM_ORIGIN = new THREE.Vector3(0, 1.33, -0.12);
const TRANSITION_TIME = 0.75;

// Painter coordinates: u = 0..1 around the part (0.5 = front, 0.25 = outer/right side), t = 0..1 along
// the part's own axis (limbs: proximal → distal; torso/head: bottom → top).
function region(rect) {
  const [x0, y0, w, h] = rect;
  return { x0, y0, w, h, X: (u) => x0 + u * w, Y: (t) => y0 + (1 - t) * h };
}

function clipTo(ctx, r) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x0, r.y0, r.w, r.h);
  ctx.clip();
}

// Meridians plus sagging cross strands: on a tube this reads as Spider-Man's webbing.
function webGrid(ctx, r, cols, rows, color, width) {
  clipTo(ctx, r);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < cols; i++) {
    const x = r.X((i + 0.5) / cols);
    ctx.moveTo(x, r.y0);
    ctx.lineTo(x, r.y0 + r.h);
  }
  const sag = (r.h / rows) * 0.38;
  for (let j = 1; j < rows; j++) {
    const y = r.y0 + (j / rows) * r.h;
    for (let i = 0; i <= cols; i++) {
      const xa = r.X((i - 0.5) / cols);
      const xb = r.X((i + 0.5) / cols);
      ctx.moveTo(xa, y);
      ctx.quadraticCurveTo((xa + xb) / 2, y + sag, xb, y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

// Fill (and outline) the band |u - uc| < halfWidth(t) for t in [t0, t1].
function sideBand(ctx, r, uc, t0, t1, halfWidth, fill, line) {
  const steps = 24;
  clipTo(ctx, r);
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const x = r.X(uc - halfWidth(t));
    if (i === 0) ctx.moveTo(x, r.Y(t));
    else ctx.lineTo(x, r.Y(t));
  }
  for (let i = steps; i >= 0; i--) {
    const t = t0 + ((t1 - t0) * i) / steps;
    ctx.lineTo(r.X(uc + halfWidth(t)), r.Y(t));
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (line) {
    ctx.strokeStyle = line;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
}

// Fill everything on one side of a boundary curve t = edge(u) (below: t < edge).
function splitFill(ctx, r, edge, below, fill, line) {
  const steps = 32;
  clipTo(ctx, r);
  ctx.beginPath();
  ctx.moveTo(r.X(0), r.Y(below ? 0 : 1));
  for (let i = 0; i <= steps; i++) ctx.lineTo(r.X(i / steps), r.Y(edge(i / steps)));
  ctx.lineTo(r.X(1), r.Y(below ? 0 : 1));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (line) {
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) ctx.lineTo(r.X(i / steps), r.Y(edge(i / steps)));
    ctx.strokeStyle = line;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
}

// Spider emblem drawn in metres (y down) around the current transform origin.
// shape: {head: [x, y, rx, ry], body: [x, y, rx, ry], width, legs: [[x0, y0, x1, y1, x2, y2], ...]}
function spider(ctx, shape, scale, color) {
  const k = scale;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [x, y, rx, ry] of [shape.head, shape.body]) {
    ctx.beginPath();
    ctx.ellipse(x * k, y * k, rx * k, ry * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineWidth = shape.width * k;
  for (const sx of [-1, 1]) {
    for (const leg of shape.legs) {
      ctx.beginPath();
      ctx.moveTo(sx * leg[0] * k, leg[1] * k);
      ctx.lineTo(sx * leg[2] * k, leg[3] * k);
      ctx.lineTo(sx * leg[4] * k, leg[5] * k);
      ctx.stroke();
    }
  }
}

// The classic suit's small black chest spider.
const CHEST_SPIDER = {
  head: [0, -0.024, 0.012, 0.013],
  body: [0, 0.014, 0.015, 0.027],
  width: 0.0048,
  legs: [
    [0.006, -0.026, 0.03, -0.05, 0.036, -0.082],
    [0.01, -0.014, 0.045, -0.032, 0.06, -0.06],
    [0.01, 0.0, 0.045, 0.018, 0.06, 0.054],
    [0.006, 0.012, 0.03, 0.045, 0.036, 0.085],
  ],
};
// The symbiote's big white spider (metres, drawn at scale 1): legs reach over the shoulders and wrap
// around the ribs towards the back.
const SYMBIOTE_SPIDER = {
  head: [0, -0.078, 0.024, 0.028],
  body: [0, 0.012, 0.034, 0.07],
  width: 0.026,
  legs: [
    [0.018, -0.085, 0.06, -0.14, 0.085, -0.24],
    [0.025, -0.058, 0.12, -0.09, 0.27, -0.07],
    [0.028, -0.018, 0.12, 0.02, 0.27, 0.07],
    [0.022, 0.045, 0.07, 0.12, 0.1, 0.24],
  ],
};

// Web-line density per body part: [meridians around, strands along]. Thighs (plain blue on the classic
// suit) get webbing only on the symbiote.
const WEB_GRID = {
  torso: [14, 12],
  head: [16, 7],
  neck: [10, 3],
  hand: [8, 5],
  foot: [8, 4],
  upperArm: [8, 8],
  forearm: [8, 8],
  thigh: [8, 8],
  shin: [8, 8],
};

// Torso pixels-per-metre at chest height (circumference ≈ 0.99 m, height 0.705 m).
function emblemTransform(ctx, r, u, t) {
  ctx.translate(r.X(u), r.Y(t));
  ctx.scale(r.w / 0.99, r.h / 0.705);
}

function paintClassic(ctx) {
  const c = CLASSIC;
  const all = (key, width = 3) => {
    const r = region(ATLAS[key]);
    ctx.fillStyle = c.red;
    ctx.fillRect(r.x0, r.y0, r.w, r.h);
    webGrid(ctx, r, ...WEB_GRID[key], c.web, width);
    return r;
  };
  ctx.fillStyle = c.red;
  ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

  // Torso: red chest and back, blue flanks tapering into the armpits, blue trunks below the belt.
  const torso = all('torso', 4);
  const belt = 0.235;
  const flank = (t) => 0.035 + 0.075 * (1 - Math.min(1, Math.max(0, (t - belt) / 0.58)) ** 1.3);
  sideBand(ctx, torso, 0.25, belt, 0.84, flank, c.blue, c.line);
  sideBand(ctx, torso, 0.75, belt, 0.84, flank, c.blue, c.line);
  splitFill(ctx, torso, () => belt, true, c.blue, c.line);
  ctx.save();
  emblemTransform(ctx, torso, 0.5, 0.715);
  spider(ctx, CHEST_SPIDER, 1.15, '#0a0a0d');
  ctx.restore();
  ctx.save();
  emblemTransform(ctx, torso, 0.0, 0.66);
  spider(ctx, CHEST_SPIDER, 1.9, '#0a0a0d');
  ctx.restore();
  ctx.save();
  emblemTransform(ctx, torso, 1.0, 0.66);
  spider(ctx, CHEST_SPIDER, 1.9, '#0a0a0d');
  ctx.restore();

  all('head');
  all('neck');
  all('hand');
  all('foot');

  // Arms: red on top/outside, blue underside; red gloves from mid-forearm.
  const ua = all('upperArm');
  sideBand(ctx, ua, 0.75, 0, 1, (t) => 0.1 + 0.12 * t, c.blue, c.line);
  const fa = all('forearm');
  sideBand(ctx, fa, 0.75, 0, 0.45, () => 0.22, c.blue, c.line);
  splitFill(ctx, fa, () => 0.45, true, 'rgba(0,0,0,0)', c.line);

  // Legs: blue with red boots (the cuff dips to a point at the front).
  const th = region(ATLAS.thigh);
  ctx.fillStyle = c.blue;
  ctx.fillRect(th.x0, th.y0, th.w, th.h);
  const sh = all('shin');
  splitFill(ctx, sh, (u) => 0.46 + 0.1 * Math.cos(u * Math.PI * 2), true, c.blue, c.line);

  paintEyes(ctx);
}

function paintSymbiote(ctx) {
  const s = SYMBIOTE;
  ctx.fillStyle = s.base;
  ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  for (const [key, [cols, rows]] of Object.entries(WEB_GRID)) {
    const r = region(ATLAS[key]);
    const g = ctx.createLinearGradient(0, r.y0, 0, r.y0 + r.h);
    g.addColorStop(0, '#15161b');
    g.addColorStop(1, s.base);
    ctx.fillStyle = g;
    ctx.fillRect(r.x0, r.y0, r.w, r.h);
    webGrid(ctx, r, cols, rows, s.web, 2.5);
  }
  const torso = region(ATLAS.torso);
  clipTo(ctx, torso);
  ctx.save();
  emblemTransform(ctx, torso, 0.5, 0.7);
  spider(ctx, SYMBIOTE_SPIDER, 1, s.white);
  ctx.restore();
  for (const u of [0, 1]) {
    ctx.save();
    emblemTransform(ctx, torso, u, 0.66);
    spider(ctx, SYMBIOTE_SPIDER, 0.8, s.white);
    ctx.restore();
  }
  ctx.restore();
  // White patches on the backs of the hands.
  const hand = region(ATLAS.hand);
  ctx.fillStyle = s.white;
  ctx.beginPath();
  ctx.ellipse(hand.X(0.25), hand.Y(0.45), hand.w * 0.1, hand.h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  paintEyes(ctx);
}

function paintEyes(ctx) {
  const lens = region(ATLAS.lens);
  const g = ctx.createRadialGradient(lens.X(0.45), lens.Y(0.6), 2, lens.X(0.5), lens.Y(0.5), lens.w * 0.6);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#d7dde6');
  ctx.fillStyle = g;
  ctx.fillRect(lens.x0, lens.y0, lens.w, lens.h);
  const rim = region(ATLAS.rim);
  ctx.fillStyle = '#060607';
  ctx.fillRect(rim.x0, rim.y0, rim.w, rim.h);
}

// Raised webbing: web-line height field → tangent-space normal map (shared by both suits).
function reliefNormalMap() {
  const N = ATLAS_SIZE / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, N, N);
  ctx.scale(0.5, 0.5);
  ctx.filter = 'blur(1px)';
  for (const [key, [cols, rows]] of Object.entries(WEB_GRID)) {
    if (key !== 'thigh') webGrid(ctx, region(ATLAS[key]), cols, rows, '#fff', key === 'torso' ? 5 : 4);
  }
  const src = ctx.getImageData(0, 0, N, N).data;
  const out = new Uint8Array(N * N * 4);
  const hgt = (x, y) => src[(((y + N) % N) * N + ((x + N) % N)) * 4] / 255;
  const strength = 2.2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (hgt(x + 1, y) - hgt(x - 1, y)) * strength;
      const dy = (hgt(x, y - 1) - hgt(x, y + 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = ((N - 1 - y) * N + x) * 4;
      out[i] = (-dx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(out, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function atlasTexture(paint, anisotropy) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS_SIZE;
  paint(canvas.getContext('2d'));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

// The character material: both suit atlases + the spreading transition.
export class SuitMaterial {
  constructor(renderer, quality) {
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const classic = atlasTexture(paintClassic, aniso);
    const symbiote = atlasTexture(paintSymbiote, aniso);
    this.uniforms = {
      mapB: { value: symbiote },
      uRadius: { value: 10 },
      uOrigin: { value: EMBLEM_ORIGIN },
      uNewIsB: { value: 0 },
      uEdge: { value: 0 },
    };
    const low = quality.level === 'low';
    const params = { map: classic, roughness: 0.62, metalness: 0.0 };
    if (!low) {
      params.normalMap = reliefNormalMap();
      params.normalScale = new THREE.Vector2(0.7, 0.7);
    }
    this.material = low
      ? new THREE.MeshStandardMaterial(params)
      : new THREE.MeshPhysicalMaterial({ ...params, clearcoat: 1, clearcoatRoughness: 0.18 });
    this.material.onBeforeCompile = (shader) => this._patch(shader);
    this.suit = 'classic';
    this._t = TRANSITION_TIME;
  }

  _patch(shader) {
    Object.assign(shader.uniforms, this.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLens;\nvarying vec3 vBind;\nvarying float vLens;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;\nvLens = aLens;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D mapB;
uniform float uRadius;
uniform vec3 uOrigin;
uniform float uNewIsB;
uniform float uEdge;
varying vec3 vBind;
varying float vLens;
float suitB;
float suitDist;`,
      )
      .replace(
        '#include <map_fragment>',
        `suitDist = length(vBind - uOrigin);
float inside = 1.0 - smoothstep(uRadius - 0.02, uRadius + 0.02, suitDist);
suitB = mix(1.0 - uNewIsB, uNewIsB, inside);
diffuseColor *= mix(texture2D(map, vMapUv), texture2D(mapB, vMapUv), suitB);`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.24, suitB);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(metalness, 0.3, suitB);')
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= suitB;\n#endif',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float front = uEdge * (1.0 - smoothstep(0.0, 0.05, abs(suitDist - uRadius)));
totalEmissiveRadiance += vec3(0.7, 0.8, 1.0) * front * 2.5 + vec3(0.32 * vLens);`,
      );
  }

  get transitioning() {
    return this._t < TRANSITION_TIME;
  }

  // Switch suits; the new one spreads from the chest emblem unless instant.
  set(suit, instant = false) {
    if (suit === this.suit) return;
    this.suit = suit;
    this.uniforms.uNewIsB.value = suit === 'symbiote' ? 1 : 0;
    this._t = instant ? TRANSITION_TIME : 0;
    this.update(0);
  }

  update(dt) {
    if (this._t >= TRANSITION_TIME) return;
    this._t = Math.min(TRANSITION_TIME, this._t + dt);
    const k = this._t / TRANSITION_TIME;
    const done = k >= 1;
    this.uniforms.uRadius.value = done ? 10 : 1.25 * (1 - (1 - k) ** 2);
    this.uniforms.uEdge.value = done ? 0 : Math.sin(Math.PI * Math.min(1, k * 1.2));
  }
}
