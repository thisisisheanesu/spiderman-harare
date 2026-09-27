#!/usr/bin/env bash
# Rebuild every vehicle: Blender (bpy) -> raw GLB -> meshopt/WebP GLB in public/models/vehicles -> three.js check.
#
#   BPY=/path/to/python-with-bpy VEH_NODE=/path/with/node_modules tools/vehicles/build_all.sh [names...]
#
#   BPY       Python with the `bpy` module (Blender 5.0 as a module: pip install bpy==5.0.*)
#   VEH_NODE  directory whose node_modules has @gltf-transform/{core,extensions,functions}, meshoptimizer, sharp
#   VEH_OUT   scratch directory for raw exports / previews (default /tmp/vehicles_build)
#   VEH_HDRI  optional equirect .hdr for the Cycles previews (e.g. a Poly Haven 1k sky)
#   RENDER=1  also render Cycles previews (slow: ~40 s per vehicle on 2 threads)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
BPY="${BPY:?set BPY to a python with bpy}"
VEH_NODE="${VEH_NODE:?set VEH_NODE to a dir with the gltf-transform node_modules}"
export VEH_OUT="${VEH_OUT:-/tmp/vehicles_build}"
mkdir -p "$VEH_OUT"
ARGS=()
[[ "${RENDER:-0}" == 1 ]] && ARGS+=(--render)
for v in ${@:-kombi hatch_fit sedan_corolla sedan_mercedes wagon_wish pickup_hilux suv_landcruiser taxi police_landcruiser bus_zupco truck_isuzu}; do
  "$BPY" "$HERE/build.py" "$v" --lod 0,1 "${ARGS[@]}" --out "$VEH_OUT"
done
VEH_NODE="$VEH_NODE" node "$HERE/optimize.mjs" "$VEH_OUT/raw" "$REPO/public/models/vehicles" "$@"
node "$HERE/verify/verify.mjs" "$REPO/public/models/vehicles" "$VEH_OUT/verify"
echo "done: $REPO/public/models/vehicles  (previews/screens in $VEH_OUT)"
