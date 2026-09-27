# tools/vehicles: procedural Harare vehicles

These scripts generate the realistic traffic in `public/models/vehicles/*.glb`. Each body is built in
Blender 5.0 (`bpy` used as a Python module) from real published dimensions. There is no hand modelling and
no third-party mesh, so every asset can be rebuilt from this folder.

```
BPY=/path/to/python-with-bpy VEH_NODE=/dir/with/node_modules tools/vehicles/build_all.sh [names...]
```

- `BPY` is a Python 3.11 that has `pip install bpy==5.0.*`.
- `VEH_NODE` is any directory where you ran
  `npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp`.
- `RENDER=1` adds Cycles CPU previews (about 40 s per vehicle on 2 threads). `VEH_HDRI` sets an optional
  equirectangular `.hdr` for them.
- The script runs three steps in order: `build.py` writes raw GLBs, textures and previews to `$VEH_OUT`
  (default `/tmp/vehicles_build`); `optimize.mjs` compresses them into `public/models/vehicles/` and writes
  `manifest.json`; `verify/verify.mjs` screenshots them in headless Chromium with three.js.

## Files

| File | What it does |
|---|---|
| `vkit.py` | Geometry kit: the lofted `Body` (sections -> PCHIP along the length -> Hermite ring -> quad grid with Coons-patch end caps and UVs), material rules, glass inset, BVH projector for lamps, plates and decals, sweeps, boxes, the wheel generator and booleans. |
| `build.py` | Builds one vehicle per LOD: body, rules, glass inset, wheel-arch and bed booleans, details, wheels, toggle nodes, root extras. Then it exports the GLB and optionally renders previews. `Ctx` wraps the projection helpers for the specs. |
| `specs/*.py` | One file per vehicle (`SPEC = ...`) holding dimensions, cross-sections, window and pillar rules, panel lines, lights, grille, livery placement and interior. `base.py` has the shared defaults and `common.py` the shared details (mirrors, wipers, plates, interiors, flares, steps, sign boxes). |
| `materials.py` | The 12 contract materials (plus 2 beacons) as Principled BSDF. |
| `textures.py` | Lamp atlas, number plates, tyre normal map, and the per-vehicle paint detail and normal map painted in body-UV space. |
| `liveries.py` | Decal atlases: kombi (stripe, ZUPCO, slogan banners, route cards, cargo), taxi, police, bus, truck and pickup cargo. |
| `optimize.mjs` | glTF-Transform pass: material fix-ups (alpha modes, night emissive in extras), WebP 1024 px (LOD1: 256 px), meshopt, `manifest.json`. |
| `render.py` | Cycles preview camera rig (3/4 front, left side, 3/4 rear, front). |
| `verify/` | three.js check page plus a Playwright runner (GLTFLoader + MeshoptDecoder + RoomEnvironment). It writes screenshots and `stats.json`. |

## How a body is described

A section is ten ring keys (x = lateral, z = height) at a forward position y:
`K0` bottom centre, `K1` underside edge, `K2` rocker, `K3` widest point, `K4` shoulder/belt, `K5` glass bottom,
`K6` glass top (A/C-pillar outer), `K7` roof edge / windscreen corner, `K8` roof mid, `K9` top centre.
`sec(y, W=..., zb=..., zbelt=..., top=('glass', zg, wg, ztop) | ('deck', zc) | ('flat', zc))` builds one
section. Seven to twelve sections define a car. Material rules then address faces by
(y range, key segment range, side). For example, segment 5 (K5-K6) between the cowl and the C-pillar is the
side glass, and segments 7-8 between the cowl and the header are the windscreen.

The UVs of the body shell have a fixed layout: the right side, left side and both end caps each have their
own island. Door lines, handles, fuel doors and grime are painted into `<name>_paint.png` in that UV space,
with a derived normal map, so LOD0 and LOD1 share the same textures.
