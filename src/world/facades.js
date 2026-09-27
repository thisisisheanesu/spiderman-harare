import { Painter } from './atlas.js';

// Procedural facade / roof / detail layers for the building texture array.
// Every wall layer is one "bay" wide (tileW metres) and exactly one floor high, so windows line up
// with the floors of each building (the builder sets v = height / floorHeight). Walls are painted
// light and neutral: the per-building tint (vertex colour) gives them their colour.

const FRAME = '#50565a';
const ALU = '#8d9397';
const SILL = '#f6f4ef';

function wallBase(p, color = '#ebe9e3', grime = 0.2) {
  p.rect(0, 0, 1, 1, color);
  p.grime(grime * 0.6, 1);
  p.speckle(p.S * 3, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.07)'], p.S / 256);
}

// Recessed window: reveal shadow on the top/left, glass, frame bars.
function window1(p, x0, y0, x1, y1, { reveal = 0.025, mullions = 1, transom = 0.3, frame = FRAME, sill = true } = {}) {
  p.solid(x0, y0, x1, y1, '#8f8b83');
  p.glass(x0 + reveal, y0 + reveal, x1, y1);
  const fw = 0.012;
  for (let i = 1; i <= mullions; i++) {
    const x = x0 + ((x1 - x0) * i) / (mullions + 1);
    p.solid(x - fw / 2, y0 + reveal, x + fw / 2, y1, frame);
  }
  if (transom) p.solid(x0 + reveal, y0 + (y1 - y0) * transom, x1, y0 + (y1 - y0) * transom + fw, frame);
  p.solid(x0 + reveal, y0 + reveal, x1, y0 + reveal + fw, frame);
  p.solid(x1 - fw, y0 + reveal, x1, y1, frame);
  if (sill) {
    p.solid(x0 - 0.02, y1, x1 + 0.02, y1 + 0.028, SILL);
    p.rect(x0 - 0.02, y1 + 0.028, x1 + 0.02, y1 + 0.036, 'rgba(0,0,0,0.18)');
  }
}

