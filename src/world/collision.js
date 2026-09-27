import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { pointInPoly, closestOnSegment, polyCentroid } from '../core/geo.js';

// CollisionWorld: the physical city. Built straight from the map data (flat-roofed extrusions of
// every building footprint + a ground plane at y = 0), plus any extra colliders registered by the
// city renderer (landmark crowns, the Kopje hill, ...). All physics and web-anchor queries go here.
//
// Public API (game.world):
//   raycast(origin, dir, maxDist, out?)      -> {point, normal, distance, buildingId} | null (fills `out` if given)
//   collideCapsule(start, end, radius)       -> {hit, delta, normal, ground, groundNormal, wall, wallNormal}
//                                               (start/end are the capsule segment endpoints; they are
//                                               moved in place out of the geometry; the result object is
//                                               reused after 4 further calls)
//   sweep(from, to, radius)                  -> clamps a fast move so it can't tunnel through walls
//   buildingAt(x, z)                         -> building record containing the point, or null
//   roofHeightAt(x, z)                       -> roof height (m) of the building at x,z, or 0
//   buildingsNear(x, z, r)                   -> array of building records whose bbox is within r
//   nearestRoad(x, z, maxDist=80)            -> {road, x, z, dist, t, seg, name} | null
//   streetNameAt(x, z)                       -> best street name near a point ('' if none)
//   addCollider(geometry, id=-2)             -> merge an extra BufferGeometry (world space) into physics
//   addBuilding(record)                      -> index an extra building volume for the lookups below
//   bounds                                   -> {minX,maxX,minZ,maxZ}
//   data                                     -> the raw map JSON
// Building records are the entries of data.buildings, augmented with: cx, cz (centroid),
// minX, maxX, minZ, maxZ (bbox).

const GRID = 50;
const _ray = new THREE.Ray();
const _seg = new THREE.Line3();
const _box = new THREE.Box3();
const _triPoint = new THREE.Vector3();
const _capPoint = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();
const _v = new THREE.Vector3();
const _wallAcc = new THREE.Vector3();
const _groundAcc = new THREE.Vector3();

function makeCapsuleResult() {
  return {
    hit: false,
    delta: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    ground: false,
    groundNormal: new THREE.Vector3(0, 1, 0),
    wall: false,
    wallNormal: new THREE.Vector3(),
    ceiling: false,
  };
}

export class CollisionWorld {
  constructor(data) {
    this.data = data;
    this.bounds = { ...data.meta.bounds };
    this.buildings = data.buildings;
    this.roads = data.roads;
    this.extra = [];
    this.extraBuildings = [];
    this._results = [makeCapsuleResult(), makeCapsuleResult(), makeCapsuleResult(), makeCapsuleResult()];
    this._resultIndex = 0;
    this._prepBuildings();
    this._prepRoads();
    this._build();
  }

  _prepBuildings() {
    this.bGrid = new Map();
    for (const b of this.buildings) this._indexBuilding(b);
  }

