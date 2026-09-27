# Vegetation and street / facade dressing (`public/models/dressing/`)

Real downloaded models, made game-ready, plus a few pieces modelled from the Harare reference photos:

- **Trees and shrubs** from the PlantCatalog "Realistic HD" scans on Sketchfab (CC BY 4.0): jacarandas in bloom
  (two mature trees and a young street tree), a flame tree (*Delonix regia*), a msasa stand-in in its wine-red
  spring flush, a Bauhinia street tree, two Washingtonia fan palms (tall clean trunk for the Samora Machel median,
  shorter with a dead-frond skirt for First Street / the squares), a hibiscus shrub and a round hedge shrub.
- **Facade dressing**: burglar bars (3 patterns), split-AC outdoor units, a wall-mounted DStv-style dish, meter
  boxes, a downpipe.
- **Shopfront dressing**: roller shutters (door and window), cream expanded-metal security grille, trellis gate,
  corrugated and canvas awnings, a projecting sign bracket with a blank board for decals.
- **Street dressing**: a rusty container tuckshop, a vendor table under a blue tarp, an airtime vendor umbrella
  (no logo), razor-wire coil for wall tops, a precast "durawall" panel bay, an ornate iron gate, a banded steel
  bollard and a red / white median-nose block.

The index is [`dressing.json`](dressing.json); licences and authors are in [CREDITS.md](CREDITS.md). Build
scripts, recipes and the verification harness are in `tools/dressing/` (see "Rebuilding").

## Files

For every asset `<name>`:

| file | what |
|---|---|
| `<name>.glb` | LOD0. Trees <= 15k triangles (actual: 3-10k), dressing <= 5k |
| `<name>_lod1.glb` | LOD1 (trees <= 2k triangles, actual 0.3-1.2k; thin dressing: one alpha card). Absent for items that are already cheap |
| `<name>_imp.webp` | trees only: impostor albedo + alpha, 8 azimuth frames (4 x 2 grid) |
| `<name>_imp_n.webp` | trees only: impostor normals for the same frames (quarter resolution, RGB = normal * 0.5 + 0.5) |

## Conventions

- **Units, axes.** Metres, **+Y up**, **front = +Z** (the street side / the side you are meant to look at).
  Rotate about Y only. With the game's heading convention (heading 0 = north = -z) use
  `object.rotation.y = heading + Math.PI` to make the front face along `heading`.
- **Origin by `attach` type** (field in `dressing.json`):
  - `ground` - footprint centred on x = z = 0, bottom at y = 0 (trees: trunk base at the origin).
  - `wall` - back face on the wall plane z = 0, the item sticks out towards +Z, x centred, y = 0 at the item's
    bottom. Place at a point `p` on a facade with outward normal `n`: `position = p`, `rotation.y = atan2(n.x, n.z)`.
    `mount.height` gives the usual height range of y = 0 above the pavement.
  - `window` - as `wall`, sized for a 1.2 x 1.5 m opening (`size`); scale x / y to the real opening.
  - `shopfront` - as `wall`, bottom at pavement level, covers the opening from outside.
  - `wall_top` - centred on the wall's top centre line (x along the wall), bottom at y = 0 = top of the wall.
- **Tiling.** Items with `tile: {axis, length}` repeat seamlessly every `length` metres along that local axis
  (awnings, durawall, razor wire, security grille; the downpipe stacks vertically, see its note).
- **Recolouring.** `recolor` names the material(s) to tint through `material.color` (bars, bollard, umbrella
  canopy...). Canvas awnings come in red and green; the sign board's `sign_face` material has 0..1 UVs on both
  faces for a shop decal (`decal`).
- **Geometry.** `EXT_meshopt_compression` + `KHR_mesh_quantization`: POSITION and TEXCOORD are int16 and
  NORMAL int8, dequantised by the mesh node's scale / offset and (for tiling UVs) `KHR_texture_transform`.
  GLTFLoader handles all of it (`loader.setMeshoptDecoder(MeshoptDecoder)`). **For instancing, bake the node
  transform into the geometry**: `geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)` (the
  `geometries()` helper in `tools/dressing/runtime/dressing.js` does that and returns float geometry per
  material).
