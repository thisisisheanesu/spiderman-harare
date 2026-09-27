#!/usr/bin/env bash
# Download the free ("name your price", $0) uploads of a CC0 itch.io asset pack.
# usage: itch_dl.sh <creator> <slug> <outdir> [name-filter-regex]
set -euo pipefail
CREATOR=$1; SLUG=$2; OUT=$3; FILTER=${4:-.}
UA="SpiderManHarare-asset-builder/1.0 (hobby game asset pipeline)"
mkdir -p "$OUT"; CJ=$(mktemp)
BASE="https://$CREATOR.itch.io/$SLUG"
PAGE=$(curl -sSL -A "$UA" -c "$CJ" -b "$CJ" "$BASE")
CSRF=$(grep -o 'name="csrf_token" value="[^"]*"' <<<"$PAGE" | head -1 | sed 's/.*value="//;s/"$//')
DLURL=$(curl -sS -A "$UA" -c "$CJ" -b "$CJ" -X POST --data-urlencode "csrf_token=$CSRF" "$BASE/download_url" | python3 -c 'import sys,json;print(json.load(sys.stdin)["url"])')
DLPAGE=$(curl -sSL -A "$UA" -c "$CJ" -b "$CJ" "$DLURL")
CSRF=$(grep -o 'name="csrf_token" value="[^"]*"' <<<"$DLPAGE" | head -1 | sed 's/.*value="//;s/"$//')
python3 - "$DLPAGE" <<'PY' > "$OUT/.uploads"
import re,sys
html=sys.argv[1]
for m in re.finditer(r'data-upload_id="(\d+)".*?class="name"[^>]*>([^<]*)', html, re.S):
    print(m.group(1)+"\t"+m.group(2).strip())
PY
while IFS=$'\t' read -r ID NAME; do
  [[ "$NAME" =~ $FILTER ]] || continue
  echo "upload $ID: $NAME"
  FURL=$(curl -sS -A "$UA" -c "$CJ" -b "$CJ" -X POST --data-urlencode "csrf_token=$CSRF" "$BASE/file/$ID?source=game_download&as_props=1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["url"])')
  curl -sSL -A "$UA" -o "$OUT/$NAME" "$FURL"
  ls -la "$OUT/$NAME"
  sleep 2
done < "$OUT/.uploads"
rm -f "$CJ"
