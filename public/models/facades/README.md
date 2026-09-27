# Harare facade kit (`public/models/facades/`)

Modular, real-depth facade pieces for the recurring building types of Harare CBD, modelled from freely licensed
photos of the city, plus real scanned / modelled attachments (air conditioners, roll-down shutters, downpipes).
A builder tiles them onto any footprint edge from `public/data/harare.json`, so an extruded box becomes a
building with recessed windows, frames, sills, spandrels, fins, balconies, shopfronts, canopies and verandahs.

- **9 facade types**, one GLB each (`<type>.glb`): every module at LOD0 (real geometry) and LOD1 (a flat quad
  UV-mapped into a baked atlas), plus a per-type **impostor** texture for far walls.
- **`common.glb`**: shared attachments (pavement canopy, window AC unit, split AC unit, roll-down shutter,
  downpipe + shoe + hopper, burglar bars, projecting blade sign).
- **`kit.json`**: every module's metadata (kind, size, pivot, stretch range, anchors, materials, triangle
  counts), the default materials and photo palettes of each type, the tiling rules, the atlas rectangles and
  the impostor layout.
- **`tex/`**: per-type LOD1 atlases and impostors (albedo, normal, ORM, mask; WebP).
- The PBR materials themselves are **not** duplicated: modules name the CC0 sets of `public/textures/` by role.
- Reference builder: [`tools/facades/kit_builder.js`](../../../tools/facades/kit_builder.js) (three.js r186).
  Verification page and shots: `tools/facades/verify/`.

Licences and sources: [CREDITS.md](CREDITS.md). Everything is CC0 except the two Sketchfab air conditioners
(CC BY 4.0, attribution in CREDITS.md).

<!-- gen:sizes -->
<!-- /gen:sizes -->

---

## Facade type catalogue

The types below are what the photos of central Harare show again and again. Each lists the photos it was built
from (the ~800 px copies are in the orchestrator scratch `photos/` folder; the links go to the file pages). No
photo pixels were used in any texture.

| type | looks like | typical height | where in the CBD |
|---|---|---|---|
| `ribbon` | 1950s-70s concrete office slab: continuous aluminium ribbon windows over pastel spandrel panels (mint Throgmorton House, orange-tan, powder blue); brick or mosaic end walls; variant with sloped precast sunshade hoods (Batanai Gardens) | 6-18 floors | everywhere in the core |
| `fins` | vertical concrete fins / brise-soleil 0.6 m deep, two per bay; variant with angled sawtooth fins (First Street) | 5-15 floors | Samora Machel, First St, Union Ave |
| `eggcrate` | deep (0.8 m) egg-crate grid of floor shelves and fins over recessed glass and coloured spandrels | 6-15 floors | Jason Moyo / First St, the Avenues edge |
| `curtain` | blue / teal reflective stick curtain wall with granite piers and a granite crown | 12-28 floors | RBZ, Karigamombe, Samora Machel towers |
| `glassgranite` | 1990s light-grey granite piers and spandrels, recessed blue glass ribbons, set-back galleries | 6-18 floors | Kwame Nkrumah, Samora Machel |
| `brick` | red-brown face-brick blocks with punched white steel windows (glazing bars), precast sills and lintels, concrete corner piers | 2-12 floors | CABS, Union Buildings, the whole grid |
| `colonial` | 1-2 storey painted colonial shops: pilasters, sash windows with moulded surrounds, arched ground windows with burglar bars, cornice + parapet name panel, corrugated verandahs on cast-iron columns | 1-3 floors | Kopje side, west Robert Mugabe Rd, First St south end |
| `deco` | 1930s-50s rendered commercial blocks (Art Deco / Moderne): steel windows with horizontal bars, eyebrow ledges, pilaster strips, ground-floor arcades | 3-7 floors | Speke, Nelson Mandela, Kwame Nkrumah |
| `avenues` | flat-roof residential blocks: projecting balconies with painted solid parapets or steel tube rails, recessed loggias, burglar-barred windows | 3-8 floors | the Avenues, CBD fringe |

