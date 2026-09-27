import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

// Spider-Man's body: the rigged glTF (models/humans/spiderman.glb, one skinned mesh on the shared
// 53-bone MakeHuman rig, suit variants 'classic' / 'symbiote') and the shared animation library
// (models/anims/humans_anims.glb). Spider-Man is the library's reference rig (hip height 0.973 m), so
// the clips' pelvis tracks play unscaled. Model space: feet at y = 0, facing -Z, right hand on +X.
//
// loadSpiderMan(game) -> {
//   root        Object3D to add under the player's body pivot (its y is set to -PIVOT_Y + ground offset)
//   mesh        the SkinnedMesh (frustum culling off: the bind-pose bounds don't follow the clips)
//   bones       {name: Bone}
//   clips       {name: AnimationClip}, plus '<name>_m' mirrored (left-handed) copies of MIRRORED
//   meta        {name: {duration, loop, speed (m/s at timeScale 1), rootMotion}}
//   materials   {classic, symbiote}
//   groundOffset (m) the clips sink the soles this much: the model is lifted by it
// }
// Null if the files can't be loaded (the player then shows a stand-in; see player.js).
//
// Never call skeleton.pose(): the mesh is quantised and its dequantisation lives in the inverse bind
// matrices (see models/humans/README.md). Bones are reset by the mixer, which keys every bone.

export const MODEL_URL = 'models/humans/spiderman.glb';
export const ANIMS_URL = 'models/anims/humans_anims.glb';
const ANIMS_META_URL = 'models/anims/humans_anims.json';
const MANIFEST_URL = 'models/humans/humans_manifest.json';

export const PIVOT_Y = 0.95; // the body pivot (capsule centre) above the feet; the rig hangs below it
const GROUND_OFFSET = 0.011;

// Clips that also get a mirrored copy (the web in the left hand).
const MIRRORED = ['swing', 'web_shoot'];

// Mirror a clip left <-> right (x -> -x in model space). The rig's rest pose is mirror-symmetric with
// mirrored bone frames, so a mirrored pose is the same local rotations with _l / _r swapped and each
// quaternion (x, y, z, w) -> (x, -y, -z, w); the pelvis translation (in the Root bone's frame, whose
// x is the model's -x) just flips x.
function mirrorClip(clip, name) {
  const tracks = clip.tracks.map((t) => {
    const dot = t.name.lastIndexOf('.');
    let bone = t.name.slice(0, dot);
    const prop = t.name.slice(dot);
    if (bone.endsWith('_l')) bone = bone.slice(0, -2) + '_r';
    else if (bone.endsWith('_r')) bone = bone.slice(0, -2) + '_l';
    const values = t.values.slice();
    if (prop === '.quaternion') {
      for (let i = 0; i < values.length; i += 4) {
        values[i + 1] = -values[i + 1];
        values[i + 2] = -values[i + 2];
      }
    } else if (prop === '.position') {
      for (let i = 0; i < values.length; i += 3) values[i] = -values[i];
    }
    const T = t.constructor;
    return new T(bone + prop, t.times.slice(), values);
  });
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

export async function loadSpiderMan(game) {
  const assets = game.assets;
  if (!assets?.gltf) return null;
  let gltf;
  let anims;
  try {
    [gltf, anims] = await Promise.all([assets.gltf(MODEL_URL), assets.gltf(ANIMS_URL)]);
  } catch (err) {
    console.warn('[player] Spider-Man model failed to load', err);
    return null;
  }
  const [metaJson, manifest] = await Promise.all([
    assets.json?.(ANIMS_META_URL).catch(() => null),
    assets.json?.(MANIFEST_URL).catch(() => null),
  ]);

  const root = SkeletonUtils.clone(gltf.scene);
  root.name = 'spiderman-model';
  let mesh = null;
  const bones = {};
  root.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isSkinnedMesh && !mesh) mesh = o;
  });
  if (!mesh || !bones.pelvis || !bones.hand_r) return null;
  mesh.frustumCulled = false;
  const shadows = !!game.quality?.shadows;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;

  // Suit variants (KHR_materials_variants): the symbiote material is parsed on demand.
  const classic = mesh.material;
  let symbiote = classic;
  const defs = gltf.parser.json.materials || [];
  const symIndex = defs.findIndex((m) => m.name === 'suit_symbiote');
  if (symIndex >= 0) {
    try {
      symbiote = await gltf.parser.getDependency('material', symIndex);
      // GLTFLoader flips normalScale.y only on the material it assigns at load (no vertex tangents):
      // the variant parsed here needs the same flip, or its webbing relief lights inside out.
      if (symbiote.normalScale && classic.normalScale) symbiote.normalScale.copy(classic.normalScale);
    } catch (err) {
      console.warn('[player] symbiote suit failed to load', err);
    }
  }
  if (game.quality?.level === 'low') {
    // Phones: the 2K relief map is a lot of bandwidth for a figure ~200 px tall.
    for (const m of new Set([classic, symbiote])) {
      m.normalMap = null;
      m.needsUpdate = true;
    }
  }

  const clips = {};
  for (const c of anims.animations) clips[c.name] = c;
  for (const name of MIRRORED) if (clips[name]) clips[name + '_m'] = mirrorClip(clips[name], name + '_m');

  const meta = {};
  for (const c of metaJson?.clips || []) {
    meta[c.name] = {
      duration: c.duration_s,
      loop: !!c.loop,
      speed: c.speed_mps || 0,
      rootMotion: c.root_motion_m || null,
    };
  }
  const groundOffset = Number.isFinite(manifest?.spiderman?.ground_offset_m) ? manifest.spiderman.ground_offset_m : GROUND_OFFSET;

  return { root, mesh, bones, clips, meta, materials: { classic, symbiote }, groundOffset };
}

// Stand-in body if the model can't be loaded: a plain capsule, so the game stays playable.
export function buildStandIn() {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 1.2, 4, 12),
    new THREE.MeshStandardMaterial({ color: '#b3141e', roughness: 0.6 }),
  );
  mesh.position.y = 0.88;
  const root = new THREE.Group();
  root.add(mesh);
  return root;
}
