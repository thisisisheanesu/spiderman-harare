# Humans lane build tools

These scripts regenerate everything in `public/models/humans/` and `public/models/anims/`. All of the
heavy work runs in Blender 5.0 used as a Python module (`bpy`), with no GUI and no GPU.

## One-time setup

1. Set up a Python 3.11 venv with `bpy==5.0.*`, `numpy`, `scipy` and `pillow`. Below, `$PY` is that venv's python.
2. Install MPFB 2.0.17 (MakeHuman for Blender, GPL-3.0, used only as a tool) into the bpy user extensions:
   `$PY -c "import bpy; bpy.ops.extensions.package_install_files(filepath='add-on-mpfb-v2.0.17.zip', repo='user_default')"`
   Download it from https://extensions.blender.org/add-ons/mpfb/ . The scripts enable it at runtime with
   `addon_utils.enable('bl_ext.user_default.mpfb', default_set=True)` and never save user preferences.
3. Unzip these into MPFB's user data dir, `~/.config/blender/5.0/extensions/.user/user_default/mpfb/data/`:
   - `makehuman_system_assets_cc0.zip` (CC0).
   - The `clothes/` folders of these asset packs from https://static.makehumancommunity.org/assets/assetpacks.html :
     shirts01, pants01, dress01, skirts01, suits01, hats01, shoes01 (CC0), and shirts02, shirts03, pants02,
     shoes02, hats03, dress02, skirts02 (CC BY). Keep each pack's `packs/*.json` for `make_credits.py`.
     (To save disk space, the build machine kept only the clothes that `npc_variants.py` uses. Re-download the packs to try other clothes.)
4. Get the Quaternius Universal Animation Library 1 and 2 (Standard, CC0) with
   `itch_dl.sh quaternius universal-animation-library $HUMANS_SCRATCH/dl/ual1` (and `universal-animation-library-2`
   into `dl/ual2`), then unzip each into `x/`.
5. Install the Node tooling into some directory `$HUMANS_NODE`:
   `npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp`.

## Build (in order)

```
export HUMANS_SCRATCH=/path/to/scratch HUMANS_NODE=/path/with/node_modules
$PY tools/humans/build_spiderman.py        # body + masked head + procedural suits -> spiderman_{classic,symbiote}.glb, ref_rest.json
$PY tools/humans/build_anims.py            # retarget UAL1+2 onto Spider-Man's skeleton + procedural clips -> humans_anims_raw.glb
$PY tools/humans/build_npcs.py             # 23 NPC variants (npc_variants.py), one Blender process each, LOD0 + LOD1
tools/humans/pack_all.sh                   # meshopt + WebP into public/models/{humans,anims}
python3 tools/humans/make_docs.py $HUMANS_SCRATCH        # manifests + README tables
python3 tools/humans/make_credits.py $HUMANS_SCRATCH/npcs/variants_info.json <packs json dir> public/models/humans/CREDITS.md
```

Build times on 4 shared CPUs: Spider-Man about 100 s (the 2K suit paint takes most of it), animations about 40 s,
NPCs about 3 min.

## Files

| file | what it does |
|---|---|
| `mh_common.py` | MPFB setup, `build_human(spec)`, `finalize()` (bake targets, apply delete masks, turn to face +Y, i.e. glTF -Z), `normalize_rest()`, glTF export |
| `build_spiderman.py` | Spider-Man body (MakeHuman athletic male, 1.79 m). Mask head: ears flattened, the eye sockets and mouth are covered by a "fabric membrane" smoothing pass and welded shut. Decimated to 23k tris, then the suit textures are painted |
| `suit_paint.py` | Procedural suit painter in 3D (web in spherical and cylindrical coordinates, red/blue SDF regions, emblems, lenses) |
| `uvraster.py` | numpy UV rasteriser, island detection and dilation, used for texture painting and atlas baking |
| `retarget.py` | UAL (UE mannequin) to MPFB game_engine rotation retargeting via a matched T-pose |
| `anim_layers.py` / `procedural_clips.py` | FK, two-bone IK and twist layers used to author the extra clips on top of mocap-quality bases |
| `build_anims.py` | clip list, retarget, loop fixing, speed measurement, NLA export |
| `npc_variants.py` | the variant specs (bodies, clothes, colours from `src/data/streetlife.js`) |
| `build_npcs.py` / `npc_atlas.py` | MPFB build, hidden-face removal, decimation, head wraps, recolouring, 1K atlas bake, LOD1 |
| `gltf_pack.mjs` / `pack.sh` / `pack_all.sh` | merge the suit variants, strip non-pelvis translation tracks, meshopt + WebP |
| `make_docs.py` / `make_credits.py` | manifests, README tables and CREDITS.md |
| `itch_dl.sh` | downloads free ("name your price") itch.io packs |
| `verify/viewer.html` + `verify/shot.mjs` | three.js contact-sheet renderer (GLTFLoader + MeshoptDecoder + AnimationMixer) with headless Chromium screenshots |

Verification example (serve a directory containing `three` -> node_modules/three, `pub` -> public/models, and `viewer.html`):
`node tools/humans/verify/shot.mjs "http://127.0.0.1:5391/viewer.html?models=pub/humans/spiderman.glb&anims=pub/anims/humans_anims.glb&clips=walk,run&times=4&views=front,side" out.png`
