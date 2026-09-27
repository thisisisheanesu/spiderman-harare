import * as THREE from 'three';
import { LayerAtlas } from './atlas.js';
import { paintFacadeLayers } from './facades.js';
import { paintGroundLayers, buildUrbanMask } from './groundTextures.js';
import { createCityUniforms, createFacadeMaterial, createGroundMaterial } from './materials.js';
import { ChunkGrid, CHUNK, planBuilding, emitBuilding } from './buildings.js';
import { buildStreets, StreetIndex, CarriagewayIndex } from './roads.js';
import { buildGround } from './ground.js';
import { GeoBuffer } from './geoBuffer.js';
import { planTrees, createVegetation } from './vegetation.js';
import { SignPainter, emitSign } from './signs.js';
import { buildProps } from './props.js';
import { Landmarks } from './landmarks.js';
import { Kopje } from './terrain.js';
import { createFlame, createFountainJets } from './effects.js';
import { treeHeight } from './treeModels.js';
import { PointGrid } from './pointGrid.js';
import { PbrSet, FACADE_SET, FACADE_SET_LOW, GROUND_SET, GROUND_SET_LOW, loadInteriors } from './render/pbrLibrary.js';
import { makeNoiseTexture } from './render/noise.js';
import { AO_LAYER } from '../core/postfx.js';
import { createCanopyFade, applyCanopyFade } from './render/canopyFade.js';

// tex: canvas layers (signs, painted artwork); pbr: PBR texture-array size; compress: size of
// the block-compressed arrays used instead when the GPU has S3TC + RGTC (desktop); normals: normal /
// AO / metalness array; smallInteriors: the 1024 x 512 interior atlas.
const QUALITY = {
  low: { tex: 256, props: 0.5, trees: 0.4, signs: 48, pbr: 512, normals: false, smallInteriors: true, low: true },
  medium: { tex: 384, props: 0.8, trees: 0.7, signs: 80, pbr: 512, normals: true, smallInteriors: true },
  high: { tex: 384, props: 1, trees: 1, signs: 112, pbr: 512, compress: 1024, normals: true, smallInteriors: false },
};

const NONE = [];

// City renderer: buildings, streets, parks, trees, street furniture and landmarks, built from the
// map data at load time.
// Public: group, update(dt), setNight(t), sidewalkPaths
//   ([{pts: [x,z,...], width, road (index into data.roads), side (+1 left / -1 right of a->b)}]),
//   heightAt(x, z) (visual ground height: 0 except on the Kopje), crossingNodes (Set of node
//   indices with zebra crossings + stop lines),
//   obstacles ([{x, z, r}] street-level solids: lamp posts, street trees, benches, bins, bollards,
//   planters, shelter posts/benches, verandah posts, billboard legs, statue, fountain),
//   obstaclesNear(x, z, r) / anchorsNear(x, z, r) (shared result arrays, see below).
export class City {
  constructor() {
    this.uniforms = createCityUniforms();
    this.sidewalkPaths = [];
    this.crossingNodes = new Set();
    this.obstacles = [];
    this.anchors = [];
    this.heightAt = () => 0;
  }

  // Obstacles whose circle reaches within r of (x, z). The returned array is shared and
  // overwritten by the next call (copy what you keep); no allocation per call.
  obstaclesNear(x, z, r) {
    return this._obstacleGrid ? this._obstacleGrid.near(x, z, r) : NONE;
  }

  // Web anchor points {x, y, z} within r (horizontal) of (x, z): tops of tall trees (crown,
  // >= 7 m) and streetlight pole tops (9-10 m), for swinging where there are no tall buildings.
  // Shared result array, overwritten by the next call.
  anchorsNear(x, z, r) {
    return this._anchorGrid ? this._anchorGrid.near(x, z, r) : NONE;
  }

