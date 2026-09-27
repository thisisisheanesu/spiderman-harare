import * as THREE from 'three';
import { ModelBuilder, TAG, pillar } from './modelKit.js';

// Procedural low-poly Harare traffic: HiAce kombis, Honda Fit-style hatches, Corolla-style sedans,
// an older Mercedes saloon, Wish-style MPV wagons, Hilux double cabs, single-cab bakkies with a load,
// Land Cruiser SUVs, taxis, ZUPCO buses and cab-over delivery trucks. Each model is one merged geometry;
// wheels are a separate shared instanced mesh (see vehicleRenderer.js), so models only list their axles.

const WHITE = '#ffffff';
const GLASS = '#1d2731';
const TINT = '#0f1419';
const TRIM = '#18191b';
const GREY = '#8d9094';
const CHROME = '#c3c7cb';
const HEAD = '#f3efe2';
const TAIL = '#7c1010';
const AMBER = '#c9811c';
const PLATE = '#f1f1ea';

function plates(b, uFront, vFront, uRear, vRear) {
  b.box(0.44, 0.11, 0.02, 0, vFront, -uFront, PLATE);
  b.box(0.44, 0.11, 0.02, 0, vRear, -uRear, PLATE);
}

function indicators(b, w, h, x, y, z) {
  b.pair(w, h, 0.05, x, y, z, AMBER, TAG.INDICATOR_L, TAG.INDICATOR_R);
}

// Shared front/rear furniture for the passenger cars.
function carDetails(b, s) {
  const { L, W } = s;
  const f = L / 2;
  b.pair(s.headW, s.headH, 0.3, s.headX, s.headY, -(f - 0.16), HEAD, TAG.HEADLIGHT);
  b.box(s.grilleW, s.grilleH, 0.06, 0, s.grilleY, -(f - 0.04), s.grille || TRIM);
  b.box(W - 0.5, 0.12, 0.08, 0, 0.4, -(f - 0.03), TRIM);
  indicators(b, 0.1, 0.06, W / 2 - 0.08, s.headY - 0.12, -(f - 0.06));
  b.pair(s.tailW, s.tailH, 0.08, W / 2 - s.tailW / 2 - 0.03, s.tailY, f - 0.04, TAIL, TAG.TAILLIGHT);
  indicators(b, 0.12, 0.05, W / 2 - 0.12, s.tailY - s.tailH / 2 - 0.05, f - 0.03);
  b.box(W - 0.12, 0.1, 0.06, 0, 0.42, f - 0.02, TRIM);
  plates(b, f + 0.005, 0.47, f + 0.005, s.rearPlateY);
  b.pair(0.08, 0.1, 0.17, W / 2 + 0.05, s.mirrorY, -s.mirrorU, WHITE, TAG.PAINT);
  b.box(W - 0.3, 0.14, L - 0.5, 0, 0.24, 0, TRIM);
}

function wheels(uF, uR, r, w = 0.2, extra = {}) {
  return [
    { u: uF, r, w, front: true },
    { u: uR, r, w: extra.rearW || w, front: false },
  ];
}

function hatch() {
  const b = new ModelBuilder();
  const L = 3.95;
  const W = 1.695;
  const r = 0.3;
  const uF = 1.22;
  const uR = -1.28;
  b.profile(
    [[1.9, 0.3], [1.975, 0.46], [1.96, 0.66], [1.84, 0.77], [1.12, 0.93], [-1.9, 0.99], [-1.975, 0.9], [-1.975, 0.46], [-1.93, 0.3]],
    W, WHITE, TAG.PAINT, { arches: [{ u: uF, r: r + 0.05 }, { u: uR, r: r + 0.05 }], bevel: 0.05 },
  );
  const cabin = { width: W - 0.12, taper: 0.8, v0: 0.93, v1: 1.5 };
  b.profile([[1.12, 0.93], [0.3, 1.47], [-1.5, 1.5], [-1.9, 0.99]], cabin.width, GLASS, TAG.GLASS, { taper: 0.8, bevel: 0.02 });
  b.profile([[0.36, 1.45], [0.28, 1.52], [-1.5, 1.55], [-1.6, 1.47]], (W - 0.12) * 0.8 + 0.04, WHITE, TAG.PAINT, { bevel: 0.02 });
  pillar(b, cabin, 1.12, 0.94, 0.3, 1.47, 0.07);
  pillar(b, cabin, -0.28, 0.95, -0.3, 1.49, 0.09, TRIM, TAG.FIXED);
  pillar(b, cabin, -1.88, 1.0, -1.5, 1.5, 0.14);
  carDetails(b, {
    L, W, headW: 0.36, headH: 0.12, headX: 0.55, headY: 0.72, grilleW: 0.6, grilleH: 0.08, grilleY: 0.62,
    tailW: 0.2, tailH: 0.32, tailY: 1.03, rearPlateY: 0.66, mirrorY: 1.0, mirrorU: 1.02,
  });
  return { geometry: b.build(), length: L, width: W, height: 1.55, wheels: wheels(uF, uR, r) };
}

