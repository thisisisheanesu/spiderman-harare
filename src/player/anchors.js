import * as THREE from 'three';

// Spatial queries for traversal: web anchors on roof edges, zip targets with aim assist, ledges to
// vault onto and edges to perch on. All geometry comes from game.world (CollisionWorld).

const DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

// Roof-edge points of a building, cached per record: [x, z, outwardX, outwardZ, isCorner] * n.
const edgeCache = new WeakMap();
function edgePoints(b) {
  let pts = edgeCache.get(b);
  if (pts) return pts;
  const fp = b.fp;
  const n = fp.length / 2;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += fp[i * 2] * fp[j * 2 + 1] - fp[j * 2] * fp[i * 2 + 1];
  }
  const sgn = area > 0 ? 1 : -1;
  const nx = new Float32Array(n);
  const nz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = fp[j * 2] - fp[i * 2];
    const dz = fp[j * 2 + 1] - fp[i * 2 + 1];
    const len = Math.hypot(dx, dz) || 1;
    nx[i] = (sgn * dz) / len;
    nz[i] = (-sgn * dx) / len;
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p = (i - 1 + n) % n;
    const x = fp[i * 2];
    const z = fp[i * 2 + 1];
    let cx = nx[p] + nx[i];
    let cz = nz[p] + nz[i];
    const cl = Math.hypot(cx, cz);
    if (cl < 0.2) {
      cx = nx[i];
      cz = nz[i];
    } else {
      cx /= cl;
      cz /= cl;
    }
    out.push(x, z, cx, cz, 1);
    const dx = fp[j * 2] - x;
    const dz = fp[j * 2 + 1] - z;
    const count = Math.floor(Math.hypot(dx, dz) / 6);
    for (let k = 1; k < count; k++) out.push(x + (dx * k) / count, z + (dz * k) / count, nx[i], nz[i], 0);
  }
  pts = Float32Array.from(out);
  edgeCache.set(b, pts);
  return pts;
}

// Midpoint of the roof edge whose outward normal best faces direction (dx, dz): {x, z, nx, nz}.
export function roofEdgeFacing(b, dx, dz) {
  const pts = edgePoints(b);
  const len = Math.hypot(dx, dz) || 1;
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < pts.length; i += 5) {
    if (pts[i + 4]) continue;
    const score = (pts[i + 2] * dx + pts[i + 3] * dz) / len;
    if (score > bestScore) {
      bestScore = score;
      best = { x: pts[i], z: pts[i + 1], nx: pts[i + 2], nz: pts[i + 3] };
    }
  }
  if (best) return best;
  // Short edges only (no mid-edge samples): fall back to the best corner.
  for (let i = 0; i < pts.length; i += 5) {
    const score = (pts[i + 2] * dx + pts[i + 3] * dz) / len;
    if (score > bestScore) {
      bestScore = score;
      best = { x: pts[i], z: pts[i + 1], nx: pts[i + 2], nz: pts[i + 3] };
    }
  }
  return best;
}

// Is the straight line from a to the anchor point b clear (apart from the anchor's own surface)?
function visible(world, a, b, slack = 1.2) {
  _d.subVectors(b, a);
  const dist = _d.length();
  if (dist < 1e-3) return true;
  _d.divideScalar(dist);
  const hit = world.raycast(a, _d, dist + 0.3);
  return !hit || hit.distance > dist - slack;
}

const bump = (x, c, w) => Math.max(0, 1 - Math.abs(x - c) / w);
const TOP_K = 6;
const _best = Array.from({ length: TOP_K }, () => ({ score: -Infinity, x: 0, y: 0, z: 0, nx: 0, nz: 0, side: 1, id: -1 }));

function pushCandidate(score, x, y, z, nx, nz, side, id) {
  if (score <= _best[TOP_K - 1].score) return;
  let i = TOP_K - 1;
  const slot = _best[i];
  while (i > 0 && _best[i - 1].score < score) {
    _best[i] = _best[i - 1];
    i--;
  }
  _best[i] = slot;
  Object.assign(slot, { score, x, y, z, nx, nz, side, id });
}