  _indexBuilding(b, priority = false) {
    const fp = b.fp;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < fp.length; i += 2) {
      minX = Math.min(minX, fp[i]);
      maxX = Math.max(maxX, fp[i]);
      minZ = Math.min(minZ, fp[i + 1]);
      maxZ = Math.max(maxZ, fp[i + 1]);
    }
    const c = polyCentroid(fp);
    Object.assign(b, { minX, maxX, minZ, maxZ, cx: c.x, cz: c.z });
    for (let gx = Math.floor(minX / GRID); gx <= Math.floor(maxX / GRID); gx++) {
      for (let gz = Math.floor(minZ / GRID); gz <= Math.floor(maxZ / GRID); gz++) {
        const k = gx * 100003 + gz;
        if (!this.bGrid.has(k)) this.bGrid.set(k, []);
        if (priority) this.bGrid.get(k).unshift(b);
        else this.bGrid.get(k).push(b);
      }
    }
  }

  // Index an extra building volume (e.g. a synthetic landmark tower) for buildingAt / roofHeightAt /
  // buildingsNear. Physics still comes from addCollider. record: {id, fp:[x,z,...], h, name?, lm?}.
  // Extra volumes win over mapped footprints they stand on (e.g. a hotel tower rising from its podium).
  addBuilding(record) {
    this._indexBuilding(record, true);
    this.extraBuildings.push(record);
    return record;
  }

  _prepRoads() {
    this.rGrid = new Map();
    this.roads.forEach((r, ri) => {
      const p = r.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const minX = Math.min(p[i], p[i + 2]);
        const maxX = Math.max(p[i], p[i + 2]);
        const minZ = Math.min(p[i + 1], p[i + 3]);
        const maxZ = Math.max(p[i + 1], p[i + 3]);
        for (let gx = Math.floor(minX / GRID); gx <= Math.floor(maxX / GRID); gx++) {
          for (let gz = Math.floor(minZ / GRID); gz <= Math.floor(maxZ / GRID); gz++) {
            const k = gx * 100003 + gz;
            if (!this.rGrid.has(k)) this.rGrid.set(k, []);
            this.rGrid.get(k).push(ri, i >> 1);
          }
        }
      }
    });
  }

  _build() {
    const pos = [];
    const bid = [];
    const pushTri = (ax, ay, az, bx, by, bz, cx, cy, cz, id) => {
      pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      bid.push(id, id, id);
    };

    for (const b of this.buildings) {
      const y0 = b.minH || 0;
      const y1 = Math.max(b.h, y0 + 0.5);
      const rings = [b.fp, ...(b.holes || [])];
      // Walls. Outer ring is CCW seen from above (north up) => in (x,z) it is clockwise, so the
      // outward normal of edge (a->b) is (dz, -dx) rotated; we only need consistent winding for
      // front faces, and physics uses double-sided tests, so winding is not critical here.
      for (const ring of rings) {
        const n = ring.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ax = ring[i * 2];
          const az = ring[i * 2 + 1];
          const bx = ring[j * 2];
          const bz = ring[j * 2 + 1];
          pushTri(ax, y0, az, bx, y0, bz, bx, y1, bz, b.id);
          pushTri(ax, y0, az, bx, y1, bz, ax, y1, az, b.id);
        }
      }
      // Roof (and underside for raised structures).
      const contour = [];
      for (let i = 0; i < b.fp.length; i += 2) contour.push(new THREE.Vector2(b.fp[i], b.fp[i + 1]));
      const holes = (b.holes || []).map((h) => {
        const pts = [];
        for (let i = 0; i < h.length; i += 2) pts.push(new THREE.Vector2(h[i], h[i + 1]));
        return pts;
      });
      let tris;
      try {
        tris = THREE.ShapeUtils.triangulateShape(contour, holes);
      } catch {
        tris = [];
      }
      const all = contour.concat(...holes);
      for (const t of tris) {
        const a = all[t[0]];
        const c = all[t[1]];
        const d = all[t[2]];
        if (!a || !c || !d) continue;
        pushTri(a.x, y1, a.y, d.x, y1, d.y, c.x, y1, c.y, b.id);
        if (y0 > 0.5) pushTri(a.x, y0, a.y, c.x, y0, c.y, d.x, y0, d.y, b.id);
      }
    }

    // Ground plane (generous margin so the player can never fall off the world).
    const m = 2000;
    const { minX, maxX, minZ, maxZ } = this.bounds;
    pushTri(minX - m, 0, minZ - m, minX - m, 0, maxZ + m, maxX + m, 0, maxZ + m, -1);
    pushTri(minX - m, 0, minZ - m, maxX + m, 0, maxZ + m, maxX + m, 0, minZ - m, -1);

    for (const e of this.extra) {
      const g = e.geometry.index ? e.geometry.toNonIndexed() : e.geometry;
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        bid.push(e.id);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const index = new Uint32Array(pos.length / 3);
    for (let i = 0; i < index.length; i++) index[i] = i;
    geom.setIndex(new THREE.BufferAttribute(index, 1));
    this.vertexBuilding = Int32Array.from(bid);
    this.geometry = geom;
    this.bvh = new MeshBVH(geom, { targetLeafSize: 8 });
    this.triCount = index.length / 3;
    this._dirty = false;
  }

  addCollider(geometry, id = -2) {
    this.extra.push({ geometry, id });
    this._dirty = true;
  }

  _ensure() {
    if (this._dirty) this._build();
  }

  buildingIdOfFace(faceIndex) {
    const vi = this.geometry.index.array[faceIndex * 3];
    return this.vertexBuilding[vi];
  }

  // Pass `out` ({point: Vector3, normal: Vector3}) to receive the hit without allocating.
  raycast(origin, dir, maxDist = 500, out = null) {
    this._ensure();
    _ray.origin.copy(origin);
    _ray.direction.copy(dir);
    const hit = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, maxDist);
    if (!hit) return null;
    const res = out || { point: new THREE.Vector3(), normal: new THREE.Vector3() };
    res.point.copy(hit.point);
    res.normal.copy(hit.face.normal);
    if (res.normal.dot(dir) > 0) res.normal.negate();
    res.distance = hit.distance;
    res.buildingId = this.buildingIdOfFace(hit.faceIndex);
    return res;
  }

  // Push a capsule (segment start/end + radius) out of the static geometry. start/end are modified.
  // Contacts are classified by push direction (not triangle normal) so that rolling over a convex
  // roof edge reads as ground rather than as an inward-facing wall. Results come from a small ring
  // of reused objects: read them before calling collideCapsule four more times.
  collideCapsule(start, end, radius) {
    this._ensure();
    const res = this._results[(this._resultIndex = (this._resultIndex + 1) % this._results.length)];
    res.hit = false;
    res.ground = false;
    res.wall = false;
    res.ceiling = false;
    res.delta.set(0, 0, 0);
    res.normal.set(0, 0, 0);
    res.groundNormal.set(0, 1, 0);
    res.wallNormal.set(0, 0, 0);
    _seg.start.copy(start);
    _seg.end.copy(end);
    _wallAcc.set(0, 0, 0);
    _groundAcc.set(0, 0, 0);
    let wallCount = 0;
    let groundCount = 0;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      _box.makeEmpty();
      _box.expandByPoint(_seg.start);
      _box.expandByPoint(_seg.end);
      _box.min.addScalar(-radius);
      _box.max.addScalar(radius);
      this.bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          const dist = tri.closestPointToSegment(_seg, _triPoint, _capPoint);
          if (dist < radius) {
            const depth = radius - dist;
            _dir.subVectors(_capPoint, _triPoint);
            if (_dir.lengthSq() < 1e-10) {
              tri.getNormal(_dir);
            } else {
              _dir.normalize();
            }
            _seg.start.addScaledVector(_dir, depth);
            _seg.end.addScaledVector(_dir, depth);
            if (_dir.y > 0.6) {
              _groundAcc.add(_dir);
              groundCount++;
            } else if (_dir.y < -0.6) {
              res.ceiling = true;
            } else {
              _wallAcc.x += _dir.x;
              _wallAcc.z += _dir.z;
              wallCount++;
            }
            moved = true;
          }
          return false;
        },
      });
      if (!moved) break;
      res.hit = true;
    }
    res.delta.subVectors(_seg.start, start);
    if (res.hit) {
      if (res.delta.lengthSq() > 1e-12) res.normal.copy(res.delta).normalize();
      start.copy(_seg.start);
      end.copy(_seg.end);
    }
    if (groundCount) {
      res.ground = true;
      res.groundNormal.copy(_groundAcc).normalize();
    }
    if (wallCount && _wallAcc.lengthSq() > 1e-8) {
      res.wall = true;
      res.wallNormal.copy(_wallAcc).normalize();
    }
    return res;
  }

  // Clamp a straight move from->to (sphere of `radius`) at the first surface. Returns the hit or null.
  // `to` is modified in place.
  sweep(from, to, radius) {
    _v.subVectors(to, from);
    const len = _v.length();
    if (len < 1e-6) return null;
    _v.divideScalar(len);
    const hit = this.raycast(from, _v, len + radius);
    if (!hit) return null;
    const allowed = Math.max(0, hit.distance - radius * 0.9);
    if (allowed < len) {
      to.copy(from).addScaledVector(_v, allowed);
      return hit;
    }
    return null;
  }

  _cellsAround(x, z, r, grid, fn) {
    for (let gx = Math.floor((x - r) / GRID); gx <= Math.floor((x + r) / GRID); gx++) {
      for (let gz = Math.floor((z - r) / GRID); gz <= Math.floor((z + r) / GRID); gz++) {
        const arr = grid.get(gx * 100003 + gz);
        if (arr) fn(arr);
      }
    }
  }

  buildingAt(x, z) {
    const arr = this.bGrid.get(Math.floor(x / GRID) * 100003 + Math.floor(z / GRID));
    if (!arr) return null;
    for (const b of arr) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (!pointInPoly(x, z, b.fp)) continue;
      if (b.holes && b.holes.some((h) => pointInPoly(x, z, h))) continue;
      return b;
    }
    return null;
  }

  roofHeightAt(x, z) {
    const b = this.buildingAt(x, z);
    return b ? b.h : 0;
  }

  buildingsNear(x, z, r) {
    const out = new Set();
    this._cellsAround(x, z, r, this.bGrid, (arr) => {
      for (const b of arr) {
        if (b.maxX < x - r || b.minX > x + r || b.maxZ < z - r || b.minZ > z + r) continue;
        out.add(b);
      }
    });
    return [...out];
  }

  nearestRoad(x, z, maxDist = 80) {
    let best = null;
    let bestD2 = maxDist * maxDist;
    this._cellsAround(x, z, maxDist, this.rGrid, (arr) => {
      for (let k = 0; k < arr.length; k += 2) {
        const r = this.roads[arr[k]];
        const i = arr[k + 1] * 2;
        const c = closestOnSegment(x, z, r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]);
        if (c.d2 < bestD2) {
          bestD2 = c.d2;
          best = { road: r, roadIndex: arr[k], seg: arr[k + 1], t: c.t, x: c.x, z: c.z, dist: Math.sqrt(c.d2), name: r.name || '' };
        }
      }
    });
    return best;
  }

  streetNameAt(x, z) {
    // Prefer named roads within 60 m; unnamed service lanes are skipped.
    let best = '';
    let bestD2 = 60 * 60;
    this._cellsAround(x, z, 60, this.rGrid, (arr) => {
      for (let k = 0; k < arr.length; k += 2) {
        const r = this.roads[arr[k]];
        if (!r.name) continue;
        const i = arr[k + 1] * 2;
        const c = closestOnSegment(x, z, r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]);
        if (c.d2 < bestD2) {
          bestD2 = c.d2;
          best = r.name;
        }
      }
    });
    return best;
  }
}