function sedan(opts = {}) {
  const b = new ModelBuilder();
  const L = opts.L || 4.45;
  const W = opts.W || 1.695;
  const r = opts.r || 0.3;
  const f = L / 2;
  const uF = f - 0.88;
  const uR = -f + 0.98;
  b.profile(
    [[f - 0.07, 0.3], [f, 0.46], [f - 0.02, 0.68], [f - 0.14, 0.77], [f - 1.12, 0.88], [-1.3, 0.93], [-f + 0.1, 0.93], [-f, 0.8], [-f, 0.46], [-f + 0.05, 0.3]],
    W, WHITE, TAG.PAINT, { arches: [{ u: uF, r: r + 0.05 }, { u: uR, r: r + 0.05 }], bevel: 0.05 },
  );
  const cabin = { width: W - 0.12, taper: 0.78, v0: 0.88, v1: 1.44 };
  const u0 = f - 1.12;
  b.profile([[u0, 0.88], [u0 - 0.85, 1.42], [-0.8, 1.44], [-1.36, 0.93]], cabin.width, GLASS, TAG.GLASS, { taper: 0.78, bevel: 0.02 });
  b.profile([[u0 - 0.8, 1.4], [u0 - 0.88, 1.47], [-0.8, 1.49], [-0.9, 1.41]], (W - 0.12) * 0.78 + 0.04, WHITE, TAG.PAINT, { bevel: 0.02 });
  pillar(b, cabin, u0, 0.89, u0 - 0.85, 1.42, 0.07);
  pillar(b, cabin, -0.22, 0.9, -0.24, 1.43, 0.09, TRIM, TAG.FIXED);
  pillar(b, cabin, -1.34, 0.94, -0.8, 1.44, 0.18);
  carDetails(b, {
    L, W, headW: 0.38, headH: 0.12, headX: 0.56, headY: 0.7, grilleW: opts.grilleW || 0.62, grilleH: opts.grilleH || 0.1,
    grilleY: 0.6, grille: opts.grille, tailW: opts.tailW || 0.34, tailH: 0.14, tailY: 0.84, rearPlateY: 0.62, mirrorY: 0.95, mirrorU: u0 - 0.1,
  });
  if (opts.chrome) {
    for (const s of [-1, 1]) b.beam([s * (W / 2 + 0.005), 0.9, -(u0 - 0.05)], [s * (W / 2 + 0.005), 0.92, 1.3], 0.02, CHROME, TAG.FIXED, 0.03);
    b.cylinder(0.05, 0.03, 0, 0.78, -(f - 0.02), CHROME, TAG.FIXED, 'z', 8);
  }
  if (opts.taxiSign) {
    b.box(0.5, 0.16, 0.26, 0, 1.56, 0.0, '#f2d21b');
    b.panel(0.46, 0.13, 0, 1.56, -0.135, 'front', '#f2d21b', TAG.BANNER);
    b.panel(0.46, 0.13, 0, 1.56, 0.135, 'rear', '#f2d21b', TAG.BANNER);
  }
  return { geometry: b.build(), length: L, width: W, height: 1.46, wheels: wheels(uF, uR, r) };
}

