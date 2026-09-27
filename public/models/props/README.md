# Street props (`public/models/props/`)

31 game-ready street and rooftop props for Harare CBD. Each prop comes as two files:

- `<name>.glb` is **LOD0**: at most 3000 triangles, textures at most 512 px (1024 px for the concrete barrier).
- `<name>_lod1.glb` is **LOD1**: at most 600 triangles, textures 128–256 px.

All together they are **3.81 MB**. The index is [`props.json`](props.json) and the licences are in
[CREDITS.md](CREDITS.md). All props are CC0: 16 are Poly Haven scans, and 15 were modelled for this project by
`tools/materials/props_blender.py` (street lamps, bollards, bus shelter, dish, JoJo tanks, vendor umbrellas,
cone, planter).

## Conventions

- **Units and origin.** Metres, **y up**. The feet are at y = 0 and the footprint is centred on x = z = 0, so
  place a prop with `object.position.set(x, groundY, z)`.
- **Front is +Z.** That is the bench seat side, the AC grille, the open side of the bus shelter and the arm of
  `street_lamp_single`. Rotate about Y to face the street. The heading convention used by the game
  (`heading` 0 = facing north = −z) means a prop with `rotation.y = heading + Math.PI` faces along `heading`.
- **Geometry.**
  - It uses **`EXT_meshopt_compression`**, so call `gltfLoader.setMeshoptDecoder(MeshoptDecoder)` from
    `three/addons/libs/meshopt_decoder.module.js`. The decoder ships inside the `three` package, so there is no
    new npm dependency.
  - POSITION and TEXCOORD are float32 and there are **no dequantisation node transforms**, so `mesh.geometry`
    can be dropped straight into an `InstancedMesh` in metres.
  - NORMAL is int8 (normalised). Core glTF does not allow that, so every file lists **`KHR_mesh_quantization`**
    in `extensionsRequired`; GLTFLoader supports it (it only affects the NORMAL accessor type here). The files pass
    the Khronos glTF validator with no errors (`node tools/materials/glb_declare_quantization.cjs --check` checks
    the declaration). `mergeGeometries` needs matching attribute types, so before merging a prop with float-normal
    geometry convert its normals:
    `const n = g.attributes.normal; g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from({ length: n.count * 3 }, (_, i) => n.getComponent(i / 3 | 0, i % 3)), 3));`
    (`getComponent` de-normalises).
- **Textures.** Textures are **WebP** (`EXT_texture_webp`; every browser that runs WebGL2 decodes it). PBR is
  standard glTF metal/rough: `baseColorTexture`, `normalTexture`, and `metallicRoughnessTexture` + occlusion in
  one ORM texture for the scans. GLTFLoader sets everything up.
- **Procedural props.** They use a single material, **`PropPalette`**, with a 128 px swatch texture (`palette`)
  and a matching ORM swatch texture (`palette_orm`): 8 × 8 swatches of 16 px, WebP like every other texture.
  UVs sit at swatch centres, where the lossy WebP stays within 2/255 of the `PALETTE` colours, and the sampler
  is nearest-filtered, so each prop is one draw call with crisp colours.
  - The street lamps add a second material, **`LampLens`**, for the luminaire lenses. At night set
    `mat.emissive.setRGB(1, 0.92, 0.8); mat.emissiveIntensity = 4–8`, driven by `sky.nightFactor`.
  - To recolour a procedural prop, clone the palette texture and repaint a swatch; the palette index is in
    `props_blender.py` → `PALETTE`.
- **Structure.** Each GLB has one mesh with one primitive per material:
  - scans have 1–3 materials;
  - procedural props have `PropPalette`, plus `LampLens` on the lamps.

  In three.js that is one `Mesh`, or a `Group` of Meshes when there are several materials.
- **Metadata in `props.json`, per prop.**
  - `height`: the top of the model.
  - `footprintRadius`: the largest horizontal reach from the origin, for spacing and culling.
  - `baseRadius`: the radius of what touches the ground. Use it for colliders, `city.obstacles`
    (`{x, z, r: baseRadius}`) and pedestrian avoidance.
  - `extent`: x and z size.
  - `tris [lod0, lod1]` and `bytes`.
  - `anchors`: web-swing points in prop space `[x, y, z]`. They exist for street lamps (pole top and each arm
    tip), the umbrella tops and the front edge of the bus-shelter roof. Transform them with the prop's matrix and feed them to
    `city.anchorsNear()`.
  - `tags`, `materials`, `source` and `notes`.

## The props

