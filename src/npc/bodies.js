import * as THREE from 'three';
import { TEX_W, TEX_SHIFT, BASIN_COLORS, LOAD_COLORS, PROP } from './humans.js';

// The crowd on screen: the realistic people (humans.js) drawn with GPU skinning from baked bone textures.
// Each LOD is one instanced, non-indexed draw: the vertex shader fetches its corner (variant x corner index,
// gl_VertexID), skins it with the bone transforms of the person's two animation samples (current clip and
// the one it is fading from), turns the head toward what the person watches, and places the body (position,
// heading, scale, mirror). LOD0 (near, ~10k triangles, 1K atlases) interpolates between baked frames and
// casts real shadows; LOD1 (~2k triangles, 256² atlases) takes the nearest frame; LOD2 (a few hundred
// triangles, clustered from LOD1 at load) keeps the far pavements busy. Carried props (a phone at the ear
// or held up filming, a basin of produce on the head) are part of every variant's mesh, skinned to the
// hand / head and collapsed unless the person has them out (iTint.w), so they cost no extra draw. A soft
// contact shadow (one instanced quad per person) sits under everyone.
//
// Per frame: begin(); push(agent, lod) for every visible person; end().
// agent.anim (crowd.js): {clip, t, prev, pt, blend} (clips from humans.clips; blend = weight of prev).

const ATTRS = ['iPos', 'iLook', 'iAnim', 'iExtra', 'iTint'];

const VERT_HEAD = /* glsl */ `
uniform highp sampler2D npcIdx;
uniform highp sampler2D npcVtx;
uniform highp sampler2D npcQ;
uniform highp sampler2D npcC;
uniform int npcCorners;
attribute vec4 iPos;   // x, y, z, heading
attribute vec4 iLook;  // scale (< 0: mirrored), variant, head yaw, head pitch
attribute vec4 iAnim;  // clip A: Q frame, C row; clip B: Q frame, C row (fraction = between baked frames)
attribute vec4 iExtra; // weight of clip B, head pivot (character space)
attribute vec4 iTint;  // colour multiplier; w: prop flags (1 call, 2 film, 4 basin) + 8 x basin colour + 64 x load colour
varying vec2 vNpcUv;
flat varying float vNpcLayer;
flat varying float vNpcMirror;
varying vec3 vNpcTint;
flat varying float vNpcProp;
flat varying vec3 vNpcPropColor;
const vec3 NPC_BASINS[${BASIN_COLORS.length}] = vec3[](${BASIN_COLORS.map(glslColor).join(', ')});
const vec3 NPC_LOADS[${LOAD_COLORS.length}] = vec3[](${LOAD_COLORS.map(glslColor).join(', ')});

ivec2 npcAt(int i) { return ivec2(i & ${TEX_W - 1}, i >> ${TEX_SHIFT}); }
vec3 npcRotQ(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
mat3 npcRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 npcRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }

void npcSample(int b, float fq, float fc, out vec4 q, out vec3 c) {
  int iq = int(fq);
  int ic = int(fc);
  q = texelFetch(npcQ, npcAt(iq * NPC_NB + b), 0);
  c = texelFetch(npcC, npcAt(ic * NPC_NB + b), 0).xyz;
#ifdef NPC_LERP
  float f = fq - float(iq);
  if (f > 0.02) {
    vec4 q1 = texelFetch(npcQ, npcAt((iq + 1) * NPC_NB + b), 0);
    vec3 c1 = texelFetch(npcC, npcAt((ic + 1) * NPC_NB + b), 0).xyz;
    q = normalize(mix(q, dot(q, q1) < 0.0 ? -q1 : q1, f));
    c = mix(c, c1, f);
  }
#endif
}

void npcBone(int b, out vec4 q, out vec3 c) {
  npcSample(b, iAnim.x, iAnim.y, q, c);
  if (iExtra.x > 0.004) {
    vec4 qb;
    vec3 cb;
    npcSample(b, iAnim.z, iAnim.w, qb, cb);
    q = normalize(mix(q, dot(q, qb) < 0.0 ? -qb : qb, iExtra.x));
    c = mix(c, cb, iExtra.x);
  }
}

void npcSkin(out vec3 pos, out vec3 nrm) {
  int variant = int(iLook.y + 0.5);
  int vi = int(texelFetch(npcIdx, npcAt(variant * npcCorners + gl_VertexID), 0).r);
  vec4 t0 = texelFetch(npcVtx, npcAt(vi * 3), 0);
  vec4 t1 = texelFetch(npcVtx, npcAt(vi * 3 + 1), 0);
  vec4 t2 = texelFetch(npcVtx, npcAt(vi * 3 + 2), 0);
  vNpcUv = vec2(t1.w, t2.w);
  vNpcLayer = float(variant);
  vNpcTint = iTint.rgb;
  vNpcProp = 0.0;
  if (t1.w < -0.5) {
    // A carried prop: collapsed (zero-area) unless this person has it out.
    int flags = int(iTint.w + 0.5);
    int part = int(t2.w + 0.5);
    if (((flags >> (part - 1)) & 1) == 0) {
      pos = vec3(0.0);
      nrm = vec3(0.0, 1.0, 0.0);
      return;
    }
    int slot = int(-t1.w + 0.5);
    vNpcProp = 1.0;
    vNpcPropColor = slot == 1 ? vec3(0.015) : slot == 2 ? NPC_BASINS[(flags >> 3) & 7] : NPC_LOADS[(flags >> 6) & 7];
  }
  int J = int(t0.w + 0.5);
  ivec4 jn = ivec4(J & 63, (J >> 6) & 63, (J >> 12) & 63, (J >> 18) & 63);
  vec4 w = vec4(t2.xyz, 1.0 - t2.x - t2.y - t2.z);
  bool look = abs(iLook.z) + abs(iLook.w) > 0.002;
  mat3 R = look ? npcRotY(iLook.z) * npcRotX(iLook.w) : mat3(1.0);
  mat3 Rh = look ? npcRotY(iLook.z * 0.5) * npcRotX(iLook.w * 0.5) : mat3(1.0);
  pos = vec3(0.0);
  nrm = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    float wk = w[k];
    if (wk < 0.004) continue;
    int b = jn[k];
    vec4 q;
    vec3 c;
    npcBone(b, q, c);
    vec3 p = npcRotQ(q, t0.xyz) + c;
    vec3 n = npcRotQ(q, t1.xyz);
    if (look && (b == NPC_HEAD || b == NPC_NECK)) {
      mat3 M = b == NPC_HEAD ? R : Rh;
      p = iExtra.yzw + M * (p - iExtra.yzw);
      n = M * n;
    }
    pos += wk * p;
    nrm += wk * n;
  }
  float sc = iLook.x;
  vNpcMirror = sc < 0.0 ? -1.0 : 1.0;
  pos *= abs(sc);
  pos.x *= vNpcMirror;
  nrm.x *= vNpcMirror;
  float ch = cos(iPos.w);
  float sh = sin(iPos.w);
  pos = vec3(ch * pos.x + sh * pos.z, pos.y, ch * pos.z - sh * pos.x) + iPos.xyz;
  nrm = vec3(ch * nrm.x + sh * nrm.z, nrm.y, ch * nrm.z - sh * nrm.x);
}
`;