function wagon() {
  const b = new ModelBuilder();
  const L = 4.6;
  const W = 1.695;
  const r = 0.31;
  const uF = 1.4;
  const uR = -1.35;
  b.profile(
    [[2.22, 0.3], [2.3, 0.46], [2.28, 0.66], [2.15, 0.76], [1.35, 0.92], [-2.2, 1.0], [-2.3, 0.9], [-2.3, 0.46], [-2.26, 0.3]],
    W, WHITE, TAG.PAINT, { arches: [{ u: uF, r: r + 0.05 }, { u: uR, r: r + 0.05 }], bevel: 0.05 },
  );
  const cabin = { width: W - 0.12, taper: 0.82, v0: 0.92, v1: 1.6 };
  b.profile([[1.35, 0.92], [0.35, 1.56], [-1.95, 1.6], [-2.22, 1.02]], cabin.width, GLASS, TAG.GLASS, { taper: 0.82, bevel: 0.02 });
  b.profile([[0.4, 1.53], [0.32, 1.6], [-1.95, 1.64], [-2.04, 1.56]], (W - 0.12) * 0.82 + 0.04, WHITE, TAG.PAINT, { bevel: 0.02 });
  pillar(b, cabin, 1.35, 0.93, 0.35, 1.56, 0.07);
  pillar(b, cabin, -0.2, 0.95, -0.2, 1.58, 0.09, TRIM, TAG.FIXED);
  pillar(b, cabin, -1.3, 0.97, -1.3, 1.6, 0.09);
  pillar(b, cabin, -2.2, 1.03, -1.95, 1.6, 0.13);
  for (const s of [-1, 1]) b.beam([s * 0.6, 1.68, -0.2], [s * 0.6, 1.68, 1.85], 0.03, GREY, TAG.FIXED);
  carDetails(b, {
    L, W, headW: 0.38, headH: 0.13, headX: 0.55, headY: 0.72, grilleW: 0.7, grilleH: 0.1, grilleY: 0.6,
    tailW: 0.2, tailH: 0.34, tailY: 1.06, rearPlateY: 0.66, mirrorY: 1.0, mirrorU: 1.25,
  });
  return { geometry: b.build(), length: L, width: W, height: 1.64, wheels: wheels(uF, uR, r) };
}

function suv() {
  const b = new ModelBuilder();
  const L = 4.85;
  const W = 1.93;
  const r = 0.38;
  const uF = 1.5;
  const uR = -1.35;
  b.profile(
    [[2.38, 0.45], [2.43, 0.62], [2.42, 0.98], [2.3, 1.08], [1.35, 1.14], [-2.33, 1.18], [-2.425, 1.1], [-2.425, 0.6], [-2.38, 0.45]],
    W, WHITE, TAG.PAINT, { arches: [{ u: uF, r: r + 0.07 }, { u: uR, r: r + 0.07 }], bevel: 0.06 },
  );
  const cabin = { width: W - 0.12, taper: 0.88, v0: 1.14, v1: 1.8 };
  b.profile([[1.35, 1.14], [0.6, 1.76], [-2.2, 1.8], [-2.36, 1.2]], cabin.width, TINT, TAG.GLASS, { taper: 0.88, bevel: 0.02 });
  b.profile([[0.65, 1.74], [0.57, 1.81], [-2.2, 1.84], [-2.28, 1.77]], (W - 0.12) * 0.88 + 0.04, WHITE, TAG.PAINT, { bevel: 0.02 });
  pillar(b, cabin, 1.35, 1.15, 0.6, 1.76, 0.08);
  pillar(b, cabin, -0.25, 1.17, -0.25, 1.79, 0.1, TRIM, TAG.FIXED);
  pillar(b, cabin, -1.45, 1.18, -1.45, 1.8, 0.14);
  pillar(b, cabin, -2.34, 1.2, -2.2, 1.8, 0.12);
  for (const s of [-1, 1]) {
    b.beam([s * 0.74, 1.92, -0.45], [s * 0.74, 1.92, 2.1], 0.04, GREY, TAG.FIXED);
    b.box(0.08, 0.12, 1.1, s * (W / 2 + 0.01), 0.72, -uF, TRIM);
    b.box(0.08, 0.12, 1.1, s * (W / 2 + 0.01), 0.72, -uR, TRIM);
  }
  b.cylinder(0.36, 0.22, 0, 1.0, 2.53, '#161616', TAG.FIXED, 'z', 14);
  b.cylinder(0.3, 0.24, 0, 1.0, 2.53, '#2b2d30', TAG.FIXED, 'z', 14);
  b.pair(0.42, 0.16, 0.3, 0.6, 0.92, -2.28, HEAD, TAG.HEADLIGHT);
  b.box(0.7, 0.28, 0.06, 0, 0.9, -2.43, CHROME);
  b.box(W + 0.02, 0.26, 0.2, 0, 0.58, -2.42, GREY);
  indicators(b, 0.12, 0.08, 0.86, 0.72, -2.44);
  b.pair(0.18, 0.3, 0.08, 0.84, 1.0, 2.4, TAIL, TAG.TAILLIGHT);
  indicators(b, 0.14, 0.06, 0.84, 0.8, 2.43);
  b.box(W, 0.2, 0.16, 0, 0.56, 2.42, GREY);
  plates(b, 2.53, 0.58, 2.45, 0.74);
  b.pair(0.1, 0.14, 0.2, W / 2 + 0.06, 1.26, -1.2, WHITE, TAG.PAINT);
  b.box(W - 0.3, 0.2, L - 0.6, 0, 0.36, 0, TRIM);
  return { geometry: b.build(), length: L, width: W, height: 1.88, wheels: wheels(uF, uR, r, 0.26) };
}

