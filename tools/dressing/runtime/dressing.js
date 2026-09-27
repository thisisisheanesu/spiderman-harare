// Reference runtime for public/models/dressing/ (three.js r186). Copy into src/world/ when integrating.
//
//   import { DressingLibrary } from './dressing.js';
//   const lib = await DressingLibrary.load('models/dressing/', { gltfLoader });   // loader with MeshoptDecoder
//   const tree = await lib.model('jacaranda_bloom_a', 0);        // LOD0 THREE.Group (meshes in metres, y up)
//   const imp  = lib.impostors('jacaranda_bloom_a', 400);        // InstancedMesh of camera-facing billboards
//   lib.update(dt, camera);                                      // advances wind time (shared uniforms)
//
// Conventions (see README.md): origin at the foot / wall-contact point, +Y up, front = +Z. Foliage materials are
// alpha-tested (MASK) double-sided cards with smooth crown normals; TEXCOORD_1 (`uv1`) carries wind weights:
// uv1.x = sway (0 at the ground -> 1 at the top), uv1.y = flutter (0 bark, 0.6-1 leaves; also a phase seed).
import * as THREE from 'three';

export const windUniforms = {
  uWindTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
  uWindStrength: { value: 1.0 },
};

const WIND_VERTEX = /* glsl */ `
#ifdef USE_WIND
{
  vec3 wp0 = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #ifdef USE_INSTANCING
    wp0 += instanceMatrix[3].xyz;
  #endif
  float ph = dot(wp0.xz, vec2(0.071, 0.053));
  float sway = uv1.x;
  float flut = uv1.y;
  float t = uWindTime;
  float gust = 0.65 + 0.35 * sin(t * 0.37 + ph * 0.5);
  float s = (sin(t * 1.05 + ph) * 0.6 + sin(t * 2.31 + ph * 1.7) * 0.25) * gust * uWindStrength;
  transformed.xz += uWindDir * s * sway * 0.28;
  transformed.y -= abs(s) * sway * 0.04;
  // leaf flutter: small, fast, per-card phase (uv1.y)
  float f = sin(t * 5.3 + flut * 37.0 + dot(position, vec3(1.7, 2.3, 1.1))) * flut * 0.035 * uWindStrength;
  transformed += objectNormal * f;
}
#endif
`;

// Patches a glTF foliage / bark material in place: wind sway from uv1, and (foliage) no normal flip on back
// faces (the cards carry outward crown normals, so both faces must shade the same), plus mip-aware alpha so
// alpha-tested leaves do not thin out in the distance.
export function patchVegetationMaterial(mat, { foliage = mat.alphaTest > 0 || mat.transparent, wind = true } = {}) {
  if (mat.userData.dressingPatched) return mat;
  mat.userData.dressingPatched = true;
  if (foliage) {
    mat.transparent = false;
    mat.alphaTest = Math.max(mat.alphaTest || 0, 0.5);
    mat.side = THREE.DoubleSide;
    mat.alphaToCoverage = false;
  }
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, windUniforms);
    if (wind) {
      shader.defines = shader.defines || {};
      shader.defines.USE_WIND = '';
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform vec2 uWindDir;\nuniform float uWindStrength;\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_VERTEX);
    }
    if (foliage) {
      shader.fragmentShader = shader.fragmentShader
        // keep the outward crown normal on back faces
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n  normal *= faceDirection;\n#endif')
        // sharpen alpha with distance (mip level estimate) so cards keep their coverage
        .replace('#include <alphatest_fragment>', `
#ifdef USE_MAP
{
  vec2 dx = dFdx(vMapUv * vec2(textureSize(map, 0)));
  vec2 dy = dFdy(vMapUv * vec2(textureSize(map, 0)));
  float mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
  diffuseColor.a *= 1.0 + mip * 0.22;
}
#endif
#include <alphatest_fragment>`);
    }
  };
  mat.customProgramCacheKey = () => `dressing-veg-${foliage ? 1 : 0}-${wind ? 1 : 0}`;
  mat.needsUpdate = true;
  return mat;
}

