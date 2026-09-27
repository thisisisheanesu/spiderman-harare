# Humans: Spider-Man, street NPCs and shared animations

These are realistic rigged humans for Spider-Man: Harare. They replace the primitive procedural people and the
procedural Spider-Man. Everything was built by the scripts in `tools/humans/` (see `tools/humans/README_tools.md`).
Licences are in [CREDITS.md](CREDITS.md): all CC0, apart from some CC BY clothes that need attribution.

| file | contents | size |
|---|---|---|
| `spiderman.glb` | Spider-Man, 1.79 m, 22,999 tris, one skinned mesh `spiderman_body`, materials `suit_classic` (default) and `suit_symbiote` (KHR_materials_variants: `classic` / `symbiote`) | 1.06 MB |
| `npc_<id>.glb` (23 of them) | NPC LOD0, 7-10k tris, one material `npc_<id>` with a 1024² WebP atlas | 112-394 KB each |
| `npc_<id>_lod1.glb` | NPC LOD1, about 2,000 tris, same skeleton, 256² atlas | 45-75 KB each |
| `../anims/humans_anims.glb` | the shared skeleton (`humans_anim_rig`) and 65 animation clips, no mesh | 1.19 MB |
| `humans_manifest.json` | machine-readable variant list: files, tris, sizes, heights, hip heights, `stride_scale`, `ground_offset_m`, roles, recommended LOD distances | |
| `../anims/humans_anims.json` | machine-readable clip list: duration, loop, speed, root motion, notes | |

Total: 6.5 MB for humans + 1.2 MB for animations. The NPCs come to 5.4 MB, which is within the 10 MB budget. Everything is compressed with
EXT_meshopt_compression + KHR_mesh_quantization + EXT_texture_webp, so it needs `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)`.

## Conventions

