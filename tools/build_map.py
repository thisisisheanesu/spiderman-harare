#!/usr/bin/env python3
"""Convert Overture Maps GeoParquet layers for Harare CBD into the game's map file.

Usage:
    python3 tools/build_map.py OVERTURE_DIR [--out public/data/harare.json] [--preview preview.png]

Input: parquet files written by tools/fetch_overture.py (segment, building, place,
land_use, land, infrastructure). Optional tools/landmark_overrides.json supplies
researched heights/styles for landmark buildings.

Output coordinate system (see docs/ARCHITECTURE.md):
    metres, x = east, z = south (north is -z), y = up.
    origin = centre of Africa Unity Square.
    Polygon outer rings are counter-clockwise when viewed from above with north up
    (i.e. CCW in the (x, -z) plane); holes are clockwise.
"""
import argparse
import hashlib
import json
import math
import os
import sys
from collections import Counter, defaultdict

import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import substring

ORIGIN_LAT = -17.82932
ORIGIN_LON = 31.05202
M_PER_DEG_LAT = 110574.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(ORIGIN_LAT))

# Centre of the tall CBD core (around First St / Nelson Mandela Ave).
CORE_LAT, CORE_LON = -17.8285, 31.0508
BBOX = (31.030, -17.840, 31.062, -17.815)

DRIVABLE = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "residential",
    "unclassified", "service", "living_street",
}
ROAD_WIDTH = {
    "motorway": 20, "trunk": 18, "primary": 15, "secondary": 13, "tertiary": 12,
    "residential": 9, "unclassified": 8, "service": 5.5, "living_street": 7,
    "pedestrian": 11, "footway": 3, "path": 2.5, "cycleway": 2.5, "track": 3.5,
    "steps": 2.5, "unknown": 6,
}
LANES = {
    "motorway": 3, "trunk": 2, "primary": 2, "secondary": 2, "tertiary": 1,
    "residential": 1, "unclassified": 1, "service": 1, "living_street": 1,
}


def proj(lon, lat):
    x = (lon - ORIGIN_LON) * M_PER_DEG_LON
    z = -(lat - ORIGIN_LAT) * M_PER_DEG_LAT
    return x, z


def proj_geom_coords(coords):
    return [proj(lon, lat) for lon, lat in coords]


def r1(v):
    return round(v, 1)


def flat(pts):
    out = []
    for x, z in pts:
        out.append(r1(x))
        out.append(r1(z))
    return out


def seeded(s, salt=""):
    h = hashlib.md5((s + salt).encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def ring_area_xn(pts):
    """Signed area in the (x, north) plane where north = -z. Positive = CCW."""
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % n]
        a += x1 * (-z2) - x2 * (-z1)
    return a / 2.0


def orient(pts, ccw=True):
    if pts and pts[0] == pts[-1]:
        pts = pts[:-1]
    a = ring_area_xn(pts)
    if (a > 0) != ccw:
        pts = pts[::-1]
    return pts


def names_primary(r):
    n = r.get("names") or {}
    return n.get("primary")


def load(dirpath, name):
    p = os.path.join(dirpath, f"{name}.parquet")
    if not os.path.exists(p):
        print(f"warning: missing {p}", file=sys.stderr)
        return []
    return pq.read_table(p).to_pylist()


# ---------------------------------------------------------------- buildings
def height_potential(lon, lat):
    dx = (lon - CORE_LON) * M_PER_DEG_LON
    dz = (lat - CORE_LAT) * M_PER_DEG_LAT
    return math.exp(-((dx / 520.0) ** 2 + (dz / 420.0) ** 2))


