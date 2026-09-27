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
  walk_formal: [30, true],
  carry_on_head: [30, true],
  flee_run: [30, true],
  idle_relaxed: [15, true],
  idle_arms_folded: [15, true],
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
// Things people carry, built into every variant's mesh (skinned 100 % to their bone, collapsed unless the
// person's prop flags show them, bodies.js): a phone at the ear, a phone held up filming, a basin of produce
// on the head. Colour slots: 1 phone, 2 basin, 3 produce (palettes below, picked per person).
export const PROP = { CALL: 1, FILM: 2, BASIN: 4 };
export const BASIN_COLORS = ['#c9ced3', '#2b56a1', '#d23a2a', '#e0b23a', '#2e8b57'];
export const LOAD_COLORS = ['#d6331f', '#f0d23c', '#f08c1a', '#2f7d32', '#b99b6b', '#b5654a'];

// Long skirts and wraps tear in a run (README): these people hurry at a fast walk instead.
const NO_RUN = new Set(['woman_zambia_wrap', 'woman_vendor_apron', 'woman_elder', 'woman_apostolic', 'man_elder_flatcap']);

// Roles that also get the upright, straight-armed walk.
const FORMAL = ['office_man', 'street_preacher', 'police', 'security_guard'];

function clipsFor(v) {
  const out = [];
  for (const name of Object.keys(CLIP_DEFS)) {
    if (name === 'walk' && v.gender !== 'male') continue;
    if (name === 'walk_female' && v.gender !== 'female') continue;
    if (name === 'walk_slow' && !v.roles.includes('elder')) continue;
    if (name === 'walk_formal' && !FORMAL.some((r) => v.roles.includes(r))) continue;
    if (name === 'carry_on_head' && !v.roles.includes('market_woman')) continue;
    if (name === 'call_out' && !v.roles.includes('hwindi') && !v.roles.includes('youth')) continue;
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

// Prop geometry in its own frame: {part, pos, nor, slot (per triangle... per vertex)}.
function propParts() {
  const parts = [];
  const make = (part, pieces) => {
    const pos = [];
    const nor = [];
    const slot = [];
    for (const [geo, s] of pieces) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      pos.push(...g.attributes.position.array);
      nor.push(...g.attributes.normal.array);
      for (let i = 0; i < g.attributes.position.count; i++) slot.push(s);
    }
    parts.push({ part, pos, nor, slot });
  };
  make(1, [[new THREE.BoxGeometry(0.072, 0.145, 0.009), 1]]);
  make(2, [[new THREE.BoxGeometry(0.072, 0.145, 0.009), 1]]);
  make(3, [
    [new THREE.CylinderGeometry(0.25, 0.17, 0.11, 14, 1, true).translate(0, 0.055, 0), 2],
    [new THREE.CircleGeometry(0.17, 14).rotateX(Math.PI / 2).translate(0, 0.002, 0), 2],
    [new THREE.SphereGeometry(0.23, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.42, 1).translate(0, 0.08, 0), 3],
  ]);
  return parts;
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
    this.PROP_BONES = [this.HEAD, this.boneIndex.get('hand_r'), this.boneIndex.get('hand_l')];

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
    const fkPos = (v, qW, tLocal, out) => {
      const tmp = this._tmp3 || (this._tmp3 = new Float32Array(3));
      for (let i = 0; i < NB; i++) {
        const p = this.parents[i];
        const x = tLocal[i * 3];
        const y = tLocal[i * 3 + 1];
        const z = tLocal[i * 3 + 2];
        if (p < 0) {
          qrot(v.pQ, 0, x * v.pS, y * v.pS, z * v.pS, tmp, 0);
          out[i * 3] = v.pT[0] + tmp[0];
          out[i * 3 + 1] = v.pT[1] + tmp[1];
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
    this.restQ = restQ;
    const lod1 = this._extract(1);
    const far = this._decimate(lod1, 0.085);
    this.lods = [this._pack(this._withProps(this._extract(0))), this._pack(this._withProps(lod1)), this._pack(far)];
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

  // De-quantised bind-pose mesh of every variant in character space: per variant {vtx (12 floats a vertex:
  // position, packed joints, normal, u, three weights, v), index}.
  _extract(lod) {
    const out = [];
    const D = new THREE.Matrix4();
    const Di = new THREE.Matrix4();
    const nm = new THREE.Matrix3();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    let bindError = 0;
    for (const v of this.variants) {
      let mesh = null;
      v.gltf[lod].scene.traverse((o) => {
        if (o.isSkinnedMesh && !mesh) mesh = o;
      });
      v.gltf[lod].scene.updateMatrixWorld(true);
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
      const vtx = new Float32Array(count * 12);
      for (let i = 0; i < count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(D);
        n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        const w0 = sw.getX(i);
        const w1 = sw.getY(i);
        const w2 = sw.getZ(i);
        const sum = w0 + w1 + w2 + sw.getW(i) || 1;
        const o = i * 12;
        vtx[o] = p.x;
        vtx[o + 1] = p.y;
        vtx[o + 2] = p.z;
        vtx[o + 3] = remap[si.getX(i)] + remap[si.getY(i)] * 64 + remap[si.getZ(i)] * 4096 + remap[si.getW(i)] * 262144;
        vtx[o + 4] = n.x;
        vtx[o + 5] = n.y;
        vtx[o + 6] = n.z;
        vtx[o + 7] = uv.getX(i);
        vtx[o + 8] = w0 / sum;
        vtx[o + 9] = w1 / sum;
        vtx[o + 10] = w2 / sum;
        vtx[o + 11] = uv.getY(i);
      }
      const index = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: count }, (_, i) => i);
      out.push({ vtx, index });
    }
    if (bindError > 1e-3) console.warn('[npc] bind pose mismatch', bindError);
    if (this.NB > 64) console.warn('[npc] more than 64 bones: joint packing overflows');
    return out;
  }

  // A far LOD by vertex clustering (cells of `cell` m, never merging across limbs): a few hundred
  // triangles, same UVs as the source (smears a little over atlas seams, invisible at 100 m).
  _decimate(src, cell) {
    const limbOf = new Int8Array(this.NB);
    for (const [name, i] of this.boneIndex) {
      const side = name.endsWith('_l') ? 0 : name.endsWith('_r') ? 1 : -1;
      const leg = /thigh|calf|foot|ball/.test(name);
      limbOf[i] = side < 0 ? 0 : (leg ? 1 : 3) + side;
    }
    return src.map(({ vtx, index }) => {
      const count = vtx.length / 12;
      const cluster = new Map();
      const map = new Int32Array(count);
      const acc = [];
      for (let i = 0; i < count; i++) {
        const o = i * 12;
        const J = vtx[o + 3];
        const js = [J & 63, (J >> 6) & 63, (J >> 12) & 63, (J >> 18) & 63];
        const ws = [vtx[o + 8], vtx[o + 9], vtx[o + 10], 1 - vtx[o + 8] - vtx[o + 9] - vtx[o + 10]];
        let best = 0;
        for (let k = 1; k < 4; k++) if (ws[k] > ws[best]) best = k;
        const key = `${limbOf[js[best]]}|${Math.floor(vtx[o] / cell)}|${Math.floor(vtx[o + 1] / cell)}|${Math.floor(vtx[o + 2] / cell)}`;
        let c = cluster.get(key);
        if (c === undefined) {
          c = acc.length;
          cluster.set(key, c);
          acc.push({ rep: i, n: 0, p: [0, 0, 0], nr: [0, 0, 0] });
        }
        const a = acc[c];
        a.n++;
        for (let k = 0; k < 3; k++) {
          a.p[k] += vtx[o + k];
          a.nr[k] += vtx[o + 4 + k];
        }
        map[i] = c;
      }
      const out = new Float32Array(acc.length * 12);
      acc.forEach((a, c) => {
        out.set(vtx.subarray(a.rep * 12, a.rep * 12 + 12), c * 12);
        const len = Math.hypot(a.nr[0], a.nr[1], a.nr[2]) || 1;
        for (let k = 0; k < 3; k++) {
          out[c * 12 + k] = a.p[k] / a.n;
          out[c * 12 + 4 + k] = a.nr[k] / len;
        }
      });
      const tris = [];
      const seen = new Set();
      for (let t = 0; t < index.length; t += 3) {
        const a = map[index[t]];
        const b = map[index[t + 1]];
        const c = map[index[t + 2]];
        if (a === b || b === c || a === c) continue;
        const key = [a, b, c].sort((x, y) => x - y).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        tris.push(a, b, c);
      }
      return { vtx: out, index: Uint32Array.from(tris) };
    });
  }

  // Held props appended to every variant's mesh (u < 0 marks a prop vertex: -u = colour slot, v = part).
  _withProps(list) {
    const parts = propParts();
    const m = new THREE.Matrix4();
    const rest = new THREE.Matrix4();
    const pose = new THREE.Matrix4();
    const nm = new THREE.Matrix3();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const v3 = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    return list.map((d, vi) => {
      const V = this.variants[vi];
      const extra = [];
      for (const part of parts) {
        // Where the prop sits in its bone's frame: measured once from a frame of the clip that uses it.
        const k = part.part === 3 ? 0 : 1;
        const bone = this.PROP_BONES[k];
        if (part.part === 3) m.makeTranslation(0, 0.175, 0);
        else {
          const clip = this.clips[part.part === 1 ? 'phone_call' : 'phone_film'];
          const f = Math.round(Math.min(1, clip.dur * 0.4) * clip.fps);
          const qf = clip.qBase + f;
          const row = clip.cBase[vi] + f;
          this.phonePose(part.part === 1 ? 'call' : 'film', qf, row, m);
          this.propPose(1, qf, row, p, q);
          pose.compose(p, q, one);
          m.premultiply(pose.invert());
        }
        q.fromArray(this.restQ, bone * 4);
        p.fromArray(V.restT, bone * 3);
        rest.compose(p, q, one).multiply(m);
        nm.getNormalMatrix(rest);
        for (let i = 0; i < part.pos.length; i += 3) {
          v3.fromArray(part.pos, i).applyMatrix4(rest);
          extra.push(v3.x, v3.y, v3.z, bone);
          v3.fromArray(part.nor, i).applyMatrix3(nm).normalize();
          extra.push(v3.x, v3.y, v3.z, -part.slot[i / 3], 1, 0, 0, part.part);
        }
      }
      const n0 = d.vtx.length / 12;
      const vtx = new Float32Array(d.vtx.length + extra.length);
      vtx.set(d.vtx);
      vtx.set(extra, d.vtx.length);
      const index = new Uint32Array(d.index.length + extra.length / 12);
      index.set(d.index);
      for (let i = 0; i < extra.length / 12; i++) index[d.index.length + i] = n0 + i;
      return { vtx, index };
    });
  }

  // Character-space placement of a phone for a pose sample: against the right palm at the ear for a call,
  // held up between both hands at eye level, screen to the eyes, when filming. Writes a Matrix4.
  phonePose(kind, qf, row, out) {
    const t = this._pp || (this._pp = { head: new THREE.Vector3(), r: new THREE.Vector3(), l: new THREE.Vector3(), q: new THREE.Quaternion(), p: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() });
    this.propPose(0, qf, row, t.head, t.q);
    this.propPose(1, qf, row, t.r, t.q);
    t.head.y += 0.07; // eyes / ear
    if (kind === 'film') {
      this.propPose(2, qf, row, t.l, t.q);
      t.p.addVectors(t.r, t.l).multiplyScalar(0.5);
      t.p.y += 0.07;
      t.y.set(0, 1, 0);
    } else {
      // The fingers point along the hand bone's +y: the phone lies along them, between palm and ear.
      t.y.set(0, 1, 0).applyQuaternion(t.q);
      t.p.copy(t.r).addScaledVector(t.y, 0.07).lerp(t.head, 0.28);
    }
    t.z.subVectors(t.head, t.p).normalize();
    t.x.crossVectors(t.y, t.z).normalize();
    t.y.crossVectors(t.z, t.x);
    return out.makeBasis(t.x, t.y, t.z).setPosition(t.p);
  }

  // Pack every variant of a LOD for vertex pulling (one texture of vertices, one of corners).
  _pack(list) {
    let maxCorners = 0;
    let totalVerts = 0;
    for (const d of list) {
      maxCorners = Math.max(maxCorners, d.index.length);
      totalVerts += d.vtx.length / 12;
    }
    const vtx = new Float32Array(totalVerts * 12);
    const idx = new Float32Array(maxCorners * list.length);
    let base = 0;
    list.forEach((d, vi) => {
      vtx.set(d.vtx, base * 12);
      const corners = d.index.length;
      const o = vi * maxCorners;
      // Padding repeats the last corner: zero-area triangles the GPU drops.
      for (let k = 0; k < maxCorners; k++) idx[o + k] = base + d.index[Math.min(k, corners - 1)];
      base += d.vtx.length / 12;
    });
    return {
      corners: maxCorners,
      vertices: totalVerts,
      tris: list.map((d) => d.index.length / 3),
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

  // Character-space height of prop bone k (0 head, 1 right hand, 2 left hand) at time t of `clip` for variant index v.
  jointY(k, clip, t, v) {
    let f = t * clip.fps;
    f = clip.loop ? ((f % clip.frames) + clip.frames) % clip.frames : Math.min(Math.max(f, 0), clip.frames);
    const row = clip.cBase[v] + Math.round(f);
    return this.propT[(row * this.PROP_BONES.length + k) * 3 + 1];
  }

  // Pose of a prop bone (k: 0 head, 1 right hand, 2 left hand) for an animation sample, in character space:
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
