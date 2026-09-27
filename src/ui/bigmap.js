import { MAP_COLORS, MAJOR_ROADS } from './mapPainter.js';
import { drawPlaceIcon, drawPlayerArrow, drawRankIcon, drawWaypointPin, haloText } from './mapIcons.js';
import { clamp, el, fitCanvas, fmtDistance, setText } from './dom.js';
import { ICONS } from './icons.js';

const DEG = Math.PI / 180;
const MIN_ZOOM = 0.18; // CSS px per metre
const MAX_ZOOM = 4;
// Street names appear once the map is zoomed in at least this far (CSS px per metre).
const LABEL_ZOOM = { trunk: 0.3, primary: 0.3, secondary: 0.45, tertiary: 0.6, residential: 1.1, unclassified: 1.1, living_street: 1.6 };
const HINTS = {
  keyboard: 'Click to set a waypoint · drag or WASD to pan · scroll to zoom',
  touch: 'Tap to set a waypoint · drag to pan · pinch to zoom',
  gamepad: 'Ⓐ set waypoint · left stick pan · RT / LT zoom · Ⓑ close',
};
const ROAD_RANK = { trunk: 6, primary: 5, secondary: 4, tertiary: 3, residential: 2, unclassified: 1, living_street: 0 };

// Full-screen north-up map: pan (drag / stick / WASD), zoom (wheel / pinch / triggers / buttons),
// tap or click to drop a waypoint (tap it again to clear). Pauses the game while open (HUD-driven).
export class BigMap {
  constructor(hud, painter, baseImages) {
    this.hud = hud;
    this.painter = painter;
    this.places = hud.places;
    this.images = baseImages; // pre-rendered levels from the minimap, finest first
    this.open = false;
    this.zoom = 0.8;
    this.cx = 0;
    this.cz = 0;
    this.dirty = true;
    this.pointers = new Map();
    this._labelWidths = new Map();
    this.streets = buildStreetCandidates(hud.game.data.roads);
    this._build();
  }