- Units are metres, y is up, and characters **face -Z** with their right hand on +X. Feet are at y = 0 and the rest pose is an A-pose.
- Every file uses the **same skeleton**: the MakeHuman `game_engine` rig, whose bone names are UE-mannequin-like. The bone names are the same
  in every file, and every bone has the **same rest orientation** in every file (NPC rigs were normalised to Spider-Man's). One `AnimationClip`
  therefore works on every character.
- Custom data is in `userData` on the armature node (`spiderman`, `npc_<id>_rig`): `hipHeight` (m, pelvis joint height), `height` (m),
  and for NPCs `npcId`, `gender` and `roles` (comma separated). The animation rig `humans_anim_rig` carries the reference `hipHeight` = 0.973.

### Skeleton (53 bones)

```
Root
└ pelvis ─┬ spine_01 ─ spine_02 ─ spine_03 ─┬ neck_01 ─ head
          │                                  ├ clavicle_l ─ upperarm_l ─ lowerarm_l ─ hand_l ─ {thumb,index,middle,ring,pinky}_0{1,2,3}_l
          │                                  └ clavicle_r ─ upperarm_r ─ lowerarm_r ─ hand_r ─ {thumb,index,middle,ring,pinky}_0{1,2,3}_r
          ├ thigh_l ─ calf_l ─ foot_l ─ ball_l
          └ thigh_r ─ calf_r ─ foot_r ─ ball_r
```
`_l` means the character's left (-X). Props attach to `hand_r` / `hand_l` (phone, briefcase), `head` (basin, hat) or `spine_03` (backpack).
There are no twist bones, so avoid extreme forearm twists in hand-made poses.

## Loading and playing (three.js r186)

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const animGltf = await loader.loadAsync('/models/anims/humans_anims.glb');
let REF_HIP = 0.973;
animGltf.scene.traverse((o) => { if (o.userData.hipHeight) REF_HIP = o.userData.hipHeight; });
const CLIPS = Object.fromEntries(animGltf.animations.map((c) => [c.name, c]));

// Clips hold bone rotations for all 53 bones plus ONE translation track, `pelvis.position`, authored for the
// reference hip height. Scale that track per character, or short people float and tall people sink.
// Cache one clip per (name, rounded scale); do not clone per NPC.
const scaled = new Map();
export function clipFor(name, hipHeight) {
  const s = Math.round((hipHeight / REF_HIP) * 50) / 50;          // 2 % steps
  const key = name + '@' + s;
  let c = scaled.get(key);
  if (!c) {
    c = CLIPS[name].clone();
    if (s !== 1) for (const t of c.tracks) if (t.name.endsWith('.position')) for (let i = 0; i < t.values.length; i++) t.values[i] *= s;
    scaled.set(key, c);
  }
  return c;
}

// one NPC instance (load each variant's glb once, then clone it)
const manifest = await (await fetch('/models/humans/humans_manifest.json')).json();
const variant = manifest.npcs.find((v) => v.id === 'woman_zambia_wrap');   // stride_scale, ground_offset_m, LOD files
const tpl = await loader.loadAsync('/models/humans/npc_woman_zambia_wrap.glb');
const npc = SkeletonUtils.clone(tpl.scene);                       // clones the bones too (skinned)
let hip = REF_HIP; npc.traverse((o) => { if (o.userData.hipHeight) hip = o.userData.hipHeight; if (o.isSkinnedMesh) o.frustumCulled = false; });
const mixer = new THREE.AnimationMixer(npc);
const walk = mixer.clipAction(clipFor('walk_female', hip)).play();

// Stride matching. speed_mps in humans_anims.json is the ground speed on the reference rig (Spider-Man,
// hip 0.973 m). A smaller character covers proportionally less ground per cycle, so scale it by
// stride_scale = hipHeight / REF_HIP (also in humans_manifest.json): walk on a 1.21 m girl = 1.05 x 0.66 = 0.69 m/s.
const strideScale = hip / REF_HIP;
walk.timeScale = actualSpeed / (1.05 * strideScale);          // actualSpeed: your NPC's m/s; 1.05 = speed_mps of 'walk_female'

// Ground contact. The clips' pelvis height makes shoe soles sink 1-3.5 cm into the floor (boots most), so lift
// each character by its measured ground_offset_m from humans_manifest.json (Spider-Man 0.011, police 0.035).
npc.position.y = groundY + variant.ground_offset_m;         // groundY: pavement height under the NPC
```

Notes:
- **Frustum culling.** Skinned bounds are the bind pose, so a raised arm (hang, cheer) can pop at screen edges. Either set
  `frustumCulled = false` on the few near characters, or grow `geometry.boundingSphere.radius` by about 0.6 m.
- **Crossfades.** Every clip keys every bone, so `action.crossFadeTo(next, 0.2)` never leaks the A-pose.
- **Never call `skeleton.pose()` / `SkinnedMesh.pose()`.** The meshes use KHR_mesh_quantization, so the dequantisation
  transform is folded into the inverse bind matrices. `pose()` rebuilds the bones from those matrices: the mesh still draws in
  its bind shape, but the bones (and anything attached to `hand_r`, `head`...) end up about 1 m away from it. To reset a
  character, `mixer.stopAllAction()` and restore the bone transforms you saved after loading, or clone the template again.
- **Locomotion is in place.** No clip moves the character forward, so move the object at `speed_mps × stride_scale × timeScale`. One-shot clips that
  travel in the original library (roll, slide, climb_up, hit_knockback, death) are in place too. Their original root travel is
  given as `root_motion_m` (reference rig; multiply by `stride_scale` for NPCs) so you can move the object while they play.
- **Many NPCs.** Share the `AnimationClip` objects (via `clipFor`). Update far mixers at 10-15 Hz. Use LOD1 beyond the LOD distance
  (same skeleton, so the same mixer and actions keep working: swap `visible` on two meshes bound to one skeleton, or load both files and
  drive them with one mixer each). Recommended distances: **desktop LOD0 < 22 m, LOD1 22-90 m, cull beyond; phones LOD0 < 12 m, LOD1 12-55 m**.
  Keep at most about 12 animated LOD0 NPCs on phones.

## Spider-Man

- The body is an athletic MakeHuman male (1.79 m, hip 0.97 m) and is the reference skeleton for all clips. The masked head is smooth: the ears are flattened
  under the fabric, and the eye sockets and mouth are covered and welded shut. It has 22,999 triangles and the MakeHuman UV layout.
- `suit_classic` has a red/blue suit with raised black webbing that radiates from the chest emblem and the face, with rings around the arms and boots. It has a
  black chest spider, a red back spider, red gloves and boots, and big white lenses with thick black frames. The textures are baseColor 2048², a shared
  tangent-space normal map 2048² (raised web cords) and metallicRoughness 1024² (glossy lenses, rubbery webbing).
- `suit_symbiote` is glossy black, with a big white spider whose legs wrap from the chest over the shoulders and sides to a back spider, and white lenses. It
  reuses the same normal map, so the webbing shows faintly.
- Switching suits (the materials are loaded lazily by the parser):

```js
const gltf = await loader.loadAsync('/models/humans/spiderman.glb');
const body = gltf.scene.getObjectByName('spiderman_body');
const matIndex = gltf.parser.json.materials.findIndex((m) => m.name === 'suit_symbiote');
const symbiote = await gltf.parser.getDependency('material', matIndex);
const classic = body.material;
body.material = symbiote;           // and back: body.material = classic
```
- The existing suit-transition shader (`src/player/suits.js`) can blend the two base-colour maps: both use the same UVs.
- Suggested state mapping for `src/player/animator.js`:

| game state | clip(s) |
|---|---|
| idle | `idle`, sometimes `idle_look` |
| run | `run` (6.3 m/s), `sprint` (9.4 m/s), `walk` (1.05 m/s); set timeScale from the controller speed |
| jump / fall / skydive / dive | `jump_start` → `jump_air`, or `hero_jump_start` → `fall`; `skydive`, `dive` (pitch the body yourself) |
| swing / tuck / spread | `swing` (full cycle) or `hang`; `roll` for flips |
| zip | `zip`, with `web_shoot` layered at the start |
| perch | `crouch_idle` |
| land_hard | `land_hard` (superhero landing); soft: `land` |
| wall / wall_run | `climb` (wall crawl, facing the wall; hands and feet on a plane 0.34 m in front), `sprint` for wall runs |
| vault | `climb_up` |
| combat | `punch_jab`, `punch_cross`, `punch_hook`, `throw` |

## NPC variants

Colours come from `src/data/streetlife.js` `PEDESTRIAN_STYLES`. Every variant is Black Zimbabwean (MakeHuman African skins, tinted to the
palette's `skinTones`). Hair is painted on the scalp (crop, shaved, cornrows) or uses opaque hair meshes (bob, afro). Head wraps (dhuku)
are custom geometry with printed fabric. Wax-print wrap skirts are procedural. Heights run from 1.21 m (primary-school girl) to 1.86 m.

Clothes are layered in a fixed order (`LAYER_Z` in `tools/humans/npc_variants.py`: shoes < tucked tops < bottoms < untucked
tops < hair < jackets / sweaters < apron < hats). After decimation `resolve_layers()` pulls every inner-layer vertex that pokes
through an outer layer back under it, and around the hips re-skins the covered inner vertices like the garment above them, so
thighs do not swing out through skirts and waistbands stay under shirt hems while walking. The primary-school uniform (short
sleeves, shorts to above the knee) is cut from full garments with a planar cut (`cut` in the variant spec).

| id | gender | roles | description | height m | LOD0 tris / KB | LOD1 tris / KB |
|---|---|---|---|---|---|---|
| `boy_high_school` | male | school_kid | High school boy: white shirt, maroon tie, grey trousers, black shoes | 1.65 | 9798 / 151 | 1999 / 52 |
| `boy_primary_school` | male | school_kid | Primary school boy: short-sleeved khaki shirt, khaki shorts to above the knee, brown socks, black shoes | 1.33 | 9549 / 153 | 2000 / 54 |
| `girl_high_school` | female | school_kid | High school girl: white top, navy skirt, white socks, black shoes, cornrows | 1.44 | 9798 / 146 | 1999 / 52 |
| `girl_primary_school` | female | school_kid | Primary school girl: light blue dress, white socks, black shoes, cornrows | 1.21 | 7771 / 133 | 1999 / 49 |
| `man_apostolic` | male | apostolic | Apostolic church member: white knee-length robe, shaved head, full beard, barefoot | 1.86 | 7071 / 119 | 1999 / 46 |
| `man_business_suit` | male | office_man, street_preacher | Office worker in a charcoal two-piece suit, white shirt and maroon tie | 1.80 | 7770 / 123 | 1998 / 47 |
| `man_elder_flatcap` | male | elder | Elderly man in brown jacket, grey trousers and flat cap, grey stubble | 1.74 | 8671 / 160 | 1999 / 52 |
| `man_hoodie` | male | youth, hwindi | Youth / kombi tout in grey hooded sweat jacket, dark jeans and white sneakers | 1.62 | 9798 / 215 | 2000 / 69 |
| `man_overalls` | male | handcart_pusher, worker, car_washer | Worker in navy overalls over a grey t-shirt, work boots | 1.68 | 7772 / 130 | 2000 / 48 |
| `man_police_zrp` | male | police | ZRP police officer: light blue-grey shirt, navy trousers and cap, black boots | 1.79 | 9797 / 159 | 2000 / 55 |
| `man_polo_chinos` | male | casual_man | Man in yellow polo shirt, khaki chinos and brown shoes | 1.79 | 9798 / 215 | 1999 / 56 |
| `man_security_guard` | male | security_guard | Private security guard: blue-grey shirt, navy trousers, navy patrol cap, boots | 1.74 | 9796 / 151 | 2000 / 53 |
| `man_shirt_tie` | male | office_man | Clerk in light blue shirt, navy tie and grey trousers | 1.66 | 9797 / 153 | 2000 / 52 |
| `man_tshirt_jeans_cap` | male | casual_man, youth | Young man in red t-shirt, jeans and black baseball cap | 1.67 | 9798 / 191 | 2000 / 51 |
| `woman_apostolic` | female | apostolic | Apostolic church member: white long dress and white headscarf, barefoot | 1.66 | 7234 / 112 | 2000 / 45 |
| `woman_blouse_skirt` | female | casual_woman, office_woman | Woman in a cream tucked top and black pencil skirt with a red dhuku (head wrap) | 1.59 | 9949 / 170 | 1999 / 52 |
| `woman_casual_tee` | female | casual_woman | Woman in a teal t-shirt and black trousers, hair in a bun under a black wrap | 1.51 | 9970 / 155 | 2000 / 50 |
| `woman_dress_bright` | female | casual_woman | Woman in a bright blue knee-length shift dress, braids / cornrows | 1.47 | 7771 / 118 | 1999 / 46 |
| `woman_elder` | female | elder | Elderly woman in a cardigan, long skirt and headscarf | 1.59 | 10015 / 146 | 2000 / 50 |
| `woman_jeans_top` | female | youth, casual_woman | Young woman in a pink top and tight jeans with an afro puff | 1.48 | 9796 / 226 | 2000 / 69 |
| `woman_office_suit` | female | office_woman | Office worker in a navy skirt suit, black flats, relaxed bob | 1.55 | 9371 / 159 | 2000 / 53 |
| `woman_vendor_apron` | female | vendor, market_woman | Street vendor: orange t-shirt, wax-print wrap skirt, blue gingham apron, orange-print dhuku | 1.58 | 9966 / 394 | 2000 / 74 |
| `woman_zambia_wrap` | female | market_woman, vendor | Market woman in a zambia wrap cloth (wax print) over a t-shirt, yellow-print dhuku | 1.64 | 9988 / 343 | 1999 / 66 |

Archetype mapping to `PEDESTRIAN_STYLES.archetypes`: office_man → man_business_suit / man_shirt_tie; office_woman → woman_office_suit /
woman_blouse_skirt; casual_man → man_tshirt_jeans_cap / man_polo_chinos; casual_woman → woman_dress_bright / woman_casual_tee /
woman_jeans_top; market_woman → woman_zambia_wrap / woman_vendor_apron; youth / hwindi → man_hoodie / man_tshirt_jeans_cap /
woman_jeans_top; school_kid → boy_/girl_primary_school, boy_/girl_high_school; elder → man_elder_flatcap / woman_elder;
security_guard → man_security_guard; police → man_police_zrp; handcart_pusher / car_washer → man_overalls; apostolic →
man_apostolic / woman_apostolic; street_preacher → man_business_suit.
For more variety, vary `timeScale` (±10 %) and uniform scale (±4 %), and mirror some NPCs with `scale.x = -1` (flip the material side
or use DoubleSide).

Good NPC clips: `idle_relaxed`, `idle_look`, `idle_arms_folded`, `talk`, `talk_2`, `phone_call`, `phone_film` (Spider-Man spotted),
`point`, `wave`, `cheer`, `call_out`, `sit_idle`, `walk`, `walk_female`, `walk_slow` (elders), `carry_on_head` (market women),
`flee_run`, `turn_left`/`turn_right`, `drive` (kombi and car drivers), `push` (handcart), `hit_*`, `death`, `get_up`.
Long skirts deform heavily in `run` and `flee_run`, so give market women and elders a faster `walk` rather than a run.
The NPC materials are double-sided on purpose (open sleeves, hems and skirts show their inside), which also makes the
`scale.x = -1` mirroring trick safe.

## Animation clips (`../anims/humans_anims.glb`, 30 fps)

Sources: Quaternius Universal Animation Library 1 and 2 (CC0, mocap-quality keyframed animation) retargeted onto the MakeHuman rig,
plus procedural layers (IK, twists) built on top of those clips. `speed m/s` is the ground speed implied by the planted foot at
timeScale 1. Use it to match the stride to movement speed (no foot sliding).

| clip | s | loop | speed m/s | root motion (one-shots) | source | notes |
|---|---|---|---|---|---|---|
| `call_out` | 2.50 | yes |  |  | ual2:Idle_Rail_Call | hand cupped, calling out (hwindi touting) |
| `carry_on_head` | 1.63 | yes | 0.64 |  | procedural layer | walk steadying a load on the head with the left hand (market women) |
| `cheer` | 2.00 | yes |  |  | procedural layer | both fists up, pumping, small bounce |
| `climb` | 1.20 | yes |  |  | procedural layer | Spider-Man wall crawl: faces the wall (-Z), hands/feet on a plane ~0.34 m in front; move the character up yourself |
| `climb_up` | 0.67 | no |  | fwd 1.74 m, up 1.04 m | ual2:ClimbUp_1m | vault / climb onto a 1 m ledge |
| `crouch_idle` | 2.93 | yes |  |  | ual1:Crouch_Idle_Loop | crouch / perch on ledges |
| `crouch_walk` | 2.00 | yes | 0.76 |  | ual1:Crouch_Fwd_Loop | sneaking crouched walk |
| `dance` | 1.00 | yes |  |  | ual1:Dance_Loop | dance loop |
| `death` | 2.40 | no |  | fwd -0.67 m, up 0.00 m | ual1:Death01 | collapse |
| `dive` | 1.00 | yes |  |  | procedural layer | head-first streamlined dive |
| `drink` | 1.33 | no |  |  | ual2:Consume | drink / eat |
| `drive` | 1.67 | yes |  |  | ual1:Driving_Loop | seated, hands on a steering wheel (kombi / car drivers) |
| `fall` | 2.00 | yes |  |  | ual2:NinjaJump_Idle_Loop | mid-air superhero crouch (falling) |
| `flee_run` | 3.73 | yes | 6.26 |  | procedural layer | panicked run, arms flailing, looks back over the shoulder once |
| `get_up` | 1.53 | no |  |  | ual2:LayToIdle | get up from lying on the back |
| `hang` | 2.50 | yes |  |  | procedural layer | hanging from the web: both hands up, legs trailing |
| `hero_jump_start` | 0.97 | no |  |  | ual2:NinjaJump_Start | crouched power take-off |
| `hit_chest` | 0.33 | no |  |  | ual1:Hit_Chest | hit reaction (chest) |
| `hit_head` | 0.43 | no |  |  | ual1:Hit_Head | hit reaction (head) |
| `hit_knockback` | 0.83 | no |  | fwd -3.11 m, up 0.00 m | ual2:Hit_Knockback | knocked back |
| `idle` | 2.50 | yes |  |  | ual1:Idle_Loop | standing idle, wide "hero" stance (good for Spider-Man) |
| `idle_arms_folded` | 2.50 | yes |  |  | ual2:Idle_FoldArms_Loop | waiting with folded arms (vendors, guards) |
| `idle_look` | 5.00 | yes |  |  | procedural layer | idle + looking left/right (5 s) |
| `idle_relaxed` | 2.50 | yes |  |  | procedural layer | NPC idle: feet under hips, arms closer, hands open |
| `interact` | 2.00 | no |  |  | ual1:Interact | reach and press / use |
| `jump_air` | 2.50 | yes |  |  | ual1:Jump_Loop | airborne loop |
| `jump_start` | 1.33 | no |  |  | ual1:Jump_Start | take-off (one-shot) |
| `kneel_work` | 5.20 | yes |  |  | ual1:Fixing_Kneeling | kneeling and working on something |
| `land` | 1.27 | no |  |  | ual1:Jump_Land | landing recovery |
| `land_hard` | 1.27 | no |  |  | ual2:NinjaJump_Land | superhero landing, crouch then stand |
| `nod_yes` | 2.50 | no |  |  | ual2:Yes | nodding (one-shot) |
| `phone_call` | 2.93 | yes |  |  | ual2:Idle_TalkingPhone_Loop | phone held to the ear |
| `phone_film` | 2.50 | yes |  |  | procedural layer | filming with a phone held up in both hands (attach phone to hand_r) |
| `pick_up` | 0.83 | no |  |  | ual1:PickUp_Table | pick something up from a table |
| `point` | 2.50 | yes |  |  | procedural layer | pointing forward with the right index finger |
| `punch_cross` | 1.00 | no |  |  | ual1:Punch_Cross | cross |
| `punch_hook` | 0.47 | no |  | fwd 0.37 m, up 0.00 m | ual2:Melee_Hook | hook |
| `punch_jab` | 0.87 | no |  |  | ual1:Punch_Jab | jab |
| `push` | 2.67 | yes | 0.32 |  | ual1:Push_Loop | pushing (handcart pushers) |
| `roll` | 1.47 | no |  | fwd 5.18 m, up 0.00 m | ual1:Roll | forward combat roll |
| `run` | 0.93 | yes | 6.26 |  | ual1:Jog_Fwd_Loop | fast run |
| `shake_no` | 2.50 | yes |  |  | ual2:Idle_No_Loop | head shake |
| `sit_down` | 1.30 | no |  |  | ual1:Sitting_Enter | stand -> sit |
| `sit_idle` | 1.67 | yes |  |  | ual1:Sitting_Idle_Loop | seated idle (seat height ~0.45 m) |
| `sit_talk` | 2.93 | yes |  |  | ual1:Sitting_Talking_Loop | seated talking |
| `skydive` | 1.00 | yes |  |  | procedural layer | spread-eagle free fall (pitch the body face-down yourself) |
| `slide` | 2.00 | yes |  |  | ual2:Slide_Loop | sliding loop |
| `slide_end` | 0.50 | no |  | fwd 2.08 m, up 0.00 m | ual2:Slide_Exit | slide end |
| `slide_start` | 0.83 | no |  | fwd 4.15 m, up 0.00 m | ual2:Slide_Start | slide start |
| `sprint` | 0.67 | yes | 9.44 |  | ual1:Sprint_Loop | full sprint |
| `stand_up` | 1.03 | no |  |  | ual1:Sitting_Exit | sit -> stand |
| `swing` | 2.00 | yes |  |  | procedural layer | one full web-swing cycle (legs back -> tuck -> forward), right hand on the web |
| `talk` | 2.93 | yes |  |  | ual1:Idle_Talking_Loop | talking with hand gestures |
| `talk_2` | 2.93 | yes |  |  | procedural layer | talking (mirrored gestures) |
| `throw` | 1.33 | no |  |  | ual2:OverhandThrow | overhand throw |
| `turn_left` | 1.00 | yes | 0.45 |  | procedural layer | in-place stepping, torso leading left: rotate the character yourself ~100 deg/s |
| `turn_right` | 1.00 | yes | 0.45 |  | procedural layer | in-place stepping, torso leading right |
| `walk` | 1.33 | yes | 1.05 |  | ual1:Walk_Loop | normal walk |
| `walk_carry` | 2.00 | yes | 0.70 |  | ual2:Walk_Carry_Loop | walking carrying a box in front |
| `walk_female` | 1.33 | yes | 1.05 |  | procedural layer | walk with narrow (centre-line) steps |
| `walk_formal` | 1.33 | yes | 1.04 |  | ual1:Walk_Formal_Loop | upright walk, arms straighter |
| `walk_slow` | 1.63 | yes | 0.64 |  | procedural layer | slow short-stride walk (elders) |
| `wave` | 2.50 | yes |  |  | procedural layer | waving the right hand overhead |
| `web_shoot` | 0.67 | no |  |  | procedural layer | right arm snaps forward, "thwip" hand (one-shot) |
| `zip` | 1.00 | yes |  |  | procedural layer | pulling on a web line ahead |

## Verification

Every file was loaded in three.js r186 (GLTFLoader + MeshoptDecoder, headless Chromium / SwiftShader) and played with
AnimationMixer. There was no T-pose leak, no tearing and the scale and orientation were correct. The contact sheets are in `tools/humans/previews/`
(`spiderman_classic_turnaround.jpg`, `spiderman_symbiote_turnaround.jpg`, `spiderman_clips.jpg`, `npc_lineup.jpg`,
`npc_gestures.jpg`, `npc_lod0_vs_lod1.jpg`). The viewer is `tools/humans/verify/viewer.html` and the screenshot script is `tools/humans/verify/shot.mjs`.

Independent review (PMREM environment, shadowed sun, ground plane, close-ups, walking frames and numeric checks with
`tools/humans/verify/review_viewer.html` + `review_shot.mjs`): all loop clips close to within 1 degree, the planted foot moves at the
documented `speed_mps` (x `stride_scale`), no clip or file is missing. The review rebuilt the NPCs to remove garment interpenetration
(shirts through trousers, legs through skirts, sweater hems), blotchy recolours (hoodie, sweaters) and the underwear-like school shorts,
fixed an intermittent Blender crash in the atlas packer, made both Spider-Man suits double-sided (the welded mask has a few slits) and
credited the upstream author of the CC BY sneakers. Review sheets: `tools/humans/previews/review_npc_front.jpg`,
`review_npc_back.jpg`, `review_npc_walk.jpg`, `review_before_after.jpg`.

Known limitations: there are no twist bones, so the forearms candy-wrap a little in extreme twists. The procedural clips (wave, point, climb, swing...) are keyframed,
not captured. Clothes are skinned, not simulated, so long skirts clip the legs a little in wide strides and running. Spider-Man's suit
still shows the MakeHuman toes (a boot-shaped foot needs a remeshed foot, not a smoothing pass). A few tiny specks of the tucked top
show through the pencil skirt's waistband (`woman_blouse_skirt`) and polo / trouser layers touch at the hem in mid-stride. The NPC faces are 1K-atlas quality, which is fine
from 2 m but not for cut-scene close-ups.
