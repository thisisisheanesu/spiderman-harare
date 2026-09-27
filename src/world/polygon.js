// Small 2D helpers on flat [x0, z0, x1, z1, ...] rings (x = east, z = south).

// Signed area in the x/z plane. Map rings are "CCW seen from above with north up", which comes
// out negative here because z points south.
export function signedArea(r) {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return a / 2;
}

// Drops a repeated closing vertex and consecutive near-duplicate points.
export function cleanRing(r, eps = 0.05) {
  const out = [];
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const x = r[i * 2];
    const z = r[i * 2 + 1];
    const k = out.length;
    if (k && Math.abs(out[k - 2] - x) < eps && Math.abs(out[k - 1] - z) < eps) continue;
    out.push(x, z);
  }
  while (out.length >= 6 && Math.abs(out[0] - out[out.length - 2]) < eps && Math.abs(out[1] - out[out.length - 1]) < eps) {
    out.length -= 2;
  }
  return out;
}

// Unit normals per edge i (vertex i -> i+1) pointing away from the solid, whatever the ring's
// winding. `solidInside` = true for an outer ring, false for a hole (solid outside it).
export function edgeNormals(r, solidInside = true) {
  const n = r.length / 2;
  const s = (signedArea(r) < 0 ? 1 : -1) * (solidInside ? 1 : -1);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = r[j * 2] - r[i * 2];
    const dz = r[j * 2 + 1] - r[i * 2 + 1];
    const len = Math.hypot(dx, dz) || 1;
    out[i * 2] = (-dz / len) * s;
    out[i * 2 + 1] = (dx / len) * s;
  }
  return out;
}

// Offsets a ring by `d` along the given per-edge normals (negative d = inwards). Mitre joins
// clamped to 3x the offset so sharp corners do not explode.
export function offsetRing(r, normals, d) {
  const n = r.length / 2;
  const out = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n;
    const n0x = normals[p * 2];
    const n0z = normals[p * 2 + 1];
    const n1x = normals[i * 2];
    const n1z = normals[i * 2 + 1];
    let mx = n0x + n1x;
    let mz = n0z + n1z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) {
      mx = n1x;
      mz = n1z;
    } else {
      mx /= ml;
      mz /= ml;
    }
    const cos = mx * n1x + mz * n1z;
    const k = Math.min(3, 1 / Math.max(cos, 0.33));
    out[i * 2] = r[i * 2] + mx * d * k;
    out[i * 2 + 1] = r[i * 2 + 1] + mz * d * k;
  }
  return out;
}

export function pointInRing(x, z, r) {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2];
    const zi = r[i * 2 + 1];
    const xj = r[j * 2];
    const zj = r[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

// Distance from (x, z) to the ring outline.
export function distToRing(x, z, r) {
  let best = Infinity;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[i * 2];
    const az = r[i * 2 + 1];
    const dx = r[j * 2] - ax;
    const dz = r[j * 2 + 1] - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - x;
    const ez = az + dz * t - z;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// Minimum-area oriented rectangle via edge directions: {cx, cz, ux, uz (long axis), len, wid, angle}.
export function orientedBox(r) {
  const n = r.length / 2;
  let best = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = r[j * 2] - r[i * 2];
    let uz = r[j * 2 + 1] - r[i * 2 + 1];
    const l = Math.hypot(ux, uz);
    if (l < 1e-3) continue;
    ux /= l;
    uz /= l;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = r[k * 2];
      const z = r[k * 2 + 1];
      const u = x * ux + z * uz;
      const v = -x * uz + z * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, ux, uz, minU, maxU, minV, maxV };
  }
  if (!best) return null;
  let { ux, uz } = best;
  let len = best.maxU - best.minU;
  let wid = best.maxV - best.minV;
  const cu = (best.minU + best.maxU) / 2;
  const cv = (best.minV + best.maxV) / 2;
  const cx = cu * ux - cv * uz;
  const cz = cu * uz + cv * ux;
  if (wid > len) {
    [len, wid] = [wid, len];
    [ux, uz] = [-uz, ux];
  }
  return { cx, cz, ux, uz, len, wid, area: best.area, angle: Math.atan2(uz, ux) };
}

export function isConvex(r) {
  const n = r.length / 2;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    const c = ((i + 2) % n) * 2;
    const cr = (r[b] - r[a]) * (r[c + 1] - r[b + 1]) - (r[b + 1] - r[a + 1]) * (r[c] - r[b]);
    if (Math.abs(cr) < 1e-6) continue;
    const s = Math.sign(cr);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}
