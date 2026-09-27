import * as THREE from 'three';
import { facadeFragmentDecl, FACADE_MAIN, FACADE_CANYON } from './render/facadeShader.js';
import { groundFragmentDecl, GROUND_MAIN } from './render/groundShader.js';

// Shared uniforms for every city material (updated by City.setNight / City.update and from the
// sky palette). Vegetation reads uTime / uNight.
export function createCityUniforms() {
  return {
    uNight: { value: 0 },
    uTime: { value: 0 },
    uSkyZenith: { value: new THREE.Color(0.25, 0.45, 0.8) },
    uSkyHorizon: { value: new THREE.Color(0.7, 0.72, 0.72) },
    uSkyGround: { value: new THREE.Color(0.12, 0.11, 0.1) },
    uReflect: { value: 0.55 },
    uShutterFrac: { value: 0.2 },
    // x = interior exposure, y = unlit-room level at night, z = daylight on blinds / curtains
    uInterior: { value: new THREE.Vector3(0.5, 0.04, 1) },
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
    // Sunlight bounced up from the street onto soffits (set from the sun each frame).
    uBounce: { value: new THREE.Color(0, 0, 0) },
    // Facade across the street as seen in reflections: sunlit share and shade.
    uCanyonLit: { value: new THREE.Color(0.3, 0.28, 0.25) },
    uCanyonShade: { value: new THREE.Color(0.1, 0.1, 0.11) },
  };
}

const VERT_DECL = /* glsl */ `
attribute vec4 facade;
attribute vec4 pbr;
varying vec4 vFac;
varying vec4 vPbr;
varying vec2 vFacUv;
varying vec3 vWPos;
varying vec3 vWNrm;`;

const VERT_MAIN = /* glsl */ `
vFac = facade;
vPbr = pbr;
vFacUv = uv;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);`;

// Lighting hooks shared by the facade and ground materials: the surface block (injected at
// <color_fragment>) fills sRough, sMetal, sNw (world normal), sEmit, sF0 + sGlass (reflectance of
// glass), sSun (direct light reaching into window recesses) and sAO.
function patchLighting(fs, canyon = '') {
  return fs
    .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${canyon}`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = sRough;')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = sMetal;')
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(sNw, 0.0)).xyz);')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += sEmit;')
    .replace(
      '#include <lights_physical_fragment>',
      `#include <lights_physical_fragment>
material.specularColor = mix(material.specularColor, sF0, sGlass);
material.specularColorBlended = mix(material.specularColorBlended, sF0, sGlass);`,
    )
    .replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
reflectedLight.directDiffuse *= sSun;
reflectedLight.directSpecular *= sSun;
reflectedLight.indirectDiffuse *= sAO;
reflectedLight.indirectSpecular *= mix(1.0, sAO, 0.6);`,
    );
}

// Buildings, props, signs: one MeshStandardMaterial for every city chunk.
// Per-vertex `facade` = [layer, seed, kind + 8 * class, glass preset] and `pbr` = [material,
// accent, extra, flags] (see geoBuffer.js, facades.js):
//   kind 0 = facade (windows; lit rooms at night)   kind 1 = sign (glows at night)
//   kind 2 = plain surface                          kind 3 = working lamp (emissive at night)
//   kind 4 = backlit panel (billboards)
//   class 0 office, 1 residential/hotel, 2 shop, 3 other, 4 never lit (water, solar panels).
// res = {pbr (PbrSet), interiors ({tex}), noise (Texture)}
export function createFacadeMaterial(map, uniforms, layers, res) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  const normals = !!res.pbr.texB;
  const interiors = !!res.interiors;
  const decl = facadeFragmentDecl(res.pbr, { normals, interiors });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.facadeMap = { value: map };
    shader.uniforms.pbrA = { value: res.pbr.texA };
    if (normals) shader.uniforms.pbrB = { value: res.pbr.texB };
    shader.uniforms.interiorMap = { value: res.interiors?.tex || null };
    shader.uniforms.noiseMap = { value: res.noise };
    shader.uniforms.urbanMap = { value: res.urban.texture };
    shader.uniforms.urbanRect = { value: res.urban.rect };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = patchLighting(
      shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${decl}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FACADE_MAIN}`),
      FACADE_CANYON,
    );
  };
  mat.customProgramCacheKey = () => `city-facade-4${normals ? 'n' : ''}${interiors ? 'i' : ''}`;
  return mat;
}

// Ground surfaces (roads, pavements, kerbs, grass, soil, rail ballast): the ground PBR set, with
// large-scale variation, asphalt patches and cracks, worn paint. See render/groundShader.js.
export function createGroundMaterial(map, uniforms, layers, urban, opts = {}) {
  const res = opts.res;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    polygonOffset: !!opts.offset,
    polygonOffsetFactor: opts.offset || 0,
    polygonOffsetUnits: opts.offset || 0,
  });
  const normals = !!res.ground.texB;
  const decl = groundFragmentDecl(res.ground, layers, { normals });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.groundMap = { value: map };
    shader.uniforms.gPbrA = { value: res.ground.texA };
    if (normals) shader.uniforms.gPbrB = { value: res.ground.texB };
    shader.uniforms.noiseMap = { value: res.noise };
    shader.uniforms.urbanMap = { value: urban.texture };
    shader.uniforms.urbanRect = { value: urban.rect };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = patchLighting(
      shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${decl}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${GROUND_MAIN}`),
    );
  };
  mat.customProgramCacheKey = () => `city-ground-3${normals ? 'n' : ''}`;
  return mat;
}