// Best swing anchor on a roof edge ahead of `dir` (horizontal unit vector) and above `from` (the hand).
// preferSide (+1 right / -1 left) gently alternates hands. Writes {point, normal, side, buildingId}.
export function findSwingAnchor(world, from, dir, speed, preferSide, out) {
  for (const c of _best) c.score = -Infinity;
  const ahead = 16 + Math.min(speed, 40) * 0.5;
  const buildings = world.buildingsNear(from.x + dir.x * ahead, from.z + dir.z * ahead, 62);
  const rightX = -dir.z;
  const rightZ = dir.x;
  for (const b of buildings) {
    const ry = b.h - from.y;
    if (b.h < 6 || ry < 3.5) continue;
    const pts = edgePoints(b);
    for (let i = 0; i < pts.length; i += 5) {
      const rx = pts[i] - from.x;
      const rz = pts[i + 1] - from.z;
      const hd = Math.hypot(rx, rz);
      if (hd < 2) continue;
      const d = Math.hypot(hd, ry);
      if (d < 9 || d > 82) continue;
      const elev = Math.atan2(ry, hd);
      if (elev < 0.28 || elev > 1.35) continue;
      const fwd = (rx * dir.x + rz * dir.z) / hd;
      if (fwd < 0.15) continue;
      const lat = (rx * rightX + rz * rightZ) / hd;
      const facing = Math.max(0, -(pts[i + 2] * rx + pts[i + 3] * rz) / hd);
      const score =
        1.3 * fwd -
        ((elev - 0.85) / 0.45) ** 2 -
        ((d - 32) / 26) ** 2 +
        0.25 * pts[i + 4] +
        0.35 * facing +
        Math.min(0.5, ry / 50) +
        0.35 * bump(Math.abs(lat), 0.45, 0.35) +
        (lat * preferSide > 0.1 ? 0.15 : 0);
      pushCandidate(score, pts[i], b.h, pts[i + 1], pts[i + 2], pts[i + 3], lat >= 0 ? 1 : -1, b.id);
    }
  }
  for (const c of _best) {
    if (c.score === -Infinity) break;
    _v.set(c.x + c.nx * 0.05, c.y - 0.05, c.z + c.nz * 0.05);
    if (!visible(world, from, _v)) continue;
    out.point.copy(_v);
    out.normal.set(c.nx, 0, c.nz);
    out.side = c.side;
    out.buildingId = c.id;
    return out;
  }
  return null;
}

// Height of the first surface below (x, y, z) (or 0 = street level).
export function groundBelow(world, x, y, z, maxDist = 200) {
  _o.set(x, y, z);
  const hit = world.raycast(_o, DOWN, maxDist);
  return hit ? hit.point.y : 0;
}

// Web-zip target from the camera ray, with aim assist towards roof edges inside a cone.
// out: {kind: 'edge'|'wall'|'surface', point, normal (surface normal or edge outward), distance}.
const ZIP_RANGE = 90;
const ASSIST_CONE = 0.16;
const _hitP = new THREE.Vector3();
const _near = new Set();

export function findZipTarget(world, camPos, camDir, origin, out) {
  const t0 = Math.max(0, _v.subVectors(origin, camPos).dot(camDir));
  const start = _o.copy(camPos).addScaledVector(camDir, t0);
  const hit = world.raycast(start, camDir, ZIP_RANGE);

  // Aim assist: the roof edge closest to the crosshair within the cone.
  _near.clear();
  for (let s = 12; s <= ZIP_RANGE; s += 22) {
    const px = start.x + camDir.x * s;
    const pz = start.z + camDir.z * s;
    for (const b of world.buildingsNear(px, pz, 16 + s * ASSIST_CONE)) _near.add(b);
  }
  let bestAng = ASSIST_CONE;
  let best = null;
  let bx = 0;
  let bz = 0;
  let bnx = 0;
  let bnz = 0;
  const limit = hit ? hit.distance + 4 : ZIP_RANGE;
  for (const b of _near) {
    if (b.h < 2.5) continue;
    const pts = edgePoints(b);
    for (let i = 0; i < pts.length; i += 5) {
      _v.set(pts[i] - start.x, b.h - start.y, pts[i + 1] - start.z);
      const along = _v.dot(camDir);
      if (along < 3 || along > limit) continue;
      const perp = Math.sqrt(Math.max(0, _v.lengthSq() - along * along));
      const ang = Math.atan2(perp, along);
      if (ang < bestAng) {
        bestAng = ang;
        best = b;
        bx = pts[i];
        bz = pts[i + 1];
        bnx = pts[i + 2];
        bnz = pts[i + 3];
      }
    }
  }
  if (best) {
    _hitP.set(bx + bnx * 0.05, best.h, bz + bnz * 0.05);
    if (visible(world, origin, _hitP, 1.5)) {
      out.kind = 'edge';
      out.point.copy(_hitP);
      out.normal.set(bnx, 0, bnz);
      out.distance = origin.distanceTo(_hitP);
      return out;
    }
  }
  if (!hit) return null;
  return classifySurface(world, hit, origin, out);
}