def estimate_height(rec, area, lon, lat):
    """Return (height_m, floors, estimated_flag)."""
    h = rec.get("height")
    nf = rec.get("num_floors")
    cls = rec.get("class") or ""
    if h:
        return float(h), int(nf or max(1, round(h / 3.5))), False
    if nf:
        return nf * 3.5 + 1.2, int(nf), False
    if cls in ("carport", "roof", "toilets", "service"):
        return 3.2, 1, True
    if cls in ("house", "detached", "bungalow", "garage", "shed"):
        return 3.0 + seeded(rec["id"]) * 3.2, 1 + int(seeded(rec["id"], "f") * 1.6), True
    pot = height_potential(lon, lat)
    rnd = seeded(rec["id"])
    if pot < 0.08:
        # Suburbs / Avenues fringe: mostly one or two storeys, some walk-up flats.
        base = 1 + (1 if rnd > 0.55 else 0)
        if cls in ("apartments", "residential", "commercial") and area > 300:
            base += int(seeded(rec["id"], "a") * 3)
        floors = base
    else:
        # CBD: taller where the potential is high and the footprint is big.
        size = min(1.0, math.sqrt(max(area, 1.0)) / 45.0)
        max_f = 2 + pot * 13 * (0.35 + 0.65 * size)
        floors = 1 + int((rnd ** 1.35) * max_f)
        if area < 90:
            floors = min(floors, 2)
        elif area < 250:
            floors = min(floors, 4)
        if cls == "retail" and area < 600:
            floors = min(floors, 3)
    fh = 3.4 if height_potential(lon, lat) > 0.08 else 3.0
    return floors * fh + 0.8, int(floors), True


def build_buildings(rows, overrides):
    out = []
    by_id = {}
    for r in rows:
        g = wkb.loads(r["geometry"])
        polys = [g] if g.geom_type == "Polygon" else list(getattr(g, "geoms", []))
        for pi, poly in enumerate(polys):
            if poly.geom_type != "Polygon" or poly.is_empty:
                continue
            ext = proj_geom_coords(poly.exterior.coords)
            p = Polygon(ext, [proj_geom_coords(h.coords) for h in poly.interiors])
            if not p.is_valid:
                p = p.buffer(0)
                if p.geom_type != "Polygon":
                    continue
            p = p.simplify(0.25, preserve_topology=True)
            if p.is_empty or p.area < 10:
                continue
            c = poly.centroid
            h, floors, est = estimate_height(r, p.area, c.x, c.y)
            b = {
                "id": len(out),
                "oid": r["id"],
                "fp": flat(orient(list(p.exterior.coords), True)),
                "h": r1(h),
                "fl": floors,
            }
            holes = [orient(list(i.coords), False) for i in p.interiors if Polygon(i).area > 25]
            if holes:
                b["holes"] = [flat(hh) for hh in holes]
            mh = r.get("min_height")
            if mh:
                b["minH"] = r1(mh)
            name = names_primary(r)
            if name:
                b["name"] = name
            cls = r.get("class") or r.get("subtype")
            if cls:
                b["cls"] = cls
            src = {s.get("dataset") for s in (r.get("sources") or [])}
            b["src"] = "osm" if "OpenStreetMap" in src else ("google" if "Google Open Buildings" in src else "ms")
            if est:
                b["est"] = 1
            if height_potential(c.x, c.y) > 0.08:
                b["core"] = 1
            if r.get("facade_color"):
                b["facade"] = r["facade_color"]
            if r.get("roof_color"):
                b["roofColor"] = r["roof_color"]
            if r.get("roof_shape"):
                b["roofShape"] = r["roof_shape"]
            b["_c"] = (c.x, c.y, p.area)
            out.append(b)
            by_id.setdefault(r["id"], []).append(b)

    # Landmark overrides from research.
    applied = []
    for lm in overrides.get("landmarks", []):
        match = lm.get("match") or {}
        target = None
        oid = match.get("overture_id")
        if oid and oid in by_id:
            target = max(by_id[oid], key=lambda b: b["_c"][2])
        if target is None and match.get("name"):
            cands = [b for b in out if b.get("name") == match["name"]]
            if cands:
                target = max(cands, key=lambda b: b["_c"][2])
        if target is None and match.get("lat") is not None and match.get("lon") is not None:
            best, bd = None, 1e9
            for b in out:
                d = math.hypot((b["_c"][0] - match["lon"]) * M_PER_DEG_LON, (b["_c"][1] - match["lat"]) * M_PER_DEG_LAT)
                d -= min(30.0, math.sqrt(b["_c"][2]) * 0.3)  # prefer big footprints nearby
                if d < bd:
                    best, bd = b, d
            if best is not None and bd < 45:
                target = best
        if target is None:
            print(f"override: no match for {lm.get('key')} {lm.get('name')}", file=sys.stderr)
            continue
        if lm.get("height"):
            target["h"] = r1(float(lm["height"]))
            target.pop("est", None)
        if lm.get("floors"):
            target["fl"] = int(lm["floors"])
        target["lm"] = lm.get("key")
        if lm.get("name"):
            target["name"] = lm["name"]
        applied.append(lm.get("key"))
    for b in out:
        b.pop("_c", None)
    return out, applied


