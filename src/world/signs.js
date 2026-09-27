import { makeRng, hashString } from '../core/rng.js';
import { tint } from './palette.js';

// Shop signs (real business names from the map's POIs, painted on canvas) on street frontages,
// generic trade signs for the rest, and billboards with made-up local brands. All signs live in
// reserved layers of the facade texture array: 16 sign slots (4:1) per layer, 2 ads (2:1) per layer.

const SLOT_COLS = 2;
const SLOT_ROWS = 8;
const PER_LAYER = SLOT_COLS * SLOT_ROWS;

const SIGN_STYLES = [
  ['#c62828', '#ffffff'], ['#1e4fa0', '#ffffff'], ['#1b7a3a', '#ffffff'], ['#f2c230', '#1a1a1a'],
  ['#f4f1ea', '#b71c1c'], ['#202020', '#f2c230'], ['#e8601c', '#ffffff'], ['#5e2a84', '#ffffff'],
  ['#0f6e6e', '#ffffff'], ['#f4f1ea', '#1e3f8a'], ['#8b1d1d', '#f4e3b0'], ['#ffffff', '#1b5e20'],
];

const GENERIC = [
  'BUTCHERY', 'BOTTLE STORE', 'PHARMACY', 'SUPERMARKET', 'WHOLESALE', 'CELLPHONES & ACCESSORIES', 'HAIR SALON', 'FAST FOODS',
  'HARDWARE', 'BOUTIQUE', 'BUREAU DE CHANGE', 'SHOES & BAGS', 'TAKEAWAYS', 'OPTICIANS', 'STATIONERS', 'BAKERY',
];

const SHOP_CATS = /store|shop|fashion|electronics|restaurant|food|pharmacy|bank|financial|salon|beauty|bakery|butcher|hardware|clothing|supermarket|grocery|cafe|furniture|jewel|mobile|phone|travel|optic|book/;

const ADS = [
  { bg: ['#0d47a1', '#1976d2'], title: 'MHEPO MOBILE', line: 'Talk more. Pay less.', accent: '#ffca28', shape: 'phone' },
  { bg: ['#6a1b9a', '#ab47bc'], title: 'JACARANDA FM 98.7', line: 'The sound of the city', accent: '#ffffff', shape: 'waves' },
  { bg: ['#b71c1c', '#e53935'], title: 'SHUMBA COLA', line: 'Ice cold. Highveld strong.', accent: '#ffffff', shape: 'bottle' },
  { bg: ['#1b5e20', '#43a047'], title: 'NYORO BANK', line: 'Your money. Your future.', accent: '#ffd54f', shape: 'circle' },
  { bg: ['#37474f', '#78909c'], title: 'HIGHVELD CEMENT', line: 'Build strong. Build once.', accent: '#ff7043', shape: 'blocks' },
  { bg: ['#e0f7fa', '#80deea'], title: 'CHENA', line: 'Whiter whites every wash', accent: '#0d47a1', shape: 'circle', dark: true },
  { bg: ['#212121', '#424242'], title: 'KOMBI KING TYRES', line: 'Keep rolling, Harare', accent: '#fdd835', shape: 'tyre' },
  { bg: ['#ff8f00', '#ffb300'], title: 'TSOKA SHOES', line: 'Walk tall', accent: '#3e2723', shape: 'stripes', dark: true },
];

function fitText(ctx, text, maxW, maxH, weight = 'bold') {
  let size = maxH;
  ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
  const w = ctx.measureText(text).width;
  if (w > maxW) size = Math.max(8, Math.floor((size * maxW) / w));
  ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
  return size;
}

