# Harare traffic: vehicle models

There are 11 vehicles, each with two LODs (22 GLBs), about **2.5 MB** in total. Geometry is
meshopt-compressed and textures are WebP. Every model is original and procedurally generated (see
`CREDITS.md`); to rebuild them, run `tools/vehicles/build_all.sh`. `manifest.json` has the same facts as
the table below in machine-readable form: dimensions, axle positions, wheel pivots, toggles, triangle
counts, byte sizes and paint palettes. Preview sheets are in `tools/vehicles/previews/`: Cycles 3/4
front, side and 3/4 rear views, plus three.js screenshots of these exact files at LOD0, LOD1 and night,
and the kombi toggles.

| Model | Real vehicle | L x W x H (m) | Wheelbase / track F-R (m) | Wheel r (m) | Axle z F / R (m) | LOD0 tris (body / as shown) | LOD1 tris | LOD0 / LOD1 KB | Toggle groups |
|---|---|---|---|---|---|---|---|---|---|
| `kombi` | Toyota HiAce H100 Commuter, long body, high roof (1989-2004) | 4.695 x 1.69 x 2.2 | 2.79 / 1.445-1.43 | 0.345 | -1.4875 / 1.3025 | 11018 / 17118 | 2228 | 240 / 90 | roof_rack, livery_stripe, livery_zupco, banner, route |
| `hatch_fit` | Honda Fit / Jazz GE (2007-2013) | 3.9 x 1.695 x 1.525 | 2.5 / 1.475-1.465 | 0.292 | -1.23 / 1.27 | 9614 / 14686 | 1964 | 139 / 49 | - |
| `sedan_corolla` | Toyota Corolla Axio E160 (2012-2019) | 4.4 x 1.695 x 1.46 | 2.6 / 1.48-1.465 | 0.301 | -1.34 / 1.26 | 9649 / 15433 | 1942 | 142 / 49 | - |
| `sedan_mercedes` | Mercedes-Benz C-Class W204 (2007-2014) | 4.58 x 1.77 x 1.447 | 2.76 / 1.55-1.54 | 0.316 | -1.49 / 1.27 | 9560 / 15184 | 2030 | 141 / 51 | - |
| `wagon_wish` | Toyota Wish AE10 (2003-2009) | 4.56 x 1.695 x 1.59 | 2.75 / 1.48-1.475 | 0.317 | -1.42 / 1.33 | 10527 / 16351 | 2080 | 149 / 50 | - |
| `pickup_hilux` | Toyota Hilux AN20/AN30 double cab 4x4 (2011-2015) | 5.26 x 1.835 x 1.81 | 3.085 / 1.54-1.54 | 0.369 | -1.76 / 1.325 | 11063 / 16887 | 2414 | 161 / 65 | cargo, sports_bar |
| `suv_landcruiser` | Toyota Land Cruiser 200 (2007-2015) | 4.95 x 1.97 x 1.905 | 2.85 / 1.64-1.635 | 0.400 | -1.555 / 1.295 | 10809 / 16633 | 2237 | 150 / 53 | - |
| `taxi` | Corolla Axio E160 in Harare cab yellow, TAXI roof sign, checker band | 4.4 x 1.695 x 1.46 | 2.6 / 1.48-1.465 | 0.301 | -1.34 / 1.26 | 9875 / 15659 | 2014 | 166 / 61 | - |
| `police_landcruiser` | ZRP Land Cruiser 200: blue/gold band, POLICE, light bar, push bar | 4.95 x 1.97 x 1.905 | 2.85 / 1.64-1.635 | 0.400 | -1.555 / 1.295 | 12099 / 17923 | 2541 | 181 / 67 | - |
| `bus_zupco` | 11.5 m Yutong/FAW-class city bus in the ZUPCO 2019+ white/blue/gold livery | 11.5 x 2.5 x 3.25 | 5.8 / 2.05-1.86 | 0.522 | -3.25 / 2.55 | 15510 / 24990 | 3636 | 253 / 89 | livery_stripes, dest |
| `truck_isuzu` | Isuzu N-series NQR 500 wide cab with a 5.1 m box | 7.0 x 2.2 x 3.0 | 3.9 / 1.68-1.79 | 0.383 | -2.4 / 1.5 | 5990 / 13470 | 1920 | 159 / 60 | - |