# ---------------------------------------------------------------- roads
def oneway_of(r):
    ar = r.get("access_restrictions") or []
    for a in ar:
        if a.get("access_type") != "denied" or a.get("between"):
            continue
        when = a.get("when") or {}
        if when.get("mode") or when.get("using") or when.get("vehicle") or when.get("during"):
            continue
        if when.get("heading") == "backward":
            return 1
        if when.get("heading") == "forward":
            return -1
    return 0


def width_of(r, cls, oneway):
    w = ROAD_WIDTH.get(cls, 6)
    wr = r.get("width_rules") or []
    for rule in wr:
        if rule.get("between") is None and rule.get("value"):
            w = max(float(rule["value"]), 4.0)
    if oneway and cls in ("motorway", "trunk", "primary"):
        w = w * 0.62
    return w


def build_roads(rows):
    nodes = {}
    node_list = []

    def node_index(cid, x, z):
        if cid not in nodes:
            nodes[cid] = len(node_list)
            node_list.append([r1(x), r1(z)])
        return nodes[cid]

    roads, paths, rail = [], [], []
    for r in rows:
        g = wkb.loads(r["geometry"])
        if g.geom_type != "LineString":
            continue
        line = LineString(proj_geom_coords(g.coords))
        if line.length < 0.5:
            continue
        sub, cls = r.get("subtype"), r.get("class") or "unknown"
        name = names_primary(r)
        if sub == "rail":
            rail.append({"cls": cls, "pts": flat(line.coords)})
            continue
        if cls not in DRIVABLE:
            p = {"cls": cls, "w": ROAD_WIDTH.get(cls, 3), "pts": flat(line.coords)}
            if name:
                p["name"] = name
            paths.append(p)
            continue
        ow = oneway_of(r)
        w = width_of(r, cls, ow)
        conns = sorted(r.get("connectors") or [], key=lambda c: c["at"])
        if not conns or conns[0]["at"] > 1e-6:
            conns = [{"connector_id": f"{r['id']}:start", "at": 0.0}] + conns
        if conns[-1]["at"] < 1 - 1e-6:
            conns = conns + [{"connector_id": f"{r['id']}:end", "at": 1.0}]
        flags = set()
        for f in r.get("road_flags") or []:
            if f.get("between") is None:
                flags.update(f.get("values") or [])
        sl = None
        for s in r.get("speed_limits") or []:
            mx = s.get("max_speed")
            if mx and mx.get("value") and s.get("between") is None:
                sl = mx["value"] * (1.609 if mx.get("unit") == "mph" else 1)
        for a, b in zip(conns, conns[1:]):
            if b["at"] - a["at"] < 1e-9:
                continue
            piece = substring(line, a["at"], b["at"], normalized=True)
            if piece.geom_type != "LineString" or piece.length < 0.3:
                continue
            coords = list(piece.coords)
            ia = node_index(a["connector_id"], *coords[0])
            ib = node_index(b["connector_id"], *coords[-1])
            e = {
                "cls": cls,
                "w": r1(w),
                "lanes": LANES.get(cls, 1),
                "oneway": ow,
                "a": ia,
                "b": ib,
                "len": r1(piece.length),
                "pts": flat(coords),
            }
            if name:
                e["name"] = name
            if "is_link" in flags:
                e["link"] = 1
            if "is_bridge" in flags:
                e["bridge"] = 1
            if sl:
                e["speed"] = round(sl)
            roads.append(e)
    return roads, paths, rail, node_list


# ---------------------------------------------------------------- areas / pois
AREA_KINDS = {
    ("land_use", "park"): "park",
    ("land_use", "grass"): "grass",
    ("land_use", "pitch"): "pitch",
    ("land_use", "golf_course"): "golf",
    ("land_use", "school"): "school",
    ("land_use", "college"): "school",
    ("land_use", "hospital"): "hospital",
    ("land", "wood"): "wood",
    ("land", "forest"): "wood",
    ("land", "scrub"): "scrub",
    ("infrastructure", "parking"): "parking",
    ("infrastructure", "bus_station"): "rank",
    ("infrastructure", "platform"): "platform",
}

PLACE_NAMES = {
    # (lat, lon, radius_m): name for unnamed polygons identified by position
    (-17.82397, 31.04657, 120): "Harare Gardens",
}


