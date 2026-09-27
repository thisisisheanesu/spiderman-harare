#!/usr/bin/env python3
"""Convert Overture Maps GeoParquet layers for Harare CBD into the game's map file.

Usage:
    python3 tools/build_map.py OVERTURE_DIR [--out public/data/harare.json] [--preview preview.png]
                               [--osm osm.json]

Input: parquet files written by tools/fetch_overture.py (segment, building, place,
land_use, land, infrastructure). Optional tools/landmark_overrides.json supplies
researched heights/styles for landmark buildings. Optional --osm takes the raw Overpass
JSON written by tools/fetch_osm.py and adds OSM details Overture drops (lanes, sidewalks,
widths, signals/crossings/bus stops/lamps/trees/markets, building colours/materials).

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
import re
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


def flat_line(pts):
    """flat() for polylines: drops consecutive points that coincide after rounding (keeps both ends)."""
    out = []
    last = None
    n = len(pts)
    for i, (x, z) in enumerate(pts):
        q = (r1(x), r1(z))
        if q == last and i != n - 1:
            continue
        if q == last and len(out) > 2:
            out.pop()
            out.pop()
        out.extend(q)
        last = q
    return out


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


def osm_refs(r, kinds=("w",), spans=False):
    """OSM elements an Overture feature was built from, from sources[].record_id ("w532698242@4").

    Returns [(kind, id)] or, with spans=True, [(kind, id, from, to)] where from/to is the
    source's 'between' range along the feature (0..1)."""
    out = []
    for s in r.get("sources") or []:
        if s.get("dataset") != "OpenStreetMap" or (s.get("property") or "") != "":
            continue
        rid = s.get("record_id") or ""
        if rid[:1] not in kinds:
            continue
        try:
            oid = int(rid[1:].split("@")[0])
        except ValueError:
            continue
        if spans:
            bt = s.get("between") or [0.0, 1.0]
            out.append((rid[0], oid, float(bt[0]), float(bt[1])))
        else:
            out.append((rid[0], oid))
    return out


def pick_span(srcs, a0, a1):
    """OSM way id whose 'between' span overlaps [a0, a1] the most (None if no OSM source)."""
    best, bo = None, 0.0
    for _, oid, s0, s1 in srcs:
        ov = min(a1, s1) - max(a0, s0)
        if ov > bo:
            best, bo = oid, ov
    return best


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
            if r.get("facade_material"):
                b["material"] = r["facade_material"]
            b["_c"] = (c.x, c.y, p.area)
            b["_osm"] = osm_refs(r, ("w", "r"))
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
        srcs = osm_refs(r, ("w",), spans=True)
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
                "pts": flat_line(coords),
            }
            # Snap the ends onto the shared graph nodes (connectors can differ by rounding noise).
            e["pts"][0:2] = node_list[ia]
            e["pts"][-2:] = node_list[ib]
            e["pts"] = flat_line(list(zip(e["pts"][0::2], e["pts"][1::2])))
            if name:
                e["name"] = name
            if "is_link" in flags:
                e["link"] = 1
            if "is_bridge" in flags:
                e["bridge"] = 1
            if sl:
                e["speed"] = round(sl)
            e["_osm"] = pick_span(srcs, a["at"], b["at"])
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


