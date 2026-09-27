# PBR texture library (`public/textures/`)

Tileable, game-ready PBR materials for the Harare CBD city: 1950s–80s modernist concrete and render, face
brick, granite cladding, glass, verandah shopfronts, pale asphalt, grey concrete slabs, painted kerbs, red
laterite soil, dry highveld grass, corrugated iron / IBR / fibre-cement / clay-tile roofs. It also holds the
window set (a glass surface layer plus an interior-mapping atlas) and a daytime environment map for
reflections.

Everything here is **CC0**; sources and authors are listed in [CREDITS.md](CREDITS.md). The machine-readable
index is [`materials.json`](materials.json). Everything is rebuilt by the scripts in `tools/materials/`
(see [Rebuilding](#rebuilding)).

**Sizes.**

| part | files | bytes |
|---|---|---|
| 47 PBR materials (albedo + normal + ORM WebP) | `<category>/<name>_{albedo,normal,orm}.webp` | 7.02 MB |
| window interiors atlas | `glass/interiors_atlas.webp` (2048×1024), `glass/interiors_atlas_small.webp` (1024×512) | 88 KB + 40 KB |
| environment map (IBL) | `env/harare_day_ibl_1k.hdr` | 1.04 MB |

Per category: concrete 565 KB · plaster 557 KB · brick 648 KB · stone 287 KB · metal 189 KB · roof 1.19 MB · road 961 KB · paving 1.31 MB · ground 917 KB · wood 230 KB · plastic 8 KB · glass 48 KB.
Grand total with the atlas and the HDRI: **8.19 MB** (budget 12 MB + 2 MB). Nothing is loaded
unless the game asks for it, so a phone profile can load only a subset (see [Phone budget](#phone-budget)).

---

## Conventions (every material)

| map | file | colour space | contents |
|---|---|---|---|
| albedo | `<name>_albedo.webp` | **sRGB** (`texture.colorSpace = THREE.SRGBColorSpace`) | base colour; `window_glass` also has alpha (grime coverage) |
| normal | `<name>_normal.webp` | linear (`THREE.NoColorSpace`) | tangent-space, **OpenGL convention (+Y / green = up)**, which is three.js's default. Do not flip `normalScale.y` |
| ORM | `<name>_orm.webp` | linear | **R = ambient occlusion, G = roughness, B = metalness** (the glTF packing) |

- **Resolution.** Albedo is 1024 px; `asphalt_bleached`, `pavement_slabs` and `pavers_interlocking` are 2048 px,
  and a few small-use materials are 512 px. Normal maps are at most 1024 px, and ORM maps are half the albedo
  size. The exact sizes are in `materials.json` → `mapSizes`. Maps of one material may differ in size, which is
  fine because three.js samples each with the same UVs.
- **Tiling.** Every map tiles seamlessly (checked by 2×2 tiling). `tileSizeMetres: [u, v]` is the real-world
  size of one repeat. With UVs in metres, use `texture.repeat.set(1 / tile[0], 1 / tile[1])`. With 0..1 UVs on a
  surface of `W × H` metres, use `repeat = (W / tile[0], H / tile[1])`.
- **Low-frequency flattening.** Large blotches were removed from the albedo (and partly from roughness), because
  those are what make a 2 m tile obviously repeat across a 60 m facade. Add macro variation in the shader
  instead. A cheap version: multiply the albedo by `mix(0.88, 1.08, noise(worldPos.xz * 0.05 + buildingSeed))`,
  and use a per-building tint.
- **Tinting.** `avgColor` (sRGB hex) and `avgColorLinear` are the mean albedo, measured on the shipped WebP
  (after the encoder's smoothing, which lowers the linear mean of speckled textures by up to 7 %). To make a material read as a
  target facade colour from `tools/landmark_overrides.json` (for example the Monomotapa's `#cdbd9c`), multiply
  in linear space:
  `material.color.setRGB(t.r / avg[0], t.g / avg[1], t.b / avg[2])`, where `t = new THREE.Color(hex)` (already
  linear in three.js) and `avg = avgColorLinear`. Materials tagged `tintable` are near-neutral and take any
  colour. Brick, clay and rust keep their own colour.
- **Seams.** Tiles, pavers, panels and kerbs have their joints on the texture border (u = 0 / v = 0), so align
  UV origins with building corners or floor lines when you want joints to line up.
- **Metalness.** Only `window_frame_aluminium` and `corrugated_galvanised` carry real metalness (≈ 1). The
  weathered / rusty corrugated sheets and the painted IBR sheet are paint or rust over steel, so they are
  dielectric (metalness ≈ 0). `metal_panel` is painted aluminium composite, with metalness ≈ 0.15.
- **Roughness.** The maps are the sources' own, except four whose source maps were far too glossy for dry
  Harare surfaces and were remapped in `build_textures.py` (`rough=`): `grass_green` (source mean 0.26 → 0.80),
  `asphalt_bleached` (0.52 → 0.77), `roof_gravel` (0.47 → 0.78) and `gravel_grey` (0.53 → 0.78).
  `roughnessMean` in `materials.json` is the shipped value.
- **Normal tilt.** The `plaster_peeling` normal map had a 7° planar tilt baked into the scan (non-zero mean
  slope, so a whole wall shaded as if turned 7°). It is removed with `detilt=True` in `build_textures.py`.
- **AO.** Three Poly Haven ground scans baked a global darkening into AO (`dirt_dry` never went above 0.65), which
  would halve their ambient light next to other ground materials. `dirt_dry`, `soil_red` and `asphalt_cracked`
  are rescaled so open ground reads AO ≈ 1 (`ao_norm=True`); crevice contrast is kept.

### Loading in three.js

```js
const man = await (await fetch('textures/materials.json')).json();
const byName = Object.fromEntries(man.materials.map((m) => [m.name, m]));
const loader = new THREE.TextureLoader();
function pbrMaterial(name, { uvInMetres = true, maxAniso = renderer.capabilities.getMaxAnisotropy() } = {}) {
  const e = byName[name];
  const load = (file, srgb) => {
    const t = loader.load('textures/' + file);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = Math.min(8, maxAniso);          // roads / pavements need this at grazing angles
    if (uvInMetres) t.repeat.set(1 / e.tileSizeMetres[0], 1 / e.tileSizeMetres[1]);
    return t;
  };
  const orm = load(e.files.orm, false);
  return new THREE.MeshStandardMaterial({
    map: load(e.files.albedo, true), normalMap: load(e.files.normal, false),
    aoMap: orm, roughnessMap: orm, metalnessMap: orm,   // one texture, three channels
    roughness: 1, metalness: 1,                         // factors multiply the maps: keep at 1
  });
}
```

- `aoMap` uses the same UV set as the other maps. Since r151, `texture.channel = 0` is the default, so no `uv2`
  is needed.
- `MeshStandardMaterial` builds its tangent frame from screen-space derivatives when a mesh has no `tangent`
  attribute, so merged city geometry needs nothing extra.

#### Texture arrays

The city renderer (`src/world/materials.js`) samples a `sampler2DArray` today. To put these materials into a
`DataArrayTexture`, resample each map type to one size: 1024² for albedo and normal, 512² for ORM. Use one array
per map type and one layer per material. The build scripts can write that directly: change `out` / `nres` /
`ores` in `tools/materials/build_textures.py`.

---

## Materials

`tile` is the real-world size of one repeat in metres. `px` is albedo / normal / ORM width. `KB` is all three
files together.

| name | category | tile (m) | px | avgColor | KB | use |
|---|---|---|---|---|---|---|
| `concrete_raw` | concrete | 2.0 × 2.0 | 1024/1024/512 | #615d59 | 139 | Plain grey off-form concrete: 1960s–80s slab blocks, parking decks, parapets |
| `concrete_board_formed` | concrete | 2.0 × 2.0 | 1024/1024/512 | #7e7b74 | 158 | Board-marked concrete with horizontal lift lines: stair drums, service cores, Eastgate-style precast |
| `concrete_weathered` | concrete | 2.16 × 2.16 | 1024/1024/512 | #8b836e | 137 | Stained, weathered beige concrete or render: older blocks and back walls |
| `concrete_painted` | concrete | 2.0 × 2.0 | 1024/1024/512 | #aba39f | 131 | Painted concrete or render, light and neutral: **default base for tinted facades** |
| `plaster_smooth` | plaster | 1.5 × 1.5 | 1024/1024/512 | #d7d4d1 | 166 | Smooth cement render, near white: tint to cream, beige or sand |
| `plaster_textured` | plaster | 1.4 × 1.4 | 1024/1024/512 | #847a64 | 177 | Coarse spray / tyrolean render in sand-tan: Monomotapa-type tan walls, boundary walls |
| `plaster_peeling` | plaster | 1.0 × 1.0 | 1024/1024/512 | #bab9b2 | 215 | Patchy white plaster with worn paint: 1920s–50s colonial shopfronts, verandah walls |
| `brick_face_salmon` | brick | 1.8 × 1.8 | 1024/1024/512 | #a2755f | 185 | Salmon/red face brick (Eastgate infill `#b5957c`, CABS, flats) |
| `brick_face_red` | brick | 1.8 × 0.9 | 1024/1024/512 | #8a7059 | 125 | Darker red-brown face brick (Harare station `#8a5c46`, warehouses). Non-square: 1024×512 |
| `brick_painted` | brick | 1.05 × 1.05 | 1024/1024/512 | #ddd8d4 | 190 | Painted brick (white): back walls, lanes, low shops |
| `block_painted` | brick | 2.4 × 2.4 | 1024/1024/512 | #878786 | 149 | Painted concrete block: boundary walls, yards, rooftop plant rooms |
| `granite_cladding_light` | stone | 2.4 × 2.4 | 1024/1024/512 | #b4b3ad | 97 | Honed light-grey granite, 1.2 × 0.6 m stack-bond panels (RBZ piers and friezes `#aeb0ac`, bank halls). Joints at u = 0, 0.5 and v = 0, 0.25, 0.5, 0.75 |
| `granite_dark_tiles` | stone | 2.3 × 2.3 | 1024/1024/512 | #4e4f4f | 89 | Dark granite slabs with joints: podiums (RBZ podium `#8f9593` when tinted up), plinths |
| `stone_cladding_sand` | stone | 2.0 × 2.0 | 1024/1024/512 | #b4a08a | 102 | Beige stone slab cladding: 1960s–70s podiums; Pearl House ochre when tinted |
| `metal_panel` | metal | 4.8 × 4.8 | 1024/1024/512 | #a3a8ad | 30 | Painted aluminium composite panels (0.6 m grid): fascias, refits, lift overruns |
| `window_frame_aluminium` | metal | 1.0 × 1.0 | 512/512/256 | #929598 | 21 | Brushed / anodised aluminium: mullions, frames, handrails (tint bronze or black) |
| `shutter_rolldown` | metal | 2.0 × 2.0 | 1024/1024/512 | #808487 | 138 | Painted steel roll-down shutter: closed shops at night. Slats run along u |
| `corrugated_galvanised` | roof | 1.12 × 1.12 | 1024/1024/512 | #aab3af | 178 | Clean galvanised corrugated iron (corrugations run along v) |
| `corrugated_weathered` | roof | 1.8 × 1.8 | 1024/1024/512 | #797876 | 186 | Dull, streaked galvanised sheet |
| `corrugated_rusty` | roof | 2.0 × 2.0 | 1024/1024/512 | #592b1a | 99 | Rusted corrugated iron: Kopje-side roofs, lean-tos, stalls |
| `ibr_sheet_painted` | roof | 2.0 × 2.0 | 1024/1024/512 | #6a2617 | 47 | Painted IBR box-profile sheeting in red oxide. Tint to green or charcoal |
| `fibre_cement_roof` | roof | 1.8 × 1.8 | 1024/1024/512 | #746c64 | 108 | Grey corrugated fibre-cement ("asbestos"), very common on 1950s–70s roofs |
| `clay_tile_roof` | roof | 2.9 × 2.9 | 1024/1024/512 | #a76046 | 96 | Interlocking Marseille clay tiles: station, Munhumutapa Building, colonial hips |
| `clay_tile_roof_old` | roof | 2.5 × 2.5 | 1024/1024/512 | #97532d | 212 | Weathered barrel tiles with colour variation: older houses, the Avenues |
| `roof_membrane` | roof | 20 × 20 | 1024/1024/512 | #3b3734 | 74 | Torch-on bitumen strips for flat roofs. The large tile hides repetition |
| `roof_gravel` | roof | 1.5 × 1.5 | 1024/512/512 | #dbd7cf | 164 | Pale gravel ballast for flat office roofs |
| `asphalt_bleached` | road | 2.5 × 2.5 | **2048**/1024/1024 | #83807a | 537 | **Main road surface**: pale sun-bleached asphalt (`#8f8c83`–`#9d998d` in sun) |
| `asphalt_cracked` | road | 3.0 × 3.0 | 1024/1024/512 | #696761 | 163 | Worn asphalt with long cracks. Blend it in with a mask; its cracks repeat every 3 m, so do not use it alone on long roads |
| `asphalt_patch` | road | 2.1 × 2.1 | 1024/1024/512 | #444746 | 134 | Darker fresh asphalt for repair patches and trench reinstatements |
| `kerb_concrete` | road | 3.0 × 3.0 | 512/512/256 | #636461 | 16 | Plain worn kerb concrete |
| `kerb_painted_bw` | road | 2.0 × 0.5 | 1024/1024/512 | #9b9b96 | 37 | Samora Machel median kerbs: 1 m black / 1 m white paint blocks with wear. **u along the kerb, v across the kerb (face + top, 0.5 m)**. Non-square: 1024×256 |
| `kerb_painted_yellow` | road | 2.0 × 0.5 | 1024/1024/512 | #cca233 | 36 | Yellow kerbs at ranks, bus stops and no-stopping zones. Same mapping |
| `kerb_painted_rw` | road | 2.0 × 0.5 | 1024/1024/512 | #b69a94 | 39 | Red / white blocks: median noses, barrier blocks. Same mapping |
| `pavement_slabs` | paving | 1.8 × 1.8 | **2048**/1024/1024 | #928c84 | 541 | **Default CBD sidewalk**: grey concrete slabs (`#bfbdbc` sunlit) |
| `pavers_interlocking` | paving | 0.9 × 0.9 | **2048**/1024/1024 | #777b77 | 543 | Grey zig-zag interlocking pavers: forecourts, parking, newer sidewalks |
| `pavers_herringbone_red` | paving | 1.75 × 1.75 | 1024/1024/512 | #95725f | 194 | Red clay herringbone pavers: First Street Mall, plazas, bank forecourts |
| `grass_dry` | ground | 2.0 × 2.0 | 1024/1024/512 | #ad936e | 195 | Dry straw-coloured highveld grass (May–Oct): verges, medians, vacant lots |
| `grass_patchy` | ground | 2.51 × 2.51 | 1024/1024/512 | #6e613e | 177 | Patchy olive grass with bare earth: park edges, medians |
| `grass_green` | ground | 1.4 × 1.4 | 1024/1024/512 | #626e32 | 208 | Watered lawn (Africa Unity Square, Harare Gardens) or the rainy season |
| `soil_red` | ground | 2.0 × 2.0 | 1024/1024/512 | #653f2f | 192 | Red-brown laterite with stones (`#7c6556`): unkerbed verges, paths, sites |
| `dirt_dry` | ground | 4.0 × 4.0 | 512/512/256 | #967650 | 74 | Dry tan dirt with pebbles: lanes, informal parking, the Kopje foot |
| `gravel_grey` | ground | 1.5 × 1.5 | 512/512/256 | #65655d | 70 | Crushed stone: rail ballast, yards |
| `bark_grey` | wood | 1.0 × 2.0 | 512/512/256 | #82807a | 123 | Grey fissured bark (jacaranda, msasa, flamboyant). Non-square: 512×1024 (1 m around × 2 m up) |
| `wood_planks_weathered` | wood | 1.8 × 1.8 | 512/512/256 | #614d3b | 59 | Weathered brown planks: vendor stalls, carts, hoardings |
| `wood_planks_grey` | wood | 1.5 × 1.5 | 512/512/256 | #474641 | 48 | Sun-greyed planks: benches, market tables, doors |
| `plastic_matte` | plastic | 1.0 × 1.0 | 512/512/256 | #a2a6ab | 8 | Light matte plastic: tint for JoJo tanks (`#3f7d5a`), crates, chairs, sign boxes |
| `window_glass` | glass | 3.0 × 3.0 | 512/1024/512 | #b5afa6 | 48 | Glass *surface layer* (see [Windows](#windows)) |

Sizes marked "estimated" in `materials.json` notes had no published dimensions. They were judged from the
features in the texture: brick courses of about 75 mm, 225 mm pavers, formwork scale.

### Suggested mapping from the map data

| data | material(s) |
|---|---|
| landmark `pattern: 'curtain'` | glass (`window_glass` + interiors, tinted with `style.glass`); piers `granite_cladding_light` or `concrete_painted` tinted with `style.facade` |
| `pattern: 'grid'` / `'bands'` / `'fins'` | `concrete_painted` or `plaster_smooth` tinted with `style.facade`; spandrels / fins `concrete_raw` or `concrete_board_formed` tinted with `style.accent` |
| `pattern: 'brick'` (station, Eastgate infill) | `brick_face_red` / `brick_face_salmon` (untinted), trims `plaster_smooth` |
| `pattern: 'colonial'` | `plaster_peeling` (older) or `plaster_smooth` tinted; verandah posts `window_frame_aluminium` tinted dark or `wood_planks_grey` |
| granite podiums (RBZ, banks) | `granite_dark_tiles` tinted to `#8f9593`, or `granite_cladding_light` |
| `buildings[].material` `brick` / `plaster` | `brick_face_salmon` / `plaster_smooth` |
| procedural fill, `cls` retail / commercial | 60 % `concrete_painted` / `plaster_smooth` tinted from the palette in PHOTOS.md §21; 25 % `brick_face_salmon`; 15 % `plaster_textured` / `concrete_weathered` |
| roofs: CBD flat roofs | `roof_membrane`, `roof_gravel`, `concrete_raw`; low buildings `corrugated_*`, `ibr_sheet_painted`, `fibre_cement_roof`; hip roofs `clay_tile_roof(_old)` |
| roads / sidewalks / verges | `asphalt_bleached` with `asphalt_patch` and `asphalt_cracked` blended by noise masks; `pavement_slabs`; `pavers_interlocking` on forecourts and parking; `pavers_herringbone_red` on First Street; `soil_red` / `grass_dry` verges; medians `kerb_painted_bw` + `grass_patchy` |
| `roofColor` `#008000` / `#0000FF` / `#FF0000` (OSM) | `ibr_sheet_painted` tinted green / blue / red |

---

## Windows

A window is drawn as three layers:

1. **Frame and mullions.** Geometry using `window_frame_aluminium`.
2. **Glass surface.** `glass/window_glass_*`:
   - albedo RGB is the colour of the dusty grime;
   - albedo **alpha is grime coverage**: an even dust film around 0.1, up to 0.4 in run-off streaks and smudges;
   - the normal map is a gentle float-glass waviness, so reflections wobble like real panes;
   - ORM G is roughness, from 0.04 when clean to about 0.4 where smudged.

   The glass colour itself is a per-building tint, not a texture: RBZ `#5b808c`, Karigamombe `#5177a4`, Joina
   `#5a7189`, Monomotapa `#5f6c73`. Use `style.glass`.
3. **The room behind.** Interior mapping from `glass/interiors_atlas.webp`.

### Interior atlas

The atlas is `glass/interiors_atlas.webp`: 2048 × 1024 px, **4 columns × 2 rows** of 512 px cells.
`interiors_atlas_small.webp` is the same layout at half size. The rooms were modelled procedurally and rendered
with Blender Cycles, with the interior lights on.

| cell | col,row | name | kind | contents |
|---|---|---|---|---|
| 0 | 0,0 | `office_open` | office | Open-plan office: fluorescent panels, desks, monitors, partitions, filing cabinets |
| 1 | 1,0 | `office_cellular` | office | Single office with a venetian blind half down, desk, shelves of binders |
| 2 | 2,0 | `apartment_living` | residential | Flat living room: warm pendant, sofa, TV unit, curtains half drawn |
| 3 | 3,0 | `apartment_bedroom` | residential | Bedroom: bed, wardrobe, bedside lamp, curtains mostly drawn |
| 4 | 0,1 | `shop_supermarket` | shop | Supermarket / pharmacy: bright tubes, shelves of colourful goods, gondola, promo banner |
| 5 | 1,1 | `shop_clothing` | shop | Clothing shop: warm spots, garment rails, two mannequins |
| 6 | 2,1 | `shop_hardware` | shop | General dealer: dense shelving, counter and till, stacked mealie-meal sacks |
| 7 | 3,1 | `vacant_storage` | vacant | Vacant unit: bare bulb, boxes, newspaper on the glass (dim) |

Row 0 is the **top** half of the image. `interiors.json` gives each cell's `uvRect [u0, v0, u1, v1]` in three.js
UVs (flipY = true), its mean luminance and a description.

### Projection (how the cells were baked)

- **Room space.**
  - x ∈ [0, 1] runs across the window, left to right as seen from the street.
  - y ∈ [0, 1] runs from floor to ceiling.
  - z ∈ [0, 1] runs into the building. The glass is at z = 0 and the back wall at z = 1.
  - The baked room is 3 × 3 × 3 m.
- **Camera.** Each cell is a pinhole render from (0.5, 0.5, −1), one window-width outside the glass, looking
  +z. Its frustum is exactly the window rectangle (FOV 53.13°). The back wall therefore fills the central half
  of the cell, and the walls, floor and ceiling fill the four trapezoids.

To shade a pane with window-local coordinates `w ∈ [0,1]²` and tangent-space view direction `d`
(`d.z > 0` into the building):

```glsl
vec3 p0 = vec3(w, 0.0);
vec3 dd = vec3(d.xy, d.z / depth);                 // depth = room depth / window width (1 = as baked)
vec3 tMax = max((vec3(0.0) - p0) / dd, (vec3(1.0) - p0) / dd);
float t = min(min(tMax.x, tMax.y), tMax.z);
vec3 p = p0 + dd * t;                              // where the view ray hits the room box
vec2 cellUv = 0.5 + (p.xy - 0.5) / (1.0 + p.z);    // inverse of the bake projection
vec2 atlasUv = (vec2(col, 1.0 - row) + cellUv) / vec2(4.0, 2.0);
vec3 room = textureGrad(atlas, atlasUv, dFdx(w) / vec2(4.0, 2.0), dFdy(w) / vec2(4.0, 2.0)).rgb;
```

Use `textureGrad` with the smooth window-UV derivatives. Plain `texture()` shows mip seams where the hit face
changes.

### Reference implementation

[`tools/materials/interior_glass.js`](../../tools/materials/interior_glass.js) is tested in the headless
verification page. It provides:

- `createInteriorGlassMaterial({ atlas, glassNormal, glassOrm, glassGrime, tint, exposure, darkLevel })`: a
  `MeshStandardMaterial` patched through `onBeforeCompile`. PBR reflections of the environment and sun stay
  intact, and the room is added to `totalEmissiveRadiance`, scaled by `(1 − Fresnel) × tint × grime × exposure`.
- `buildWindowGeometry(wall, windows)`: builds the per-pane attributes. Each pane needs:
  - `uv` in wall metres;
  - `winUv` from 0 to 1;
  - `winData = (cell, mirror, lightOn, depth)`.

Day / night settings:

| time | `uExposure` | `uDarkLevel` | lit rooms |
|---|---|---|---|
| day | about 0.45–0.6 | 1 | all rooms show |
| night | about 1.2 | 0.03–0.05 | only rooms with `lightOn = 1`, e.g. hash > 0.35 |

- Drive both uniforms from `sky.nightFactor`.
- Choose the cell from `hash(buildingId, floor, bay)`, restricted by facade class: shop cells 4–7 on the ground
  floor of `retail` / `commercial`, office cells 0, 1 and 7 above, residential 2 and 3 for `apartments` /
  `hotel`.
- Mirror half of the windows (`winData.y`) so neighbours differ.

In `src/world/materials.js` this slots into the existing "kind 0 = facade glass" branch: replace the flat
sky-reflection glass colour with `interiorRadiance()` plus the existing reflection term. The facade already has
per-window hashes (`cityHash`) for choosing which windows light up.

---

## Environment lighting

`env/harare_day_ibl_1k.hdr` is a 1024×512 equirectangular Radiance HDR (RGBE with RLE), 1.04 MB, linear.

- **Source.** Poly Haven *Wide Street 01* (Sergej Majboroda, CC0): a sunny, lightly hazy midday avenue with
  pale asphalt, trees and low-rise blocks.
- **Processing.**
  - The **sun disc is clamped** to relative luminance 12, which removed about 75 % of the HDRI's energy, all
    of it in 4 pixels. The game already has a `DirectionalLight` sun (`src/world/sky.js`); leaving the disc in
    would light every surface twice and put a second glint in every glass facade.
  - The **ground below −3° is blurred progressively** (σ = 18 px). Sharp, the source street's parked cars and
    tree shadows showed up as dark speckle in downward reflections (glass seen from swing height).
  - The sky, clouds and horizon silhouettes are unchanged.
- **Metadata.** `env/env.json` records:
  - where the removed sun was (`u = 0.600`, elevation 52.9°, three.js direction `[0.488, 0.798, 0.355]`);
  - the mean sky colour (linear `[0.195, 0.323, 0.473]`) and ground colour (`[0.174, 0.155, 0.138]`).

```js
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';   // RGBELoader is deprecated since r180
const hdr = await new HDRLoader().loadAsync('textures/env/harare_day_ibl_1k.hdr');
hdr.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
const dayEnv = pmrem.fromEquirectangular(hdr).texture;
hdr.dispose();
scene.environment = dayEnv;             // reflections + ambient for every MeshStandardMaterial
scene.environmentIntensity = 1.0;       // by day; see below for dusk / night
// Optional: turn the (removed) sun's bright sky side toward the game's sun heading by rotating the environment
// about Y by the horizontal angle between env.json sunInSource.threeDirectionDefaultMapping and sky.sunDirection:
// scene.environmentRotation.y = angle   (check the sign once with a chrome sphere; the bright patch should face the sun)
```

Do **not** use the HDRI as `scene.background`. The game keeps its procedural sky dome, and the HDRI is only for
reflections and ambient light.

### Dusk and night

Choose one of these options.

1. **Fade and tint (cheapest).** Every frame, set:
   - `scene.environmentIntensity = THREE.MathUtils.lerp(1.0, 0.05, sky.nightFactor)`;
   - at dusk (sun elevation 0–12°), also multiply the sun and hemisphere colours by the sky palette. For
     example, lerp `renderer.toneMappingExposure` and tint through `sky.palette.horizon`.

   `MeshStandardMaterial` has no per-material env tint. For a warm dusk tint either:
   - patch `envMapIntensity` per material, or
   - build a second PMREM from the HDRI multiplied by an orange-grey colour (one extra `fromEquirectangular` on
     a tinted copy) and cross-fade by swapping `scene.environment` at a threshold. Keep it hidden behind the
     exposure change.
2. **PMREM from the procedural sky (best match).** Render the existing sky dome (`src/world/skyDome.js`) into
   the environment:
   - use `pmrem.fromScene(skyOnlyScene, 0, 0.1, 1000)`;
   - regenerate it only when `sky.timeOfDay` has moved by at least 0.25 h, or the palette version changed;
   - each rebuild costs about one frame (6 × 256² faces plus the blur), so do it on the pause / time-skip path
     or spread it over frames on desktop;
   - use the HDRI by day, when its trees, buildings and ground give glass and cars realistic reflections. From
     sun elevation < 15° switch to the sky PMREM, which follows sunset colours, and at night use the sky PMREM
     at about 0.05 intensity (moon and city glow).
3. **Phones.** Keep the HDRI at `environmentIntensity` 0.6–0.8 by day and skip the sky PMREM.

---

## Phone budget

The tables above are for the high profile. For `quality.level === 'low'`:

- load the 1024 px albedo versions only, and down-sample the 2K road / pavement textures with
  `texture.image` + canvas, or ask for a 1K build (`out=1024` in the config);
- skip `asphalt_cracked`;
- use `interiors_atlas_small.webp`.

A typical street needs about 12 materials (asphalt ×2, pavement, kerb ×2, three facade bases, two roofs, glass,
soil), which is about 2.5 MB of WebP. GPU memory is about 1.33 × 4 B/px per map with mipmaps: roughly 5.6 MB per
1K map and 22 MB per 2K map.

---

## Rebuilding

The scripts live in `tools/materials/`. Downloads are cached in `$MAT_CACHE` (default
`/tmp/spiderman-materials-cache`). About 300 MB of source files were downloaded; they can be deleted after the
build.

```
export MAT_CACHE=/tmp/spiderman-materials-cache
python3 tools/materials/build_textures.py            # downloaded materials (ambientCG / Poly Haven) -> webp + materials.json
python3 tools/materials/gen_textures.py              # granite cladding, painted kerbs, window glass
$BLENDER_PY tools/materials/interiors_blender.py     # render 8 rooms (Blender 4.2+/5, Cycles, ~1-2 min per room on CPU)
python3 tools/materials/pack_interiors.py            # atlas webp + interiors.json
python3 tools/materials/hdri_tools.py                # env/harare_day_ibl_1k.hdr + env.json
python3 tools/materials/preview_sheet.py sheet.jpg   # contact sheet: every material tiled 2x2, lit by its normal map
python3 tools/materials/write_credits.py             # CREDITS.md from the manifests
python3 tools/materials/build_textures.py --refresh-stats   # optional: re-measure materials.json stats from the files
```

The pipeline is byte-reproducible: re-running `build_textures.py <name>` with the same sources and the same
`cwebp` (libwebp 1.5.0, fetched automatically) writes identical files.

### Verification page

`tools/materials/verify/` is a headless three.js page that renders:

- the material swatch board;
- the props line-ups (LOD0 and LOD1, next to a 1.75 m reference figure);
- IBL test spheres;
- a street mock-up with painted kerbs, slabs, interior-mapped shopfronts and offices, props, and a night
  version.

```
node tools/materials/verify/server.mjs 8791 &
node tools/materials/verify/shoot.mjs board.png "scene=board&cols=8" 2000 1250
node tools/materials/verify/shoot.mjs street.png "scene=street&view=close" 1600 900     # view=street|close|swing|oblique, night=1
```

- Needs: python3 with numpy, pillow and requests. `cwebp` is downloaded from Google's libwebp release if it is
  not on `PATH`.
- To add a material, append a `dict(...)` to `MATERIALS` in `build_textures.py` (ambientCG id or Poly Haven
  slug, tile size, flatten strength, optional colour grade) and rerun with its name.
