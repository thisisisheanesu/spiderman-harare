#!/usr/bin/env python3
"""Download OpenStreetMap details for the Harare CBD bbox from the Overpass API.

Usage:
    python3 tools/fetch_osm.py OUT_JSON [--force]

Overture Maps (tools/fetch_overture.py) keeps the road graph and building footprints
but drops many OSM details the game wants: lane counts, sidewalk tags, traffic signal /
crossing / street-lamp / bus-stop nodes, individual trees and tree rows, markets and
building colour/material tags. This script fetches exactly those with one Overpass
query and saves the raw `[out:json]` response; tools/build_map.py --osm OUT_JSON merges
it into public/data/harare.json.

The result is cached: if OUT_JSON exists it is reused unless --force is given.

    pip install requests
"""
import argparse
import json
import os
import sys
import time

import requests

# south, west, north, east (Overpass order). Same box as tools/fetch_overture.py.
BBOX = (-17.840, 31.030, -17.815, 31.062)
# Tried in order; the main instance is often "too busy" (504), so fall back to mirrors.
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
USER_AGENT = "SpiderManHarareFanGame/0.1 (https://github.com/thisisisheanesu/spiderman-harare)"

BUILDING_TAGS = [
    "building:colour", "roof:colour", "building:material", "roof:material",
    "roof:shape", "building:levels", "height",
]


def query():
    bb = ",".join(str(v) for v in BBOX)
    bld = "\n".join(f'  way["building"]["{t}"];\n  relation["building"]["{t}"];' for t in BUILDING_TAGS)
    return f"""[out:json][timeout:180][bbox:{bb}];
(
  way["highway"];
  node["highway"~"^(traffic_signals|crossing|street_lamp|bus_stop|stop|give_way)$"];
  node["crossing"="traffic_signals"];
  node["natural"="tree"];
  way["natural"="tree_row"];
  nwr["amenity"~"^(marketplace|bus_station|taxi|fountain|bench|waste_basket)$"];
  node["shop"];
{bld}
);
out body geom qt;
"""


def fetch(q, attempts=3):
    last = None
    for attempt in range(attempts):
        if attempt:
            time.sleep(30 * attempt)
        for url in ENDPOINTS:
            try:
                print(f"POST {url} (attempt {attempt + 1})", file=sys.stderr)
                r = requests.post(url, data={"data": q}, headers={"User-Agent": USER_AGENT}, timeout=240)
                if r.status_code == 200:
                    data = r.json()
                    if data.get("remark") and "error" in data["remark"].lower():
                        raise RuntimeError(data["remark"])
                    print(f"ok from {url}, base {data.get('osm3s', {}).get('timestamp_osm_base')}", file=sys.stderr)
                    return data
                last = f"HTTP {r.status_code}: {r.text[:200]}"
                print(last, file=sys.stderr)
                if r.status_code == 429:
                    time.sleep(20 * (attempt + 1))
            except (requests.RequestException, ValueError, RuntimeError) as e:
                last = repr(e)
                print(last, file=sys.stderr)
            time.sleep(2)
    raise SystemExit(f"Overpass failed: {last}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    if os.path.exists(args.out) and not args.force:
        print(f"{args.out} exists (use --force to refetch)")
        return
    data = fetch(query())
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    els = data.get("elements", [])
    kinds = {}
    for e in els:
        t = e.get("tags", {})
        k = (e["type"], next((f"{key}={t[key]}" for key in ("highway", "natural", "amenity") if key in t),
                             "shop" if "shop" in t else "building" if "building" in t else "other"))
        if e["type"] == "way" and "highway" in t:
            k = ("way", "highway")
        kinds[k] = kinds.get(k, 0) + 1
    print(f"wrote {args.out}: {len(els)} elements, {os.path.getsize(args.out) / 1e6:.2f} MB")
    for k, v in sorted(kinds.items(), key=lambda kv: -kv[1])[:30]:
        print(f"  {v:6d}  {k[0]} {k[1]}")
    print(f"timestamp: {data.get('osm3s', {}).get('timestamp_osm_base')}")


if __name__ == "__main__":
    main()