# ---------------------------------------------------------------- OSM enrichment (optional --osm)
# Raw Overpass JSON from tools/fetch_osm.py. Everything here only *adds* optional fields /
# entries (or refines values: lanes, w, estimated heights); without --osm none of it runs.
CSS_COLOURS = {
    "white": "#FFFFFF", "black": "#000000", "grey": "#808080", "gray": "#808080", "silver": "#C0C0C0",
    "lightgrey": "#D3D3D3", "lightgray": "#D3D3D3", "darkgrey": "#A9A9A9", "darkgray": "#A9A9A9",
    "red": "#FF0000", "darkred": "#8B0000", "maroon": "#800000", "brown": "#A52A2A", "sienna": "#A0522D",
    "orange": "#FFA500", "yellow": "#FFFF00", "beige": "#F5F5DC", "cream": "#FFFDD0", "tan": "#D2B48C",
    "green": "#008000", "darkgreen": "#006400", "olive": "#808000", "blue": "#0000FF", "navy": "#000080",
    "lightblue": "#ADD8E6", "teal": "#008080", "pink": "#FFC0CB", "purple": "#800080", "gold": "#FFD700",
}
# OSM shop=* -> category words the runtime's shop-sign matcher understands (Overture-style).
SHOP_CAT = {
    "clothes": "fashion_and_apparel_store", "shoes": "fashion_and_apparel_store", "boutique": "fashion_and_apparel_store",
    "supermarket": "grocery_store", "convenience": "grocery_store", "mall": "shopping_mall",
    "department_store": "department_store", "mobile_phone": "mobile_phone_store", "computer": "electronics_store",
    "electrical": "electronics_store", "hairdresser": "personal_or_beauty_service", "beauty": "personal_or_beauty_service",
    "car_repair": "automotive_service", "copyshop": "printing_service", "bookmaker": "betting_shop",
    "optician": "optician_store", "books": "book_store", "jewelry": "jewelry_store",
    "variety_store": "discount_store", "hardware": "hardware_home_and_garden_store", "yes": "shopping",
}


def shop_cat(shop):
    """Overture-style category for an OSM shop=* value (never 'x_store_store')."""
    shop = shop.strip().lower().replace(" ", "_")
    if shop in SHOP_CAT:
        return SHOP_CAT[shop]
    return shop if shop.endswith(("_store", "_shop")) else f"{shop}_store"


def load_osm(path):
    with open(path) as f:
        d = json.load(f)
    osm = {"nodes": [], "ways": {}, "rels": {}, "timestamp": (d.get("osm3s") or {}).get("timestamp_osm_base")}
    for e in d.get("elements", []):
        t = e.get("type")
        if t == "node":
            osm["nodes"].append(e)
        elif t == "way":
            osm["ways"][e["id"]] = e
        elif t == "relation":
            osm["rels"][e["id"]] = e
    return osm


def num(v):
    """First number in an OSM value ('3', '2;3', '7 m', '12.5'), or None."""
    if v is None:
        return None
    m = re.match(r"\s*(\d+(?:\.\d+)?)", str(v))
    return float(m.group(1)) if m else None


def inum(v):
    n = num(v)
    return int(round(n)) if n is not None else None


def colour(v):
    if not v:
        return None
    v = v.strip().lower().replace(" ", "").replace("_", "")
    if re.fullmatch(r"#[0-9a-f]{6}", v):
        return v.upper()
    if re.fullmatch(r"#[0-9a-f]{3}", v):
        return ("#" + "".join(c * 2 for c in v[1:])).upper()
    return CSS_COLOURS.get(v)


def osm_xy(e):
    return proj(e["lon"], e["lat"])


def way_line(way, cache):
    wid = way["id"]
    if wid not in cache:
        g = way.get("geometry") or []
        pts = [proj(p["lon"], p["lat"]) for p in g if p]
        cache[wid] = LineString(pts) if len(pts) >= 2 else None
    return cache[wid]


def edge_reversed(e, line):
    """True when the edge's a->b direction runs against the OSM way's node order."""
    pts = e["pts"]
    d0 = line.project(Point(pts[0], pts[1]))
    d1 = line.project(Point(pts[-2], pts[-1]))
    if line.is_ring and abs(d1 - d0) > line.length / 2:
        return d1 > d0
    return d1 < d0