function drawSign(ctx, x, y, w, h, text, rng) {
  const [bg, fg] = SIGN_STYLES[Math.floor(rng() * SIGN_STYLES.length)];
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  const style = rng();
  if (style < 0.35) {
    ctx.fillStyle = fg;
    ctx.fillRect(x, y + h * 0.84, w, h * 0.08);
  } else if (style < 0.6) {
    ctx.strokeStyle = fg;
    ctx.lineWidth = Math.max(1, h * 0.05);
    ctx.strokeRect(x + h * 0.08, y + h * 0.08, w - h * 0.16, h - h * 0.16);
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const upper = rng() < 0.75 ? text.toUpperCase() : text;
  fitText(ctx, upper, w * 0.88, h * 0.56);
  ctx.fillText(upper, x + w / 2, y + h * 0.47);
  // Weathering.
  ctx.fillStyle = 'rgba(60,50,40,0.12)';
  ctx.fillRect(x, y + h * 0.9, w, h * 0.1);
}

function drawAd(ctx, x, y, w, h, ad) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, ad.bg[0]);
  g.addColorStop(1, ad.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const cx = x + w * 0.8;
  const cy = y + h * 0.5;
  ctx.fillStyle = ad.accent;
  ctx.strokeStyle = ad.accent;
  ctx.lineWidth = h * 0.05;
  switch (ad.shape) {
    case 'phone':
      ctx.fillRect(cx - h * 0.14, cy - h * 0.32, h * 0.28, h * 0.64);
      ctx.fillStyle = ad.bg[0];
      ctx.fillRect(cx - h * 0.11, cy - h * 0.26, h * 0.22, h * 0.46);
      break;
    case 'waves':
      for (let k = 1; k <= 3; k++) {
        ctx.beginPath();
        ctx.arc(cx - h * 0.2, cy, h * 0.13 * k, -0.9, 0.9);
        ctx.stroke();
      }
      break;
    case 'bottle':
      ctx.beginPath();
      ctx.moveTo(cx - h * 0.05, cy - h * 0.38);
      ctx.lineTo(cx + h * 0.05, cy - h * 0.38);
      ctx.lineTo(cx + h * 0.05, cy - h * 0.18);
      ctx.lineTo(cx + h * 0.13, cy - h * 0.05);
      ctx.lineTo(cx + h * 0.13, cy + h * 0.38);
      ctx.lineTo(cx - h * 0.13, cy + h * 0.38);
      ctx.lineTo(cx - h * 0.13, cy - h * 0.05);
      ctx.lineTo(cx - h * 0.05, cy - h * 0.18);
      ctx.fill();
      break;
    case 'blocks':
      for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) ctx.fillRect(cx - h * 0.3 + j * h * 0.2 + (2 - i) * h * 0.1, cy + h * 0.25 - i * h * 0.2, h * 0.18, h * 0.18);
      break;
    case 'tyre':
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ad.bg[0];
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.15, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'stripes':
      for (let i = 0; i < 4; i++) ctx.fillRect(cx - h * 0.3 + i * h * 0.16, y, h * 0.08, h);
      break;
    default:
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.3, 0, Math.PI * 2);
      ctx.fill();
  }
  ctx.fillStyle = ad.dark ? '#102030' : '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  fitText(ctx, ad.title, w * 0.6, h * 0.24);
  ctx.fillText(ad.title, x + w * 0.05, y + h * 0.4);
  fitText(ctx, ad.line, w * 0.58, h * 0.11, 'normal');
  ctx.fillText(ad.line, x + w * 0.05, y + h * 0.68);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(x, y + h * 0.93, w, h * 0.07);
}

// Reserves atlas layers now (their canvases are painted once the names are known).
export class SignPainter {
  constructor(atlas, maxSigns) {
    this.atlas = atlas;
    this.layers = [];
    const n = Math.ceil(maxSigns / PER_LAYER);
    for (let i = 0; i < n; i++) this.layers.push(atlas.add(`signs${i}`, () => {}));
    this.genericLayer = atlas.add('signsGeneric', (c, m, S) => {
      const rng = makeRng(31);
      GENERIC.forEach((text, k) => {
        const [x, y, w, h] = slotRect(k, S);
        drawSign(c, x + 2, y + 2, w - 4, h - 4, text, rng);
      });
    });
    this.adLayers = [];
    for (let i = 0; i < ADS.length / 2; i++) {
      this.adLayers.push(atlas.add(`ads${i}`, (c, m, S) => {
        for (let k = 0; k < 2; k++) drawAd(c, 2, (k * S) / 2 + 2, S - 4, S / 2 - 4, ADS[i * 2 + k]);
      }));
    }
    this.max = n * PER_LAYER;
  }