"as shown" means body + 4 wheels + the default-visible toggles; this is the triangle count per vehicle on
screen. The wheel mesh is stored once and instanced 4 times (about 1.45k tris; 2.3k for dual rear wheels).
Bus and truck have dual rear wheels (`wheel_rl` / `wheel_rr` carry both tyres, in both LODs).

The nominal L x W x H above is the manufacturer body size. Mirrors, roof equipment and bars stick out of it
(bus roof air-con pod to 3.47 m, kombi roof vent to 2.26 m, police light bar to 2.02 m and push bar 0.1 m
ahead, Hilux step bumper + tow hitch 0.2 m behind). For collision boxes use the exact default-view bounds in
`manifest.json` -> `vehicles.<name>.lod0.bbox_m` (`{min, max}` in metres, glTF axes).

## Conventions

- **Units and axes (glTF / three.js):** metres, +Y up, the vehicle **faces -Z**, and +X is the vehicle's
  right. The origin is on the ground (y = 0) under the middle of the overall length, so bumper to bumper
  spans z = -L/2 ... +L/2. All vehicles are right-hand drive (Zimbabwe drives on the left). The kombi's
  sliding door and the bus doors are on the **left (-X, kerb) side**.
- **Files:** `<name>.glb` is LOD0 (1024 px textures) and `<name>_lod1.glb` is LOD1 (256 px textures, about
  2k tris, still with glass, lamps, plates and liveries). Both share node names and materials. Swap to LOD1
  at about 60-80 m, or at about 35 m on phones.
- **Node tree** (identical in both LODs):

  ```
  <name>                     root; userData = dimensions, axle z, wheel radius, steer_max_deg, paints (JSON string)
  |- body                    Group of Meshes, one per material (see below)
  |- wheel_fl / wheel_fr / wheel_rl / wheel_rr
  |     \- wheel_xx_mesh     tyre + rim + tread; left wheels are the same mesh turned 180 deg
  \- <toggle nodes>          userData.toggle = group name, userData.default_visible = bool
  ```

- **Wheels:** each `wheel_xx` node is the pivot at the hub centre and its local X is the axle. It carries
  no rotation, so spin and steer it directly:

  ```js
  w.rotation.order = 'YXZ';                 // steer (Y) first, then spin (X)
  w.rotation.x -= (speed / radius) * dt;     // rolling forward (towards -Z) is a NEGATIVE X rotation
  wFL.rotation.y = wFR.rotation.y = steer;   // + = steer left; clamp to userData.steer_max_deg
  ```

  Wheel radius and axle positions are in the root `userData` and in `manifest.json`.
- **Do not reset node transforms.** meshopt quantisation stores positions as int16 and puts the
  dequantising scale/offset on the mesh nodes (`body`, `wheel_xx_mesh`, toggles). If you bake geometry for
  instancing, apply `mesh.matrixWorld` *after* converting the attributes to Float32 (see the snippet below).
  `BufferGeometry.applyMatrix4` on a normalised int16 attribute clamps to +-1.
- **Loader:** these files need the meshopt decoder and WebP textures (every current mobile browser has
  WebP):
  `new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)` with
  `import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'`.

- **Environment map (required).** `chrome` (metalness 1), `rim` (0.75) and the glossy `paint`/`glass` get
  most of their look from `scene.environment`. The game currently lights the city with only a
  `HemisphereLight` + sun (`src/world/sky.js`), and a hemisphere light adds no specular, so without an
  environment the wheels, grilles and bumpers render near-black. Add one once at start-up, e.g.
  `scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;` (lower it at night), or a PMREM of the sky.
- **Paint is white in the file.** Always tint `paint` per instance; the taxi in particular is white until
  it gets `userData.paints[0]` (`#f2c21a`, cab yellow).
- **Manifest extras:** besides dimensions, axles, wheels and toggles, each `lod0` / `lod1` entry has
  `materials` (the materials really present in that file; LOD1 of the hatch, saloons, wagon, taxi, bus and
  truck has no `chrome`) and `bbox_m` (exact default-view bounds, see above).

## Materials (names are the contract)

