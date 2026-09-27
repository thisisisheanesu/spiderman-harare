import { headingDeg } from '../core/geo.js';
import { MAP_COLORS } from './mapPainter.js';
import { drawPlaceIcon, drawRankIcon, drawWaypointPin } from './mapIcons.js';
import { angleDiff, el, fitCanvas, fmtDistance, setText, toggleClass } from './dom.js';

const SPAN = 150; // degrees visible across the strip
const LABELS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const PLACE_RANGE = 1800;
const DISTANT_RANGE = 12000; // landmarks beyond the map edge (e.g. Heroes' Acre)
const RANK_RANGE = 700;

// Thin compass strip (top centre): ticks + cardinal letters, landmark / kombi-rank markers and the
// active waypoint with its distance. The caption names whatever lies straight ahead.
export class Compass {
  constructor(parent, places) {
    this.places = places;
    this.root = el('div', 'compass');
    this.canvas = el('canvas');
    this.caption = el('div', 'compass-caption');
    this.root.append(this.canvas);
    parent.append(this.root, this.caption);
    this.ctx = this.canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this._sig = '';
    this.ahead = null;
  }

  resize() {
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.dpr = fitCanvas(this.canvas, this.w, this.h);
    this._sig = '';
  }

  draw(heading, pos, waypoint) {
    if (!this.w) return;
    const sig = `${heading.toFixed(1)},${Math.round(pos.x)},${Math.round(pos.z)},${waypoint ? waypoint.x : ''}`;
    if (sig === this._sig) return;
    this._sig = sig;

    const { ctx, w, h } = this;
    const ppd = w / SPAN;
    const cx = w / 2;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Ticks every 5 degrees, taller every 15, letters every 45.
    const bandH = Math.round(h * 0.52);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const first = Math.ceil((heading - SPAN / 2) / 5) * 5;
    for (let d = first; d <= heading + SPAN / 2; d += 5) {
      const x = cx + (d - heading) * ppd;
      const deg = ((d % 360) + 360) % 360;
      const label = LABELS[deg];
      if (label) {
        ctx.font = `${deg === 0 ? 800 : 700} ${deg % 90 === 0 ? 13 : 11}px system-ui, sans-serif`;
        ctx.fillStyle = deg === 0 ? '#ff5a6e' : 'rgba(255, 255, 255, 0.92)';
        ctx.fillText(label, x, bandH * 0.52);
        continue;
      }
      const major = deg % 15 === 0;
      ctx.fillStyle = major ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.28)';
      const th = major ? 7 : 4;
      ctx.fillRect(Math.round(x) - 0.5, bandH * 0.52 - th / 2, 1, th);
    }

    // Centre caret.
    ctx.fillStyle = MAP_COLORS.accent;
    ctx.beginPath();
    ctx.moveTo(cx - 5, 0);
    ctx.lineTo(cx + 5, 0);
    ctx.lineTo(cx, 6);
    ctx.closePath();
    ctx.fill();

    // Markers row.
    const my = bandH + (h - bandH) / 2;
    const r = Math.min(5, (h - bandH) * 0.3);
    let ahead = null;
    let aheadOff = 7;
    for (const p of this.places.list) {
      const dist = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (dist > (p.distant ? DISTANT_RANGE : PLACE_RANGE) || dist < 30) continue;
      const off = angleDiff(headingDeg(p.x - pos.x, p.z - pos.z), heading);
      if (Math.abs(off) > SPAN / 2 - 3) continue;
      drawPlaceIcon(ctx, cx + off * ppd, my, r, p.kind);
      if (Math.abs(off) < aheadOff) {
        aheadOff = Math.abs(off);
        ahead = { label: p.name, dist };
      }
    }
    for (const q of this.places.ranks) {
      const dist = Math.hypot(q.x - pos.x, q.z - pos.z);
      if (dist > RANK_RANGE || dist < 20) continue;
      const off = angleDiff(headingDeg(q.x - pos.x, q.z - pos.z), heading);
      if (Math.abs(off) > SPAN / 2 - 3) continue;
      drawRankIcon(ctx, cx + off * ppd, my, r * 1.3);
      if (Math.abs(off) < aheadOff) {
        aheadOff = Math.abs(off);
        ahead = { label: `${q.label} kombis`, dist };
      }
    }

    if (waypoint) {
      const dist = Math.hypot(waypoint.x - pos.x, waypoint.z - pos.z);
      const off = angleDiff(headingDeg(waypoint.x - pos.x, waypoint.z - pos.z), heading);
      const lim = SPAN * 0.4; // stay clear of the faded ends
      const x = cx + Math.max(-lim, Math.min(lim, off)) * ppd;
      drawWaypointPin(ctx, x, h - 1, Math.min(11, h * 0.26));
      if (Math.abs(off) > lim) {
        ctx.fillStyle = MAP_COLORS.waypoint;
        ctx.font = '800 12px system-ui, sans-serif';
        ctx.fillText(off < 0 ? '‹' : '›', x + (off < 0 ? 12 : -12), my);
      }
      if (Math.abs(off) < 12) ahead = { label: 'Waypoint', dist, waypoint: true };
    }

    this.ahead = ahead;
  }

  // Text is refreshed at the HUD's text rate, not every frame.
  updateCaption() {
    const a = this.ahead;
    setText(this.caption, a ? `${a.label} · ${fmtDistance(a.dist)}` : '');
    toggleClass(this.caption, 'is-waypoint', !!a?.waypoint);
    toggleClass(this.caption, 'is-empty', !a);
  }
}
