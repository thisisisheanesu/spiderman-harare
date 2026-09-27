import { MAP_COLORS } from './mapPainter.js';

// Canvas glyphs shared by the minimap and the big map. Sizes are in canvas pixels.

export function drawPlayerArrow(ctx, x, y, angle, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.74, size * 0.82);
  ctx.lineTo(0, size * 0.42);
  ctx.lineTo(-size * 0.74, size * 0.82);
  ctx.closePath();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = size * 0.5;
  ctx.fillStyle = MAP_COLORS.player;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1, size * 0.16);
  ctx.strokeStyle = MAP_COLORS.accent;
  ctx.stroke();
  ctx.restore();
}

// Kombi rank: gold roundel with a little minibus.
export function drawRankIcon(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = MAP_COLORS.rank;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.strokeStyle = MAP_COLORS.casing;
  ctx.stroke();
  const w = r * 1.2;
  const h = r * 0.72;
  ctx.fillStyle = MAP_COLORS.casing;
  ctx.fillRect(x - w / 2, y - h / 2 - r * 0.08, w, h);
  ctx.fillStyle = MAP_COLORS.rank;
  ctx.fillRect(x - w / 2 + r * 0.14, y - h / 2 + r * 0.06, w - r * 0.28, h * 0.34);
  ctx.fillStyle = MAP_COLORS.casing;
  ctx.beginPath();
  ctx.arc(x - w * 0.28, y + h / 2, r * 0.16, 0, Math.PI * 2);
  ctx.arc(x + w * 0.28, y + h / 2, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
}

// Landmark: white diamond; park: green dot; both with a dark outline.
export function drawPlaceIcon(ctx, x, y, r, kind) {
  ctx.beginPath();
  if (kind === 'park') {
    ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = '#5fd39a';
  } else {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
  }
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.3);
  ctx.strokeStyle = MAP_COLORS.casing;
  ctx.stroke();
}

// Waypoint: gold map pin whose tip sits on (x, y).
export function drawWaypointPin(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-size * 0.2, -size * 0.45, -size * 0.62, -size * 0.7, -size * 0.62, -size * 1.12);
  ctx.arc(0, -size * 1.12, size * 0.62, Math.PI, 0);
  ctx.bezierCurveTo(size * 0.62, -size * 0.7, size * 0.2, -size * 0.45, 0, 0);
  ctx.closePath();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = size * 0.4;
  ctx.fillStyle = MAP_COLORS.waypoint;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1, size * 0.12);
  ctx.strokeStyle = MAP_COLORS.casing;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -size * 1.12, size * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = MAP_COLORS.casing;
  ctx.fill();
  ctx.restore();
}

// Text with a dark halo so it reads over any map colour.
export function haloText(ctx, text, x, y, haloWidth) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = haloWidth;
  ctx.strokeStyle = MAP_COLORS.halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = MAP_COLORS.label;
  ctx.fillText(text, x, y);
}
