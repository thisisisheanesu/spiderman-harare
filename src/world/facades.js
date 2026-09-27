import { Painter } from './atlas.js';

// Facade looks for the city's facade material (materials.js).
//
// Everyday walls are ANALYTIC styles: the shader lays out bays and floors from the wall UVs
// (u = bays along the wall, v = floors: the builder sets v = height / floorHeight), cuts recessed
// window openings with parallax reveals, frames, mullions and sills, and fills the glass with
// interior-mapped rooms (public/textures/glass). Wall, accent and roof surfaces are the CC0 PBR
// materials of public/textures, tinted per building. Only artwork that cannot be described by a few
// rectangles (Eastgate's precast teeth, the Meikles arches, the RBZ frieze, cathedral ashlar,
// water tanks, solar panels, the misc cells) and the signs stay painted on canvas layers of the
// facade texture array.
//
// Facade layer byte (GeoBuffer.brush layer):
//   0..127    canvas layer (LayerAtlas index)
//   128..191  analytic style (128 + STYLE_IDS[name])
//   192..255  plain PBR surface (192 + index into VIRTUAL): the name other modules already use
//             (L.concrete, L.metal, L.corrugated...) now means "this PBR material, tinted"

const FRAME = '#50565a';

// Analytic facade styles. Rects are fractions of the bay (x) and floor (y, from the floor up).
//   win      opening [x0, y0, x1, y1] (pair: in half-bay fractions; ribbon: x beyond 0..1)
//   reveal   depth of the glass behind the wall face (m); frame: frame bar width (m)
//   mull     vertical glazing bars per opening (ribbon: bars per bay); transom: bar height as a
//            fraction of the opening from its top (0 = none)
//   sill     sill height (m) under the opening; room: bays per room behind; depth: room depth / width
//   wall/accent: default PBR materials when the builder does not choose them
export const STYLES = {
  bands: { tileW: 3.0, win: [-0.5, 0.24, 1.5, 0.66], reveal: 0.1, frame: 0.05, mull: 2, ribbon: 1, transom: 0.28, sill: 0.08, room: 1, depth: 1.6, wall: 'concrete_painted', accent: 'concrete_raw' },
  punched: { tileW: 3.2, win: [0.22, 0.3, 0.78, 0.83], reveal: 0.15, frame: 0.05, mull: 1, transom: 0.3, sill: 0.07, room: 1, depth: 1.5, wall: 'plaster_smooth', accent: 'concrete_painted' },
  pair: { tileW: 3.6, win: [0.2, 0.26, 0.84, 0.87], reveal: 0.13, frame: 0.05, mull: 0, transom: 0.25, sill: 0.07, pair: 1, room: 1, depth: 1.4, wall: 'plaster_smooth', accent: 'concrete_painted' },
  brick: { tileW: 3.0, win: [0.27, 0.32, 0.73, 0.81], reveal: 0.12, frame: 0.045, mull: 1, transom: 0.35, sill: 0.08, surround: 0.07, room: 1, depth: 1.5, wall: 'brick_face_salmon', accent: 'plaster_smooth' },
  curtain: { tileW: 1.6, win: [-0.5, 0.2, 1.5, 1.02], reveal: 0.03, frame: 0.05, mull: 1, ribbon: 1, transom: 0, sill: 0, spandrel: 1, room: 2, depth: 1.3, wall: 'metal_panel', accent: 'metal_panel' },
  fins: { tileW: 1.5, win: [0.3, 0.2, 1.0, 0.9], reveal: 0.3, frame: 0.045, mull: 1, transom: 0, sill: 0, room: 2, depth: 1.6, wall: 'concrete_painted', accent: 'concrete_board_formed' },
  balcony: { tileW: 3.6, win: [0.1, 0.22, 0.6, 0.88], reveal: 0.12, frame: 0.05, mull: 1, transom: 0, sill: 0, room: 1, depth: 1.3, wall: 'plaster_smooth', accent: 'concrete_painted' },
  colonial: { tileW: 3.8, win: [0.32, 0.28, 0.68, 0.8], reveal: 0.1, frame: 0.035, mull: 1, transom: 0, sill: 0.05, surround: 0.06, room: 1, depth: 1.2, wall: 'plaster_peeling', accent: 'plaster_smooth' },
  house: { tileW: 4.5, win: [0.3, 0.36, 0.72, 0.7], reveal: 0.1, frame: 0.04, mull: 1, transom: 0.35, sill: 0.06, room: 1, depth: 1.0, wall: 'plaster_textured', accent: 'plaster_smooth' },
  industrial: { tileW: 6, win: [0.04, 0.78, 0.96, 0.92], reveal: 0.05, frame: 0.04, mull: 8, transom: 0, sill: 0, room: 1, depth: 2.0, wall: 'metal_panel', accent: 'concrete_raw' },
  blank: { tileW: 4, win: [0, 0, 0, 0], reveal: 0, frame: 0, mull: 0, transom: 0, sill: 0, room: 1, depth: 1, wall: 'concrete_painted', accent: 'concrete_raw' },
  grid: { tileW: 2.4, win: [0.13, 0.2, 0.87, 0.87], reveal: 0.34, frame: 0.045, mull: 1, transom: 0.22, sill: 0, room: 1, depth: 1.6, wall: 'concrete_painted', accent: 'concrete_raw' },
  // Street level (v = 0..1 is the whole ground floor).
  shop: { tileW: 4.5, win: [0.06, 0.12, 0.94, 0.8], reveal: 0.14, frame: 0.055, mull: 1, transom: 0, sill: 0, room: 1, depth: 1.5, wall: 'concrete_painted', accent: 'granite_dark_tiles' },
  lobby: { tileW: 5, win: [0.08, 0.04, 0.92, 0.9], reveal: 0.12, frame: 0.06, mull: 3, transom: 0.28, sill: 0, room: 1, depth: 2.0, wall: 'granite_dark_tiles', accent: 'granite_cladding_light' },
  colshop: { tileW: 4.0, win: [0.06, 0.1, 0.94, 0.86], reveal: 0.12, frame: 0.05, mull: 2, transom: 0.2, sill: 0, room: 1, depth: 1.3, wall: 'plaster_smooth', accent: 'plaster_smooth' },
};
export const STYLE_IDS = {};
Object.keys(STYLES).forEach((k, i) => (STYLE_IDS[k] = i));
export const STYLE_BASE = 128;
export const VIRTUAL_BASE = 192;