const FACADE_STYLES = {
  // 1950s-70s office slab: continuous glass bands between concrete spandrels.
  bands: {
    tileW: 3.0,
    draw(p) {
      wallBase(p, '#ecebe6', 0.16);
      p.rect(0, 0.84, 1, 0.842, 'rgba(0,0,0,0.12)');
      p.solid(0, 0.16, 1, 0.19, '#6b6862');
      p.glass(0, 0.19, 1, 0.64);
      for (const x of [0, 0.5]) p.solid(x, 0.19, x + 0.014, 0.64, FRAME);
      p.solid(0, 0.385, 1, 0.395, FRAME);
      p.solid(0, 0.64, 1, 0.668, SILL);
      p.rect(0, 0.668, 1, 0.68, 'rgba(0,0,0,0.2)');
      p.streaks(0.68, 1, 10, 'rgba(60,55,50,1)', 0.1);
    },
  },
  punched: {
    tileW: 3.2,
    draw(p) {
      wallBase(p, '#e9e6df', 0.22);
      p.rect(0, 0.955, 1, 1, 'rgba(0,0,0,0.07)');
      window1(p, 0.22, 0.17, 0.78, 0.7, { mullions: 1 });
      p.streaks(0.735, 1, 6, 'rgba(60,55,50,1)', 0.14);
    },
  },
  pair: {
    tileW: 3.6,
    draw(p) {
      wallBase(p, '#e8e4dc', 0.2);
      p.rect(0.455, 0, 0.545, 1, 'rgba(255,255,255,0.35)');
      p.rect(0.535, 0, 0.545, 1, 'rgba(0,0,0,0.1)');
      window1(p, 0.1, 0.13, 0.42, 0.74, { mullions: 0, transom: 0.25 });
      window1(p, 0.58, 0.13, 0.9, 0.74, { mullions: 0, transom: 0.25 });
      p.streaks(0.78, 1, 6, 'rgba(60,55,50,1)', 0.12);
    },
  },
  brick: {
    tileW: 3.0,
    draw(p) {
      p.rect(0, 0, 1, 1, '#cbc2b4');
      const courses = 44;
      const bricks = 13;
      const tones = ['#9b4d34', '#a8583a', '#8d452f', '#b0633f', '#96503a', '#a35f45'];
      for (let r = 0; r < courses; r++) {
        const y0 = r / courses;
        const off = (r % 2) * 0.5;
        for (let b = -1; b < bricks + 1; b++) {
          const x0 = (b + off) / bricks;
          p.rect(x0 + 0.004, y0 + 0.003, x0 + 1 / bricks - 0.004, y0 + 1 / courses - 0.003, tones[Math.floor(p.rng() * tones.length)]);
        }
      }
      p.grime(0.2, 1);
      p.solid(0.22, 0.12, 0.78, 0.17, '#d9d4cb');
      p.solid(0.25, 0.17, 0.75, 0.7, '#f1efe9');
      p.glass(0.27, 0.19, 0.73, 0.68);
      p.solid(0.495, 0.19, 0.505, 0.68, '#f1efe9');
      p.solid(0.27, 0.36, 0.73, 0.37, '#f1efe9');
      p.solid(0.23, 0.7, 0.77, 0.73, '#d9d4cb');
    },
  },
  curtain: {
    tileW: 1.6,
    draw(p) {
      p.rect(0, 0, 1, 1, '#9ea5a8');
      p.glass(0, 0, 1, 0.8, '#5a6973', '#34414a');
      p.glass(0, 0.8, 1, 1, '#2f3a41', '#262f35');
      p.solid(0, 0, 0.022, 1, ALU);
      p.solid(0.978, 0, 1, 1, '#747a7e');
      p.solid(0, 0.795, 1, 0.81, ALU);
      p.solid(0, 0, 1, 0.008, '#747a7e');
    },
  },
  fins: {
    tileW: 1.5,
    draw(p) {
      wallBase(p, '#dfdcd5', 0.15);
      p.glass(0.3, 0.1, 1, 0.8);
      p.solid(0.3, 0.1, 1, 0.115, FRAME);
      p.solid(0.64, 0.1, 0.652, 0.8, FRAME);
      p.solid(0, 0, 0.24, 1, '#f1efea');
      p.hgrad(0.24, 0, 0.3, 1, '#b3afa6', '#cdc9c1');
      p.rect(0.02, 0, 0.04, 1, 'rgba(255,255,255,0.3)');
      p.streaks(0.8, 1, 3, 'rgba(60,55,50,1)', 0.1);
    },
  },
  balcony: {
    tileW: 3.6,
    draw(p) {
      wallBase(p, '#e4e0d8', 0.18);
      p.rect(0, 0, 1, 0.78, '#cfcac1');
      p.glass(0.1, 0.12, 0.6, 0.78);
      p.solid(0.345, 0.12, 0.355, 0.78, FRAME);
      p.solid(0.1, 0.12, 0.6, 0.135, FRAME);
      p.glass(0.67, 0.14, 0.92, 0.5);
      p.solid(0.79, 0.14, 0.8, 0.5, FRAME);
      p.solid(0.64, 0.5, 0.95, 0.52, SILL);
      p.vgrad(0, 0, 1, 0.12, 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0)');
      p.solid(0, 0.78, 1, 0.86, '#f3f1ec');
      p.rect(0, 0.86, 1, 0.88, 'rgba(0,0,0,0.22)');
      p.solid(0, 0.55, 1, 0.565, '#3d4245');
      for (let x = 0.01; x < 1; x += 0.04) p.solid(x, 0.565, x + 0.007, 0.78, '#474c4f');
    },
  },
  colonial: {
    tileW: 3.8,
    draw(p) {
      wallBase(p, '#f0e9da', 0.2);
      p.rect(0, 0, 0.06, 1, 'rgba(255,255,255,0.4)');
      p.rect(0.94, 0, 1, 1, 'rgba(255,255,255,0.4)');
      p.rect(0.055, 0, 0.06, 1, 'rgba(0,0,0,0.12)');
      p.rect(0, 0.93, 1, 0.945, 'rgba(0,0,0,0.12)');
      p.rect(0, 0.945, 1, 1, 'rgba(255,255,255,0.3)');
      // Shutters.
      for (const [a, b] of [[0.2, 0.3], [0.7, 0.8]]) {
        p.solid(a, 0.2, b, 0.72, '#546b53');
        for (let y = 0.22; y < 0.71; y += 0.03) p.rect(a + 0.01, y, b - 0.01, y + 0.012, 'rgba(0,0,0,0.25)');
      }
      p.solid(0.295, 0.17, 0.705, 0.75, '#faf6ee');
      p.glass(0.32, 0.2, 0.68, 0.72, '#4d5a61', '#2c353b');
      p.solid(0.495, 0.2, 0.505, 0.72, '#f4f1ea');
      for (const y of [0.37, 0.46, 0.55]) p.solid(0.32, y, 0.68, y + 0.01, '#f4f1ea');
      p.solid(0.28, 0.72, 0.72, 0.76, '#faf6ee');
      p.rect(0.28, 0.76, 0.72, 0.77, 'rgba(0,0,0,0.2)');
      p.streaks(0.77, 0.93, 5, 'rgba(90,70,50,1)', 0.12);
    },
  },
  house: {
    tileW: 4.5,
    draw(p) {
      wallBase(p, '#f1ece2', 0.22);
      p.vgrad(0, 0.86, 1, 1, 'rgba(170,95,60,0)', 'rgba(170,95,60,0.45)');
      p.solid(0.28, 0.26, 0.74, 0.3, '#e0dbd2');
      p.solid(0.3, 0.3, 0.72, 0.64, '#3f4549');
      p.glass(0.315, 0.315, 0.705, 0.625, '#56636b', '#2f383e');
      p.solid(0.505, 0.3, 0.515, 0.64, '#3f4549');
      for (let x = 0.33; x < 0.7; x += 0.045) p.solid(x, 0.315, x + 0.006, 0.625, '#2a2e31');
      for (const y of [0.41, 0.52]) p.solid(0.315, y, 0.705, y + 0.006, '#2a2e31');
      p.solid(0.28, 0.64, 0.74, 0.665, SILL);
    },
  },
  industrial: {
    tileW: 6,
    draw(p) {
      p.rect(0, 0, 1, 1, '#dcdcd8');
      for (let x = 0; x < 1; x += 0.025) {
        p.rect(x, 0, x + 0.008, 1, 'rgba(0,0,0,0.13)');
        p.rect(x + 0.008, 0, x + 0.012, 1, 'rgba(255,255,255,0.25)');
      }
      p.grime(0.25, 1);
      p.glass(0.04, 0.08, 0.96, 0.2, '#6a767e', '#4a555c');
      for (let x = 0.04; x < 0.97; x += 0.115) p.solid(x, 0.08, x + 0.008, 0.2, FRAME);
      p.rect(0, 0.82, 1, 1, '#b9b4ab');
      p.rect(0, 0.82, 1, 0.83, 'rgba(0,0,0,0.2)');
      p.streaks(0.2, 0.8, 12, 'rgba(120,70,40,1)', 0.14);
    },
  },
  blank: {
    tileW: 4,
    draw(p) {
      wallBase(p, '#e7e4dd', 0.28);
      p.rect(0, 0.96, 1, 0.965, 'rgba(0,0,0,0.08)');
      p.rect(0.5, 0, 0.503, 1, 'rgba(0,0,0,0.06)');
      p.streaks(0, 1, 8, 'rgba(70,60,50,1)', 0.1);
    },
  },
  grid: {
    tileW: 2.4,
    draw(p) {
      wallBase(p, '#ecebe7', 0.16);
      p.rect(0, 0, 1, 0.03, 'rgba(255,255,255,0.4)');
      p.rect(0, 0.97, 1, 1, 'rgba(0,0,0,0.1)');
      p.rect(0, 0, 0.03, 1, 'rgba(255,255,255,0.3)');
      p.rect(0.97, 0, 1, 1, 'rgba(0,0,0,0.08)');
      p.solid(0.13, 0.13, 0.87, 0.8, '#8d8982');
      p.solid(0.13, 0.13, 0.87, 0.19, '#77736c');
      p.glass(0.19, 0.19, 0.87, 0.8);
      p.solid(0.53, 0.19, 0.54, 0.8, FRAME);
      p.solid(0.19, 0.19, 0.87, 0.2, FRAME);
      p.streaks(0.8, 1, 4, 'rgba(60,55,50,1)', 0.12);
    },
  },
  // Eastgate Centre: grey precast window hoods ("teeth") over recessed glass, salmon brick infill.
  eastgate: {
    tileW: 3.2,
    draw(p) {
      p.rect(0, 0, 1, 1, '#cbbcae');
      for (let r = 0; r < 12; r++) {
        for (let c = 0; c < 8; c++) p.rect(c / 8 + 0.004, r / 12 + 0.004, (c + 1) / 8 - 0.004, (r + 1) / 12 - 0.004, r % 2 ? '#d6c3b1' : '#c9b4a2');
      }
      p.grime(0.25, 1);
      for (const x0 of [0.08, 0.54]) {
        p.solid(x0, 0.3, x0 + 0.38, 0.8, '#4a4845');
        p.glass(x0 + 0.03, 0.36, x0 + 0.35, 0.78, '#4b565c', '#2a3136');
        // Hood: a deep precast visor casting a shadow over the window.
        p.solid(x0 - 0.04, 0.2, x0 + 0.42, 0.3, '#ece6dc');
        p.vgrad(x0 - 0.04, 0.3, x0 + 0.42, 0.42, 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0)');
        p.solid(x0 - 0.04, 0.8, x0 + 0.42, 0.84, '#e6e0d6');
      }
      p.solid(0.47, 0, 0.53, 1, '#e4ded4');
      p.rect(0.525, 0, 0.53, 1, 'rgba(0,0,0,0.15)');
    },
  },
  // Round-arched attic storey under the roof line (the Meikles hotel tower): off-white precast
  // with one tall arched window per bay.
  arches: {
    tileW: 5.6,
    draw(p) {
      const { c, m, S } = p;
      p.rect(0, 0, 1, 1, '#ece9e2');
      p.grime(0.16, 1);
      const x0 = 0.22;
      const x1 = 0.78;
      const r = (x1 - x0) / 2;
      const spring = 0.16 + r;
      const y1 = 0.86;
      const arch = (ctx) => {
        ctx.beginPath();
        ctx.moveTo(x0 * S, y1 * S);
        ctx.lineTo(x0 * S, spring * S);
        ctx.arc(0.5 * S, spring * S, r * S, Math.PI, 0);
        ctx.lineTo(x1 * S, y1 * S);
        ctx.closePath();
      };
      // Deep reveal around the opening, then the glass (mask gradient as in Painter.glass).
      c.strokeStyle = 'rgba(0,0,0,0.28)';
      c.lineWidth = 0.05 * S;
      arch(c);
      c.stroke();
      const g = c.createLinearGradient(0, 0.16 * S, 0, y1 * S);
      g.addColorStop(0, '#5d6b76');
      g.addColorStop(1, '#35414a');
      c.fillStyle = g;
      arch(c);
      c.fill();
      const gm = m.createLinearGradient(0, 0.16 * S, 0, y1 * S);
      gm.addColorStop(0, '#fff');
      gm.addColorStop(1, '#808080');
      m.fillStyle = gm;
      arch(m);
      m.fill();
      p.solid(0.485, spring - 0.02, 0.515, y1, '#e2ded5');
      p.solid(x0, 0.6, x1, 0.625, '#e2ded5');
      p.rect(0, 0.86, 1, 0.9, 'rgba(0,0,0,0.18)');
      p.rect(0, 0.9, 1, 1, '#dedad1');
    },
  },
  // X-braced precast service tower (Eastgate).
  lattice: {
    tileW: 4,
    draw(p) {
      // The open bays show the dim shaft behind the X-bracing (pure dark read as black slabs).
      p.rect(0, 0, 1, 1, '#55534e');
      p.vgrad(0, 0, 1, 1, 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0)');
      const c = p.c;
      const S = p.S;
      c.strokeStyle = '#e4ddd2';
      c.lineWidth = 0.09 * S;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(S, S);
      c.moveTo(S, 0);
      c.lineTo(0, S);
      c.stroke();
      p.rect(0, 0, 0.08, 1, '#e4ddd2');
      p.rect(0.92, 0, 1, 1, '#e4ddd2');
      p.rect(0, 0, 1, 0.06, '#e4ddd2');
      p.grime(0.3, 1);
    },
  },
  // Pale granite frieze with a Great Zimbabwe chevron relief (Reserve Bank).
  frieze: {
    tileW: 3,
    draw(p) {
      p.rect(0, 0, 1, 1, '#eceeea');
      p.speckle(p.S * 30, ['rgba(40,40,40,0.25)', 'rgba(255,255,255,0.5)'], p.S / 300);
      const c = p.c;
      const S = p.S;
      for (const [y, shade] of [[0.3, 'rgba(0,0,0,0.22)'], [0.56, 'rgba(0,0,0,0.16)']]) {
        c.strokeStyle = shade;
        c.lineWidth = 0.035 * S;
        c.beginPath();
        for (let k = 0; k <= 6; k++) c.lineTo((k / 6) * S, (y + (k % 2 ? 0.12 : 0)) * S);
        c.stroke();
      }
      p.rect(0, 0.08, 1, 0.1, 'rgba(0,0,0,0.2)');
      p.rect(0, 0.84, 1, 0.87, 'rgba(0,0,0,0.25)');
    },
  },
  // Rough granite / sandstone ashlar with a lancet window (cathedrals).
  stone: {
    tileW: 4,
    draw(p) {
      p.rect(0, 0, 1, 1, '#9a948c');
      const rows = 9;
      for (let r = 0; r < rows; r++) {
        let x = -p.rng() * 0.2;
        while (x < 1) {
          const w = 0.12 + p.rng() * 0.16;
          const v = Math.round(215 + p.rng() * 35);
          p.rect(x + 0.006, r / rows + 0.008, x + w - 0.006, (r + 1) / rows - 0.008, `rgb(${v},${v - 6},${v - 14})`);
          x += w;
        }
      }
      p.grime(0.35, 1);
      const c = p.c;
      const S = p.S;
      c.fillStyle = '#e8e2d6';
      c.beginPath();
      c.moveTo(0.4 * S, 0.8 * S);
      c.lineTo(0.4 * S, 0.38 * S);
      c.quadraticCurveTo(0.5 * S, 0.14 * S, 0.6 * S, 0.38 * S);
      c.lineTo(0.6 * S, 0.8 * S);
      c.fill();
      p.glass(0.425, 0.36, 0.575, 0.78, '#3e4f63', '#26303b');
      p.solid(0.495, 0.36, 0.505, 0.78, '#2a2a2a');
    },
  },
};