<!-- gen:types -->
<!-- /gen:types -->

## Shared attachments (`common.glb`)

<!-- gen:common -->
<!-- /gen:common -->

---

## Conventions

**Units and axes.** Metres. Module space is glTF space: **x runs along the wall to the right as seen from the
street, y is up, +z points outward (towards the street)**. The wall plane, i.e. the footprint line, is z = 0.
Projections (fins, sills, balconies, hoods, canopies) have z > 0; recessed glass and reveals have z < 0.

**Pivot.** Every module is a node at the origin with an identity transform. Its pivot is the bottom-left corner
of its tiling rectangle `[0, width] x [0, height]` on the wall plane, so modules placed at `x = k * width` and
`y = floor base` tile seamlessly. Corner modules are the exception: their pivot is the footprint corner, their x
runs along the **outgoing** wall (the next wall to the right seen from outside) and the incoming wall lies along
-z.

**Standard sizes.** Bays are 3.0-3.6 m wide (`types[t].bay`), floors 3.0-3.6 m (`types[t].floor`), ground floors
4.2-4.8 m, caps (parapet / cornice / crown) 0.9-1.5 m. Each module's `stretch.x` / `stretch.y` gives the range it
may be scaled to (typically 0.85-1.25 x the bay; blank walls and piers stretch much further).

**Floors.** A module is for `floor: ground | middle | top | any`. `kind` is `bay` (window bay), `ground`
(shopfront, entrance, lobby, arcade), `cap` (roof line), `blank` (solid wall), `pier` (narrow filler),
`corner`, or `attachment`.

**Materials (roles).** glTF materials are named by role and carry no textures:

| role | default PBR set (varies per type) | notes |
|---|---|---|
| `wall` | concrete_painted / brick_face_red / plaster_smooth / granite_cladding_light | tintable (mask R) |
| `trim` | concrete_painted, plaster_smooth, granite | slab bands, sills, lintels, cornices, hoods; tintable (mask G) |
| `accent` | concrete_painted, concrete_weathered, granite_dark_tiles | spandrels, fins, balcony fronts; tintable (mask B) |
| `plinth` | granite_dark_tiles, concrete_weathered | stall risers, steps, plinths |
| `frame` | window_frame_aluminium tinted (white, silver, bronze, dark green) | frames, mullions, glazing bars, sill flashings |
| `glass` | interior-mapped glass | see below |
| `glass_spandrel` | opaque dark glass | curtain-wall spandrels |
| `metal` | window_frame_aluminium tinted dark | bars, railings, verandah columns, shutter boxes |
| `roof_sheet` | corrugated_weathered | verandah roofs |
| `sign` | plain panel, **UV 0..1 across the board** | fascia boards, parapet name panels, canopy fascias, blade signs: put shop-sign textures here (`anchors.sign`) |
| `atlas` | the type's LOD1 atlas | LOD1 quads only |

`kit.json → types[t].materials[role]` = `{pbr, tint, tintLinear, factor}`: `pbr` is the set in
`public/textures/materials.json` (`texture.repeat = 1 / tileSizeMetres`), `factor = tintLinear / avgColorLinear` is
the colour multiplier to apply to its albedo (it may exceed 1; the colour stored in the GLB is clamped for
preview). `types[t].palette[role]` lists the other tints seen in the photos. A builder can also swap the PBR set of
a role per building (e.g. Batanai Gardens: spandrels `brick_face_red`, hoods painted green).

**UVs.** `TEXCOORD_0` is in metres (world-aligned box projection per face: vertical faces `v = height`, front
faces `u = x`, side faces `u = depth`, horizontal faces `u = x, v = depth`). After stretching a module and placing
it on a wall, **re-project** so textures run continuously along the wall and up the floors:
front / horizontal faces `u = u * sx + distanceAlongWall`, front / side faces `v = v * sy + floorBase`
(`kit_builder.js` does this; without it, every bay restarts the texture).