function pickup({ singleCab = false } = {}) {
  const b = new ModelBuilder();
  const L = singleCab ? 5.0 : 5.3;
  const W = singleCab ? 1.75 : 1.85;
  const r = 0.36;
  const f = L / 2;
  const uF = f - 1.0;
  const uR = uF - (singleCab ? 3.0 : 3.1);
  const cabBack = singleCab ? -0.25 : -0.95;
  const floor = 0.72;
  b.profile(
    [[f - 0.07, 0.44], [f, 0.62], [f - 0.02, 0.95], [f - 0.15, 1.06], [f - 1.35, 1.12], [cabBack, 1.14], [cabBack, floor], [-f + 0.05, floor], [-f, 0.62], [-f + 0.04, 0.44]],
    W, WHITE, TAG.PAINT, { arches: [{ u: uF, r: r + 0.07 }, { u: uR, r: r + 0.07 }], bevel: 0.05 },
  );
  const u0 = f - 1.35;
  const cabin = { width: W - 0.12, taper: 0.86, v0: 1.12, v1: 1.78 };
  b.profile([[u0, 1.12], [u0 - 0.72, 1.74], [cabBack + 0.1, 1.78], [cabBack + 0.02, 1.14]], cabin.width, GLASS, TAG.GLASS, { taper: 0.86, bevel: 0.02 });
  b.profile([[u0 - 0.68, 1.72], [u0 - 0.76, 1.79], [cabBack + 0.1, 1.82], [cabBack + 0.02, 1.75]], (W - 0.12) * 0.86 + 0.04, WHITE, TAG.PAINT, { bevel: 0.02 });
  pillar(b, cabin, u0, 1.13, u0 - 0.72, 1.74, 0.08);
  if (!singleCab) pillar(b, cabin, -0.05, 1.14, -0.05, 1.77, 0.1, TRIM, TAG.FIXED);
  pillar(b, cabin, cabBack + 0.05, 1.15, cabBack + 0.1, 1.78, 0.14);
  // Load bed: walls, tailgate, floor.
  const bedLen = f + cabBack - 0.05;
  const bedMid = -(cabBack - 0.05 - bedLen / 2);
  for (const s of [-1, 1]) b.box(0.07, 0.42, bedLen, s * (W / 2 - 0.035), floor + 0.21, bedMid, WHITE, TAG.PAINT);
  b.box(W, 0.42, 0.07, 0, floor + 0.21, f - 0.035, WHITE, TAG.PAINT);
  b.box(W, 0.42, 0.06, 0, floor + 0.21, -(cabBack - 0.03), WHITE, TAG.PAINT);
  b.box(W - 0.14, 0.02, bedLen - 0.1, 0, floor + 0.01, bedMid, '#26272a');
  if (singleCab) {
    // Load: sacks of mealie-meal / produce in the accent colour, one tied tarp bundle.
    const sack = (x, y, z, ry) => {
      const g = new THREE.BoxGeometry(0.46, 0.26, 0.72, 1, 1, 1);
      g.rotateY(ry);
      g.translate(x, y, z);
      b.add(g, WHITE, TAG.ACCENT);
    };
    sack(-0.4, floor + 0.14, 1.0, 0.1);
    sack(0.35, floor + 0.14, 1.1, -0.08);
    sack(-0.35, floor + 0.14, 1.85, 0.05);
    sack(0.38, floor + 0.14, 1.9, 0.12);
    sack(0.0, floor + 0.4, 1.45, 1.5);
    b.box(0.9, 0.3, 0.6, 0, floor + 0.15, 0.4, '#2c5aa0');
  }
  b.pair(0.36, 0.14, 0.3, 0.58, 0.9, -(f - 0.16), HEAD, TAG.HEADLIGHT);
  b.box(0.76, 0.3, 0.06, 0, 0.86, -(f - 0.03), singleCab ? TRIM : CHROME);
  b.box(W + 0.04, 0.24, 0.18, 0, 0.56, -(f + 0.02), singleCab ? GREY : CHROME);
  indicators(b, 0.1, 0.07, W / 2 - 0.08, 0.72, -(f - 0.04));
  b.pair(0.1, 0.34, 0.06, W / 2 - 0.06, floor + 0.2, f - 0.02, TAIL, TAG.TAILLIGHT);
  indicators(b, 0.1, 0.06, W / 2 - 0.06, floor - 0.02, f - 0.02);
  b.box(W, 0.14, 0.2, 0, 0.5, f + 0.03, GREY);
  plates(b, f + 0.12, 0.56, f + 0.005, 0.86);
  b.pair(0.1, 0.15, 0.2, W / 2 + 0.06, 1.24, -(u0 - 0.1), TRIM);
  b.box(W - 0.3, 0.2, L - 0.5, 0, 0.36, 0, TRIM);
  return { geometry: b.build(), length: L, width: W, height: 1.82, wheels: wheels(uF, uR, r, 0.24) };
}

