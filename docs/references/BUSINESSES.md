# Harare CBD businesses: real shops at their real locations

Reference notes for `public/data/shops.json`: the shop, bank, fast-food, hotel and office signs of central Harare,
each placed on the facade of the building it occupies. The file is built by `tools/build_shops.py` from Overture Maps
places, OpenStreetMap and a table of web-verified businesses kept inside the script (`CURATED`).

At a glance (build of 2026-09-27):

| | |
|---|---|
| Signs | **1 529** (1 217 in the dense core around First St / Jason Moyo / Samora Machel) |
| Web-verified | **138 businesses → 176 signs** (researched corner sites carry a sign on both frontages) |
| Mapped only | 1 353 signs (Overture 1 079, OSM 271, OSM-named footprints 3), address-checked, not individually researched |
| Kinds | fascia 689, board 374, lightbox 253, painted 177, blade 21 (fuel totems), awning 12, tower 3 |
| Styles | 146 (61 brands + generic category variants + 3 tower-letter styles + 3 landmark styles) |
| Size | 555 KB raw JSON (542 KiB), 123 KB gzip — under the 1 MB budget |
| Coordinates | metres, x = east, z = south, origin = Africa Unity Square (-17.82932, 31.05202), same as `harare.json` |

Rebuild (needs the Overture / OSM downloads the map build uses):

```
python3 tools/build_shops.py --overture <dir with place.parquet> --osm <osm.json from fetch_osm.py> \
    --osm-pois <osm_pois.json> --fetch --map public/data/harare.json --out public/data/shops.json \
    --preview shops_preview.png --report shops_report.tsv --verified-table verified_table.md
```

`--verified-table` writes the §7 table from `CURATED` and the placed signs (paste it over §7 after a rebuild).

`--fetch` downloads `--osm-pois` from Overpass once (every named shop / amenity / office / tourism / healthcare / craft /
named building in the CBD bbox, `out center tags`) and reuses the file afterwards. The build takes about 5 s.

## 1. `shops.json` schema

```
{ version: 1, source: "...attribution...", generated: "YYYY-MM-DD", units: "...",
  styles: { <styleKey>: { bg, fg, accent?, font, case, kind, letters? } },
  shops:  [ { id, name, cat, brand?, style, b, x, z, nx, nz, ax, az, w, y, h, floor, road,
              kind?, sub?, off?, vertical?, addr?, verified, src, ev? } ] }
```

