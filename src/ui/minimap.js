import { MAP_COLORS, halfImage } from './mapPainter.js';
import { drawPlaceIcon, drawPlayerArrow, drawRankIcon, drawWaypointPin, haloText } from './mapIcons.js';
import { clamp, el, fitCanvas, fmtDistance } from './dom.js';

const DEG = Math.PI / 180;
const MARGIN = 12; // CSS px

// Circular minimap that rotates with the camera (camera forward = up), like the reference video.
// The whole city is pre-rendered once (plus a half-size mip for zoomed-out views); each frame
// draws only the rotated window around the player, then markers on top.
export class Minimap {
  constructor(parent, painter, places, quality) {
    this.places = places;
    this.root = el('button', 'minimap', { type: 'button', 'aria-label': 'Open map', title: 'Map (M)' });
    this.canvas = el('canvas');
    this.root.append(this.canvas);
    parent.append(this.root);
    this.ctx = this.canvas.getContext('2d');
    const full = painter.renderImage(quality === 'low' ? 0.8 : 1);
    this.levels = [full, halfImage(full)];
    this.radius = 160;
    this.size = 0;
    this.dpr = 1;
    this._sig = '';
  }

  // The canvas overhangs the circle by MARGIN px on every side so the N badge can sit on the rim.
  resize() {
    this.size = this.root.clientWidth;
    this.dpr = fitCanvas(this.canvas, this.size + MARGIN * 2, this.size + MARGIN * 2);
    this._sig = '';
  }

  // heading: camera compass heading (deg, clockwise from north); facing: player facing (deg).
  draw(dt, pos, heading, facing, speed, waypoint) {
    if (!this.size) return;
    const alt = pos.y;
    const t = clamp(Math.max(speed / 45, (alt - 12) / 140), 0, 1);
    this.radius += (150 + 280 * t - this.radius) * (1 - Math.exp(-dt * 1.5));

    const sig = `${pos.x.toFixed(1)},${pos.z.toFixed(1)},${heading.toFixed(1)},${facing.toFixed(0)},${this.radius.toFixed(1)},${waypoint ? waypoint.x : ''}`;
    if (sig === this._sig) return;
    this._sig = sig;

    const ctx = this.ctx;
    const s = this.size;
    const r = s / 2;
    const R = this.radius;
    const k = (r - 2) / R; // CSS px per metre
    const th = heading * DEG;
    const cos = Math.cos(th);
    const sin = Math.sin(th);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, MARGIN * this.dpr, MARGIN * this.dpr);
    ctx.clearRect(-MARGIN, -MARGIN, s + MARGIN * 2, s + MARGIN * 2);
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = MAP_COLORS.outside;
    ctx.fillRect(0, 0, s, s);
    ctx.translate(r, r);
    ctx.rotate(-th);
    ctx.scale(k, k);
    this._blit(ctx, pos.x, pos.z, R + 4, k * this.dpr);
    ctx.restore();

    // Soft inner vignette so the rim reads against bright streets.
    const g = ctx.createRadialGradient(r, r, r * 0.62, r, r, r);
    g.addColorStop(0, 'rgba(8, 26, 56, 0)');
    g.addColorStop(1, 'rgba(8, 26, 56, 0.55)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(r, r, r - 1, 0, Math.PI * 2);
    ctx.fill();

    // World offset -> minimap pixel.
    const toScreen = (x, z) => {
      const dx = x - pos.x;
      const dz = z - pos.z;
      return [r + (dx * cos + dz * sin) * k, r + (-dx * sin + dz * cos) * k];
    };
    const inner = r - 8;
    const iconR = Math.max(4, s * 0.028);
    for (const p of this.places.list) {
      if (p.distant) continue;
      const [x, y] = toScreen(p.x, p.z);
      if (Math.hypot(x - r, y - r) < inner) drawPlaceIcon(ctx, x, y, iconR, p.kind);
    }
    for (const q of this.places.ranks) {
      const [x, y] = toScreen(q.x, q.z);
      if (Math.hypot(x - r, y - r) < inner) drawRankIcon(ctx, x, y, iconR * 1.35);
    }
    if (waypoint) this._drawWaypoint(ctx, toScreen(waypoint.x, waypoint.z), Math.hypot(waypoint.x - pos.x, waypoint.z - pos.z), r);

    drawPlayerArrow(ctx, r, r, (facing - heading) * DEG, Math.max(7, s * 0.05));

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(r, r, r - 1.5, 0, Math.PI * 2);
    ctx.stroke();

    // North badge on the rim.
    const nx = r - sin * (r - 2);
    const ny = r - cos * (r - 2);
    const nr = Math.min(MARGIN - 1, Math.max(8, s * 0.055));
    ctx.beginPath();
    ctx.arc(nx, ny, nr, 0, Math.PI * 2);
    ctx.fillStyle = MAP_COLORS.accent;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(nr * 1.15)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 0.5);
  }

  // Draw the pre-rendered map around (px, pz): half-size `half` metres, in a context already scaled to metres.
  _blit(ctx, px, pz, half, devPxPerM) {
    const img = this.levels[1].scale >= devPxPerM * 0.9 ? this.levels[1] : this.levels[0];
    const S = img.scale;
    const x0 = Math.max(px - half, img.x0);
    const z0 = Math.max(pz - half, img.z0);
    const x1 = Math.min(px + half, img.x0 + img.canvas.width / S);
    const z1 = Math.min(pz + half, img.z0 + img.canvas.height / S);
    if (x1 <= x0 || z1 <= z0) return;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img.canvas, (x0 - img.x0) * S, (z0 - img.z0) * S, (x1 - x0) * S, (z1 - z0) * S, x0 - px, z0 - pz, x1 - x0, z1 - z0);
  }

  _drawWaypoint(ctx, [x, y], dist, r) {
    const dx = x - r;
    const dy = y - r;
    const d = Math.hypot(dx, dy);
    const edge = r - 12;
    const pin = Math.max(9, this.size * 0.065);
    ctx.font = `700 ${Math.max(10, Math.round(this.size * 0.058))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (d <= edge) {
      drawWaypointPin(ctx, x, y, pin);
      haloText(ctx, fmtDistance(dist), x, y + pin * 0.55, 3);
      return;
    }
    // Off the minimap: arrow on the rim pointing at it, distance just inside.
    const ux = dx / d;
    const uy = dy / d;
    const ex = r + ux * edge;
    const ey = r + uy * edge;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.beginPath();
    ctx.moveTo(pin * 0.8, 0);
    ctx.lineTo(-pin * 0.45, -pin * 0.62);
    ctx.lineTo(-pin * 0.2, 0);
    ctx.lineTo(-pin * 0.45, pin * 0.62);
    ctx.closePath();
    ctx.fillStyle = MAP_COLORS.waypoint;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = MAP_COLORS.casing;
    ctx.stroke();
    ctx.restore();
    haloText(ctx, fmtDistance(dist), r + ux * (edge - pin * 1.9), r + uy * (edge - pin * 1.9), 3);
  }
}