// Toyota HiAce H100 "Commuter": boxy cab-over, left-hand sliding door (kerb side) left open for the hwindi.
function kombi({ rack = false } = {}) {
  const b = new ModelBuilder();
  const L = 4.7;
  const W = 1.69;
  const r = 0.33;
  const uF = 1.5;
  const uR = -1.3;
  const f = L / 2;
  const hw = W / 2;
  b.profile(
    [[2.3, 0.38], [2.35, 0.5], [2.35, 0.96], [2.3, 1.06], [2.02, 1.86], [1.88, 2.0], [1.7, 2.05], [-2.25, 2.05], [-2.35, 1.95], [-2.35, 0.5], [-2.3, 0.38]],
    W, WHITE, TAG.PAINT, { arches: [{ u: uF, r: r + 0.06 }, { u: uR, r: r + 0.06 }], bevel: 0.05 },
  );
  // Windscreen (raked slab just proud of the body) with a sticker banner along its top edge.
  const ws = [[2.31, 1.1], [2.05, 1.84]];
  const tilt = Math.atan2(ws[0][0] - ws[1][0], ws[1][1] - ws[0][1]);
  const nU = Math.cos(tilt) * 0.02;
  const nV = Math.sin(tilt) * 0.02;
  b.beam([0, ws[0][1] + nV, -(ws[0][0] + nU)], [0, ws[1][1] + nV, -(ws[1][0] + nU)], W - 0.18, GLASS, TAG.GLASS, 0.03);
  b.panel(W - 0.3, 0.13, 0, 1.76, -(2.08 + 0.05), 'front', GLASS, TAG.BANNER, tilt);
  // Side glass: cab door windows and the long passenger window band, split by pillars.
  for (const s of [-1, 1]) {
    b.box(0.02, 0.62, 0.6, s * (hw + 0.006), 1.44, -1.72, GLASS, TAG.GLASS);
    b.box(0.02, 0.64, 3.45, s * (hw + 0.006), 1.47, 0.48, GLASS, TAG.GLASS);
    for (const u of [1.36, 1.26, 0.2, -0.75, -1.55, -2.2]) {
      if (s < 0 && u < 1.3 && u > 0.1) continue;
      b.box(0.03, 0.66, u === 1.36 ? 0.06 : 0.1, s * (hw + 0.012), 1.47, -u, WHITE, TAG.PAINT);
    }
    // Livery stripes (accent colour) + door shut lines.
    b.box(0.02, 0.14, L - 0.04, s * (hw + 0.01), 0.91, 0, WHITE, TAG.ACCENT);
    b.box(0.02, 0.04, L - 0.04, s * (hw + 0.01), 1.03, 0, WHITE, TAG.ACCENT);
    b.box(0.02, 1.3, 0.02, s * (hw + 0.012), 1.18, -1.36, TRIM);
  }
  b.box(W - 0.1, 0.14, 0.02, 0, 0.91, -(f + 0.012), WHITE, TAG.ACCENT);
  // Left side: open sliding door, seats and passengers visible, door panel slid back over the rail.
  const doorU0 = 1.24;
  const doorU1 = 0.3;
  const dz = -(doorU0 + doorU1) / 2;
  const dw = doorU0 - doorU1;
  b.box(0.02, 1.4, dw, -(hw + 0.012), 1.15, dz, '#0c0c0e');
  b.box(0.02, 0.32, dw - 0.06, -(hw + 0.016), 0.82, dz, '#4d463e');
  const seat = ['#6b2f2f', '#274a7a', '#cfa33a'];
  [0.45, 0.8, 1.1].forEach((u, i) => {
    b.box(0.02, 0.3, 0.2, -(hw + 0.018), 1.18, -u, seat[i]);
    b.box(0.02, 0.17, 0.14, -(hw + 0.02), 1.43, -u, '#3a2418');
  });
  b.box(0.04, 1.38, dw, -(hw + 0.05), 1.14, -(doorU1 - dw / 2 - 0.02), WHITE, TAG.PAINT);
  b.box(0.02, 0.58, dw - 0.16, -(hw + 0.075), 1.47, -(doorU1 - dw / 2 - 0.02), GLASS, TAG.GLASS);
  b.box(0.02, 0.14, dw, -(hw + 0.075), 0.91, -(doorU1 - dw / 2 - 0.02), WHITE, TAG.ACCENT);
  b.box(0.03, 0.03, 2.3, -(hw + 0.03), 1.08, 0.55, TRIM);
  // Rear window with a slogan banner, lamps, bumpers, mirrors on stalks.
  b.box(W - 0.3, 0.68, 0.02, 0, 1.5, f + 0.006, GLASS, TAG.GLASS);
  b.panel(W - 0.36, 0.13, 0, 1.76, f + 0.02, 'rear', GLASS, TAG.BANNER);
  b.pair(0.34, 0.16, 0.05, 0.56, 0.84, -(f + 0.004), HEAD, TAG.HEADLIGHT);
  b.box(0.74, 0.2, 0.05, 0, 0.84, -(f + 0.006), TRIM);
  indicators(b, 0.11, 0.1, 0.79, 0.68, -(f + 0.006));
  b.box(W + 0.04, 0.16, 0.14, 0, 0.5, -(f + 0.03), GREY);
  b.pair(0.15, 0.42, 0.05, 0.74, 0.92, f + 0.004, TAIL, TAG.TAILLIGHT);
  indicators(b, 0.15, 0.08, 0.74, 0.65, f + 0.006);
  b.box(W + 0.04, 0.16, 0.14, 0, 0.5, f + 0.03, GREY);
  plates(b, f + 0.105, 0.5, f + 0.006, 0.74);
  for (const s of [-1, 1]) {
    b.beam([s * hw, 1.3, -2.08], [s * (hw + 0.15), 1.36, -2.12], 0.03, TRIM, TAG.FIXED);
    b.box(0.05, 0.24, 0.13, s * (hw + 0.16), 1.42, -2.12, TRIM);
  }
  b.box(W - 0.3, 0.18, L - 0.7, 0, 0.3, 0, TRIM);
  if (rack) {
    const y = 2.2;
    for (const s of [-1, 1]) {
      b.beam([s * 0.72, y, -1.55], [s * 0.72, y, 2.0], 0.04, '#2b2b2b', TAG.FIXED);
      for (const z of [-1.5, 1.95]) b.box(0.05, 0.16, 0.05, s * 0.72, y - 0.08, z, '#2b2b2b');
    }
    for (const z of [-1.5, -0.6, 0.4, 1.3, 1.95]) b.box(1.48, 0.035, 0.04, 0, y, z, '#2b2b2b');
    b.box(0.82, 0.36, 0.95, 0.18, y + 0.2, 0.45, '#2e5aa6');
    b.box(0.6, 0.3, 0.62, -0.36, y + 0.17, -0.5, '#c2ad7f');
    b.box(0.5, 0.26, 0.5, 0.3, y + 0.15, -0.95, '#333333');
    b.box(0.46, 0.22, 0.7, -0.32, y + 0.13, 1.4, '#8a3b2a');
  }
  return {
    geometry: b.build(), length: L, width: W, height: rack ? 2.55 : 2.05, wheels: wheels(uF, uR, r, 0.2),
    door: { x: -hw, z: dz },
  };
}