- **Textures.** WebP (`EXT_texture_webp`). Foliage atlases 768 px (512 on shrubs) on LOD0, 256 px on LOD1;
  everything else <= 512 px (most dressing 256 px). Alpha-tested materials (`foliage`, `frond`, `cutout`,
  `grille_mesh`) are `alphaMode: MASK`, cutoff 0.5, double-sided.
- **Metadata** per item in `dressing.json`: `height`, `footprintRadius` (largest horizontal reach from the
  origin, for spacing / culling), `baseRadius` (what touches the ground: colliders / pedestrian avoidance),
  `extent` [x, y, z], `tris` [LOD0, LOD1], `bytes`, `tags`, `attach`, plus per-item `mount`, `tile`, `recolor`,
  `note`, `decal`, `size`, `anchors` (web-swing points, item space). Trees add `trunkRadius`, `crown`
  {cy: crown centre height, rh: horizontal radius, rv: vertical half size} and `impostor`.

## Trees: LOD, wind, lighting

- **Suggested switch distances** (`lodDistances`): LOD0 < 45 m, LOD1 45-160 m, impostor beyond (to the draw
  distance). Phones / `quality.level === 'low'`: LOD0 < 25 m, LOD1 < 90 m. With ~30 trees inside 45 m that is
  ~200k triangles of LOD0 foliage - the old procedural canopies used ~500-900 triangles per tree but read as
  faceted blobs close up.
- **How the LODs were made** (`tools/dressing/tree_build.py`): the source (150-450k triangles) is scaled to a
  Harare-sized tree; trunk and main limbs are kept and decimated; leaves, flowers, twigs and thin branches are
  rendered from outside the crown into a 4 x 4 atlas of "clump" images (so the cards show the real leaves and
  blossom of the scan); the foliage is then rebuilt as ~1-2k alpha-tested quads at the real foliage positions,
  with normals bent to the crown ellipsoid for soft, volumetric lighting. Palms keep every frond as a bent
  4 x 4 card fitted to the real frond shape (12 template fronds rendered into the atlas) plus the dead-frond
  skirt cards of the scan.
- **Foliage material.** Patch the glTF foliage materials with `patchVegetationMaterial()` from
  `tools/dressing/runtime/dressing.js`: it keeps the outward crown normal on back faces (three.js flips normals
  on back faces of double-sided materials, which would darken half of every card), scales alpha with the mip
  level so distant canopies do not thin out, and adds wind. For shadows give foliage meshes
  `customDepthMaterial = new THREE.MeshDepthMaterial({ map, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide })`
  (dappled shade).
- **Wind.** `TEXCOORD_1` (three.js `uv1`): x = sway weight `(y / H)^1.5` (0 at the ground, 1 at the top), y =
  flutter weight (0 on bark / trunk, 0.6-1 on leaf cards and fronds, also a per-leaf phase seed; 0.3-0.5 on palm
  skirts). The patch reads it; drive `windUniforms.uWindTime` from the game clock.
- **Impostors.** `createImpostorMesh(entry, albedoTex, normalTex, count)` returns an `InstancedMesh` of
  cylindrical billboards. Frame k (k = 0..7, row-major in the 4 x 2 grid, row 0 at the top of the image) shows
  the tree seen from azimuth k * 45 deg, i.e. from the direction (sin a, 0, cos a) in the tree's own space
  (frame 0 = seen from +Z). The shader picks and blends the two frames nearest to the camera direction relative
  to each instance's rotation, and lights with the normal atlas (x = frame right, y = up, z = towards the
  viewer). The quad is `frameW` x `frameH` metres, bottom at the tree's origin; instance scale scales it.
  Feed it the sky's sun direction / colours (`lights` option) so it matches the lit LODs.
