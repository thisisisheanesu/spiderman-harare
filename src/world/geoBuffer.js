import * as THREE from 'three';

// Growable vertex/index buffer used to build the big merged city meshes without allocating a
// BufferGeometry per piece. Every vertex carries:
//   position (3f), normal (3f), uv (2f, usually metres or tile units),
//   color  (4 x u8, normalized)  - tint multiplied into the texture (alpha: ground blend factor)
//   facade (4 x u8, integer)     - [texture-array layer, seed, kind + 8 * class, glass preset]
// The current "brush" (tint + facade bytes) and an optional local transform (translation,
// rotation about Y, uniform scale) apply to every vertex written after they are set.
export class GeoBuffer {
  constructor(capacity = 4096) {
    this._alloc(capacity, capacity * 2);
    this.vCount = 0;
    this.iCount = 0;
    this.brushColor = [255, 255, 255, 255];
    this.brushFacade = [0, 0, 0, 0];
    this._tf = null;
  }

  _alloc(vCap, iCap) {
    const grow = (old, n) => {
      const a = new old.constructor(n);
      a.set(old.subarray(0, Math.min(old.length, n)));
      return a;
    };
    if (!this.pos) {
      this.pos = new Float32Array(vCap * 3);
      this.nrm = new Float32Array(vCap * 3);
      this.uv = new Float32Array(vCap * 2);
      this.col = new Uint8Array(vCap * 4);
      this.fac = new Uint8Array(vCap * 4);
      this.idx = new Uint32Array(iCap);
      return;
    }
    if (vCap * 3 > this.pos.length) {
      this.pos = grow(this.pos, vCap * 3);
      this.nrm = grow(this.nrm, vCap * 3);
      this.uv = grow(this.uv, vCap * 2);
      this.col = grow(this.col, vCap * 4);
      this.fac = grow(this.fac, vCap * 4);
    }
    if (iCap > this.idx.length) this.idx = grow(this.idx, iCap);
  }

  _reserve(nv, ni) {
    const vNeed = this.vCount + nv;
    const iNeed = this.iCount + ni;
    if (vNeed * 3 > this.pos.length || iNeed > this.idx.length) {
      this._alloc(Math.max(vNeed, (this.pos.length / 3) * 2), Math.max(iNeed, this.idx.length * 2));
    }
  }

  // Tint (0..255 sRGB bytes) + facade bytes for following vertices.
  brush(rgb, layer, seed = 0, kind = 0, cls = 0, glass = 0) {
    this.brushColor[0] = rgb[0];
    this.brushColor[1] = rgb[1];
    this.brushColor[2] = rgb[2];
    this.brushColor[3] = 255;
    this.brushFacade[0] = layer;
    this.brushFacade[1] = seed & 255;
    this.brushFacade[2] = (kind & 7) + 8 * (cls & 31);
    this.brushFacade[3] = glass;
    return this;
  }

  setLayer(layer) {
    this.brushFacade[0] = layer;
    return this;
  }

  setKind(kind) {
    this.brushFacade[2] = (kind & 7) + (this.brushFacade[2] & ~7);
    return this;
  }

  setTint(rgb, alpha = 255) {
    this.brushColor[0] = rgb[0];
    this.brushColor[1] = rgb[1];
    this.brushColor[2] = rgb[2];
    this.brushColor[3] = alpha;
    return this;
  }

  // Local frame for following vertices: p' = R_y(rot) * (p * s) + (x, y, z).
  setTransform(x, y, z, rot = 0, s = 1) {
    this._tf = { x, y, z, c: Math.cos(rot), sn: Math.sin(rot), s };
    return this;
  }

  clearTransform() {
    this._tf = null;
    return this;
  }

  vertex(x, y, z, nx, ny, nz, u, v) {
    this._reserve(1, 0);
    const tf = this._tf;
    if (tf) {
      const lx = x * tf.s;
      const lz = z * tf.s;
      x = tf.c * lx + tf.sn * lz + tf.x;
      z = -tf.sn * lx + tf.c * lz + tf.z;
      y = y * tf.s + tf.y;
      const nx2 = tf.c * nx + tf.sn * nz;
      nz = -tf.sn * nx + tf.c * nz;
      nx = nx2;
    }
    const i = this.vCount++;
    const p = i * 3;
    this.pos[p] = x;
    this.pos[p + 1] = y;
    this.pos[p + 2] = z;
    this.nrm[p] = nx;
    this.nrm[p + 1] = ny;
    this.nrm[p + 2] = nz;
    this.uv[i * 2] = u;
    this.uv[i * 2 + 1] = v;
    const c = i * 4;
    this.col[c] = this.brushColor[0];
    this.col[c + 1] = this.brushColor[1];
    this.col[c + 2] = this.brushColor[2];
    this.col[c + 3] = this.brushColor[3];
    this.fac[c] = this.brushFacade[0];
    this.fac[c + 1] = this.brushFacade[1];
    this.fac[c + 2] = this.brushFacade[2];
    this.fac[c + 3] = this.brushFacade[3];
    return i;
  }