function bus() {
  const b = new ModelBuilder();
  const L = 11.5;
  const W = 2.5;
  const r = 0.5;
  const uF = 3.25;
  const uR = -2.55;
  const f = L / 2;
  const hw = W / 2;
  b.profile(
    [[5.7, 0.5], [5.75, 0.62], [5.75, 1.15], [5.72, 1.2], [5.62, 2.95], [5.45, 3.18], [5.2, 3.2], [-5.55, 3.2], [-5.75, 3.0], [-5.75, 0.62], [-5.7, 0.5]],
    W, WHITE, TAG.PAINT, { arches: [{ u: uF, r: r + 0.07 }, { u: uR, r: r + 0.07 }], bevel: 0.06 },
  );
  b.beam([0, 1.25, -(5.745)], [0, 2.88, -(5.64)], W - 0.2, GLASS, TAG.GLASS, 0.03);
  b.panel(1.9, 0.26, 0, 2.74, -(5.68), 'front', '#0a0a0a', TAG.SIGN, 0.065);
  for (const s of [-1, 1]) {
    b.box(0.02, 1.2, 10.3, s * (hw + 0.006), 2.15, 0.25, GLASS, TAG.GLASS);
    b.box(0.02, 1.35, 0.6, s * (hw + 0.006), 2.07, -5.25, GLASS, TAG.GLASS);
    for (const u of [4.92, 3.65, 2.4, 1.15, -0.1, -1.35, -2.6, -3.85, -5.1, -5.42]) b.box(0.03, 1.22, 0.1, s * (hw + 0.012), 2.15, -u, WHITE, TAG.PAINT);
    b.box(0.02, 0.34, L - 0.1, s * (hw + 0.012), 0.95, 0, WHITE, TAG.ACCENT);
    b.box(0.02, 0.06, L - 0.1, s * (hw + 0.014), 1.2, 0, '#d9a520');
  }
  b.panel(2.6, 0.3, -(hw + 0.02), 1.38, 3.1, 'left', WHITE, TAG.BANNER_PAINT);
  b.panel(2.6, 0.3, hw + 0.02, 1.38, 0.4, 'right', WHITE, TAG.BANNER_PAINT);
  // Kerb-side (left) doors.
  for (const [u, w] of [[4.55, 0.95], [-0.2, 1.05]]) {
    b.box(0.025, 2.25, w, -(hw + 0.02), 1.7, -u, GLASS, TAG.GLASS);
    b.box(0.03, 2.25, 0.04, -(hw + 0.024), 1.7, -u, TRIM);
  }
  b.box(W - 0.1, 0.3, 0.02, 0, 0.95, -(f + 0.012), WHITE, TAG.ACCENT);
  b.pair(0.42, 0.2, 0.05, 0.82, 0.8, -(f + 0.004), HEAD, TAG.HEADLIGHT);
  indicators(b, 0.12, 0.12, 1.12, 0.8, -(f + 0.006));
  b.box(W, 0.3, 0.14, 0, 0.62, -(f + 0.05), TRIM);
  b.box(W - 0.5, 0.8, 0.02, 0, 2.4, f + 0.006, GLASS, TAG.GLASS);
  b.box(1.6, 0.5, 0.02, 0, 1.1, f + 0.006, TRIM);
  b.pair(0.18, 0.5, 0.05, 1.05, 1.15, f + 0.004, TAIL, TAG.TAILLIGHT);
  indicators(b, 0.18, 0.1, 1.05, 0.8, f + 0.006);
  b.box(W, 0.25, 0.12, 0, 0.6, f + 0.05, TRIM);
  plates(b, f + 0.13, 0.62, f + 0.12, 0.62);
  for (const s of [-1, 1]) {
    b.beam([s * 1.15, 2.75, -5.6], [s * 1.38, 2.62, -6.05], 0.04, TRIM, TAG.FIXED);
    b.box(0.08, 0.36, 0.16, s * 1.38, 2.38, -6.05, TRIM);
  }
  b.box(1.4, 0.2, 2.2, 0, 3.3, 1.0, '#d7d7d4');
  b.box(W - 0.4, 0.22, L - 1.0, 0, 0.45, 0, TRIM);
  return { geometry: b.build(), length: L, width: W, height: 3.4, wheels: wheels(uF, uR, r, 0.3, { rearW: 0.5 }) };
}

