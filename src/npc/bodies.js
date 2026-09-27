import * as THREE from 'three';
import { TEX_W, TEX_SHIFT } from './humans.js';

// The crowd on screen: the realistic people (humans.js) drawn with GPU skinning from baked bone textures.
// Each LOD is one instanced, non-indexed draw: the vertex shader fetches its corner (variant x corner index,
// gl_VertexID), skins it with the bone transforms of the person's two animation samples (current clip and
// the one it is fading from), turns the head toward what the person watches, and places the body (position,
// heading, scale, mirror). LOD0 (near, ~10k triangles, 1K atlases) interpolates between baked frames and
// casts real shadows; LOD1 (~2k triangles, 256² atlases) takes the nearest frame. Held props (a phone in the
// hand, a basin of produce on the head) are one small instanced mesh placed from the baked hand / head pose,
// and a soft contact shadow sits under everyone.
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
attribute vec4 iTint;  // colour multiplier
varying vec2 vNpcUv;
flat varying float vNpcLayer;
flat varying float vNpcMirror;
varying vec3 vNpcTint;

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
    Object.assign(shader.uniforms, uniforms(humans, lod), { npcMap: { value: humans.maps[lod] } });
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
varying vec3 vNpcTint;`,
      )
      .replace('#include <map_fragment>', 'diffuseColor *= texture(npcMap, vec3(vNpcUv, vNpcLayer));\ndiffuseColor.rgb *= vNpcTint;')
      // Mirrored people have their triangles wound the other way round.
      .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = (gl_FrontFacing ? 1.0 : - 1.0) * vNpcMirror;');
  };
  mat.customProgramCacheKey = () => `npc-body-${lod}`;
  return mat;
}

function depthMaterial(humans, lod) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  mat.defines = defines(humans, lod);
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

// Props: a phone (kind 0) and a basin heaped with produce (kind 1) in one geometry; aKind hides the other.
function propGeometry() {
  const parts = [];
  const add = (geo, kind, color) => {
    const g = geo.toNonIndexed();
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n * 2).map((_, i) => (i % 2 ? color : kind)), 2));
    parts.push(g);
  };
  add(new THREE.BoxGeometry(0.072, 0.145, 0.009), 0, 0);
  add(new THREE.CylinderGeometry(0.25, 0.17, 0.11, 14, 1, true).translate(0, 0.055, 0), 1, 1);
  add(new THREE.CircleGeometry(0.17, 14).rotateX(-Math.PI / 2).translate(0, 0.002, 0), 1, 1);
  add(new THREE.SphereGeometry(0.23, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.42, 1).translate(0, 0.08, 0), 1, 2);
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'aPart']) {
    const size = parts[0].attributes[name].itemSize;
    const total = parts.reduce((s, p) => s + p.attributes[name].count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const p of parts) {
      arr.set(p.attributes[name].array, o);
      o += p.attributes[name].array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  merged.computeBoundingSphere();
  return merged;
}

function propMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aPart;\nattribute vec4 iProp;\nvarying vec3 vPropColor;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = abs(aPart.x - iProp.x) > 0.5 ? vec3(0.0) : vec3(position);
float slot = aPart.y;
// iProp: kind, basin colour, produce colour (packed 0xRRGGBB), spare
float packed = slot < 1.5 ? iProp.y : iProp.z;
vec3 rgb = vec3(floor(packed / 65536.0), mod(floor(packed / 256.0), 256.0), mod(packed, 256.0)) / 255.0;
vPropColor = slot < 0.5 ? vec3(0.02) : pow(rgb, vec3(2.2));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPropColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vPropColor;');
  };
  mat.customProgramCacheKey = () => 'npc-props';
  return mat;
}

function propDepthMaterial() {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aPart;\nattribute vec4 iProp;')
      .replace('#include <begin_vertex>', 'vec3 transformed = abs(aPart.x - iProp.x) > 0.5 ? vec3(0.0) : vec3(position);');
  };
  mat.customProgramCacheKey = () => 'npc-props-depth';
  return mat;
}

export class CrowdRenderer {
  constructor(game, humans, max, { shadows }) {
    this.game = game;
    this.h = humans;
    this.max = max;
    this.meshes = [0, 1].map((lod) => {
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
      mesh.name = lod ? 'people-lod1' : 'people-lod0';
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

    const PROPS = 64;
    const pgeo = propGeometry();
    this.propAttr = new THREE.InstancedBufferAttribute(new Float32Array(PROPS * 4), 4);
    this.propAttr.setUsage(THREE.DynamicDrawUsage);
    pgeo.setAttribute('iProp', this.propAttr);
    this.props = new THREE.InstancedMesh(pgeo, propMaterial(), PROPS);
    this.props.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.props.frustumCulled = false;
    this.props.castShadow = shadows;
    this.props.customDepthMaterial = propDepthMaterial();
    this.props.count = 0;
    this.props.name = 'people-props';
    game.scene.add(this.props);
    this.propMax = PROPS;

    this.objects = [...this.meshes, this.blobs, this.props];
    this.counts = [0, 0];
    this.stats = { lod0: 0, lod1: 0, props: 0 };
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._p2 = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    // Where a held phone sits in the right hand's bone frame, and a basin on the crown in the head's.
    this.phoneOffset = new THREE.Matrix4().compose(new THREE.Vector3(0.02, 0.085, 0.035), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)), new THREE.Vector3(1, 1, 1));
    this.basinOffset = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.2, 0.0), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    this.blobCount = 0;
    this.propCount = 0;
  }

  begin() {
    this.counts[0] = 0;
    this.counts[1] = 0;
    this.blobCount = 0;
    this.propCount = 0;
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
    T[o + 3] = 1;
    if (blob) {
      const k = this.blobCount++;
      const s = (L.child ? 0.55 : 0.72) * L.scale * (a.pose.sit ? 1.35 : 1);
      this._s.set(s, 1, s);
      this._q.identity();
      this._m.compose(this._p.set(a.position.x, a.position.y + 0.025, a.position.z), this._q, this._s);
      this.blobs.setMatrixAt(k, this._m);
    }
    if (a.phone && lod === 0) this._prop(a, 0, 1, A, o);
    if (L.load && lod < 2) this._prop(a, 1, 0, A, o);
  }

  // A prop attached to bone k (0 head, 1 right hand) of a person drawn with sample A[o..].
  _prop(a, kind, k, A, o) {
    if (this.propCount >= this.propMax) return;
    const L = a.look;
    this.h.propPose(k, Math.round(A[o]), Math.round(A[o + 1]), this._p2, this._q2);
    // Character space -> world: mirror, scale, heading, position.
    this._m2.compose(this._p2, this._q2, this._s.set(1, 1, 1)).premultiply(this._m.makeScale(L.mirror ? -L.scale : L.scale, L.scale, L.scale));
    this._q.setFromAxisAngle(this._up, a.heading);
    this._m.compose(this._p.set(a.position.x, a.position.y + L.variant.ground * L.scale, a.position.z), this._q, this._s.set(1, 1, 1));
    this._m2.premultiply(this._m).multiply(kind === 0 ? this.phoneOffset : this.basinOffset);
    const i = this.propCount++;
    this.props.setMatrixAt(i, this._m2);
    const arr = this.propAttr.array;
    arr[i * 4] = kind;
    arr[i * 4 + 1] = L.basinColor || 0;
    arr[i * 4 + 2] = L.loadColor || 0;
    arr[i * 4 + 3] = 0;
  }

  end() {
    for (let lod = 0; lod < 2; lod++) {
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
    this.stats.props = this.propCount;
    this.blobs.count = this.blobCount;
    this.blobs.visible = this.blobCount > 0;
    if (this.blobCount) {
      this.blobs.instanceMatrix.clearUpdateRanges();
      this.blobs.instanceMatrix.addUpdateRange(0, this.blobCount * 16);
      this.blobs.instanceMatrix.needsUpdate = true;
    }
    this.props.count = this.propCount;
    this.props.visible = this.propCount > 0;
    if (this.propCount) {
      this.props.instanceMatrix.clearUpdateRanges();
      this.props.instanceMatrix.addUpdateRange(0, this.propCount * 16);
      this.props.instanceMatrix.needsUpdate = true;
      this.propAttr.clearUpdateRanges();
      this.propAttr.addUpdateRange(0, this.propCount * 4);
      this.propAttr.needsUpdate = true;
    }
  }

  // Blob shadows fade out at night when there is no sun to cast them.
  setShadowStrength(v) {
    this.blobs.material.opacity = v;
  }
}
