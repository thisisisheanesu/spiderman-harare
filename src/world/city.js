import * as THREE from 'three';
import { LayerAtlas } from './atlas.js';
import { paintFacadeLayers } from './facades.js';
import { paintGroundLayers, buildUrbanMask } from './groundTextures.js';
import { createCityUniforms, createFacadeMaterial, createGroundMaterial } from './materials.js';
import { ChunkGrid, planBuilding, emitBuilding } from './buildings.js';
import { buildStreets } from './roads.js';
import { buildGround } from './ground.js';
import { GeoBuffer } from './geoBuffer.js';

const QUALITY = {
  low: { tex: 256, props: 0.5, trees: 0.4, signs: 48 },
  medium: { tex: 512, props: 0.8, trees: 0.7, signs: 96 },
  high: { tex: 512, props: 1, trees: 1, signs: 128 },
};

// City renderer: buildings, streets, parks, trees, street furniture and landmarks, built from the
// map data at load time. Public: group, update(dt), setNight(t), sidewalkPaths
// ([{pts:[x,z,...], width, road (index into data.roads), side (+1 left / -1 right of a->b)}]).
export class City {
  constructor() {
    this.uniforms = createCityUniforms();
    this.sidewalkPaths = [];
  }

  async init(game) {
    this.game = game;
    const data = game.data;
    const world = game.world;
    this.group = new THREE.Group();
    this.group.name = 'city';
    game.scene.add(this.group);
    this.quality = QUALITY[game.quality.level] || QUALITY.high;
    const heightAt = () => 0;

    // Textures: one texture array for everything built (facades, roofs, props, signs) and one for
    // the ground surfaces.
    const facadeAtlas = new LayerAtlas(this.quality.tex);
    const tileW = paintFacadeLayers(facadeAtlas);
    const groundAtlas = new LayerAtlas(this.quality.tex);
    const groundScale = paintGroundLayers(groundAtlas);
    const L = facadeAtlas.index;
    const G = groundAtlas.index;
    const facadeTex = facadeAtlas.build(game.renderer);
    const groundTex = groundAtlas.build(game.renderer);
    const urban = buildUrbanMask(data.buildings, data.meta.bounds);
    this.textureBytes = facadeAtlas.bytes + groundAtlas.bytes;

    this.facadeMat = createFacadeMaterial(facadeTex, this.uniforms, L);
    const ground = (offset) => createGroundMaterial(groundTex, this.uniforms, G, urban, { offset });
    const mats = { base: ground(3), landuse: ground(2), areas: ground(1), paths: ground(0), roads: ground(-1), marks: ground(-2) };

    const chunks = new ChunkGrid();
    const colliders = new Map();
    const colliderFor = (id) => {
      let col = colliders.get(id);
      if (!col) colliders.set(id, (col = new GeoBuffer(64)));
      return col;
    };

    // Buildings.
    const landmarkStyles = new Map((data.meta.landmarks || []).map((l) => [l.key, l.style || {}]));
    const ctx = { game, data, world, L, tileW, G, groundScale, quality: this.quality, landmarkStyles, landmarks: null, heightAt, chunks };
    this.frontages = [];
    for (const b of data.buildings) {
      const spec = planBuilding(b, ctx);
      const f = emitBuilding(b, spec, chunks.at(b.cx, b.cz), colliderFor(b.id), ctx);
      for (const x of f) this.frontages.push(x);
    }

    // Streets and ground.
    const crossingPoints = data.features.filter((f) => f.kind === 'traffic_signals' || f.kind === 'crossing');
    const streets = buildStreets({ ...ctx, crossingPoints });
    this.sidewalkPaths = streets.sidewalkPaths;
    this.crossingNodes = streets.crossingNodes;
    const grounds = buildGround({ ...ctx, skipArea: () => false });

    // Physics for everything that sticks out of the plain footprint extrusions.
    for (const [id, col] of colliders) {
      if (!col.iCount) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(col.positionsOf(), 3));
      world.addCollider(g, id);
    }

    // Meshes.
    this.chunkMeshes = [];
    for (const gb of chunks.map.values()) {
      if (!gb.iCount) continue;
      this.chunkMeshes.push(this._mesh(gb, this.facadeMat, true));
    }
    const { minX, maxX, minZ, maxZ } = data.meta.bounds;
    const pad = 3500;
    const plane = new GeoBuffer(8);
    plane.brush([255, 255, 255], 0, 0, 1);
    plane.quad(minX - pad, 0, maxZ + pad, maxX + pad, 0, maxZ + pad, maxX + pad, 0, minZ - pad, minX - pad, 0, minZ - pad, 0, 1, 0, 0, 0, 1, 1);
    this._mesh(plane, mats.base);
    this._mesh(grounds.landuse, mats.landuse);
    this._mesh(grounds.areas, mats.areas);
    this._mesh(grounds.paths, mats.paths);
    this._mesh(streets.asphalt, mats.roads);
    this._mesh(streets.walks, mats.areas);
    const marks = new GeoBuffer(8);
    marks.append(streets.marks);
    marks.append(grounds.marks);
    this._mesh(marks, mats.marks);

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
  }

  update(dt, game) {
    this.uniforms.uTime.value += dt;
    const pal = game.sky?.palette;
    if (pal && pal.version !== this._palVersion) {
      this._palVersion = pal.version;
      this.uniforms.uSkyZenith.value.copy(pal.zenith);
      this.uniforms.uSkyHorizon.value.copy(pal.horizon);
      this.uniforms.uSkyGround.value.copy(pal.ground);
    }
  }
}