  tri(a, b, c) {
    this._reserve(0, 3);
    const i = this.iCount;
    this.idx[i] = a;
    this.idx[i + 1] = b;
    this.idx[i + 2] = c;
    this.iCount += 3;
  }

  // Planar quad a,b,c,d (in order around the face) with normal n; uv rect (u0,v0)-(u1,v1) maps
  // a=(u0,v0) b=(u1,v0) c=(u1,v1) d=(u0,v1). Winding is fixed up to face along n.
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, u0, v0, u1, v1) {
    const ia = this.vertex(ax, ay, az, nx, ny, nz, u0, v0);
    const ib = this.vertex(bx, by, bz, nx, ny, nz, u1, v0);
    const ic = this.vertex(cx, cy, cz, nx, ny, nz, u1, v1);
    const id = this.vertex(dx, dy, dz, nx, ny, nz, u0, v1);
    // Geometric normal of (a,b,c) vs requested normal (in local frame, before transform).
    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;
    const gx = e1y * e2z - e1z * e2y;
    const gy = e1z * e2x - e1x * e2z;
    const gz = e1x * e2y - e1y * e2x;
    if (gx * nx + gy * ny + gz * nz >= 0) {
      this.tri(ia, ib, ic);
      this.tri(ia, ic, id);
    } else {
      this.tri(ia, ic, ib);
      this.tri(ia, id, ic);
    }
  }

  // Vertical wall quad from (ax,az) to (bx,bz) between heights y0..y1, facing the side given by
  // outward normal (nx, nz). u runs u0..u1 along the edge, v = v0..v1.
  wall(ax, az, bx, bz, y0, y1, nx, nz, u0, u1, v0, v1) {
    this.quad(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az, nx, 0, nz, u0, v0, u1, v1);
  }

  // Axis-aligned (in the local frame) box centred on (cx, cz) with base at y0. uvScale = metres per
  // texture tile. Faces: 4 sides + top (+ bottom when `bottom`).
  box(cx, y0, cz, w, h, d, uvScale = 1, bottom = false) {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const y1 = y0 + h;
    const s = 1 / uvScale;
    this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, 0, y0 * s, w * s, y1 * s);
    this.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, 0, y0 * s, w * s, y1 * s);
    this.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, 0, y0 * s, d * s, y1 * s);
    this.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, 0, y0 * s, d * s, y1 * s);
    this.quad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0, x0 * s, z1 * s, x1 * s, z0 * s);
    if (bottom) this.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0, x0 * s, z0 * s, x1 * s, z1 * s);
  }

  // Vertical cylinder (open or capped) centred on (cx, cz), base at y0. u wraps once per `uWrap`
  // tiles around the circumference, v in metres / uvScale.
  cylinder(cx, y0, cz, r, h, segs = 8, uvScale = 1, cap = true, rTop = r) {
    const s = 1 / uvScale;
    const uWrap = Math.max(1, Math.round((2 * Math.PI * r) / uvScale));
    const base = this.vCount;
    const slope = (r - rTop) / h;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const nl = Math.hypot(1, slope);
      this.vertex(cx + c * r, y0, cz + sn * r, c / nl, slope / nl, sn / nl, (i / segs) * uWrap, y0 * s);
      this.vertex(cx + c * rTop, y0 + h, cz + sn * rTop, c / nl, slope / nl, sn / nl, (i / segs) * uWrap, (y0 + h) * s);
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      this.tri(a, a + 1, a + 3);
      this.tri(a, a + 3, a + 2);
    }
    if (cap && rTop > 0.001) {
      const c0 = this.vertex(cx, y0 + h, cz, 0, 1, 0, 0.5, 0.5);
      const ring = this.vCount;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        this.vertex(cx + Math.cos(a) * rTop, y0 + h, cz + Math.sin(a) * rTop, 0, 1, 0, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
      }
      for (let i = 0; i < segs; i++) this.tri(c0, ring + i + 1, ring + i);
    }
  }

  // Square-section beam of width w between two 3D points (struts, legs, masts).
  beam(ax, ay, az, bx, by, bz, w, uvScale = 1) {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    // Side vectors perpendicular to the axis.
    let sx = -dz;
    let sy = 0;
    let sz = dx;
    let sl = Math.hypot(sx, sz);
    if (sl < 1e-4) {
      sx = 1;
      sz = 0;
      sl = 1;
    }
    sx /= sl;
    sz /= sl;
    const tx = dy * sz - dz * sy;
    const ty = dz * sx - dx * sz;
    const tz = dx * sy - dy * sx;
    const h = w / 2;
    const v = len / uvScale;
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let k = 0; k < 4; k++) {
      const [a1, b1] = corners[k];
      const [a2, b2] = corners[(k + 1) % 4];
      const o1x = (sx * a1 + tx * b1) * h;
      const o1y = (sy * a1 + ty * b1) * h;
      const o1z = (sz * a1 + tz * b1) * h;
      const o2x = (sx * a2 + tx * b2) * h;
      const o2y = (sy * a2 + ty * b2) * h;
      const o2z = (sz * a2 + tz * b2) * h;
      const nx = (o1x + o2x) / w;
      const ny = (o1y + o2y) / w;
      const nz = (o1z + o2z) / w;
      this.quad(ax + o1x, ay + o1y, az + o1z, ax + o2x, ay + o2y, az + o2z, bx + o2x, by + o2y, bz + o2z, bx + o1x, by + o1y, bz + o1z, nx, ny, nz, 0, 0, w / uvScale, v);
    }
  }

  // Horizontal polygon (flat [x,z,...] ring, optional holes) at height y facing up or down.
  // UVs are world x/z divided by uvScale (plus offset).
  polygon(ring, holes, y, uvScale = 1, up = true) {
    const tris = triangulate(ring, holes);
    if (!tris) return;
    const all = holes && holes.length ? [ring, ...holes] : [ring];
    const base = this.vCount;
    const s = 1 / uvScale;
    const ny = up ? 1 : -1;
    for (const r of all) {
      for (let i = 0; i < r.length; i += 2) this.vertex(r[i], y, r[i + 1], 0, ny, 0, r[i] * s, -r[i + 1] * s);
    }
    for (let i = 0; i < tris.length; i += 3) {
      const a = base + tris[i];
      const b = base + tris[i + 1];
      const c = base + tris[i + 2];
      // Orient so the face points along ny.
      const p = this.pos;
      const e1x = p[b * 3] - p[a * 3];
      const e1z = p[b * 3 + 2] - p[a * 3 + 2];
      const e2x = p[c * 3] - p[a * 3];
      const e2z = p[c * 3 + 2] - p[a * 3 + 2];
      const gy = e1z * e2x - e1x * e2z;
      if (gy * ny >= 0) this.tri(a, b, c);
      else this.tri(a, c, b);
    }
  }

  // Append all of `other` (a GeoBuffer) transformed by the current transform.
  append(other) {
    const base = this.vCount;
    const saveC = this.brushColor.slice();
    const saveF = this.brushFacade.slice();
    for (let i = 0; i < other.vCount; i++) {
      const p = i * 3;
      const c = i * 4;
      this.brushColor[0] = other.col[c];
      this.brushColor[1] = other.col[c + 1];
      this.brushColor[2] = other.col[c + 2];
      this.brushFacade[0] = other.fac[c];
      this.brushFacade[1] = other.fac[c + 1];
      this.brushFacade[2] = other.fac[c + 2];
      this.brushFacade[3] = other.fac[c + 3];
      this.vertex(
        other.pos[p], other.pos[p + 1], other.pos[p + 2],
        other.nrm[p], other.nrm[p + 1], other.nrm[p + 2],
        other.uv[i * 2], other.uv[i * 2 + 1],
      );
    }
    this._reserve(0, other.iCount);
    for (let i = 0; i < other.iCount; i++) this.idx[this.iCount + i] = other.idx[i] + base;
    this.iCount += other.iCount;
    this.brushColor = saveC;
    this.brushFacade = saveF;
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    const n = this.vCount;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n * 4), 4, true));
    g.setAttribute('facade', new THREE.BufferAttribute(this.fac.slice(0, n * 4), 4, false));
    const idx = n < 65536 ? new Uint16Array(this.idx.subarray(0, this.iCount)) : this.idx.slice(0, this.iCount);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  // World-space, position-only, non-indexed copy of triangles [iStart, iEnd) (for colliders).
  positionsOf(iStart = 0, iEnd = this.iCount) {
    const out = new Float32Array((iEnd - iStart) * 3);
    for (let i = iStart, o = 0; i < iEnd; i++, o += 3) {
      const v = this.idx[i] * 3;
      out[o] = this.pos[v];
      out[o + 1] = this.pos[v + 1];
      out[o + 2] = this.pos[v + 2];
    }
    return out;
  }
}

const _contour = [];
const _holes = [];

// Earcut via THREE.ShapeUtils on flat [x,z,...] rings. Returns flat index triples into the
// concatenation [ring, ...holes], or null.
function triangulate(ring, holes) {
  _contour.length = 0;
  for (let i = 0; i < ring.length; i += 2) _contour.push(new THREE.Vector2(ring[i], ring[i + 1]));
  _holes.length = 0;
  if (holes) {
    for (const h of holes) {
      const pts = [];
      for (let i = 0; i < h.length; i += 2) pts.push(new THREE.Vector2(h[i], h[i + 1]));
      _holes.push(pts);
    }
  }
  let faces;
  try {
    faces = THREE.ShapeUtils.triangulateShape(_contour, _holes);
  } catch {
    return null;
  }
  const out = new Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    out[i * 3] = faces[i][0];
    out[i * 3 + 1] = faces[i][1];
    out[i * 3 + 2] = faces[i][2];
  }
  return out;
}
