#!/usr/bin/env python3
"""Build public/data/shops.json: real Harare CBD businesses, each placed on the facade of its building.

Usage:
    python3 tools/build_shops.py --overture OVERTURE_DIR_OR_place.parquet --osm osm.json \
        [--osm-pois osm_pois.json] [--fetch] [--map public/data/harare.json] \
        [--out public/data/shops.json] [--preview shops_preview.png] [--report shops_report.tsv]

Inputs
    --overture   Overture Maps `place` GeoParquet for the CBD bbox (tools/fetch_overture.py writes it).
    --osm        the raw Overpass dump of tools/fetch_osm.py (named OSM shop nodes are used).
    --osm-pois   a second Overpass dump with every named shop / amenity / office / tourism / healthcare /
                 craft / named-building object in the bbox (`out center tags`). With --fetch it is
                 downloaded from Overpass when the file does not exist yet (cached afterwards).
    --map        public/data/harare.json (building footprints, roads, paths) built by tools/build_map.py.

Pipeline (details in docs/references/BUSINESSES.md)
    1. Collect candidates from Overture places, OSM POIs, OSM-named building footprints in harare.json
       and the CURATED table below (web-verified locations of the ~150 most visible businesses).
    2. Clean: drop geocoder "stacks" (many unrelated places sharing one coordinate), places whose
       address names another suburb/town, low-confidence and junk names; normalise names / casing;
       recognise chains (BRANDS) and map categories to sign styles.
    3. Check each address against the road network (old and new street names, see STREET_ALIASES):
       'Cnr A & B' addresses are resolved to the A/B intersection; places far from the street(s)
       their address names are moved to the corner or dropped.
    4. Dedupe (same normalised name / brand within ~40 m; curated > OSM > Overture).
    5. Place every sign on a building facade: containing / nearest footprint, the outer edge closest
       to the point that faces a named street (outward normal toward the carriageway, clear line of
       sight, within ~25 m of the kerb), then spread the signs sharing one facade so they don't overlap.
       Tower-top names for the towers that really carry a name, small entrance boards for upstairs offices.

Output schema: see docs/references/BUSINESSES.md ("shops.json schema").

Coordinates: metres, x = east, z = south, origin = Africa Unity Square (same projection as build_map.py).

    pip install pyarrow shapely pillow requests
"""
import argparse
import hashlib
import json
import math
import os
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict

ORIGIN_LAT = -17.82932
ORIGIN_LON = 31.05202
M_PER_DEG_LAT = 110574.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(ORIGIN_LAT))
BBOX = (-17.840, 31.030, -17.815, 31.062)  # S, W, N, E (same as fetch_osm.py / fetch_overture.py)
USER_AGENT = "SpiderManHarareFanGame/0.2 (https://github.com/thisisisheanesu/spiderman-harare)"
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
# Region kept (local metres): the CBD grid, the Kopje-side old town and the near Avenues.
REGION = (-1400.0, 1060.0, -1480.0, 880.0)  # minX, maxX, minZ, maxZ
# The dense core where street-level shops matter most (First St / Jason Moyo / Samora Machel...).
CORE = (-1250.0, 700.0, -700.0, 760.0)


def proj(lon, lat):
    return (lon - ORIGIN_LON) * M_PER_DEG_LON, -(lat - ORIGIN_LAT) * M_PER_DEG_LAT


def unproj(x, z):
    return ORIGIN_LON + x / M_PER_DEG_LON, ORIGIN_LAT - z / M_PER_DEG_LAT


def r1(v):
    return round(v, 1)


def r3(v):
    return round(v, 3)


def in_box(x, z, box):
    return box[0] <= x <= box[1] and box[2] <= z <= box[3]


def seeded(s):
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


# ------------------------------------------------------------------------------------------ streets
# Canonical street groups. Keys are the canonical ids; values list the spellings found in
# harare.json (new names, Statutory Instrument 167 of 2020 + the June 2025 council renames) and the
# old / colloquial names used in addresses. Matching is done on normalised text (see norm_street).
STREETS = {
    "samora machel": ["samora machel", "jameson"],
    "nelson mandela": ["nelson mandela", "baker"],
    "kwame nkrumah": ["kwame nkrumah", "kwame nkrumah (union)", "kwame", "nkrumah", "nkurumah", "nkuruma", "nhrumah",
                      "khrumah", "nkurumaah", "union"],
    "george silundika": ["george silundika", "silundika", "gordon"],
    "jason moyo": ["jason moyo", "j moyo", "stanley"],
    "speke": ["agostinho neto", "speke", "speak"],
    "robert mugabe": ["robert mugabe", "r g mugabe", "rg mugabe", "r mugabe", "manica"],
    "robson manyika": ["robson manyika", "r manyika", "forbes"],
    "kenneth kaunda": ["kenneth kaunda", "keneth kaunda", "railway"],
    "julius nyerere": ["julius nyerere", "j nyerere", "kingsway"],
    "first": ["first", "1st", "first street mall"],
    "angwa": ["sir seretse khama", "seretse khama", "angwa"],
    "inez": ["mayor urimbo", "inez", "innez", "inez terrace"],
    "sam nujoma": ["sam nujoma", "sam mujoma", "sam munjoma", "second", "2nd"],
    "third": ["patrice lumumba", "third", "3rd"],
    "fourth": ["fourth", "4th", "s.v muzenda", "sv muzenda", "simon muzenda", "simon vengai muzenda", "s v muzenda"],
    "fifth": ["fifth", "5th"],
    "sixth": ["sixth", "6th"],
    "seventh": ["liberation legacy", "seventh", "7th"],
    "eighth": ["eighth", "8th"],
    "leopold takawira": ["leopold takawira", "l takawira", "takawira", "moffat"],
    "park": ["park"],
    "cameron": ["joseph msika", "cameron", "cameroon"],
    "chinhoyi": ["chinhoyi", "chinhoi", "chinnhoyi", "sinoia"],
    "mbuya nehanda": ["mbuya nehanda", "nehanda", "victoria"],
    "kaguvi": ["kaguvi", "pioneer"],
    "harare": ["harare"],
    "rezende": ["julia zvobgo", "rezende", "ruzende", "rusende"],
    "bank": ["bank"],
    "albion": ["albion"],
    "central": ["ahmed ben bella", "central"],
    "selous": ["selous", "john landa nkomo"],
    "park lane": ["jomo kenyatta", "park lane"],
    "herbert chitepo": ["herbert chitepo", "chitepo", "rhodes"],
    "fife": ["leonid brezhnev", "fife", "five avenue"],
    "baines": ["herbert ushewokunze", "baines"],
    "livingstone": ["oliver tambo", "livingstone"],
    "josiah chinamano": ["josiah chinamano", "chinamano", "montagu"],
    "josiah tongogara": ["josiah tongogara", "tongogara"],
    "rotten row": ["abdel gamal nasser", "rotten row"],
    "mazowe": ["mazowe", "mazoe"],
    "orr": ["kavalamanja battle", "orr"],
    "wayne": ["zidube ranch battle", "wayne"],
    "charter": ["fidel castro", "charter"],
    "ed mnangagwa": ["ed mnangagwa", "enterprise"],
    "prince edward": ["prince edward"],
    "leopold takawira ave": [],
    "luck": ["luck"],
    "bute": ["bute"],
    "abercorn": ["abercorn"],
    "raleigh": ["raleigh"],
    "market": ["market"],
    "guy clutton-brock": ["guy clutton-brock", "guy clutton brock", "south"],  # South Avenue
    "sir seretse": [],
    "blakiston": ["blakiston", "blackiston"],  # harare.json spells it "Blackiston Steet"
}
STREET_SUFFIX = r"(?:street|str|st|avenue|ave|av|road|rd|way|wy|drive|dr|terrace|terr|lane|ln|close|crescent|mall|extension|ext)\.?"
# Old / new names for the facade 'road' label: harare.json names are used verbatim.

# Streets whose unnamed harare.json segments we name by position (Overture/OSM leave them blank):
# (group, list of (x, z) points lying on the segment).
UNNAMED_HINTS = [
    ("Julia Zvobgo Street", [(-622.0, 140.0), (-630.0, 400.0), (-640.0, 600.0), (-655.0, 745.0)]),  # Rezende St
    ("Joseph Msika Street", [(-925.0, -110.0), (-910.0, -50.0), (-878.0, -200.0)]),  # Cameron St (north part)
]

# Suburbs / towns: an address naming one of these is not in the CBD (the point is a geocoder guess).
ELSEWHERE = re.compile(
    r"\b(avondale|belvedere|borrowdale|eastlea|msasa|southerton|workington|graniteside|mbare|highfield|glen ?norah|"
    r"budiriro|chitungwiza|mt\.? ?pleasant|mount pleasant|pomona|greendale|waterfalls|milton park|marlborough|"
    r"mabelreign|hatfield|kuwadzana|warren park|ruwa|norton|bulawayo|gweru|mutare|masvingo|kwekwe|bindura|"
    r"marondera|kadoma|victoria falls|kariba|arcadia|alexandra park|newlands|highlands|greystone|mandara|"
    r"umwinsidale|vainona|emerald hill|westgate|sam levy|avonlea|bluff ?hill|kensington|strathaven|tynwald|"
    r"willowvale|ardbennie|sunningdale|epworth|mufakose|dzivarasekwa|tafara|mabvuku|glen ?view|kambuzuma|rugare|"
    r"hillside|braeside|cranborne|queensdale|houghton park|parktown|prospect|lochinvar|ridgeview|hopley|"
    r"gletwyn|chisipite|ballantyne|helensvale|colne valley|glen lorne|philadelphia|mount hampden|mt hampden|"
    r"marimba|kopje plaza|harare south|belgravia|zengeza|seke|dema|goromonzi|beitbridge|chegutu|chipinge|"
    r"gokwe|hwange|kwe kwe|zvishavane|shurugwi|rusape|karoi|murehwa|mutoko|harare drive|lomagundi|"
    r"airport|msasa park|donnybrook|mabvuku|st martins|arcturus|damofalls|cold comfort|mainway meadows|nyanga|"
    r"chiredzi|triangle|gwanda|plumtree|chimanimani|mvurwi|shamva|murewa|nkayi|lupane|bindura|"
    r"gun ?hill|rolfe valley|good ?hope|zindoga|glen ?forest|cran(?:e)?borne|spitzkop|glenwood park|"
    r"wilmington park|chipukutu|zimre park|belvere|township|gaborone|francistown|lusaka|johannesburg|"
    r"st\.? jos[e]?ph)\b",
    re.I,
)
# (Chinhoyi / Seke / Harare are also streets here; the regex above deliberately lists only the
# unambiguous ones. 'Chinhoyi' as a town is caught by TOWN_CHINHOYI.)
TOWN_CHINHOYI = re.compile(r"chinhoyi(?!\s*(?:st|street|str|&|and|,?\s*cnr))", re.I)


def norm_text(s):
    s = unicodedata.normalize("NFKC", s or "")
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return s


def norm_street(s):
    s = norm_text(s).lower()
    s = re.sub(r"\(.*?\)", " ", s) if "union" not in s else s
    s = re.sub(r"[^a-z0-9.&/' -]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


ALIAS_RE = []
for gid, names in STREETS.items():
    for n in names:
        ALIAS_RE.append((gid, n))
ALIAS_RE.sort(key=lambda a: -len(a[1]))


def group_of_roadname(name):
    """harare.json road name -> street group id (or the normalised name)."""
    s = norm_street(name)
    s2 = re.sub(r"\b" + STREET_SUFFIX + r"\b", " ", s)
    s2 = re.sub(r"\s+", " ", s2).strip()
    for gid, n in ALIAS_RE:
        if s2 == n or s2.startswith(n + " ") or s == n:
            return gid
    return s2


# Words that must follow a bare ordinal / generic token for it to count as a street in an address.
NEEDS_SUFFIX = {"first", "1st", "second", "2nd", "third", "3rd", "fourth", "4th", "fifth", "5th", "sixth", "6th",
                "seventh", "7th", "eighth", "8th", "park", "harare", "bank", "market", "union", "central", "victoria",
                "baker", "stanley", "gordon", "railway", "charter", "enterprise", "luck", "bute", "forbes", "rhodes",
                "montagu", "pioneer", "kingsway", "moffat", "manica", "jameson", "speak", "orr", "wayne", "albion",
                "raleigh", "abercorn", "livingstone", "five avenue", "kwame", "chinhoyi", "chinhoi", "south"}


def streets_in_address(addr):
    """Returns (ordered list of street group ids mentioned, corner flag, house number or None)."""
    if not addr:
        return [], False, None
    a = norm_street(addr)
    a = a.replace("&", " & ")
    found = []
    spans = []
    for gid, n in ALIAS_RE:
        if not n:
            continue
        for m in re.finditer(r"(?<![a-z])" + re.escape(n) + r"(?![a-z])", a):
            if any(m.start() < e and m.end() > s for s, e in spans):
                continue
            rest = a[m.end():m.end() + 14]
            if n in NEEDS_SUFFIX:
                if not re.match(r"\s*\.?\s*" + STREET_SUFFIX, rest) and not re.match(r"\s*(&|and|/|,\s*cnr)", rest) \
                        and not re.search(r"(cnr|corner|crn|&|and)\s*$", a[max(0, m.start() - 8):m.start()]):
                    continue
            spans.append((m.start(), m.end()))
            found.append((m.start(), gid))
    found.sort()
    # 'Cnr A & B' names the corner after the keyword: put those streets first
    kw = re.search(r"\b(cnr|corner|crn|coner)\b", a)
    if kw:
        found = [f for f in found if f[0] >= kw.start()] + [f for f in found if f[0] < kw.start()]
    out = []
    for _, g in found:
        if g not in out:
            out.append(g)
    corner = bool(re.search(r"\b(cnr|corner|crn|coner|cor)\b|&|\band\b|/", a)) and len(out) >= 2
    num = None
    m = re.match(r"^\s*(?:no\.?\s*)?(\d{1,4})[a-z]?\s*,?\s+[a-z]", a) or \
        re.search(r"\b(?:street|str|st|avenue|ave|road|rd|way)\.?\s+(\d{1,4})\b", a)
    if m:
        num = int(m.group(1))
    return out, corner, num


# ------------------------------------------------------------------------------------------ geometry
def seg_dist(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    t = 0.0 if l2 < 1e-9 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2))
    qx, qz = ax + dx * t, az + dz * t
    return math.hypot(px - qx, pz - qz), qx, qz, t


def seg_intersect(a, b, c, d):
    """Intersection of segments ab and cd (points as tuples) or None."""
    (x1, y1), (x2, y2), (x3, y3), (x4, y4) = a, b, c, d
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(den) < 1e-9:
        return None
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
    u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den
    if -1e-9 <= t <= 1 + 1e-9 and -1e-9 <= u <= 1 + 1e-9:
        return x1 + t * (x2 - x1), y1 + t * (y2 - y1), t, u
    return None


