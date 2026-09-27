// Map projection shared with tools/build_map.py.
// World units are metres: x = east, z = south (north = -z), y = up.
// Origin is the centre of Africa Unity Square.

export const ORIGIN = { lat: -17.82932, lon: 31.05202 };
export const M_PER_DEG_LAT = 110574.0;
export const M_PER_DEG_LON = 111320.0 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export function lonLatToXZ(lon, lat) {
  return {
    x: (lon - ORIGIN.lon) * M_PER_DEG_LON,
    z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT,
  };
}

export function xzToLonLat(x, z) {
  return {
    lon: ORIGIN.lon + x / M_PER_DEG_LON,
    lat: ORIGIN.lat - z / M_PER_DEG_LAT,
  };
}

// Compass heading in degrees (0 = north, 90 = east) of a direction vector in the xz plane.
export function headingDeg(dx, dz) {
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function cardinal(deg) {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(deg / 45) % 8];
}

// Flat [x0,z0,x1,z1,...] helpers used by map data.
export function polyCentroid(fp) {
  let a = 0;
  let cx = 0;
  let cz = 0;
  const n = fp.length / 2;
  for (let i = 0; i < n; i++) {
    const x1 = fp[i * 2];
    const z1 = fp[i * 2 + 1];
    const j = (i + 1) % n;
    const x2 = fp[j * 2];
    const z2 = fp[j * 2 + 1];
    const f = x1 * z2 - x2 * z1;
    a += f;
    cx += (x1 + x2) * f;
    cz += (z1 + z2) * f;
  }
  if (Math.abs(a) < 1e-6) {
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < n; i++) {
      sx += fp[i * 2];
      sz += fp[i * 2 + 1];
    }
    return { x: sx / n, z: sz / n };
  }
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

export function polyArea(fp) {
  let a = 0;
  const n = fp.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += fp[i * 2] * fp[j * 2 + 1] - fp[j * 2] * fp[i * 2 + 1];
  }
  return Math.abs(a) / 2;
}

export function pointInPoly(x, z, fp) {
  let inside = false;
  const n = fp.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = fp[i * 2];
    const zi = fp[i * 2 + 1];
    const xj = fp[j * 2];
    const zj = fp[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

// Closest point on segment (ax,az)-(bx,bz) to (px,pz). Returns {x, z, t, d2}.
export function closestOnSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + dx * t;
  const z = az + dz * t;
  const ex = px - x;
  const ez = pz - z;
  return { x, z, t, d2: ex * ex + ez * ez };
}
