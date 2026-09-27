import * as THREE from 'three';

// Tree canopies close to the camera, or between the camera and Spider-Man, dissolve with an
// ordered dither (opaque, depth-writing, no sorting), so swinging low through the jacarandas never
// fills the screen with purple. Patched onto the vegetation material from the city side: the
// material's own onBeforeCompile runs first, this adds a world-position varying and a discard.
// Shadows use the vegetation's separate depth material and keep the full crowns.

export function createCanopyFade() {
  return {
    uFadeCam: { value: new THREE.Vector3(0, -1e4, 0) },
    uFadeTarget: { value: new THREE.Vector3(0, -1e4, 0) },
    uFadeOn: { value: 1 },
  };
}

// materials: alpha-tested foliage materials (MeshStandardMaterial with onBeforeCompile hooks).
export function applyCanopyFade(materials, uniforms) {
  for (const mat of materials) {
    if (mat.userData.canopyFade) continue;
    mat.userData.canopyFade = true;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (shader, renderer) {
      if (prev) prev.call(this, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCanopyW;\nvarying float vCanopyH;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
#ifdef USE_INSTANCING
vCanopyW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
vCanopyW = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
vCanopyH = position.y;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec3 uFadeCam;
uniform vec3 uFadeTarget;
uniform float uFadeOn;
varying vec3 vCanopyW;
varying float vCanopyH;`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
{
  float dc = distance(vCanopyW, uFadeCam);
  // Leave the lowest couple of metres (trunks you walk past) solid.
  float nearK = (1.0 - smoothstep(2.0, 6.5, dc)) * smoothstep(1.6, 2.6, vCanopyH);
  vec3 ab = uFadeTarget - uFadeCam;
  float t = clamp(dot(vCanopyW - uFadeCam, ab) / max(dot(ab, ab), 1e-3), 0.0, 1.0);
  float dSeg = distance(vCanopyW, uFadeCam + ab * t);
  float lineK = (1.0 - smoothstep(1.0, 3.0, dSeg)) * step(0.02, t) * (1.0 - smoothstep(0.85, 0.98, t));
  float fade = max(nearK, lineK * 0.9) * uFadeOn;
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (fade > 0.001 && ign < fade) discard;
}`,
        );
    };
    const prevKey = mat.customProgramCacheKey;
    mat.customProgramCacheKey = function () {
      return `${prevKey ? prevKey.call(this) : ''}-canopyfade`;
    };
    mat.needsUpdate = true;
  }
}