function truck() {
  const b = new ModelBuilder();
  const L = 7.0;
  const W = 2.2;
  const r = 0.45;
  const uF = 2.7;
  const uR = -1.2;
  const hw = W / 2;
  b.profile(
    [[3.45, 0.55], [3.5, 0.7], [3.5, 1.25], [3.45, 1.35], [3.3, 2.4], [3.1, 2.6], [1.9, 2.6], [1.9, 0.55]],
    W, WHITE, TAG.PAINT, { arches: [{ u: uF, r: r + 0.07 }], bevel: 0.05 },
  );
  b.beam([0, 1.38, -3.48], [0, 2.36, -3.33], W - 0.2, GLASS, TAG.GLASS, 0.03);
  for (const s of [-1, 1]) b.box(0.02, 0.8, 0.95, s * (hw + 0.006), 1.9, -2.75, GLASS, TAG.GLASS);
  // Box body in the accent colour, chassis rails, rear doors.
  b.box(W + 0.04, 2.25, 5.3, 0, 2.03, 0.85, WHITE, TAG.ACCENT);
  b.box(W - 0.5, 0.3, 6.8, 0, 0.66, 0, TRIM);
  b.box(0.03, 2.1, 0.02, 0, 2.0, 3.515, TRIM);
  for (const x of [-0.5, 0.5]) b.box(0.04, 2.0, 0.03, x, 2.0, 3.52, GREY);
  for (const s of [-1, 1]) b.box(0.3, 0.05, 1.0, s * (hw - 0.2), 0.96, -uR, TRIM);
  b.pair(0.3, 0.16, 0.05, 0.8, 0.85, -3.505, HEAD, TAG.HEADLIGHT);
  b.box(1.0, 0.35, 0.04, 0, 1.02, -3.51, TRIM);
  indicators(b, 0.12, 0.1, 1.0, 0.85, -3.51);
  b.box(W + 0.05, 0.28, 0.16, 0, 0.62, -3.55, '#2a2a2a');
  b.pair(0.22, 0.12, 0.05, 0.85, 0.72, 3.52, TAIL, TAG.TAILLIGHT);
  indicators(b, 0.12, 0.08, 0.6, 0.72, 3.52);
  plates(b, 3.64, 0.62, 3.52, 0.95);
  for (const s of [-1, 1]) {
    b.beam([s * hw, 2.1, -3.1], [s * (hw + 0.2), 2.15, -3.1], 0.04, TRIM, TAG.FIXED);
    b.box(0.08, 0.42, 0.2, s * (hw + 0.22), 1.95, -3.1, TRIM);
  }
  return { geometry: b.build(), length: L, width: W, height: 3.15, wheels: wheels(uF, uR, r, 0.3, { rearW: 0.5 }) };
}