| Material | Use | Notes for the game |
|---|---|---|
| `paint` | body colour | Base colour is **white** times a greyscale detail map (panel gaps, handles, grime; plus a normal map). Tint per instance with `material.color` or `InstancedMesh.instanceColor`, using the root `userData.paints` list or `VEHICLE_TYPES[].colors`. Metalness 0.2, roughness 0.24. For clearcoat on desktop, swap to `MeshPhysicalMaterial` with `clearcoat: 1, clearcoatRoughness: 0.08` and keep the maps. |
| `glass` | all windows | `alphaMode: BLEND`, opacity 0.66, dark tint, roughness 0.04. The dark interior silhouettes show through. |
| `chrome` | grille bars, bumpers, trims, rack | metal 1, roughness 0.14; needs `scene.environment` to read. |
| `trim` | black plastic: seals, bumpers, wheel wells, grilles, pillars, bed liner, chassis | |
| `tyre` | tyres | tread and sidewall normal map; UVs repeat 12x around the tyre. |
| `rim` | wheels, fuel tank | brushed metal. |
| `light_front` | headlamps and fog lamps | the lamp atlas is both base colour and **emissive map**; `emissive` is exported **black** (daytime look). At night set `mat.emissive.fromArray(mat.userData.emissiveNight)` and `emissiveIntensity` about 1.5-3. |
| `light_rear` | tail and brake lamps (plus reverse and marker lamps) | same scheme: tail lights at intensity about 0.6, brake about 2.5. |
| `indicator` | amber turn signals: front, rear, side repeaters | blink with `emissiveIntensity`. **Left and right share the material, so tell them apart by the sign of local x** (x < 0 = left). Either split the geometry by x on load, or blink both for hazards. |
| `plate` | number plates (Zimbabwe style, yellow, black `ABC 1234`, invented numbers) | |
| `interior` | seats, dash, wheel, floor, headliner seen through the glass | double-sided. |
| `livery` | decals: stripes, ZUPCO, banners, route cards, TAXI sign, POLICE, bus displays, truck box, cargo | `alphaMode: MASK` (cutoff 0.5). Decals sit 4-12 mm off the body; if distant decals z-fight, set `polygonOffset: true, polygonOffsetFactor: -2`. |
| `beacon_blue`, `beacon_red` | police light bar only | emissive black by default; `userData.emissiveNight` holds the colour; flash alternately. |

Not every model uses every material: only the kombi, taxi, police, bus, truck and Hilux have `livery`.

## Toggle nodes (visibility switches)

Toggle nodes are children of the root. `userData.toggle` is the group name; show at most one node per
group. `userData.default_visible` says what the model should look like if you do nothing, so apply
`o.visible = o.userData.default_visible` once after loading. They are cheap (12-400 tris each).

| Model | Group | Nodes | Default | streetlife.js mapping |
|---|---|---|---|---|
| kombi | `roof_rack` | `roof_rack` (galvanised rack with a checked bag, a sack and a tarp) | hidden | `roofRackChance` 0.12 |
| kombi | `livery_stripe` | `livery_stripe` (faded gold-over-black waist stripe) | hidden | livery `factory_stripes` (and many plain ones) |
| kombi | `livery_zupco` | `livery_zupco` (side stickers, windscreen strip, rear roundel) | hidden | livery `zupco_franchise` |
| kombi | `banner` | `banner_0`..`banner_5`: MWARI VANOKWANISA, ZVICHANAKA, GOD IS ABLE, TATENDA, NO HURRY IN AFRICA, JEHOVAH JIREH (windscreen top + rear window) | `banner_0` | livery `slogan_banner` |
| kombi | `route` | `route_0`..`route_7`: MBARE, CHITOWN, TOWN, GLEN VIEW, WARREN PARK, KUWADZANA, BUDIRIRO, HIGHFIELD (yellow card, kerb-side windscreen corner) | `route_0` | rank `destinations` |
| pickup_hilux | `cargo` | `cargo` (sacks, checked bag, box, tarp in the bed) | hidden | subtype `single_cab_load` cargo |
| pickup_hilux | `sports_bar` | `sports_bar` (chrome roll bar) | hidden | cosmetic |
| bus_zupco | `livery_stripes` | `livery_stripes` (blue skirt band + gold swoosh) | shown | `zupco_white_blue` (show) / `zupco_white_plain` (hide) |
| bus_zupco | `dest` | `dest_0`..`dest_5`: CITY - MBARE, CHITUNGWIZA, GLEN VIEW, WARREN PARK, BUDIRIRO, EPWORTH (LED, front/rear/kerb side) | `dest_0` | |

