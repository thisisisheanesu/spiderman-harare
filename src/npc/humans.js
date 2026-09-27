import * as THREE from 'three';
import { DataUtils } from 'three';

// The realistic street people (public/models/humans, see its README): 23 rigged variants in two LODs sharing
// one 53-bone skeleton, and the shared clip library (public/models/anims). Everything is turned into GPU data
// once at load so the whole crowd draws in one call per LOD (bodies.js):
//
// - geometry: every variant's mesh, de-quantised into character space (feet at y = 0, facing -Z), packed
//   into a float texture (3 texels a vertex: position + joints, normal + u, weights + v) with an index
//   texture (corners per variant, padded to the longest); the vertex shader pulls its corner with
//   gl_VertexID, so one non-indexed instanced draw covers all variants.
// - colour: the variants' atlases copied on the GPU into one sRGB texture array per LOD (layer = variant).
// - animation: the clips the street uses, baked per frame into bone transforms relative to the bind pose.
//   Rotations do not depend on the body (every rig shares its rest orientations), so they are baked once per
//   clip frame (texture Q, a quaternion per bone); the translations do, so they are baked per variant
//   (texture C: c = t(frame) - q * t(rest) per bone), which keeps each variant's own bone lengths exact.
//   The pelvis track is scaled by the variant's hip height (README) so nobody floats or sinks.
//   A skinned vertex is sum_i w_i (q_i * p + c_i).
//
// humans.variants[i]: {id, index, gender, roles, height, hip, stride, ground, has(clip)}
// humans.clips[name]: {id, name, fps, frames (last frame index), dur, loop, speed (m/s at rate 1 on the
//   reference rig), qBase}; clip.cBase[variant] = first C row of the clip for that variant (-1: not baked)
// humans.bone(name) -> canonical bone index; humans.propPose(...) for things held in the hand / on the head.

const BASE = 'models/';
export const TEX_W = 2048; // width of every data texture (WebGL2 guarantees 2048)
const TEX_SHIFT = 11;

// Clips the street uses: [bake fps, loop]. Walks and runs keep their native 30 fps (fast limbs); standing
// clips are slow, 15 fps plus interpolation is plenty.
const CLIP_DEFS = {
  walk: [30, true],
  walk_female: [30, true],
  walk_slow: [30, true],
  carry_on_head: [30, true],
  flee_run: [30, true],
  idle_relaxed: [15, true],
  idle_arms_folded: [15, true],
  idle_look: [15, true],
  talk: [15, true],
  talk_2: [15, true],
  phone_call: [15, true],
  phone_film: [15, true],
  point: [15, true],
  wave: [20, true],
  cheer: [20, true],
  call_out: [15, true],
  sit_idle: [15, true],
  sit_talk: [15, true],
  sit_ground: [15, true, 'sit_idle'], // derived: legs out straight, on the grass
  nod_yes: [15, false],
  hit_head: [30, false],
};
// Long skirts and wraps tear in a run (README): these people hurry at a fast walk instead.
const NO_RUN = new Set(['woman_zambia_wrap', 'woman_vendor_apron', 'woman_elder', 'woman_apostolic', 'man_elder_flatcap']);

function clipsFor(v) {
  const out = [];
  for (const name of Object.keys(CLIP_DEFS)) {
    if (name === 'walk' && v.gender !== 'male') continue;
    if (name === 'walk_female' && v.gender !== 'female') continue;
    if (name === 'walk_slow' && !v.roles.includes('elder')) continue;
    if (name === 'carry_on_head' && !v.roles.includes('market_woman')) continue;
    if (name === 'call_out' && !v.roles.includes('hwindi')) continue;
    if (name === 'flee_run' && NO_RUN.has(v.id)) continue;
    out.push(name);
  }
  return out;
}

// --- quaternion helpers on flat arrays ------------------------------------------------------------------

