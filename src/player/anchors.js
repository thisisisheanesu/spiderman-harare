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
const TOP_K = 10;
const _best = Array.from({ length: TOP_K }, () => ({ score: -Infinity, x: 0, y: 0, z: 0, nx: 0, nz: 0, side: 1, id: -1, kind: 0 }));
const KINDS = ['roof', 'facade', 'prop'];

function pushCandidate(score, x, y, z, nx, nz, side, id, kind) {
  if (score <= _best[TOP_K - 1].score) return;
  let i = TOP_K - 1;
  const slot = _best[i];
  while (i > 0 && _best[i - 1].score < score) {
    _best[i] = _best[i - 1];
    i--;
  }
  _best[i] = slot;
  slot.score = score;
  slot.x = x;
  slot.y = y;
  slot.z = z;
  slot.nx = nx;
  slot.nz = nz;
  slot.side = side;
  slot.id = id;
  slot.kind = kind;
}

// Swing-anchor search state for one query (module scratch, so scoring allocates nothing).
const Q = { fx: 0, fy: 0, fz: 0, dx: 0, dz: 0, minRise: 0, minElev: 0, idealElev: 0, idealDist: 0, prefSide: 1, street: 0, alt: 13 };
const FACADE_BELOW_ROOF = 1.5; // facade anchors stay this far under the roof edge
export const MAX_REACH = 72;
const MIN_REACH = 9;

// Score one candidate anchor at (x, y, z) whose surface faces (nx, nz) (0, 0: no facing, e.g. a
// lamp post); corner = 0..1 bonus; kind indexes KINDS; kept in the top-K list if good enough.
// This is only the geometric first cut (a believable web: ahead, up at 35-60 degrees, 25-55 m
// away, a corner or an edge facing us, alternating hands); the swing module then simulates the
// real pendulum on the best few (see opts.accept) and picks by how the swing would actually go.
function scoreAnchor(x, y, z, nx, nz, corner, id, kind) {
  const rx = x - Q.fx;
  const rz = z - Q.fz;
  const ry = y - Q.fy;
  if (ry < Q.minRise) return;
  const hd = Math.hypot(rx, rz);
  if (hd < 2) return;
  const d = Math.hypot(hd, ry);
  if (d < MIN_REACH || d > MAX_REACH) return;
  const elev = Math.atan2(ry, hd);
  if (elev < Q.minElev || elev > 1.3) return;
  const fwd = (rx * Q.dx + rz * Q.dz) / hd;
  if (fwd < 0.2) return;
  const lat = (rx * -Q.dz + rz * Q.dx) / hd;
  const facing = Math.max(0, -(nx * rx + nz * rz) / hd);
  // A rope about as long as the web (d) bottoms out at y - d: ideally at least `alt` over the street
  // without reeling in, so on low buildings shorter, steeper webs are the believable ones.
  const ideal = Math.min(Q.idealDist, Math.max(14, y - Q.street - Q.alt));
  const score =
    1.2 * fwd -
    ((elev - Q.idealElev) / 0.42) ** 2 -
    ((d - ideal) / 18) ** 2 -
    0.05 * Math.max(0, Q.street + Q.alt - (y - d)) +
    0.2 * corner +
    0.3 * facing +
    // Higher anchors leave room for a long arc well above the street.
    Math.min(0.6, Math.max(0, y - Q.street - 14) / 30) +
    0.3 * bump(Math.abs(lat), 0.4, 0.4) +
    (lat * Q.prefSide > 0.1 ? 0.15 : 0);
  pushCandidate(score, x, y, z, nx, nz, lat >= 0 ? 1 : -1, id, kind);
}

// Best swing anchor ahead of `dir` (horizontal unit vector) and above `from` (the hand).
// Candidates: roof-edge points (corners preferred); on buildings that tower over the hand, points on
// the facade at the ideal elevation (the web sticks to the wall there), so tall buildings carry
// swings at any height; and, only when no building qualifies, the street furniture / trees that
// opts.fallback(x, z, r) returns (see readFallback). Falling fast, flatter webs still catch you
// (the fall turns into the swing), so the elevation limits relax.
// opts: {speed, fall (downward speed), side (+1 right / -1 left, gently alternates hands),
//        street (ground height under the hand), alt (preferred lowest swing height over the street:
//        steers the preferred web length), fallback?, accept?}.
// accept(point, candidate) rates a visible candidate: a number added to its geometric score (the
// swing module simulates the swing it would give), or -Infinity / null to veto it. Every visible
// candidate of the top few is rated and the best total wins.
// Writes {point, normal, side, buildingId, kind: 'roof'|'facade'|'prop', score} into out.
export function findSwingAnchor(world, from, dir, opts, out) {
  for (const c of _best) c.score = -Infinity;
  const speed = opts.speed;
  const catchK = Math.min(1, Math.max(0, (opts.fall - 4) / 22));
  Q.fx = from.x;
  Q.fy = from.y;
  Q.fz = from.z;
  Q.dx = dir.x;
  Q.dz = dir.z;
  // (Down to a little below the hand: a web to a lower roof edge still holds once you drop into the
  // arc, or reel in; the swing simulation checks that it does.)
  Q.minRise = -3 - 4 * catchK;
  Q.minElev = -0.2 - 0.2 * catchK;
  Q.idealElev = 0.78 - 0.3 * catchK;
  Q.idealDist = 30 + Math.min(speed, 35) * 0.3;
  Q.prefSide = opts.side;
  Q.street = opts.street || 0;
  Q.alt = opts.alt ?? 13;
  const tanIdeal = Math.tan(Math.max(0.2, Q.idealElev));
  const ahead = 14 + Math.min(speed, 40) * 0.55;
  const cx = from.x + dir.x * ahead;
  const cz = from.z + dir.z * ahead;
  const buildings = world.buildingsNear(cx, cz, 60);
  for (let k = 0; k < buildings.length; k++) {
    const b = buildings[k];
    const ry = b.h - from.y;
    if (b.h < 8 || ry < Q.minRise) continue;
    const pts = edgePoints(b);
    const top = b.h - FACADE_BELOW_ROOF;
    const low = Math.max(from.y + Q.minRise, (b.minH || 0) + 1);
    for (let i = 0; i < pts.length; i += 5) {
      const x = pts[i];
      const z = pts[i + 1];
      scoreAnchor(x, b.h, z, pts[i + 2], pts[i + 3], pts[i + 4] ? 1 : 0, b.id, 0);
      // The same spot lower down the wall, at the height that gives the ideal web angle.
      const fy = from.y + Math.hypot(x - from.x, z - from.z) * tanIdeal;
      if (fy < top && fy >= low) scoreAnchor(x, fy, z, pts[i + 2], pts[i + 3], 0.4, b.id, 1);
    }
  }
  const found = pickBest(world, from, out, opts.accept);
  if (found || !opts.fallback) return found;
  // No building anchor qualifies (low-rise streets): street lights and trees.
  for (const c of _best) c.score = -Infinity;
  if (!readFallback(opts.fallback(cx, cz, 60))) return null;
  return pickBest(world, from, out, opts.accept);
}