  _build() {
    const iconBtn = (icon, label, onclick, cls = '') =>
      el('button', `icon-btn ${cls}`, { type: 'button', 'aria-label': label, title: label, html: ICONS[icon], onclick });
    this.canvas = el('canvas', 'bigmap-canvas');
    this.street = el('div', 'bigmap-street');
    this.wpText = el('span', 'wp-text');
    this.wpBar = el('div', 'bigmap-waypoint panel', null, [
      el('span', 'wp-icon', { html: ICONS.pin }),
      this.wpText,
      el('button', 'chip-btn', { type: 'button', text: 'Clear', onclick: () => this.hud.clearWaypoint() }),
    ]);
    this.hint = el('div', 'bigmap-hint');
    this.crosshair = el('div', 'bigmap-crosshair');
    this.root = el('div', 'overlay bigmap', { role: 'dialog', 'aria-label': 'Map of Harare CBD', 'aria-hidden': 'true' }, [
      this.canvas,
      this.crosshair,
      el('div', 'bigmap-top', null, [
        el('div', 'bigmap-title panel', null, [el('div', 'eyebrow', { text: 'Map' }), el('h2', null, { text: 'Harare CBD' }), this.street]),
        this.wpBar,
        iconBtn('close', 'Close map (M)', () => this.hud.closeOverlay(), 'close-btn'),
      ]),
      el('div', 'bigmap-bottom', null, [
        el('div', 'bigmap-legend panel', null, [
          legendItem('legend-you', 'You'),
          legendItem('legend-landmark', 'Landmark'),
          legendItem('legend-park', 'Park'),
          legendItem('legend-rank', 'Kombi rank'),
          legendItem('legend-wp', 'Waypoint'),
        ]),
        this.hint,
        el('div', 'bigmap-zoom', null, [
          iconBtn('plus', 'Zoom in', () => this._zoomBy(1.5)),
          iconBtn('minus', 'Zoom out', () => this._zoomBy(1 / 1.5)),
          iconBtn('locate', 'Centre on me', () => this._centreOnPlayer()),
        ]),
      ]),
      el('div', 'bigmap-credit', { text: '© Overture Maps Foundation · OpenStreetMap contributors' }),
    ]);
    this.hud.root.append(this.root);
    this.ctx = this.canvas.getContext('2d');

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e));
    c.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this._zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0016)), e.offsetX, e.offsetY);
      },
      { passive: false },
    );
    this._onKey = (e) => {
      if (e.key === '+' || e.key === '=') this._zoomBy(1.4);
      else if (e.key === '-' || e.key === '_') this._zoomBy(1 / 1.4);
    };
  }

  show() {
    const p = this.hud.game.player;
    this.open = true;
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    this.resize();
    this.cx = p?.position.x ?? 0;
    this.cz = p?.position.z ?? 0;
    this.zoom = clamp(this.zoom, 0.5, 1.4);
    setText(this.street, this.hud.locationText());
    this.syncWaypoint();
    this.dirty = true;
    window.addEventListener('keydown', this._onKey);
  }

  hide() {
    this.open = false;
    this.pointers.clear();
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
    window.removeEventListener('keydown', this._onKey);
  }

  resize() {
    if (!this.open) return;
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.dpr = fitCanvas(this.canvas, this.w, this.h, 2);
    this._chrome = null;
    this.dirty = true;
  }

  syncWaypoint() {
    const wp = this.hud.waypoint;
    this.wpBar.classList.toggle('hidden', !wp);
    if (wp) {
      const p = this.hud.game.player.position;
      setText(this.wpText, `${wp.label} · ${fmtDistance(Math.hypot(wp.x - p.x, wp.z - p.z))}`);
    }
    this._chrome = null;
    this.dirty = true;
  }

  // Called every frame while open (the game is paused): stick / keys pan, triggers zoom, A drops a pin.
  update(dt, input, mode) {
    if (this.root.dataset.mode !== mode) {
      this.root.dataset.mode = mode;
      this.hint.textContent = HINTS[mode];
      this._chrome = null;
      this.dirty = true;
    }
    const mx = input.move.x;
    const my = input.move.y;
    if (mx || my) {
      const speed = 650 / this.zoom;
      this.cx += mx * speed * dt;
      this.cz -= my * speed * dt;
      this._clampCentre();
      this.dirty = true;
    }
    if (input.down('swing')) this._zoomBy(Math.exp(dt * 1.6));
    if (input.down('zip')) this._zoomBy(Math.exp(-dt * 1.6));
    if (mode === 'gamepad' && input.pressed('jump')) this._toggleWaypointAt(this.w / 2, this.h / 2);
    if (this.dirty) this._draw();
  }

  _centreOnPlayer() {
    const p = this.hud.game.player.position;
    this.cx = p.x;
    this.cz = p.z;
    this.dirty = true;
  }

  _zoomBy(f) {
    this._zoomAt(f, this.w / 2, this.h / 2);
  }

  _zoomAt(f, sx, sy) {
    const z = clamp(this.zoom * f, MIN_ZOOM, MAX_ZOOM);
    const wx = this.cx + (sx - this.w / 2) / this.zoom;
    const wz = this.cz + (sy - this.h / 2) / this.zoom;
    this.zoom = z;
    this.cx = wx - (sx - this.w / 2) / z;
    this.cz = wz - (sy - this.h / 2) / z;
    this._clampCentre();
    this.dirty = true;
  }

  _clampCentre() {
    const b = this.painter.bounds;
    this.cx = clamp(this.cx, b.minX, b.maxX);
    this.cz = clamp(this.cz, b.minZ, b.maxZ);
  }

  _toWorld(sx, sy) {
    return { x: this.cx + (sx - this.w / 2) / this.zoom, z: this.cz + (sy - this.h / 2) / this.zoom };
  }

  _toScreen(x, z) {
    return [(x - this.cx) * this.zoom + this.w / 2, (z - this.cz) * this.zoom + this.h / 2];
  }

  _toggleWaypointAt(sx, sy) {
    const wp = this.hud.waypoint;
    if (wp) {
      const [x, y] = this._toScreen(wp.x, wp.z);
      if (Math.hypot(x - sx, y - (sy + 14)) < 26) {
        this.hud.clearWaypoint();
        return;
      }
    }
    const w = this._toWorld(sx, sy);
    this.hud.setWaypoint(w.x, w.z);
  }

  _down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY, t: performance.now() });
    this._pinch = null;
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const nx = e.offsetX;
    const ny = e.offsetY;
    if (this.pointers.size === 1) {
      this.cx -= (nx - p.x) / this.zoom;
      this.cz -= (ny - p.y) / this.zoom;
      this._clampCentre();
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      p.x = nx;
      p.y = ny;
      const after = Math.hypot(a.x - b.x, a.y - b.y);
      if (before > 10) this._zoomAt(after / before, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this._pinch = true;
    }
    p.x = nx;
    p.y = ny;
    this.dirty = true;
  }

  _up(e) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p || this._pinch) {
      if (!this.pointers.size) this._pinch = null;
      return;
    }
    const moved = Math.hypot(e.offsetX - p.sx, e.offsetY - p.sy);
    if (moved < 8 && performance.now() - p.t < 600) this._toggleWaypointAt(e.offsetX, e.offsetY);
  }

  _draw() {
    this.dirty = false;
    const { ctx, w, h, dpr } = this;
    const s = this.zoom * dpr; // device px per metre
    const tx = (w * dpr) / 2 - this.cx * s;
    const ty = (h * dpr) / 2 - this.cz * s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = MAP_COLORS.outside;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Zoomed out: the pre-rendered image is sharp enough and much cheaper. Zoomed in: vector tiles.
    const fine = this.images[0];
    if (s <= fine.scale * 1.15) {
      const img = this.images.find((im, i) => i === this.images.length - 1 || this.images[i + 1].scale < s * 0.95);
      const k = s / img.scale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.setTransform(k, 0, 0, k, tx + img.x0 * s, ty + img.z0 * s);
      ctx.drawImage(img.canvas, 0, 0);
    } else {
      ctx.setTransform(s, 0, 0, s, tx, ty);
      ctx.fillStyle = MAP_COLORS.ground;
      ctx.fillRect(fine.x0, fine.z0, fine.canvas.width / fine.scale, fine.canvas.height / fine.scale);
      const tl = this._toWorld(0, 0);
      const br = this._toWorld(w, h);
      this.painter.paint(ctx, s, { minX: tl.x, maxX: br.x, minZ: tl.z, maxZ: br.z });
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._drawOverlays(ctx);
  }

  // Screen rectangles covered by the map's own buttons and panels; labels avoid them.
  _chromeRects() {
    if (!this._chrome) {
      const c = this.canvas.getBoundingClientRect();
      this._chrome = [...this.root.querySelectorAll('.bigmap-top > *, .bigmap-bottom > *')]
        .map((n) => n.getBoundingClientRect())
        .filter((r) => r.width && r.height)
        .map((r) => [r.left - c.left - 4, r.top - c.top - 4, r.right - c.left + 4, r.bottom - c.top + 4]);
    }
    return this._chrome;
  }

  _drawOverlays(ctx) {
    const placed = [...this._chromeRects()];
    const fits = (x0, y0, x1, y1) => {
      if (x0 < 4 || y0 < 4 || x1 > this.w - 4 || y1 > this.h - 4) return false;
      for (const r of placed) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return false;
      placed.push([x0, y0, x1, y1]);
      return true;
    };
    const game = this.hud.game;
    const player = game.player;
    const [px, py] = this._toScreen(player.position.x, player.position.z);
    placed.push([px - 16, py - 16, px + 16, py + 16]);
    const wp = this.hud.waypoint;
    let wpScreen = null;
    if (wp) {
      wpScreen = this._toScreen(wp.x, wp.z);
      placed.push([wpScreen[0] - 14, wpScreen[1] - 34, wpScreen[0] + 14, wpScreen[1]]);
    }

    // Icons first (always drawn, and reserved so no label covers them), then labels where they fit.
    const inView = (x, y) => x > -20 && y > -20 && x < this.w + 20 && y < this.h + 20;
    const marks = [];
    for (const p of this.places.list) {
      if (p.distant) continue;
      const [x, y] = this._toScreen(p.x, p.z);
      if (!inView(x, y)) continue;
      drawPlaceIcon(ctx, x, y, 6, p.kind);
      placed.push([x - 7, y - 7, x + 7, y + 7]);
      marks.push([x, y, p.name, 13, 10]);
    }
    for (const q of this.places.ranks) {
      const [x, y] = this._toScreen(q.x, q.z);
      if (!inView(x, y)) continue;
      drawRankIcon(ctx, x, y, 8);
      placed.push([x - 9, y - 9, x + 9, y + 9]);
      if (this.zoom >= 0.45) marks.push([x, y, q.label, 12, 12]);
    }
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const [x, y, text, size, gap] of marks) {
      ctx.font = `${size === 13 ? 700 : 600} ${size}px system-ui, sans-serif`;
      const tw = this._measure(ctx, text, size);
      if (fits(x + gap - 2, y - 9, x + gap + tw + 2, y + 9)) haloText(ctx, text, x + gap, y, 4);
    }
    this._drawStreetLabels(ctx, fits);

    if (wpScreen) {
      drawWaypointPin(ctx, wpScreen[0], wpScreen[1], 13);
    }
    ctx.beginPath();
    ctx.arc(px, py, 15, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fill();
    drawPlayerArrow(ctx, px, py, -(player.heading || 0), 10);
  }

  _drawStreetLabels(ctx, fits) {
    const zoom = this.zoom;
    for (const st of this.streets) {
      if (zoom < (LABEL_ZOOM[st.cls] ?? 99)) continue;
      const major = MAJOR_ROADS.has(st.cls);
      const size = major ? 12.5 : 11.5;
      ctx.font = `${major ? 700 : 600} ${size}px system-ui, sans-serif`;
      const tw = this._measure(ctx, st.name, size);
      const shown = [];
      for (const seg of st.segs) {
        if (shown.length >= 3) break;
        if (seg.len * zoom < tw + 24) break; // sorted longest first
        const [ax, ay] = this._toScreen(seg.ax, seg.az);
        const [bx, by] = this._toScreen(seg.bx, seg.bz);
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        if (shown.some(([x, y]) => Math.hypot(x - mx, y - my) < 320)) continue;
        let ang = Math.atan2(by - ay, bx - ax);
        if (ang > Math.PI / 2) ang -= Math.PI;
        else if (ang < -Math.PI / 2) ang += Math.PI;
        const hw = (Math.abs(Math.cos(ang)) * (tw + 8) + Math.abs(Math.sin(ang)) * 16) / 2;
        const hh = (Math.abs(Math.sin(ang)) * (tw + 8) + Math.abs(Math.cos(ang)) * 16) / 2;
        if (!fits(mx - hw, my - hh, mx + hw, my + hh)) continue;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(ang);
        ctx.textAlign = 'center';
        haloText(ctx, st.name, 0, 0.5, 3.5);
        ctx.restore();
        shown.push([mx, my]);
      }
    }
    ctx.textAlign = 'left';
  }

  _measure(ctx, text, size) {
    const key = `${size}|${text}`;
    let w = this._labelWidths.get(key);
    if (w === undefined) {
      w = ctx.measureText(text).width;
      this._labelWidths.set(key, w);
    }
    return w;
  }
}