function qmul(a, ai, b, bi, o, oi) {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  o[oi] = ax * bw + aw * bx + ay * bz - az * by;
  o[oi + 1] = ay * bw + aw * by + az * bx - ax * bz;
  o[oi + 2] = az * bw + aw * bz + ax * by - ay * bx;
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

// o = rotate(q, v) (o may alias nothing).
function qrot(q, qi, x, y, z, o, oi) {
  const qx = q[qi], qy = q[qi + 1], qz = q[qi + 2], qw = q[qi + 3];
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  o[oi] = x + qw * tx + qy * tz - qz * ty;
  o[oi + 1] = y + qw * ty + qz * tx - qx * tz;
  o[oi + 2] = z + qw * tz + qx * ty - qy * tx;
}

function dataTexture(data, texels, type, format = THREE.RGBAFormat) {
  const h = Math.max(1, Math.ceil(texels / TEX_W));
  const comps = format === THREE.RedFormat ? 1 : 4;
  const full = new data.constructor(TEX_W * h * comps);
  full.set(data);
  const tex = new THREE.DataTexture(full, TEX_W, h, format, type);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

function toHalf(src) {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = DataUtils.toHalfFloat(src[i]);
  return out;
}

export class Humans {
  constructor(game) {
    this.game = game;
    this.variants = [];
    this.clips = {};
    this.ready = false;
  }

  async load({ lod0Size = 512, lod1Size = 256 } = {}) {
    const assets = this.game.assets;
    const [manifest, animInfo, anim] = await Promise.all([
      assets.json(`${BASE}humans/humans_manifest.json`),
      assets.json(`${BASE}anims/humans_anims.json`),
      assets.gltf(`${BASE}anims/humans_anims.glb`),
    ]);
    const list = manifest.npcs;
    const files = await Promise.all(list.flatMap((v) => [assets.gltf(`${BASE}humans/${v.lod0.file}`), assets.gltf(`${BASE}humans/${v.lod1.file}`)]));
    let refHip = manifest.reference_hip_height_m || 0.973;
    anim.scene.traverse((o) => {
      if (o.userData?.hipHeight) refHip = o.userData.hipHeight;
    });
    this.refHip = refHip;
    const speeds = Object.fromEntries((animInfo?.clips || []).map((c) => [c.name, c.speed_mps || 0]));

    // Canonical skeleton: the first variant's bones in parent-before-child order.
    const skinOf = (gltf) => {
      let mesh = null;
      gltf.scene.traverse((o) => {
        if (o.isSkinnedMesh && !mesh) mesh = o;
      });
      return mesh;
    };
    const first = skinOf(files[0]);
    const byName = new Map(first.skeleton.bones.map((b) => [b.name, b]));
    const root = first.skeleton.bones.find((b) => !byName.has(b.parent?.name));
    const order = [];
    const walk = (b) => {
      order.push(b.name);
      for (const c of b.children) if (c.isBone && byName.has(c.name)) walk(c);
    };
    walk(root);
    const NB = order.length;
    this.NB = NB;
    this.boneIndex = new Map(order.map((n, i) => [n, i]));
    this.parents = Int16Array.from(order, (n) => (byName.get(n).parent?.isBone ? this.boneIndex.get(byName.get(n).parent.name) : -1));
    const pelvis = this.boneIndex.get('pelvis');
    this.HEAD = this.boneIndex.get('head');
    this.NECK = this.boneIndex.get('neck_01');
    this.PROP_BONES = [this.HEAD, this.boneIndex.get('hand_r')];

    // Variants: rest pose (local TRS by canonical bone), metrics and geometry.
    const variants = list.map((v, index) => {
      const g0 = files[index * 2];
      const g1 = files[index * 2 + 1];
      const mesh = skinOf(g0);
      g0.scene.updateMatrixWorld(true);
      let hip = v.hip_height_m;
      g0.scene.traverse((o) => {
        if (o.userData?.hipHeight) hip = o.userData.hipHeight;
      });
      const bones = new Map(mesh.skeleton.bones.map((b) => [b.name, b]));
      const tL = new Float32Array(NB * 3);
      const qL = new Float32Array(NB * 4);
      order.forEach((name, i) => {
        const b = bones.get(name);
        b.position.toArray(tL, i * 3);
        b.quaternion.toArray(qL, i * 4);
      });
      // The skeleton root's parent (armature node) in scene space: translation, rotation, uniform scale.
      const pm = bones.get(order[0]).parent.matrixWorld;
      const pT = new THREE.Vector3();
      const pQ = new THREE.Quaternion();
      const pS = new THREE.Vector3();
      pm.decompose(pT, pQ, pS);
      return {
        id: v.id,
        index,
        gender: v.gender,
        roles: v.roles || [],
        height: v.height_m,
        hip,
        stride: hip / refHip,
        ground: v.ground_offset_m || 0,
        clipNames: clipsFor(v),
        tL,
        qL,
        pT: pT.toArray(),
        pQ: pQ.toArray(),
        pS: pS.x,
        gltf: [g0, g1],
        clipSet: new Set(),
        has(name) {
          return this.clipSet.has(name);
        },
      };
    });
    this.variants = variants;
    this.byId = new Map(variants.map((v) => [v.id, v]));

    // Rest pose world transforms (per variant translation; rotations are shared).
    const restQ = new Float32Array(NB * 4);
    const fkRot = (qLocal, pQ, out) => {
      for (let i = 0; i < NB; i++) {
        const p = this.parents[i];
        if (p < 0) qmul(pQ, 0, qLocal, i * 4, out, i * 4);
        else qmul(out, p * 4, qLocal, i * 4, out, i * 4);
      }
    };
    const fkPos = (v, qW, tLocal, out, shiftY = 0) => {
      const tmp = this._tmp3 || (this._tmp3 = new Float32Array(3));
      for (let i = 0; i < NB; i++) {
        const p = this.parents[i];
        const x = tLocal[i * 3];
        const y = tLocal[i * 3 + 1];
        const z = tLocal[i * 3 + 2];
        if (p < 0) {
          qrot(v.pQ, 0, x * v.pS, y * v.pS, z * v.pS, tmp, 0);
          out[i * 3] = v.pT[0] + tmp[0];
          out[i * 3 + 1] = v.pT[1] + tmp[1] - shiftY;
          out[i * 3 + 2] = v.pT[2] + tmp[2];
        } else {
          qrot(qW, p * 4, x * v.pS, y * v.pS, z * v.pS, tmp, 0);
          out[i * 3] = out[p * 3] + tmp[0];
          out[i * 3 + 1] = out[p * 3 + 1] + tmp[1];
          out[i * 3 + 2] = out[p * 3 + 2] + tmp[2];
        }
      }
    };
    fkRot(variants[0].qL, variants[0].pQ, restQ);
    const restQInv = new Float32Array(NB * 4);
    for (let i = 0; i < NB; i++) {
      restQInv[i * 4] = -restQ[i * 4];
      restQInv[i * 4 + 1] = -restQ[i * 4 + 1];
      restQInv[i * 4 + 2] = -restQ[i * 4 + 2];
      restQInv[i * 4 + 3] = restQ[i * 4 + 3];
    }
    for (const v of variants) {
      v.restT = new Float32Array(NB * 3);
      fkPos(v, restQ, v.tL, v.restT);
    }

    // --- Bake the clips --------------------------------------------------------------------------
    const source = Object.fromEntries(anim.animations.map((c) => [c.name, c]));
    const clipList = [];
    let qFrames = 0;
    for (const [name, [fps, loop, from]] of Object.entries(CLIP_DEFS)) {
      const src = source[from || name];
      if (!src) continue;
      const frames = Math.max(1, Math.round(src.duration * fps));
      const clip = { id: clipList.length, name, fps, frames, dur: frames / fps, loop, speed: speeds[from || name] || 0, qBase: qFrames, cBase: new Int32Array(variants.length).fill(-1), src };
      qFrames += frames + 1;
      clipList.push(clip);
      this.clips[name] = clip;
    }
    this.clipList = clipList;
    let cRows = 0;
    for (const v of variants) {
      for (const clip of clipList) {
        if (!v.clipNames.includes(clip.name)) continue;
        clip.cBase[v.index] = cRows;
        cRows += clip.frames + 1;
        v.clipSet.add(clip.name);
      }
    }
    const Q = new Float32Array(qFrames * NB * 4);
    const C = new Float32Array(cRows * NB * 4);
    // Held props (phone in the right hand, basin on the head): world pose of those bones per frame.
    const nP = this.PROP_BONES.length;
    this.propQ = new Float32Array(qFrames * nP * 4);
    this.propT = new Float32Array(cRows * nP * 3);

    const qLocal = new Float32Array(NB * 4);
    const qW = new Float32Array(NB * 4);
    const tLocal = new Float32Array(NB * 3);
    const tW = new Float32Array(NB * 3);
    const tmp = new Float32Array(3);
    const calves = ['calf_l', 'calf_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r'].map((n) => this.boneIndex.get(n));
    for (const clip of clipList) {
      const tracks = [];
      for (const tr of clip.src.tracks) {
        const dot = tr.name.lastIndexOf('.');
        const bone = this.boneIndex.get(tr.name.slice(0, dot));
        const prop = tr.name.slice(dot + 1);
        if (bone === undefined || (prop !== 'quaternion' && prop !== 'position')) continue;
        tracks.push({ bone, prop, interp: tr.createInterpolant(new Float32Array(prop === 'quaternion' ? 4 : 3)) });
      }
      const ground = clip.name === 'sit_ground';
      const users = variants.filter((v) => clip.cBase[v.index] >= 0);
      // Sitting on the grass: the chair clip with the knees straightened, the body lowered onto the seat bones.
      const drop = new Float32Array(variants.length);
      for (let f = 0; f <= clip.frames; f++) {
        const t = Math.min(clip.src.duration, f / clip.fps);
        qLocal.set(variants[0].qL);
        let pelvisPos = null;
        for (const tr of tracks) {
          const val = tr.interp.evaluate(t);
          if (tr.prop === 'quaternion') qLocal.set(val, tr.bone * 4);
          else if (tr.bone === pelvis) pelvisPos = val;
        }
        if (ground) for (const b of calves) for (let k = 0; k < 4; k++) qLocal[b * 4 + k] = variants[0].qL[b * 4 + k];
        fkRot(qLocal, variants[0].pQ, qW);
        const qf = clip.qBase + f;
        for (let i = 0; i < NB; i++) qmul(qW, i * 4, restQInv, i * 4, Q, (qf * NB + i) * 4);
        for (let k = 0; k < nP; k++) this.propQ.set(qW.subarray(this.PROP_BONES[k] * 4, this.PROP_BONES[k] * 4 + 4), (qf * nP + k) * 4);
        for (const v of users) {
          tLocal.set(v.tL);
          if (pelvisPos) {
            const s = v.stride;
            tLocal[pelvis * 3] = pelvisPos[0] * s;
            tLocal[pelvis * 3 + 1] = pelvisPos[1] * s;
            tLocal[pelvis * 3 + 2] = pelvisPos[2] * s;
          }
          fkPos(v, qW, tLocal, tW);
          if (ground) {
            if (f === 0) drop[v.index] = tW[pelvis * 3 + 1] - 0.115 * v.stride;
            for (let i = 0; i < NB; i++) tW[i * 3 + 1] -= drop[v.index];
          }
          const row = clip.cBase[v.index] + f;
          for (let i = 0; i < NB; i++) {
            const o = (qf * NB + i) * 4;
            qrot(Q, o, v.restT[i * 3], v.restT[i * 3 + 1], v.restT[i * 3 + 2], tmp, 0);
            const c = (row * NB + i) * 4;
            C[c] = tW[i * 3] - tmp[0];
            C[c + 1] = tW[i * 3 + 1] - tmp[1];
            C[c + 2] = tW[i * 3 + 2] - tmp[2];
          }
          for (let k = 0; k < nP; k++) this.propT.set(tW.subarray(this.PROP_BONES[k] * 3, this.PROP_BONES[k] * 3 + 3), (row * nP + k) * 3);
        }
      }
      delete clip.src;
    }
    this.boneQ = dataTexture(toHalf(Q), qFrames * NB, THREE.HalfFloatType);
    this.boneC = dataTexture(toHalf(C), cRows * NB, THREE.HalfFloatType);
    this.bakeStats = { qFrames, cRows, qTexels: qFrames * NB, cTexels: cRows * NB };

    // --- Geometry and colour per LOD ---------------------------------------------------------------
    this.lods = [0, 1].map((lod) => this._packGeometry(lod));
    this.maps = [
      this._textureArray(variants.map((v) => this._mapOf(v.gltf[0])), lod0Size),
      this._textureArray(variants.map((v) => this._mapOf(v.gltf[1])), lod1Size),
    ];
    for (const v of variants) {
      for (const g of v.gltf) this._release(g);
      delete v.gltf;
      delete v.tL;
      delete v.qL;
    }
    this.ready = true;
    return this;
  }

  bone(name) {
    return this.boneIndex.get(name);
  }

  _mapOf(gltf) {
    let map = null;
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.material?.map && !map) map = o.material.map;
    });
    return map;
  }

  // The glTF copies are no longer needed once packed (the GPU copies of their textures go too).
  _release(gltf) {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      const m = o.material;
      if (m?.map) {
        m.map.dispose();
        m.map.source?.data?.close?.();
      }
      m?.dispose?.();
    });
  }

  // De-quantised bind-pose mesh of every variant in character space, packed for vertex pulling.
  _packGeometry(lod) {
    const NB = this.NB;
    const meshes = this.variants.map((v) => {
      let mesh = null;
      v.gltf[lod].scene.traverse((o) => {
        if (o.isSkinnedMesh && !mesh) mesh = o;
      });
      v.gltf[lod].scene.updateMatrixWorld(true);
      return mesh;
    });
    let maxCorners = 0;
    let totalVerts = 0;
    for (const m of meshes) {
      maxCorners = Math.max(maxCorners, m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count);
      totalVerts += m.geometry.attributes.position.count;
    }
    const vtx = new Float32Array(totalVerts * 12);
    const idx = new Float32Array(maxCorners * meshes.length);
    const D = new THREE.Matrix4();
    const Di = new THREE.Matrix4();
    const nm = new THREE.Matrix3();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    let base = 0;
    let bindError = 0;
    meshes.forEach((mesh, vi) => {
      const g = mesh.geometry;
      const sk = mesh.skeleton;
      // D: bind-space position -> character space (bone world x inverse bind x bind matrix); every bone
      // agrees at rest, which is what makes the baked "relative to rest" transforms valid.
      D.multiplyMatrices(sk.bones[0].matrixWorld, sk.boneInverses[0]).multiply(mesh.bindMatrix);
      for (let j = 1; j < sk.bones.length; j += 13) {
        Di.multiplyMatrices(sk.bones[j].matrixWorld, sk.boneInverses[j]).multiply(mesh.bindMatrix);
        for (let k = 0; k < 16; k++) bindError = Math.max(bindError, Math.abs(Di.elements[k] - D.elements[k]));
      }
      nm.getNormalMatrix(D);
      const remap = sk.bones.map((b) => this.boneIndex.get(b.name) ?? 0);
      const pos = g.attributes.position;
      const nor = g.attributes.normal;
      const uv = g.attributes.uv;
      const si = g.attributes.skinIndex;
      const sw = g.attributes.skinWeight;
      const count = pos.count;
      for (let i = 0; i < count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(D);
        n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        const w = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)];
        const j = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)].map((b) => remap[b] ?? 0);
        const sum = w[0] + w[1] + w[2] + w[3] || 1;
        const o = (base + i) * 12;
        vtx[o] = p.x;
        vtx[o + 1] = p.y;
        vtx[o + 2] = p.z;
        vtx[o + 3] = j[0] + j[1] * 64 + j[2] * 4096 + j[3] * 262144;
        vtx[o + 4] = n.x;
        vtx[o + 5] = n.y;
        vtx[o + 6] = n.z;
        vtx[o + 7] = uv.getX(i);
        vtx[o + 8] = w[0] / sum;
        vtx[o + 9] = w[1] / sum;
        vtx[o + 10] = w[2] / sum;
        vtx[o + 11] = uv.getY(i);
      }
      const index = g.index;
      const corners = index ? index.count : count;
      const o = vi * maxCorners;
      for (let k = 0; k < maxCorners; k++) {
        // Padding repeats the last corner: zero-area triangles the GPU drops.
        const c = Math.min(k, corners - 1);
        idx[o + k] = base + (index ? index.getX(c) : c);
      }
      base += count;
    });
    if (bindError > 1e-3) console.warn('[npc] bind pose mismatch', bindError);
    if (NB > 64) console.warn('[npc] more than 64 bones: joint packing overflows');
    return {
      corners: maxCorners,
      vertices: totalVerts,
      tris: meshes.map((m) => (m.geometry.index ? m.geometry.index.count / 3 : 0)),
      vtx: dataTexture(vtx, totalVerts * 3, THREE.FloatType),
      idx: dataTexture(idx, idx.length, THREE.FloatType, THREE.RedFormat),
    };
  }

  // Copy the variants' atlases into one sRGB texture array on the GPU (mip-mapped; 2x2 box filter when halving).
  _textureArray(maps, size) {
    const renderer = this.game.renderer;
    const rt = new THREE.WebGLArrayRenderTarget(size, size, maps.length, {
      colorSpace: THREE.SRGBColorSpace,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    rt.texture.anisotropy = Math.min(4, this.game.assets?.maxAnisotropy || 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = texture2D(map, vUv); }',
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const prevTone = renderer.toneMapping;
    renderer.autoClear = false;
    maps.forEach((map, layer) => {
      if (!map) return;
      mat.uniforms.map.value = map;
      renderer.setRenderTarget(rt, layer);
      renderer.render(scene, cam);
    });
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    renderer.toneMapping = prevTone;
    quad.geometry.dispose();
    mat.dispose();
    return rt.texture;
  }

  // Pose of a prop bone (k: 0 head, 1 right hand) for an animation sample, in character space:
  // writes position into outP (Vector3) and world rotation into outQ (Quaternion).
  propPose(k, qFrame, cRow, outP, outQ) {
    const nP = this.PROP_BONES.length;
    const qi = (qFrame * nP + k) * 4;
    const ti = (cRow * nP + k) * 3;
    outP.set(this.propT[ti], this.propT[ti + 1], this.propT[ti + 2]);
    outQ.set(this.propQ[qi], this.propQ[qi + 1], this.propQ[qi + 2], this.propQ[qi + 3]);
  }
}

export { TEX_SHIFT };