// Camera-facing (cylindrical) billboard impostors from the 8-azimuth atlases (<name>_imp.webp albedo+alpha,
// <name>_imp_n.webp normals in frame space). Frame k shows the model seen from azimuth k*45 deg, i.e. from
// the direction (sin a, 0, cos a) in model space (frame 0 = seen from the front, +Z). The shader picks the
// frame from the camera direction relative to each instance's own rotation and blends the two nearest.
export function createImpostorMesh(entry, albedoTex, normalTex, count, { lights } = {}) {
  const imp = entry.impostor;
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  albedoTex.colorSpace = THREE.SRGBColorSpace;
  normalTex.colorSpace = THREE.NoColorSpace;
  const L = lights || {};
  const mat = new THREE.ShaderMaterial({
    // textures are passed by reference (UniformsUtils.merge would clone them before they finish loading)
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      map: { value: albedoTex }, nmap: { value: normalTex },
      grid: { value: new THREE.Vector3(imp.cols, imp.rows, imp.frames) },
      frame: { value: new THREE.Vector2(imp.frameW, imp.frameH) },
      sunDir: { value: L.sunDir || new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      sunColor: { value: L.sunColor || new THREE.Color(2.4, 2.3, 2.1) },
      skyColor: { value: L.skyColor || new THREE.Color(0.55, 0.62, 0.75) },
      groundColor: { value: L.groundColor || new THREE.Color(0.32, 0.28, 0.24) },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform vec3 grid; uniform vec2 frame;
      varying vec2 vUv0; varying vec2 vUv1; varying float vBlend; varying vec3 vRight; varying vec3 vFwd0; varying vec3 vFwd1;
      void main() {
        vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float scale = length((modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vec3 toCam = cameraPosition - base; toCam.y = 0.0; toCam = normalize(toCam + vec3(1e-5, 0.0, 0.0));
        vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
        vec3 wp = base + right * position.x * frame.x * scale + vec3(0.0, position.y * frame.y * scale, 0.0);
        // azimuth of the camera in the instance's own frame
        vec3 lx = normalize((instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vec3 lz = normalize((instanceMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
        float a = atan(dot(toCam, lx), dot(toCam, lz));
        float f = mod(a / 6.2831853 * grid.z + grid.z, grid.z);
        float f0 = floor(f); float f1 = mod(f0 + 1.0, grid.z);
        vBlend = f - f0;
        vec2 uv = vec2(position.x + 0.5, position.y);
        vec2 c0 = vec2(mod(f0, grid.x), floor(f0 / grid.x));
        vec2 c1 = vec2(mod(f1, grid.x), floor(f1 / grid.x));
        vUv0 = vec2((c0.x + uv.x) / grid.x, 1.0 - (c0.y + 1.0 - uv.y) / grid.y);
        vUv1 = vec2((c1.x + uv.x) / grid.x, 1.0 - (c1.y + 1.0 - uv.y) / grid.y);
        float a0 = f0 / grid.z * 6.2831853; float a1 = f1 / grid.z * 6.2831853;
        vFwd0 = normalize(lx * sin(a0) + lz * cos(a0));
        vFwd1 = normalize(lx * sin(a1) + lz * cos(a1));
        vRight = right;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D map; uniform sampler2D nmap;
      uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 skyColor; uniform vec3 groundColor;
      varying vec2 vUv0; varying vec2 vUv1; varying float vBlend; varying vec3 vRight; varying vec3 vFwd0; varying vec3 vFwd1;
      void main() {
        vec4 c0 = texture2D(map, vUv0); vec4 c1 = texture2D(map, vUv1);
        vec4 c = mix(c0, c1, vBlend);
        if (c.a < 0.5) discard;
        vec3 n0 = texture2D(nmap, vUv0).xyz * 2.0 - 1.0; vec3 n1 = texture2D(nmap, vUv1).xyz * 2.0 - 1.0;
        vec3 r0 = normalize(cross(vec3(0.0, 1.0, 0.0), vFwd0)); vec3 r1 = normalize(cross(vec3(0.0, 1.0, 0.0), vFwd1));
        vec3 N = normalize(mix(r0 * n0.x + vec3(0.0, n0.y, 0.0) + vFwd0 * n0.z, r1 * n1.x + vec3(0.0, n1.y, 0.0) + vFwd1 * n1.z, vBlend));
        vec3 albedo = c.rgb * c.rgb; // sRGB -> ~linear
        float ndl = max(dot(N, sunDir), 0.0);
        vec3 amb = mix(groundColor, skyColor, N.y * 0.5 + 0.5);
        vec3 col = albedo * (amb + sunColor * ndl);
        gl_FragColor = vec4(col, 1.0);
        #ifdef IMP_DEBUG_NORMAL
        gl_FragColor = vec4(N * 0.5 + 0.5, 1.0);
        #endif
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

export class DressingLibrary {
  constructor(base, manifest, loader) {
    this.base = base;
    this.manifest = manifest;
    this.byName = new Map(manifest.items.map((e) => [e.name, e]));
    this.loader = loader;
    this.cache = new Map();
    this.texLoader = new THREE.TextureLoader();
  }

  static async load(base, { gltfLoader }) {
    const manifest = await (await fetch(base + 'dressing.json')).json();
    return new DressingLibrary(base, manifest, gltfLoader);
  }

  entry(name) { return this.byName.get(name); }

  // lod: 0 or 1. Returns a Group (clone per placement, or pull geometry/material for instancing).
  async model(name, lod = 0) {
    const e = this.byName.get(name);
    const file = lod === 1 && e.lod1 ? e.lod1 : e.file;
    if (!this.cache.has(file)) {
      this.cache.set(file, this.loader.loadAsync(this.base + file).then((g) => {
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (e.wind) patchVegetationMaterial(m, { foliage: m.alphaTest > 0 || /foliage|frond|leaf/i.test(m.name) });
          }
          o.castShadow = true;
          o.receiveShadow = true;
        });
        return g.scene;
      }));
    }
    return (await this.cache.get(file)).clone();
  }

  // Float geometries in item space (metres) with the quantisation node transform baked in, one per material:
  // drop straight into InstancedMesh. [{ geometry, material }]
  async geometries(name, lod = 0) {
    const e = this.byName.get(name);
    const file = lod === 1 && e.lod1 ? e.lod1 : e.file;
    const key = 'geo:' + file;
    if (!this.cache.has(key)) {
      this.cache.set(key, this.model(name, lod).then((scene) => {
        scene.updateMatrixWorld(true);
        const out = [];
        scene.traverse((o) => {
          if (!o.isMesh) return;
          const g = o.geometry.clone();
          for (const k of Object.keys(g.attributes)) {
            const a = g.attributes[k];
            if (a.array instanceof Float32Array && !a.normalized) continue;
            const f = new Float32Array(a.count * a.itemSize);
            for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
            g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
          }
          g.applyMatrix4(o.matrixWorld);
          g.computeBoundingSphere();
          out.push({ geometry: g, material: o.material, name: o.material.name });
        });
        return out;
      }));
    }
    return this.cache.get(key);
  }

  impostors(name, count, opts) {
    const e = this.byName.get(name);
    if (!e.impostor) return null;
    const a = this.texLoader.load(this.base + e.impostor.albedo);
    const n = this.texLoader.load(this.base + e.impostor.normal);
    return createImpostorMesh(e, a, n, count, opts);
  }

  update(dt) {
    windUniforms.uWindTime.value += dt;
  }
}