def build_areas(layers, overrides):
    areas = []
    for layer, rows in layers.items():
        for r in rows:
            kind = AREA_KINDS.get((layer, r.get("class")))
            if not kind:
                continue
            g = wkb.loads(r["geometry"])
            polys = [g] if g.geom_type == "Polygon" else [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon"]
            for poly in polys:
                c = poly.centroid
                if not (BBOX[0] - 0.01 < c.x < BBOX[2] + 0.01 and BBOX[1] - 0.01 < c.y < BBOX[3] + 0.01):
                    continue
                p = Polygon(proj_geom_coords(poly.exterior.coords)).simplify(0.4)
                if p.is_empty or p.area < 20 or p.geom_type != "Polygon":
                    continue
                a = {"kind": kind, "pts": flat(orient(list(p.exterior.coords), True))}
                name = names_primary(r)
                if not name:
                    for (lat, lon, rad), nm in PLACE_NAMES.items():
                        if math.hypot((c.x - lon) * M_PER_DEG_LON, (c.y - lat) * M_PER_DEG_LAT) < rad:
                            name = nm
                if name:
                    a["name"] = name
                areas.append(a)
    return areas


def build_points(infra_rows, land_rows, place_rows, buildings, overrides):
    ranks, trees, features, pois = [], [], [], []
    for r in infra_rows:
        g = wkb.loads(r["geometry"])
        cls = r.get("class")
        name = names_primary(r)
        c = g.centroid
        x, z = proj(c.x, c.y)
        if cls in ("bus_station", "bus_stop") or (cls == "platform" and name and "Bus" in name):
            ranks.append({"name": name or "Kombi rank", "x": r1(x), "z": r1(z), "kind": cls})
        elif cls in ("traffic_signals", "crossing", "fountain", "artwork", "railway_station", "communication_tower"):
            f = {"kind": cls, "x": r1(x), "z": r1(z)}
            if name:
                f["name"] = name
            features.append(f)
    for r in land_rows:
        if r.get("class") == "tree":
            g = wkb.loads(r["geometry"])
            x, z = proj(g.x, g.y)
            trees.append([r1(x), r1(z)])

    # POIs -> used for shop signage and map labels; attach to the containing / nearest building.
    grid = defaultdict(list)
    cell = 40.0
    for b in buildings:
        xs, zs = b["fp"][0::2], b["fp"][1::2]
        cx, cz = sum(xs) / len(xs), sum(zs) / len(zs)
        grid[(int(cx // cell), int(cz // cell))].append((b, cx, cz))
    for r in place_rows:
        name = names_primary(r)
        if not name or (r.get("confidence") or 0) < 0.55:
            continue
        g = wkb.loads(r["geometry"])
        x, z = proj(g.x, g.y)
        if height_potential(g.x, g.y) < 0.05:
            continue
        best, bd = None, 1e9
        gx, gz = int(x // cell), int(z // cell)
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for b, cx, cz in grid.get((gx + dx, gz + dz), []):
                    d = math.hypot(cx - x, cz - z)
                    if d < bd:
                        best, bd = b, d
        p = {"name": name, "cat": r.get("basic_category") or "", "x": r1(x), "z": r1(z)}
        if best is not None and bd < 60:
            p["b"] = best["id"]
        pois.append(p)

    for pl in overrides.get("places", []):
        if pl.get("lat") is None or pl.get("lon") is None:
            continue
        x, z = proj(pl["lon"], pl["lat"])
        features.append({"kind": pl.get("type", "place"), "name": pl.get("name"), "key": pl.get("key"), "x": r1(x), "z": r1(z)})
    return ranks, trees, features, pois


# ---------------------------------------------------------------- preview
def preview(data, path):
    from PIL import Image, ImageDraw

    S = 0.35  # px per metre
    xs = [v for b in data["buildings"] for v in b["fp"][0::2]]
    zs = [v for b in data["buildings"] for v in b["fp"][1::2]]
    minx, maxx, minz, maxz = min(xs), max(xs), min(zs), max(zs)
    W, H = int((maxx - minx) * S) + 20, int((maxz - minz) * S) + 20
    im = Image.new("RGB", (W, H), (235, 230, 220))
    d = ImageDraw.Draw(im)

    def P(x, z):
        return ((x - minx) * S + 10, (z - minz) * S + 10)

    for a in data["areas"]:
        pts = [P(a["pts"][i], a["pts"][i + 1]) for i in range(0, len(a["pts"]), 2)]
        col = {"park": (150, 200, 130), "grass": (170, 210, 150), "wood": (110, 160, 100), "rank": (240, 200, 120)}.get(a["kind"], (210, 210, 200))
        if len(pts) > 2:
            d.polygon(pts, fill=col)
    for rd in data["roads"]:
        pts = [P(rd["pts"][i], rd["pts"][i + 1]) for i in range(0, len(rd["pts"]), 2)]
        d.line(pts, fill=(90, 90, 95), width=max(1, int(rd["w"] * S)))
    for b in data["buildings"]:
        pts = [P(b["fp"][i], b["fp"][i + 1]) for i in range(0, len(b["fp"]), 2)]
        t = min(1.0, b["h"] / 80.0)
        col = (int(200 - 150 * t), int(120 - 80 * t), int(90 + 60 * t)) if b.get("lm") else (int(220 - 170 * t), int(200 - 150 * t), int(180 - 120 * t))
        if len(pts) > 2:
            d.polygon(pts, fill=col)
    for rk in data["ranks"]:
        x, y = P(rk["x"], rk["z"])
        d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(255, 140, 0))
    x, y = P(0, 0)
    d.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(255, 0, 0), width=2)
    im.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("overture_dir")
    ap.add_argument("--out", default="public/data/harare.json")
    ap.add_argument("--overrides", default="tools/landmark_overrides.json")
    ap.add_argument("--preview")
    args = ap.parse_args()

    overrides = {}
    if os.path.exists(args.overrides):
        with open(args.overrides) as f:
            overrides = json.load(f)

    seg = load(args.overture_dir, "segment")
    bld = load(args.overture_dir, "building")
    plc = load(args.overture_dir, "place")
    lu = load(args.overture_dir, "land_use")
    land = load(args.overture_dir, "land")
    inf = load(args.overture_dir, "infrastructure")

    buildings, applied = build_buildings(bld, overrides)
    roads, paths, rail, nodes = build_roads(seg)
    areas = build_areas({"land_use": lu, "land": land, "infrastructure": inf}, overrides)
    ranks, trees, features, pois = build_points(inf, land, plc, buildings, overrides)

    W, S, E, N = BBOX
    x0, z1 = proj(W, S)
    x1, z0 = proj(E, N)
    data = {
        "meta": {
            "name": "Harare CBD",
            "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON, "label": "Africa Unity Square"},
            "mPerDegLat": M_PER_DEG_LAT,
            "mPerDegLon": round(M_PER_DEG_LON, 3),
            "bounds": {"minX": r1(x0), "maxX": r1(x1), "minZ": r1(z0), "maxZ": r1(z1)},
            "units": "metres; x=east, z=south (north=-z), y=up; outer rings CCW seen from above (north up)",
            "attribution": "Map data: Overture Maps Foundation (release 2026-09-23.0), incl. OpenStreetMap contributors (ODbL), "
            "Google Open Buildings (CC BY 4.0), Microsoft ML Buildings (ODbL).",
            "landmarksApplied": applied,
            "landmarks": [
                {k: v for k, v in lm.items() if k in ("key", "name", "height", "floors", "style", "label", "confidence")}
                for lm in overrides.get("landmarks", [])
            ],
        },
        "buildings": buildings,
        "nodes": nodes,
        "roads": roads,
        "paths": paths,
        "rail": rail,
        "areas": areas,
        "ranks": ranks,
        "features": features,
        "trees": trees,
        "pois": pois,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    size = os.path.getsize(args.out)
    hs = sorted((b["h"] for b in buildings), reverse=True)
    print(f"wrote {args.out}: {size/1e6:.2f} MB")
    print(f"buildings {len(buildings)} (est {sum(1 for b in buildings if b.get('est'))}), core {sum(1 for b in buildings if b.get('core'))}")
    print(f"tallest: {hs[:12]}")
    print(f"roads {len(roads)} nodes {len(nodes)} paths {len(paths)} rail {len(rail)} areas {len(areas)} ranks {len(ranks)} pois {len(pois)}")
    print(f"landmarks applied: {applied}")
    print("road classes:", Counter(r["cls"] for r in roads).most_common())
    if args.preview:
        preview(data, args.preview)
        print("preview:", args.preview)


if __name__ == "__main__":
    main()
