import * as THREE from 'three';
import { LayerAtlas } from './atlas.js';
import { paintFacadeLayers } from './facades.js';
import { paintGroundLayers, buildUrbanMask } from './groundTextures.js';
import { createCityUniforms, createFacadeMaterial, createGroundMaterial } from './materials.js';
import { ChunkGrid, planBuilding, emitBuilding } from './buildings.js';
import { GeoBuffer } from './geoBuffer.js';

const QUALITY = {
  low: { tex: 256, props: 0.5, trees: 0.4, signs: 48 },
  medium: { tex: 512, props: 0.8, trees: 0.7, signs: 96 },
  high: { tex: 512, props: 1, trees: 1, signs: 128 },
};

// City renderer: buildings, streets, parks, trees, street furniture and landmarks, built from the
// map data at load time. Public: group, update(dt), setNight(t), sidewalkPaths.
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

    // Textures.
    const facadeAtlas = new LayerAtlas(this.quality.tex);
    const tileW = paintFacadeLayers(facadeAtlas);
    const groundAtlas = new LayerAtlas(this.quality.tex);
    this.groundScale = paintGroundLayers(groundAtlas);
    this.L = facadeAtlas.index;
    this.G = groundAtlas.index;
    this.tileW = tileW;
    const facadeTex = facadeAtlas.build(game.renderer);
    const groundTex = groundAtlas.build(game.renderer);
    this.urban = buildUrbanMask(data.buildings, data.meta.bounds);

    this.facadeMat = createFacadeMaterial(facadeTex, this.uniforms, this.L);
    this.groundMats = {
      base: createGroundMaterial(groundTex, this.uniforms, this.G, this.urban, { offset: 2 }),
    };

    // Buildings.
    const chunks = new ChunkGrid();
    const colliders = new Map();
    const landmarkStyles = new Map((data.meta.landmarks || []).map((l) => [l.key, l.style || {}]));
    const ctx = { game, data, world, L: this.L, tileW, quality: this.quality, landmarkStyles, landmarks: null };
    this.frontages = [];
    for (const b of data.buildings) {
      const spec = planBuilding(b, ctx);
      const gb = chunks.at(b.cx, b.cz);
      let col = colliders.get(b.id);
      if (!col) {
        col = new GeoBuffer(64);
        colliders.set(b.id, col);
      }
      const f = emitBuilding(b, spec, gb, col, ctx);
      for (const x of f) this.frontages.push(x);
    }
    for (const [id, col] of colliders) {
      if (!col.iCount) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(col.positionsOf(), 3));
      world.addCollider(g, id);
    }
    this.chunkMeshes = [];
    for (const gb of chunks.map.values()) {
      if (!gb.iCount) continue;
      const mesh = new THREE.Mesh(gb.toGeometry(), this.facadeMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.chunkMeshes.push(mesh);
    }

    // Ground plane.
    const { minX, maxX, minZ, maxZ } = data.meta.bounds;
    const pad = 3500;
    const gp = new GeoBuffer(8);
    gp.brush([255, 255, 255], 0, 0, 1);
    gp.quad(minX - pad, 0, maxZ + pad, maxX + pad, 0, maxZ + pad, maxX + pad, 0, minZ - pad, minX - pad, 0, minZ - pad, 0, 1, 0, 0, 0, 1, 1);
    const ground = new THREE.Mesh(gp.toGeometry(), this.groundMats.base);
    ground.receiveShadow = true;
    ground.matrixAutoUpdate = false;
    this.group.add(ground);

    this.setNight(game.sky?.nightFactor ?? 0);
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
