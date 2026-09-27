#!/usr/bin/env python3
"""Download Overture Maps layers for the Harare CBD bounding box as GeoParquet.

Usage:
    python3 tools/fetch_overture.py OUT_DIR

Reads straight from the public Overture S3 bucket with pyarrow (no STAC / DuckDB
needed), filtering row groups by the bbox columns. Produces one parquet file per
layer in OUT_DIR, which tools/build_map.py turns into public/data/harare.json.

    pip install pyarrow shapely
"""
import os
import sys
import time

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as pafs
import pyarrow.parquet as pq

RELEASE = "2026-09-23.0"
# west, south, east, north
BBOX = (31.030, -17.840, 31.062, -17.815)

LAYERS = [
    ("transportation", "segment"),
    ("buildings", "building"),
    ("places", "place"),
    ("base", "land_use"),
    ("base", "land"),
    ("base", "infrastructure"),
]


def fetch(fs, theme, typ, out_dir):
    W, S, E, N = BBOX
    path = f"overturemaps-us-west-2/release/{RELEASE}/theme={theme}/type={typ}/"
    t = time.time()
    d = ds.dataset(path, filesystem=fs, format="parquet")
    flt = (
        (pc.field("bbox", "xmin") < E)
        & (pc.field("bbox", "xmax") > W)
        & (pc.field("bbox", "ymin") < N)
        & (pc.field("bbox", "ymax") > S)
    )
    tbl = d.to_table(filter=flt)
    pq.write_table(tbl, os.path.join(out_dir, f"{typ}.parquet"))
    print(f"{theme}/{typ}: {tbl.num_rows} rows in {time.time() - t:.1f}s", flush=True)


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "overture"
    os.makedirs(out_dir, exist_ok=True)
    fs = pafs.S3FileSystem(
        anonymous=True, region="us-west-2", proxy_options=os.environ.get("HTTPS_PROXY")
    )
    for theme, typ in LAYERS:
        fetch(fs, theme, typ, out_dir)


if __name__ == "__main__":
    main()
