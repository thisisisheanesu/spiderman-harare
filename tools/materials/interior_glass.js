// Reference implementation (tested in the headless verification page) of facade glass with interior mapping,
// for the city integrators. Plain ES module; only depends on three.js. Copy into src/world/ when integrating.
//
//   import { createInteriorGlassMaterial } from './interior_glass.js';
//   const mat = createInteriorGlassMaterial({ atlas, glassNormal, glassOrm, glassGrime, tint: 0x5b808c });
//
// Geometry contract (one quad per window pane, any number merged into one BufferGeometry):
//   position   world or local position (walls must be vertical; the frame is derived from the normal)
//   normal     outward wall normal
//   uv         wall coordinates in METRES (u along the wall to the right when seen from outside, v up):
//              drives the tiling glass textures (normal / roughness / grime), texture.repeat = 1 / 3 m
//   winUv      vec2, 0..1 across this window pane (x left->right from outside, y bottom->top)
//   winData    vec4: x = atlas cell index 0..7 (public/textures/glass/interiors.json), y = mirror (0 / 1),
//              z = light (0 = room dark .. 1 = lights on), w = room depth in window widths (1 = as baked)
// Uniforms on material.userData.interior: uExposure (day ~0.45, night ~1.2), uDarkLevel (unlit rooms at night
// ~0.04, by day 1.0 so every room shows), uTint (glass colour; multiplies what you see through the glass).
import * as THREE from 'three';

export function createInteriorGlassMaterial({
  atlas, glassNormal = null, glassOrm = null, glassGrime = null, tint = 0x5b808c, grid = [4, 2],
  exposure = 0.45, darkLevel = 1.0, envMapIntensity = 1.0,
} = {}) {
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  const tintColor = new THREE.Color(tint);
  const mat = new THREE.MeshStandardMaterial({
    color: tintColor.clone().multiplyScalar(0.08), // what little diffuse light the glass scatters
    roughness: 1.0,
    metalness: 0.0,
    roughnessMap: glassOrm, // ORM.g: 0.04 clean .. 0.4 smudged
    normalMap: glassNormal,
    normalScale: new THREE.Vector2(0.25, 0.25),
    envMapIntensity,
  });
  const uniforms = {
    uAtlas: { value: atlas },
    uGrime: { value: glassGrime },
    uGrid: { value: new THREE.Vector2(grid[0], grid[1]) },
    uExposure: { value: exposure },
    uDarkLevel: { value: darkLevel },
    uTint: { value: tintColor },
  };
  mat.userData.interior = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 winUv;
attribute vec4 winData;
varying vec2 vWinUv;
varying vec4 vWinData;
varying vec3 vIgWorldPos;
varying vec3 vIgWorldNormal;
varying vec2 vIgWallUv;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vWinUv = winUv;
vWinData = winData;
vIgWallUv = uv;
vIgWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vIgWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uAtlas;
uniform sampler2D uGrime;
uniform vec2 uGrid;
uniform float uExposure;
uniform float uDarkLevel;
uniform vec3 uTint;
varying vec2 vWinUv;
varying vec4 vWinData;
varying vec3 vIgWorldPos;
varying vec3 vIgWorldNormal;
varying vec2 vIgWallUv;

// Interior mapping (see public/textures/README.md): ray-box hit in room space, then the bake projection.
vec3 interiorRadiance(vec2 wuv, vec3 dirTS, float cell, float mirror, float depth) {
  if (mirror > 0.5) { wuv.x = 1.0 - wuv.x; dirTS.x = -dirTS.x; }
  wuv = clamp(wuv, vec2(0.0), vec2(1.0));
  vec3 d = vec3(dirTS.xy, max(dirTS.z, 1e-3) / max(depth, 0.05));
  vec3 p0 = vec3(wuv, 0.0);
  vec3 tA = (vec3(0.0) - p0) / d;
  vec3 tB = (vec3(1.0) - p0) / d;
  vec3 tMax = max(tA, tB);
  float t = min(min(tMax.x, tMax.y), tMax.z);
  vec3 p = p0 + d * t;
  vec2 cuv = 0.5 + (p.xy - 0.5) / (1.0 + p.z);
  cuv = clamp(cuv, vec2(0.002), vec2(0.998));
  // the cell index arrives through an interpolated varying: 4.0 can come out as 3.99999 on some pixels,
  // which would pick a neighbouring cell (random dark dots). Round it first.
  cell = floor(cell + 0.5);
  float row = floor((cell + 0.5) / uGrid.x);
  float col = cell - row * uGrid.x;
  vec2 auv = (vec2(col, uGrid.y - 1.0 - row) + cuv) / uGrid;
  // gradients from the smooth window uv avoid mip seams where the hit face changes
  vec2 gx = dFdx(wuv) / uGrid;
  vec2 gy = dFdy(wuv) / uGrid;
  return textureGrad(uAtlas, auv, gx, gy).rgb;
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float igGrime = 0.0;
#ifdef IG_GRIME
  vec4 igG = texture2D(uGrime, vIgWallUv / 3.0);
  igGrime = igG.a;
  diffuseColor.rgb = mix(diffuseColor.rgb, igG.rgb * 0.45, igGrime);
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 N = normalize(vIgWorldNormal);
  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N));
  vec3 B = cross(N, T);
  vec3 V = normalize(vIgWorldPos - cameraPosition);
  vec3 dirTS = vec3(dot(V, T), dot(V, B), -dot(V, N));
  vec3 room = interiorRadiance(vWinUv, dirTS, vWinData.x, vWinData.y, vWinData.w);
  float cosT = clamp(-dot(V, N), 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
  float light = mix(uDarkLevel, 1.0, vWinData.z);
  totalEmissiveRadiance += room * uTint * (1.0 - F) * (1.0 - 0.6 * igGrime) * uExposure * light;
}`);
    if (glassGrime) shader.defines = { ...(shader.defines || {}), IG_GRIME: '' };
  };
  mat.customProgramCacheKey = () => 'interiorGlass' + (glassGrime ? 'G' : '');
  return mat;
}

// Helper: build window quads on a vertical wall. wall = {origin: Vector3 (bottom-left corner seen from outside),
// right: unit Vector3 along the wall, normal: outward unit Vector3}; windows = [{x, y, w, h, cell, mirror, light, depth}]
// in metres relative to origin. Returns a BufferGeometry with position/normal/uv/winUv/winData.
export function buildWindowGeometry(wall, windows, inset = 0.12) {
  const pos = [];
  const nor = [];
  const uv = [];
  const wuv = [];
  const wd = [];
  const idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  windows.forEach((w, i) => {
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const [cx, cy] of corners) {
      p.copy(wall.origin)
        .addScaledVector(wall.right, w.x + cx * w.w)
        .addScaledVector(up, w.y + cy * w.h)
        .addScaledVector(wall.normal, -inset);
      pos.push(p.x, p.y, p.z);
      nor.push(wall.normal.x, wall.normal.y, wall.normal.z);
      uv.push(w.x + cx * w.w, w.y + cy * w.h);
      wuv.push(cx, cy);
      wd.push(w.cell, w.mirror ? 1 : 0, w.light ?? 1, w.depth ?? 1);
    }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('winUv', new THREE.Float32BufferAttribute(wuv, 2));
  g.setAttribute('winData', new THREE.Float32BufferAttribute(wd, 4));
  g.setIndex(idx);
  return g;
}
