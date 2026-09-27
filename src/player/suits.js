import * as THREE from 'three';

// Suit switching. The glTF carries both suits as material variants (suit_classic / suit_symbiote,
// same UVs, same relief normal map). F swaps them with a flourish: for TRANSITION_TIME the mesh wears
// a blend material in which the new suit spreads over the body from the chest emblem behind a glowing
// front (the symbiote taking over, or peeling back); then the plain variant material goes back on, so
// the blend costs nothing the rest of the time.

export const SUITS = ['classic', 'symbiote'];
const TRANSITION_TIME = 0.75;
const MAX_RADIUS = 1.3; // m: the spreading front has covered the body by then
const EMBLEM_FRONT = 0.13; // m in front of spine_03: the chest emblem

const _v = new THREE.Vector3();

export class SuitSwitcher {
  constructor(mesh, materials, chestBone, renderer, scene, camera) {
    this.mesh = mesh;
    this.materials = materials;
    this.chest = chestBone;
    this.suit = 'classic';
    this._t = TRANSITION_TIME;
    this.uniforms = {
      mapB: { value: materials.symbiote.map },
      mrB: { value: materials.symbiote.roughnessMap },
      uRadius: { value: 10 },
      uOrigin: { value: new THREE.Vector3(0, 1.33, -0.12) },
      uNewIsB: { value: 0 },
      uEdge: { value: 0 },
    };
    this.blend = null;
    if (materials.symbiote !== materials.classic && materials.classic.map && materials.symbiote.map) {
      this.blend = materials.classic.clone();
      this.blend.name = 'suit_transition';
      this.blend.onBeforeCompile = (shader) => this._patch(shader);
      this.blend.customProgramCacheKey = () => 'spiderman-suit-transition';
      // Compile it now (it is only worn for the flourish), so the first F press doesn't hitch.
      if (renderer?.compileAsync && scene && camera) {
        const worn = mesh.material;
        mesh.material = this.blend;
        renderer.compileAsync(mesh, camera, scene).catch(() => {});
        mesh.material = worn;
      }
    }
  }

  _patch(shader) {
    Object.assign(shader.uniforms, this.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSuitPos;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvSuitPos = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D mapB;
uniform sampler2D mrB;
uniform float uRadius;
uniform vec3 uOrigin;
uniform float uNewIsB;
uniform float uEdge;
varying vec3 vSuitPos;
float suitB;
float suitDist;`,
      )
      .replace(
        '#include <map_fragment>',
        `suitDist = length(vSuitPos - uOrigin);
float suitInside = 1.0 - smoothstep(uRadius - 0.02, uRadius + 0.02, suitDist);
suitB = mix(1.0 - uNewIsB, uNewIsB, suitInside);
#ifdef USE_MAP
diffuseColor *= mix(texture2D(map, vMapUv), texture2D(mapB, vMapUv), suitB);
#endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
roughnessFactor *= mix(texture2D(roughnessMap, vRoughnessMapUv), texture2D(mrB, vRoughnessMapUv), suitB).g;
#endif`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
metalnessFactor *= mix(texture2D(metalnessMap, vMetalnessMapUv), texture2D(mrB, vMetalnessMapUv), suitB).b;
#endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float suitFront = uEdge * (1.0 - smoothstep(0.0, 0.05, abs(suitDist - uRadius)));
totalEmissiveRadiance += vec3(0.7, 0.8, 1.0) * suitFront * 2.5;`,
      );
  }

  get transitioning() {
    return this._t < TRANSITION_TIME;
  }

  // Put on `suit`; the new one spreads from the chest emblem unless instant.
  set(suit, instant = false) {
    if (suit === this.suit || !SUITS.includes(suit)) return;
    this.suit = suit;
    this.uniforms.uNewIsB.value = suit === 'symbiote' ? 1 : 0;
    this._t = instant || !this.blend ? TRANSITION_TIME : 0;
    this.mesh.material = this.blend && !instant ? this.blend : this.materials[suit];
    this.update(0);
  }

  update(dt) {
    if (this._t >= TRANSITION_TIME) return;
    this._t = Math.min(TRANSITION_TIME, this._t + dt);
    const k = this._t / TRANSITION_TIME;
    if (k >= 1) {
      this.mesh.material = this.materials[this.suit];
      return;
    }
    this.uniforms.uRadius.value = MAX_RADIUS * (1 - (1 - k) ** 2);
    this.uniforms.uEdge.value = Math.sin(Math.PI * Math.min(1, k * 1.2));
    // The emblem in the mesh's own (skinned) space: the front follows the pose.
    if (this.chest) {
      this.chest.getWorldPosition(_v);
      this.mesh.worldToLocal(_v);
      _v.z -= EMBLEM_FRONT;
      this.uniforms.uOrigin.value.copy(_v);
    }
  }
}
