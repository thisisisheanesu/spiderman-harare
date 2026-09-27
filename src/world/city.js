import * as THREE from 'three';
import { LayerAtlas } from './atlas.js';
import { paintFacadeLayers } from './facades.js';
import { paintGroundLayers, buildUrbanMask } from './groundTextures.js';
import { createCityUniforms, createFacadeMaterial, createGroundMaterial } from './materials.js';
import { ChunkGrid, CHUNK, planBuilding, emitBuilding } from './buildings.js';
import { buildStreets, StreetIndex } from './roads.js';
import { buildGround } from './ground.js';
import { GeoBuffer } from './geoBuffer.js';
import { planTrees, createVegetation } from './vegetation.js';
import { SignPainter, emitSign } from './signs.js';
import { buildProps } from './props.js';
import { Landmarks } from './landmarks.js';
import { Kopje, createFlame } from './terrain.js';

const QUALITY = {
  low: { tex: 256, props: 0.5, trees: 0.4, signs: 48 },
  medium: { tex: 384, props: 0.8, trees: 0.7, signs: 80 },
  high: { tex: 384, props: 1, trees: 1, signs: 112 },
};

// City renderer: buildings, streets, parks, trees, street furniture and landmarks, built from the
// map data at load time.
// Public: group, update(dt), setNight(t), sidewalkPaths
//   ([{pts: [x,z,...], width, road (index into data.roads), side (+1 left / -1 right of a->b)}]),
//   heightAt(x, z) (visual ground height: 0 except on the Kopje), crossingNodes (Set of node
//   indices with zebra crossings + stop lines).
export class City {
  constructor() {
    this.uniforms = createCityUniforms();
    this.sidewalkPaths = [];
    this.crossingNodes = new Set();
    this.heightAt = () => 0;
  }

  async init(game) {
    this.game = game;
    const data = game.data;
    const world = game.world;
    this.group = new THREE.Group();
    this.group.name = 'city';
    game.scene.add(this.group);
    const quality = (this.quality = QUALITY[game.quality.level] || QUALITY.high);
    const T0 = performance.now(); const tick = (l) => console.info(`[city] ${l} ${Math.round(performance.now() - T0)}ms`);

    const kopje = new Kopje(data);
    this.heightAt = kopje.heightAt;
    const roadHeightAt = (x, z) => kopje.roadHeightAt(x, z);
    const skipArea = (a) => a === kopje.area;

    // Textures: one texture array for everything built (facades, roofs, props, signs, billboards)
    // and one for the ground surfaces.
    const facadeAtlas = new LayerAtlas(quality.tex);
    const tileW = paintFacadeLayers(facadeAtlas);
    const signs = new SignPainter(facadeAtlas, quality.signs);
    const groundAtlas = new LayerAtlas(quality.tex);
    const groundScale = paintGroundLayers(groundAtlas);
    const L = facadeAtlas.index;
    const G = groundAtlas.index;
    const urban = buildUrbanMask(data.buildings, data.meta.bounds);
    tick('textures');

    const chunks = new ChunkGrid();
    const colliders = new Map();
    const colliderFor = (id) => {
      let col = colliders.get(id);
      if (!col) colliders.set(id, (col = new GeoBuffer(64)));
      return col;
    };

    // Buildings (+ landmark details).
    const landmarks = new Landmarks(data);
    const landmarkStyles = new Map((data.meta.landmarks || []).map((l) => [l.key, l.style || {}]));
    const ctx = { game, data, world, L, tileW, G, groundScale, quality, landmarkStyles, landmarks, chunks, streets: new StreetIndex(data) };
    const frontages = [];
    const emit = (b, extra) => {
      const spec = planBuilding(b, ctx);
      Object.assign(spec, extra);
      for (const f of emitBuilding(b, spec, chunks.at(b.cx, b.cz), chunks.detailAt(b.cx, b.cz), colliderFor(b.id), ctx)) frontages.push(f);
    };
    for (const b of data.buildings) emit(b);
    tick('buildings');

    // Streets, ground, the Kopje.
    const crossingPoints = data.features.filter((f) => f.kind === 'traffic_signals' || f.kind === 'crossing');
    const streets = buildStreets({ ...ctx, heightAt: roadHeightAt, crossingPoints, densify: (pts) => kopje.touches(pts) });
    this.sidewalkPaths = streets.sidewalkPaths;
    this.crossingNodes = streets.crossingNodes;
    const grounds = buildGround({ ...ctx, heightAt: roadHeightAt, skipArea });
    const hill = new GeoBuffer(1 << 15);
    const summit = kopje.summit();
    world.addCollider(kopje.build(hill, G, groundScale, chunks.at(summit.x, summit.z), L, quality), -3);
    landmarks.extras(chunks, colliderFor, L, emit, grounds.paths, G);
    tick('streets');

    // Signs, street furniture, trees.
    for (const pl of signs.assign(frontages, data.pois)) {
      const f = pl.frontage;
      emitSign(chunks.detailAt(f.ax, f.az), pl);
    }
    const props = buildProps({ ...ctx, colliderFor, sidewalkPaths: this.sidewalkPaths, urbanAt: urban.at, frontages, signs, heightAt: this.heightAt });
    const trees = planTrees({ ...ctx, sidewalkPaths: this.sidewalkPaths, urbanAt: urban.at, heightAt: this.heightAt });
    this.vegetation = createVegetation(this.group, trees, landmarks.palms, this.uniforms, quality, !!game.quality.shadows, game.quality.drawDistance || 2500);
    tick('props+trees');

    // Physics for everything that sticks out of the plain footprint extrusions.
    for (const [id, col] of colliders) {
      if (!col.iCount) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(col.positionsOf(), 3));
      world.addCollider(g, id);
    }

