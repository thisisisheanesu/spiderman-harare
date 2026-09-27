#!/usr/bin/env bash
# Runs gltf_pack.mjs with the gltf-transform toolchain installed in $HUMANS_NODE
# (npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${HUMANS_NODE:?set HUMANS_NODE to a dir with node_modules/@gltf-transform}"
cp "$HERE/gltf_pack.mjs" "$HUMANS_NODE/gltf_pack.mjs"
node "$HUMANS_NODE/gltf_pack.mjs" "$@"