// Ground-floor (street level) layers: the top of the tile is the fascia band.
const GROUND_STYLES = {
  shop: {
    tileW: 4.5,
    draw(p) {
      wallBase(p, '#e8e5de', 0.15);
      p.rect(0, 0.17, 1, 0.19, 'rgba(0,0,0,0.25)');
      p.glass(0.06, 0.2, 0.94, 0.93, '#48545b', '#252c31');
      // Merchandise silhouettes behind the glass.
      const goods = ['#b33a3a', '#e0b040', '#3a6fb3', '#e8e8e8', '#4f9a4f', '#d07030', '#8a4fa0'];
      for (let i = 0; i < 26; i++) {
        const x = 0.08 + p.rng() * 0.5;
        const y = 0.5 + p.rng() * 0.38;
        const w = 0.02 + p.rng() * 0.07;
        const h = 0.03 + p.rng() * 0.1;
        p.rect(x, y, x + w, y + h, goods[i % goods.length] + '66');
      }
      p.solid(0.06, 0.2, 0.94, 0.215, ALU);
      p.solid(0.06, 0.34, 0.94, 0.35, ALU);
      p.solid(0.6, 0.35, 0.615, 0.93, ALU);
      p.solid(0.86, 0.35, 0.875, 0.93, ALU);
      p.solid(0.72, 0.62, 0.76, 0.635, '#c9ccce');
      p.solid(0, 0.19, 0.06, 1, '#dcd8d0');
      p.solid(0.94, 0.19, 1, 1, '#dcd8d0');
      p.solid(0.06, 0.93, 0.94, 1, '#3f3c3a');
    },
  },
  shutter: {
    tileW: 4.5,
    draw(p) {
      wallBase(p, '#e8e5de', 0.15);
      p.solid(0.05, 0.19, 0.95, 0.25, '#6f7273');
      for (let y = 0.25; y < 1; y += 0.02) {
        p.rect(0.06, y, 0.94, y + 0.012, '#a3a6a6');
        p.rect(0.06, y + 0.012, 0.94, y + 0.02, '#7c7f80');
      }
      p.grime(0.3, 0.5);
      p.streaks(0.25, 1, 10, 'rgba(110,70,40,1)', 0.15);
      p.solid(0, 0.19, 0.06, 1, '#dcd8d0');
      p.solid(0.94, 0.19, 1, 1, '#dcd8d0');
    },
  },
  colshop: {
    tileW: 4.0,
    draw(p) {
      wallBase(p, '#efe8d8', 0.18);
      p.solid(0.04, 0.16, 0.96, 1, '#3f5a48');
      p.glass(0.08, 0.2, 0.44, 0.84, '#4b585f', '#283035');
      p.glass(0.62, 0.2, 0.92, 0.84, '#4b585f', '#283035');
      p.glass(0.48, 0.2, 0.58, 0.95, '#3c474d', '#20272b');
      for (const y of [0.33]) {
        p.solid(0.08, y, 0.44, y + 0.012, '#3f5a48');
        p.solid(0.62, y, 0.92, y + 0.012, '#3f5a48');
      }
      p.solid(0.255, 0.33, 0.265, 0.84, '#3f5a48');
      p.solid(0.765, 0.33, 0.775, 0.84, '#3f5a48');
      p.solid(0.04, 0.84, 0.96, 0.87, '#e9e2d0');
      p.solid(0, 0, 0.04, 1, '#e9e2d0');
      p.solid(0.96, 0, 1, 1, '#e9e2d0');
    },
  },
  lobby: {
    tileW: 5,
    draw(p) {
      p.rect(0, 0, 1, 1, '#b9b3aa');
      p.speckle(p.S * 20, ['rgba(40,35,35,0.3)', 'rgba(255,255,255,0.4)'], p.S / 300);
      p.glass(0.08, 0.12, 0.92, 1, '#55626a', '#2a3338');
      for (const x of [0.08, 0.3, 0.5, 0.7, 0.915]) p.solid(x, 0.12, x + 0.008, 1, '#2d3134');
      p.solid(0.08, 0.12, 0.92, 0.13, '#2d3134');
      p.solid(0.08, 0.3, 0.92, 0.305, '#2d3134');
      p.solid(0.47, 0.6, 0.49, 0.62, '#c9ccce');
      p.solid(0.51, 0.6, 0.53, 0.62, '#c9ccce');
    },
  },
};