**Glass and interiors.** Glass panes are recessed 0.10-0.25 m (curtain walls sit on the wall plane) and use
[`tools/materials/interior_glass.js`](../../../tools/materials/interior_glass.js). `TEXCOORD_1` (three.js `uv1`)
holds the **room coordinates** of the room behind the window: `x = 2 * roomIndex + u` (u 0..1 across the room,
which is usually the whole bay, so mullions sit in front of one room) and `y = 0..1` floor to ceiling. Pass
`winUv = (uv1.x - 2 * floor(uv1.x / 2), uv1.y)` and a per-room `winData = (cell, mirror, lightOn, depth)` chosen by
a hash of (building, floor, bay, room): modules carry `interior: office | shop | residential | lobby` for the cell
choice; `types[t].roomDepth` is the depth.

**Anchors** (module space, glTF axes). `ac: [[x, y, z]]` bottom-centre of a window AC unit (place
`common.ac_window` there: its origin is 0.35 m behind its grille, so it pokes 0.25 m out of the wall);
`bars: [{x0, y0, x1, y1, z}]` window rectangles for `common.bars` (a 1 x 1 m grid: scale to the rectangle);
`shutter: [{...}]` the shop opening for `common.shutter`; `sign: [{...}]` the sign board rectangle;
`canopy: [[x, y, z]]` underside of a pavement canopy; `verandah: [[...]]`.

**LODs.**

| level | what | use | cost |
|---|---|---|---|
| LOD0 | module nodes `<type>_<module>` | < ~60 m | 2-240 triangles per module (a window bay is ~60-130) |
| LOD1 | `<type>_<module>_lod1`: flat quad (corner: 2 quads) in the type's atlas; canopies / verandahs keep a simplified mesh | ~60-220 m | 2 triangles per module, 1 draw call per building |
| LOD2 | impostor: plain wall strips per edge, `types[t].impostor` texture | > ~220 m, phones | 2 triangles per wall strip (ground, pairs of middle floors, cap) |

**Atlas and impostor textures** (`tex/<type>_atlas_*`, `tex/<type>_imp_*`), baked orthographically from LOD0 with
Cycles:

- `albedo` sRGB RGB. Ambient occlusion is partly multiplied in (x 0.7-1.0) so recesses stay dark in sunlight,
  which a flat quad cannot self-shadow.
- `normal` tangent space, OpenGL (+Y up). RGB combines the PBR normal detail with a normal derived from the depth
  pass (reveals, frames and fins become soft bevels). **Alpha = height above the wall plane**,
  `h = (a - 0.5) * 3 m`, for parallax if wanted.
- `orm` R = AO, G = roughness, B = metalness.
- `mask` (lossless) R / G / B = weight of the tintable roles wall / trim / accent, **A = glass**. Re-tint per
  building in linear space with `albedo * (1 + Σ mask_i * (factor_i / defaultFactor_i - 1))`, and use A for
  lit windows at night and glassy roughness.
- Atlas UV rectangles: `types[t].atlas.rects[module] = {px: [x, y, w, h], uv: [u0, v0, u1, v1]}` (glTF UV space,
  `flipY = false`). Normal / ORM / mask of the atlas are half resolution (same UVs).
- The impostor is **2 bays wide** (`wrapS = RepeatWrapping`): rows `ground`, `middle` (two floors) and `cap`,
  `types[t].impostor.rows[k] = [v0, v1]` in glTF UV space (v = 0 at the top of the image). Map a wall of `n` bays
  to `u = 0 .. n / 2`, one quad per pair of middle floors (an odd last floor uses the lower half of the row).

**Compression.** `EXT_meshopt_compression` (`gltfLoader.setMeshoptDecoder(MeshoptDecoder)`), NORMAL int8 via
`KHR_mesh_quantization`, POSITION / TEXCOORD float32 (no dequantisation transforms, so `mesh.geometry` is in
metres). `common.glb` embeds its own WebP textures (`EXT_texture_webp`, 256 px).

