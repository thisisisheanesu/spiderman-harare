// Arc-length parametrised 2D polylines in the x/z plane, used for lanes and junction connectors.
// Points are packed as Float32Array [x0, z0, x1, z1, …].

export class Path {
  constructor(pts) {
    this.pts = pts;
    const n = pts.length / 2;
    this.cum = new Float32Array(n);
    let acc = 0;
    for (let i = 1; i < n; i++) {
      acc += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
      this.cum[i] = acc;
    }
    this.length = acc;
    // Vehicles whose front bumper is on this path, ordered front-most first.
    this.vehicles = [];
  }

  // Writes {x, z, dx, dz} (position + unit tangent) at arc length s into out. Beyond either end the
  // end segment is extrapolated so a vehicle's rear axle can hang off the start of a path.
  sample(s, out) {
    const pts = this.pts;
    const cum = this.cum;
    const last = cum.length - 1;
    let i;
    if (s <= 0) i = 0;
    else if (s >= this.length) i = last - 1;
    else {
      let lo = 0;
      let hi = last;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= s) lo = mid;
        else hi = mid;
      }
      i = lo;
    }
    const ax = pts[i * 2];
    const az = pts[i * 2 + 1];
    const segLen = cum[i + 1] - cum[i] || 1e-6;
    const dx = (pts[i * 2 + 2] - ax) / segLen;
    const dz = (pts[i * 2 + 3] - az) / segLen;
    const t = s - cum[i];
    out.x = ax + dx * t;
    out.z = az + dz * t;
    out.dx = dx;
    out.dz = dz;
    return out;
  }

  // Arc length of the point on the path closest to (x, z), plus the squared distance.
  project(x, z, out) {
    const pts = this.pts;
    let best = Infinity;
    let bestS = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i];
      const az = pts[i + 1];
      const ex = pts[i + 2] - ax;
      const ez = pts[i + 3] - az;
      const l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
      const px = ax + ex * t - x;
      const pz = az + ez * t - z;
      const d2 = px * px + pz * pz;
      if (d2 < best) {
        best = d2;
        bestS = this.cum[i >> 1] + t * Math.sqrt(l2);
      }
    }
    out.s = bestS;
    out.d2 = best;
    return out;
  }
}

// Drops consecutive points closer than eps (mapped ways sometimes repeat a vertex).
export function deduped(pts, eps = 0.05) {
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    if (Math.abs(pts[i] - out[out.length - 2]) < eps && Math.abs(pts[i + 1] - out[out.length - 1]) < eps) continue;
    out.push(pts[i], pts[i + 1]);
  }
  if (out.length < 4) out.push(pts[pts.length - 2] + eps, pts[pts.length - 1]);
  return Float32Array.from(out);
}

// Reverses a packed polyline.
export function reversed(pts) {
  const n = pts.length / 2;
  const out = new Float32Array(pts.length);
  for (let i = 0; i < n; i++) {
    out[i * 2] = pts[(n - 1 - i) * 2];
    out[i * 2 + 1] = pts[(n - 1 - i) * 2 + 1];
  }
  return out;
}

// Offsets a polyline sideways by `off` metres to the LEFT of its direction (mitred joints).
export function offsetLeft(pts, off) {
  const n = pts.length / 2;
  const out = new Float32Array(pts.length);
  for (let i = 0; i < n; i++) {
    let nx = 0;
    let nz = 0;
    let cnt = 0;
    const segNormal = (j) => {
      const ex = pts[j * 2 + 2] - pts[j * 2];
      const ez = pts[j * 2 + 3] - pts[j * 2 + 1];
      const l = Math.hypot(ex, ez);
      if (l < 1e-6) return null;
      return [ez / l, -ex / l];
    };
    const a = i > 0 ? segNormal(i - 1) : null;
    const b = i < n - 1 ? segNormal(i) : null;
    if (a) {
      nx += a[0];
      nz += a[1];
      cnt++;
    }
    if (b) {
      nx += b[0];
      nz += b[1];
      cnt++;
    }
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    let scale = 1;
    if (cnt === 2) {
      const cos = nx * a[0] + nz * a[1];
      scale = 1 / Math.max(0.6, cos);
    }
    out[i * 2] = pts[i * 2] + nx * off * scale;
    out[i * 2 + 1] = pts[i * 2 + 1] + nz * off * scale;
  }
  return out;
}