function classifySurface(world, hit, origin, out) {
  // The player (not the camera) must see the point; otherwise target whatever blocks the way.
  _d.subVectors(hit.point, origin);
  const dist = _d.length();
  _d.divideScalar(dist);
  const block = world.raycast(origin, _d, dist - 0.5);
  if (block) hit = block;
  const b = hit.buildingId >= 0 ? world.buildings[hit.buildingId] : null;
  out.point.copy(hit.point);
  out.distance = origin.distanceTo(hit.point);
  if (out.distance < 4) return null;
  if (Math.abs(hit.normal.y) < 0.5) {
    out.normal.set(hit.normal.x, 0, hit.normal.z).normalize();
    if (b && b.h - hit.point.y < 6 && !b.minH) {
      out.kind = 'edge';
      out.point.y = b.h;
      out.point.addScaledVector(out.normal, 0.05);
    } else {
      out.kind = 'wall';
    }
    return out;
  }
  if (hit.normal.y < 0) return null;
  out.kind = 'surface';
  out.normal.copy(hit.normal);
  return out;
}

// Top of an obstacle in front of the feet (facing into the wall with normal n), if it is within
// maxRise above the feet: returns the top point (written into out) or null.
export function probeLedge(world, feet, n, radius, maxRise, out) {
  _o.copy(feet).addScaledVector(n, -(radius + 0.35));
  _o.y += maxRise + 0.1;
  const hit = world.raycast(_o, DOWN, maxRise + 0.4);
  if (!hit || hit.normal.y < 0.7) return null;
  const rise = hit.point.y - feet.y;
  if (rise < 0.25 || rise > maxRise) return null;
  return out.copy(hit.point);
}

// A drop-off within reach of the feet (roof edge, parapet, antenna top): returns
// {point (feet position at the lip), outward} or null.
const DIRS = 12;
export function findPerchEdge(world, feet, out) {
  let ox = 0;
  let oz = 0;
  let drops = 0;
  for (let i = 0; i < DIRS; i++) {
    const a = (i / DIRS) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    if (isDrop(world, feet, dx, dz, 1.3)) {
      ox += dx;
      oz += dz;
      drops++;
    }
  }
  if (!drops) return null;
  let len = Math.hypot(ox, oz);
  if (len < 1e-3) {
    // Surrounded by drops (a pinnacle): face wherever the player last looked.
    ox = out.outward.x;
    oz = out.outward.z;
    len = Math.hypot(ox, oz) || 1;
  }
  ox /= len;
  oz /= len;
  if (!isDrop(world, feet, ox, oz, 1.3)) return null;
  // Binary search for the lip along the outward direction.
  let lo = 0;
  let hi = 1.3;
  for (let k = 0; k < 6; k++) {
    const mid = (lo + hi) / 2;
    if (isDrop(world, feet, ox, oz, mid)) hi = mid;
    else lo = mid;
  }
  const lip = Math.max(0, lo - 0.1);
  out.point.set(feet.x + ox * lip, feet.y, feet.z + oz * lip);
  out.outward.set(ox, 0, oz);
  return out;
}

function isDrop(world, feet, dx, dz, r) {
  _o.set(feet.x + dx * r, feet.y + 0.5, feet.z + dz * r);
  const hit = world.raycast(_o, DOWN, 3.2);
  return !hit;
}
