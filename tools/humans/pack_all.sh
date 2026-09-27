#!/usr/bin/env bash
# Compress every built asset into the game's public dirs (meshopt + WebP).
#   HUMANS_SCRATCH=<scratch> HUMANS_NODE=<dir with node_modules> tools/humans/pack_all.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
S="${HUMANS_SCRATCH:?}"
OUTH="$REPO/public/models/humans"; OUTA="$REPO/public/models/anims"
mkdir -p "$OUTH" "$OUTA"
"$HERE/pack.sh" suits "$S/spiderman/spiderman_classic.glb" "$S/spiderman/spiderman_symbiote.glb" "$OUTH/spiderman.glb"
"$HERE/pack.sh" anims "$S/anims/humans_anims_raw.glb" "$OUTA/humans_anims.glb"
for f in "$S"/npcs/npc_*.glb; do
  b=$(basename "$f")
  case "$b" in
    *_lod1.glb) "$HERE/pack.sh" char "$f" "$OUTH/$b" 256 ;;
    *) "$HERE/pack.sh" char "$f" "$OUTH/$b" 1024 ;;
  esac
done
ls -la "$OUTH" "$OUTA"