def point_in_ring(x, z, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, zi = ring[i]
        xj, zj = ring[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def ring_area_xn(pts):
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % n]
        a += x1 * (-z2) - x2 * (-z1)
    return a / 2.0


class Grid:
    """Uniform grid over items with bounding boxes."""

    def __init__(self, cell):
        self.cell = cell
        self.cells = defaultdict(list)

    def add(self, item, minx, maxx, minz, maxz):
        c = self.cell
        for gx in range(int(math.floor(minx / c)), int(math.floor(maxx / c)) + 1):
            for gz in range(int(math.floor(minz / c)), int(math.floor(maxz / c)) + 1):
                self.cells[(gx, gz)].append(item)

    def near(self, x, z, r):
        c = self.cell
        seen = set()
        out = []
        for gx in range(int(math.floor((x - r) / c)), int(math.floor((x + r) / c)) + 1):
            for gz in range(int(math.floor((z - r) / c)), int(math.floor((z + r) / c)) + 1):
                for it in self.cells.get((gx, gz), ()):
                    if id(it) not in seen:
                        seen.add(id(it))
                        out.append(it)
        return out


class City:
    """Buildings, streets and lookups built from harare.json."""

    def __init__(self, data):
        self.data = data
        self.buildings = []
        self.bgrid = Grid(40.0)
        for i, b in enumerate(data["buildings"]):
            fp = b["fp"]
            ring = [(fp[k], fp[k + 1]) for k in range(0, len(fp), 2)]
            if len(ring) < 3:
                continue
            # harare.json promises CCW (x, north) rings; enforce so outward normals are right.
            if ring_area_xn(ring) < 0:
                ring = ring[::-1]
            xs = [p[0] for p in ring]
            zs = [p[1] for p in ring]
            rec = {"i": i, "b": b, "ring": ring, "minx": min(xs), "maxx": max(xs), "minz": min(zs), "maxz": max(zs),
                   "area": abs(ring_area_xn(ring)), "cx": sum(xs) / len(xs), "cz": sum(zs) / len(zs)}
            self.buildings.append(rec)
            self.bgrid.add(rec, rec["minx"], rec["maxx"], rec["minz"], rec["maxz"])
        self.by_index = {r["i"]: r for r in self.buildings}
        # Streets: carriageways (not service lanes / links) + pedestrian malls, with names.
        self.segs = []
        self.sgrid = Grid(40.0)
        roads = data["roads"]
        names = self._fill_names(roads)
        for ri, r in enumerate(roads):
            name = names[ri]
            service = r["cls"] == "service" or bool(r.get("link"))
            sw = 0.0 if service else (3.5 if r["cls"] in ("trunk", "primary", "secondary", "tertiary") else 2.4)
            self._add_line(r["pts"], {"name": name, "group": group_of_roadname(name) if name else None, "w": r["w"],
                                      "sidewalk": sw, "service": service, "mall": False, "cls": r["cls"], "ri": ri})
        for p in data.get("paths", []):
            if p["cls"] == "pedestrian":
                name = p.get("name")
                self._add_line(p["pts"], {"name": name, "group": group_of_roadname(name) if name else None, "w": p["w"],
                                          "sidewalk": 0.0, "service": False, "mall": True, "cls": "pedestrian", "ri": -1})
        # names of streets / parks / squares (a POI carrying one of these names is not a shop)
        self.place_names = set()
        for r in list(roads) + list(data.get("paths", [])) + list(data.get("areas", [])):
            if r.get("name"):
                self.place_names.add(name_key(r["name"]))
                self.place_names.add(name_key(re.sub(r"\s*\(.*?\)", "", r["name"])))
        self.place_names |= {name_key(n) for n in ("Africa Unity Square", "Harare Gardens", "First Street Mall", "Harare CBD",
                                                   "Harare", "Zimbabwe", "Harare Central", "Market Square", "Copacabana")}
        self.group_segs = defaultdict(list)
        for s in self.segs:
            if s["ref"]["group"] and not s["ref"]["service"]:
                self.group_segs[s["ref"]["group"]].append(s)

    def _fill_names(self, roads):
        names = [r.get("name") for r in roads]
        # 1. position hints for known unnamed streets
        for nm, pts in UNNAMED_HINTS:
            for (hx, hz) in pts:
                best, bd = None, 12.0
                for ri, r in enumerate(roads):
                    if names[ri] or r["cls"] == "service":
                        continue
                    p = r["pts"]
                    for k in range(0, len(p) - 2, 2):
                        d = seg_dist(hx, hz, p[k], p[k + 1], p[k + 2], p[k + 3])[0]
                        if d < bd:
                            best, bd = ri, d
                if best is not None:
                    names[best] = nm
        # 2. propagate names along straight continuations (unnamed non-service segments)
        by_node = defaultdict(list)
        for ri, r in enumerate(roads):
            by_node[r["a"]].append(ri)
            by_node[r["b"]].append(ri)

        def end_dir(r, node):
            p = r["pts"]
            if node == r["a"]:
                dx, dz = p[2] - p[0], p[3] - p[1]
            else:
                dx, dz = p[-4] - p[-2], p[-3] - p[-1]
            l = math.hypot(dx, dz) or 1
            return dx / l, dz / l

        changed = True
        while changed:
            changed = False
            for ri, r in enumerate(roads):
                if names[ri] or r["cls"] == "service" or r.get("link"):
                    continue
                for node in (r["a"], r["b"]):
                    d0 = end_dir(r, node)
                    for rj in by_node[node]:
                        if rj == ri or not names[rj] or roads[rj]["cls"] == "service":
                            continue
                        d1 = end_dir(roads[rj], node)
                        if d0[0] * d1[0] + d0[1] * d1[1] < -0.94:  # straight on (<~20 deg)
                            names[ri] = names[rj]
                            changed = True
                            break
                    if names[ri]:
                        break
        self.road_names = names
        return names

    def _add_line(self, pts, ref):
        for k in range(0, len(pts) - 2, 2):
            ax, az, bx, bz = pts[k], pts[k + 1], pts[k + 2], pts[k + 3]
            if abs(ax - bx) + abs(az - bz) < 0.05:
                continue
            s = {"ax": ax, "az": az, "bx": bx, "bz": bz, "ref": ref}
            self.segs.append(s)
            self.sgrid.add(s, min(ax, bx), max(ax, bx), min(az, bz), max(az, bz))

    # --- lookups
    def street_dist(self, group, x, z):
        best = (1e9, None, None)
        for s in self.group_segs.get(group, ()):
            d, qx, qz, _ = seg_dist(x, z, s["ax"], s["az"], s["bx"], s["bz"])
            if d < best[0]:
                best = (d, qx, qz)
        return best

    def corner(self, ga, gb, near=None):
        """Intersection point(s) of two street groups; the one nearest `near` (or the first)."""
        pts = []
        A = self.group_segs.get(ga, ())
        B = self.group_segs.get(gb, ())
        if not A or not B:
            return None
        for s in A:
            for t in B:
                if max(s["ax"], s["bx"]) + 12 < min(t["ax"], t["bx"]) or max(t["ax"], t["bx"]) + 12 < min(s["ax"], s["bx"]):
                    continue
                if max(s["az"], s["bz"]) + 12 < min(t["az"], t["bz"]) or max(t["az"], t["bz"]) + 12 < min(s["az"], s["bz"]):
                    continue
                hit = seg_intersect((s["ax"], s["az"]), (s["bx"], s["bz"]), (t["ax"], t["az"]), (t["bx"], t["bz"]))
                if hit:
                    pts.append((hit[0], hit[1]))
                else:
                    # near miss (dual carriageways / T-junction gaps): end point within 12 m of the other segment
                    for (px, pz) in ((s["ax"], s["az"]), (s["bx"], s["bz"])):
                        d, qx, qz, _ = seg_dist(px, pz, t["ax"], t["az"], t["bx"], t["bz"])
                        if d < 12:
                            pts.append(((px + qx) / 2, (pz + qz) / 2))
        if not pts:
            return None
        # merge the crossings of dual carriageways into one junction centre per cluster
        clusters = []
        for p in pts:
            for c in clusters:
                if math.hypot(c[0] / c[2] - p[0], c[1] / c[2] - p[1]) < 45:
                    c[0] += p[0]
                    c[1] += p[1]
                    c[2] += 1
                    break
            else:
                clusters.append([p[0], p[1], 1])
        cs = [(c[0] / c[2], c[1] / c[2]) for c in clusters]
        if near:
            cs.sort(key=lambda c: math.hypot(c[0] - near[0], c[1] - near[1]))
        return cs[0] if len(cs) == 1 or near else cs[0], cs

    def building_at(self, x, z):
        for r in self.bgrid.near(x, z, 0.5):
            if r["minx"] <= x <= r["maxx"] and r["minz"] <= z <= r["maxz"] and point_in_ring(x, z, r["ring"]):
                return r
        return None

    def ring_dist(self, r, x, z):
        ring = r["ring"]
        best = 1e9
        n = len(ring)
        for k in range(n):
            ax, az = ring[k]
            bx, bz = ring[(k + 1) % n]
            best = min(best, seg_dist(x, z, ax, az, bx, bz)[0])
        return 0.0 if point_in_ring(x, z, ring) else best

    def buildings_near(self, x, z, rad):
        out = []
        for r in self.bgrid.near(x, z, rad):
            d = self.ring_dist(r, x, z)
            if d <= rad:
                out.append((d, r))
        out.sort(key=lambda t: t[0])
        return out

    def blocked(self, x0, z0, x1, z1, skip, min_h=2.5):
        """True if the segment crosses a building footprint (other than `skip`) at least min_h tall,
        or starts inside any real building (overlapping footprints: that wall is not a facade)."""
        for r in self.bgrid.near((x0 + x1) / 2, (z0 + z1) / 2, math.hypot(x1 - x0, z1 - z0) / 2 + 1):
            if r is skip:
                continue
            if max(x0, x1) < r["minx"] or min(x0, x1) > r["maxx"] or max(z0, z1) < r["minz"] or min(z0, z1) > r["maxz"]:
                continue
            if r["area"] < 12 or r["b"]["h"] < 2.5:
                continue  # kiosks / sheds do not hide a shopfront
            if point_in_ring(x0, z0, r["ring"]):
                return True
            if r["b"]["h"] < min_h:
                continue
            ring = r["ring"]
            n = len(ring)
            for k in range(n):
                if seg_intersect((x0, z0), (x1, z1), ring[k], ring[(k + 1) % n]):
                    return True
            if point_in_ring(x1, z1, ring):
                return True
        return False

    def street_ahead(self, x, z, nx, nz, max_d=80.0):
        """Name of the first carriageway / mall met walking from (x, z) along (nx, nz), or None."""
        for t in range(1, int(max_d), 1):
            qx, qz = x + nx * t, z + nz * t
            for sg in self.sgrid.near(qx, qz, 10):
                ref = sg["ref"]
                if ref["service"]:
                    continue
                if seg_dist(qx, qz, sg["ax"], sg["az"], sg["bx"], sg["bz"])[0] < ref["w"] / 2 + 0.3:
                    return ref["name"] or ("First Street Mall" if ref["mall"] else None), t
        return None, None

    def street_facing(self, bld, ax, az, bx, bz, nx, nz, length, relaxed=False):
        """Street (ref dict + distances) an outer edge faces, or None. Mirrors src/world/buildings.js
        streetFacing(): nearest carriageway / mall within 45 m of the edge midpoint, parallel to the
        edge, in front of it, with plausible pavement between; plus a line-of-sight check.
        relaxed: for set-back buildings (hotels, towers behind forecourts / podiums): up to 60 m of
        forecourt and only buildings taller than 8 m block the view."""
        mx, mz = (ax + bx) / 2, (az + bz) / 2
        px, pz = mx + nx * 1.5, mz + nz * 1.5
        ex, ez = (bx - ax) / length, (bz - az) / length
        best = None
        R = {0: 45, 1: 70, 2: 95}[int(relaxed)]
        for s in self.sgrid.near(px, pz, R):
            if s["ref"]["service"]:
                continue  # service lanes / slip roads: backs of buildings, not shopfronts
            d, qx, qz, _ = seg_dist(px, pz, s["ax"], s["az"], s["bx"], s["bz"])
            if d > R:
                continue
            sl = math.hypot(s["bx"] - s["ax"], s["bz"] - s["az"])
            sdx, sdz = (s["bx"] - s["ax"]) / sl, (s["bz"] - s["az"]) / sl
            if abs(ex * sdx + ez * sdz) < 0.8:
                continue
            ahead = (qx - mx) * nx + (qz - mz) * nz
            if ahead < 0:
                continue
            ref = s["ref"]
            avail = ahead - ref["w"] / 2
            if avail < (-1.0 if ref["mall"] else 0.3):
                continue
            if avail > ({1: 60, 2: 90}[int(relaxed)] if relaxed else ref["sidewalk"] + 14 + (6 if ref["mall"] else 0)):
                continue
            if best is None or d < best[0]:
                best = (d, s, qx, qz, ahead, avail)
        if not best:
            return None
        d, s, qx, qz, ahead, avail = best
        # line of sight from the facade to the kerb, sampled at 3 points along the edge
        ok = 0
        for t in (0.2, 0.5, 0.8):
            fx, fz = ax + (bx - ax) * t + nx * 0.3, az + (bz - az) * t + nz * 0.3
            tx, tz = fx + nx * max(0.5, avail), fz + nz * max(0.5, avail)
            if relaxed == 2 or not self.blocked(fx, fz, tx, tz, bld, 6.0 if relaxed else 2.5):
                ok += 1
        if ok < 2:
            return None
        return {"ref": s["ref"], "avail": avail, "ahead": ahead}

    def facades(self, rec, relaxed=False):
        """Street-facing outer edges of a building (cached). relaxed: see street_facing()."""
        key = ("_fac", "_facr", "_fact")[int(relaxed)]
        if key in rec:
            return rec[key]
        ring = rec["ring"]
        n = len(ring)
        out = []
        for k in range(n):
            ax, az = ring[k]
            bx, bz = ring[(k + 1) % n]
            L = math.hypot(bx - ax, bz - az)
            if L < 2.5:
                continue
            # CCW in (x, north): outward normal of edge (dx, dn) is (dn, -dx) in (x, north) -> (x, z) = (-dz, -dx)?
            ex, ez = (bx - ax) / L, (bz - az) / L
            nx, nz = -ez, ex  # verified below against the centroid
            mx, mz = (ax + bx) / 2, (az + bz) / 2
            if point_in_ring(mx + nx * 0.4, mz + nz * 0.4, ring):
                nx, nz = -nx, -nz
            st = self.street_facing(rec, ax, az, bx, bz, nx, nz, L, relaxed)
            if st:
                out.append({"k": k, "ax": ax, "az": az, "bx": bx, "bz": bz, "ex": ex, "ez": ez, "nx": nx, "nz": nz,
                            "len": L, "street": st, "setback": relaxed})
        rec[key] = out
        return out

    def any_facades(self, rec, allow_setback=False, tower=False):
        f = self.facades(rec)
        if not f and allow_setback:
            f = self.facades(rec, relaxed=1)
        if not f and tower:
            f = self.facades(rec, relaxed=2)
        return f


# ------------------------------------------------------------------------------------------ helpers
def load_overture(path):
    import pyarrow.parquet as pq
    from shapely import wkb
    if os.path.isdir(path):
        path = os.path.join(path, "place.parquet")
    rows = pq.read_table(path).to_pylist()
    out = []
    for r in rows:
        g = wkb.loads(r["geometry"])
        x, z = proj(g.x, g.y)
        names = r.get("names") or {}
        brand = ((r.get("brand") or {}).get("names") or {}).get("primary")
        addrs = r.get("addresses") or []
        addr = addrs[0].get("freeform") if addrs else None
        if addr:
            addr = re.sub(r"\s*(?:\\[nrt]|[\n\r\t])+\s*", ", ", addr)
            addr = re.sub(r"\s{2,}", " ", addr).strip(" ,;") or None
        srcs = sorted(set(s["dataset"] for s in (r.get("sources") or [])))
        tax = (r.get("taxonomy") or {})
        out.append({
            "src": "overture", "sid": r["id"], "name": names.get("primary"), "brand_raw": brand,
            "basic": r.get("basic_category") or "", "tax": tax.get("primary") or "",
            "hier": tax.get("hierarchy") or [], "conf": r.get("confidence") or 0.0, "x": x, "z": z,
            "addr": addr, "web": (r.get("websites") or [None])[0], "datasets": srcs,
        })
    return out


def load_osm_pois(paths):
    """Named OSM objects (nodes/ways/relations) from one or more Overpass dumps."""
    out = []
    seen = set()
    for path in paths:
        if not path or not os.path.exists(path):
            continue
        with open(path) as f:
            d = json.load(f)
        for e in d.get("elements", []):
            t = e.get("tags") or {}
            key = (e["type"], e["id"])
            if key in seen:
                continue
            name = t.get("name") or t.get("brand")
            if not name:
                continue
            kind = next((k for k in ("shop", "amenity", "office", "tourism", "healthcare", "craft", "leisure") if k in t), None)
            if not kind:
                continue
            c = e.get("center") or (e if "lat" in e else None)
            if not c and e.get("geometry"):
                g = e["geometry"]
                c = {"lat": sum(p["lat"] for p in g) / len(g), "lon": sum(p["lon"] for p in g) / len(g)}
            if not c:
                continue
            seen.add(key)
            x, z = proj(c["lon"], c["lat"])
            addr = " ".join(v for v in (t.get("addr:housenumber"), t.get("addr:street")) if v) or None
            out.append({"src": "osm", "sid": f"{e['type']}/{e['id']}", "name": name, "brand_raw": t.get("brand"),
                        "osm": {k: t[k] for k in ("shop", "amenity", "office", "tourism", "healthcare", "craft", "leisure", "cuisine", "building") if k in t},
                        "conf": 0.9, "x": x, "z": z, "addr": addr, "web": t.get("website") or t.get("contact:website"),
                        "way": e["type"] != "node"})
    return out


def fetch_osm_pois(path):
    import requests
    s, w, n, e = BBOX
    bb = f"{s},{w},{n},{e}"
    q = f"""[out:json][timeout:120][bbox:{bb}];
(
  nwr["shop"];
  nwr["amenity"~"^(bank|bureau_de_change|money_transfer|payment_centre|fast_food|restaurant|cafe|bar|pub|food_court|ice_cream|pharmacy|clinic|doctors|dentist|hospital|fuel|place_of_worship|school|college|university|library|post_office|cinema|theatre|nightclub|courthouse|townhall|police|internet_cafe|car_rental|driving_school|arts_centre|community_centre|social_facility|events_venue|conference_centre|casino|gambling|atm|veterinary|kindergarten|prep_school|training)$"];
  nwr["office"];
  nwr["tourism"~"^(hotel|guest_house|hostel|museum|gallery|motel|apartment|information)$"];
  nwr["healthcare"];
  nwr["craft"];
  nwr["leisure"~"^(fitness_centre|sports_centre|dance)$"];
  nwr["building"]["name"];
  nwr["brand"];
);
out center tags qt;
"""
    for ep in OVERPASS:
        for attempt in range(2):
            try:
                r = requests.post(ep, data={"data": q}, headers={"User-Agent": USER_AGENT}, timeout=200)
            except Exception as ex:  # noqa: BLE001
                print(f"  overpass {ep}: {ex}", file=sys.stderr)
                break
            if r.status_code == 200:
                with open(path, "wb") as f:
                    f.write(r.content)
                print(f"  fetched OSM POIs from {ep} ({len(r.content)} bytes) -> {path}")
                return True
            print(f"  overpass {ep}: HTTP {r.status_code}", file=sys.stderr)
            if r.status_code in (429, 504):
                time.sleep(20 * (attempt + 1))
            else:
                break
    return False


# ------------------------------------------------------------------------------------------ categories
# Output categories (shops[].cat). Street-level signs for all but 'office' / 'government' / 'embassy'
# (entrance boards) and 'church' / 'school' (name boards).
CATS = [
    "supermarket", "grocery", "wholesale", "fast_food", "restaurant", "cafe", "bakery", "bar", "butcher", "liquor",
    "bank", "money", "finance", "insurance", "pharmacy", "clinic", "optician", "hotel", "office", "church", "school",
    "government", "fuel", "salon", "electronics", "phone", "telecom", "clothing", "shoes", "department", "furniture",
    "hardware", "auto_parts", "car_dealer", "mall", "stationery", "printing", "books", "jewellery", "cinema", "travel",
    "courier", "gym", "funeral", "laundry", "retail", "market",
]
BOARD_CATS = {"office", "government", "insurance", "school"}

OVERTURE_CAT = {
    "fashion_and_apparel_store": "clothing", "electronics_store": "electronics", "professional_service": "office",
    "corporate_or_business_office": "office", "home_service": "office", "shopping": "retail",
    "hardware_home_and_garden_store": "hardware", "automotive_service": "auto_parts", "financial_service": "finance",
    "building_or_construction_service": "office", "wellness_service": "clinic", "technical_service": "electronics",
    "printing_service": "printing", "restaurant": "restaurant", "health_care": "clinic", "real_estate_service": "office",
    "auto_dealer": "car_dealer", "personal_or_beauty_service": "salon", "media_service": "office",
    "event_or_party_service": "office", "christian_place_of_worship": "church", "religious_organization": "church",
    "design_service": "office", "travel_service": "travel", "vehicle_parts_store": "auto_parts",
    "social_or_community_service": "office", "food_and_beverage_store": "grocery", "government_office": "government",
    "place_of_learning": "school", "education": "school", "manufacturer": "retail", "pharmacy_and_drug_store": "pharmacy",
    "specialty_school": "school", "college_university": "school", "b2b_energy_and_utility_service": "office",
    "b2b_office_and_professional_service": "office", "supplier_or_distributor": "wholesale", "educational_service": "school",
    "b2b_transportation_and_storage_service": "office", "shopping_mall": "mall", "personal_care_and_beauty_store": "salon",
    "b2b_service": "office", "attorney_or_law_firm": "office", "hotel": "hotel", "diagnostics_imaging_or_lab_service": "clinic",
    "books_music_and_video_store": "books", "flowers_and_gifts_store": "retail", "b2b_industrial_and_machine_service": "office",
    "bank_or_credit_union": "bank", "civic_organization": "office", "dental_clinic": "clinic", "agricultural_service": "retail",
    "casual_eatery": "fast_food", "lodging": "hotel", "sporting_goods_store": "retail", "hospital": "clinic",
    "fast_food_restaurant": "fast_food", "warehouse_club_store": "wholesale", "arts_and_entertainment": "office", "bar": "bar",
    "family_service": "funeral", "specialty_store": "retail", "gym": "gym", "rental_service": "travel", "library": "government",
    "travel_and_transportation": "travel", "high_school": "school", "legal_service": "office", "cafe": "cafe",
    "dance_club": "bar", "reproductive_perinatal_and_womens_care": "clinic", "convenience_store": "grocery",
    "shipping_or_delivery_service": "courier", "embassy": "government", "specialized_health_care": "clinic",
    "office_supply_store": "stationery", "arts_crafts_and_hobby_store": "retail", "outpatient_care_facility": "clinic",
    "animal_or_pet_service": "clinic", "laundry_service": "laundry", "sport_or_fitness_facility": "gym",
    "food_and_drink": "fast_food", "music_venue": "bar", "tutoring_service": "school", "medical_service": "clinic",
    "vehicle_dealer": "car_dealer", "department_store": "department", "courthouse": "government", "movie_theater": "cinema",
    "physical_medicine_and_rehabilitation": "clinic", "electric_utility_provider": "office",
    "behavioral_or_mental_health_clinic": "clinic", "second_hand_store": "retail", "wholesaler": "wholesale",
    "art_gallery": "retail", "vision_or_eye_care_clinic": "optician", "preschool": "school", "lounge": "bar",
    "community_and_government": "government", "government_department": "government", "community_center": "office",
    "specialized_medical_facility": "clinic", "primary_care_or_general_clinic": "clinic", "farmers_market": "market",
    "public_transit_facility_or_service": None, "park": None, "lake": None, "farm": None, "historic_site": None,
    "sport_league": None, "research_institute": "office", "museum": None, "performing_arts_venue": None,
    "sports_and_recreation": "gym", "sport_or_recreation_club": "gym", "environmental_or_ecological_service": "office",
    "private_lodging": "hotel", "parking": None, "amusement_park": None, "event_venue": None, "grocery_store": "grocery",
    "jewelry_store": "jewellery", "optician_store": "optician", "mobile_phone_store": "phone", "book_store": "books",
    "bakery": "bakery", "butcher_shop": "butcher", "liquor_store": "liquor", "furniture_store": "furniture",
    "shoe_store": "shoes", "clothing_store": "clothing", "discount_store": "retail", "betting_shop": "retail",
    "gas_station": "fuel", "beauty_salon": "salon", "hair_salon": "salon", "barber": "salon",
}
OSM_CAT = {
    ("shop", "supermarket"): "supermarket", ("shop", "convenience"): "grocery", ("shop", "clothes"): "clothing",
    ("shop", "shoes"): "shoes", ("shop", "boutique"): "clothing", ("shop", "department_store"): "department",
    ("shop", "mall"): "mall", ("shop", "mobile_phone"): "phone", ("shop", "computer"): "electronics",
    ("shop", "electronics"): "electronics", ("shop", "electrical"): "electronics", ("shop", "hardware"): "hardware",
    ("shop", "furniture"): "furniture", ("shop", "hairdresser"): "salon", ("shop", "beauty"): "salon",
    ("shop", "car_repair"): "auto_parts", ("shop", "car_parts"): "auto_parts", ("shop", "tyres"): "auto_parts",
    ("shop", "car"): "car_dealer", ("shop", "copyshop"): "printing", ("shop", "optician"): "optician",
    ("shop", "books"): "books", ("shop", "stationery"): "stationery", ("shop", "jewelry"): "jewellery",
    ("shop", "bakery"): "bakery", ("shop", "butcher"): "butcher", ("shop", "alcohol"): "liquor",
    ("shop", "variety_store"): "retail", ("shop", "wholesale"): "wholesale", ("shop", "funeral_directors"): "funeral",
    ("shop", "florist"): "retail", ("shop", "gift"): "retail", ("shop", "photo"): "retail", ("shop", "tattoo"): "salon",
    ("shop", "kitchen"): "furniture", ("shop", "baby_goods"): "clothing", ("shop", "sports"): "retail",
    ("shop", "bookmaker"): "retail", ("shop", "catalogue"): "retail", ("shop", "yes"): "retail",
    ("amenity", "bank"): "bank", ("amenity", "bureau_de_change"): "money", ("amenity", "money_transfer"): "money",
    ("amenity", "fast_food"): "fast_food", ("amenity", "restaurant"): "restaurant", ("amenity", "cafe"): "cafe",
    ("amenity", "bar"): "bar", ("amenity", "pub"): "bar", ("amenity", "nightclub"): "bar",
    ("amenity", "pharmacy"): "pharmacy", ("amenity", "clinic"): "clinic", ("amenity", "doctors"): "clinic",
    ("amenity", "dentist"): "clinic", ("amenity", "hospital"): "clinic", ("amenity", "fuel"): "fuel",
    ("amenity", "place_of_worship"): "church", ("amenity", "school"): "school", ("amenity", "college"): "school",
    ("amenity", "university"): "school", ("amenity", "library"): "government", ("amenity", "post_office"): "courier",
    ("amenity", "cinema"): "cinema", ("amenity", "courthouse"): "government", ("amenity", "townhall"): "government",
    ("amenity", "police"): "government", ("amenity", "car_rental"): "travel", ("amenity", "internet_cafe"): "electronics",
    ("tourism", "hotel"): "hotel", ("tourism", "guest_house"): "hotel", ("tourism", "hostel"): "hotel",
    ("tourism", "motel"): "hotel", ("tourism", "apartment"): None, ("tourism", "museum"): None,
    ("tourism", "information"): "government", ("leisure", "fitness_centre"): "gym", ("leisure", "sports_centre"): None,
    ("office", "government"): "government", ("office", "diplomatic"): "government", ("office", "insurance"): "insurance",
    ("healthcare", "laboratory"): "clinic", ("craft", "tailor"): "clothing", ("craft", "cleaning"): "office",
    ("craft", "photographer"): "retail", ("shop", "funeral_directors"): "funeral",
}

# Name keywords that override / refine the category (checked in order).
NAME_CAT = [
    (r"\b(supermarket|hypermarket|superstore)\b", "supermarket"),
    (r"\b(cash\s*(&|and|n)\s*carry|wholesalers?)\b", "wholesale"),
    (r"\b(pharmacy|pharmacies|chemist|dispensary)\b", "pharmacy"),
    (r"\b(opticians?|optometrists?|eye (clinic|care|centre))\b", "optician"),
    (r"\b(bureau de change|money transfer|remit|mukuru|western union|moneygram|mama money|world ?remit)\b", "money"),
    (r"\b(micro ?finance|microfinance|loans?|cash ?loans|credit)\b", "finance"),
    (r"\b(assurance|insurance|medical aid|funeral assurance)\b", "insurance"),
    (r"\b(funeral|undertakers?|parlour)\b", "funeral"),
    (r"\b(butcher(y|ies)?|meats?)\b", "butcher"),
    (r"\b(bakery|bakers|confectioner)\b", "bakery"),
    (r"\b(bottle store|liquor|wine|bar\b|pub\b)", "liquor"),
    (r"\b(salon|hair|barber|beauty|nails?|braids|wigs|cosmetics|spa)\b", "salon"),
    (r"\b(boutique|fashions?|clothing|apparel|wear|outfitters|tailors?|uniforms?)\b", "clothing"),
    (r"\b(shoes?|footwear|sneakers)\b", "shoes"),
    (r"\b(cell ?phones?|mobiles?|iphones?|smartphones?|phones?|gadgets?|airtime)\b", "phone"),
    (r"\b(electronics?|electricals?|appliances?|computers?|laptops?|solar|tv)\b", "electronics"),
    (r"\b(furniture|furnishers|furnishings|beds|home ?&? ?office)\b", "furniture"),
    (r"\b(hardware|building materials|paints?|plumbing|tiles?|ceramics)\b", "hardware"),
    (r"\b(spares|auto ?parts|motor spares|tyres?|auto)\b", "auto_parts"),
    (r"\b(stationery|stationers)\b", "stationery"),
    (r"\b(print(ing|ers|shop)?|copy ?shop|photocopy)\b", "printing"),
    (r"\b(jewell?ery|jewell?ers)\b", "jewellery"),
    (r"\b(travel|tours?|safaris?|car hire|rent a car)\b", "travel"),
    (r"\b(clinic|surgery|medical (centre|center)|dental|laborator(y|ies)|hospital|doctors?)\b", "clinic"),
    (r"\b(hotel|lodge|guest ?house)\b", "hotel"),
    (r"\b(church|ministries|cathedral|chapel|assembly|tabernacle)\b", "church"),
    (r"\b(college|academy|school|institute|university)\b", "school"),
    (r"\b(restaurant|grill|take ?aways?|kitchen|eatery|food ?court|chicken|pizza|burger|sadza)\b", "fast_food"),
    (r"\b(cafe|café|coffee)\b", "cafe"),
    (r"\b(mall|plaza|arcade|complex)\b", "mall"),
]

# ------------------------------------------------------------------------------------------ name cleanup
JUNK_NAME = re.compile(
    r"(https?:|www\.|\.com\b|\.co\.zw\b|@|\bonline\b|\bweb ?design|\bseo\b|digital marketing|\bfreelanc|private tutor|"
    r"\bremote\b|\bdeliver(y|ies) in\b|whatsapp|\bcall\b|\b07\d{8}\b|\+263|\bpage\b|\bgroup chat\b|\btrading as\b|"
    r"\bharare\s*,?\s*zimbabwe\b$|^zimbabwe$|^harare$|^cbd$|^building \d|\bprivate bag\b|\bp\.?o\.? box\b|"
    r"\bparking lot\b|\bnone\b|^test|^shop \d+$|\bpark$|^unknown|\bbus (terminus|station|stop)\b|\bkombi rank\b)",
    re.I,
)
PERSONAL = re.compile(r"^(dr\.?|mr\.?|mrs\.?|ms\.?|prof\.?|advocate|pastor|prophet|apostle)\s", re.I)
STRIP_TAIL = [
    r"\s*[-|:(]\s*(harare|cbd|zimbabwe|zim|zw|branch|head office|main branch|showroom|shop)\b.*$",
    r"\s*\((pvt|private)\)\s*(ltd|limited)\.?$", r"\s*\b(pvt|private)\.?\s*(ltd|limited)\.?$", r"\s*\bp/l\.?$",
    r"\s*\b(ltd|limited|inc|llc)\.?$", r"\s*,?\s*\b(harare|zimbabwe|zim|zw)\s*$", r"\s+(harare cbd|cbd)$",
]
SMALL_WORDS = {"and", "of", "the", "for", "in", "on", "at", "de", "la", "n", "to", "a"}
KEEP_UPPER = {"OK", "TM", "CBZ", "FBC", "NMB", "ZB", "CABS", "POSB", "NBS", "KFC", "BP", "TV", "DSTV", "ZESA", "ZETDC",
              "NSSA", "PSMAS", "PSMI", "CIMAS", "ZIMRA", "ZTA", "HIV", "USA", "UK", "SA", "ZOU", "MSU", "UZ", "HIT",
              "ICT", "IT", "PC", "LED", "ATM", "DHL", "FedEx", "EY", "KPMG", "PwC", "BDO", "ZIMPOST", "NRZ", "RBZ",
              "LAPF", "UN", "ZANU", "PF", "MDC", "AMC", "JP", "CD", "DVD", "GSM", "SIM", "3D", "N1", "II", "III",
              "BAT", "ZIMTA", "ZIMSEC", "HICC", "ZBC", "ZTV", "ZMD", "ZPC", "ZINARA", "ZINWA", "TSCZ", "VID", "CVR",
              "USD", "ZWG", "CNR", "ST", "P", "J", "K", "M", "G", "T", "V"}


def smart_case(name):
    """Title-case names that arrive ALL CAPS or all lower; keep brand acronyms."""
    words = name.split()
    letters = [c for c in name if c.isalpha()]
    if not letters:
        return name
    upper_ratio = sum(c.isupper() for c in letters) / len(letters)
    if 0.2 < upper_ratio < 0.85 and not name.islower():
        return name  # mixed case: trust it
    out = []
    for i, w in enumerate(words):
        core = re.sub(r"[^A-Za-z0-9&']", "", w)
        if core.upper() in KEEP_UPPER or (len(core) <= 3 and core.isupper() and upper_ratio < 0.99 and core.isalpha()):
            out.append(w.upper() if core.upper() in KEEP_UPPER else w)
        elif w.lower() in SMALL_WORDS and i > 0:
            out.append(w.lower())
        else:
            out.append(w[:1].upper() + w[1:].lower() if w[:1].isalpha() else w[:1] + w[1:2].upper() + w[2:].lower())
    return " ".join(out)


def clean_name(raw):
    if not raw:
        return None
    s = norm_text(raw)
    s = re.sub(r"[​-‏⁠﻿]", "", s)
    s = re.sub(r"[^\w &'.,+!/()\-éÉ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" .,-/")
    if not s or JUNK_NAME.search(s) or PERSONAL.search(s):
        return None
    for p in STRIP_TAIL:
        s2 = re.sub(p, "", s, flags=re.I).strip(" .,-/")
        if len(s2) >= 3:
            s = s2
    if " - " in s and len(s) > 26:
        s = s.split(" - ")[0].strip()
    if "|" in s:
        s = s.split("|")[0].strip()
    s = re.sub(r"\s*\((?!pvt|private)[^)]*\)\s*$", "", s).strip() if len(s) > 22 else s
    s = re.sub(r"\s+(of|and|&|the|-)$", "", s, flags=re.I).strip()  # "Traffic Safety Council of (Zimbabwe)"
    if len(s) < 2 or len(s) > 40 or not re.search(r"[A-Za-z]", s):
        return None
    if re.search(r"[^\x00-\x7f\xe9\xc9]", s):
        return None  # other-language labels from Overture (e.g. Turkish names of landmarks)
    return smart_case(s)


def name_key(s):
    s = norm_text(s).lower()
    s = re.sub(r"\b(the|pvt|private|ltd|limited|zimbabwe|zim|zw|harare|shop|store|stores|branch|cbd)\b", " ", s)
    s = s.replace("&", " and ")
    return re.sub(r"[^a-z0-9]", "", s)



# ------------------------------------------------------------------------------------------ brands & styles
# Sign styles: {bg, fg, accent?, font: bold-sans|condensed|serif|script, case: upper|title, kind}. kind is how the
# sign is built: fascia (flat board on the canopy edge / above the shop window), lightbox (backlit box, glows at
# night), awning (sloped fabric/metal band with the name), painted (letters painted on the wall / parapet),
# blade (projecting double-sided sign, perpendicular to the wall), tower (big letters high on a tower),
# board (small entrance / directory plaque at door height, upstairs offices).
# Colours of chains are sampled from the brand's own logo / signage (sources in docs/references/BUSINESSES.md);
# text and colours only, no logo artwork.
def S(bg, fg, kind="fascia", font="bold-sans", case="upper", accent=None):
    d = {"bg": bg, "fg": fg}
    if accent:
        d["accent"] = accent
    d.update({"font": font, "case": case, "kind": kind})
    return d


STYLES = {}
# key: (sign text, match regex on the raw/clean name, category, style)
BRANDS = {}


def brand(key, name, match, cat, style, big=False, tower=None):
    BRANDS[key] = {"name": name, "match": re.compile(match, re.I), "cat": cat, "style": key, "big": big}
    STYLES[key] = style


# --- supermarkets / wholesale
brand("ok", "OK", r"^(ok|ok supermarkets?|ok stores?|ok zimbabwe|ok (first street|kwame(?: nkrumah)?|fife avenue|five avenue|julius nyerere|mbuya nehanda|robson manyika|third street|albion|union ave\w*))( supermarket)?$|^albion ok supermarket$", "supermarket", S("#ffffff", "#e31b23", "lightbox", "bold-sans", "upper", "#e31b23"), big=True)
brand("okmart", "OK Mart", r"^ok ?mart\b", "supermarket", S("#e31b23", "#ffffff", "lightbox"), big=True)
brand("bonmarche", "Bon Marché", r"^bon march[eé]\b", "supermarket", S("#1f3d2b", "#ffffff", "fascia", "serif", "title", "#c9a44c"), big=True)
brand("tmpnp", "TM Pick n Pay", r"^(tm )?pick ?(n|'n'|and|&) ?pay\b|^tm pick|^tm supermarket|^pnp$", "supermarket", S("#ffffff", "#1b3a8c", "lightbox", "bold-sans", "title", "#d2232a"), big=True)
brand("spar", "SPAR", r"^(spar\b(?! auto| motor| parts)|athienitis spar|market square spar)", "supermarket", S("#ffffff", "#e83038", "lightbox", "bold-sans", "upper", "#008038"), big=True)
brand("choppies", "Choppies", r"^choppies\b", "supermarket", S("#e30613", "#ffffff", "fascia", "bold-sans", "title", "#ffd200"), big=True)
brand("foodworld", "Food World", r"^food ?world\b", "supermarket", S("#ffffff", "#009048", "fascia", "bold-sans", "title", "#d85828"), big=True)
brand("gain", "Gain Cash & Carry", r"^gain (cash|wholesale)", "wholesale", S("#e2231a", "#ffffff", "fascia", "bold-sans", "upper", "#ffd200"), big=True)
brand("nrichards", "N Richards", r"^n\.? ?richards\b", "wholesale", S("#e2231a", "#ffffff", "fascia"), big=True)
# --- fast food (Simbisa brands and others)
brand("chicken_inn", "Chicken Inn", r"^chicken inn\b|^chicken inn zimbabwe$", "fast_food", S("#ffffff", "#e02020", "lightbox", "bold-sans", "title", "#f09020"))
brand("pizza_inn", "Pizza Inn", r"^pizza inn\b", "fast_food", S("#ffffff", "#008030", "lightbox", "bold-sans", "title", "#d02030"))
brand("creamy_inn", "Creamy Inn", r"^creamy inn\b", "fast_food", S("#fbeaf2", "#e04090", "lightbox", "script", "title", "#90c0a0"))
brand("bakers_inn", "Bakers Inn", r"^baker'?s'? inn\b", "bakery", S("#ffffff", "#201070", "lightbox", "serif", "upper", "#b08050"))
brand("fish_inn", "Fish Inn", r"^fish inn\b", "fast_food", S("#ffffff", "#0060b0", "lightbox", "bold-sans", "title", "#f8a810"))
brand("roco_mamas", "RocoMamas", r"^roco ?mamas\b", "restaurant", S("#111111", "#f86800", "lightbox", "script", "title"))
brand("chicken_slice", "Chicken Slice", r"^chicken slice\b", "fast_food", S("#e30613", "#ffd200", "lightbox", "bold-sans", "title", "#ffd200"))
brand("nandos", "Nando's", r"^nando'?s\b", "fast_food", S("#ffffff", "#d01020", "lightbox", "script", "title", "#000000"))
brand("kfc", "KFC", r"^kfc\b|kentucky fried", "fast_food", S("#e31f2e", "#ffffff", "lightbox", "bold-sans", "upper"))
brand("steers", "Steers", r"^steers\b", "fast_food", S("#400040", "#ffffff", "lightbox", "bold-sans", "upper", "#f0c000"))
brand("galitos", "Galito's", r"^galito'?s\b", "fast_food", S("#e30613", "#ffffff", "lightbox", "bold-sans", "upper"))
brand("hungry_lion", "Hungry Lion", r"^hungry lion\b", "fast_food", S("#c81010", "#ffffff", "lightbox", "bold-sans", "upper", "#f8d000"))
brand("chicken_hut", "Chicken Hut", r"^chicken[- ]hut\b", "fast_food", S("#e30613", "#ffffff", "lightbox", "bold-sans", "title", "#ffcc00"))
brand("pizza_hut", "Pizza Hut", r"^pizza hut\b", "fast_food", S("#ee3124", "#ffffff", "lightbox", "script", "title"))
brand("debonairs", "Debonairs Pizza", r"^debonairs\b", "fast_food", S("#e30613", "#ffffff", "lightbox"))
brand("wimpy", "Wimpy", r"^wimpy\b", "restaurant", S("#e30613", "#ffffff", "lightbox"))
# --- banks
brand("cbz", "CBZ", r"^cbz\b(?! (holdings|life|insurance|asset))|^cbz bank\b", "bank", S("#e80820", "#ffffff", "lightbox", "bold-sans", "upper", "#203060"), big=True)
brand("fbc", "FBC Bank", r"^fbc\b(?! insurance| centre| holdings)|^fbc bank", "bank", S("#204088", "#ffffff", "lightbox", "bold-sans", "upper", "#60b8d0"), big=True)
brand("stanbic", "Stanbic Bank", r"^(stanbic|standard bank)\b", "bank", S("#0033a1", "#ffffff", "lightbox", "bold-sans", "title"), big=True)
brand("crown_bank", "Crown Bank", r"^(fbc )?crown bank\b|^standard chartered( bank)?$", "bank", S("#0e2c4e", "#ffffff", "lightbox", "serif", "title", "#c9a44c"), big=True)
brand("steward", "Steward Bank", r"^steward bank\b", "bank", S("#7a2e90", "#ffffff", "lightbox", "bold-sans", "title", "#5a1e6e"), big=True)
brand("nmb", "NMB Bank", r"^nmb\b(?! unity)|^nmb bank", "bank", S("#003060", "#ffffff", "lightbox", "bold-sans", "upper", "#e0c070"), big=True)
brand("zb", "ZB Bank", r"^zb( bank)?$|^zb service cent|^zb bank\b", "bank", S("#008840", "#ffffff", "lightbox", "bold-sans", "upper", "#68c018"), big=True)
brand("cabs", "CABS", r"^cabs( bank| first street| central avenue)?\.?$", "bank", S("#005baa", "#ffffff", "lightbox", "bold-sans", "upper"), big=True)
brand("ecobank", "Ecobank", r"^ecobank\b", "bank", S("#005b82", "#ffffff", "lightbox", "bold-sans", "title", "#bed600"), big=True)
brand("fcb", "First Capital Bank", r"^first capital bank\b|^barclays bank\b", "bank", S("#112369", "#ffffff", "lightbox", "bold-sans", "title", "#93c840"), big=True)
brand("agribank", "Agribank", r"^agribank\b", "bank", S("#006b3f", "#ffffff", "lightbox", "bold-sans", "title", "#f2b705"), big=True)
brand("posb", "POSB", r"^posb\b", "bank", S("#003f87", "#ffffff", "lightbox", "bold-sans", "upper", "#f7a800"), big=True)
brand("bancabc", "BancABC", r"^banc ?abc\b|^abc bank", "bank", S("#101848", "#ffffff", "lightbox", "bold-sans", "title", "#f81800"), big=True)
brand("nedbank", "Nedbank", r"^nedbank\b", "bank", S("#006341", "#ffffff", "lightbox", "bold-sans", "title", "#009639"), big=True)
brand("metbank", "Metbank", r"^metbank\b", "bank", S("#1d2f6f", "#ffffff", "lightbox", "bold-sans", "title"), big=True)
brand("nbs", "NBS Bank", r"^nbs( bank)?\b", "bank", S("#107838", "#ffffff", "lightbox", "bold-sans", "upper", "#b0d030"), big=True)
brand("zwmb", "Zimbabwe Women's Microfinance Bank", r"^zimbabwe women'?s? micro", "bank", S("#6d2077", "#ffffff", "fascia", "bold-sans", "title"))
# --- telecoms / money
brand("econet", "Econet", r"^econet( shop| wireless| \.?zimbabwe| office\b.*)?$", "telecom", S("#ffffff", "#283088", "lightbox", "bold-sans", "title", "#e82028"))
brand("netone", "NetOne", r"^net ?one\b(?! building)", "telecom", S("#f97315", "#ffffff", "lightbox", "bold-sans", "title", "#18181a"))
brand("telone", "TelOne", r"^tel ?one\b(?! gentex)", "telecom", S("#0060a9", "#ffffff", "lightbox", "bold-sans", "title", "#f7941d"))
brand("western_union", "Western Union", r"^western union\b", "money", S("#ffdd00", "#000000", "lightbox", "bold-sans", "upper"))
brand("mukuru", "Mukuru", r"^mukuru\b", "money", S("#f7931e", "#ffffff", "lightbox", "bold-sans", "title"))
brand("moneygram", "MoneyGram", r"^moneygram\b", "money", S("#da291c", "#ffffff", "lightbox", "bold-sans", "title"))
# --- clothing / shoes / department / furniture
brand("edgars", "Edgars", r"^edgars( stores?)?$", "department", S("#ffffff", "#111111", "lightbox", "bold-sans", "upper", "#e00828"), big=True)
brand("jet", "Jet", r"^jet( stores?| zimbabwe| speke avenue)?$", "clothing", S("#000000", "#ffffff", "lightbox", "bold-sans", "title", "#f05008"), big=True)
brand("truworths", "Truworths", r"^truworths?\b", "clothing", S("#111111", "#ffffff", "fascia", "serif", "upper"), big=True)
brand("bata", "Bata", r"^bata\b", "shoes", S("#e60000", "#ffffff", "lightbox", "bold-sans", "title", "#f28c28"))
brand("pep", "PEP", r"^pep( stores?)?$", "clothing", S("#1c75bc", "#ffffff", "lightbox", "bold-sans", "upper"), big=True)
brand("topics", "Topics", r"^topics\b", "clothing", S("#e2231a", "#ffffff", "fascia", "bold-sans", "upper"))
brand("mr_price", "Mr Price", r"^mr ?price\b", "clothing", S("#e30613", "#ffffff", "fascia", "bold-sans", "title"), big=True)
brand("tvsales", "TV Sales & Home", r"^tv sa[lk]es\b", "furniture", S("#d04038", "#ffffff", "lightbox", "bold-sans", "upper", "#b8b8b8"), big=True)
brand("barbours", "Barbours", r"^barbour'?s\b", "department", S("#1f3d2b", "#ffffff", "fascia", "serif", "title"), big=True)
brand("meikles_store", "Meikles", r"^miekles$|^meikles( department store| stores?)?$", "department", S("#1f2a44", "#e8d7a8", "fascia", "serif", "upper"), big=True)
brand("electrosales", "Electrosales", r"^electrosales\b", "hardware", S("#e2231a", "#ffffff", "fascia", "bold-sans", "upper"))
brand("bhola", "Bhola Hardware", r"^bhola\b", "hardware", S("#0b3c8c", "#ffffff", "fascia", "bold-sans", "upper", "#ffd200"))
brand("greenwood", "Greenwood Pharmacy", r"^greenwood pharmacy\b", "pharmacy", S("#00843d", "#ffffff", "lightbox", "bold-sans", "title"))
brand("sanders", "Sanders Opticians", r"^sanders optici", "optician", S("#1f2a44", "#ffffff", "fascia", "serif", "title"))
# --- fuel
brand("total", "TotalEnergies", r"^total( ?energies)?( [a-z ]+)?$(?<!networks)(?<!aggregates)|^total energies", "fuel", S("#ffffff", "#fc0103", "lightbox", "bold-sans", "title", "#0186f5"))
brand("zuva", "Zuva", r"^zuva\b", "fuel", S("#009820", "#ffffff", "lightbox", "bold-sans", "upper"))
brand("engen", "Engen", r"^engen\b", "fuel", S("#002c90", "#ffffff", "lightbox", "bold-sans", "title", "#ed1651"))
brand("puma", "Puma", r"^puma( 7th street| service station)?$", "fuel", S("#007142", "#ffffff", "lightbox", "bold-sans", "upper", "#ed1c24"))
brand("trek", "Trek", r"^trek\b", "fuel", S("#e30613", "#ffffff", "lightbox", "bold-sans", "upper"))
brand("redan", "Redan", r"^redan\b", "fuel", S("#e30613", "#ffffff", "lightbox"))
# --- hotels
brand("meikles", "Meikles Hotel", r"^hyatt regency harare|^m[ei]{2}kles hotel\b", "hotel", S("#1f2a44", "#e8d7a8", "fascia", "serif", "upper"), big=True)
brand("monomotapa", "Monomotapa", r"^monom[ou]tapa hotel|^crowne plaza\b|^monomatapa hotel", "hotel", S("#301008", "#ffffff", "fascia", "serif", "upper", "#f06020"), big=True)
brand("holiday_inn", "Holiday Inn", r"^holiday inn\b", "hotel", S("#ffffff", "#216245", "lightbox", "bold-sans", "title"), big=True)
brand("rainbow_towers", "Rainbow Towers", r"^(the )?rainbow towers\b", "hotel", S("#1f2a44", "#ffffff", "fascia", "serif", "upper"), big=True)
brand("bronte", "Bronte Hotel", r"^bronte\b", "hotel", S("#2c4a2e", "#f4ecd8", "painted", "serif", "title"), big=True)
brand("cresta_jameson", "Cresta Jameson", r"^cresta jameson\b", "hotel", S("#0e2d44", "#ffffff", "fascia", "serif", "upper", "#aa9f95"), big=True)
brand("cresta_oasis", "Cresta Oasis", r"^cresta oasis\b", "hotel", S("#0e2d44", "#ffffff", "fascia", "serif", "upper", "#aa9f95"), big=True)
brand("n1", "N1 Hotel", r"^n1 hotel\b", "hotel", S("#e30613", "#ffffff", "fascia", "bold-sans", "upper"), big=True)
brand("new_ambassador", "New Ambassador Hotel", r"^new ambassador\b", "hotel", S("#1f2a44", "#ffffff", "fascia", "serif", "upper"), big=True)
brand("sai_mart", "Sai Mart", r"^sai ?mart\b", "supermarket", S("#c8102e", "#ffffff", "fascia", "bold-sans", "title", "#ffd200"), big=True)
# Letters mounted straight on a tower (no board): draw fg letters only; bg is the wall behind them.
STYLES["tower_meikles"] = dict(S("#8c8a84", "#2e2a26", "tower", "serif", "upper"), letters=True)
STYLES["tower_monomotapa"] = dict(S("#b89a74", "#f4f1ea", "tower", "bold-sans", "upper"), letters=True)
STYLES["tower_ssc"] = dict(S("#5b4a3e", "#ece6dc", "tower", "bold-sans", "upper"), letters=True)
STYLES["mall_eastgate"] = S("#ece6de", "#2b2b2b", "painted", "bold-sans", "upper", "#b5651d")
STYLES["herald"] = S("#f4f1ea", "#111111", "painted", "serif", "upper", "#1e3f8a")
STYLES["zimpost"] = S("#f4f1ea", "#0b3c8c", "painted", "serif", "upper", "#e2231a")


def brand_of(name, raw_brand=None):
    s = norm_text(name or "").strip()
    for key, b in BRANDS.items():
        if b["match"].search(s):
            return key
    if raw_brand:
        rb = norm_text(raw_brand).strip()
        for key, b in BRANDS.items():
            if b["match"].search(rb) and len(s) < 40:
                return key
    return None


# Generic styles for independents, by category (a few variants each, picked by a hash of the name).
GENERIC = {
    "supermarket": [S("#c62828", "#ffffff", "fascia"), S("#1e4fa0", "#ffffff", "fascia"), S("#1b7a3a", "#ffffff", "fascia")],
    "grocery": [S("#f2c230", "#1a1a1a", "painted"), S("#1b7a3a", "#ffffff", "fascia"), S("#c62828", "#ffffff", "painted")],
    "wholesale": [S("#1e4fa0", "#ffffff", "fascia", "condensed"), S("#c62828", "#ffffff", "fascia", "condensed")],
    "fast_food": [S("#e8601c", "#ffffff", "lightbox"), S("#c62828", "#ffd54f", "lightbox"), S("#f2c230", "#8b1d1d", "fascia")],
    "restaurant": [S("#3e2723", "#f4e3b0", "fascia", "serif", "title"), S("#8b1d1d", "#ffffff", "fascia", "serif", "title")],
    "cafe": [S("#4e342e", "#f4ecd8", "awning", "script", "title"), S("#1b5e20", "#ffffff", "awning", "serif", "title")],
    "bakery": [S("#f4ecd8", "#6d3b1a", "awning", "script", "title")],
    "bar": [S("#202020", "#f2c230", "lightbox", "condensed"), S("#5e2a84", "#ffffff", "lightbox")],
    "butcher": [S("#f4f1ea", "#b71c1c", "painted", "bold-sans")],
    "liquor": [S("#202020", "#f2c230", "painted", "condensed")],
    "bank": [S("#0f3d6e", "#ffffff", "lightbox", "bold-sans", "title")],
    "money": [S("#f2c230", "#1a1a1a", "lightbox"), S("#1e4fa0", "#ffffff", "lightbox")],
    "finance": [S("#0f6e6e", "#ffffff", "fascia", "bold-sans", "title"), S("#1e3f8a", "#ffffff", "fascia", "bold-sans", "title")],
    "insurance": [S("#f4f1ea", "#1e3f8a", "board", "serif", "title")],
    "pharmacy": [S("#1b7a3a", "#ffffff", "lightbox", "bold-sans", "title"), S("#ffffff", "#1b7a3a", "lightbox", "bold-sans", "title")],
    "clinic": [S("#ffffff", "#0f6e6e", "fascia", "bold-sans", "title", "#c62828"), S("#0f6e6e", "#ffffff", "fascia", "bold-sans", "title")],
    "optician": [S("#1f2a44", "#ffffff", "fascia", "serif", "title")],
    "hotel": [S("#1f2a44", "#e8d7a8", "fascia", "serif", "upper")],
    "office": [S("#d9d4c9", "#202020", "board", "bold-sans", "title"), S("#202020", "#e0e0e0", "board", "bold-sans", "title")],
    "government": [S("#f4f1ea", "#1a1a1a", "board", "serif", "title", "#1b5e20")],
    "church": [S("#f4f1ea", "#1e3f8a", "painted", "serif", "title")],
    "school": [S("#1e3f8a", "#ffffff", "board", "serif", "title")],
    "fuel": [S("#ffffff", "#c62828", "lightbox")],
    "salon": [S("#e91e63", "#ffffff", "painted", "script", "title"), S("#5e2a84", "#ffffff", "fascia", "script", "title"),
              S("#111111", "#f8bbd0", "fascia", "script", "title")],
    "electronics": [S("#1e4fa0", "#ffffff", "fascia"), S("#202020", "#ffffff", "lightbox"), S("#0f6e6e", "#ffffff", "fascia")],
    "phone": [S("#1565c0", "#ffffff", "lightbox"), S("#f2c230", "#1a1a1a", "fascia"), S("#e8601c", "#ffffff", "fascia")],
    "telecom": [S("#1565c0", "#ffffff", "lightbox")],
    "clothing": [S("#111111", "#ffffff", "fascia", "serif", "upper"), S("#8b1d1d", "#f4e3b0", "fascia", "serif", "title"),
                 S("#e91e63", "#ffffff", "fascia", "script", "title"), S("#f4f1ea", "#111111", "fascia", "condensed", "upper")],
    "shoes": [S("#202020", "#ffffff", "fascia"), S("#c62828", "#ffffff", "fascia")],
    "department": [S("#1f2a44", "#ffffff", "fascia", "serif", "upper")],
    "furniture": [S("#8b1d1d", "#ffffff", "fascia"), S("#1e3f8a", "#ffffff", "fascia")],
    "hardware": [S("#f2c230", "#1a1a1a", "painted", "condensed"), S("#1e4fa0", "#ffffff", "fascia", "condensed"),
                 S("#c62828", "#ffffff", "painted", "condensed")],
    "auto_parts": [S("#202020", "#f2c230", "painted", "condensed"), S("#c62828", "#ffffff", "painted", "condensed"),
                   S("#1e4fa0", "#ffffff", "painted", "condensed")],
    "car_dealer": [S("#202020", "#ffffff", "fascia")],
    "mall": [S("#f4f1ea", "#1a1a1a", "fascia", "bold-sans", "upper", "#c62828")],
    "stationery": [S("#1e3f8a", "#ffffff", "fascia")],
    "printing": [S("#0f6e6e", "#ffffff", "fascia"), S("#202020", "#00bcd4", "fascia")],
    "books": [S("#1b5e20", "#ffffff", "fascia", "serif", "title")],
    "jewellery": [S("#111111", "#d4af37", "fascia", "serif", "upper")],
    "cinema": [S("#111111", "#ffffff", "lightbox")],
    "travel": [S("#0f6e6e", "#ffffff", "fascia", "bold-sans", "title")],
    "courier": [S("#f2c230", "#c62828", "fascia")],
    "gym": [S("#111111", "#f2c230", "fascia", "condensed")],
    "funeral": [S("#2b2b2b", "#e0e0e0", "fascia", "serif", "title")],
    "laundry": [S("#1565c0", "#ffffff", "fascia", "bold-sans", "title")],
    "retail": [S("#8b1d1d", "#ffffff", "fascia"), S("#1e4fa0", "#ffffff", "fascia"), S("#f4f1ea", "#1b5e20", "painted"),
               S("#202020", "#f2c230", "fascia")],
    "market": [S("#c62828", "#ffffff", "painted", "condensed")],
}
for _cat, _lst in GENERIC.items():
    for _i, _st in enumerate(_lst):
        STYLES[f"gen_{_cat}_{_i}"] = _st


def generic_style(c):
    lst = GENERIC.get(c["cat"]) or GENERIC["retail"]
    i = int(seeded(c["name"]) * len(lst)) % len(lst)
    cat = c["cat"] if c["cat"] in GENERIC else "retail"
    return f"gen_{cat}_{i}"


# ------------------------------------------------------------------------------------------ curated
# Web-verified businesses (see docs/references/BUSINESSES.md for the evidence of each). `at` is one of:
#   ("xz", x, z)                      point in local metres (the facade nearest to it is used)
#   ("ll", lat, lon)                  WGS84 point
#   ("cnr", "street A", "street B", "ne"|"nw"|"se"|"sw")   the corner block of a junction (street group ids / names)
#   ("b", building_index)             a harare.json building
#   ("lm", "landmark key")            the harare.json building carrying that landmark key
# Optional: face (street the sign faces), floor, kind, tower (True: tower-top letters), faces (towers: count),
# sub (secondary sign text), evidence (URL), note.

_D = "https://thedirectory.co.zw/branch.cfm?branchid="
_SIM = "https://www.simbisabrands.com/store-locator/zimbabwe/"
_ECO = "https://www.econet.co.zw/shop-locator/"
_NET = "https://www.netone.co.zw/shop-locator"
_ZB = "https://www.zb.co.zw/banking/branch-locator"
_TVS = "https://tvsales.co.zw/contact-deals/"


def _c(name, at, evidence, addr=None, **kw):
    d = {"name": name, "at": at, "evidence": evidence, "addr": addr}
    d.update(kw)
    return d


CURATED = [
    # ---- supermarkets
    _c("OK", ("b", 2069), _D + "13552", "Cnr First Street & Nelson Mandela Ave (First Street branch, the original 1942 OK store)"),
    _c("OK", ("b", 1283), _D + "13576", "Kwame Nkrumah Ave near Julius Nyerere Way (OK Kwame Nkrumah, 2418A Kwame Nkrumah Ave)",
       face="Kwame Nkrumah (Union) Avenue"),
    _c("OK", ("xz", -1033, 425), _D + "13575", "5950 Mbuya Nehanda St, cnr Albion St (Mbuya Nehanda branch)"),
    _c("OK", ("b", 3832), _D + "20537", "Robert Mugabe Rd cnr Third St (Third Street branch)"),
    _c("OK", ("xz", 319, -1182), _D + "13551", "Fife Avenue Shopping Centre (Fife Avenue branch)"),
    _c("TM Pick n Pay", ("b", 2203), _D + "12582", "73/74 Jason Moyo Ave, cnr Sam Nujoma St", face="Jason Moyo Avenue"),
    _c("TM Pick n Pay", ("cnrb", "Jason Moyo Avenue", "Mayor Urimbo Terrace", 2123), _D + "19210",
       "Joina City shop L01, cnr Inez Terrace / Jason Moyo Ave", face="Jason Moyo Avenue"),
    _c("TM Pick n Pay", ("xz", -1107, 318), _D + "19191", "Margolis Plaza, Harare St / Speke Ave (Harare Street TM)", face="Harare Street"),
    _c("Meikles Mega Market", ("b", 2255), "https://www.zimyellowpage.com/listings/category/meikles-mega-market",
       "91 Robert Mugabe Rd, cnr Orr St", brand="meikles_store", keep_name=True),
    _c("Sai Mart", ("b", 1192), "https://news.pindula.co.zw/2025/03/11/sai-mart-takes-over-all-former-choppies-zimbabwe-stores/",
       "Nelson Mandela Ave (former Choppies)", brand="sai_mart"),
    _c("Sai Mart", ("b", 2610), "https://news.pindula.co.zw/2025/03/11/sai-mart-takes-over-all-former-choppies-zimbabwe-stores/",
       "Cameron St / Robert Mugabe Rd (former Choppies)", brand="sai_mart"),
    _c("SPAR", ("xz", 221, -1173), "https://www.spar.co.zw/stores/31/harare/6/spar-athienitis",
       "SPAR Athienitis, 147 Fife Ave, cnr Fifth St (Fife Avenue Shopping Centre)", sign="SPAR Athienitis", keep_name=True,
       brand="spar"),
    _c("Kwame Mall", ("b", 1284), "https://mapcarta.com/W541692930", "Kwame Nkrumah (Union) Ave", cat="mall",
       style="gen_mall_0"),
    _c("Food World", ("xz", -492, 410), _D + "11688", "52 Robert Mugabe Rd (Food World Julius Nyerere)"),
    _c("Food World", ("b", 2131), _D + "11687", "42 Jason Moyo Ave (Food World Angwa)"),
    _c("Food World", ("xz", -797, 322), _D + "11686", "103 Cameron St (Camspek Food World)"),
    # ---- banks
    _c("CBZ", ("xz", -351, -158), _D + "6733", "Union House, 60 Kwame Nkrumah Ave (Kwame Nkrumah branch / head office)", face="Kwame Nkrumah (Union) Avenue"),
    _c("CBZ", ("b", 2263), _D + "6747", "83 Robert Mugabe Rd (Robert Mugabe branch)"),
    _c("CBZ", ("b", 2538), _D + "6750", "Cnr Angwa St / Speke Ave (Sapphire branch)"),
    _c("CBZ", ("xz", -142, -585), _D + "6751", "Avenue Place, 7 Selous Ave (Selous branch)"),
    _c("FBC Bank", ("b", 2097), _D + "6692", "FBC Centre, 45 Nelson Mandela Ave (head office)"),
    _c("FBC Bank", ("b", 1278), _D + "6694", "34 Nelson Mandela Ave (Nelson Mandela branch)"),
    _c("FBC Bank", ("b", 1687), _D + "6693", "Old Reserve Bank Building, 76 Samora Machel Ave (Samora Machel branch)"),
    _c("Stanbic Bank", ("b", 1985), _D + "6862", "Stanbic Chambers, 64 Nelson Mandela Ave"),
    _c("Stanbic Bank", ("xz", -403, -246), _D + "6861", "59 Samora Machel Ave"),
    _c("Crown Bank", ("b", 1965), "https://www.fbc.co.zw/fbc-crown/about-us/contact-us",
       "Africa Unity Square, 68 Nelson Mandela Ave / Sam Nujoma St (ex Standard Chartered, renamed FBC Crown Bank Aug 2024)"),
    _c("Steward Bank", ("xz", 112, -215), _D + "8471", "Union Building, 101 Kwame Nkrumah Ave (head office)"),
    _c("Steward Bank", ("cnrb", "Robert Mugabe Road", "Patrice Lumumba Street", 2233), _D + "16331",
       "Eastgate, cnr Robert Mugabe Rd / Third St", face="Robert Mugabe Road"),
    _c("NMB Bank", ("xz", -336, -160), _D + "5597", "Unity Court, cnr Kwame Nkrumah Ave / First St (head office)"),
    _c("NMB Bank", ("b", 2233), _D + "6636", "Ground floor, Eastgate, Robert Mugabe Rd", face="Robert Mugabe Road"),
    _c("Ecobank", ("b", 2099), _D + "14486", "35 Nelson Mandela Ave, cnr Angwa St"),
    _c("Ecobank", ("xz", 484, -468), _D + "14487", "137 Samora Machel Ave"),
    _c("First Capital Bank", ("xz", -251, 128), _D + "12503", "Barclays House, cnr Jason Moyo Ave / First St (head office)"),
    _c("Agribank", ("b", 1202), _D + "4280", "Hurudza House, 14-16 Nelson Mandela Ave (head office)"),
    _c("Nedbank", ("xz", 198, 60), _D + "10990", "99 Jason Moyo Ave (Jason Moyo branch)"),
    _c("ZB Bank", ("xz", -262, 78), _ZB, "15 George Silundika Ave & First St (First Street service centre)"),
    _c("ZB Bank", ("xz", -897, 495), _ZB, "Cnr Robert Mugabe Rd / Chinhoyi St (Westend service centre)"),
    _c("ZB Bank", ("cnr", "Kaguvi Street", "Kwame Nkrumah Avenue", "nw"), _ZB, "Kaguvi St / Kwame Nkrumah Ave (Rotten Row service centre)"),
    _c("CABS", ("ll", -17.829564, 31.049733), "https://www.cabs.co.zw/cabs-first-street",
       "17 First St, cnr George Silundika Ave (CABS First Street)"),
    _c("CABS", ("xz", 116, -580), "https://www.cabs.co.zw/cabs-central-avenue-1",
       "Cnr Simon Muzenda (Fourth) St & Central Ave (CABS Central Avenue)"),
    _c("POSB", ("xz", 62, -572), "https://nearme.3o9.in/stores/Zimbabwe/Harare/Harare/POSB%20CAUSEWAY",
       "6th floor, Causeway Building, cnr Third St & Central Ave (POSB Causeway)", floor=6, kind="board"),
    _c("Zimbabwe Women's Microfinance Bank", ("xz", -594, -271), "https://womensbank.co.zw/contact-zimbabwe-women-microfinance-bank/",
       "Trust Towers, 56-60 Samora Machel Ave (head office and main branch)"),
    _c("NBS Bank", ("xz", -442, -236), _ZB, "53 Samora Machel Ave (National Building Society; listed as a ZB agent)"),
    _c("Metbank", ("xz", -147, -472), _D + "297", "3 Central Ave (head office)"),
    _c("Reserve Bank of Zimbabwe", ("lm", "rbz"), "https://www.rbz.co.zw/index.php/contact-us", "80 Samora Machel Ave",
       cat="government", kind="board", style="gen_government_0", keep_name=True, face="Samora Machel Avenue"),
    _c("Old Mutual Centre", ("b", 3838), _D + "6384",
       "Cnr Third St / Jason Moyo Ave (Nedbank head office is on its 14th floor)", cat="office", kind="board",
       style="gen_office_1", keep_name=True, face="Patrice Lumumba Street"),
    # ---- telecoms
    _c("Econet", ("b", 2189), _D + "7111", "Econet House, 19 George Silundika Ave (cnr First St)"),
    _c("Econet", ("ll", -17.82164, 31.04792), _ECO, "198 Herbert Chitepo Ave (Econet-owned shop)"),
    _c("Econet", ("ll", -17.8207388, 31.0584353), _ECO, "79 Livingstone Ave (Econet-owned shop)"),
    _c("Econet", ("ll", -17.827783, 31.047755), _ECO, "Angwa St (franchise: Brand Digital)", sub="Brand Digital"),
    _c("Econet", ("ll", -17.83226967, 31.04698181), _ECO, "Julius Nyerere Way / Speke Ave (franchise: CellTrade)", sub="CellTrade"),
    _c("Econet", ("ll", -17.83645964, 31.04373693), _ECO, "Cameron St / Bank St (franchise: Brimas)", sub="Brimas"),
    _c("Econet", ("ll", -17.831464, 31.0529112), _ECO, "Eastgate (franchise: Brand Digital)", sub="Brand Digital"),
    _c("Econet", ("ll", -17.82971764, 31.05047226), _ECO, "Sam Nujoma St / George Silundika Ave (franchise: Globtech)", sub="Globtech"),
    _c("Econet", ("ll", -17.824323, 31.056708), _ECO, "Samora Machel Ave / Sixth St (franchise: Media Connect)", sub="Media Connect"),
    _c("NetOne", ("ll", -17.829466, 31.054155), _NET, "104 Jason Moyo Ave (NetOne Vanguard shop)"),
    _c("NetOne", ("ll", -17.829135, 31.04679), _NET, "66 Julius Nyerere Way (NetOne Julius Nyerere shop)"),
    _c("NetOne", ("ll", -17.831241, 31.04103), _NET, "Kopje Plaza, 1 Jason Moyo Ave (NetOne head office & shop)"),
    _c("TelOne", ("xz", 168, -238), _D + "17694", "Runhare House, 107 Kwame Nkrumah Ave (head office)"),
    # ---- clothing / department / furniture
    _c("Edgars", ("b", 2179), _D + "10305", "Cnr First St / Jason Moyo Ave", face="Jason Moyo Avenue"),
    _c("Edgars", ("xz", -317, 409), _D + "10304", "Cnr Robert Mugabe Rd / Angwa St"),
    _c("Edgars", ("b", 2014), _D + "10299", "ZB Centre, cnr First St / Kwame Nkrumah Ave"),
    _c("Edgars", ("cnrb", "Robert Mugabe Road", "Sam Nujoma Street", 2233), _D + "10308",
       "Eastgate, cnr Robert Mugabe Rd / Sam Nujoma St", face="Robert Mugabe Road"),
    _c("Jet", ("xz", -233, 87), "https://allafrica.com/stories/202202250610.html", "Cnr First St & George Silundika Ave (opened Feb 2022)"),
    _c("Jet", ("b", 2160), "https://allafrica.com/stories/202202250610.html", "First St / Speke Ave (the older First Street Jet)"),
    _c("Jet", ("b", 2972), "https://thedirectory.co.zw/branch.cfm?branchid=10293", "Cameron St"),
    _c("Jet", ("xz", -137, 221), "https://thedirectory.co.zw/branch.cfm?branchid=10229", "Speke Ave"),
    _c("Truworths", ("xz", -241, 182), _D + "7616", "Batanai Gardens, First St"),
    _c("Bata", ("b", 2067), _D + "3563", "50 Nelson Mandela Ave"),
    _c("Topics", ("b", 2518), _D + "14439", "Cnr Robson Manyika Ave / Angwa St"),
    _c("Topics", ("b", 2070), _D + "14426", "George Silundika Ave / First St"),
    _c("Topics", ("xz", -471, -62), _D + "14419", "Angwa City, cnr Julius Nyerere Way / Angwa St", face="Sir Seretse Khama Street"),
    _c("TV Sales & Home", ("b", 2063), _TVS, "63 Nelson Mandela Ave, cnr First St (Africa Unity Square branch)"),
    _c("TV Sales & Home", ("b", 2182), _TVS, "Batanai Gardens, 59 Jason Moyo Ave", face="Jason Moyo Avenue"),
    _c("TV Sales & Home", ("b", 2162), _TVS, "Zimbank House, cnr First St & Speke Ave (factory shop)"),
    _c("TV Sales & Home", ("b", 2228), _TVS, "92 Robert Mugabe Rd"),
    _c("TV Sales & Home", ("b", 1304), _TVS, "Megawatt House, cnr Samora Machel Ave & Leopold Takawira St"),
    _c("Gain Cash & Carry", ("b", 2799), _D + "16043", "104 Chinhoyi St (Chinhoyi Street branch), beside the Zuva forecourt"),
    _c("Electrosales", ("xz", -813, 547), "https://thedirectory.co.zw/branch.cfm?branchid=19309", "85 Cameron St"),
    # ---- pharmacies
    _c("Greenwood Pharmacy", ("xz", -876, -3), _D + "15240", "Hughes House, Kwame Nkrumah Ave / 22 Park St"),
    _c("Greenwood Pharmacy", ("b", 4076), _D + "13021", "Grayhurst Building, cnr Fourth St & Nelson Mandela Ave"),
    # ---- fast food (Simbisa branch names from the Simbisa store locator; addresses from the branch pages)
    _c("Chicken Inn", ("xz", -1012, 801), _SIM, "Cnr Bank St & 119 Mbuya Nehanda St (branch 'Sakunda')"),
    _c("Chicken Inn", ("xz", -853, -7), _SIM, "Hughes House, cnr Kwame Nkrumah Ave & Park St (branch 'Hughes')"),
    _c("Chicken Inn", ("xz", -559, -78), _SIM, "AMC, cnr Julius Nyerere Way & Kwame Nkrumah Ave (branch 'AMC')"),
    _c("Pizza Inn", ("xz", -577, -60), _SIM, "AMC, cnr Julius Nyerere Way & Kwame Nkrumah Ave"),
    _c("Creamy Inn", ("xz", -566, -66), _SIM, "AMC, cnr Julius Nyerere Way & Kwame Nkrumah Ave"),
    _c("Chicken Inn", ("xz", -441, 331), _SIM, "Cnr Speke Ave & Inez Terrace (branch 'Speke')"),
    _c("Nando's", ("xz", -450, 329), _D + "13989", "Speke food court, cnr Speke Ave & Inez Terrace"),
    _c("KFC", ("xz", -458, 293), _D + "19417", "Joina City, cnr Inez Terrace & Speke Ave"),
    _c("Chicken Inn", ("xz", 363, -525), _SIM, "Cnr Samora Machel Ave & Fifth St (branch 'Samora')"),
    _c("Pizza Inn", ("xz", 350, -518), _SIM, "Cnr Samora Machel Ave & Fifth St"),
    _c("Bakers Inn", ("xz", 376, -521), _SIM, "Cnr Samora Machel Ave & Fifth St"),
    _c("Chicken Inn", ("xz", 511, 129), _SIM, "Roadport, cnr Fifth St & Robert Mugabe Rd (branch 'Road Port')"),
    _c("Chicken Inn", ("xz", 49, 289), _SIM, "105 Robert Mugabe Rd (branch '105 R G Mugabe')"),
    _c("Creamy Inn", ("xz", 40, 308), _SIM, "105 Robert Mugabe Rd"),
    _c("Pizza Inn", ("xz", 32, 300), _SIM, "106 Robert Mugabe Rd"),
    _c("Chicken Inn", ("xz", -338, 461), _SIM, "Ottawa House, Angwa St / Robson Manyika Ave (branch 'Angwa')"),
    _c("Chicken Inn", ("xz", -308, -79), _SIM, "First St (branch 'First'; Chicken Inn, Bakers Inn, Creamy Inn, Pizza Inn counters)"),
    _c("Pizza Inn", ("xz", -306, -70), _SIM, "First St"),
    _c("Chicken Inn", ("xz", -728, 152), _SIM, "Construction House, Leopold Takawira St (branch 'Construction Hse')"),
    _c("Chicken Inn", ("xz", -584, 546), _SIM, "Julius Nyerere Way (branch 'J Nyerere')"),
    _c("Bakers Inn", ("xz", -513, -203), _SIM, "Throgmorton House, cnr Samora Machel Ave & Julius Nyerere Way"),
    _c("Chicken Inn", ("xz", 312, -1200), _SIM, "Fife Avenue Shopping Centre (branch 'Five Avenue')"),
    _c("Pizza Inn", ("xz", 280, -1203), _SIM, "Fife Avenue Shopping Centre, cnr Fife Ave & Sixth St"),
    _c("Nando's", ("xz", 488, -534), _D + "13987", "142 Samora Machel Ave"),
    _c("Chicken Slice", ("xz", 721, -494), "https://www.waze.com/live-map/directions/zw/harare-province/harare/chicken-slice?to=place.ChIJxS4FXt6kMRkRl5EQ9zjMDw8",
       "Seventh St / Samora Machel Ave"),
    _c("Chicken Slice", ("xz", -975, 27), "https://x.com/ChickenSliceog/status/1271076436162613248",
       "Cnr Kwame Nkrumah (Union) Ave, Chinhoyi & Mbuya Nehanda St"),
    _c("Chicken Slice", ("b", 2091), "https://zimbabwe-streets.openalfa.com/harare-province/eating-drinking", "Cnr George Silundika Ave & Angwa St"),
    _c("Chicken Slice", ("b", 2901), "https://chickenslice.com/store/chicken-slice-bank-street/", "87 Mbuya Nehanda St, cnr Bank St"),
    _c("Chicken Slice", ("xz", -976, 320), "https://www.waze.com/live-map/directions/zw/harare-province/harare/chicken-slice-mbuya-nehanda?to=place.ChIJ7TBI48KkMRkRyxMmusHcjvg",
       "126 Mbuya Nehanda St"),
    _c("Creamy Inn", ("xz", 261, -1185), _SIM, "Fife Avenue Shopping Centre (Simbisa 'Five Avenue')"),
    _c("Hungry Lion", ("b", 2232), "https://stores.hungrylion.co.zw/", "Eastgate Mall shop 24, ground floor, Sam Nujoma St",
       face="Sam Nujoma Street (2nd Street)"),
    # ---- fuel
    _c("TotalEnergies", ("xz", -1031, -101), "https://www.waze.com/live-map/directions/zw/harare-province/harare/totalenergies-service-station-samora-1?to=place.ChIJzQqXhfykMRkRHIuAq00HlM0",
       "12 Samora Machel Ave (TotalEnergies Samora 1)"),
    _c("TotalEnergies", ("xz", -930, 563), "https://wanderlog.com/place/details/11679315/totalenergies-service-station-chinhoyi-street",
       "36 Robert Mugabe Rd, cnr Chinhoyi St (TotalEnergies Chinhoyi Street)"),
    _c("TotalEnergies", ("xz", -157, -229), "https://www.aazimbabwe.co.zw/24-hour-fuel-stations/",
       "Kwame Nkrumah (Union) Ave, cnr Sam Nujoma St"),
    _c("Zuva", ("ll", -17.8252, 31.05393), "https://vymaps.com/ZW/Harare/petrol-station/", "Samora Machel Ave / Fourth St"),
    _c("Zuva", ("b", 2801), "https://zw.near-place.com/gas_station-nearby-zuva-chinhoyi-street-100-chinhoyi-street-harare",
       "100 Chinhoyi St (-17.835403, 31.043188); kiosk at the back of the forecourt"),
    _c("Engen", ("xz", -1130, 557), _D + "17223", "18 Robert Mugabe Rd (Engen Corner)"),
    _c("Engen", ("b", 3869), _D + "17255", "95 Speke Ave / Fourth St (Engen Fourth Street)"),
    _c("Engen", ("b", 2564), _D + "17238", "85-87 Leopold Takawira St (Engen Takawira)"),
    _c("Puma", ("xz", 723, -532), _D + "7171", "159 Samora Machel Ave, cnr Seventh St"),
    _c("Puma", ("xz", -142, -158), _D + "18229", "77 Kwame Nkrumah Ave / Sam Nujoma St (Second Street branch)"),
    # ---- hotels (and the tower-top names photographed on them)
    _c("Meikles Hotel", ("lm", "meikles"), "https://www.hyatt.com/hyatt-regency/en-US/hrerh-hyatt-regency-harare-the-meikles/hotel-info",
       "Cnr Jason Moyo Ave & Third St, facing Africa Unity Square",
       sign="Hyatt Regency Harare The Meikles", face="Jason Moyo Avenue", keep_name=True),
    _c("Meikles Hotel", ("lm", "meikles_south"), "https://commons.wikimedia.org/wiki/File:Eastgate_Centre,_Harare,_Zimbabwe.jpg",
       "rooftop letters 'MEIKLES HOTEL' on the south wing (photo 2008)", sign="MEIKLES HOTEL", tower=True, faces=1,
       face="Agostinho Neto Avenue", keep_name=True, style="tower_meikles"),
    _c("Monomotapa", ("lm", "monomotapa"), "https://www.africansunhotels.com/hotels/6/monomotapa", "54 Park Lane",
       sign="Monomotapa Hotel", keep_name=True, brand="monomotapa"),
    _c("Monomotapa", ("lm", "monomotapa"), "https://www.flickr.com/photos/47293505@N06/4813530610",
       "rooftop letters (CROWNE PLAZA MONOMOTAPA in 2010-12; the hotel now trades as the Monomotapa)", sign="MONOMOTAPA",
       tower=True, faces=1, keep_name=True, style="tower_monomotapa", brand="monomotapa"),
    _c("Holiday Inn", ("b", 4529), "https://www.ihg.com/holidayinn/hotels/us/en/harare/harsf/hoteldetail", "Samora Machel Ave & Fifth St"),
    _c("Rainbow Towers", ("lm", "rainbow_towers"), "https://www.expedia.com/Harare-Hotels-Rainbow-Towers-Hotel.h1506424.Hotel-Information",
       "1 Pennefather Ave", sign="Rainbow Towers Hotel & Conference Centre", keep_name=True),
    _c("Cresta Jameson", ("b", 1255), "https://www.crestahotels.com/hotels/zimbabwe/cresta-jameson", "Cnr Samora Machel Ave & Park St",
       face="Samora Machel Avenue"),
    _c("Cresta Oasis", ("xz", 494, -270), "https://www.hotelplanner.com/Hotels/258659/Reservations-Cresta-Oasis-Harare-124-Nelson-Mandela-Ave-",
       "124 Nelson Mandela Ave"),
    # N1 Hotel Samora Machel; the second N1 (N1 Hotel Rotten Row, cnr Samora Machel / Rotten Row) comes from Overture
    _c("N1 Hotel", ("b", 4227), "https://www.tripadvisor.com/Hotel_Review-g293760-d6850412-Reviews-N1_Hotel_Samora_Machel_Harare-Harare_Harare_Province.html",
       "126 Samora Machel Ave (N1 Hotel Samora Machel; OSM building 'N1 Hotel')"),
    _c("New Ambassador Hotel", ("xz", -61, -244), "https://www.hotelplanner.com/Hotels/258669/Reservations-New-Ambassador-Hotel-Harare-88-Kwame-Nkrumah-Ave-00000",
       "88 Kwame Nkrumah Ave"),
    _c("Bronte Hotel", ("b", 6772), "https://brontehotel.com/contact-us/", "132 Baines Ave (cnr Simon Muzenda / Fourth St)",
       face="Herbert Ushewokunze Avenue"),
    # ---- names on towers / landmarks
    _c("SSC", ("lm", "social_security_centre"), "https://www.flickr.com/photos/39267804@N05/",
       "vertical letters 'SSC' high on the Social Security Centre (NSSA) tower (photo 2019)", cat="office", tower=True,
       faces=1, face="Julius Nyerere Way", vertical=True, style="tower_ssc"),
    _c("Eastgate", ("cnrb", "Robert Mugabe Road", "Sam Nujoma Street", 2233), "https://en.wikipedia.org/wiki/Eastgate_Centre,_Harare",
       "Eastgate Centre, cnr Robert Mugabe Rd & Sam Nujoma St", cat="mall", face="Sam Nujoma Street (2nd Street)", style="mall_eastgate"),
    _c("Herald House", ("b", 2199), "https://www.zimpapers.co.zw/contact-us/", "Cnr George Silundika Ave & Sam Nujoma St (Zimpapers)",
       cat="office", kind="painted", style="herald", sub="ZIMPAPERS", keep_name=True),
    _c("Main Post Office", ("lm", "main_post_office"), _D + "17695", "Cnr Julius Nyerere Way / Nelson Mandela Ave (Zimpost)",
       cat="courier", face="Julius Nyerere Way", style="zimpost", sub="ZIMPOST"),
    # ---- added in review (appended so earlier curated:<index> ids stay stable)
    _c("Galaxy Mall", ("b", 2183), "https://www.heraldonline.co.zw/harares-property-repurposing-renaissance/",
       "Cnr First St & Jason Moyo Ave (the former Barbours department store building)", cat="mall"),
]
# Mapped entries that are closed, renamed or wrong: (name regex, (x, z) or None, radius m, reason)
REMOVE = [
    (r"^choppies", None, 0, "Choppies left Zimbabwe in Dec 2024; the stores became Sai Mart (added above)"),
    (r"^pep( stores?)?$", None, 0, "PEP left Zimbabwe in 2019 (theanchor.co.zw/pep-exits-zimbabwe)"),
    (r"^(standard chartered|crown bank)", (-170, 360), 40, "Standard Chartered Robert Mugabe branch closed; FBC Crown Bank has 2 branches"),
    (r"^(standard chartered|crown bank)", (255, 5), 40, "Standard Chartered 106 Jason Moyo closed (FBC Crown Bank has 2 branches)"),
    (r"^zb\b", (-242, 238), 30, "no ZB service centre at Zimbank House (ZB branch locator); TV Sales & Home factory shop there"),
    (r"^barclays", None, 0, "Barclays Zimbabwe became First Capital Bank in 2019"),
    (r"^galito", None, 0, "Galito's does not operate in Zimbabwe"),
    (r"^herald( zimpapers)?$", (-110, 70), 45, "same building as the researched Herald House sign"),
    (r"^(econet shop|econet)$", (-230, 70), 25, "Econet House is added from research (merged)"),
    (r"^ok$", (-152, -182), 40, "Overture 'OK, Union Ave' pin 480 m east of OK Kwame Nkrumah (researched, b1283): same store"),
    (r"^barbour'?s", (-211, 133), 40, "Barbours left the First St / Jason Moyo corner; the building is Galaxy Mall (Herald)"),
    (r"^rainbow city cinema", (-106, 125), 40, "Rainbow City Cinema is at 99 Park Lane (cinematreasures.org/theaters/26158), "
                                              "not on Jason Moyo; current status uncertain"),
    (r"^ster ?kinekor eastgate", None, 0, "Overture pin on Fourth St; the OSM 'Ster Kinekor' point by Eastgate is kept "
                                          "(moviebuff.com lists the Eastgate cinema as closed: unconfirmed)"),
]


def resolve_at(at, city):
    kind = at[0]
    if kind == "xz":
        return at[1], at[2], None
    if kind == "ll":
        x, z = proj(at[2], at[1])
        return x, z, None
    if kind == "b":
        r = city.by_index[at[1]]
        return r["cx"], r["cz"], r["i"]
    if kind == "lm":
        for r in city.buildings:
            if r["b"].get("lm") == at[1]:
                return r["cx"], r["cz"], r["i"]
        raise KeyError(at[1])
    if kind == "cnrb":
        # the corner of building at[3] nearest to the junction of streets at[1] x at[2]
        ga, gb = group_of_roadname(at[1]), group_of_roadname(at[2])
        res = city.corner(ga, gb)
        rec = city.by_index[at[3]]
        if not res:
            return rec["cx"], rec["cz"], rec["i"]
        (jx, jz), _ = res
        best = None
        ring = rec["ring"]
        for k in range(len(ring)):
            d, qx, qz, _t = seg_dist(jx, jz, *ring[k], *ring[(k + 1) % len(ring)])
            if best is None or d < best[0]:
                best = (d, qx, qz)
        _, qx, qz = best
        # step 2 m toward the centroid so the point is inside the footprint
        dx, dz = rec["cx"] - qx, rec["cz"] - qz
        L = math.hypot(dx, dz) or 1
        return qx + dx / L * 2, qz + dz / L * 2, rec["i"]
    if kind == "cnr":
        ga, gb = group_of_roadname(at[1]), group_of_roadname(at[2])
        res = city.corner(ga, gb)
        if not res:
            raise KeyError(f"no corner {at[1]} x {at[2]}")
        (cx, cz), allc = res
        if len(at) > 4:
            cx, cz = allc[at[4]] if isinstance(at[4], int) else (cx, cz)
        bearing = {"ne": 31, "se": 121, "sw": 211, "nw": 301}[at[3]]
        d = 26.0
        x = cx + math.sin(math.radians(bearing)) * d
        z = cz - math.cos(math.radians(bearing)) * d
        return x, z, None
    raise ValueError(at)


def curated_candidates(city, report):
    out = []
    for i, e in enumerate(CURATED):
        x, z, bfix = resolve_at(e["at"], city)
        bkey = e.get("brand") or brand_of(e["name"])
        name = e.get("sign") or (BRANDS[bkey]["name"] if bkey and not e.get("keep_name") else e["name"])
        c = {"src": "curated", "sid": str(i), "name": name, "x": x, "z": z, "conf": 1.0, "addr": e.get("addr"),
             "brand": bkey, "cat": e.get("cat") or (BRANDS[bkey]["cat"] if bkey else "retail"), "verified": "web",
             "evidence": e.get("evidence"), "floor": e.get("floor", 0), "face": e.get("face"), "kind": e.get("kind"),
             "tower": e.get("tower", False), "faces": e.get("faces", 2), "sub": e.get("sub"), "bfix": bfix,
             "style": e.get("style"), "big": e.get("big"), "vertical": e.get("vertical")}
        st, corner, _ = streets_in_address(e.get("addr"))
        c["addr_streets"] = [g for g in st if g in city.group_segs]
        out.append(c)
    report["curated"] = len(out)
    return out


def apply_removals(cands, report):
    n = 0
    out = []
    for c in cands:
        hit = False
        if c["src"] != "curated":
            for pat, pos, rad, _why in REMOVE:
                if re.search(pat, c["name"], re.I) or re.search(pat, c.get("raw") or "", re.I):
                    if pos is None or math.hypot(c["x"] - pos[0], c["z"] - pos[1]) <= rad:
                        hit = True
                        break
        if hit:
            n += 1
        else:
            out.append(c)
    report["removed"] = n
    return out


# ------------------------------------------------------------------------------------------ candidates
MALL_ADDR = re.compile(r"\b(joina city|eastgate|kwame mall|ximex|shasha mall|gulf complex|cameron mall|summer city mall|"
                       r"lapf|margolis plaza|jp shopping mall|j-mall|galaxy mall|orange mall|shoppers city mall|"
                       r"karigamombe centre|construction house|angwa city|builders home mall|kaguvi parts plaza|"
                       r"139 chinhoyi street mall|copacabana mall|charter house|sunflowers building)\b", re.I)
UPPER_FLOOR = re.compile(r"\b(\d{1,2})\s*(st|nd|rd|th)\s*floor\b|\b(first|second|third|fourth|fifth|sixth|seventh|eighth|"
                         r"ninth|tenth|eleventh|twelfth|top)\s+floor\b|\bfloor\s*(\d{1,2})\b|\bsuite\b|\broom\s*\d|"
                         r"\boffice\s*(no\.?|number)?\s*\d|\bmezzanine\b|\bbasement\b", re.I)
ORD = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9,
       "tenth": 10, "eleventh": 11, "twelfth": 12, "top": 9}


def floor_of(addr):
    if not addr:
        return 0
    m = UPPER_FLOOR.search(addr)
    if not m:
        return 0
    if m.group(1):
        return int(m.group(1))
    if m.group(3):
        return ORD[m.group(3).lower()]
    if m.group(4):
        return int(m.group(4))
    return 1  # suite / room / office no.: upstairs


def categorize(c):
    """Output category for a candidate (or None to drop)."""
    name = c["name"]
    cat = None
    if c["src"] == "osm":
        for k, v in c.get("osm", {}).items():
            if (k, v) in OSM_CAT:
                cat = OSM_CAT[(k, v)]
                if cat is None:
                    return None
                break
            if k == "office" and cat is None:
                cat = "office"
            if k == "shop" and cat is None:
                cat = "retail"
            if k == "craft" and cat is None:
                cat = "retail"
            if k == "healthcare" and cat is None:
                cat = "clinic"
    elif c["src"] == "overture":
        basic = c.get("basic") or ""
        if basic in OVERTURE_CAT:
            cat = OVERTURE_CAT[basic]
            if cat is None:
                return None
        tax = c.get("tax") or ""
        if tax in OVERTURE_CAT and OVERTURE_CAT[tax]:
            cat = OVERTURE_CAT[tax] if cat in (None, "retail", "office", "clinic") else cat
        hier = " ".join(c.get("hier") or [])
        if "bank" in tax and "bank" in name.lower():
            cat = "bank"
        if re.search(r"supermarket|grocery_store", tax):
            cat = "supermarket" if re.search(r"super|market|pick|spar|ok\b|choppies|world", name, re.I) else "grocery"
        if "liquor" in tax:
            cat = "liquor"
        if "bakery" in tax:
            cat = "bakery"
        if "fast_food" in hier or "fast_food" in tax:
            cat = "fast_food"
    # name keywords refine generic categories
    generic = cat in (None, "retail", "office", "shopping", "clinic", "electronics", "grocery", "fast_food", "restaurant", "finance")
    for pat, kcat in NAME_CAT:
        if re.search(pat, name, re.I):
            if cat is None or (generic and not (cat == "restaurant" and kcat == "fast_food")
                               and not (cat == "electronics" and kcat in ("retail",))
                               and not (cat == "clinic" and kcat in ("pharmacy",) and False)):
                if cat in ("office",) and kcat in ("mall", "school", "church", "travel", "printing", "insurance",
                                                   "clinic", "hotel", "funeral", "finance"):
                    cat = kcat
                elif cat in (None, "retail", "shopping", "grocery", "finance", "electronics", "clinic") and kcat not in ("mall",):
                    cat = kcat
            break
    return cat


def collect(args, city, report):
    cands = []
    if args.overture:
        for c in load_overture(args.overture):
            cands.append(c)
    osm_paths = [args.osm, args.osm_pois]
    for c in load_osm_pois(osm_paths):
        cands.append(c)
    # OSM building footprints in harare.json that carry a business name (OK Supermarket, Bata, Jet...)
    for rec in city.buildings:
        nm = rec["b"].get("name")
        if nm and brand_of(nm):
            cands.append({"src": "building", "sid": f"b{rec['i']}", "name": nm, "x": rec["cx"], "z": rec["cz"],
                          "conf": 0.95, "addr": None, "bfix": rec["i"], "cls": rec["b"].get("cls")})
    report["raw"] = Counter(c["src"] for c in cands)
    return cands


def clean(cands, city, report):
    drop = Counter()
    out = []
    # geocoder stacks: >= 3 Overture places within 2 m of one another
    stack = defaultdict(list)
    for c in cands:
        if c["src"] == "overture":
            stack[(round(c["x"] / 2), round(c["z"] / 2))].append(c)
    for key, grp in stack.items():
        if len(grp) < 3:
            continue
        good = 0
        nums = set()
        for c in grp:
            st, _, num = streets_in_address(c.get("addr"))
            if num is not None:
                nums.add(num)
            if any(city.street_dist(g, c["x"], c["z"])[0] < 60 for g in st if g in city.group_segs):
                good += 1
        # a geocoder guess: unrelated addresses, or one street with different house numbers
        if good / len(grp) < 0.5 or len(nums) >= 2:
            for c in grp:
                c["stack"] = True
    for c in cands:
        x, z = c["x"], c["z"]
        if not in_box(x, z, REGION):
            drop["outside"] += 1
            continue
        if c.get("stack"):
            drop["stack"] += 1
            continue
        addr = c.get("addr") or ""
        if addr and (ELSEWHERE.search(addr) or TOWN_CHINHOYI.search(addr)):
            drop["elsewhere"] += 1
            continue
        if c["src"] != "curated" and c.get("name") and ELSEWHERE.search(c["name"]):
            drop["elsewhere"] += 1  # "Bulawayo City Center", "Troutbeck Hotel, Nyanga"...
            continue
        raw = c.get("name")
        bkey = brand_of(raw or "", c.get("brand_raw"))
        name = BRANDS[bkey]["name"] if bkey else clean_name(raw)
        if not name:
            drop["junk_name"] += 1
            continue
        c["name"] = name
        c["raw"] = raw
        c["brand"] = bkey
        if bkey:
            c["cat"] = BRANDS[bkey]["cat"]
        else:
            c["cat"] = categorize(c)
        if not c["cat"]:
            drop["no_cat"] += 1
            continue
        if c["src"] != "curated" and name_key(name) in city.place_names:
            drop["street_name"] += 1  # "First Street Mall", "Harare Gardens"...: a place, not a business
            continue
        if c["src"] == "overture" and bkey and c["conf"] < 0.6 and not addr:
            drop["low_conf"] += 1
            continue
        if c["src"] == "overture":
            conf = c["conf"]
            minc = 0.45 if (bkey or c["cat"] not in BOARD_CATS) else 0.7
            if "Overture,meta" != ",".join(c.get("datasets", [])) and "meta" not in c.get("datasets", []):
                minc -= 0.1  # AllThePlaces / Microsoft / Foursquare records are chain / curated feeds
            if conf < minc:
                drop["low_conf"] += 1
                continue
        c["floor"] = floor_of(addr)
        c["in_mall"] = bool(MALL_ADDR.search(addr)) and bool(re.search(r"\b(shop|stand|stall|unit|booth)\s*(no\.?)?\s*\w*\d", addr, re.I))
        out.append(c)
    report["drop_clean"] = drop
    return out


def check_address(c, city):
    """Validates / corrects the position from the address. Returns status string."""
    st, corner, num = streets_in_address(c.get("addr"))
    known = [g for g in st if g in city.group_segs]
    c["addr_streets"] = known
    if not known:
        return "none"
    x, z = c["x"], c["z"]
    if corner and len(known) >= 2:
        res = city.corner(known[0], known[1], near=(x, z))
        if res:
            (cx, cz), allc = res
            d = math.hypot(cx - x, cz - z)
            da = city.street_dist(known[0], x, z)[0]
            db = city.street_dist(known[1], x, z)[0]
            if d <= 75 or (d <= 160 and max(da, db) <= 90):  # big corner sites (hotels, malls) sit far from the junction
                c["corner"] = (cx, cz)
                return "ok"
            if d > 1200:
                return "mismatch"  # a far-away pin with a CBD corner address: probably a head-office address
            c["moved_from"] = (x, z)
            # which of the four corner blocks is unknown: lean 8 m toward the original pin
            c["x"], c["z"] = cx + (x - cx) / d * 8, cz + (z - cz) / d * 8
            c["corner"] = (cx, cz)
            return "moved"
    d0 = city.street_dist(known[0], x, z)[0]
    dmin = min(city.street_dist(g, x, z)[0] for g in known)
    if d0 <= 60 or dmin <= 45:
        return "ok"
    if dmin <= 120:
        return "near"
    return "mismatch"


# "<word> Road/Drive/Close/..." in an address: the street the business is really on
ADDR_STREET = re.compile(r"(?:([a-z0-9][a-z0-9'.-]*)\s+)?([a-z][a-z'-]+)\s+(?:road|rd|drive|dr|close|crescent|cres|lane|ln|"
                         r"avenue|ave|av|street|str|st|way|place|pl)\b")
ADDR_FILLER = {"opposite", "opp", "along", "off", "near", "in", "at", "on", "the", "of", "cnr", "corner", "crn", "and", "no",
               "number", "shop", "stand", "stall", "unit", "floor", "behind", "next", "to", "between", "btwn", "harare",
               "cbd", "avenue", "ave", "street", "st", "road", "rd", "zimbabwe", "house", "building", "mall", "centre"}
ADDR_NOT_STREET = {"of", "the", "and", "mall", "house", "centre", "center", "building", "floor", "complex", "plaza", "court",
                   "tower", "towers", "shop", "hotel", "hospital", "college", "school", "church", "cnr", "corner", "harare",
                   "along", "off", "near", "opposite", "opp", "via", "same", "this", "that", "our", "your"}


def _lev(a, b, cap=3):
    """Levenshtein distance (early exit above cap)."""
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) > cap:
            return cap + 1
        prev = cur
    return prev[-1]