// Cuts `startTrim` metres off the start and `endTrim` metres off the end of a polyline.
export function trimmed(pts, startTrim, endTrim) {
  const n = pts.length / 2;
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  const total = cum[n - 1];
  const s0 = Math.min(startTrim, total * 0.5 - 0.05);
  const s1 = Math.max(total - endTrim, s0 + 0.1);
  const out = [];
  const at = (s) => {
    let i = 0;
    while (i < n - 2 && cum[i + 1] < s) i++;
    const seg = cum[i + 1] - cum[i] || 1e-6;
    const t = Math.max(0, Math.min(1, (s - cum[i]) / seg));
    out.push(pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * t, pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * t);
  };
  at(s0);
  for (let i = 1; i < n - 1; i++) {
    if (cum[i] > s0 + 0.05 && cum[i] < s1 - 0.05) out.push(pts[i * 2], pts[i * 2 + 1]);
  }
  at(s1);
  return Float32Array.from(out);
}

// Samples a cubic Bézier from p0 (heading d0) to p3 (arriving with heading d3) with handle length k.
export function bezier(p0x, p0z, d0x, d0z, p3x, p3z, d3x, d3z, k, segments) {
  const c1x = p0x + d0x * k;
  const c1z = p0z + d0z * k;
  const c2x = p3x - d3x * k;
  const c2z = p3z - d3z * k;
  const out = new Float32Array((segments + 1) * 2);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    const b0 = u * u * u;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    const b3 = t * t * t;
    out[i * 2] = b0 * p0x + b1 * c1x + b2 * c2x + b3 * p3x;
    out[i * 2 + 1] = b0 * p0z + b1 * c1z + b2 * c2z + b3 * p3z;
  }
  return out;
}

// Smallest distance between two polylines (segment-to-segment), with an early bbox rejection.
export function polylineDistance(a, b, limit) {
  let best = Infinity;
  for (let i = 0; i + 3 < a.length; i += 2) {
    const ax0 = a[i];
    const az0 = a[i + 1];
    const ax1 = a[i + 2];
    const az1 = a[i + 3];
    const minAX = Math.min(ax0, ax1) - limit;
    const maxAX = Math.max(ax0, ax1) + limit;
    const minAZ = Math.min(az0, az1) - limit;
    const maxAZ = Math.max(az0, az1) + limit;
    for (let j = 0; j + 3 < b.length; j += 2) {
      const bx0 = b[j];
      const bz0 = b[j + 1];
      const bx1 = b[j + 2];
      const bz1 = b[j + 3];
      if (Math.max(bx0, bx1) < minAX || Math.min(bx0, bx1) > maxAX) continue;
      if (Math.max(bz0, bz1) < minAZ || Math.min(bz0, bz1) > maxAZ) continue;
      const d = segSegDistance(ax0, az0, ax1, az1, bx0, bz0, bx1, bz1);
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  }
  return best;
}

// Arc length along `path` up to which it still passes within `limit` of the polyline `pts`.
export function closeUntil(path, pts, limit) {
  const p = path.pts;
  const l2 = limit * limit;
  let last = 0;
  for (let i = 0; i < p.length; i += 2) {
    for (let j = 0; j + 3 < pts.length; j += 2) {
      if (pointSegD2(p[i], p[i + 1], pts[j], pts[j + 1], pts[j + 2], pts[j + 3]) < l2) {
        last = path.cum[i >> 1];
        break;
      }
    }
  }
  return last;
}

function pointSegD2(px, pz, ax, az, bx, bz) {
  const ex = bx - ax;
  const ez = bz - az;
  const l2 = ex * ex + ez * ez;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / l2)) : 0;
  const dx = ax + ex * t - px;
  const dz = az + ez * t - pz;
  return dx * dx + dz * dz;
}

function segSegDistance(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.sqrt(
    Math.min(pointSegD2(ax, az, cx, cz, dx, dz), pointSegD2(bx, bz, cx, cz, dx, dz), pointSegD2(cx, cz, ax, az, bx, bz), pointSegD2(dx, dz, ax, az, bx, bz)),
  );
}