// The hwindi (conductor): one arm up gripping the door frame, the other waving passengers in.
function hwindi() {
  const b = new ModelBuilder();
  const SKIN = '#4a2c1e';
  b.box(0.15, 0.82, 0.17, -0.1, 0.45, 0, WHITE, TAG.ACCENT);
  b.box(0.15, 0.82, 0.17, 0.1, 0.45, 0.02, WHITE, TAG.ACCENT);
  b.box(0.15, 0.08, 0.27, -0.1, 0.04, -0.04, '#121212');
  b.box(0.15, 0.08, 0.27, 0.1, 0.04, -0.02, '#121212');
  b.box(0.42, 0.62, 0.24, 0, 1.15, 0, WHITE, TAG.PAINT);
  b.box(0.1, 0.1, 0.1, 0, 1.5, 0, SKIN);
  const head = new THREE.IcosahedronGeometry(0.12, 1);
  head.scale(0.9, 1.08, 1);
  head.translate(0, 1.64, 0);
  b.add(head, SKIN);
  b.box(0.2, 0.06, 0.22, 0, 1.76, -0.03, '#1a1a1a');
  b.box(0.2, 0.03, 0.1, 0, 1.745, -0.17, '#1a1a1a');
  b.beam([-0.24, 1.4, 0], [-0.3, 1.98, -0.16], 0.1, WHITE, TAG.PAINT);
  b.box(0.09, 0.1, 0.09, -0.3, 2.03, -0.18, SKIN);
  b.beam([0.24, 1.4, 0], [0.48, 1.62, -0.28], 0.1, WHITE, TAG.PAINT);
  b.box(0.09, 0.1, 0.09, 0.52, 1.66, -0.32, SKIN);
  return { geometry: b.build() };
}

// Built lazily per model key; `type` maps traffic types onto these.
export const MODEL_BUILDERS = {
  kombi: () => kombi(),
  kombiRack: () => kombi({ rack: true }),
  hatch,
  sedan: () => sedan(),
  merc: () => sedan({ L: 4.8, W: 1.8, r: 0.32, chrome: true, grille: CHROME, grilleW: 0.56, grilleH: 0.24, tailW: 0.44 }),
  taxi: () => sedan({ taxiSign: true }),
  wagon,
  pickup: () => pickup(),
  bakkie: () => pickup({ singleCab: true }),
  suv,
  bus,
  truck,
};

export function buildHwindi() {
  return hwindi();
}

// Unit wheel (radius 1, width 1, axle along x): tyre, rim, hub and two spokes so rotation reads.
export function buildWheelGeometry() {
  const b = new ModelBuilder();
  b.cylinder(1, 1, 0, 0, 0, '#141414', TAG.FIXED, 'x', 14);
  b.cylinder(0.64, 1.03, 0, 0, 0, '#9ea2a7', TAG.FIXED, 'x', 12);
  b.cylinder(0.22, 1.07, 0, 0, 0, '#56595d', TAG.FIXED, 'x', 6);
  b.box(1.05, 0.14, 1.16, 0, 0, 0, '#3b3e42');
  b.box(1.05, 1.16, 0.14, 0, 0, 0, '#3b3e42');
  return b.build();
}