# distinctive words of CBD street names; a (mis)spelling of one ('Chimhoyi', 'Julias Nyerere', 'Kwame Nkruma',
# 'Rizende', 'Samora Macheal', 'J.Moyo') means the address is in town even when streets_in_address missed it
_GENERIC_STREET_WORDS = {"george", "street", "avenue", "road", "harare", "park", "bank", "market", "union", "central",
                         "south", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "victoria",
                         "baker", "stanley", "gordon", "railway", "charter", "enterprise", "luck", "bute", "forbes",
                         "rhodes", "pioneer", "kingsway", "manica", "jameson", "wayne", "albion", "raleigh", "abercorn",
                         "livingstone", "five", "fife", "selous", "baines", "mayor", "battle", "ranch", "legacy",
                         "liberation", "terrace", "lane", "mall", "simon", "vengai", "john", "landa", "prince", "edward",
                         "guy", "clutton", "brock", "ahmed", "bella", "oliver", "jomo", "abdel", "gamal", "fidel",
                         "joseph", "julia", "herbert", "leonid", "sir", "moffat", "speak", "extension", "street mall"}
CBD_WORDS = sorted({w for names in STREETS.values() for n in names for w in re.split(r"[^a-z]+", n)
                    if len(w) >= 4 and w not in _GENERIC_STREET_WORDS})