// Roofs and plain surfaces (UVs in metres / tileW on both axes).
const SURFACE_STYLES = {
  roofFlat: {
    tileW: 8,
    draw(p) {
      p.rect(0, 0, 1, 1, '#cfcbc3');
      p.grime(0.45, 1);
      p.speckle(p.S * 25, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.15)'], p.S / 400);
      for (let i = 0; i < 5; i++) {
        const x = p.rng();
        const y = p.rng();
        const r = 0.05 + p.rng() * 0.12;
        const g = p.c.createRadialGradient(x * p.S, y * p.S, 0, x * p.S, y * p.S, r * p.S);
        g.addColorStop(0, 'rgba(70,65,60,0.35)');
        g.addColorStop(1, 'rgba(70,65,60,0)');
        p.c.fillStyle = g;
        p.c.fillRect(0, 0, p.S, p.S);
      }
      for (let k = 0; k <= 4; k++) {
        p.rect(k / 4, 0, k / 4 + 0.004, 1, 'rgba(0,0,0,0.12)');
        p.rect(0, k / 4, 1, k / 4 + 0.004, 'rgba(0,0,0,0.12)');
      }
      p.rect(0.3, 0.55, 0.45, 0.7, 'rgba(40,40,40,0.14)');
      p.rect(0.7, 0.1, 0.78, 0.35, 'rgba(40,40,40,0.1)');
    },
  },
  corrugated: {
    tileW: 3,
    draw(p) {
      p.rect(0, 0, 1, 1, '#d8d9d7');
      const n = 40;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        p.hgrad(x, 0, x + 1 / n, 1, 'rgba(255,255,255,0.35)', 'rgba(0,0,0,0.22)');
      }
      p.grime(0.3, 1);
      p.streaks(0, 1, 16, 'rgba(140,70,30,1)', 0.18);
      p.rect(0, 0.497, 1, 0.503, 'rgba(0,0,0,0.15)');
    },
  },
  tiles: {
    tileW: 3,
    draw(p) {
      p.rect(0, 0, 1, 1, '#d6d0ca');
      const rows = 10;
      const cols = 12;
      for (let r = 0; r < rows; r++) {
        const y = r / rows;
        p.vgrad(0, y, 1, y + 1 / rows, 'rgba(255,255,255,0.25)', 'rgba(0,0,0,0.28)');
        const off = (r % 2) * 0.5;
        for (let c = 0; c <= cols; c++) {
          const x = (c + off) / cols;
          p.rect(x, y, x + 0.004, y + 1 / rows, 'rgba(0,0,0,0.2)');
          p.rect(x + 0.004, y, x + 0.03, y + 1 / rows, `rgba(${p.rng() < 0.5 ? '0,0,0' : '255,255,255'},${0.05 + p.rng() * 0.08})`);
        }
      }
      p.grime(0.3, 1);
    },
  },
  concrete: {
    tileW: 4,
    draw(p) {
      p.rect(0, 0, 1, 1, '#dcd9d2');
      p.grime(0.3, 1);
      p.speckle(p.S * 8, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.1)'], p.S / 300);
    },
  },
  metal: {
    tileW: 2,
    draw(p) {
      p.rect(0, 0, 1, 1, '#d4d6d7');
      for (let y = 0; y < 1; y += 0.01) p.rect(0, y, 1, y + 0.003, `rgba(0,0,0,${0.02 + p.rng() * 0.04})`);
      p.rect(0, 0.495, 1, 0.505, 'rgba(0,0,0,0.12)');
      p.grime(0.18, 1);
    },
  },
  tank: {
    tileW: 2,
    draw(p) {
      p.rect(0, 0, 1, 1, '#e2e2e0');
      for (let y = 0; y < 1; y += 0.125) {
        p.vgrad(0, y, 1, y + 0.125, 'rgba(255,255,255,0.25)', 'rgba(0,0,0,0.2)');
      }
      p.grime(0.15, 1);
    },
  },
  water: {
    tileW: 4,
    draw(p) {
      p.glass(0, 0, 1, 1, '#5d8f95', '#2f5a60');
      for (let i = 0; i < 26; i++) {
        const y = p.rng();
        const x = p.rng();
        p.rect(x, y, x + 0.1 + p.rng() * 0.25, y + 0.006, 'rgba(255,255,255,0.18)');
      }
    },
  },
  solar: {
    tileW: 1,
    draw(p) {
      p.rect(0, 0, 1, 1, '#b7bcbf');
      p.glass(0.03, 0.03, 0.97, 0.97, '#34507a', '#1d2f4d');
      for (let i = 1; i < 6; i++) p.solid(0.03 + (0.94 * i) / 6 - 0.003, 0.03, 0.03 + (0.94 * i) / 6 + 0.003, 0.97, '#9aa6b2');
      for (let i = 1; i < 10; i++) p.solid(0.03, 0.03 + (0.94 * i) / 10 - 0.002, 0.97, 0.03 + (0.94 * i) / 10 + 0.002, '#9aa6b2');
    },
  },
};