def osm_lanes(t, e, rev):
    """(lanes per direction, (a->b, b->a) if asymmetric) for edge e from OSM lane tags, or (None, None).

    OSM 'lanes' counts every lane of the way: on a oneway that is all in one direction, on a two-way
    road it is split between both (minus lanes:both_ways centre turn lanes)."""
    total, fw, bw = inum(t.get("lanes")), inum(t.get("lanes:forward")), inum(t.get("lanes:backward"))
    both = inum(t.get("lanes:both_ways")) or 0
    osm_oneway = t.get("oneway") in ("yes", "true", "1", "-1", "reversible") or t.get("junction") in ("roundabout", "circular")
    if total is not None and total <= 0:
        total = None
    if e["oneway"]:
        if osm_oneway:
            n = total or fw or bw
        else:
            forward = (e["oneway"] == 1) != rev  # allowed travel direction == OSM forward?
            n = (fw if forward else bw) or (max(1, (total - both) // 2) if total else None)
        return (max(1, n) if n else None), None
    if osm_oneway:
        # Overture keeps this piece two-way (e.g. a partial restriction): share the lanes out.
        return (max(1, (total + 1) // 2) if total else None), None
    if total and (fw is None) != (bw is None):
        known = fw if fw is not None else bw
        other = max(1, total - both - known)
        fw, bw = (known, other) if fw is not None else (other, known)
    if fw and bw:
        fe, be = (bw, fw) if rev else (fw, bw)
        # The runtime model is symmetric (lanes per direction), so round the average up.
        return max(1, (fe + be + 1) // 2), ((fe, be) if fe != be else None)
    if total:
        return max(1, (total - both) // 2), None
    return None, None


def osm_sidewalk(t, rev):
    v = t.get("sidewalk")
    if v == "none":
        v = "no"
    if v not in ("both", "left", "right", "no", "separate"):
        v = None
        sb = t.get("sidewalk:both")
        sl, sr = t.get("sidewalk:left"), t.get("sidewalk:right")
        if sb in ("yes", "separate", "no"):
            v = {"yes": "both"}.get(sb, sb)
        elif sl or sr:
            ly, ry = sl in ("yes", "separate"), sr in ("yes", "separate")
            if sl == "separate" and sr == "separate":
                v = "separate"
            elif ly and ry:
                v = "both"
            elif ly:
                v = "left"
            elif ry:
                v = "right"
            elif sl == "no" and sr == "no":
                v = "no"
    if v and rev and v in ("left", "right"):
        v = "right" if v == "left" else "left"
    return v


MIN_LANE_W = 2.75


def enrich_roads(roads, osm):
    """Add OSM lanes / osmSidewalk / width to road edges via the OSM way each edge was built from."""
    st = Counter()
    cache = {}
    for e in roads:
        wid = e.get("_osm")
        way = osm["ways"].get(wid) if wid else None
        if not way:
            continue
        st["matched"] += 1
        t = way.get("tags") or {}
        line = way_line(way, cache)
        rev = edge_reversed(e, line) if line is not None else False
        lanes, asym = osm_lanes(t, e, rev)
        if lanes:
            st["lanes"] += 1
            st["lanes_len"] += e["len"]
            if lanes != e["lanes"]:
                st["lanes_changed"] += 1
            e["lanes"] = min(lanes, 5)
            if asym:
                e["lanesF"], e["lanesB"] = asym
                st["lanes_asym"] += 1
        sw = osm_sidewalk(t, rev)
        if sw:
            e["osmSidewalk"] = sw
            st["sidewalk"] += 1
        # Width: a measured OSM carriageway width beats the class default (reject road-reserve values).
        wv = num(t.get("width"))
        if wv is not None and ("'" in t["width"] or "ft" in t["width"]):
            wv *= 0.3048
        used_width = False
        if wv and 3.0 <= wv <= ROAD_WIDTH.get(e["cls"], 8) * 1.8:
            used_width = True
            if abs(wv - e["w"]) >= 0.5:
                e["w"] = r1(max(wv, 4.0))
                st["width"] += 1
        # A class-default width too narrow for the mapped lane count: widen (at most +40 %).
        k = 1 if e["oneway"] else 2
        if lanes and not used_width and e["w"] / (e["lanes"] * k) < MIN_LANE_W:
            e["w"] = r1(min(e["lanes"] * k * 3.0, e["w"] * 1.4))
            st["widened"] += 1
        # Still no room (e.g. a measured 7 m width tagged with 3 lanes): drop lanes until each is >= 2.5 m.
        if lanes and e["lanes"] > 1 and e["w"] / (e["lanes"] * k) < 2.5:
            while e["lanes"] > 1 and e["w"] / (e["lanes"] * k) < 2.5:
                e["lanes"] -= 1
            e.pop("lanesF", None)
            e.pop("lanesB", None)
            st["lanes_fit"] += 1
        if (t.get("oneway") in ("yes", "-1") or t.get("junction") == "roundabout") and not e["oneway"]:
            st["oneway_mismatch"] += 1  # reported only; Overture's oneway stays authoritative
    return st


def node_finder(nodes, roads):
    deg = Counter()
    for r in roads:
        deg[r["a"]] += 1
        deg[r["b"]] += 1

    def nearest(x, z, maxd=25.0):
        """Index of the nearest road graph node within maxd, preferring junctions (3+ edges)."""
        best, bd = None, 1e9
        for i, (nx, nz) in enumerate(nodes):
            d = math.hypot(nx - x, nz - z)
            if d > maxd:
                continue
            score = d + (0.0 if deg[i] >= 3 else 8.0)
            if score < bd:
                best, bd = i, score
        return best

    return nearest


def osm_polygon(el, osm):
    """Projected shapely Polygon of a closed way / multipolygon relation, or None."""
    from shapely.ops import polygonize, unary_union

    if el["type"] == "way":
        g = el.get("geometry") or []
        pts = [proj(p["lon"], p["lat"]) for p in g if p]
        if len(pts) >= 4 and el.get("nodes", [0])[0] == el.get("nodes", [1])[-1]:
            return Polygon(pts)
        return None
    lines = []
    for m in el.get("members") or []:
        if m.get("type") == "way" and m.get("role") in ("outer", "") and m.get("geometry"):
            lines.append(LineString([proj(p["lon"], p["lat"]) for p in m["geometry"] if p]))
    polys = list(polygonize(unary_union(lines))) if lines else []
    return max(polys, key=lambda p: p.area) if polys else None


def enrich_points(osm, bounds, nodes, roads, features, ranks, trees, pois, buildings):
    """OSM nodes -> features / lamps / trees / markets / pois. Returns (lamps, markets, stats)."""
    st = Counter()
    x0, x1, z0, z1 = bounds["minX"], bounds["maxX"], bounds["minZ"], bounds["maxZ"]
    inside = lambda x, z: x0 <= x <= x1 and z0 <= z <= z1  # noqa: E731
    nearest = node_finder(nodes, roads)

    def find_feature(kind, x, z, rad):
        for f in features:
            if f["kind"] == kind and math.hypot(f["x"] - x, f["z"] - z) < rad:
                return f
        return None

    lamps, markets = [], []
    tree_grid = defaultdict(list)

    def add_tree(x, z):
        k = (int(x // 4), int(z // 4))
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for tx, tz in tree_grid.get((k[0] + dx, k[1] + dz), []):
                    if math.hypot(tx - x, tz - z) < 2.0:
                        return False
        tree_grid[k].append((x, z))
        trees.append([r1(x), r1(z)])
        return True

    for tx, tz in trees:
        tree_grid[(int(tx // 4), int(tz // 4))].append((tx, tz))

    kinds = {"traffic_signals": "traffic_signals", "crossing": "crossing", "bus_stop": "bus_stop", "stop": "stop", "give_way": "give_way"}
    amen = {"fountain": "fountain", "bench": "bench", "waste_basket": "waste_basket", "taxi": "taxi"}
    for n in osm["nodes"]:
        t = n.get("tags") or {}
        x, z = osm_xy(n)
        if not inside(x, z):
            continue
        hw = t.get("highway")
        if hw == "street_lamp":
            lamps.append([r1(x), r1(z)])
            continue
        if t.get("natural") == "tree":
            st["trees_osm"] += add_tree(x, z)
            continue
        kind = kinds.get(hw) or amen.get(t.get("amenity"))
        if not kind and t.get("crossing") == "traffic_signals":
            kind = "crossing"
        if kind:
            f = find_feature(kind, x, z, 15.0 if kind == "fountain" else 5.0)
            if f is None:
                f = {"kind": kind, "x": r1(x), "z": r1(z)}
                features.append(f)
                st["feat_" + kind] += 1
            else:
                st["feat_dup"] += 1
            if t.get("name") and not f.get("name"):
                f["name"] = t["name"]
            if kind == "crossing" and (t.get("crossing") == "traffic_signals" or t.get("crossing_ref") == "pelican"):
                f["signals"] = 1
            if kind == "traffic_signals":
                ni = nearest(f["x"], f["z"])
                if ni is not None:
                    f["node"] = ni
        if t.get("amenity") == "marketplace" or (
            t.get("shop") and re.search(r"\bmarket\b", t.get("name", ""), re.I) and not re.search(r"super|mega|hyper", t.get("name", ""), re.I)
        ):
            markets.append({"name": t.get("name") or "Market", "x": r1(x), "z": r1(z)})

    # Tree rows: a tree every ~9 m.
    cache = {}
    for w in list(osm["ways"].values()) + list(osm["rels"].values()):
        t = w.get("tags") or {}
        if w["type"] == "way" and t.get("natural") == "tree_row":
            line = way_line(w, cache)
            if line is None:
                continue
            n = max(1, round(line.length / 9.0))
            for i in range(n + 1):
                p = line.interpolate(line.length * i / n)
                if inside(p.x, p.y):
                    st["trees_row"] += add_tree(p.x, p.y)
        if t.get("amenity") == "marketplace":
            poly = osm_polygon(w, osm)
            if poly is None or poly.is_empty:
                continue
            c = poly.centroid
            m = {"name": t.get("name") or "Market", "x": r1(c.x), "z": r1(c.y)}
            p = poly.simplify(0.4)
            if p.geom_type == "Polygon" and not p.is_empty:
                m["pts"] = flat(orient(list(p.exterior.coords), True))
            markets.append(m)

    # Named OSM shops Overture's places layer lacks -> pois (for shop signs / map labels).
    grid = defaultdict(list)
    cell = 40.0
    for b in buildings:
        xs, zs = b["fp"][0::2], b["fp"][1::2]
        cx, cz = sum(xs) / len(xs), sum(zs) / len(zs)
        grid[(int(cx // cell), int(cz // cell))].append((b, cx, cz))
    norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())  # noqa: E731
    known = defaultdict(list)
    for p in pois:
        known[norm(p["name"])].append((p["x"], p["z"]))
    for n in osm["nodes"]:
        t = n.get("tags") or {}
        name = t.get("name")
        if not t.get("shop") or not name:
            continue
        x, z = osm_xy(n)
        if not inside(x, z) or any(math.hypot(px - x, pz - z) < 80 for px, pz in known[norm(name)]):
            continue
        best, bd = None, 1e9
        gx, gz = int(x // cell), int(z // cell)
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for b, cx, cz in grid.get((gx + dx, gz + dz), []):
                    d = math.hypot(cx - x, cz - z)
                    if d < bd:
                        best, bd = b, d
        p = {"name": name, "cat": shop_cat(t["shop"]), "x": r1(x), "z": r1(z)}
        if best is not None and bd < 60:
            p["b"] = best["id"]
        pois.append(p)
        known[norm(name)].append((x, z))
        st["pois"] += 1
    return lamps, markets, st


def enrich_buildings(buildings, osm):
    """Colours / material / roof shape (and heights for estimated ones) from the cited OSM building."""
    st = Counter()
    for b in buildings:
        tags = None
        for kind, oid in b.get("_osm") or []:
            el = (osm["ways"] if kind == "w" else osm["rels"]).get(oid)
            if el and el.get("tags"):
                tags = el["tags"]
                break
        if not tags:
            continue
        st["matched"] += 1
        for key, field, conv in (
            ("building:colour", "facade", colour),
            ("roof:colour", "roofColor", colour),
            ("building:material", "material", lambda v: v.strip().lower() or None),
            ("roof:shape", "roofShape", lambda v: v.strip().lower() or None),
        ):
            v = conv(tags[key]) if tags.get(key) else None
            if v and not b.get(field):
                b[field] = v
                st[field] += 1
        if b.get("est") and not b.get("lm"):
            h, lv = num(tags.get("height")), num(tags.get("building:levels"))
            if h and 2.5 <= h <= 200:
                b["h"], b["fl"] = r1(h), int(lv) if lv else max(1, round(h / 3.5))
            elif lv and 1 <= lv <= 60:
                b["h"], b["fl"] = r1(lv * 3.5 + 1.2), int(lv)
            else:
                continue
            b.pop("est", None)
            st["height"] += 1
    return st


def validate(data):
    """Sanity checks on the output; returns a list of problems (empty = ok)."""
    errs = []
    nn = len(data["nodes"])
    bd = data["meta"]["bounds"]
    for i, r in enumerate(data["roads"]):
        if not (0 <= r["a"] < nn and 0 <= r["b"] < nn):
            errs.append(f"road {i}: bad node index {r['a']}/{r['b']}")
        if len(r["pts"]) < 4 or len(r["pts"]) % 2:
            errs.append(f"road {i}: bad pts")
        if r.get("lanes", 1) < 1:
            errs.append(f"road {i}: lanes {r.get('lanes')}")
    for f in data["features"]:
        # Researched places (with a 'key') may sit outside on purpose, e.g. heroes_acre as a skyline marker.
        if not f.get("key") and not (bd["minX"] <= f["x"] <= bd["maxX"] and bd["minZ"] <= f["z"] <= bd["maxZ"]):
            errs.append(f"feature outside bounds: {f}")
        if "node" in f and not (0 <= f["node"] < nn):
            errs.append(f"feature bad node: {f}")
    nb = len(data["buildings"])
    for p in data["pois"]:
        if "b" in p and not (0 <= p["b"] < nb):
            errs.append(f"poi bad building: {p}")
    for k in ("lamps", "trees"):
        for x, z in data.get(k, []):
            if not (bd["minX"] - 1 <= x <= bd["maxX"] + 1 and bd["minZ"] - 1 <= z <= bd["maxZ"] + 1):
                errs.append(f"{k} point outside bounds: {x},{z}")
    return errs


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
    for m in data.get("markets", []):
        x, y = P(m["x"], m["z"])
        d.rectangle([x - 5, y - 5, x + 5, y + 5], outline=(150, 40, 170), width=2)
    for tx, tz in data.get("trees", []):
        x, y = P(tx, tz)
        d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(40, 140, 50))
    for lx, lz in data.get("lamps", []):
        x, y = P(lx, lz)
        d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(250, 220, 0))
    fcol = {"traffic_signals": (230, 0, 0), "crossing": (255, 255, 255), "bus_stop": (30, 90, 230),
            "stop": (140, 0, 0), "give_way": (140, 0, 0)}
    for f in data["features"]:
        col = fcol.get(f["kind"])
        if not col:
            continue
        x, y = P(f["x"], f["z"])
        r = 6 if f["kind"] == "traffic_signals" else 3
        d.ellipse([x - r, y - r, x + r, y + r], fill=col, outline=(0, 0, 0))
    x, y = P(0, 0)
    d.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(255, 0, 0), width=2)
    im.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("overture_dir")
    ap.add_argument("--out", default="public/data/harare.json")
    ap.add_argument("--overrides", default="tools/landmark_overrides.json")
    ap.add_argument("--preview")
    ap.add_argument("--osm", help="raw Overpass JSON from tools/fetch_osm.py (optional)")
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

    osm = None
    if args.osm:
        if os.path.exists(args.osm):
            osm = load_osm(args.osm)
        else:
            print(f"warning: missing {args.osm}; building without OSM details", file=sys.stderr)

    W, S, E, N = BBOX
    x0, z1 = proj(W, S)
    x1, z0 = proj(E, N)
    bounds = {"minX": r1(x0), "maxX": r1(x1), "minZ": r1(z0), "maxZ": r1(z1)}

    buildings, applied = build_buildings(bld, overrides)
    roads, paths, rail, nodes = build_roads(seg)
    areas = build_areas({"land_use": lu, "land": land, "infrastructure": inf}, overrides)
    ranks, trees, features, pois = build_points(inf, land, plc, buildings, overrides)
    lamps, markets = [], []
    rst = bst = pst = Counter()
    if osm:
        rst = enrich_roads(roads, osm)
        bst = enrich_buildings(buildings, osm)
        lamps, markets, pst = enrich_points(osm, bounds, nodes, roads, features, ranks, trees, pois, buildings)
    for item in buildings + roads:
        item.pop("_osm", None)
    data = {
        "meta": {
            "name": "Harare CBD",
            "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON, "label": "Africa Unity Square"},
            "mPerDegLat": M_PER_DEG_LAT,
            "mPerDegLon": round(M_PER_DEG_LON, 3),
            "bounds": bounds,
            "units": "metres; x=east, z=south (north=-z), y=up; outer rings CCW seen from above (north up)",
            "attribution": "Map data: Overture Maps Foundation (release 2026-09-23.0), incl. OpenStreetMap contributors (ODbL), "
            "Google Open Buildings (CC BY 4.0), Microsoft ML Buildings (ODbL)."
            + (" Extra details from OpenStreetMap contributors (ODbL) via the Overpass API." if osm else ""),
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
        "lamps": lamps,
        "markets": markets,
    }
    if osm and osm.get("timestamp"):
        data["meta"]["osmTimestamp"] = osm["timestamp"]
    problems = validate(data)
    for msg in problems[:20]:
        print("validate:", msg, file=sys.stderr)
    if problems:
        sys.exit(f"validation failed ({len(problems)} problems)")
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    size = os.path.getsize(args.out)
    hs = sorted((b["h"] for b in buildings), reverse=True)
    print(f"wrote {args.out}: {size/1e6:.2f} MB")
    print(f"buildings {len(buildings)} (est {sum(1 for b in buildings if b.get('est'))}), core {sum(1 for b in buildings if b.get('core'))}")
    print(f"tallest: {hs[:12]}")
    print(f"roads {len(roads)} nodes {len(nodes)} paths {len(paths)} rail {len(rail)} areas {len(areas)} ranks {len(ranks)} pois {len(pois)}")
    print(f"landmarks applied: {applied}")
    print("road classes:", Counter(r["cls"] for r in roads).most_common())
    if osm:
        sig = [f for f in features if f["kind"] == "traffic_signals"]
        tot_len = sum(r["len"] for r in roads)
        print(f"osm ({osm.get('timestamp')}): roads matched {rst['matched']}/{len(roads)}; "
              f"lanes {rst['lanes']} edges ({rst['lanes_len'] / max(tot_len, 1):.0%} of length, "
              f"{rst['lanes_changed']} changed, {rst['lanes_asym']} asymmetric, {rst['lanes_fit']} reduced to fit w); "
              f"osmSidewalk {rst['sidewalk']}; width from OSM {rst['width']}; widened for lanes {rst['widened']}; "
              f"oneway mismatches {rst['oneway_mismatch']}")
        print("lanes per direction:", sorted(Counter((r["lanes"], r["oneway"] != 0) for r in roads).items()))
        print(f"signals {len(sig)} (on a road node: {sum(1 for f in sig if 'node' in f)}), "
              f"features {dict(Counter(f['kind'] for f in features))}, new: {dict((k, v) for k, v in pst.items() if k.startswith('feat'))}")
        print(f"lamps {len(lamps)}, trees {len(trees)} (+{pst['trees_osm']} OSM, +{pst['trees_row']} from tree rows), "
              f"markets {len(markets)} {[m['name'] for m in markets]}, OSM shop pois +{pst['pois']}")
        print(f"buildings: OSM tags matched {bst['matched']}, set facade {bst['facade']}, roofColor {bst['roofColor']}, "
              f"material {bst['material']}, roofShape {bst['roofShape']}, height {bst['height']}")
    if args.preview:
        preview(data, args.preview)
        print("preview:", args.preview)


if __name__ == "__main__":
    main()