def names_cbd_street(addr):
    for t in set(re.split(r"[^a-z]+", norm_street(addr))):
        if len(t) < 4:
            continue
        for w in CBD_WORDS:
            lim = 0 if len(w) <= 4 else (1 if len(w) <= 6 else 2)
            if abs(len(t) - len(w)) <= lim and _lev(t, w, lim) <= lim:
                return True
    return False


def foreign_street(c, city):
    """True when an address that names no CBD street names a street that is not near the point (a suburb
    address geocoded to the city centre: 'King George Road 4', 'Clyde Road', '179 Fisher Avenue')."""
    a = norm_street(c.get("addr"))
    if not a or names_cbd_street(a):
        return False
    if not hasattr(city, "_street_words"):
        idx = defaultdict(set)
        for g in city.group_segs:
            idx[g].add(g)
        for gid, names in STREETS.items():
            for n in names:
                if gid in city.group_segs:
                    idx[n].add(gid)
        city._street_words = [(set(k.replace("-", " ").split()), gs) for k, gs in idx.items()]
    named = False
    for m in ADDR_STREET.finditer(a):
        prev, w = m.group(1), m.group(2)
        if w in ADDR_NOT_STREET:
            continue
        words = [w] if (not prev or prev in ADDR_FILLER or re.search(r"\d", prev)) else [prev, w]
        named = True
        groups = set()
        for ws, gs in city._street_words:
            if all(x in ws for x in words):
                groups |= gs
        if any(city.street_dist(g, c["x"], c["z"])[0] <= 150 for g in groups):
            return False
    return named