| Field | Meaning |
|---|---|
| `id` | unique slug (`chicken-inn-7`) |
| `name` | the text on the sign, as it appears on the real sign (`OK`, `TM Pick n Pay`, `Hyatt Regency Harare The Meikles`); apply `style.case` |
| `sub` | optional second, smaller line (Econet franchise name, `ZIMPOST`, `ZIMPAPERS`) |
| `cat` | one of: supermarket grocery wholesale fast_food restaurant cafe bakery bar butcher liquor bank money finance insurance pharmacy clinic optician hotel office church school government fuel salon electronics phone telecom clothing shoes department furniture hardware auto_parts car_dealer mall stationery printing books jewellery cinema travel courier gym funeral laundry retail market |
| `brand` | brand key when the business is a recognised chain (see §6); the same key is its style key |
| `style` | key into `styles` |
| `b` | index into `harare.json` `buildings[]` of the building that carries the sign |
| `x`, `z` | sign anchor: the centre of the sign's bottom edge **on the facade line** (the footprint edge), metres |
| `nx`, `nz` | unit outward normal of that facade (points at the street) |
| `ax`, `az` | unit vector along the facade, **= reading direction** for someone facing the sign (always `(nz, -nx)`) |
| `w` | sign width along `(ax, az)`, m (non-fuel `blade`: panel length out from the wall along the normal; fuel totem: panel width, facing the street) |
| `y` | height of the sign's bottom edge above the street, m |
| `h` | sign height, m (for `vertical` towers: total height of the stacked letters) |
| `floor` | 0 = ground-floor shop; > 0 = business upstairs (it then gets a `board` at the entrance) |
| `road` | name (as in `harare.json`) of the street the sign faces: the first carriageway / mall met walking out along the normal; `""` for 6 signs whose frontage faces an unnamed carriageway (Rainbow Towers among them) |
| `kind` | present only when it differs from `styles[style].kind` (e.g. a chain's head office upstairs → `board`, fuel → `blade`) |
| `off` | fuel totems only: distance in front of the facade (m) where the totem stands, near the kerb |
| `vertical` | 1 = letters stacked top-to-bottom (the SSC tower) |
| `addr` | address string (researched address for verified entries; the Overture/OSM address otherwise) |
| `verified` | `web` = location checked against a web source (§7 lists each with its URL); `mapped` = taken from Overture/OSM after the automatic checks of §3 |
| `src` | provenance: `curated:<index into CURATED>`, `overture:<Overture id>`, `osm:<type>/<id>`, `building:b<index>` |
| `ev` | evidence URL (verified entries) |

Style object: `bg` board colour, `fg` letter colour, `accent` optional stripe / logo-square / border colour, `font`
∈ `bold-sans | condensed | serif | script`, `case` ∈ `upper | title`, `kind` ∈:

| kind | what to build | typical size |
|---|---|---|
| `fascia` | flat painted/metal board on the canopy edge or above the shop window | h 0.85–1.2 m, bottom 2.9–3.4 m (2.3–3.2 m on single-storey buildings) |
| `lightbox` | backlit box, ~0.25 m deep, glows at night (chains, banks, fast food) | as fascia |
| `painted` | letters painted straight on the wall / parapet (hardware, motor spares, churches, old shops) | as fascia, on the wall |
| `awning` | fabric band sloping out over the door (cafés, bakeries) | h 0.9 m, bottom ≤ 2.5 m, ~1 m projection |
| `blade` | double-sided panel projecting from the wall along the normal; for `cat: fuel` a **forecourt totem** (panel `w` = 1.6 m wide facing the street, bottom 3.2 m, on a pole) standing `off` m in front of the facade | 0.7 × 1.7 m / totem 1.6 × 2.4 m |
| `tower` | big letters high on a tower; if `style.letters` is true draw only the letters (no board; `bg` = wall behind them) | h 2.3–3.2 m (vertical: 10 m) |
| `board` | small name plate at the entrance of an upstairs office, bank head office, embassy, school | 0.9 × 0.6 m at 1.2 m |

Harare shopfront reality the generic styles imitate (docs/references/PHOTOS.md §19–20): continuous cantilevered concrete
canopies at first-floor level carrying the fascia signs, roll-down steel shutters and cream expanded-metal grilles,
lightboxes for chains and banks, hand-painted letters on the Kopje-side motor-spares and hardware streets, blade signs
on older buildings (CABS First Street has blue "B BUILDING" / "S SOCIETY" blades in the 2003 photo).

## 2. Integration notes (for the city owner)

1. **Load**: `fetch('data/shops.json')` next to `harare.json` (optional file: if it fails, keep today's `signs.assign`
   path). `b` indexes the same `data.buildings` array.
2. **Replace** `Signs.assign(frontages, data.pois)` in `src/world/signs.js` / `city.js` with a loop over `shops`:
   for each entry build the quad from the anchor: bottom-left = `(x - ax*w/2, y, z - az*w/2)`, bottom-right =
   `(x + ax*w/2, y, z + az*w/2)`, top = `+h`, pushed out along `(nx, nz)` by 0.06 m (painted 0.02, lightbox box
   0.25 m deep, board 0.03). Because `(ax, az)` is the reading direction, UVs need no flip (the current
   `emitSign` flip test is not needed).
3. **Canopies**: `emitBuilding()` returns `frontages[]` with `canopy` objects. Match a shop to its frontage by `b` and
   normal (dot > 0.95) and anchor distance to the edge (< 0.5 m); when that frontage has a canopy, snap `y` to the
   canopy fascia (`canopy.top`, verandahs `-0.3`) and push the sign out by `canopy.front + 0.12`, as today's
   `emitSign` does. Signs whose facade has no ground-floor shop band in the renderer still read fine on the wall.
4. **Text**: draw `name` (and `sub` smaller underneath) into the sign atlas with `fg` on `bg`, an `accent` bar or square
   at the left edge (brands) or a thin bottom stripe (generic), `case` applied. Fonts without external files:
   bold-sans → `bold Arial, Helvetica, sans-serif`; condensed → the same with `ctx.scale(0.8, 1)`; serif →
   `bold Georgia, 'Times New Roman', serif`; script → `italic bold Georgia, serif`. Brands are text + colours only:
   do not draw logos.
5. **Budget** (phones): 1 383 distinct sign faces are too many to rasterise at once. Keep today's texture-array atlas
   but make it a **cache**: rasterise only the ~150 signs nearest the player (e.g. 256×64 px slots, 64 per 1024² layer,
   3 layers ≈ 12 MB) and draw every other sign as an untextured board in its `bg` colour (vertex colours, one merged
   geometry, one draw call). Chains share one face per `(name, sub, style)`; many repeat (Chicken Inn ×22 signs, Econet ×11,
   OK ×9). All sign quads can live in one or two merged BufferGeometries (fascia/board/painted/awning, lightbox
   with an emissive night term driven by `city.setNight`), i.e. 2–3 draw calls in total.
   Fuel totems (`blade`, 1.6 × 2.4 m portrait panel) need the name stacked or set large on two lines: a one-line
   "TotalEnergies" fitted to 1.6 m is unreadable beyond a few metres (seen in the review render).
6. **Night**: `lightbox` and `tower` (hotels) glow; fuel totems glow; fascias get the canopy downlights; boards stay dark.
7. **Priority / LOD**: `verified: 'web'` and `brand` entries are the landmarks of the street — keep them at every quality
   level; on `quality=low` drop `board` signs and `mapped` signs with `floor > 0`.
8. **Towers**: 3 entries (MEIKLES HOTEL on the Meikles south wing facing Agostinho Neto/Speke Ave, MONOMOTAPA facing
   Park Lane / Harare Gardens, SSC vertical on the Social Security Centre facing south). `JOINA CITY` letters are
   already drawn by `src/world/landmarks.js`, so they are not duplicated here.
9. **HUD / map**: `name` + `road` make good map labels and "you are outside …" subtitles; `cat` maps to icons.
10. Street names: `road` uses `harare.json` names (the 2020/2025 renames); addresses use the names people use. §4 is the
   concordance if dialogue should say "First Street" / "Speke Avenue".

## 3. Method

**Sources.** Overture Maps places (release 2026-09, 5 441 points in the bbox; mostly Meta business pages, plus
Microsoft, AllThePlaces and Foursquare records; CDLA-Permissive-2.0), OpenStreetMap (Overpass snapshot of 2026-06-01:
`shop`, `amenity`, `office`, `tourism`, `healthcare`, `craft` and named buildings; ODbL), the named building footprints
already in `harare.json`, and web research (§7).

**Cleaning** (counts from the last build). Overture free-form addresses carry literal `\n` escapes
("1434 Muunga Road\nHoughton Park"); they are turned into ", " first, otherwise suburb names hide from the check below.

- outside the CBD + near-Avenues box (x −1400…1060, z −1480…880): 416 dropped.
- *Geocoder stacks*: three or more Overture places on one spot whose addresses either do not name a street within 60 m
  or name one street with different house numbers (a street or city centroid, e.g. "Harare" or "Harare Street 13",
  "46 Harare Street" all on one point): 1 941 dropped. Same-number stacks (a mall, "57 Kaguvi Street" motor spares)
  are kept.
- address names another suburb or town (Avondale, Belvedere, Msasa, Houghton Park, Milton Park, Gunhill, Zimre Park,
  Gaborone…) or the name does: 203 dropped.
- confidence below 0.45 (0.7 for offices; −0.1 for non-Meta feeds), branded Overture points below 0.6 without an
  address: 986 dropped.
- junk / not-a-business names (URLs, phone numbers, "online", personal names, street and park names such as "First
  Street Mall", bus termini, other-language labels): 173 dropped. Names normalised: ALL-CAPS and lower-case names title-cased
  (acronyms kept), "(Pvt) Ltd", "Zimbabwe", "Harare", "- CBD" suffixes stripped, chains renamed to their sign text
  (`Chicken Inn Sakunda` → `Chicken Inn`, `Hyatt Regency Harare The Meikles` kept in full).
- categories from Overture `basic_category` / taxonomy, OSM tags and name keywords (`pharmacy`, `spares`, `boutique`…);
  unmappable (parks, parking, bus stations, museums): 261 dropped.

**Address check.** Every address is parsed for streets under old and new names (§4). `Cnr A & B` is resolved to the
junction of A and B in the road network. A place within 75 m of that junction (or within 90 m of both streets, for big
corner sites) is accepted; one further away (up to 1.2 km) is **moved** to the junction, leaning 8 m toward its
original pin to pick a corner block (146 moved). A single-street address must lie within 60 m of that street
("near" up to 120 m is kept); otherwise the place is dropped (109 dropped; branded places are kept only if they sit on a
mapped building). An Overture address that names no CBD street (fuzzy-matched, so "Chimhoyi", "Julias Nyerere",
"Kwame Nkruma" still count) but names some other street ("King George Road 4", "Clyde Road", "Harvey Brown Avenue",
"Somerset Drive") that is not within 150 m of the pin is a suburb address geocoded into town: 44 dropped (`foreign`).

**Dedupe.** Same brand, or same normalised name, within 80 m for chains and researched entries, 120 m for other names of
6+ letters (Overture pins of one business are often 50–120 m off the OSM record: Beer Engine, Shasha Mall, Joina City,
Harare Civil Court) and 45 m for short names: the best record wins (curated > OSM building > OSM > Overture;
address-confirmed and area-mapped records rank higher) and inherits missing address / website: 331 merged.

**Removals** (`REMOVE` in the script): Choppies (left Zimbabwe Dec 2024; the two CBD stores are now Sai Mart), PEP
(left in 2019), the Standard Chartered branches at Robert Mugabe Rd and 106 Jason Moyo (the bank became FBC Crown Bank,
2 branches), ZB at Zimbank House (not in ZB's locator; TV Sales & Home's factory shop is there), Barclays (now First
Capital Bank), Galito's (not in Zimbabwe), duplicate Herald and Econet House records, the Overture "OK, Union Ave" pin
480 m east of OK Kwame Nkrumah (same store), Barbours at First St / Jason Moyo (the building is Galaxy Mall now) and
"Rainbow City Cinema" on Jason Moyo (the cinema's address is 99 Park Lane) and the Overture "Sterkinekor Eastgate"
pin on Fourth St (the OSM Ster Kinekor point by Eastgate is kept). "Standard Bank" records are matched to the Stanbic
brand (the group's Zimbabwe name) and merge into the researched Stanbic branch.

**Placement.** For each business: the building given by research, else the footprint containing the point, else the
nearest footprint (≤ 30 m, 45 m for researched ones) that has a *street frontage*. A frontage is an outer footprint edge
≥ 2.5 m whose outward normal points at a carriageway or pedestrian mall within 45 m, parallel to it (|cos| ≥ 0.8), with
0.3 m … sidewalk + 14 m of pavement in front — the same rule as `streetFacing()` in `src/world/buildings.js` — plus a
line-of-sight test (a ray from the wall to the kerb must not cross another building ≥ 2.5 m tall at 2 of 3 sample points,
and must not start inside an overlapping footprint). Service lanes and slip roads never count, so no sign faces a back
lane or a courtyard. Set-back buildings (hotels, forecourts, podium towers) fall back to a relaxed rule (≤ 60 m of
forecourt, only buildings ≥ 6 m block), towers to a direction-only rule. Among the frontages the one nearest the point
wins, with a bonus for the street(s) named in the address (a researched `face` always wins), a small bonus for the pedestrian
malls and for long frontages for big stores. The sign sits at the point's projection on that edge. Signs sharing a
facade are packed along it (0.5 m gaps, 0.35 m margins, highest priority first: researched > chain > OSM > Overture by
confidence; overflow moves to the building's next-best frontage, else is dropped: 72). Upstairs businesses
(`1st floor`, `suite`, `office no.`…) and offices / government / schools get entrance boards packed separately. Corner
sites from the research get a second sign on the other frontage.

**QA** (producer's scratch script, re-checked independently in review on the final build: all 1 529 anchors on their
outline, normals outward, `(ax, az) = (nz, -nx)`, no sign wider than its edge or above its roof, no overlaps on a
facade, 19 signs without a carriageway / mall within 70 m straight ahead): every anchor lies on its building's outline, the point 0.6 m in front is outside
all other buildings except for one pair of overlapping Overture footprints (N1 Hotel, Rotten Row), no two signs on one
facade overlap (the 4 reported "overlaps" are fuel totems that stand `off` metres out), and a named street is met
straight ahead of all but 15 signs (2 set-back hotel/tower signs, 3 on the pedestrian stretch of Speke Ave at First
St, which has no carriageway in the map, 2 on the splayed corner of ZB Rotten Row, 1 behind the RBZ forecourt and 7 at
the outer edge of the region). The preview PNG (`--preview`) draws buildings,
streets and every sign as a coloured bar in its `bg` colour with a tick along the normal, and labels verified (red, `*`)
and branded signs; it was inspected around First Street Mall, Jason Moyo, Samora Machel, Kwame Nkrumah, Joina City,
Eastgate, the Kopje-side streets and Fife Avenue, which led to the service-lane rule, the line-of-sight and
overlapping-footprint tests, the set-back fallback order and several researched `face` fixes.

## 4. Street-name concordance used for addresses

Harare renamed most CBD streets (Statutory Instrument 167 of 2020 and a council resolution of June 2025 —
[bulawayo24](https://bulawayo24.com/index-id-news-sc-national-byo-253725.html),
[New Ziana](https://newziana.co.zw/harare-city-council-renames-major-roads-to-honour-african-global-icons/)).
`harare.json` carries the new names; addresses online mostly use the old ones. `STREETS` in the script holds the full
list; the ones that matter in the CBD:

| Address says | `harare.json` / sign `road` |
|---|---|
| Angwa St | Sir Seretse Khama Street |
| Inez (Innez) Terrace | Mayor Urimbo Terrace |
| Third St | Patrice Lumumba Street |
| Second St | Sam Nujoma Street (2nd Street / 2nd St. Extension) |
| Fourth St, Simon (Vengai) Muzenda St | Fourth Street / Fourth Street/ S.V Muzenda |
| Speke Ave | Agostinho Neto Avenue |
| Cameron St | Joseph Msika Street (the north part is unnamed in the data; the script names it) |
| Rezende St | Julia Zvobgo Street (north part unnamed in the data; named by the script) |
| Union Ave | Kwame Nkrumah (Union) Avenue |
| Stanley Ave / Gordon Ave / Baker Ave / Jameson Ave / Manica Rd | Jason Moyo / George Silundika / Nelson Mandela / Samora Machel Ave / Robert Mugabe Rd |
| Kingsway / Moffat St | Julius Nyerere Way / Leopold Takawira St |
| Central Ave / Livingstone Ave / Baines Ave / Fife Ave | Ahmed Ben Bella / Oliver Tambo / Herbert Ushewokunze Ave / Leonid Brezhnev St |
| Seventh St | Liberation Legacy Way |
| Park Lane / Rotten Row / Charter Rd / Railway Ave | Jomo Kenyatta Lane / Abdel Gamal Nasser Rd / Fidel Castro Rd / Kenneth Kaunda Ave |
| Orr St / Wayne St (by position) | Kavalamanja Battle Street / Zidube Ranch Battle Street |

## 5. Current-status corrections found during research

- **Choppies → Sai Mart.** Choppies sold its 30 Zimbabwe stores (effective 1 Jan 2025) to Pintail (Raj Modi); they are
  being rebranded Sai Mart, Harare last
  ([Pindula 2025-03-11](https://news.pindula.co.zw/2025/03/11/sai-mart-takes-over-all-former-choppies-zimbabwe-stores/),
  [Nehanda Radio](https://nehandaradio.com/2025/04/16/modi-acquires-choppies-zimbabwe-for-us260000-after-initial-us22-million-sale/)).
  The two OSM "Choppies Supermarket" footprints are signed Sai Mart.
- **Standard Chartered → FBC Crown Bank ("Crown Bank")**, renamed 17 Aug 2024, two branches
  ([FBC](https://www.fbc.co.zw/media/latest-news/fbc-holdings-limited-announces-successful-completion-standard-chartered-bank),
  [contact page](https://www.fbc.co.zw/fbc-crown/about-us/contact-us)): Africa Unity Square branch kept, the others removed.
- **OK Zimbabwe** closed 11 stores in 2025, including **OK Robson Manyika** (CBD)
  ([Pindula](https://news.pindula.co.zw/2025/01/31/retail-giant-ok-zimbabwe-shuts-down-five-branches/)); no mapped
  record sat there.
- **PEP** left Zimbabwe in 2019 ([The Anchor](https://www.theanchor.co.zw/pep-exits-zimbabwe/)); **Barclays** became
  First Capital Bank (2019); **Galito's** does not trade in Zimbabwe; **Mr Price** has no official stores (resellers only).
- **Monomotapa**: the 2010–12 rooftop letters read CROWNE PLAZA MONOMOTAPA; the hotel now trades as the Monomotapa
  (African Sun), so the tower sign says MONOMOTAPA.
- **Edgars** changed its mark: a 2016 photo (Jason Moyo) shows black "Edgars" with an orange square; the current logo is
  EDGARS with a red square (used here).

- **Barbours → Galaxy Mall.** The department-store building at the corner of First St and Jason Moyo Ave is now Galaxy
  Mall ("formerly Barbours"; [Herald](https://www.heraldonline.co.zw/harares-property-repurposing-renaissance/)); the
  OSM "Barbours" point there is removed and the building is signed GALAXY MALL (§7 #138).
- **Two N1 Hotels.** N1 Hotel Samora Machel (126 Samora Machel Ave, OSM building "N1 Hotel", §7 #131) and N1 Hotel
  Rotten Row (cnr Samora Machel Ave / Rotten Row, [N1](https://www.n1hotel.co.zw/rottenrow/), kept from Overture).
- **Rainbow City Cinema** is listed at 99 Park Lane ([Cinema Treasures](https://cinematreasures.org/theaters/26158));
  its current status is unclear, so the misplaced Overture record on Jason Moyo is removed and nothing is added.

## 6. Brand styles (text + colours only, no logos)

Colours were sampled from each brand's own logo file or site theme (PIL colour histogram / SVG fills) where the site was
reachable (*sampled*), taken from a photo (*photo*) or a web description (*web*, *approx*); *unverified* rows use a
plausible generic style and should be checked against a photo before release.

| Brand key | Sign text | bg | fg | accent | font / case / kind | Confidence | Source |
|---|---|---|---|---|---|---|---|
| `bakers_inn` | Bakers Inn | `#ffffff` | `#201070` | `#b08050` | serif / upper / lightbox | sampled | [Simbisa brand logo (navy + gold)](https://www.simbisabrands.com/assets/img/1752/artboard-39.png) |
| `cabs` | CABS | `#005baa` | `#ffffff` | `` | bold-sans / upper / lightbox | photo | [blue lightbox with white CABS on First St (2003 photo, docs/references/PHOTOS.md s.19); CABS refreshed its brand in 2014 - recheck](https://commons.wikimedia.org/wiki/File:First_Street,_Harare,_Zimbabwe.jpg) |
| `fcb` | First Capital Bank | `#112369` | `#ffffff` | `#93c840` | bold-sans / title / lightbox | sampled | [logo SVG + site theme-color (navy, green)](https://www.firstcapitalbank.co.zw/wp-content/uploads/2018/09/logo-1.svg) |
| `nbs` | NBS Bank | `#107838` | `#ffffff` | `#b0d030` | bold-sans / upper / lightbox | sampled | [official logo file (green + lime)](https://www.nbs.co.zw/wp-content/themes/NBS/img/nbs-logo.png) |
| `nedbank` | Nedbank | `#006341` | `#ffffff` | `#009639` | bold-sans / title / lightbox | sampled | [official logo SVG (greens)](https://www.nedbank.co.zw/content/dam/nedbank/logo/NEDBANK.svg) |
| `cbz` | CBZ | `#e80820` | `#ffffff` | `#203060` | bold-sans / upper / lightbox | sampled | [CBZ Holdings logo on Wikimedia Commons (red disc, navy)](https://upload.wikimedia.org/wikipedia/commons/d/db/CBZ_Holdings_Logo.png) |
| `metbank` | Metbank | `#1d2f6f` | `#ffffff` | `` | bold-sans / title / lightbox | unverified | generic navy |
| `zb` | ZB Bank | `#008840` | `#ffffff` | `#68c018` | bold-sans / upper / lightbox | sampled | [official logo file (greens)](https://www.zb.co.zw/sites/default/files/zblogo.png) |
| `crown_bank` | Crown Bank | `#0e2c4e` | `#ffffff` | `#c9a44c` | serif / title / lightbox | unverified | [FBC Crown Bank - generic navy/gold](https://www.fbc.co.zw/fbc-crown/about-us/contact-us) |
| `fbc` | FBC Bank | `#204088` | `#ffffff` | `#60b8d0` | bold-sans / upper / lightbox | sampled | [FBC Holdings logo file](https://www.fbc.co.zw/sites/default/files/fbc-holdings-logo.png) |
| `nmb` | NMB Bank | `#003060` | `#ffffff` | `#e0c070` | bold-sans / upper / lightbox | sampled | [official logo file (navy + gold)](https://www.nmbz.co.zw/nmb/sites/default/files/logo_1.png) |
| `steward` | Steward Bank | `#7a2e90` | `#ffffff` | `#5a1e6e` | bold-sans / title / lightbox | sampled | [site theme colour (purple)](https://stewardbank.co.zw/) |
| `zwmb` | Zimbabwe Women's Microfinance Bank | `#6d2077` | `#ffffff` | `` | bold-sans / title / fascia | unverified | generic purple |
| `stanbic` | Stanbic Bank | `#0033a1` | `#ffffff` | `` | bold-sans / title / lightbox | web | [Standard Bank group blue #0033A1](https://brandfetch.com/stanbicbank.co.zw) |
| `ecobank` | Ecobank | `#005b82` | `#ffffff` | `#bed600` | bold-sans / title / lightbox | sampled | [logo SVG + site CSS (blue, lime)](https://ecobank.com/img/eco/eco-logo-svg.svg) |
| `agribank` | Agribank | `#006b3f` | `#ffffff` | `#f2b705` | bold-sans / title / lightbox | unverified | generic green/gold |
| `posb` | POSB | `#003f87` | `#ffffff` | `#f7a800` | bold-sans / upper / lightbox | unverified | generic navy/amber |
| `truworths` | Truworths | `#111111` | `#ffffff` | `` | serif / upper / fascia | unverified | typical black/white serif |
| `jet` | Jet | `#000000` | `#ffffff` | `#f05008` | bold-sans / title / lightbox | sampled | [official logo file: black box, white "Jet", orange dot](https://jetstores.co.zw/wp-content/themes/jetzw/images/logo.png) |
| `topics` | Topics | `#e2231a` | `#ffffff` | `` | bold-sans / upper / fascia | unverified | generic red |
| `edgars` | Edgars | `#ffffff` | `#111111` | `#e00828` | bold-sans / upper / lightbox | sampled | [official logo file: black EDGARS + red square (a 2016 photo shows the older orange square)](https://www.edgarsstores.co.zw/images/logo.png) |
| `barbours` | Barbours | `#1f3d2b` | `#ffffff` | `` | serif / title / fascia | unverified | generic (no sign uses it since the review: the First St store is now Galaxy Mall, §5) |
| `meikles_store` | Meikles | `#1f2a44` | `#e8d7a8` | `` | serif / upper / fascia | unverified | [generic department-store navy/cream](https://www.zimyellowpage.com/listings/category/meikles-mega-market) |
| `creamy_inn` | Creamy Inn | `#fbeaf2` | `#e04090` | `#90c0a0` | script / title / lightbox | sampled | [Simbisa brand logo (pink script, mint accent)](https://www.simbisabrands.com/assets/img/1750/creamy-inn-logo.png) |
| `hungry_lion` | Hungry Lion | `#c81010` | `#ffffff` | `#f8d000` | bold-sans / upper / lightbox | sampled | [official logo file (red + yellow)](https://www.hungrylion.co.zw/wp-content/uploads/2025/05/HL_Logo2023.png) |
| `chicken_inn` | Chicken Inn | `#ffffff` | `#e02020` | `#f09020` | bold-sans / title / lightbox | sampled | [Simbisa brand logo (red wordmark, orange mascot)](https://www.simbisabrands.com/assets/img/1762/ci-updated-logos-53x100-1.png) |
| `pizza_inn` | Pizza Inn | `#ffffff` | `#008030` | `#d02030` | bold-sans / title / lightbox | sampled | [Simbisa brand logo (green "Pizza", red "Inn")](https://www.simbisabrands.com/assets/img/1748/pi-updated-logos-53x100-2.png) |
| `nandos` | Nando's | `#ffffff` | `#d01020` | `#000000` | script / title / lightbox | sampled | [Simbisa brand logo (red wordmark, black cockerel)](https://www.simbisabrands.com/assets/img/1763/nandos-logo-portrait.png) |
| `kfc` | KFC | `#e31f2e` | `#ffffff` | `` | bold-sans / upper / lightbox | sampled | [KFC Zimbabwe site logo](https://kfc.co.zw/) |
| `fish_inn` | Fish Inn | `#ffffff` | `#0060b0` | `#f8a810` | bold-sans / title / lightbox | sampled | [Simbisa brand logo (blue + orange)](https://www.simbisabrands.com/assets/img/1757/artboard-41.png) |
| `steers` | Steers | `#400040` | `#ffffff` | `#f0c000` | bold-sans / upper / lightbox | sampled | [Simbisa brand logo (aubergine badge, yellow flame)](https://www.simbisabrands.com/assets/img/1756/steers-logo.png) |
| `chicken_slice` | Chicken Slice | `#e30613` | `#ffd200` | `#ffd200` | bold-sans / title / lightbox | approx | [red-and-yellow scheme (Chicken Inn v Chicken Slice court case, 2019); hexes estimated](https://www.newzimbabwe.com/chicken-inn-loses-trademark-row-with-chicken-slice/) |
| `pizza_hut` | Pizza Hut | `#ee3124` | `#ffffff` | `` | script / title / lightbox | unverified | generic |
| `puma` | Puma | `#007142` | `#ffffff` | `#ed1c24` | bold-sans / upper / lightbox | sampled | [Puma Energy logo SVG (green + red)](https://pumaenergy.com/wp-content/uploads/2023/04/puma-logo.svg) |
| `engen` | Engen | `#002c90` | `#ffffff` | `#ed1651` | bold-sans / title / lightbox | sampled | [official logo SVG (blue + red)](https://www.engen.co.zw/assets/logos/logo.svg) |
| `total` | TotalEnergies | `#ffffff` | `#fc0103` | `#0186f5` | bold-sans / title / lightbox | sampled | [TotalEnergies logo SVG (red wordmark, multicolour gradient)](https://upload.wikimedia.org/wikipedia/en/5/54/TotalEnergies_logo.svg) |
| `trek` | Trek | `#e30613` | `#ffffff` | `` | bold-sans / upper / lightbox | unverified | generic red |
| `zuva` | Zuva | `#009820` | `#ffffff` | `` | bold-sans / upper / lightbox | sampled | [official logo file (green)](https://zuvapetroleum.co.zw/wp-content/uploads/2026/07/Zuva-Logocolor.png) |
| `tvsales` | TV Sales & Home | `#d04038` | `#ffffff` | `#b8b8b8` | bold-sans / upper / lightbox | sampled | [official logo file (red + grey); 2019 photo shows a round red lightbox with white TV](https://www.tvsales.co.zw/) |
| `electrosales` | Electrosales | `#e2231a` | `#ffffff` | `` | bold-sans / upper / fascia | unverified | generic red |
| `n1` | N1 Hotel | `#e30613` | `#ffffff` | `` | bold-sans / upper / fascia | unverified | generic red |
| `new_ambassador` | New Ambassador Hotel | `#1f2a44` | `#ffffff` | `` | serif / upper / fascia | unverified | generic navy |
| `bronte` | Bronte Hotel | `#2c4a2e` | `#f4ecd8` | `` | serif / title / painted | unverified | generic painted green/cream |
| `meikles` | Meikles Hotel | `#1f2a44` | `#e8d7a8` | `` | serif / upper / fascia | unverified | generic navy/cream serif (tower letters: see tower_meikles, photo 2008) |
| `monomotapa` | Monomotapa | `#301008` | `#ffffff` | `#f06020` | serif / upper / fascia | sampled | [operator African Sun logo (brown + orange)](https://africansun.com/wp-content/uploads/2024/03/Logo.png) |
| `rainbow_towers` | Rainbow Towers | `#1f2a44` | `#ffffff` | `` | serif / upper / fascia | unverified | generic navy |
| `cresta_oasis` | Cresta Oasis | `#0e2d44` | `#ffffff` | `#aa9f95` | serif / upper / fascia | sampled | [crestahotels.com colours (navy + taupe)](https://www.crestahotels.com/) |
| `holiday_inn` | Holiday Inn | `#ffffff` | `#216245` | `` | bold-sans / title / lightbox | sampled | [IHG Holiday Inn logo (green)](https://digital.ihg.com/is/content/ihg/hi_logo) |
| `cresta_jameson` | Cresta Jameson | `#0e2d44` | `#ffffff` | `#aa9f95` | serif / upper / fascia | sampled | [crestahotels.com colours (navy + taupe)](https://www.crestahotels.com/) |
| `mukuru` | Mukuru | `#f7931e` | `#ffffff` | `` | bold-sans / title / lightbox | unverified | generic orange |
| `sanders` | Sanders Opticians | `#1f2a44` | `#ffffff` | `` | serif / title / fascia | unverified | generic |
| `greenwood` | Greenwood Pharmacy | `#00843d` | `#ffffff` | `` | bold-sans / title / lightbox | unverified | generic pharmacy green |
| `bata` | Bata | `#e60000` | `#ffffff` | `#f28c28` | bold-sans / title / lightbox | web | [Bata red #E60000 (+ orange since the 1969 DRU identity)](https://logotyp.us/logo/bata/) |
| `sai_mart` | Sai Mart | `#c8102e` | `#ffffff` | `#ffd200` | bold-sans / title / fascia | unverified | [new chain (ex-Choppies); colours not found - generic supermarket red](https://news.pindula.co.zw/2025/03/11/sai-mart-takes-over-all-former-choppies-zimbabwe-stores/) |
| `foodworld` | Food World | `#ffffff` | `#009048` | `#d85828` | bold-sans / title / fascia | sampled | [official logo file (green + orange)](https://www.foodworld.co.zw/wp-content/uploads/2020/07/FW-logo-Primary-OFFICIAL_page-0001.jpg) |
| `ok` | OK | `#ffffff` | `#e31b23` | `#e31b23` | bold-sans / upper / lightbox | approx | [red "OK" on white; logo catalogues list the OK Zimbabwe mark as red/white (official sites unreachable from here)](https://africanfinancials.com/company/zw-okz/) |
| `tmpnp` | TM Pick n Pay | `#ffffff` | `#1b3a8c` | `#d2232a` | bold-sans / title / lightbox | approx | [Pick n Pay mark: dark-blue "Pick", cherry-red "Pay" (2007 identity); TM Pick n Pay uses it with "TM"](https://www.bizcommunity.com/Article/196/423/19604.html) |
| `spar` | SPAR | `#ffffff` | `#e83038` | `#008038` | bold-sans / upper / lightbox | sampled | [official logo file](https://www.spar.co.zw/brand/spar-logo.png) |
| `telone` | TelOne | `#0060a9` | `#ffffff` | `#f7941d` | bold-sans / title / lightbox | unverified | [brand manual on telone.co.zw not reachable (TLS error) - generic blue/orange](https://www.telone.co.zw/Content/Uploads/Tenders/ca0f4136-8e03-40a3-9bbe-c8e439edda3b.pdf) |
| `econet` | Econet | `#ffffff` | `#283088` | `#e82028` | bold-sans / title / lightbox | sampled | [official logo file (indigo wordmark, red accent)](https://www.econet.co.zw/wp-content/uploads/2025/06/EconetLogo.png) |
| `netone` | NetOne | `#f97315` | `#ffffff` | `#18181a` | bold-sans / title / lightbox | sampled | [site theme colour (orange)](https://www.netone.co.zw/) |
| `gain` | Gain Cash & Carry | `#e2231a` | `#ffffff` | `#ffd200` | bold-sans / upper / fascia | unverified | [site unreachable - generic wholesale red/yellow](https://thedirectory.co.zw/branch.cfm?branchid=16043) |

Generic styles for independents (`gen_<cat>_<n>`, picked by a hash of the name so a shop keeps its look between builds)
follow the Harare street palette: painted fascia boards in red / blue / green / mustard with white or black letters,
hand-painted parapet lettering (`painted`) for hardware, motor spares, butcheries and churches, lightboxes for phone
shops, fast food, bars and pharmacies (green cross colours), script faces for salons and boutiques, serif for hotels,
opticians, funeral parlours and law chambers, awnings for cafés and bakeries, and cream name plates (`board`) for
upstairs offices. Three tower-letter styles (`tower_meikles`, `tower_monomotapa`, `tower_ssc`, `letters: true`) and three
landmark styles (`mall_eastgate`, `zimpost`, `herald`) complete the set.

## 7. Web-verified businesses

Each row was checked against the source linked (official branch lists / store locators first — The Directory
(thedirectory.co.zw) branch pages, the Econet and NetOne shop locators (with coordinates), the ZB branch locator, the
TV Sales & Home contact page, the Simbisa Brands store locator for Chicken Inn / Pizza Inn / Creamy Inn / Bakers Inn
branch names — then news, maps and directory listings). The position comes from the researched address resolved on the
map (junction / building), from the locator's own coordinates (Econet, NetOne, CABS, Zuva) or from the OSM / Overture
record that the source confirms; `Facade(s) face` is where the sign ended up. For chains that share a building (the
Samora Machel / Fifth St Simbisa outlet, 105 Robert Mugabe Rd, AMC, Fife Avenue Shopping Centre) each counter has its
own sign.

| # | Sign | Category | Where (address as researched) | Facade(s) face | `b` | Evidence |
|---|---|---|---|---|---|---|
| 1 | OK | supermarket | Cnr First Street & Nelson Mandela Ave (First Street branch, the original 1942 OK store) | First Street Mall; Nelson Mandela Avenue | 2069 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=13552) |
| 2 | OK | supermarket | Kwame Nkrumah Ave near Julius Nyerere Way (OK Kwame Nkrumah, 2418A Kwame Nkrumah Ave) | Kwame Nkrumah (Union) Avenue | 1283 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=13576) |
| 3 | OK | supermarket | 5950 Mbuya Nehanda St, cnr Albion St (Mbuya Nehanda branch) | Albion Street; Mbuya Nehanda Street | 2661 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=13575) |
| 4 | OK | supermarket | Robert Mugabe Rd cnr Third St (Third Street branch) | Patrice Lumumba Street; Robert Mugabe Road | 3832 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=20537) |
| 5 | OK | supermarket | Fife Avenue Shopping Centre (Fife Avenue branch) | Leonid Brezhnev Street | 7475 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=13551) |
| 6 | TM Pick n Pay | supermarket | 73/74 Jason Moyo Ave, cnr Sam Nujoma St | Jason Moyo Avenue | 2203 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=12582) |
| 7 | TM Pick n Pay | supermarket | Joina City shop L01, cnr Inez Terrace / Jason Moyo Ave | Mayor Urimbo Terrace | 2123 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=19210) |
| 8 | TM Pick n Pay | supermarket | Margolis Plaza, Harare St / Speke Ave (Harare Street TM) | Harare Street | 2679 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=19191) |
| 9 | Meikles Mega Market | department | 91 Robert Mugabe Rd, cnr Orr St | Kavalamanja Battle Street; Robert Mugabe Road | 2255 | [zimyellowpage.com](https://www.zimyellowpage.com/listings/category/meikles-mega-market) |
| 10 | Sai Mart | supermarket | Nelson Mandela Ave (former Choppies) | Nelson Mandela Avenue | 1192 | [news.pindula.co.zw](https://news.pindula.co.zw/2025/03/11/sai-mart-takes-over-all-former-choppies-zimbabwe-stores/) |
| 11 | Sai Mart | supermarket | Cameron St / Robert Mugabe Rd (former Choppies) | Joseph Msika Street; Robert Mugabe Road | 2610 | [news.pindula.co.zw](https://news.pindula.co.zw/2025/03/11/sai-mart-takes-over-all-former-choppies-zimbabwe-stores/) |
| 12 | SPAR Athienitis | supermarket | SPAR Athienitis, 147 Fife Ave, cnr Fifth St (Fife Avenue Shopping Centre) | Fifth Street | 6828 | [spar.co.zw](https://www.spar.co.zw/stores/31/harare/6/spar-athienitis) |
| 13 | Kwame Mall | mall | Kwame Nkrumah (Union) Ave | Kwame Nkrumah (Union) Avenue | 1284 | [mapcarta.com](https://mapcarta.com/W541692930) |
| 14 | Food World | supermarket | 52 Robert Mugabe Rd (Food World Julius Nyerere) | Robert Mugabe Road | 2550 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=11688) |
| 15 | Food World | supermarket | 42 Jason Moyo Ave (Food World Angwa) | Sir Seretse Khama Street | 2131 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=11687) |
| 16 | Food World | supermarket | 103 Cameron St (Camspek Food World) | Joseph Msika Street | 2632 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=11686) |
| 17 | CBZ | bank | Union House, 60 Kwame Nkrumah Ave (Kwame Nkrumah branch / head office) | Kwame Nkrumah (Union) Avenue | 2018 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=6733) |
| 18 | CBZ | bank | 83 Robert Mugabe Rd (Robert Mugabe branch) | Robert Mugabe Road | 2263 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=6747) |
| 19 | CBZ | bank | Cnr Angwa St / Speke Ave (Sapphire branch) | Agostinho Neto Avenue; Sir Seretse Khama Street | 2538 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=6750) |
| 20 | CBZ | bank | Avenue Place, 7 Selous Ave (Selous branch) | Sam Nujoma Street (2nd St. Extension) | 1755 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=6751) |
| 21 | FBC Bank | bank | FBC Centre, 45 Nelson Mandela Ave (head office) | Nelson Mandela Avenue | 2097 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=6692) |
| 22 | FBC Bank | bank | 34 Nelson Mandela Ave (Nelson Mandela branch) | Nelson Mandela Avenue | 1278 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=6694) |
| 23 | FBC Bank | bank | Old Reserve Bank Building, 76 Samora Machel Ave (Samora Machel branch) | Samora Machel Avenue | 1687 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=6693) |
| 24 | Stanbic Bank | bank | Stanbic Chambers, 64 Nelson Mandela Ave | Nelson Mandela Avenue | 1985 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=6862) |
| 25 | Stanbic Bank | bank | 59 Samora Machel Ave | Samora Machel Avenue | 2022 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=6861) |
| 26 | Crown Bank | bank | Africa Unity Square, 68 Nelson Mandela Ave / Sam Nujoma St (ex Standard Chartered, renamed FBC Crown Bank Aug 2024) | Nelson Mandela Avenue; Sam Nujoma Street (2nd Street) | 1965 | [fbc.co.zw](https://www.fbc.co.zw/fbc-crown/about-us/contact-us) |
| 27 | Steward Bank | bank | Union Building, 101 Kwame Nkrumah Ave (head office) | Kwame Nkrumah Avenue | 4143 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=8471) |
| 28 | Steward Bank | bank | Eastgate, cnr Robert Mugabe Rd / Third St | Robert Mugabe Road | 2233 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=16331) |
| 29 | NMB Bank | bank | Unity Court, cnr Kwame Nkrumah Ave / First St (head office) | Kwame Nkrumah (Union) Avenue | 2018 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=5597) |
| 30 | NMB Bank | bank | Ground floor, Eastgate, Robert Mugabe Rd | Robert Mugabe Road | 2233 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=6636) |
| 31 | Ecobank | bank | 35 Nelson Mandela Ave, cnr Angwa St | Nelson Mandela Avenue; Sir Seretse Khama Street | 2099 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=14486) |
| 32 | Ecobank | bank | 137 Samora Machel Ave | Samora Machel Avenue | 4523 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=14487) |
| 33 | First Capital Bank | bank | Barclays House, cnr Jason Moyo Ave / First St (head office) | First Street Mall; Jason Moyo Avenue | 2079 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=12503) |
| 34 | Agribank | bank | Hurudza House, 14-16 Nelson Mandela Ave (head office) | Nelson Mandela Avenue | 1202 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=4280) |
| 35 | Nedbank | bank | 99 Jason Moyo Ave (Jason Moyo branch) | Jason Moyo Avenue | 3841 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=10990) |
| 36 | ZB Bank | bank | 15 George Silundika Ave & First St (First Street service centre) | First Street Mall; George Silundika Drive | 2075 | [zb.co.zw](https://www.zb.co.zw/banking/branch-locator) |
| 37 | ZB Bank | bank | Cnr Robert Mugabe Rd / Chinhoyi St (Westend service centre) | Chinhoyi Street; Robert Mugabe Road | 2616 | [zb.co.zw](https://www.zb.co.zw/banking/branch-locator) |
| 38 | ZB Bank | bank | Kaguvi St / Kwame Nkrumah Ave (Rotten Row service centre) | Harare Street; Kwame Nkrumah (Union) Avenue | 1045 | [zb.co.zw](https://www.zb.co.zw/banking/branch-locator) |
| 39 | CABS | bank | 17 First St, cnr George Silundika Ave (CABS First Street) | First Street Mall; George Silundika Drive | 2190 | [cabs.co.zw](https://www.cabs.co.zw/cabs-first-street) |
| 40 | CABS | bank | Cnr Simon Muzenda (Fourth) St & Central Ave (CABS Central Avenue) | Ahmed Ben Bella Avenue; Fourth Street/ S.V Muzenda | 4263 | [cabs.co.zw](https://www.cabs.co.zw/cabs-central-avenue-1) |
| 41 | POSB (entrance board) | bank | 6th floor, Causeway Building, cnr Third St & Central Ave (POSB Causeway) | Ahmed Ben Bella Avenue | 1837 | [nearme.3o9.in](https://nearme.3o9.in/stores/Zimbabwe/Harare/Harare/POSB%20CAUSEWAY) |
| 42 | Zimbabwe Women's Microfinance Bank | bank | Trust Towers, 56-60 Samora Machel Ave (head office and main branch) | Samora Machel Avenue | 1666 | [womensbank.co.zw](https://womensbank.co.zw/contact-zimbabwe-women-microfinance-bank/) |
| 43 | NBS Bank | bank | 53 Samora Machel Ave (National Building Society; listed as a ZB agent) | Samora Machel Avenue | 2024 | [zb.co.zw](https://www.zb.co.zw/banking/branch-locator) |
| 44 | Metbank | bank | 3 Central Ave (head office) | Ahmed Ben Bella Avenue | 1867 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=297) |
| 45 | Reserve Bank of Zimbabwe (entrance board) | government | 80 Samora Machel Ave | Samora Machel Avenue | 1689 | [rbz.co.zw](https://www.rbz.co.zw/index.php/contact-us) |
| 46 | Old Mutual Centre (entrance board) | office | Cnr Third St / Jason Moyo Ave (Nedbank head office is on its 14th floor) | Patrice Lumumba Street | 3838 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=6384) |
| 47 | Econet | telecom | Econet House, 19 George Silundika Ave (cnr First St) | George Silundika Drive | 2189 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=7111) |
| 48 | Econet | telecom | 198 Herbert Chitepo Ave (Econet-owned shop) | Herbert Chitepo Avenue | 7182 | [econet.co.zw](https://www.econet.co.zw/shop-locator/) |
| 49 | Econet | telecom | 79 Livingstone Ave (Econet-owned shop) | Oliver Tambo Avenue | 7390 | [econet.co.zw](https://www.econet.co.zw/shop-locator/) |
| 50 | Econet (Brand Digital) | telecom | Angwa St (franchise: Brand Digital) | Julius Nyerere Way | 2038 | [econet.co.zw](https://www.econet.co.zw/shop-locator/) |
| 51 | Econet (CellTrade) | telecom | Julius Nyerere Way / Speke Ave (franchise: CellTrade) | Agostinho Neto Avenue; Julius Nyerere Way | 2123 | [econet.co.zw](https://www.econet.co.zw/shop-locator/) |
| 52 | Econet (Brimas) | telecom | Cameron St / Bank St (franchise: Brimas) | Bank Street | 2919 | [econet.co.zw](https://www.econet.co.zw/shop-locator/) |
| 53 | Econet (Brand Digital) | telecom | Eastgate (franchise: Brand Digital) | Patrice Lumumba Street | 2232 | [econet.co.zw](https://www.econet.co.zw/shop-locator/) |
| 54 | Econet (Globtech) | telecom | Sam Nujoma St / George Silundika Ave (franchise: Globtech) | George Silundika Drive | 2197 | [econet.co.zw](https://www.econet.co.zw/shop-locator/) |
| 55 | Econet (Media Connect) | telecom | Samora Machel Ave / Sixth St (franchise: Media Connect) | Samora Machel Avenue; Sixth Street | 4350 | [econet.co.zw](https://www.econet.co.zw/shop-locator/) |
| 56 | NetOne | telecom | 104 Jason Moyo Ave (NetOne Vanguard shop) | Jason Moyo Avenue | 4119 | [netone.co.zw](https://www.netone.co.zw/shop-locator) |
| 57 | NetOne | telecom | 66 Julius Nyerere Way (NetOne Julius Nyerere shop) | Julius Nyerere Way | 2044 | [netone.co.zw](https://www.netone.co.zw/shop-locator) |
| 58 | NetOne | telecom | Kopje Plaza, 1 Jason Moyo Ave (NetOne head office & shop) | Jason Moyo Avenue | 1022 | [netone.co.zw](https://www.netone.co.zw/shop-locator) |
| 59 | TelOne | telecom | Runhare House, 107 Kwame Nkrumah Ave (head office) | Fourth Street/ S.V Muzenda | 4138 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=17694) |
| 60 | Edgars | department | Cnr First St / Jason Moyo Ave | Jason Moyo Avenue | 2179 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=10305) |
| 61 | Edgars | department | Cnr Robert Mugabe Rd / Angwa St | Robert Mugabe Road; Sir Seretse Khama Street | 2527 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=10304) |
| 62 | Edgars | department | ZB Centre, cnr First St / Kwame Nkrumah Ave | First Street Mall; Kwame Nkrumah (Union) Avenue | 2014 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=10299) |
| 63 | Edgars | department | Eastgate, cnr Robert Mugabe Rd / Sam Nujoma St | Robert Mugabe Road | 2233 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=10308) |
| 64 | Jet | clothing | Cnr First St & George Silundika Ave (opened Feb 2022) | First Street Mall | 2187 | [allafrica.com](https://allafrica.com/stories/202202250610.html) |
| 65 | Jet | clothing | First St / Speke Ave (the older First Street Jet) | Agostinho Neto Avenue; First Street Mall | 2160 | [allafrica.com](https://allafrica.com/stories/202202250610.html) |
| 66 | Jet | clothing | Cameron St | Joseph Msika Street | 2972 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=10293) |
| 67 | Jet | clothing | Speke Ave | Agostinho Neto Avenue | 2172 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=10229) |
| 68 | Truworths | clothing | Batanai Gardens, First St | First Street Mall | 2182 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=7616) |
| 69 | Bata | shoes | 50 Nelson Mandela Ave | Nelson Mandela Avenue | 2067 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=3563) |
| 70 | Topics | clothing | Cnr Robson Manyika Ave / Angwa St | Robson Manyika Avenue; Sir Seretse Khama Street | 2518 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=14439) |
| 71 | Topics | clothing | George Silundika Ave / First St | First Street Mall; George Silundika Drive | 2070 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=14426) |
| 72 | Topics | clothing | Angwa City, cnr Julius Nyerere Way / Angwa St | Sir Seretse Khama Street | 2040 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=14419) |
| 73 | TV Sales & Home | furniture | 63 Nelson Mandela Ave, cnr First St (Africa Unity Square branch) | First Street Mall; Nelson Mandela Avenue | 2063 | [tvsales.co.zw](https://tvsales.co.zw/contact-deals/) |
| 74 | TV Sales & Home | furniture | Batanai Gardens, 59 Jason Moyo Ave | Jason Moyo Avenue | 2182 | [tvsales.co.zw](https://tvsales.co.zw/contact-deals/) |
| 75 | TV Sales & Home | furniture | Zimbank House, cnr First St & Speke Ave (factory shop) | Agostinho Neto Avenue; First Street Mall | 2162 | [tvsales.co.zw](https://tvsales.co.zw/contact-deals/) |
| 76 | TV Sales & Home | furniture | 92 Robert Mugabe Rd | Robert Mugabe Road | 2228 | [tvsales.co.zw](https://tvsales.co.zw/contact-deals/) |
| 77 | TV Sales & Home | furniture | Megawatt House, cnr Samora Machel Ave & Leopold Takawira St | Samora Machel Avenue | 1304 | [tvsales.co.zw](https://tvsales.co.zw/contact-deals/) |
| 78 | Gain Cash & Carry | wholesale | 104 Chinhoyi St (Chinhoyi Street branch), beside the Zuva forecourt | Chinhoyi Street | 2799 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=16043) |
| 79 | Electrosales | hardware | 85 Cameron St | Joseph Msika Street | 2606 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=19309) |
| 80 | Greenwood Pharmacy | pharmacy | Hughes House, Kwame Nkrumah Ave / 22 Park St | Kwame Nkrumah (Union) Avenue | 1239 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=15240) |
| 81 | Greenwood Pharmacy | pharmacy | Grayhurst Building, cnr Fourth St & Nelson Mandela Ave | Fourth Street; Nelson Mandela Avenue | 4076 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=13021) |
| 82 | Chicken Inn | fast_food | Cnr Bank St & 119 Mbuya Nehanda St (branch 'Sakunda') | Bank Street; Mbuya Nehanda Street | 2912 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 83 | Chicken Inn | fast_food | Hughes House, cnr Kwame Nkrumah Ave & Park St (branch 'Hughes') | Kwame Nkrumah (Union) Avenue; Park Street | 1241 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 84 | Chicken Inn | fast_food | AMC, cnr Julius Nyerere Way & Kwame Nkrumah Ave (branch 'AMC') | Julius Nyerere Way; Kwame Nkrumah (Union) Avenue | 2043 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 85 | Pizza Inn | fast_food | AMC, cnr Julius Nyerere Way & Kwame Nkrumah Ave | Kwame Nkrumah (Union) Avenue | 1284 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 86 | Creamy Inn | fast_food | AMC, cnr Julius Nyerere Way & Kwame Nkrumah Ave | Julius Nyerere Way; Kwame Nkrumah (Union) Avenue | 2043 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 87 | Chicken Inn | fast_food | Cnr Speke Ave & Inez Terrace (branch 'Speke') | Agostinho Neto Avenue; Mayor Urimbo Terrace | 2544 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 88 | Nando's | fast_food | Speke food court, cnr Speke Ave & Inez Terrace | Agostinho Neto Avenue; Mayor Urimbo Terrace | 2544 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=13989) |
| 89 | KFC | fast_food | Joina City, cnr Inez Terrace & Speke Ave | Agostinho Neto Avenue; Mayor Urimbo Terrace | 2123 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=19417) |
| 90 | Chicken Inn | fast_food | Cnr Samora Machel Ave & Fifth St (branch 'Samora') | Fifth Street | 4332 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 91 | Pizza Inn | fast_food | Cnr Samora Machel Ave & Fifth St | Fifth Street | 4332 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 92 | Bakers Inn | bakery | Cnr Samora Machel Ave & Fifth St | Fifth Street | 4332 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 93 | Chicken Inn | fast_food | Roadport, cnr Fifth St & Robert Mugabe Rd (branch 'Road Port') | Fifth Street | 3942 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 94 | Chicken Inn | fast_food | 105 Robert Mugabe Rd (branch '105 R G Mugabe') | Robert Mugabe Road | 2234 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 95 | Creamy Inn | fast_food | 105 Robert Mugabe Rd | Robert Mugabe Road | 2234 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 96 | Pizza Inn | fast_food | 106 Robert Mugabe Rd | Robert Mugabe Road | 2234 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 97 | Chicken Inn | fast_food | Ottawa House, Angwa St / Robson Manyika Ave (branch 'Angwa') | Robson Manyika Avenue; Sir Seretse Khama Street | 2521 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 98 | Chicken Inn | fast_food | First St (branch 'First'; Chicken Inn, Bakers Inn, Creamy Inn, Pizza Inn counters) | First Street Mall | 2063 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 99 | Pizza Inn | fast_food | First St | First Street Mall | 2063 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 100 | Chicken Inn | fast_food | Construction House, Leopold Takawira St (branch 'Construction Hse') | Leopold Takawira Street | 1204 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 101 | Chicken Inn | fast_food | Julius Nyerere Way (branch 'J Nyerere') | Julius Nyerere Way | 2584 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 102 | Bakers Inn | bakery | Throgmorton House, cnr Samora Machel Ave & Julius Nyerere Way | Julius Nyerere Way; Samora Machel Avenue | 2031 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 103 | Chicken Inn | fast_food | Fife Avenue Shopping Centre (branch 'Five Avenue') | Leonid Brezhnev Street | 7475 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 104 | Pizza Inn | fast_food | Fife Avenue Shopping Centre, cnr Fife Ave & Sixth St | Leonid Brezhnev Street; Sixth Street | 7475 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 105 | Nando's | fast_food | 142 Samora Machel Ave | Samora Machel Avenue | 4350 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=13987) |
| 106 | Chicken Slice | fast_food | Seventh St / Samora Machel Ave | Liberation Legacy Way | 4773 | [waze.com](https://www.waze.com/live-map/directions/zw/harare-province/harare/chicken-slice?to=place.ChIJxS4FXt6kMRkRl5EQ9zjMDw8) |
| 107 | Chicken Slice | fast_food | Cnr Kwame Nkrumah (Union) Ave, Chinhoyi & Mbuya Nehanda St | Chinhoyi Street; Mbuya Nehanda Street | 1072 | [x.com](https://x.com/ChickenSliceog/status/1271076436162613248) |
| 108 | Chicken Slice | fast_food | Cnr George Silundika Ave & Angwa St | George Silundika Drive; Sir Seretse Khama Street | 2091 | [zimbabwe-streets.openalfa.com](https://zimbabwe-streets.openalfa.com/harare-province/eating-drinking) |
| 109 | Chicken Slice | fast_food | 87 Mbuya Nehanda St, cnr Bank St | Mbuya Nehanda Street | 2901 | [chickenslice.com](https://chickenslice.com/store/chicken-slice-bank-street/) |
| 110 | Chicken Slice | fast_food | 126 Mbuya Nehanda St | Mbuya Nehanda Street | 2643 | [waze.com](https://www.waze.com/live-map/directions/zw/harare-province/harare/chicken-slice-mbuya-nehanda?to=place.ChIJ7TBI48KkMRkRyxMmusHcjvg) |
| 111 | Creamy Inn | fast_food | Fife Avenue Shopping Centre (Simbisa 'Five Avenue') | Fifth Street | 6828 | [simbisabrands.com](https://www.simbisabrands.com/store-locator/zimbabwe/) |
| 112 | Hungry Lion | fast_food | Eastgate Mall shop 24, ground floor, Sam Nujoma St | Sam Nujoma Street (2nd Street) | 2232 | [stores.hungrylion.co.zw](https://stores.hungrylion.co.zw/) |
| 113 | TotalEnergies | fuel | 12 Samora Machel Ave (TotalEnergies Samora 1) | Samora Machel Avenue | 1393 | [waze.com](https://www.waze.com/live-map/directions/zw/harare-province/harare/totalenergies-service-station-samora-1?to=place.ChIJzQqXhfykMRkRHIuAq00HlM0) |
| 114 | TotalEnergies | fuel | 36 Robert Mugabe Rd, cnr Chinhoyi St (TotalEnergies Chinhoyi Street) | Chinhoyi Street | 2785 | [wanderlog.com](https://wanderlog.com/place/details/11679315/totalenergies-service-station-chinhoyi-street) |
| 115 | TotalEnergies | fuel | Kwame Nkrumah (Union) Ave, cnr Sam Nujoma St | Sam Nujoma Street (2nd St. Extension) | 2001 | [aazimbabwe.co.zw](https://www.aazimbabwe.co.zw/24-hour-fuel-stations/) |
| 116 | Zuva | fuel | Samora Machel Ave / Fourth St | Fourth Street | 4240 | [vymaps.com](https://vymaps.com/ZW/Harare/petrol-station/) |
| 117 | Zuva | fuel | 100 Chinhoyi St (-17.835403, 31.043188); kiosk at the back of the forecourt | Chinhoyi Street | 2801 | [zw.near-place.com](https://zw.near-place.com/gas_station-nearby-zuva-chinhoyi-street-100-chinhoyi-street-harare) |
| 118 | Engen | fuel | 18 Robert Mugabe Rd (Engen Corner) | Robert Mugabe Road | 2836 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=17223) |
| 119 | Engen | fuel | 95 Speke Ave / Fourth St (Engen Fourth Street) | Fourth Street/ S.V Muzenda | 3869 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=17255) |
| 120 | Engen | fuel | 85-87 Leopold Takawira St (Engen Takawira) | Leopold Takawira Street | 2564 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=17238) |
| 121 | Puma | fuel | 159 Samora Machel Ave, cnr Seventh St | Samora Machel Avenue | 4494 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=7171) |
| 122 | Puma | fuel | 77 Kwame Nkrumah Ave / Sam Nujoma St (Second Street branch) | Sam Nujoma Street (2nd Street) | 1997 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=18229) |
| 123 | Hyatt Regency Harare The Meikles | hotel | Cnr Jason Moyo Ave & Third St, facing Africa Unity Square | Jason Moyo Avenue | 3837 | [hyatt.com](https://www.hyatt.com/hyatt-regency/en-US/hrerh-hyatt-regency-harare-the-meikles/hotel-info) |
| 124 | MEIKLES HOTEL (tower letters) | hotel | rooftop letters 'MEIKLES HOTEL' on the south wing (photo 2008) | Agostinho Neto Avenue | 3835 | [commons.wikimedia.org](https://commons.wikimedia.org/wiki/File:Eastgate_Centre,_Harare,_Zimbabwe.jpg) |
| 125 | Monomotapa Hotel | hotel | 54 Park Lane | Jomo Kenyatta Lane | 1679 | [africansunhotels.com](https://www.africansunhotels.com/hotels/6/monomotapa) |
| 126 | MONOMOTAPA (tower letters) | hotel | rooftop letters (CROWNE PLAZA MONOMOTAPA in 2010-12; the hotel now trades as the Monomotapa) | Jomo Kenyatta Lane | 1679 | [flickr.com](https://www.flickr.com/photos/47293505@N06/4813530610) |
| 127 | Holiday Inn | hotel | Samora Machel Ave & Fifth St | Fifth Street | 4529 | [ihg.com](https://www.ihg.com/holidayinn/hotels/us/en/harare/harsf/hoteldetail) |
| 128 | Rainbow Towers Hotel & Conference Centre | hotel | 1 Pennefather Ave |  | 991 | [expedia.com](https://www.expedia.com/Harare-Hotels-Rainbow-Towers-Hotel.h1506424.Hotel-Information) |
| 129 | Cresta Jameson | hotel | Cnr Samora Machel Ave & Park St | Park Street; Samora Machel Avenue | 1255 | [crestahotels.com](https://www.crestahotels.com/hotels/zimbabwe/cresta-jameson) |
| 130 | Cresta Oasis | hotel | 124 Nelson Mandela Ave | Nelson Mandela Avenue | 4584 | [hotelplanner.com](https://www.hotelplanner.com/Hotels/258659/Reservations-Cresta-Oasis-Harare-124-Nelson-Mandela-Ave-) |
| 131 | N1 Hotel | hotel | 126 Samora Machel Ave (N1 Hotel Samora Machel; OSM building 'N1 Hotel') | Samora Machel Avenue | 4227 | [tripadvisor.com](https://www.tripadvisor.com/Hotel_Review-g293760-d6850412-Reviews-N1_Hotel_Samora_Machel_Harare-Harare_Harare_Province.html) |
| 132 | New Ambassador Hotel | hotel | 88 Kwame Nkrumah Ave | Kwame Nkrumah Avenue | 1936 | [hotelplanner.com](https://www.hotelplanner.com/Hotels/258669/Reservations-New-Ambassador-Hotel-Harare-88-Kwame-Nkrumah-Ave-00000) |
| 133 | Bronte Hotel | hotel | 132 Baines Ave (cnr Simon Muzenda / Fourth St) | Herbert Ushewokunze Avenue | 6772 | [brontehotel.com](https://brontehotel.com/contact-us/) |
| 134 | SSC (tower letters) | office | vertical letters 'SSC' high on the Social Security Centre (NSSA) tower (photo 2019) | Julius Nyerere Way | 1869 | [flickr.com](https://www.flickr.com/photos/39267804@N05/) |
| 135 | Eastgate | mall | Eastgate Centre, cnr Robert Mugabe Rd & Sam Nujoma St | Robert Mugabe Road; Sam Nujoma Street (2nd Street) | 2233 | [en.wikipedia.org](https://en.wikipedia.org/wiki/Eastgate_Centre,_Harare) |
| 136 | Herald House (ZIMPAPERS) | office | Cnr George Silundika Ave & Sam Nujoma St (Zimpapers) | George Silundika Drive | 2199 | [zimpapers.co.zw](https://www.zimpapers.co.zw/contact-us/) |
| 137 | Main Post Office (ZIMPOST) | courier | Cnr Julius Nyerere Way / Nelson Mandela Ave (Zimpost) | Julius Nyerere Way | 2107 | [thedirectory.co.zw](https://thedirectory.co.zw/branch.cfm?branchid=17695) |
| 138 | Galaxy Mall | mall | Cnr First St & Jason Moyo Ave (the former Barbours department store building) | First Street Mall | 2183 | [heraldonline.co.zw](https://www.heraldonline.co.zw/harares-property-repurposing-renaissance/) |

## 8. Known gaps and open questions

- **Mapped signs are not individually verified.** 1 353 entries come from Overture (mostly business-owned Meta pages) and
  OSM after the automatic checks. Harare's CBD really is this dense (mini-malls with dozens of phone, clothing and
  electronics booths), but expect some closed or relocated businesses. Upstairs tenants are boards, and interior mall
  tenants (Joina City, Eastgate, Gulf, Ximex… shop numbers) are left out unless they are chains.
- Corner blocks of "moved" places (146) are a best guess among the four corners of the junction.
- Not placed for lack of a position: OK Julius Nyerere (stand 2326A), TM Pick n Pay Kenneth Kaunda and Orr Street,
  Edgars Cameron St, Truworths Takura House (69/71 Union Ave), Greenwood Angwa House / 89C Leopold Takawira / 91 Bank St,
  Food World Express (108 Cameron St), TV Sales & Home Orr St / Bank St / 9 Mbuya Nehanda, Metbank Kwame Nkrumah and
  Sam Nujoma branches, Gain Cash & Carry Mega (cnr Sam Nujoma / South Ave: corner unknown), Chicken Inn "Lister",
  "Tote House", "Westend", "Walktall" and "Rezende" (Simbisa branch names without an address).
- Colours marked *unverified* / *approx* in §6 (OK, TM Pick n Pay hexes, Agribank, POSB, TelOne, CABS today, Crown
  Bank, Sai Mart, Gain, Topics, Truworths, Greenwood, Metbank, ZWMB, hotels other than Monomotapa / Holiday Inn /
  Cresta) could not be sampled: the official sites were unreachable from the build machine (proxy / TLS errors) and
  Wikimedia was rate-limiting. A single street photo per brand would settle them.
- **Old Mutual Centre** board (§7 #46) sits on the low footprint between Third St and the tower (`b` 3838), not on the
  `old_mutual_centre` landmark (`b` 4121), which has no street frontage in the map. Research coordinates
  (-17.829444, 31.053333) put the centre ~25 m east of the board, so it reads as the tower's podium.
- **Ster Kinekor** (OSM point by Eastgate, 105 Robert Mugabe Rd) may be closed: [moviebuff](https://www.moviebuff.com/ster-kinekor-eastgate-fantasyland-complex)
  lists the Eastgate cinema as closed, while Ster-Kinekor Zimbabwe still runs Joina City. Not confirmed, so kept.
- The **Econet franchise** positions (Brand Digital, CellTrade, Brimas, Globtech, Media Connect) come from the Econet
  locator's coordinates; the locator loads client-side and could not be re-read during review.
- Tower-top names are only the three with photographic evidence (MEIKLES HOTEL, MONOMOTAPA, SSC) plus JOINA CITY in
  `landmarks.js`. Candidates seen in older photos but not confirmed today: "OLD MUTUAL" (a 2005 roof sign on a beige
  slab west of Sam Nujoma St) and "INTERMARKET LIFE TOWERS" (now ZB Life Towers, current lettering unknown).
- Six signs have `road: ""` (their frontage faces an unnamed carriageway), Rainbow Towers among them: its footprint is
  set back and `harare.json` has no named road within ~140 m.
- The Bronte Hotel sign sits on the OSM "Bronte Hotel" block facing Baines Ave (Herbert Ushewokunze), 60–80 m back from
  the kerb across the garden; a gate sign on the street would read better.
- Speke Ave has no carriageway in the map where it crosses First Street (pedestrianised); the signs there face open
  paving.

## 9. Licences and attribution

- Overture Maps places: CDLA-Permissive-2.0 (records from Meta, Microsoft, AllThePlaces, Foursquare). Attribution:
  "© Overture Maps Foundation".
- OpenStreetMap: ODbL 1.0, "© OpenStreetMap contributors". `shops.json` is a derived database of OSM data, so the ODbL
  share-alike terms apply to it; the attribution is in its `source` field. Add both lines to the game's credits
  screen / CREDITS file alongside the map attribution already required for `harare.json`.
- `public/data/CREDITS-shops.md` records these sources, authors and licences for `shops.json`; the in-game credits
  (`src/ui/credits.js`) already carry "© OpenStreetMap contributors (ODbL)" and "© Overture Maps Foundation".
- Web research (branch lists, addresses, colour values) is factual information cited per row above; no text, image or
  logo from those sites is shipped. Brand names appear as plain text in brand colours only — no logos or trademarked
  artwork are reproduced.