// Small non-repeating details on one layer, addressed by cell (4 x 4 grid) sub-rects.
export const MISC_CELLS = { ac: 0, door: 1, clock: 2, louvre: 3, dish: 4, flame: 5, vent: 6, stone: 7, lamp: 8 };

function drawMisc(p) {
  const cell = (i, fn) => {
    const cx = (i % 4) / 4;
    const cy = Math.floor(i / 4) / 4;
    const sub = {
      rect: (x0, y0, x1, y1, f) => p.rect(cx + x0 / 4, cy + y0 / 4, cx + x1 / 4, cy + y1 / 4, f),
      solid: (x0, y0, x1, y1, f) => p.solid(cx + x0 / 4, cy + y0 / 4, cx + x1 / 4, cy + y1 / 4, f),
      glass: (x0, y0, x1, y1, a, b) => p.glass(cx + x0 / 4, cy + y0 / 4, cx + x1 / 4, cy + y1 / 4, a, b),
      circle: (x, y, r, f) => {
        p.c.fillStyle = f;
        p.c.beginPath();
        p.c.arc((cx + x / 4) * p.S, (cy + y / 4) * p.S, (r / 4) * p.S, 0, Math.PI * 2);
        p.c.fill();
      },
      line: (x0, y0, x1, y1, s, w) => p.line(cx + x0 / 4, cy + y0 / 4, cx + x1 / 4, cy + y1 / 4, s, w / 4),
    };
    fn(sub);
  };
  p.rect(0, 0, 1, 1, '#d8d8d6');
  cell(MISC_CELLS.ac, (s) => {
    s.rect(0, 0, 1, 1, '#e3e3e0');
    s.circle(0.5, 0.5, 0.4, '#3a3d40');
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      s.line(0.5, 0.5, 0.5 + Math.cos(a) * 0.36, 0.5 + Math.sin(a) * 0.36, '#6a6e72', 0.04);
    }
    s.circle(0.5, 0.5, 0.08, '#9a9ea2');
  });
  cell(MISC_CELLS.door, (s) => {
    s.rect(0, 0, 1, 1, '#dedbd4');
    s.solid(0.2, 0.1, 0.8, 1, '#7a7f82');
    s.solid(0.25, 0.15, 0.75, 0.45, '#6a6f72');
    s.solid(0.66, 0.55, 0.72, 0.6, '#c9ccce');
  });
  cell(MISC_CELLS.clock, (s) => {
    s.rect(0, 0, 1, 1, '#e9dfc4');
    s.circle(0.5, 0.5, 0.46, '#6d5a3a');
    s.circle(0.5, 0.5, 0.42, '#f6f1e2');
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      s.line(0.5 + Math.cos(a) * 0.33, 0.5 + Math.sin(a) * 0.33, 0.5 + Math.cos(a) * 0.4, 0.5 + Math.sin(a) * 0.4, '#2a2a2a', 0.03);
    }
    s.line(0.5, 0.5, 0.5, 0.22, '#1d1d1d', 0.035);
    s.line(0.5, 0.5, 0.68, 0.56, '#1d1d1d', 0.045);
  });
  cell(MISC_CELLS.louvre, (s) => {
    s.rect(0, 0, 1, 1, '#9da2a5');
    for (let y = 0.05; y < 1; y += 0.1) s.rect(0.05, y, 0.95, y + 0.05, '#5d6265');
  });
  cell(MISC_CELLS.dish, (s) => {
    s.rect(0, 0, 1, 1, '#eceeee');
    s.circle(0.5, 0.5, 0.45, '#f4f5f5');
    s.circle(0.5, 0.5, 0.3, '#e2e4e4');
    s.circle(0.5, 0.5, 0.08, '#8a8f93');
  });
  cell(MISC_CELLS.flame, (s) => {
    s.rect(0, 0, 1, 1, '#ffb030');
    s.circle(0.5, 0.65, 0.35, '#ffd060');
    s.circle(0.5, 0.75, 0.2, '#fff2b0');
  });
  cell(MISC_CELLS.vent, (s) => {
    s.rect(0, 0, 1, 1, '#b8bcbe');
    for (let x = 0.08; x < 1; x += 0.12) s.rect(x, 0.1, x + 0.05, 0.9, '#6b7073');
  });
  cell(MISC_CELLS.stone, (s) => {
    s.rect(0, 0, 1, 1, '#b9b2a6');
    for (let i = 0; i < 400; i++) {
      const x = p.rng();
      const y = p.rng();
      s.rect(x, y, x + 0.02, y + 0.02, p.rng() < 0.5 ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)');
    }
  });
  cell(MISC_CELLS.lamp, (s) => {
    s.rect(0, 0, 1, 1, '#fff6e0');
  });
}