def validate(cands, city, report):
    drop = Counter()
    status = Counter()
    out = []
    for c in cands:
        if c["src"] == "curated":
            out.append(c)
            continue
        s = check_address(c, city)
        if s == "none" and c["src"] == "overture" and foreign_street(c, city):
            s = "foreign"
        c["addr_status"] = s
        status[s] += 1
        if s in ("mismatch", "foreign") and c["src"] == "overture" and not c.get("brand"):
            drop["addr_" + s] += 1
            continue
        if s in ("mismatch", "foreign") and c["src"] == "overture" and c.get("brand"):
            # chains often list the head-office address: keep the point only if it sits on a mapped building
            if not city.building_at(c["x"], c["z"]):
                drop["addr_" + s] += 1
                continue
        out.append(c)
    report["addr_status"] = status
    report["drop_validate"] = drop
    return out


SRC_RANK = {"curated": 5, "osm": 3, "building": 3.5, "overture": 1}


def dedupe(cands, report):
    """Same brand / normalised name within 40 m -> one entry (best source wins, fields merged)."""
    def rank(c):
        r = SRC_RANK[c["src"]] + (c.get("conf") or 0)
        if c.get("addr_status") == "ok":
            r += 0.6
        if c.get("addr_status") == "moved":
            r += 0.2
        if c["src"] == "osm" and c.get("way"):
            r += 0.4
        return r
    cands.sort(key=lambda c: -rank(c))
    kept = []
    grid = Grid(50.0)
    merged = 0
    for c in cands:
        key = c.get("brand") or name_key(c["name"])
        dup = None
        for k in grid.near(c["x"], c["z"], 125):
            kk = k.get("brand") or name_key(k["name"])
            if kk == key or (len(key) > 5 and len(kk) > 5 and (key in kk or kk in key)):
                lim = 80 if (c.get("brand") or c["src"] == "curated") else (120 if len(key) >= 6 else 45)
                if c["src"] == "curated" and k["src"] == "curated":
                    # two researched branches of one chain can be neighbours; towers + fascias coexist
                    if c["name"] != k["name"] or c.get("tower") != k.get("tower"):
                        continue
                    lim = 12
                if math.hypot(k["x"] - c["x"], k["z"] - c["z"]) <= lim:
                    dup = k
                    break
        if dup:
            merged += 1
            for f in ("addr", "web"):
                if not dup.get(f) and c.get(f):
                    dup[f] = c[f]
            dup.setdefault("also", []).append(f"{c['src']}:{c['sid']}")
            continue
        kept.append(c)
        grid.add(c, c["x"], c["x"], c["z"], c["z"])
    report["dedupe_merged"] = merged
    return kept


