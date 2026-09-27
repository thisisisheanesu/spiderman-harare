import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hashString, makeRng } from '../core/rng.js';

// Baseline city renderer: flat-shaded extrusions of every building, road ribbons and park areas.
// (Placeholder visuals — the full city renderer replaces this file.)
export class City {
  async init(game) {
    this.game = game;
    const data = game.data;
    this.group = new THREE.Group();
    this.group.name = 'city';
    game.scene.add(this.group);

    const geos = [];
    const color = new THREE.Color();
    for (const b of data.buildings) {
      const shape = new THREE.Shape();
      for (let i = 0; i < b.fp.length; i += 2) {
        const x = b.fp[i];
        const y = -b.fp[i + 1];
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      const h = Math.max(b.h - (b.minH || 0), 0.5);
      const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      g.translate(0, b.minH || 0, 0);
      const rng = makeRng(hashString(String(b.oid || b.id)));
      color.setHSL(0.08 + rng() * 0.05, 0.15 + rng() * 0.2, 0.55 + rng() * 0.25);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) color.toArray(col, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.deleteAttribute('uv');
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Ground.
    const { minX, maxX, minZ, maxZ } = data.meta.bounds;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(maxX - minX + 4000, maxZ - minZ + 4000),
      new THREE.MeshStandardMaterial({ color: '#b9a88a', roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((minX + maxX) / 2, -0.02, (minZ + maxZ) / 2);
    ground.receiveShadow = true;
    this.group.add(ground);

    // Roads as flat ribbons.
    const roadGeos = [];
    for (const r of data.roads) {
      const pts = r.pts;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const ax = pts[i];
        const az = pts[i + 1];
        const bx = pts[i + 2];
        const bz = pts[i + 3];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.01) continue;
        const g = new THREE.PlaneGeometry(r.w, len + r.w * 0.5);
        g.rotateX(-Math.PI / 2);
        g.rotateY(Math.atan2(bx - ax, bz - az));
        g.translate((ax + bx) / 2, 0.02, (az + bz) / 2);
        roadGeos.push(g);
      }
    }
    if (roadGeos.length) {
      const roads = new THREE.Mesh(mergeGeometries(roadGeos), new THREE.MeshStandardMaterial({ color: '#4a4a4f', roughness: 0.95 }));
      roads.receiveShadow = true;
      this.group.add(roads);
      roadGeos.forEach((g) => g.dispose());
    }

    // Parks and grass.
    const areaGeos = [];
    for (const a of data.areas) {
      if (!['park', 'grass', 'pitch', 'wood', 'golf'].includes(a.kind)) continue;
      const shape = new THREE.Shape();
      for (let i = 0; i < a.pts.length; i += 2) {
        if (i === 0) shape.moveTo(a.pts[i], -a.pts[i + 1]);
        else shape.lineTo(a.pts[i], -a.pts[i + 1]);
      }
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0.03, 0);
      areaGeos.push(g);
    }
    if (areaGeos.length) {
      const parks = new THREE.Mesh(mergeGeometries(areaGeos), new THREE.MeshStandardMaterial({ color: '#7fa65a', roughness: 1 }));
      parks.receiveShadow = true;
      this.group.add(parks);
    }
  }
}