// Sub-rect UV (u0, v0, u1, v1) for a misc cell, inset to avoid bleeding.
export function miscUV(cellIndex, inset = 0.02) {
  const cx = (cellIndex % 4) / 4;
  const cy = Math.floor(cellIndex / 4) / 4;
  // Canvas rows are flipped on upload: canvas y -> v = 1 - y.
  return [cx + inset / 4, 1 - (cy + 0.25) + inset / 4, cx + 0.25 - inset / 4, 1 - cy - inset / 4];
}

// Registers every static layer on the atlas; returns {name: layerIndex} + tile widths.
export function paintFacadeLayers(atlas) {
  const tileW = {};
  let seed = 11;
  const addAll = (table) => {
    for (const [name, style] of Object.entries(table)) {
      atlas.add(name, (c, m, S) => style.draw(new Painter(c, m, S, seed++)));
      tileW[name] = style.tileW;
    }
  };
  addAll(FACADE_STYLES);
  addAll(GROUND_STYLES);
  addAll(SURFACE_STYLES);
  atlas.add('misc', (c, m, S) => drawMisc(new Painter(c, m, S, 99)));
  return tileW;
}

// Glass tint presets (linear multipliers) indexed by facade byte 3.
export const GLASS_PRESETS = [
  [1.0, 1.0, 1.0], // neutral grey
  [0.72, 0.95, 1.3], // blue
  [0.72, 1.12, 1.0], // green
  [1.25, 0.95, 0.7], // bronze
  [0.5, 0.56, 0.62], // dark
  [3.4, 2.2, 0.45], // gold (Rainbow Towers)
  [0.62, 1.1, 1.2], // teal
  [1.25, 1.25, 1.28], // pale
];

export function glassPresetFor(hex) {
  if (!hex) return 0;
  const v = parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const max = Math.max(r, g, b);
  if (r > 150 && g > 110 && b < 90) return 5;
  if (max < 60) return 4;
  if (r > b + 12 && r >= g) return 3;
  if (g > r + 20 && b > r + 20) return 6;
  if (g > r + 15 && g >= b) return 2;
  if (b > r + 15) return 1;
  return 0;
}