# ------------------------------------------------------------------------------------------ placement
FONT_W = {"bold-sans": 0.60, "condensed": 0.44, "serif": 0.58, "script": 0.52}  # glyph advance / cap height
BIG_CATS = {"supermarket", "department", "wholesale", "mall", "hotel", "bank", "furniture", "cinema"}


def floor_height(b):
    """Ground-floor height as src/world/buildings.js floorsOf() computes it (flat roofs)."""
    h = b["h"]
    top = max(2.6, h - (0.8 if h > 6 else 0.3))
    fl = max(1, b.get("fl") or round(top / 3.3))
    fh = top / fl
    if fh < 2.7 or fh > 4.6:
        fl = max(1, round(top / 3.4))
        fh = top / fl
    return fh, fl


def sign_box(c, style, bld, facade_len):
    """(w, h, y, kind) of the sign for candidate c on building record bld."""
    kind = c.get("kind") or style["kind"]
    text = c["name"]
    n = max(3, len(text))
    ff = FONT_W.get(style["font"], 0.58)
    b = bld["b"]
    fh, fl = floor_height(b)
    if kind == "tower" and c.get("vertical"):
        lh = max(2.2, min(4.0, b["h"] * 0.05))  # letter height; letters stacked top to bottom
        h = n * lh * 1.15
        return lh * 1.1, h, max(fh + 3, b["h"] - h - 2.0), kind
    if kind == "tower":
        h = max(2.2, min(5.0, b["h"] * 0.055))
        w = min(facade_len * 0.85, n * ff * h + h)
        h = min(h, w / (n * ff) * 1.0 + 0.2)
        y = max(fh + 3, b["h"] - h - 1.2)
        return w, h, y, kind
    if kind == "board":
        return 0.9, 0.6, 1.25, kind
    if kind == "blade":
        if c["cat"] == "fuel":
            return 1.6, 2.4, 3.2, kind  # totem: 1.6 m wide panel on a pole, bottom at 3.2 m
        return 0.7, 1.7, max(2.5, min(fh - 0.1, b["h"] - 0.4) - 1.7), kind
    big = c["cat"] in BIG_CATS or c.get("big") or (c.get("brand") and BRANDS[c["brand"]]["big"])
    h = 1.2 if big else (1.0 if (c.get("brand") or kind == "lightbox") else 0.85)
    cap = 16.0 if c["cat"] in ("supermarket", "department", "wholesale", "mall") else (10.0 if big or c.get("brand") else 8.0)
    w = n * ff * h * 0.95 + 0.7 * h
    w = max(2.2 if kind != "lightbox" else 1.6, min(cap, w))
    if kind == "awning":
        w = max(w, 4.0)
        h = 0.9
    w = min(w, max(1.6, facade_len - 0.8))
    if b["h"] < 5.2 or fl == 1:
        y = max(2.3, min(3.2, b["h"] - h - 0.2))
    else:
        y = max(2.9, min(3.4, fh - h - 0.1))
    if kind == "painted":
        y = max(2.3, min(y, b["h"] - h - 0.3))
    if kind == "awning":
        y = min(y, 2.5)  # the fabric band hangs just above the door head
    return w, h, y, kind