  // Picks POIs for frontages and paints them. Returns placements [{frontage, layer, uv, name}].
  assign(frontages, pois) {
    const byBuilding = new Map();
    for (const f of frontages) {
      let arr = byBuilding.get(f.b.id);
      if (!arr) byBuilding.set(f.b.id, (arr = []));
      arr.push(f);
    }
    const seen = new Set();
    const cands = [];
    for (const p of pois) {
      if (p.b === undefined || !byBuilding.has(p.b)) continue;
      const name = (p.name || '').replace(/[^\w &'.,-]/g, '').trim();
      if (name.length < 3 || name.length > 26 || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const shop = SHOP_CATS.test(p.cat || '') ? 0 : 150;
      const d = Math.hypot(p.x + 150, p.z) + shop;
      cands.push({ p, name, d });
    }
    cands.sort((a, b) => a.d - b.d);
    const used = new Set();
    const out = [];
    for (const c of cands) {
      if (out.length >= this.max) break;
      const fs = byBuilding.get(c.p.b);
      let best = null;
      let bestD = Infinity;
      for (const f of fs) {
        if (used.has(f)) continue;
        const d = Math.hypot((f.ax + f.bx) / 2 - c.p.x, (f.az + f.bz) / 2 - c.p.z);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      if (!best || best.len < 3.5) continue;
      used.add(best);
      const k = out.length;
      const layer = this.layers[Math.floor(k / PER_LAYER)];
      out.push({ frontage: best, layer, slot: k % PER_LAYER, name: c.name, seed: hashString(c.name) & 255 });
    }
    // Paint the named signs.
    const S = this.atlas.size;
    for (const o of out) {
      const layer = this.atlas.layers[o.layer];
      const ctx = layer.color.getContext('2d');
      const [x, y, w, h] = slotRect(o.slot, S);
      drawSign(ctx, x + 2, y + 2, w - 4, h - 4, o.name, makeRng(o.seed + 1));
    }
    // Generic trade signs on a share of the remaining shopfronts.
    const rng = makeRng(99);
    for (const f of frontages) {
      if (used.has(f) || f.len < 4 || rng() > 0.45) continue;
      const slot = Math.floor(rng() * GENERIC.length);
      out.push({ frontage: f, layer: this.genericLayer, slot, seed: Math.floor(rng() * 255) });
    }
    return out;
  }
}

function slotRect(k, S) {
  const w = S / SLOT_COLS;
  const h = S / SLOT_ROWS;
  return [(k % SLOT_COLS) * w, Math.floor(k / SLOT_COLS) * h, w, h];
}

// UV rect (u0, v0, u1, v1) of a slot, accounting for the atlas row flip (canvas top = v 1).
export function slotUV(slot, S = 1) {
  const [x, y, w, h] = slotRect(slot, S);
  const inset = 0.004;
  return [x + inset, 1 - (y + h) + inset, x + w - inset, 1 - y - inset];
}

export function adUV(k) {
  return [0.004, k === 0 ? 0.504 : 0.004, 0.996, k === 0 ? 0.996 : 0.496];
}

// Emits a sign board for a placement: on the canopy fascia if the shop has one, else on the wall
// above the shop window.
export function emitSign(gb, L, pl) {
  const f = pl.frontage;
  const [u0, v0, u1, v1] = slotUV(pl.slot);
  const width = Math.min(f.len * 0.8, 5.2);
  const height = width / 4;
  const ex = (f.bx - f.ax) / f.len;
  const ez = (f.bz - f.az) / f.len;
  const mx = (f.ax + f.bx) / 2;
  const mz = (f.az + f.bz) / 2;
  let px;
  let pz;
  let y0;
  let h = height;
  if (f.canopy) {
    const out = f.canopy.front + 0.12;
    px = mx + f.nx * out;
    pz = mz + f.nz * out;
    y0 = f.canopy.top + (f.canopy.verandah ? -0.3 : 0.02);
    h = Math.min(height, 0.75);
  } else {
    px = mx + f.nx * 0.07;
    pz = mz + f.nz * 0.07;
    y0 = f.y - Math.min(height, 0.7) - 0.05;
    h = Math.min(height, 0.7);
  }
  const w = h * 4;
  gb.brush(tint('#ffffff'), pl.layer, pl.seed, 1);
  gb.quad(
    px - (ex * w) / 2, y0, pz - (ez * w) / 2,
    px + (ex * w) / 2, y0, pz + (ez * w) / 2,
    px + (ex * w) / 2, y0 + h, pz + (ez * w) / 2,
    px - (ex * w) / 2, y0 + h, pz - (ez * w) / 2,
    f.nx, 0, f.nz, u0, v0, u1, v1,
  );
  // Flip the uv direction if the edge runs the other way round (text must read left to right).
  const flip = ex * f.nz - ez * f.nx < 0;
  if (flip) {
    const U = gb.uv;
    const n = gb.vCount;
    for (let v = n - 4; v < n; v++) U[v * 2] = u0 + u1 - U[v * 2];
  }
}