// Plain PBR surfaces addressed through the old layer names. uvScale: metres per uv unit the
// callers already use (the old canvas tile width); color: the old painted layer's base colour, so
// tints chosen for it keep their brightness (non-tintable brick keeps its own colour); metal:
// metalness override (-1 = the texture's).
export const VIRTUAL = {
  concrete: { mat: 'concrete_painted', uvScale: 4, color: '#dcd9d2', metal: -1 },
  metal: { mat: 'window_frame_aluminium', uvScale: 2, color: '#c9cbcc', metal: 0.25 },
  corrugated: { mat: 'corrugated_weathered', uvScale: 3, color: '#cfd0ce', metal: 0.3 },
  tiles: { mat: 'clay_tile_roof', uvScale: 3, color: '#c9b9ab', metal: -1 },
  roofFlat: { mat: 'roof_gravel', uvScale: 8, color: '#c2beb6', metal: -1 },
  brick: { mat: 'brick_face_salmon', uvScale: 3, color: null, metal: -1 },
  granite: { mat: 'granite_cladding_light', uvScale: 2.4, color: null, metal: -1 },
  plaster: { mat: 'plaster_smooth', uvScale: 1.5, color: null, metal: -1 },
  shutterSteel: { mat: 'shutter_rolldown', uvScale: 2, color: null, metal: -1 },
  membrane: { mat: 'roof_membrane', uvScale: 1, color: null, metal: -1 },
};
export const VIRTUAL_IDS = {};
Object.keys(VIRTUAL).forEach((k, i) => (VIRTUAL_IDS[k] = i));

// Frame colours (GeoBuffer.surface flags bits 2-3).
export const FRAME_COLORS = [FRAME, '#a3a8ab', '#e6e4de', '#2b2d2f'];

// Canvas-painted facade artwork (landmarks). Every wall layer is one "bay" wide (tileW metres)
// and one floor high.
const PAINTED_STYLES = {
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

// Surfaces that stay painted (UVs in metres / tileW).
const SURFACE_STYLES = {
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

// Registers the canvas layers on the atlas and the analytic / virtual layer indices in its index
// (so L.bands, L.metal... work for every caller). Returns {name: tile width in metres}.
export function paintFacadeLayers(atlas) {
  const tileW = {};
  let seed = 11;
  const addAll = (table) => {
    for (const [name, style] of Object.entries(table)) {
      atlas.add(name, (c, m, S) => style.draw(new Painter(c, m, S, seed++)));
      tileW[name] = style.tileW;
    }
  };
  addAll(PAINTED_STYLES);
  addAll(SURFACE_STYLES);
  atlas.add('misc', (c, m, S) => drawMisc(new Painter(c, m, S, 99)));
  for (const [name, st] of Object.entries(STYLES)) {
    atlas.index[name] = STYLE_BASE + STYLE_IDS[name];
    tileW[name] = st.tileW;
  }
  for (const [name, v] of Object.entries(VIRTUAL)) {
    atlas.index[name] = VIRTUAL_BASE + VIRTUAL_IDS[name];
    tileW[name] = v.uvScale;
  }
  return tileW;
}

// Glass presets indexed by facade byte 3: [tint of what is seen through the glass (linear), F0
// (reflectance at normal incidence; coated curtain glass is far more mirror-like than clear glass)].
export const GLASS_PRESETS = [
  [[0.8, 0.84, 0.84], 0.05], // clear / neutral grey
  [[0.5, 0.66, 0.9], 0.16], // blue reflective
  [[0.56, 0.8, 0.7], 0.14], // green
  [[0.85, 0.68, 0.5], 0.16], // bronze
  [[0.38, 0.42, 0.46], 0.12], // dark
  [[0.95, 0.72, 0.32], 0.42], // gold (Rainbow Towers)
  [[0.42, 0.68, 0.7], 0.18], // teal (RBZ)
  [[0.9, 0.92, 0.93], 0.06], // pale
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