For the kombi livery `two_tone_old`, use paint `#e7e0cc`; for `coloured`, use any `paints` entry.
Other liveries (taxi sign and checkers, police band and lettering, the ZUPCO bus lettering, the truck box)
are baked into the body.

## Mapping `VEHICLE_TYPES` (src/data/streetlife.js) to models

| type / subtype | model |
|---|---|
| `kombi` | `kombi` (+ toggles above) |
| `hatch` (fit, vitz, aqua, demio), `mushikashika` | `hatch_fit` |
| `sedan` / `axio_allion`, `old_saloon` | `sedan_corolla` |
| `sedan` / `german_exec` | `sedan_mercedes` |
| `wagon` | `wagon_wish` |
| `pickup` (all subtypes; `single_cab_load` shows `cargo`) | `pickup_hilux` |
| `suv` | `suv_landcruiser` |
| `taxi` | `taxi` (paints: yellow, white, silver) |
| `police` | `police_landcruiser` |
| `bus` | `bus_zupco` |
| `truck` | `truck_isuzu` |
| `motorbike` | not provided; keep the current procedural bike |

The manifest lengths and wheelbases replace the procedural `length/width/wheels[]`: `frontAxle` is
`L/2 + front_axle_z_m` and `wheelbase` is `rear_axle_z_m - front_axle_z_m`.

## Instancing recipe (three.js r186)

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

// Float32 copy of a (possibly quantised) attribute, so matrices can be applied safely.
function toFloat(attr) {
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++)
    for (let k = 0; k < attr.itemSize; k++) out[i * attr.itemSize + k] = attr.getComponent(i, k);
  return new THREE.BufferAttribute(out, attr.itemSize);
}

// -> { parts: [{ geometry, material }], wheel: { geometry/material parts }, meta }
async function loadVehicle(url) {
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene.children[0];
  root.updateMatrixWorld(true);
  const bake = (node, relativeTo) => {
    const inv = new THREE.Matrix4().copy(relativeTo.matrixWorld).invert();
    const parts = [];
    node.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const g = new THREE.BufferGeometry();
      for (const [n, a] of Object.entries(o.geometry.attributes)) g.setAttribute(n, toFloat(a));
      g.setIndex(o.geometry.index);
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      parts.push({ geometry: g, material: o.material });
    });
    return parts;
  };
  root.traverse((o) => { if (o.userData.toggle) o.visible = !!o.userData.default_visible; });
  return {
    body: bake(root.getObjectByName('body'), root),          // one InstancedMesh per part
    wheel: bake(root.getObjectByName('wheel_fr'), root.getObjectByName('wheel_fr')), // at the hub, axle = X
    toggles: Object.fromEntries(root.children.filter((o) => o.userData.toggle).map((o) => [o.name, bake(o, root)])),
    meta: { ...root.userData, paints: JSON.parse(root.userData.paints || '[]') },
  };
}
```

- Give each body part its own `InstancedMesh` and set `instanceColor` **only** on the `paint` part. For
  lights, clone the three lamp materials per state (off / tail / brake) or patch the emissive through an
  instance attribute, as the current `vehicleMaterial.js` does with `aState`.
- The wheel part is baked around the right-front hub, so it faces +X. For left wheels, instance it with an
  extra 180-degree Y rotation, and put the spin *before* that flip: `M = T(hub) * R_y(steer) * R_y(pi if left) * R_x(-spin)`.
  Or keep the per-wheel nodes as they are for the few vehicles near the camera.
- Shadows: the body is closed and watertight, so it can cast real shadows near the camera. Keep the current
  blob shadows for the rest.
- Budget: a typical 40-vehicle scene with a 60/40 LOD0/LOD1 split is about 400k tris. That is fine on
  desktop; on phones, drop to LOD1 earlier.

## Paint palettes (root `userData.paints`, from streetlife `VEHICLE_COLORS`)

kombi `#efeee8` (x3), `#e4e1d8`, `#b7bbbf`, `#7fa3c7`, `#1e2d55`, `#5b1b22`. hatch_fit: white, silver, grey,
black, blue, sky blue, red, lime, orange, pearl. sedan_corolla: white, pearl, silver, grey, gunmetal, black,
navy, champagne, maroon. sedan_mercedes: black, silver, white, navy, gunmetal. wagon_wish: white, silver,
grey, black, navy, champagne. pickup_hilux: white (x3), silver, grey, gunmetal, black, red, navy.
suv_landcruiser: white, pearl, black, silver, gunmetal, champagne. taxi `#f2c21a` yellow, white, silver.
police `#f2f2ee`. bus `#f3f3f0`. truck cab: white, blue, red, green, gold (the box is its own livery).