def choose_building(c, city):
    """Building whose facade carries the sign: the fixed / containing building if it has a street
    frontage, else the nearest one that has; set-back frontages (forecourts, podiums) only as a fallback."""
    setback = c["src"] == "curated" or c["cat"] in ("hotel", "fuel", "mall", "supermarket", "department", "bank") \
        or bool(c.get("tower"))
    tower = bool(c.get("tower"))
    if c.get("bfix") is not None and c["bfix"] in city.by_index:
        rec = city.by_index[c["bfix"]]
        if city.any_facades(rec, True, tower):
            return rec
    x, z = c["x"], c["z"]
    rec = city.building_at(x, z)
    if rec and city.facades(rec):
        return rec
    # nearest building with a street facade (the point often sits on the pavement / in the road)
    for d, r in city.buildings_near(x, z, 30.0 if c["src"] != "curated" else 45.0):
        if r["b"]["h"] < 2.6 or r["area"] < 15:
            continue
        if city.facades(r):
            return r
    if setback:
        if rec and city.any_facades(rec, True, tower):
            return rec
        for d, r in city.buildings_near(x, z, 45.0):
            if r["b"]["h"] >= 2.6 and r["area"] >= 15 and city.any_facades(r, True, tower):
                return r
    return None


def choose_facades(c, rec, city):
    """Facades of rec ranked for candidate c (best first): [(score, facade, t_along)]."""
    x, z = c["x"], c["z"]
    want = set(c.get("addr_streets") or [])
    if c.get("face"):
        want = {group_of_roadname(c["face"])} | ({c["face"]} if c["face"] in STREETS else set())
    out = []
    facs = list(city.any_facades(rec, True, bool(c.get("tower"))))
    if c.get("face") and not any(f["street"]["ref"]["group"] in want for f in facs):
        # the researched frontage may be set back behind a forecourt / plaza: look further
        facs += [f for f in city.facades(rec, relaxed=1) + city.facades(rec, relaxed=2)
                 if f["street"]["ref"]["group"] in want]
    for f in facs:
        d, qx, qz, t = seg_dist(x, z, f["ax"], f["az"], f["bx"], f["bz"])
        g = f["street"]["ref"]["group"]
        score = d
        if want:
            score += -12 if g in want else 22
        if not f["street"]["ref"]["name"]:
            score += 30  # unnamed carriageway (rare outside service lanes)
        if f["street"]["ref"]["mall"]:
            score -= 3  # the pedestrian malls are the busiest shopfronts
        if c["cat"] in BIG_CATS:
            score -= min(f["len"], 40) * 0.15
        out.append((score, f, t * f["len"]))
    if c.get("face"):
        # a researched frontage wins even over a closer / longer one (set-back hotels: Bronte)
        out.sort(key=lambda o: (o[1]["street"]["ref"]["group"] not in want, o[0]))
    else:
        out.sort(key=lambda o: o[0])
    return out


