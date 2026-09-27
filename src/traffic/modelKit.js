import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Tiny kit for building low-poly vehicles and figures as one merged, vertex-coloured geometry.
// Every vertex carries a `vtag` that the shared vehicle material (vehicleMaterial.js) uses to decide
// what the part is: paint takes the instance colour, lamps light up, banners sample the sticker atlas.
//
// Model space: metres, forward = -z (matches heading 0 = north), up = +y, ground at y = 0,
// origin at the centre of the body. Side profiles are authored as [u, v] = [metres forward, metres up].

export const TAG = {
  FIXED: 0, // vertex colour as is
  PAINT: 1, // vertex colour × instance colour
  HEADLIGHT: 2,
  TAILLIGHT: 3, // tail + brake
  GLASS: 4,
  INDICATOR_L: 5,
  ACCENT: 6, // vertex colour × per-instance second colour (stripes, cargo, trousers)
  INDICATOR_R: 7,
  BANNER: 8, // sticker atlas row A, falls back to the vertex colour
  BANNER_PAINT: 9, // sticker atlas row A, falls back to paint
  SIGN: 10, // sticker atlas row B (bus destination display), glows at night
};

const _c = new THREE.Color();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);

export class ModelBuilder {
  constructor() {
    this.parts = [];
  }

  add(geo, color, tag = TAG.FIXED) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    _c.set(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) _c.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('vtag', new THREE.BufferAttribute(new Float32Array(n).fill(tag), 1));
    this.parts.push(g);
    return g;
  }

  box(sx, sy, sz, x, y, z, color, tag) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(x, y, z);
    return this.add(g, color, tag);
  }

  // Same box mirrored on both sides (x and -x).
  pair(sx, sy, sz, x, y, z, color, tag, tagMirror = tag) {
    this.box(sx, sy, sz, -x, y, z, color, tag);
    this.box(sx, sy, sz, x, y, z, color, tagMirror);
  }

  // Square-section bar from a to b ([x, y, z]); t = thickness across, t2 = thickness up.
  beam(a, b, t, color, tag, t2 = t) {
    _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _v.length();
    const g = new THREE.BoxGeometry(t, t2, len);
    g.applyQuaternion(_q.setFromUnitVectors(_z, _v.normalize()));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    return this.add(g, color, tag);
  }

  cylinder(r, len, x, y, z, color, tag, axis = 'x', segs = 10) {
    const g = new THREE.CylinderGeometry(r, r, len, segs);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    else if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    return this.add(g, color, tag);
  }

  // Side profile (outline from the front-bottom corner going up, over the roof and down to the
  // rear-bottom corner, [u, v] pairs) extruded across `width`. The bottom edge is closed automatically,
  // with a semicircular wheel arch at each {u, r} in `arches`. `taper` narrows the top (tumblehome).
  profile(outline, width, color, tag, { arches = [], bevel = 0.03, taper = 1 } = {}) {
    const shape = new THREE.Shape();
    shape.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i][0], outline[i][1]);
    const vBottom = outline[outline.length - 1][1];
    for (const a of [...arches].sort((p, q) => p.u - q.u)) {
      shape.lineTo(a.u - a.r, vBottom);
      for (let k = 1; k < 8; k++) {
        const ang = Math.PI - (Math.PI * k) / 8;
        shape.lineTo(a.u + a.r * Math.cos(ang), vBottom + a.r * Math.sin(ang));
      }
      shape.lineTo(a.u + a.r, vBottom);
    }
    const depth = Math.max(0.01, width - bevel * 2);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelOffset: -bevel,
      bevelSegments: 1,
      curveSegments: 4,
    });
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -depth / 2, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
    if (taper !== 1) {
      let minY = Infinity;
      let maxY = -Infinity;
      for (const o of outline) {
        minY = Math.min(minY, o[1]);
        maxY = Math.max(maxY, o[1]);
      }
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const f = Math.max(0, Math.min(1, (p.getY(i) - minY) / (maxY - minY || 1)));
        p.setX(i, p.getX(i) * (1 - (1 - taper) * f));
      }
      g.deleteAttribute('normal');
      g.computeVertexNormals();
    }
    return this.add(g, color, tag);
  }

  // Flat quad with 0..1 UVs laid so text reads correctly from outside. facing: front|rear|left|right.
  // `tilt` leans the top of the panel back (front/rear faces) by that many radians.
  panel(w, h, x, y, z, facing, color, tag, tilt = 0) {
    const g = new THREE.PlaneGeometry(w, h);
    if (facing === 'front') {
      g.rotateY(Math.PI);
      if (tilt) g.rotateX(tilt);
    } else if (facing === 'rear') {
      if (tilt) g.rotateX(-tilt);
    } else if (facing === 'left') {
      g.rotateY(-Math.PI / 2);
    } else if (facing === 'right') {
      g.rotateY(Math.PI / 2);
    } else if (facing === 'up') {
      g.rotateX(-Math.PI / 2);
    }
    g.translate(x, y, z);
    return this.add(g, color, tag);
  }

  build() {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Greenhouse helper: x half-width of a tapered cabin at height v.
function cabinHalfWidth(cabin, v) {
  const f = Math.max(0, Math.min(1, (v - cabin.v0) / (cabin.v1 - cabin.v0)));
  return (cabin.width / 2) * (1 - (1 - cabin.taper) * f);
}

// Window pillar along the cabin surface from [u0, v0] to [u1, v1], both sides (painted by default).
export function pillar(b, cabin, u0, v0, u1, v1, t, color = '#ffffff', tag = TAG.PAINT) {
  for (const s of [-1, 1]) {
    const x0 = s * (cabinHalfWidth(cabin, v0) + 0.005);
    const x1 = s * (cabinHalfWidth(cabin, v1) + 0.005);
    b.beam([x0, v0, -u0], [x1, v1, -u1], t, color, tag, t);
  }
}