  async init(game) {
    this.game = game;
    const t0 = performance.now();
    this.timings = {};
    const data = game.data;
    const world = game.world;
    this.group = new THREE.Group();
    this.group.name = 'city';
    game.scene.add(this.group);
    const quality = (this.quality = QUALITY[game.quality.level] || QUALITY.high);

    const kopje = new Kopje(data, quality);
    this.heightAt = kopje.heightAt;
    const roadHeightAt = (x, z) => kopje.roadHeightAt(x, z);
    const skipArea = (a) => a === kopje.area;

    // Textures. PBR materials (public/textures) load in the background while the geometry is built:
    // one set of texture arrays for everything built (walls, roofs, frames, glass, props) and one for
    // the ground. Canvas layers hold signs and painted landmark artwork.
    const assets = game.assets;
    const facadeSet = new PbrSet(quality.low ? FACADE_SET_LOW : FACADE_SET, { size: quality.pbr, normals: quality.normals });
    const groundSet = new PbrSet(quality.low ? GROUND_SET_LOW : GROUND_SET, { size: quality.pbr, normals: quality.normals });
    const texturesReady = assets.json('textures/materials.json').then((man) =>
      Promise.all([
        facadeSet.load(assets, man, game.renderer, { compressSize: quality.compress || 0 }),
        groundSet.load(assets, man, game.renderer, { compressSize: quality.compress || 0 }),
      ]),
    );
    const interiorsReady = loadInteriors(assets, quality.smallInteriors).catch((err) => {
      console.warn('[city] interior atlas unavailable', err);
      return null;
    });
    const facadeAtlas = new LayerAtlas(quality.tex);
    const tileW = paintFacadeLayers(facadeAtlas);
    const signs = new SignPainter(facadeAtlas, quality.signs);
    const groundAtlas = new LayerAtlas(Math.min(256, quality.tex));
    const { G, scale: groundScale } = paintGroundLayers(groundAtlas, groundSet);
    const L = facadeAtlas.index;
    const urban = buildUrbanMask(data.buildings, data.meta.bounds);
    // Real businesses (data/shops.json, optional): ground-floor bays show the right kind of shop.
    const shopsData = await assets.json('data/shops.json');
    const shopsByBuilding = new Map();
    for (const sh of shopsData?.shops || []) {
      if (sh.b === undefined || sh.b < 0) continue;
      let list = shopsByBuilding.get(sh.b);
      if (!list) shopsByBuilding.set(sh.b, (list = []));
      list.push(sh);
    }

    // Fine chunks over the CBD core (core buildings' extent + a margin), coarse ones outside.
    let core = null;
    for (const b of data.buildings) {
      if (!b.core || b.cx === undefined) continue;
      core = core || { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      core.minX = Math.min(core.minX, b.cx);
      core.maxX = Math.max(core.maxX, b.cx);
      core.minZ = Math.min(core.minZ, b.cz);
      core.maxZ = Math.max(core.maxZ, b.cz);
    }
    if (core) {
      // Snap to the fine grid so coarse cells never cut through a fine one.
      const snap = (v, up) => (up ? Math.ceil((v + 150) / CHUNK) : Math.floor((v - 150) / CHUNK)) * CHUNK;
      core = { minX: snap(core.minX, false), maxX: snap(core.maxX, true), minZ: snap(core.minZ, false), maxZ: snap(core.maxZ, true) };
    }
    const chunks = new ChunkGrid(CHUNK, core);
    const colliders = new Map();
    const colliderFor = (id) => {
      let col = colliders.get(id);
      if (!col) colliders.set(id, (col = new GeoBuffer(64)));
      return col;
    };

    // Buildings (+ landmark details).
    const landmarks = new Landmarks(data, signs);
    const landmarkStyles = new Map((data.meta.landmarks || []).map((l) => [l.key, l.style || {}]));
    const ctx = {
      game, data, world, L, tileW, G, groundScale, quality, landmarkStyles, landmarks, chunks, pbr: facadeSet, shopsByBuilding,
      streets: new StreetIndex(data), carriageways: new CarriagewayIndex(data.roads), obstacles: [],
    };
    const frontages = [];
    const emit = (b, extra) => {
      const spec = planBuilding(b, ctx);
      Object.assign(spec, extra);
      for (const f of emitBuilding(b, spec, chunks.at(b.cx, b.cz), chunks.detailAt(b.cx, b.cz), colliderFor(b.id), ctx)) frontages.push(f);
    };
    for (const b of data.buildings) emit(b);

    // Streets, ground, the Kopje.
    const crossingPoints = data.features.filter((f) => f.kind === 'traffic_signals' || f.kind === 'crossing');
    const streets = buildStreets({ ...ctx, heightAt: roadHeightAt, crossingPoints, densify: (pts) => kopje.touches(pts), urbanAt: urban.at });
    this.sidewalkPaths = streets.sidewalkPaths;
    this.crossingNodes = streets.crossingNodes;
    const grounds = buildGround({ ...ctx, heightAt: roadHeightAt, skipArea });
    const hill = new GeoBuffer(1 << 15);
    const summit = kopje.summit();
    world.addCollider(kopje.build(hill, G, groundScale, chunks.at(summit.x, summit.z), L, quality), -3);
    landmarks.extras(chunks, colliderFor, L, emit, grounds.paths, G, world);

    // Signs, street furniture, trees.
    for (const pl of signs.assign(frontages, data.pois)) {
      const f = pl.frontage;
      emitSign(chunks.detailAt(f.ax, f.az), pl);
    }
    const props = buildProps({ ...ctx, colliderFor, sidewalkPaths: this.sidewalkPaths, medians: streets.medians, urbanAt: urban.at, frontages, signs, heightAt: this.heightAt });
    const trees = planTrees({ ...ctx, sidewalkPaths: this.sidewalkPaths, urbanAt: urban.at, heightAt: this.heightAt });
    const allTrees = trees.concat(landmarks.palms, props.palms);
    const vegStart = this.group.children.length;
    this.vegetation = createVegetation(this.group, allTrees, this.uniforms, quality, !!game.quality.shadows, game.quality.drawDistance || 2500);
    // Canopies near the camera / in front of Spider-Man dissolve (render/canopyFade.js).
    const foliage = new Set();
    for (const o of this.group.children.slice(vegStart)) {
      const m = o.material;
      if (m && !Array.isArray(m) && m.alphaTest > 0 && !m.transparent) foliage.add(m);
    }
    this.canopyFade = createCanopyFade();
    applyCanopyFade(foliage, this.canopyFade);

    // Pedestrian obstacles and low-rise web anchors (spatial grids built once).
    const obstacles = ctx.obstacles.concat(landmarks.obstacles, props.obstacles);
    const anchors = props.anchors;
    for (const t of allTrees) {
      if (!t.planted) obstacles.push({ x: t.x, z: t.z, r: 0.3 * t.s });
      const h = treeHeight(t.species) * t.s;
      if (h >= 7) anchors.push({ x: t.x, y: t.y + h - 0.5, z: t.z });
    }
    this.obstacles = obstacles;
    this.anchors = anchors;
    this._obstacleGrid = new PointGrid(obstacles, 24);
    this._anchorGrid = new PointGrid(anchors, 32);

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
    this.timings.geometry = Math.round(performance.now() - t0);
    const tTex = performance.now();
    await texturesReady;
    const interiors = await interiorsReady;
    const noise = makeNoiseTexture();
    this.textureBytes = facadeAtlas.bytes + groundAtlas.bytes + facadeSet.bytes + groundSet.bytes + (interiors?.bytes || 0) + noise.bytes;
    this.textureReport = {
      canvasFacade: facadeAtlas.bytes, canvasGround: groundAtlas.bytes, pbrFacade: facadeSet.bytes, pbrGround: groundSet.bytes,
      interiors: interiors?.bytes || 0, noise: noise.bytes,
    };
    this.facadeMat = createFacadeMaterial(facadeTex, this.uniforms, L, { pbr: facadeSet, interiors, noise, urban });
    const ground = (offset) => createGroundMaterial(groundTex, this.uniforms, G, urban, { offset, res: { ground: groundSet, noise } });
    const mats = { base: ground(3), landuse: ground(2), areas: ground(1), paths: ground(0), roads: ground(-1), marks: ground(-2) };

    this.chunks = [];
    for (const e of chunks.map.values()) {
      const base = this._mesh(e.base, this.facadeMat, true);
      const detail = this._mesh(e.detail, this.facadeMat, true);
      if (base || detail) this.chunks.push({ base, detail, x: e.cx, z: e.cz, half: e.half });
    }
    // Rooftop clutter, parapet caps, canopies, signs and furniture vanish into sub-pixel detail
    // well before this on a phone screen; each detail chunk is a draw call and ~25k triangles.
    this.detailRange = game.quality.level === 'low' ? 300 : 520;
    const { minX, maxX, minZ, maxZ } = data.meta.bounds;
    const pad = 3500;
    const plane = new GeoBuffer(8);
    plane.brush([255, 255, 255], 0, 0, 1);
    plane.quad(minX - pad, 0, maxZ + pad, maxX + pad, 0, maxZ + pad, maxX + pad, 0, minZ - pad, minX - pad, 0, minZ - pad, 0, 1, 0, 0, 0, 1, 1);
    this._mesh(plane, mats.base);
    this._mesh(grounds.landuse, mats.landuse);
    this._mesh(hill, mats.landuse, true);
    // Pavements share the areas material: one draw call for both.
    grounds.areas.append(streets.walks);
    this._mesh(grounds.areas, mats.areas);
    this._mesh(grounds.paths, mats.paths);
    this._mesh(streets.asphalt, mats.roads);
    streets.marks.append(grounds.marks);
    this._mesh(streets.marks, mats.marks);

    this.lightPools = props.lightPools;
    this.group.add(this.lightPools);
    this.effects = [createFlame(kopje.flamePos)];
    const fountain = data.features.find((f) => f.kind === 'fountain');
    if (fountain && landmarks.jets.iCount) this.effects.push(createFountainJets(landmarks.jets.toGeometry(), fountain));
    for (const fx of this.effects) this.group.add(fx.mesh);

    this.timings.textureWait = Math.round(performance.now() - tTex);
    this.timings.total = Math.round(performance.now() - t0);
    this.setNight(game.sky?.nightFactor ?? 0);
  }

  _mesh(gb, material, castShadow = false) {
    if (!gb.iCount) return null;
    const mesh = new THREE.Mesh(gb.toGeometry(), material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    // City geometry is what the screen-space ambient occlusion prepass draws (core/postfx.js).
    mesh.layers.enable(AO_LAYER);
    this.group.add(mesh);
    return mesh;
  }

  // Called by the sky whenever the time of day changes (also while paused, from the settings).
  setNight(t) {
    const u = this.uniforms;
    u.uNight.value = t;
    u.uShutterFrac.value = 0.18 + 0.5 * t;
    // Rooms behind the glass: dim by day (the street is far brighter), lit ones glow at night.
    u.uInterior.value.set(THREE.MathUtils.lerp(0.42, 1.15, t), 0.035, 1 - 0.85 * t);
    const dir = this.game?.sky?.lightDirection;
    if (dir) u.uSunDir.value.copy(dir);
    if (this.lightPools) {
      this.lightPools.material.opacity = 0.85 * t;
      this.lightPools.visible = t > 0.02;
    }
    const pal = this.game?.sky?.palette;
    if (pal) {
      u.uSkyZenith.value.copy(pal.zenith);
      u.uSkyHorizon.value.copy(pal.horizon);
      u.uSkyGround.value.copy(pal.ground);
    }
  }

  update(dt, game) {
    this.uniforms.uTime.value += dt;
    const sky = game.sky;
    const ld = sky?.lightDirection;
    if (ld) this.uniforms.uSunDir.value.copy(ld);
    if (sky?.sun) {
      const u = this.uniforms;
      const sunUp = Math.max(0, sky.sunDirection.y);
      u.uBounce.value.copy(sky.sun.color).multiplyScalar(sky.sun.intensity * sunUp * 0.05);
      u.uCanyonLit.value.copy(sky.sun.color).multiplyScalar(sky.sun.intensity * 0.28 * THREE.MathUtils.smoothstep(sky.sunDirection.y, -0.02, 0.1));
      const hemi = sky.hemi;
      if (hemi) u.uCanyonShade.value.copy(hemi.color).lerp(hemi.groundColor, 0.4).multiplyScalar(0.3 * (sky.nightFactor > 0.5 ? 0.4 : 1));
    }
    const cam = game.camera.position;
    this.vegetation.update(cam);
    const fade = this.canopyFade;
    if (fade) {
      fade.uFadeCam.value.copy(cam);
      const p = game.player?.position;
      if (p) fade.uFadeTarget.value.set(p.x, p.y + 1.1, p.z);
      else fade.uFadeTarget.value.copy(cam);
    }
    // Chunk LOD: drop the detail layer away from the camera and whole chunks beyond the fog.
    const fogFar = game.scene.fog?.far ?? 3000;
    // The key light's shadow box spans about +-shadowSize around a focus just ahead of the player,
    // so only chunks near the camera can cast into it: street-level detail from close by, whole
    // buildings from as far as the tallest tower's shadow reaches at the current light elevation.
    // The rest would only add whole-chunk draws (tens of thousands of triangles) to the shadow pass.
    const shadows = sky?.sun?.castShadow;
    const reach = (sky?.shadowSize ?? 110) * 1.6;
    const ly = Math.min(0.999, Math.max(0.05, sky?.lightDirection?.y ?? 1));
    const reachBase = reach + Math.min(450, (125 * Math.sqrt(1 - ly * ly)) / ly); // 125 m tower / tan(elevation)
    for (const c of this.chunks) {
      const half = c.half;
      const far = fogFar + half;
      const dx = Math.max(0, Math.abs(cam.x - c.x) - half);
      const dz = Math.max(0, Math.abs(cam.z - c.z) - half);
      const d = Math.hypot(dx, dz);
      if (c.base) {
        c.base.visible = d < far;
        if (shadows) c.base.castShadow = d < reachBase;
      }
      if (c.detail) {
        c.detail.visible = d < this.detailRange;
        if (shadows) c.detail.castShadow = d < reach;
      }
    }
    for (const fx of this.effects) fx.update(this.uniforms.uTime.value);
  }
}