**Node names.** three.js strips `.` from glTF node names, so nodes are `<type>_<module>` and
`<type>_<module>_lod1` (`kit.json` gives both as `node` / `lod1Node`).

---

## Assembling a building

`kit.json → types[t].rules` and the reference builder implement this; the city can port it to its own
GeoBuffer path.

1. **Floors.** `planFloors(h)`: ground floor `groundFloor`, `n = round((h - groundFloor - cap) / floor)` middle
   floors, a cap on top; then stretch the floor height (2.9-4.3 m) and, if needed, the ground floor (3.4-5.8 m) so
   the cap ends exactly at `h` (harare.json roof height). Buildings shorter than ground + cap get a single stretched
   ground floor and a thinner cap.
2. **Ring orientation.** Orient the footprint so that walking from `A` to `B` the outward normal is
   `n = (-dz, 0, dx)` (x east, z south: signed area in (x, z) < 0). Then module x = the edge direction and module
   +z = `n`. Build each module's matrix from the basis `(d * sx, up * sy, n)` and the origin
   `A + d * s + up * floorBase`.
3. **Corners.** At a convex corner of 90 ± 20 degrees place the type's `corner` module at the corner, in the frame
   of the outgoing edge, stretched to the full height; trim both edges by `corner.width`. Other convex corners trim
   0.3 m, concave corners trim the maximum bay projection; trims are filled with a flat `pier` stretched to the full
   height. Nearly straight vertices (< 10 degrees) are ignored.
4. **Bays.** On the remaining span `L`, `n = max(1, round(L / bay))` bays of width `L / n` (inside the modules'
   stretch range); spans shorter than 0.6 bay get a single stretched `pier` (and a stretched cap). Middle floors
   use a **column pattern** (the same module all the way up a column, e.g. `[bay]`, `[bay, bay, bay_pair]`,
   Avenues `[bay_balcony, bay_window]`), chosen per building from `rules.middle` (+ `rules.middle_alt`). On slab
   types, short end walls (< 35 % of the longest edge) become `blank` walls with `ground_blank` shops.
5. **Ground floor.** Pick per bay from `rules.ground` (one `entrance` in the middle of long edges). Deco arcades
   come in runs closed by `arcade_end` (mirrored at the right end). Shops take a `common.canopy` at
   `groundFloor - 0.55 m` when the building draws `rules.canopy`; colonial shops on the frontage take `verandah`
   bays (+ one `verandah_post` at the run end) when it draws `rules.verandah`.
6. **Top.** `rules.top` on every bay (`rules.top_centre`, e.g. the colonial name panel, on the centre bay of the
   longest edge).
7. **Attachments.** `rules.attachments.ac` = probability of a window AC unit per middle bay (on `anchors.ac`; one
   in five is a split unit on the wall below), `bars` = probability of burglar bars on ground / first floor
   windows, `pipe` = downpipe spacing in metres (shoe at the pavement, downpipe stretched up to a hopper under the
   cap, at bay joints). Some shopfronts get the real shutter pulled down (`closedShops`, more at night).
