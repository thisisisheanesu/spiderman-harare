// Polyline helpers on flat [x0, z0, x1, z1, ...] arrays.

// Per-vertex left-hand unit normals (left of the a->b direction, x = east, z = south) with
// mitre scale so offset lines keep a constant width through bends (clamped at sharp turns).
export function polylineNormals(pts) {
  const n = pts.length / 2;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = Math.max(0, i - 1);
    const q = Math.min(n - 1, i + 1);
    let d0x = pts[i * 2] - pts[p * 2];
    let d0z = pts[i * 2 + 1] - pts[p * 2 + 1];
    let d1x = pts[q * 2] - pts[i * 2];
    let d1z = pts[q * 2 + 1] - pts[i * 2 + 1];
    const l0 = Math.hypot(d0x, d0z);
    const l1 = Math.hypot(d1x, d1z);
    if (l0 > 1e-6) {
      d0x /= l0;
      d0z /= l0;
    } else {
      d0x = d1x / (l1 || 1);
      d0z = d1z / (l1 || 1);
    }
    if (l1 > 1e-6) {
      d1x /= l1;
      d1z /= l1;
    } else {
      d1x = d0x;
      d1z = d0z;
    }
    // Left of travel: (dz, -dx).
    const n0x = d0z;
    const n0z = -d0x;
    const n1x = d1z;
    const n1z = -d1x;
    let mx = n0x + n1x;
    let mz = n0z + n1z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const cos = mx * n1x + mz * n1z;
    out[i * 3] = mx;
    out[i * 3 + 1] = mz;
    out[i * 3 + 2] = Math.min(2.5, 1 / Math.max(cos, 0.4));
  }
  return out;
}

// Cumulative arc lengths.
export function arcLengths(pts) {
  const n = pts.length / 2;
  const out = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    out[i] = out[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  }
  return out;
}

// Samples position + unit direction at arc length s. Writes into `out` {x, z, dx, dz, i}.
export function sampleAt(pts, lens, s, out) {
  const n = pts.length / 2;
  let i = 0;
  while (i < n - 2 && lens[i + 1] < s) i++;
  const seg = lens[i + 1] - lens[i] || 1;
  const t = Math.max(0, Math.min(1, (s - lens[i]) / seg));
  const ax = pts[i * 2];
  const az = pts[i * 2 + 1];
  const bx = pts[i * 2 + 2];
  const bz = pts[i * 2 + 3];
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  out.dx = (bx - ax) / seg;
  out.dz = (bz - az) / seg;
  out.i = i;
  return out;
}

// Same polyline with extra points so no segment is longer than `step` (for draping on terrain).
export function resample(pts, step) {
  const out = [pts[0], pts[1]];
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = pts[i + 2] - pts[i];
    const dz = pts[i + 3] - pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / step));
    for (let k = 1; k <= n; k++) out.push(pts[i] + (dx * k) / n, pts[i + 1] + (dz * k) / n);
  }
  return out;
}

// Sub-polyline between arc lengths s0..s1 (inclusive of interior vertices).
export function slice(pts, lens, s0, s1) {
  const out = [];
  const tmp = { x: 0, z: 0, dx: 0, dz: 0, i: 0 };
  sampleAt(pts, lens, s0, tmp);
  out.push(tmp.x, tmp.z);
  const n = pts.length / 2;
  for (let i = 1; i < n - 1; i++) {
    if (lens[i] > s0 + 1e-3 && lens[i] < s1 - 1e-3) out.push(pts[i * 2], pts[i * 2 + 1]);
  }
  sampleAt(pts, lens, s1, tmp);
  out.push(tmp.x, tmp.z);
  return out;
}

// Uniform grid of polyline segments for proximity queries.
export class SegmentGrid {
  constructor(cell = 32) {
    this.cell = cell;
    this.map = new Map();
    this.segs = [];
  }

  add(ax, az, bx, bz, ref) {
    const id = this.segs.length;
    this.segs.push({ ax, az, bx, bz, ref });
    const c = this.cell;
    for (let gx = Math.floor(Math.min(ax, bx) / c); gx <= Math.floor(Math.max(ax, bx) / c); gx++) {
      for (let gz = Math.floor(Math.min(az, bz) / c); gz <= Math.floor(Math.max(az, bz) / c); gz++) {
        const k = gx * 73856093 + gz;
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(id);
      }
    }
  }

  addPolyline(pts, ref) {
    for (let i = 0; i + 3 < pts.length; i += 2) this.add(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], ref);
  }

  // Calls fn(seg, dist) for segments within r of (x, z) (a segment may be reported twice).
  query(x, z, r, fn) {
    const c = this.cell;
    for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++) {
      for (let gz = Math.floor((z - r) / c); gz <= Math.floor((z + r) / c); gz++) {
        const arr = this.map.get(gx * 73856093 + gz);
        if (!arr) continue;
        for (const id of arr) {
          const s = this.segs[id];
          const d = distToSeg(x, z, s.ax, s.az, s.bx, s.bz);
          if (d <= r) fn(s, d);
        }
      }
    }
  }
}

function distToSeg(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}