| name | height m | reach r | base r | tris LOD0 / LOD1 | KB LOD0 / LOD1 | source |
|---|---|---|---|---|---|---|
| `street_lamp_double` | 10.21 | 2.48 | 0.28 | 268 / 268 | 9 / 9 | procedural |
| `street_lamp_double_solar` | 10.86 | 2.48 | 0.28 | 332 / 332 | 10 / 10 | procedural |
| `street_lamp_double_solar_ew` | 10.86 | 2.48 | 0.28 | 332 / 332 | 10 / 10 | procedural (panel toward +X, for east–west roads) |
| `street_lamp_single` | 8.21 | 2.48 | 0.28 | 216 / 216 | 8 / 8 | procedural |
| `bench_timber` | 0.87 | 1.27 | 1.27 | 2936 / 572 | 272 / 42 | Poly Haven *modular_street_seating* (assembled) |
| `bin_metal` | 0.91 | 0.33 | 0.28 | 2940 / 572 | 151 / 23 | Poly Haven *metal_trash_can* (open, lid removed) |
| `bollard_concrete` | 0.84 | 0.15 | 0.15 | 168 / 168 | 5 / 5 | procedural |
| `bollard_painted` | 0.84 | 0.15 | 0.15 | 252 / 252 | 6 / 6 | procedural (red / white bands) |
| `barrier_concrete` | 0.83 | 0.82 | 0.82 | 2940 / 572 | 466 / 34 | Poly Haven *concrete_road_barrier* (1024 px textures) |
| `planter_concrete` | 0.60 | 0.85 | 0.85 | 72 / 72 | 4 / 4 | procedural (1.2 m square, soil at 0.5 m) |
| `fire_hydrant` | 0.80 | 0.18 | 0.17 | 2940 / 572 | 150 / 26 | Poly Haven (US-style pillar; **optional**, not typical of Harare) |
| `bus_shelter` | 2.82 | 2.48 | 2.48 | 472 / 472 | 10 / 10 | procedural (4.0 × 1.7 m, advert panel, bench) |
| `ac_unit` | 0.61 | 0.40 | 0.40 | 2993 / 577 | 255 / 33 | Poly Haven *exterior_aircon_unit* (outdoor unit on its wall brackets; the scan's dangling drain pipe was removed so the brackets are the feet) |
| `satellite_dish` | 1.64 | 0.45 | 0.35 | 432 / 432 | 7 / 7 | procedural (0.9 m dish on ballast frame, faces −Z / north) |
| `water_tank` | 2.10 | 0.93 | 0.93 | 796 / 588 | 11 / 9 | procedural (JoJo-style ribbed green tank, about 2500 L) |
| `water_tank_stand` | 4.16 | 1.13 | 1.11 | 952 / 587 | 12 / 10 | procedural (same tank on a 2 m rusty steel stand) |
| `crate_plastic_yellow` | 0.25 | 0.30 | 0.30 | 2940 / 572 | 140 / 26 | Poly Haven *plastic_crate_02* |
| `crate_plastic_red` | 0.27 | 0.27 | 0.27 | 2939 / 588 | 239 / 31 | Poly Haven *plastic_crate_03* |
| `chair_monobloc` | 0.88 | 0.44 | 0.44 | 2940 / 572 | 152 / 29 | Poly Haven *plastic_monobloc_chair_01* |
| `umbrella_red_white` | 2.55 | 1.25 | 0.25 | 168 / 168 | 7 / 7 | procedural (vendor umbrella, weighted base) |
| `umbrella_blue_yellow` | 2.55 | 1.25 | 0.25 | 168 / 168 | 7 / 7 | procedural |
| `umbrella_green_white` | 2.55 | 1.25 | 0.25 | 168 / 168 | 7 / 7 | procedural |
| `plant_aloe_pot` | 0.80 | 0.30 | 0.27 | 2939 / 572 | 194 / 26 | Poly Haven *potted_plant_04* (scaled from a 17 cm desk aloe) |
| `plant_leafy_pot` | 0.84 | 0.44 | 0.42 | 2972 / 571 | 210 / 35 | Poly Haven *potted_plant_02* (terracotta) |
| `trash_bag` | 0.57 | 0.26 | 0.26 | 2940 / 572 | 147 / 24 | Poly Haven *trashbag* |
| `traffic_cone` | 0.70 | 0.27 | 0.27 | 200 / 200 | 6 / 6 | procedural |
| `electrical_box` | 1.12 | 0.51 | 0.49 | 2939 / 572 | 142 / 27 | Poly Haven *utility_box_02* (green street kiosk) |
| `drum_plastic_blue` | 0.88 | 0.24 | 0.24 | 2688 / 572 | 94 / 21 | Poly Haven *Barrel_02* (blue water drum, vendors) |
| `cardboard_box` | 0.34 | 0.31 | 0.31 | 2938 / 572 | 121 / 18 | Poly Haven *cardboard_box_01* |
| `tyre_old` | 0.60 | 0.30 | 0.30 | 2880 / 572 | 142 / 20 | Poly Haven *old_tyre* (standing on its tread) |
| `manhole_cover` | 0.07 | 0.34 | 0.34 | 2940 / 572 | 160 / 30 | Poly Haven *water_manhole_cover* ("WATER"). Sink it about 6 cm (`y = -0.06`) so it sits flush |

## Placement notes (Harare look)

- **Street lamps** (PHOTOS.md §20).
  - Put `street_lamp_double` / `street_lamp_double_solar*` in the **median** of dual carriageways such as Samora
    Machel and Julius Nyerere, with the arms (local ±X) across the road, every 30–35 m.
  - Solar panels must face **north** (Harare is at 17.8° S). There are two solar variants so that both the arms
    and the panel are right:
    - `street_lamp_double_solar`: panel tilts toward local −Z. For **north–south** roads use `rotation.y = 0`
      (arms point east / west across the road, panel faces north).
    - `street_lamp_double_solar_ew`: panel tilts toward local +X. For **east–west** roads such as Samora Machel,
      Jason Moyo and Nelson Mandela use `rotation.y = +π/2` (arms point north / south across the road, panel
      faces north).
    - Do not rotate either by π: the panel would face south. For the plain `street_lamp_double` any of 0, π/2,
      π works. For a road at another bearing, pick the variant whose arms are closest to perpendicular.
  - Use `street_lamp_single` on side streets at the kerb with +Z toward the carriageway.
  - The pole tops at 8–10 m are the web anchors `city.anchorsNear()` already expects.
- **Rooftops.** Scatter `water_tank_stand` / `water_tank` (the very common JoJo tanks), `ac_unit` and
  `satellite_dish` on low and mid-rise flat roofs: 1–3 per roof, more on residential blocks.
- **Vendors.** On busy sidewalks, at ranks and at markets, cluster an umbrella with 2–4 crates, a monobloc
  chair, a blue drum and cardboard boxes.
- **Sidewalks.** Put `bollard_painted` at corners and forecourts, `bin_metal` every 40–60 m, and `bench_timber`
  in parks and on First Street.
- **Ranks.** Use `bus_shelter` at kombi ranks and bus stops, with its front (+Z) to the kerb. The advert face
  is the `ad_panel` swatch; overlay a poster decal for branding.
- **Roadworks.** Use `traffic_cone` and `barrier_concrete` for roadworks and median noses.
- **Planters.** `planter_concrete` has room for vegetation props at y = 0.5.
- **Hydrants.** Keep `fire_hydrant` rare or skip it.

## Loading

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const man = await (await fetch('models/props/props.json')).json();
const lamp = man.props.find((p) => p.name === 'street_lamp_double');
const gltf = await loader.loadAsync('models/props/' + lamp.file);
// Instancing: one InstancedMesh per (mesh, material) of the GLB
gltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  const im = new THREE.InstancedMesh(o.geometry, o.material, count);  // o.geometry is in prop space (metres)
  // o.matrixWorld is identity for these files; combine it anyway if you re-parent
});
```

Use LOD0 within about 35–60 m and LOD1 beyond, or LOD1 everywhere on `quality.level === 'low'`. The LOD1 files
are self-contained; they do not share textures with LOD0.

## Rebuilding

```
export MAT_CACHE=/tmp/spiderman-materials-cache
python3 tools/materials/fetch_ph_models.py               # Poly Haven glTF + 1k textures -> $MAT_CACHE/phm
$BLENDER_PY tools/materials/props_blender.py             # assemble / model -> $MAT_CACHE/props_raw/*.glb + *.json
NODE_PATH=/tmp/gltf-tools/node_modules node tools/materials/optimize_props.cjs   # simplify, WebP, meshopt -> here
node tools/materials/glb_declare_quantization.cjs --check  # validate: every GLB declares KHR_mesh_quantization
python3 tools/materials/write_credits.py
```

- Visual check: `tools/materials/verify/` renders line-ups of every prop (LOD0 / LOD1) and a street mock-up.
  See `public/textures/README.md` → "Verification page".
- `$BLENDER_PY` is Blender's Python, or a venv with the `bpy` module (Blender 4.2+ / 5).
- `optimize_props.cjs` needs `npm install --prefix /tmp/gltf-tools @gltf-transform/core@4
  @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp`. Install these outside the
  repo; they are not game dependencies.
- To add a Poly Haven prop, add a `dict(...)` to `PH_PROPS` with the object names to keep. To add a modelled
  prop, write a function using the `Kit` helper and register it in `PROC`.