8. **Merge.** Transform each module's primitives, re-project metre UVs (see Conventions), write the tint factor
   into a vertex `color` attribute and merge **per PBR material** (one draw call per PBR set per building: a
   typical 10-storey block is ~8-12 draw calls at LOD0). LOD1 quads merge into one mesh with per-vertex tint
   factors (`aTint0..2`) for the mask re-tint shader; LOD2 is one mesh.

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FacadeKit } from './kit_builder.js';            // tools/facades/kit_builder.js
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const kit = await FacadeKit.load({ base: 'models/facades/', textures: 'textures/', gltfLoader, renderer });
for (const b of data.buildings) {
  const built = kit.build(b.fp, b.h, { type: chooseType(b), seed: b.id });   // + middle, ground, materials, tints, canopy, verandah
  scene.add(built.lod);                                   // THREE.LOD 0 / 60 / 220 m
}
kit.setNight(sky.nightFactor);                            // interior glass exposure + lit atlas / impostor windows
```

`build()` returns `{lod, lod0, lod1, lod2, plan, tints, stats: {modules, tris: [l0, l1, l2], drawCalls}}`.

---

## Integration notes for the city renderer

- **Choosing a type.** `src/world/buildings.js → planBuilding` already picks an analytic style per building.
  Map it: `bands → ribbon`, `fins → fins`, `grid → eggcrate` (deep) or `brick`, `curtain → curtain` (towers) or
  `glassgranite`, `punched / pair → brick` or `deco`, `balcony → avenues`, `colonial → colonial`,
  `brick → brick`. Landmarks keep their own code. Use `style.facade / accent / glass` from
  `tools/landmark_overrides.json` as tint overrides (`opts.tints`), `buildings[].material === 'brick'` → `brick`.
- **Where to spend LOD0.** Only buildings within ~60 m of the camera (a few at a time) need LOD0; LOD1 is one
  draw call and 2 triangles per module; LOD2 is a handful of triangles per wall. On phones use LOD1 from ~35 m and
  the impostor beyond ~120 m, and skip attachments.
- **Collision** stays on the footprint: modules project at most 1.3 m (balconies), canopies 2.4 m and verandahs
  2.8 m over the pavement; `deco` arcades recess 3 m behind the footprint line (visual only).
- **Signs.** Put the shop sign textures of `src/world/shops.js` / `signs.js` on the `sign` role (UV 0..1 per
  board, `anchors.sign`); the builder's `opts.signMaterial` takes one material for all boards.
- **Night.** `kit.setNight(f)` lowers `uDarkLevel` / raises `uExposure` of the interior glass and turns on lit
  windows in the atlas / impostor masks (hash per window cell). Closed shops: `closedShops` fraction.
- **Web swinging.** Canopy fronts, cornices and balcony slabs are natural anchor lines; the builder's
  `placements` list (module, matrix) can be used to emit anchors.

---

## Verification

`tools/facades/verify/` is a headless three.js page (Chromium + SwiftShader) that assembles real
footprints / heights from `harare.json` with the kit and renders them next to the reference photos.

```
node tools/facades/verify/server.mjs 8793 &
node tools/facades/verify/shoot.mjs lineup.png "scene=lineup&type=brick&dist=30"          # modules + a test block
FACADE_PHOTOS=<photos> FACADE_SHOTS=<out> python3 tools/facades/verify/run_shots.py       # shots.json side by side
```

`shots.json` holds the street-level, rooftop and night shots (Batanai Gardens / Edgars on Jason Moyo, CABS on
First Street Mall, Jason Moyo looking west, Nelson Mandela Ave, colonial shops on Robert Mugabe Rd, an Avenues
block, a swing-height view and a night view).

## Rebuilding

```
export FACADE_WORK=<scratch dir>                     # raw downloads, Blender output, bake passes (not in the repo)
SKETCHFAB_TOKEN_FILE=<token file> python3 tools/facades/fetch_assets.py
<blender-python> tools/facades/kit_blender.py [types...] [--no-bake] [--preview]    # ~2 min per type (Cycles bakes)
python3 tools/facades/atlas_post.py                  # passes -> tex/*.webp
FACADE_PHOTOS=<photos> python3 tools/facades/make_refs.py
NODE_PATH=<gltf-transform node_modules> node tools/facades/optimize_kit.cjs     # meshopt GLBs + kit.json
python3 tools/facades/write_docs.py                  # CREDITS.md + generated tables of this README
```

Geometry lives in `tools/facades/kit_modules.py` (one generator per module; `TYPES` holds dimensions, materials,
palettes; `RULES` the tiling rules) on top of the mesh helpers in `kitlib.py`.