## Review fixes (independent review, 2026-09-27)

Checked in headless Chromium with three.js r186 (GLTFLoader + MeshoptDecoder, PMREM environment, sun,
back-face and wireframe overlays) and with the glTF validator. Fixed in `tools/vehicles/` and rebuilt with
`build_all.sh`:

- **Wheels were inside-out on every model.** The tyre, rim face, lip and barrel were wound backwards, so
  three.js back-face culling showed the inner wall of the far side of the tyre and an empty black wheel
  (Cycles previews hid this because Cycles renders both sides). All wheels now face outwards, show their
  alloy / steel / hub-cap faces, and have a disc that closes the inner side of the wheel.
  LOD1 of the bus and truck now also has the inner dual tyre.
- **Decals sank into curved panels** (bow-tie fog lamps and vents, torn lower-grille ends, half-buried
  POLICE on the tailgate, ragged kombi rear window). LOD0 decals are now re-meshed or lifted until they
  clear the body. The kombi rear window is a flat stack (backing, stickers, glass), and the POLICE lettering
  on the police car's tailgate now sits below the glass.
- **Number plates:** the emblem was drawn over the fourth character; letters and digits now fit on either
  side of it.
- **Door and panel lines** were aliased 2 px staircases; the paint detail is now drawn at 4x and
  downsampled.
- **Land Cruiser / police flares** hung 8 cm below the sills as white tabs; they now end at the sill.
- **Atlas textures** (livery, plates, lamps) now use CLAMP_TO_EDGE; REPEAT bled the opposite atlas edge into
  cells on the edge (a dark line beside the tailgate POLICE).
- The manifest now has per-LOD `materials` and `bbox_m`.
- The glTF validator reports 0 errors. Each file has 2-3 `MESH_PRIMITIVE_GENERATED_TANGENT_SPACE`
  warnings, one per normal-mapped primitive: the normal maps ship without tangents, and three.js derives
  them in the shader. These warnings are expected and harmless. The producer's build had them too.

## Known limitations

- Door, bonnet and boot shut lines are texture and normal-map detail, not geometry, and the doors don't
  open. The kombi's sliding door is closed.
- The bus windscreen is real glass. The kombi, van and bus rear windows are glass decals over a dark
  backing, so the interior only shows through the side and front glass there. The kombi's rear-window
  slogan banner and ZUPCO roundel sit between the backing and the glass, like stickers inside the window.
- ZRP and ZUPCO livery colours are approximate (as flagged in `docs/references/STREETLIFE.md`). The
  Harare-yellow plates follow the photo survey in `docs/references/PHOTOS.md`.
- No motorbike; no damage or dirt variants beyond the baked grime (kombis are the dirtiest).
- Still not GTA-grade at close range: interiors are block seats, mirrors are boxy, and door, bonnet and boot
  lines are texture only. The Corolla/taxi C-pillar sweeps into a sharp fin over the rear wheel that the
  real E160 does not have. The Hilux is about 10 cm long at the rear bumper (plus a 10 cm tow hitch).
- The bus air-con pod makes the bus 3.47 m tall overall. The body roof is at 3.25 m.
- LOD1 has no door mirrors on most cars, and its 12-segment wheels have a thin sliver at the dish edge that
  shows the inside of the wheel. Neither is visible at LOD1 distances.
- The Cycles sheets in `tools/vehicles/previews/cycles_*.jpg` predate the review fixes: they show the old
  plates and LC200 flares. The `threejs_*.jpg` sheets and `review_before_after.jpg` are current.