function glslColor(hex) {
  const c = new THREE.Color(hex); // (linear)
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

function defines(humans, lod) {
  const d = { NPC_NB: humans.NB, NPC_HEAD: humans.HEAD, NPC_NECK: humans.NECK };
  if (lod === 0) d.NPC_LERP = '';
  return d;
}

function uniforms(humans, lod) {
  const L = humans.lods[lod];
  return {
    npcIdx: { value: L.idx },
    npcVtx: { value: L.vtx },
    npcQ: { value: humans.boneQ },
    npcC: { value: humans.boneC },
    npcCorners: { value: L.corners },
  };
}

function bodyMaterial(humans, lod) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  mat.defines = defines(humans, lod);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms(humans, lod), { npcMap: { value: humans.maps[Math.min(lod, 1)] } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <beginnormal_vertex>', 'vec3 npcPos;\nvec3 objectNormal;\nnpcSkin(npcPos, objectNormal);')
      .replace('#include <begin_vertex>', 'vec3 transformed = npcPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform highp sampler2DArray npcMap;
varying vec2 vNpcUv;
flat varying float vNpcLayer;
flat varying float vNpcMirror;
varying vec3 vNpcTint;
flat varying float vNpcProp;
flat varying vec3 vNpcPropColor;`,
      )
      .replace(
        '#include <map_fragment>',
        'if (vNpcProp > 0.5) diffuseColor.rgb *= vNpcPropColor;\nelse diffuseColor *= texture(npcMap, vec3(vNpcUv, vNpcLayer));\ndiffuseColor.rgb *= vNpcTint;',
      )
      // Mirrored people have their triangles wound the other way round.
      .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = (gl_FrontFacing ? 1.0 : - 1.0) * vNpcMirror;');
  };
  mat.customProgramCacheKey = () => `npc-body-${lod}`;
  return mat;
}

function depthMaterial(humans, lod) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  // Shadows take the nearest baked frame: half the bone fetches, and nobody can tell.
  mat.defines = defines(humans, 1);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms(humans, lod));
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', 'vec3 transformed;\nvec3 npcN;\nnpcSkin(transformed, npcN);');
  };
  mat.customProgramCacheKey = () => `npc-depth-${lod}`;
  return mat;
}

// Soft contact shadow texture for the blob under each person.
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(0,0,0,0.5)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.26)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class CrowdRenderer {
  constructor(game, humans, max, { shadows }) {
    this.game = game;
    this.h = humans;
    this.max = max;
    this.meshes = [0, 1, 2].map((lod) => {
      const L = humans.lods[lod];
      const geo = new THREE.InstancedBufferGeometry();
      // Only its length matters: the shader pulls the real corners.
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(L.corners * 3), 3));
      for (const name of ATTRS) {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
        a.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute(name, a);
      }
      geo.instanceCount = 0;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const mesh = new THREE.Mesh(geo, bodyMaterial(humans, lod));
      mesh.customDepthMaterial = depthMaterial(humans, lod);
      mesh.frustumCulled = false;
      mesh.castShadow = shadows && lod === 0;
      mesh.receiveShadow = shadows;
      mesh.name = `people-lod${lod}`;
      mesh.visible = false;
      game.scene.add(mesh);
      return mesh;
    });
    const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.blobs = new THREE.InstancedMesh(
      blobGeo,
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      max,
    );
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = 1;
    this.blobs.count = 0;
    this.blobs.name = 'people-blobs';
    game.scene.add(this.blobs);

    this.objects = [...this.meshes, this.blobs];
    this.counts = [0, 0, 0];
    this.stats = { lod0: 0, lod1: 0, lod2: 0 };
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.blobCount = 0;
  }

  begin() {
    this.counts[0] = 0;
    this.counts[1] = 0;
    this.counts[2] = 0;
    this.blobCount = 0;
  }

  // Animation sample of clip `clip` at time t for variant v: [Q frame, C row] (fractional unless `nearest`).
  _frame(clip, t, v, nearest, out, o) {
    let f = t * clip.fps;
    if (clip.loop) {
      f %= clip.frames;
      if (f < 0) f += clip.frames;
    } else f = Math.min(Math.max(f, 0), clip.frames);
    if (nearest) f = Math.round(f);
    else f = Math.min(f, clip.frames - 0.001);
    out[o] = clip.qBase + f;
    out[o + 1] = clip.cBase[v] + f;
  }

  push(a, lod, blob) {
    const i = this.counts[lod]++;
    const g = this.meshes[lod].geometry.attributes;
    const L = a.look;
    const V = L.variant;
    const an = a.anim;
    const o = i * 4;
    const nearest = lod > 0;
    const P = g.iPos.array;
    P[o] = a.position.x;
    P[o + 1] = a.position.y + V.ground * L.scale;
    P[o + 2] = a.position.z;
    P[o + 3] = a.heading;
    const K = g.iLook.array;
    K[o] = L.mirror ? -L.scale : L.scale;
    K[o + 1] = V.index;
    K[o + 2] = a.pose.headYaw;
    K[o + 3] = a.pose.headPitch;
    const A = g.iAnim.array;
    this._frame(an.clip, an.t, V.index, nearest, A, o);
    const blend = an.prev && an.blend > 0.004 ? an.blend : 0;
    if (blend) this._frame(an.prev, an.pt, V.index, nearest, A, o + 2);
    else {
      A[o + 2] = A[o];
      A[o + 3] = A[o + 1];
    }
    const E = g.iExtra.array;
    E[o] = blend;
    if (K[o + 2] || K[o + 3]) {
      // Head pivot: the head joint in the current sample (nearest baked frame is close enough).
      const h = this.h;
      h.propPose(0, Math.round(A[o]), Math.round(A[o + 1]), this._p, this._q);
      E[o + 1] = this._p.x;
      E[o + 2] = this._p.y;
      E[o + 3] = this._p.z;
    }
    const T = g.iTint.array;
    T[o] = L.tint[0];
    T[o + 1] = L.tint[1];
    T[o + 2] = L.tint[2];
    // Props out: a phone for a call or for filming, a basin on the head (with its colours).
    T[o + 3] = (a.phone === 'call' ? PROP.CALL : a.phone === 'film' ? PROP.FILM : 0) + (L.load ? PROP.BASIN + 8 * (L.basin || 0) + 64 * (L.produce || 0) : 0);
    if (blob) {
      const k = this.blobCount++;
      const s = (L.child ? 0.55 : 0.72) * L.scale * (a.pose.sit ? 1.35 : 1);
      this._s.set(s, 1, s);
      this._q.identity();
      this._m.compose(this._p.set(a.position.x, a.position.y + 0.025, a.position.z), this._q, this._s);
      this.blobs.setMatrixAt(k, this._m);
    }
  }

  end() {
    for (let lod = 0; lod < 3; lod++) {
      const mesh = this.meshes[lod];
      const n = this.counts[lod];
      mesh.geometry.instanceCount = n;
      mesh.visible = n > 0;
      if (!n) continue;
      for (const name of ATTRS) {
        const attr = mesh.geometry.attributes[name];
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, n * 4);
        attr.needsUpdate = true;
      }
    }
    this.stats.lod0 = this.counts[0];
    this.stats.lod1 = this.counts[1];
    this.stats.lod2 = this.counts[2];
    this.blobs.count = this.blobCount;
    this.blobs.visible = this.blobCount > 0;
    if (this.blobCount) {
      this.blobs.instanceMatrix.clearUpdateRanges();
      this.blobs.instanceMatrix.addUpdateRange(0, this.blobCount * 16);
      this.blobs.instanceMatrix.needsUpdate = true;
    }
  }

  // Blob shadows fade out at night when there is no sun to cast them.
  setShadowStrength(v) {
    this.blobs.material.opacity = v;
  }
}