def pack(items, L, gap=0.45, margin=0.35):
    """1D packing of signs on one facade line. items: dicts with 'pos' (wanted centre), 'w', 'prio'.
    Returns (kept, dropped); kept items get 'pos' adjusted so they don't overlap."""
    items = sorted(items, key=lambda i: -i["prio"])
    kept = []
    dropped = []
    for it in items:
        need = sum(k["w"] for k in kept) + it["w"] + gap * len(kept) + 2 * margin
        if need <= L:
            kept.append(it)
        else:
            dropped.append(it)
    kept.sort(key=lambda i: i["pos"])
    n = len(kept)
    for i, it in enumerate(kept):
        lo = margin + it["w"] / 2
        if i:
            lo = max(lo, kept[i - 1]["pos"] + (kept[i - 1]["w"] + it["w"]) / 2 + gap)
        it["pos"] = max(it["pos"], lo)
    for i in range(n - 1, -1, -1):
        it = kept[i]
        hi = L - margin - it["w"] / 2
        if i < n - 1:
            hi = min(hi, kept[i + 1]["pos"] - (kept[i + 1]["w"] + it["w"]) / 2 - gap)
        it["pos"] = min(it["pos"], hi)
    return kept, dropped


def priority(c):
    p = {"curated": 100, "building": 70, "osm": 60, "overture": 30}[c["src"]]
    if c.get("brand"):
        p += 25
    if c["src"] == "overture":
        p += 20 * (c.get("conf") or 0)
        if c.get("addr_status") == "ok":
            p += 8
    if c["cat"] in BOARD_CATS:
        p -= 25
    if in_box(c["x"], c["z"], CORE):
        p += 5
    if c.get("floor", 0) > 0:
        p -= 10
    return p


def place_all(cands, city, report):
    drop = Counter()
    lanes = defaultdict(list)  # (building i, facade k, layer) -> items
    towers = []
    for c in cands:
        style_key = c.get("style") or (BRANDS[c["brand"]]["style"] if c.get("brand") else generic_style(c))
        c["style"] = style_key
        style = STYLES[style_key]
        if c.get("in_mall") and not c.get("brand") and c["src"] != "curated":
            drop["mall_interior"] += 1
            continue
        rec = choose_building(c, city)
        if not rec:
            drop["no_facade"] += 1
            continue
        ranked = choose_facades(c, rec, city)
        if not ranked:
            drop["no_facade"] += 1
            continue
        c["_rec"] = rec
        c["_ranked"] = ranked
        c["prio"] = priority(c)
        if c.get("tower"):
            towers.append(c)
            continue
        upstairs = c.get("floor", 0) > 0 or c["cat"] in BOARD_CATS
        if c["src"] == "curated":
            layer = "board" if c.get("kind") == "board" else "fascia"
        elif c.get("floor", 0) > 0:
            layer = "board"  # offices upstairs (a chain's head office included): name plate at the entrance
        else:
            layer = "board" if (upstairs and not c.get("brand")) or c.get("kind") == "board" else "fascia"
        if layer == "board":
            c["kind"] = "board"
        if c["cat"] == "fuel" and not c.get("kind"):
            c["kind"] = "blade"  # forecourt price pylon / totem (see BUSINESSES.md)
        score, f, t = ranked[0]
        w, h, y, kind = sign_box(c, style, rec, f["len"])
        lanes[(rec["i"], f["k"], layer)].append({"c": c, "pos": t, "w": w if kind != "blade" else 0.35, "prio": c["prio"],
                                                  "f": f, "rank": 0, "box": (w, h, y, kind)})
        # corner sites of researched chains carry the name on both frontages
        corner = c["src"] == "curated" and layer == "fascia" and kind != "blade" and (
            len(c.get("addr_streets") or []) >= 2 or re.search(r"\bcnr\b|corner", c.get("addr") or "", re.I))
        if corner:
            g0 = f["street"]["ref"]["group"]
            for sc2, f2, t2 in ranked[1:]:
                g2 = f2["street"]["ref"]["group"]
                if g2 and g2 != g0 and f2["len"] >= 4 and sc2 < score + 30 and not f2.get("setback"):
                    w2, h2, y2, k2 = sign_box(c, style, rec, f2["len"])
                    lanes[(rec["i"], f2["k"], layer)].append({"c": c, "pos": t2, "w": w2, "prio": c["prio"] - 1, "f": f2,
                                                               "rank": 99, "box": (w2, h2, y2, k2)})
                    break
    placed = []
    # pack each facade; overflow tries the next-best facade of the same building (twice at most)
    for rnd in range(4):
        overflow = []
        for key, items in list(lanes.items()):
            if not items:
                continue
            f = items[0]["f"]
            kept, dropped = pack(items, f["len"], gap=0.5 if key[2] == "fascia" else 1.2)
            lanes[key] = []
            placed.extend(kept)
            for it in dropped:
                c = it["c"]
                nxt = it["rank"] + 1
                if rnd < 3 and it["rank"] != 99 and nxt < len(c["_ranked"]) and c["_ranked"][nxt][0] < c["_ranked"][0][0] + 35:
                    score, f2, t2 = c["_ranked"][nxt]
                    w, h, y, kind = sign_box(c, STYLES[c["style"]], c["_rec"], f2["len"])
                    overflow.append(((c["_rec"]["i"], f2["k"], key[2]),
                                     {"c": c, "pos": t2, "w": w if kind != "blade" else 0.35, "prio": it["prio"], "f": f2,
                                      "rank": nxt, "box": (w, h, y, kind)}))
                else:
                    drop["facade_full"] += 1
        # re-pack facades that received overflow together with what is already placed there
        if not overflow:
            break
        byk = defaultdict(list)
        for k, it in overflow:
            byk[k].append(it)
        for k, its in byk.items():
            already = [p for p in placed if (p["c"]["_rec"]["i"], p["f"]["k"], "board" if p["box"][3] == "board" else "fascia") == k]
            for p in already:
                placed.remove(p)
            lanes[k] = already + its
    # towers: the facade(s) facing the widest named streets, one sign per facade (max 2)
    for c in towers:
        rec = c["_rec"]
        facs = [f for _, f, _ in c["_ranked"]]
        if c.get("face"):
            facs.sort(key=lambda f: 0 if f["street"]["ref"]["group"] == group_of_roadname(c["face"]) else 1)
        else:
            facs.sort(key=lambda f: -(f["street"]["ref"]["w"] + f["len"] * 0.3))
        n = 0
        used_dirs = []
        for f in facs:
            if f["len"] < 8:
                continue
            if any(f["nx"] * ux + f["nz"] * uz > 0.7 for ux, uz in used_dirs):
                continue
            w, h, y, kind = sign_box(c, STYLES[c["style"]], rec, f["len"])
            placed.append({"c": c, "pos": f["len"] / 2, "w": w, "prio": c["prio"], "f": f, "rank": 0, "box": (w, h, y, "tower")})
            used_dirs.append((f["nx"], f["nz"]))
            n += 1
            if n >= c.get("faces", 2):
                break
    report["drop_place"] = drop
    return placed


# ------------------------------------------------------------------------------------------ output
def build_output(placed, city, report):
    shops = []
    ids = Counter()
    for p in placed:
        c = p["c"]
        f = p["f"]
        w, h, y, kind = p["box"]
        t = p["pos"]
        ax = f["ax"] + f["ex"] * t
        az = f["az"] + f["ez"] * t
        base = re.sub(r"[^a-z0-9]+", "-", c["name"].lower()).strip("-")[:28] or "shop"
        ids[base] += 1
        sid = base if ids[base] == 1 else f"{base}-{ids[base]}"
        ref = f["street"]["ref"]
        ahead, _t = city.street_ahead(ax + f["nx"] * 0.3, az + f["nz"] * 0.3, f["nx"], f["nz"])
        e = {
            "id": sid, "name": c["name"], "cat": c["cat"],
        }
        if c.get("brand"):
            e["brand"] = c["brand"]
        e.update({
            "style": c["style"], "b": c["_rec"]["i"], "x": r1(ax), "z": r1(az), "nx": r3(f["nx"]), "nz": r3(f["nz"]),
            # along = reading direction for someone facing the sign = (nz, -nx)
            "ax": r3(f["nz"]), "az": r3(-f["nx"]), "w": r1(w), "y": r1(y), "h": r1(h), "floor": c.get("floor", 0),
            "road": ahead or ref["name"] or ("First Street Mall" if ref["mall"] else ""),
        })
        if kind != STYLES[c["style"]]["kind"]:
            e["kind"] = kind
        if kind == "blade" and c["cat"] == "fuel":
            # forecourt totem: stands `off` metres in front of the facade (near the kerb), facing the street
            e["off"] = r1(max(1.0, min(25.0, f["street"]["avail"] - 1.2)))
        if c.get("vertical"):
            e["vertical"] = 1
        if c.get("sub"):
            e["sub"] = c["sub"]
        if c.get("addr"):
            e["addr"] = re.sub(r"\s+", " ", norm_text(c["addr"]))[:90]
        e["verified"] = "web" if c.get("verified") == "web" else "mapped"
        src = c["src"] if c["src"] != "overture" else "overture"
        e["src"] = f"{src}:{c['sid']}"
        if c.get("evidence"):
            e["ev"] = c["evidence"]
        shops.append(e)
    shops.sort(key=lambda s: (s["b"], s["x"], s["z"]))
    return shops


def draw_preview(path, shops, city, box, scale=2.0, labels=True):
    from PIL import Image, ImageDraw, ImageFont
    x0, x1, z0, z1 = box
    W, H = int((x1 - x0) * scale), int((z1 - z0) * scale)
    im = Image.new("RGB", (W, H), (250, 250, 247))
    dr = ImageDraw.Draw(im)

    def P(x, z):
        return ((x - x0) * scale, (z - z0) * scale)
    for s in city.segs:
        ref = s["ref"]
        col = (205, 205, 215) if ref["service"] else ((190, 225, 190) if ref["mall"] else (175, 175, 185))
        wdt = max(1, int(ref["w"] * scale * (0.5 if ref["service"] else 1)))
        dr.line([P(s["ax"], s["az"]), P(s["bx"], s["bz"])], fill=col, width=wdt)
    for r in city.buildings:
        if r["maxx"] < x0 or r["minx"] > x1 or r["maxz"] < z0 or r["minz"] > z1:
            continue
        dr.polygon([P(x, z) for x, z in r["ring"]], fill=(222, 218, 210), outline=(150, 145, 140))
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", max(9, int(4.5 * scale)))
        small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", max(8, int(3.6 * scale)))
    except Exception:  # noqa: BLE001
        font = small = ImageFont.load_default()
    # street names
    done = set()
    for s in city.segs:
        nm = s["ref"]["name"]
        if not nm or s["ref"]["service"]:
            continue
        mx, mz = (s["ax"] + s["bx"]) / 2, (s["az"] + s["bz"]) / 2
        if not (x0 < mx < x1 and z0 < mz < z1):
            continue
        k = (nm, int(mx // 150), int(mz // 150))
        if k in done or math.hypot(s["bx"] - s["ax"], s["bz"] - s["az"]) < 25:
            continue
        done.add(k)
        dr.text(P(mx, mz), nm.replace(" Street", " St").replace(" Avenue", " Ave"), fill=(40, 90, 200), font=small)
    for e in shops:
        if not (x0 < e["x"] < x1 and z0 < e["z"] < z1):
            continue
        st = STYLES[e["style"]]
        col = tuple(int(st["bg"][i:i + 2], 16) for i in (1, 3, 5))
        hw = e["w"] / 2
        a = P(e["x"] - e["ax"] * hw, e["z"] - e["az"] * hw)
        b = P(e["x"] + e["ax"] * hw, e["z"] + e["az"] * hw)
        kind = e.get("kind", st["kind"])
        off = 1.2 if kind != "tower" else 2.5
        a2 = (a[0] + e["nx"] * off * scale, a[1] + e["nz"] * off * scale)
        b2 = (b[0] + e["nx"] * off * scale, b[1] + e["nz"] * off * scale)
        dr.polygon([a, b, b2, a2], fill=col, outline=(0, 0, 0))
        tip = P(e["x"] + e["nx"] * 3.5, e["z"] + e["nz"] * 3.5)
        dr.line([P(e["x"], e["z"]), tip], fill=(200, 0, 0) if e["verified"] == "web" else (90, 90, 90), width=1)
        if labels and (labels == "all" or e["verified"] == "web" or e.get("brand") or kind == "tower"):
            lx, lz = P(e["x"] + e["nx"] * 5, e["z"] + e["nz"] * 5)
            txt = e["name"][:22] + ("*" if e["verified"] == "web" else "")
            tw = dr.textlength(txt, font=font)
            if abs(e["nx"]) > abs(e["nz"]):
                lx = lx if e["nx"] > 0 else lx - tw
            else:
                lx -= tw / 2
                lz = lz if e["nz"] > 0 else lz - 5 * scale
            dr.text((lx, lz), txt, fill=(160, 0, 0) if e["verified"] == "web" else (20, 20, 20), font=font)
    im.save(path)


def write_verified_table(path, shops):
    """BUSINESSES.md section 7: one row per CURATED entry (# = index + 1), with where its sign(s) ended up."""
    by = defaultdict(list)
    for sh in shops:
        if sh["src"].startswith("curated:"):
            by[int(sh["src"].split(":")[1])].append(sh)
    rows = ["| # | Sign | Category | Where (address as researched) | Facade(s) face | `b` | Evidence |",
            "|---|---|---|---|---|---|---|"]
    for i, e in enumerate(CURATED):
        got = by.get(i, [])
        sh = got[0] if got else None
        name = sh["name"] if sh else (e.get("sign") or e["name"])
        kind = (sh.get("kind") or STYLES[sh["style"]]["kind"]) if sh else None
        label = name + (f" ({sh['sub']})" if sh and sh.get("sub") else "")
        if kind == "tower":
            label += " (tower letters)"
        elif kind == "board" and e.get("floor", 0) > 0 or (kind == "board" and name not in ("OK",)):
            label += " (entrance board)"
        cat = sh["cat"] if sh else (e.get("cat") or "")
        roads = "; ".join(sorted({g["road"] for g in got})) if got else "not placed"
        bs = ", ".join(sorted({str(g["b"]) for g in got})) if got else ""
        dom = re.sub(r"^https?://(www\.)?", "", e["evidence"]).split("/")[0]
        rows.append(f"| {i + 1} | {label} | {cat} | {e.get('addr') or ''} | {roads} | {bs} | [{dom}]({e['evidence']}) |")
    with open(path, "w") as f:
        f.write("\n".join(rows) + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--overture", required=True, help="Overture place.parquet (or the directory holding it)")
    ap.add_argument("--osm", help="Overpass dump of tools/fetch_osm.py")
    ap.add_argument("--osm-pois", help="Overpass dump of named POIs (see --fetch)")
    ap.add_argument("--fetch", action="store_true", help="download --osm-pois from Overpass if missing")
    ap.add_argument("--map", default="public/data/harare.json")
    ap.add_argument("--out", default="public/data/shops.json")
    ap.add_argument("--preview", help="PNG preview around First Street Mall / Jason Moyo / Samora Machel")
    ap.add_argument("--preview-all", help="PNG preview of the whole region (small scale, no labels)")
    ap.add_argument("--report", help="TSV of every kept entry with its provenance")
    ap.add_argument("--verified-table", help="Markdown table of the CURATED entries as placed (BUSINESSES.md section 7)")
    args = ap.parse_args()

    if args.osm_pois and args.fetch and not os.path.exists(args.osm_pois):
        fetch_osm_pois(args.osm_pois)
    with open(args.map) as f:
        data = json.load(f)
    city = City(data)
    report = {}
    cands = collect(args, city, report)
    cands = clean(cands, city, report)
    cands = validate(cands, city, report)
    cands += curated_candidates(city, report)
    cands = apply_removals(cands, report)
    cands = dedupe(cands, report)
    placed = place_all(cands, city, report)
    shops = build_output(placed, city, report)
    used_styles = sorted(set(s["style"] for s in shops))
    out = {
        "version": 1,
        "source": ("Overture Maps places (CDLA-Permissive-2.0; Meta, Microsoft, AllThePlaces, Foursquare records), "
                   "OpenStreetMap (ODbL, (c) OpenStreetMap contributors), building footprints from public/data/harare.json, "
                   "web-verified locations and brand colours (docs/references/BUSINESSES.md). Built by tools/build_shops.py."),
        "generated": time.strftime("%Y-%m-%d"),
        "units": "metres; x = east, z = south; origin Africa Unity Square (-17.82932, 31.05202)",
        "styles": {k: STYLES[k] for k in used_styles},
        "shops": shops,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    size = os.path.getsize(args.out)
    cats = Counter(s["cat"] for s in shops)
    kinds = Counter(s.get("kind", STYLES[s["style"]]["kind"]) for s in shops)
    print(f"wrote {args.out}: {len(shops)} signs, {size / 1024:.0f} KB; verified web {sum(s['verified'] == 'web' for s in shops)}")
    print("  cats:", dict(cats.most_common()))
    print("  kinds:", dict(kinds))
    for k, v in report.items():
        print(f"  {k}: {dict(v) if isinstance(v, Counter) else v}")
    if args.preview:
        draw_preview(args.preview, shops, city, (-560, 160, -420, 460), scale=2.2)
        print(f"  preview -> {args.preview}")
    if args.preview_all:
        draw_preview(args.preview_all, shops, city, (REGION[0], REGION[1], REGION[2], REGION[3]), scale=0.55, labels=False)
    if args.verified_table:
        write_verified_table(args.verified_table, shops)
    if args.report:
        with open(args.report, "w") as f:
            f.write("id\tname\tcat\tbrand\tstyle\tb\tx\tz\troad\tverified\tsrc\taddr\n")
            for s in shops:
                f.write("\t".join(str(s.get(k, "")) for k in ("id", "name", "cat", "brand", "style", "b", "x", "z", "road", "verified", "src", "addr")) + "\n")


if __name__ == "__main__":
    main()