// Feed fallback anchors into the candidate list. Accepts an array of points
// ({x, y, z}, {position: Vector3}, {point: Vector3}) or a flat [x, y, z, ...] number array.
function readFallback(list) {
  if (!list) return false;
  let any = false;
  if (typeof list[0] === 'number') {
    for (let i = 0; i + 2 < list.length; i += 3) {
      scoreAnchor(list[i], list[i + 1], list[i + 2], 0, 0, 0, -1, 2);
      any = true;
    }
    return any;
  }
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const p = a && (a.position || a.point || a);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    scoreAnchor(p.x, p.y, p.z, 0, 0, 0, -1, 2);
    any = true;
  }
  return any;
}

// Of the ranked candidates the hand can actually see, the one with the best geometric score plus
// accept()'s rating (vetoed ones skipped). Written into out.
function pickBest(world, from, out, accept) {
  let best = null;
  let bestScore = -Infinity;
  for (const c of _best) {
    if (c.score === -Infinity) break;
    anchorPoint(c, _v);
    if (!visible(world, from, _v)) continue;
    const r = accept ? accept(_v, c) : 0;
    if (r === null || r === undefined || r === -Infinity || Number.isNaN(r)) continue;
    const total = c.score + r;
    if (total > bestScore) {
      bestScore = total;
      best = c;
    }
  }
  if (!best) return null;
  writeAnchor(best, from, out);
  out.score = bestScore;
  return out;
}

function anchorPoint(c, p) {
  if (c.kind === 2) return p.set(c.x, c.y, c.z);
  return p.set(c.x + c.nx * 0.05, c.kind === 1 ? c.y : c.y - 0.05, c.z + c.nz * 0.05);
}

function writeAnchor(c, from, out) {
  anchorPoint(c, out.point);
  if (c.kind === 2) out.normal.set(from.x - c.x, 0, from.z - c.z).normalize();
  else out.normal.set(c.nx, 0, c.nz);
  out.side = c.side;
  out.buildingId = c.id;
  out.kind = KINDS[c.kind];
  return out;
}

// Height of the first surface below (x, y, z) within maxDist, else `fallback` (street level).
export function groundBelow(world, x, y, z, maxDist = 200, fallback = 0) {
  _o.set(x, y, z);
  const hit = world.raycast(_o, DOWN, maxDist);
  return hit ? hit.point.y : fallback;
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
// maxRise above the feet and there is room to land on it: returns the top point (written into out)
// or null.
export function probeLedge(world, feet, n, radius, maxRise, out) {
  _o.copy(feet).addScaledVector(n, -(radius + 0.35));
  _o.y += maxRise + 0.1;
  const hit = world.raycast(_o, DOWN, maxRise + 0.4);
  if (!hit || hit.normal.y < 0.7) return null;
  const rise = hit.point.y - feet.y;
  if (rise < 0.25 || rise > maxRise) return null;
  out.copy(hit.point);
  // The probe may start inside a closed collider (a water tank on a lift room) and find the floor
  // under it: the vault would then end inside, trapped. Require a clear run in over the lip.
  _o.set(feet.x, out.y + 0.5, feet.z);
  if (world.raycast(_o, _d.copy(n).negate(), 2 * radius + 0.9)) return null;
  return out;
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
  // Stand on whatever is at the lip (a parapet or kerb may be higher than where we stood).
  _o.set(feet.x + ox * lip, feet.y + 1.2, feet.z + oz * lip);
  const top = world.raycast(_o, DOWN, 2);
  out.point.set(_o.x, top ? top.point.y : feet.y, _o.z);
  out.outward.set(ox, 0, oz);
  return out;
}

function isDrop(world, feet, dx, dz, r) {
  _o.set(feet.x + dx * r, feet.y + 0.5, feet.z + dz * r);
  const hit = world.raycast(_o, DOWN, 3.2);
  return !hit;
}
