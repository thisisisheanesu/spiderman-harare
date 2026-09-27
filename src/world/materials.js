import * as THREE from 'three';
import { GLASS_PRESETS } from './facades.js';

// Shared uniforms for every city material (updated by City.setNight and from the sky palette).
export function createCityUniforms() {
  return {
    uNight: { value: 0 },
    uTime: { value: 0 },
    uSkyZenith: { value: new THREE.Color(0.25, 0.45, 0.8) },
    uSkyHorizon: { value: new THREE.Color(0.7, 0.72, 0.72) },
    uSkyGround: { value: new THREE.Color(0.12, 0.11, 0.1) },
    uReflect: { value: 0.55 },
    uShutterFrac: { value: 0.2 },
  };
}

const HASH = /* glsl */ `
float cityHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

// Buildings, props, signs: MeshStandardMaterial sampling the facade texture array.
// Per-vertex `facade` = [layer, seed, kind + 8 * class, glass preset]:
//   kind 0 = facade (glass panes reflect the sky, random windows light up at night)
//   kind 1 = sign (its texture glows at night)       kind 2 = plain surface (no glass)
//   kind 3 = working lamp (emissive at night)        kind 4 = backlit panel (billboards)
//   class 0 office, 1 residential/hotel, 2 shop, 3 other, 4 never lit (water, solar panels).
export function createFacadeMaterial(map, uniforms, layers) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  const glass = GLASS_PRESETS.map((c) => new THREE.Vector3(...c));
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.facadeMap = { value: map };
    shader.uniforms.uGlass = { value: glass };
    shader.uniforms.uShopLayer = { value: layers.shop };
    shader.uniforms.uShutterLayer = { value: layers.shutter };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 facade;
varying vec4 vFac;
varying vec2 vFacUv;
varying float vWorldY;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFac = facade;
vFacUv = uv;
vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray facadeMap;
uniform float uNight;
uniform float uReflect;
uniform float uShutterFrac;
uniform float uShopLayer;
uniform float uShutterLayer;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGround;
uniform vec3 uGlass[8];
varying vec4 vFac;
varying vec2 vFacUv;
varying float vWorldY;
${HASH}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.a = 1.0;
float fKind = floor(mod(vFac.z + 0.5, 8.0));
float fCls = floor((vFac.z + 0.5) / 8.0);
vec2 fCell = floor(vFacUv + 1e-3);
float fSeed = vFac.y * 0.137;
float fR1 = cityHash(fCell * vec2(1.0, 1.73) + fSeed);
float fR2 = cityHash(fCell.yx * 1.31 + fSeed * 3.1 + 11.0);
float fR3 = cityHash(fCell * 0.71 + fSeed * 5.3 + 47.0);
float fLayer = vFac.x;
// Street-level shops: some bays have their roller shutters down (more at night).
if (abs(fLayer - uShopLayer) < 0.5 && fR3 < uShutterFrac) fLayer = uShutterLayer;
vec4 fTex = texture(facadeMap, vec3(vFacUv, fLayer));
float isFacade = 1.0 - step(0.5, fKind);
float fGlass = isFacade * smoothstep(0.44, 0.6, fTex.a);
float fLocalV = clamp((fTex.a - 0.5) * 2.0, 0.0, 1.0);
float fBlindAmt = fR2 < 0.5 ? fR1 * 0.9 : 0.0;
float fBlind = fGlass * step(1.0 - fBlindAmt, fLocalV) * (1.0 - step(1.5, fCls) * step(fCls, 2.5));
vec3 fGlassTint = uGlass[int(vFac.w + 0.5)];
vec3 fGlassCol = fTex.rgb * fGlassTint * (0.7 + 0.55 * fR1);
vec3 fBlindCol = mix(vec3(0.72, 0.68, 0.6), vec3(0.6, 0.63, 0.66), step(0.5, fR1));
vec3 fWall = fTex.rgb * diffuseColor.rgb;
// Dust and splash near the ground, a little darker at the base of walls.
fWall *= mix(0.72, 1.0, smoothstep(0.0, 2.2, vWorldY));
vec3 fCol = mix(fWall, fGlassCol, fGlass);
fCol = mix(fCol, fBlindCol, fBlind);
diffuseColor.rgb = fCol;
float fClear = fGlass - fBlind;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.1, fClear);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float isRes = step(0.5, fCls) * (1.0 - step(1.5, fCls));
  float isShop = step(1.5, fCls) * (1.0 - step(2.5, fCls));
  float litFrac = mix(mix(0.2, 0.5, isRes), 0.62, isShop) * (1.0 - step(3.5, fCls));
  float lit = step(fR2, litFrac) * step(0.02, fR1);
  vec3 warm = vec3(1.0, 0.7, 0.4);
  vec3 cool = vec3(0.82, 0.9, 1.0);
  vec3 winCol = mix(cool, warm, clamp(isRes + isShop * 0.6 + step(0.75, fR3) * 0.5, 0.0, 1.0));
  winCol = mix(winCol, vec3(0.45, 0.6, 1.0), step(0.93, fR3) * isRes);
  float glow = fGlass * lit * (0.55 + 0.9 * fR1) * (1.0 + fBlind * 0.6);
  totalEmissiveRadiance += winCol * glow * uNight * 1.5;
  float isSign = step(0.5, fKind) * (1.0 - step(1.5, fKind));
  float signLit = step(0.25, cityHash(vec2(vFac.y, 3.0)));
  totalEmissiveRadiance += fTex.rgb * isSign * signLit * uNight * 0.9;
  float isLamp = step(2.5, fKind) * (1.0 - step(3.5, fKind));
  totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * isLamp * uNight * 6.0;
  float isPanel = step(3.5, fKind) * (1.0 - step(4.5, fKind));
  totalEmissiveRadiance += fTex.rgb * diffuseColor.rgb * isPanel * uNight * 1.4;
}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 R = reflect(-geometryViewDir, geometryNormal);
  float ry = dot(R, upV);
  vec3 refl = ry > 0.0 ? mix(uSkyHorizon, uSkyZenith, sqrt(ry)) : mix(uSkyHorizon, uSkyGround, sqrt(-ry * 3.0));
  float fres = 0.05 + 0.95 * pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 5.0);
  outgoingLight += refl * fClear * mix(0.2, 1.0, fres) * uReflect;
}
#include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'city-facade-1';
  return mat;
}

// Ground surfaces (roads, pavements, grass, rail ballast...): texture-array albedo with a
// large-scale variation layer so tiles do not visibly repeat. kind 1 = blended "base ground"
// (paved in the city core, dry grass/red soil in the suburbs) driven by the urban mask texture.
export function createGroundMaterial(map, uniforms, layers, urban, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    polygonOffset: !!opts.offset,
    polygonOffsetFactor: opts.offset || 0,
    polygonOffsetUnits: opts.offset || 0,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.groundMap = { value: map };
    shader.uniforms.urbanMap = { value: urban.texture };
    shader.uniforms.urbanRect = { value: urban.rect };
    shader.uniforms.uMacro = { value: layers.macro };
    shader.uniforms.uPave = { value: layers.paving };
    shader.uniforms.uDry = { value: layers.dryGrass };
    shader.uniforms.uDirt = { value: layers.dirt };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 facade;
varying vec4 vFac;
varying vec2 vFacUv;
varying vec2 vWorldXZ;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFac = facade;
vFacUv = uv;
vWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray groundMap;
uniform sampler2D urbanMap;
uniform vec4 urbanRect;
uniform float uMacro;
uniform float uPave;
uniform float uDry;
uniform float uDirt;
varying vec4 vFac;
varying vec2 vFacUv;
varying vec2 vWorldXZ;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.a = 1.0;
float gKind = floor(mod(vFac.z + 0.5, 8.0));
vec3 gMacro = texture(groundMap, vec3(vWorldXZ / 173.0, uMacro)).rgb;
vec3 gMacro2 = texture(groundMap, vec3(vWorldXZ / 41.0 + 0.37, uMacro)).rgb;
vec3 gCol;
if (gKind > 0.5) {
  vec2 uvU = (vWorldXZ - urbanRect.xy) / urbanRect.zw;
  float urban = texture(urbanMap, uvU).r;
  urban = smoothstep(0.2, 0.8, urban + (gMacro2.r - 0.5) * 0.5);
  vec3 pave = texture(groundMap, vec3(vWorldXZ / 3.0, uPave)).rgb * vec3(0.93, 0.9, 0.86);
  vec3 dry = texture(groundMap, vec3(vWorldXZ / 9.0, uDry)).rgb;
  vec3 dirt = texture(groundMap, vec3(vWorldXZ / 6.0, uDirt)).rgb;
  vec3 wild = mix(dry, dirt, smoothstep(0.45, 0.7, gMacro.g + (gMacro2.b - 0.5) * 0.4));
  gCol = mix(wild, pave, urban);
} else {
  gCol = texture(groundMap, vec3(vFacUv, vFac.x)).rgb;
}
gCol *= diffuseColor.rgb * (0.82 + 0.36 * gMacro.r) * (0.92 + 0.16 * gMacro2.g);
diffuseColor.rgb = gCol;`,
      );
  };
  mat.customProgramCacheKey = () => 'city-ground-1';
  return mat;
}