function legendItem(cls, text) {
  return el('span', 'legend-item', null, [el('i', cls), document.createTextNode(text)]);
}

// Per street name: straight runs, sorted longest first, for placing rotated labels. Polylines are split
// where they turn by more than ~12 degrees; runs of the same street that meet end to end in the same
// direction are joined (the map splits streets at every junction), so long avenues get one long run.
// Streets are sorted by importance.
function buildStreetCandidates(roads) {
  const byName = new Map();
  for (const r of roads) {
    if (!r.name || !(r.cls in LABEL_ZOOM)) continue;
    let st = byName.get(r.name);
    if (!st) {
      st = { name: r.name, cls: r.cls, total: 0, runs: [], segs: null };
      byName.set(r.name, st);
    }
    if (ROAD_RANK[r.cls] > ROAD_RANK[st.cls]) st.cls = r.cls;
    const p = r.pts;
    let start = 0;
    for (let i = 2; i < p.length; i += 2) {
      const last = i === p.length - 2;
      if (!last && turn(p[i - 2], p[i - 1], p[i], p[i + 1], p[i + 2], p[i + 3]) <= 12 * DEG) continue;
      st.runs.push([p[start], p[start + 1], p[i], p[i + 1]]);
      start = i;
    }
  }
  const list = [...byName.values()];
  for (const st of list) {
    st.segs = joinRuns(st.runs)
      .map(([ax, az, bx, bz]) => ({ ax, az, bx, bz, len: Math.hypot(bx - ax, bz - az) }))
      .filter((sg) => sg.len >= 30)
      .sort((a, b) => b.len - a.len);
    st.total = st.segs.reduce((acc, sg) => acc + sg.len, 0);
    delete st.runs;
  }
  return list.sort((a, b) => ROAD_RANK[b.cls] - ROAD_RANK[a.cls] || b.total - a.total);
}

// Angle between segment (a->b) and (b->c).
function turn(ax, az, bx, bz, cx, cz) {
  const d = Math.atan2(cz - bz, cx - bx) - Math.atan2(bz - az, bx - ax);
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
}

function joinRuns(runs) {
  const key = (x, z) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
  const out = runs.slice();
  for (let changed = true; changed; ) {
    changed = false;
    const starts = new Map();
    out.forEach((r, i) => {
      starts.set(key(r[0], r[1]), [...(starts.get(key(r[0], r[1])) || []), [i, false]]);
      starts.set(key(r[2], r[3]), [...(starts.get(key(r[2], r[3])) || []), [i, true]]);
    });
    for (let i = 0; i < out.length && !changed; i++) {
      const a = out[i];
      for (const [j, reversed] of starts.get(key(a[2], a[3])) || []) {
        if (j === i) continue;
        const b = reversed ? [out[j][2], out[j][3], out[j][0], out[j][1]] : out[j];
        if (turn(a[0], a[1], a[2], a[3], b[2], b[3]) > 6 * DEG) continue;
        out[i] = [a[0], a[1], b[2], b[3]];
        out.splice(j, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}