    // Materials + meshes.
    const facadeTex = facadeAtlas.build(game.renderer);
    const groundTex = groundAtlas.build(game.renderer);
    this.textureBytes = facadeAtlas.bytes + groundAtlas.bytes;
    this.facadeMat = createFacadeMaterial(facadeTex, this.uniforms, L);
    const ground = (offset) => createGroundMaterial(groundTex, this.uniforms, G, urban, { offset });
    const mats = { base: ground(3), landuse: ground(2), areas: ground(1), paths: ground(0), roads: ground(-1), marks: ground(-2) };

    this.chunks = [];
    for (const e of chunks.map.values()) {
      const base = this._mesh(e.base, this.facadeMat, true);
      const detail = this._mesh(e.detail, this.facadeMat, true);
      if (base || detail) this.chunks.push({ base, detail, x: e.cx, z: e.cz });
    }
    this.detailRange = game.quality.level === 'low' ? 380 : 560;
    const { minX, maxX, minZ, maxZ } = data.meta.bounds;
    const pad = 3500;
    const plane = new GeoBuffer(8);
    plane.brush([255, 255, 255], 0, 0, 1);
    plane.quad(minX - pad, 0, maxZ + pad, maxX + pad, 0, maxZ + pad, maxX + pad, 0, minZ - pad, minX - pad, 0, minZ - pad, 0, 1, 0, 0, 0, 1, 1);
    this._mesh(plane, mats.base);
    this._mesh(grounds.landuse, mats.landuse);
    this._mesh(hill, mats.landuse, true);
    this._mesh(grounds.areas, mats.areas);
    this._mesh(grounds.paths, mats.paths);
    this._mesh(streets.asphalt, mats.roads);
    this._mesh(streets.walks, mats.areas);
    streets.marks.append(grounds.marks);
    this._mesh(streets.marks, mats.marks);

    this.lightPools = props.lightPools;
    this.group.add(this.lightPools);
    this.flame = createFlame(kopje.flamePos);
    this.group.add(this.flame.mesh);
    tick('meshes');

    this.setNight(game.sky?.nightFactor ?? 0);
  }

  _mesh(gb, material, castShadow = false) {
    if (!gb.iCount) return null;
    const mesh = new THREE.Mesh(gb.toGeometry(), material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    return mesh;
  }

  setNight(t) {
    this.uniforms.uNight.value = t;
    this.uniforms.uShutterFrac.value = 0.18 + 0.5 * t;
    if (this.lightPools) {
      this.lightPools.material.opacity = 0.85 * t;
      this.lightPools.visible = t > 0.02;
    }
  }

  update(dt, game) {
    this.uniforms.uTime.value += dt;
    const cam = game.camera.position;
    this.vegetation.update(cam);
    // Chunk LOD: drop the detail layer away from the camera and whole chunks beyond the fog.
    const half = CHUNK / 2;
    const far = (game.scene.fog?.far ?? 3000) + half;
    for (const c of this.chunks) {
      const dx = Math.max(0, Math.abs(cam.x - c.x) - half);
      const dz = Math.max(0, Math.abs(cam.z - c.z) - half);
      const d = Math.hypot(dx, dz);
      if (c.base) c.base.visible = d < far;
      if (c.detail) c.detail.visible = d < this.detailRange;
    }
    this.flame.update(this.uniforms.uTime.value);
    const pal = game.sky?.palette;
    if (pal && pal.version !== this._palVersion) {
      this._palVersion = pal.version;
      this.uniforms.uSkyZenith.value.copy(pal.zenith);
      this.uniforms.uSkyHorizon.value.copy(pal.horizon);
      this.uniforms.uSkyGround.value.copy(pal.ground);
    }
  }
}