- **Species mapping** for `src/world/vegetation.js` planting: `jacaranda` -> `jacaranda_bloom_a` /
  `jacaranda_bloom_b` (alternate; scale 0.85-1.15), young / small street plantings -> `jacaranda_young`;
  `flame` -> `flame_tree`; `msasa` -> `msasa`; `green` -> `bauhinia_street` (green with a little pink blossom);
  `palm` -> `palm_washingtonia_tall` on medians and avenues (Samora Machel, Julius Nyerere),
  `palm_washingtonia_skirt` on First Street, in Africa Unity Square and hotel frontages; `cypress` and
  `eucalyptus` have no scan here - keep the procedural models. Shrubs (`shrub_hibiscus`, `shrub_round`) go in
  medians, planters (`props/planter_concrete` at y = 0.5), gardens and along durawalls.
- **Web anchors / collision.** Crown top = `height`; `crown` gives the canopy volume (the current
  `treeCrown()` values); trunk collider radius = `trunkRadius`.

## Placement notes (Harare look, from the reference photos)

- **Avenues** (Takawira, Nelson Mandela, Jason Moyo...): jacarandas every 10-12 m on both verges, rotation
  random, scale 0.9-1.1, alternate `_a` / `_b`; the crowns meet over the road. Bare red-earth verges.
- **Samora Machel / Julius Nyerere medians**: `palm_washingtonia_tall` every 12 m, shrubs between.
- **First Street Mall**: `palm_washingtonia_skirt` and shade trees in raised planters.
- **Shopfronts** (CBD ground floors): `roller_shutter_shop` or `security_mesh_grille` across most openings
  (closed at night), `trellis_gate` on doors, `awning_corrugated` / `awning_canvas_*` on 1-2 storey shops,
  `sign_bracket` every few shops.
- **Upper floors**: `burglar_bars_*` on 1st-3rd floor windows of residential / older blocks, `ac_unit_*` on
  1-3 windows per floor (more on offices), `satellite_dish_wall` on flats, `downpipe` at building corners,
  `meter_boxes` near service doors.
- **Suburbs / fringe**: `durawall_panel` runs with `razor_wire_coil` on top, `gate_iron_ornate` at driveways.
- **Vendors**: `vendor_stall` and `umbrella_airtime` on busy pavements and at ranks (with the props' crates,
  chairs and drums), `tuckshop_kiosk` on corners and at ranks.
- **Road edges**: `bollard_steel_banded` at forecourts and corners, `barrier_block_redwhite` at median noses.

## The assets

<!-- TABLE -->
<!-- /TABLE -->

## Loading

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DressingLibrary } from './dressing.js';          // copy of tools/dressing/runtime/dressing.js
const lib = await DressingLibrary.load('models/dressing/', { gltfLoader: new GLTFLoader().setMeshoptDecoder(MeshoptDecoder) });
// instanced street trees
for (const { geometry, material } of await lib.geometries('jacaranda_bloom_a', 0)) {
  const im = new THREE.InstancedMesh(geometry, material, count);   // geometry in metres, float positions
}
const far = lib.impostors('jacaranda_bloom_a', 800);                // InstancedMesh; setMatrixAt(i, treeMatrix)
lib.update(dt);                                                     // wind time
```

## Rebuilding

```
S=<scratch>; export SCRATCH=$S DRESSING_RAW=$S/dressing/raw DRESSING_WORK=$S/dressing/work
python3 $S/dressing/sf_dl.py <uid> <folder>                  # Sketchfab downloads (token read at run time), see CREDITS
$BLENDER_PY tools/dressing/tree_build.py -- [names]          # trees.json recipes  -> $DRESSING_WORK/<name>/
$BLENDER_PY tools/dressing/items_build.py -- [names]         # dressing            -> $DRESSING_WORK/<name>/
NODE_PATH=<gltf-transform+sharp node_modules> node tools/dressing/pack.cjs [names]   # -> this folder + dressing.json
python3 tools/dressing/make_docs.py                          # CREDITS.md + the table above
node tools/dressing/verify/server.mjs 8795 & node tools/dressing/verify/shot.mjs out.png scene.json   # three.js checks
```
