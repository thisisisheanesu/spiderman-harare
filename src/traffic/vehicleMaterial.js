import * as THREE from 'three';
import { MAT, NO_LAYER } from './vehicleAssets.js';

// Materials for the batched traffic (vehicleRenderer.js). One opaque MeshStandardMaterial draws every
// body, toggle, wheel and crew figure: per-vertex slots and texture layers (vehicleAssets.js) pick the
// base colour, roughness / metalness, maps and lamp emission; the per-instance batch colour carries
//   rgb = paint colour (linear), a = lamp flags (FLAG_*)
// The glass is a second, blended material (tinted, glossy, reflective).

export const FLAG = {
  HEAD: 1, // headlights on
  BRAKE: 2,
  LEFT: 4, // left indicator lit (already blinking on the CPU)
  RIGHT: 8,
  BEACON_B: 16,
  BEACON_R: 32,
  TAIL: 64, // tail / marker lamps on (night)
};

const DEFAULT_EMIT = {
  light_front: [1, 0.97, 0.9],
  light_rear: [1, 0.2, 0.15],
  indicator: [1, 0.6, 0.1],
  beacon_blue: [0.15, 0.35, 1],
  beacon_red: [1, 0.08, 0.05],
};

function vec3Of(emissive, name) {
  const a = emissive?.[name] || DEFAULT_EMIT[name];
  return new THREE.Vector3(a[0], a[1], a[2]);
}

// Shared uniforms: textures, night factor (0..1) and the lamp colours from the models.
export function createVehicleUniforms(lib) {
  return {
    uAlbedo: { value: lib.textures.albedo },
    uNormalArr: { value: lib.textures.normal },
    uNight: { value: 0 },
    uHeadColor: { value: vec3Of(lib.emissive, 'light_front') },
    uTailColor: { value: vec3Of(lib.emissive, 'light_rear') },
    uIndColor: { value: vec3Of(lib.emissive, 'indicator') },
    uBeaconB: { value: vec3Of(lib.emissive, 'beacon_blue') },
    uBeaconR: { value: vec3Of(lib.emissive, 'beacon_red') },
  };
}

export function createBodyMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
  mat.name = 'traffic-body';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aBase;
attribute vec4 aMat;
varying vec4 vBase;
flat varying vec4 vMat;
flat varying vec4 vInst;
varying vec2 vTrUv;`,
      )
      .replace(
        '#include <color_vertex>',
        `vBase = vec4( aBase.rgb * aBase.rgb, aBase.a );
vMat = aMat;
vTrUv = uv;
#ifdef USE_BATCHING_COLOR
vInst = getBatchingColor( getIndirectIndex( gl_DrawID ) );
#else
vInst = vec4( 1.0, 1.0, 1.0, 0.0 );
#endif`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
// Decals and plates sit millimetres off the body: pull them towards the camera a touch so they win
// the depth test at any distance.
if ( abs( aMat.x - ${MAT.LIVERY}.0 ) < 0.5 || abs( aMat.x - ${MAT.PLATE}.0 ) < 0.5 || abs( aMat.x - ${MAT.LED}.0 ) < 0.5 ) {
  mvPosition.xyz *= 0.9985;
  gl_Position = projectionMatrix * mvPosition;
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform highp sampler2DArray uAlbedo;
uniform highp sampler2DArray uNormalArr;
uniform float uNight;
uniform vec3 uHeadColor;
uniform vec3 uTailColor;
uniform vec3 uIndColor;
uniform vec3 uBeaconB;
uniform vec3 uBeaconR;
varying vec4 vBase;
flat varying vec4 vMat;
flat varying vec4 vInst;
varying vec2 vTrUv;
int trMat;
int trFlags;
vec4 trAlbedo;
vec4 trNormal;`,
      )
      .replace(
        '#include <map_fragment>',
        `trMat = int( vMat.x + 0.5 );
trFlags = int( vInst.a + 0.5 );
trAlbedo = vec4( 1.0 );
trNormal = vec4( 0.5, 0.5, 1.0, 1.0 );
if ( vMat.y < ${NO_LAYER - 0.5} ) trAlbedo = texture( uAlbedo, vec3( vTrUv, vMat.y ) );
if ( vMat.z < ${NO_LAYER - 0.5} ) trNormal = texture( uNormalArr, vec3( vTrUv, vMat.z ) );
if ( ( trMat == ${MAT.LIVERY} || trMat == ${MAT.LED} ) && trAlbedo.a < 0.5 ) discard;
diffuseColor.rgb = vBase.rgb * trAlbedo.rgb;
if ( trMat == ${MAT.PAINT} ) diffuseColor.rgb *= trNormal.a * vInst.rgb;`,
      )
      // The batch colour is instance data here, not a tint (see vInst).
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vBase.a;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMat.w * 0.01;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if ( vMat.z < ${NO_LAYER - 0.5} ) {
  // glTF normal map (no tangents: derivative frame, green flipped for the glTF UV convention).
  vec3 mapN = trNormal.xyz * 2.0 - 1.0;
  mapN.y = -mapN.y;
  vec3 q0 = dFdx( -vViewPosition );
  vec3 q1 = dFdy( -vViewPosition );
  vec2 st0 = dFdx( vTrUv );
  vec2 st1 = dFdy( vTrUv );
  vec3 q1perp = cross( q1, normal );
  vec3 q0perp = cross( normal, q0 );
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max( dot( T, T ), dot( B, B ) );
  float sc = det == 0.0 ? 0.0 : inversesqrt( det );
  normal = normalize( mat3( T * sc, B * sc, normal ) * mapN );
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
if ( trMat == ${MAT.HEAD} ) {
  if ( ( trFlags & ${FLAG.HEAD} ) != 0 ) totalEmissiveRadiance += trAlbedo.rgb * uHeadColor * ( 0.35 + 2.6 * uNight );
} else if ( trMat == ${MAT.TAIL} ) {
  float k = ( ( trFlags & ${FLAG.TAIL} ) != 0 ? 0.55 : 0.0 ) + ( ( trFlags & ${FLAG.BRAKE} ) != 0 ? 2.2 : 0.0 );
  totalEmissiveRadiance += trAlbedo.rgb * uTailColor * k;
} else if ( trMat == ${MAT.IND_L} ) {
  if ( ( trFlags & ${FLAG.LEFT} ) != 0 ) totalEmissiveRadiance += trAlbedo.rgb * uIndColor * 3.0;
} else if ( trMat == ${MAT.IND_R} ) {
  if ( ( trFlags & ${FLAG.RIGHT} ) != 0 ) totalEmissiveRadiance += trAlbedo.rgb * uIndColor * 3.0;
} else if ( trMat == ${MAT.BEACON_B} ) {
  if ( ( trFlags & ${FLAG.BEACON_B} ) != 0 ) totalEmissiveRadiance += uBeaconB * 4.0;
} else if ( trMat == ${MAT.BEACON_R} ) {
  if ( ( trFlags & ${FLAG.BEACON_R} ) != 0 ) totalEmissiveRadiance += uBeaconR * 4.0;
} else if ( trMat == ${MAT.LED} ) {
  totalEmissiveRadiance += diffuseColor.rgb * ( 0.5 + 1.6 * uNight );
}`,
      );
  };
  mat.customProgramCacheKey = () => 'harare-traffic-body-v2';
  return mat;
}

// Tinted safety glass: dark, glossy, reflective; drivers show through as silhouettes.
export function createGlassMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.045, 0.058, 0.062),
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  mat.name = 'traffic-glass';
  return mat;
}
