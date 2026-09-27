# Harare CBD: landmark reference notes

Reference notes for modelling the landmark buildings and places of central Harare in the game. The notes cover heights, massing, facades, roofs and locations. The machine-readable version is `tools/landmark_overrides.json`, which `tools/build_map.py` consumes: every `landmarks[]` entry matches an Overture footprint by `match.overture_id`, and `places[]` become map features.

**How this was researched (read before trusting a number).** The container could only run web searches. Wikipedia, Commons, OSM and similar sites could not be fetched. The facts below therefore come from search-result snippets from the sources listed per entry, from the Overture 2026-09-23.0 extract (footprints, OSM heights and names), and from general knowledge. The research focused on heights, floors, dates and addresses, and most of those are sourced. The facade colours are hex guesses and should be checked against photos. Anything marked *approx.* or *assumed* is an estimate.

Each JSON entry carries two confidence values:

- `confidence` covers the height or floors and the footprint match.
- `style_confidence` covers the facade, colour and roof notes.

## Contents

1. [Street-name concordance](#1-street-name-concordance)
2. [General CBD architectural character](#2-general-cbd-architectural-character)
3. [Summary table](#3-summary-table)
4. [Landmark notes](#4-landmark-notes)
5. [Places (parks, squares, ranks, monuments)](#5-places)
6. [Researched but not placed / open questions](#6-researched-but-not-placed--open-questions)
7. [Sources](#7-sources)

---

## 1. Street-name concordance

Statutory Instrument 167 of 2020 renamed many Harare streets, and Overture/OSM mostly uses the new names. Locals, and most addresses found online, still use the old ones. Use both names in signage and dialogue where it helps.

| Common name (addresses) | Overture / current name | Notes |
|---|---|---|
| Samora Machel Ave (ex Jameson Ave) | Samora Machel Avenue | The main E-W boulevard of tall towers (RBZ, Karigamombe, Livingstone House) |
| Kwame Nkrumah Ave (ex Union Ave) | Kwame Nkrumah (Union) Avenue | |
| Nelson Mandela Ave (ex Baker Ave) | Nelson Mandela Avenue | North side of Africa Unity Square |
| George Silundika Ave (ex Gordon Ave) | George Silundika Avenue / Drive | |
| Jason Moyo Ave (ex Stanley Ave) | Jason Moyo Avenue | South side of Africa Unity Square |
| Speke Ave | **Agostinho Neto Avenue** | Renamed 2020 |
| Robert Mugabe Rd (ex Manica Rd) | Robert Mugabe Road | Eastgate frontage |
| Julius Nyerere Way (ex Kingsway) | Julius Nyerere Way | N-S spine: Joina City, Town House, Karigamombe |
| Second St | Sam Nujoma Street | |
| Third St | **Patrice Lumumba Street** | Renamed 2020 |
| Fourth St | Simon Vengai Muzenda St ("Fourth Street/ S.V Muzenda") | Fourth Street rank |
| First St | First Street / First Street Mall | Pedestrian mall south of Kwame Nkrumah |
| Angwa St | **Sir Seretse Khama Street** | Renamed 2020 |
| Park Lane | Jomo Kenyatta Lane *(probable rename)* | Monomotapa Hotel, Harare Gardens |
| Inez Terrace | Mayor Urimbo Terrace *(probable)* | Main Post Office, Charge Office |
| Rotten Row | Abdel Gamal Nasser Road *(probable)* | ZANU-PF HQ, courts, library |
| Central Ave | Ahmed Ben Bella Avenue *(probable)* | Kaguvi Building |
| Livingstone Ave | Oliver Tambo Avenue *(probable)* | Mukwati Building |
| Pioneer St / Victoria St / Sinoia St | Kaguvi St / Mbuya Nehanda St / Chinhoyi St | Kopje-side old town |
| Railway Ave | Kenneth Kaunda Avenue | Station |

The grid geometry comes from the Overture segments and building footprints:

- **Grid rotation.** The grid is rotated about 14° anticlockwise from true east. Avenues run WSW to ENE (bearing about 76°) and streets run NNW to SSE (bearing about 346°).
- **Street footprints.** Building footprints report long-axis angles of 14°, 104° and -166°. Buildings should be aligned to those angles, not to north.
- **Block size.** Avenues are about 124 m apart. Streets are about 130 to 175 m apart. A typical block is therefore about 125 × 150 m.
- **Origin.** The map origin is Africa Unity Square (-17.8293, 31.0520).

## 2. General CBD architectural character

Sources for this section: kupi.com history, the Wikipedia "Causeway, Harare" article, zimfieldguide, newZWire, and general knowledge. Colour hexes are guesses.

**Zones, from west to east:**

- **The Kopje side (west and south-west).** This covers Kaguvi St, Mbuya Nehanda St, Harare St, Chinhoyi St and the western end of Robert Mugabe Rd. It is the oldest part of Salisbury, where the town was founded in 1890 at the foot of the Kopje.
  - The buildings are mostly 1-2 storey colonial commercial blocks, many with **cast-iron or timber verandahs** that roof the sidewalk: corrugated-iron verandah roofs on thin posts.
  - Facades are face brick and painted render. Roofs are corrugated iron or hidden behind parapets.
  - There are wholesale shops, hardware and auto-parts dealers, and the Copacabana and Market Square kombi ranks.
  - A few 1950s-70s 4-8 storey blocks stand among them.
  - The street feels chaotic and dense at ground level: hawkers, handcarts and kombis double-parked.
- **The commercial core.** This runs between Julius Nyerere Way and Fourth St, and between Samora Machel Ave and Robert Mugabe Rd.
  - It mixes **1950s-60s Federation-era modernist slabs** (8-20 storeys, e.g. Livingstone House, Pearl House) with **1980s-90s post-independence towers** (Karigamombe, Old Mutual Centre, RBZ, ZB Life, Eastgate, Joina City).
  - Between the towers stand 3-6 storey 1930s-50s blocks with shops at street level.
  - **Samora Machel Ave** is the skyline spine. The three tallest towers of 1985-2000 by the architects Clinton & Evans (Karigamombe Centre, the RBZ and Millennium Towers) stand here. Their trademark materials were black or polished granite with flush glazing.
- **Causeway (east and north-east).** This is the government district, on the site of the first drained land by the stream along what is now Julius Nyerere Way.
  - It contains ministries in long slab blocks (Kaguvi, Mukwati, Chaminuka, Compensation House), the courts (the High Court and the Civil Courts), the old Parliament, the National Gallery and the cathedrals.
  - Wikipedia describes it as the densest built area in Zimbabwe because of the high-rises and apartment towers of the 1950s, 60s and 90s.
- **South of Robert Mugabe Rd towards the railway (Kenneth Kaunda Ave).** Warehouses, workshops and 1-3 storey wholesalers dominate here. The Charge Office (central police), the Charge Office rank, Roadport and the Fourth Street rank sit at the edges, with the railway station at the bottom of Sam Nujoma St.
- **North of Herbert Chitepo / Selous Ave (the Avenues).** This is residential: 1-4 storey flats and old bungalows turned into offices and clinics, jacaranda-lined streets, and Harare Gardens and Greenwood Park.

**Typical heights for procedural fill** (*approx.*; use them for blocks without OSM data):

| Zone | Typical | Range |
|---|---|---|
| Kopje side / western CBD | 2 storeys (8 m) | 1-4 storeys, a few 8-10 |
| Core blocks off Samora Machel | 5-8 storeys (18-28 m) | 3-20 |
| Samora Machel / Julius Nyerere frontage | 12-20 storeys | up to 28 (RBZ 120 m) |
| Causeway government | 6-12 storeys | slabs 18-21 storeys (73-76 m) |
| South of Robert Mugabe Rd | 1-3 storeys | warehouses 8-12 m |
| Avenues | 2-4 storeys | a few 8-12 storey flats |

**Materials and colours** (all *approx.*):

- **Walls.**
  - Painted render in off-white or cream `#e8e2d4`, sandy beige `#d6c7a8` and light ochre `#d9c08a`.
  - Grey precast concrete `#bdb8ae`, sometimes weathered darker with rain streaks `#9d988f`.
  - Brown or red face brick `#8a5a44` and `#9a5b3c`.
  - Local granite from pink-grey `#a89f98` to near-black `#2b2b2e` (the Clinton & Evans towers).
  - 1950s blocks often have pastel spandrel panels in mint `#b9d3c3`, powder blue `#b7c9d6` or salmon `#e0b39a`, and mosaic tiles.
- **Glazing.**
  - 1950s-70s: clear or slightly green glass in steel frames, with horizontal ribbon windows between concrete spandrel bands and sometimes brise-soleil fins.
  - 1980s-2010: tinted bronze `#4a3b2e`, dark grey-blue `#2f3f4f`, green `#4f6f6a` or gold-mirror `#c8a24a` (Rainbow Towers) curtain or strip glazing.
- **Ground floor.**
  - Continuous shopfronts with painted fascia signs and hand-painted lettering.
  - Roll-down steel shutters and security grilles.
  - Arcades through the blocks, and cantilevered concrete canopies or verandahs over the pavement.
  - Brand signage for Econet (blue), OK, TM Pick n Pay, CABS, CBZ, ZB, Edgars, Bata, Chicken Inn and Pizza Inn (Innscor red and yellow).
- **Rooftops.**
  - Flat roofs with lift overruns, water tanks on steel stands, satellite dishes, antenna masts and billboard frames.
  - Big rooftop name signs on the towers: OLD MUTUAL, the MEIKLES hotel sign, the HOLIDAY INN green logo, the RBZ crown.
  - Colonial low-rises have red, green or grey corrugated-iron hipped roofs `#8e3b2e` / `#3f5f3a` / `#8a8d8f`.
- **Street greenery.** There are jacarandas (purple `#8a6bbe`, flowering Sept-Nov), flame trees, palms along some boulevards, msasa trees on the Kopje, and lawns in Africa Unity Square and Harare Gardens.
- **Street life.** Kombis (white Toyota HiAce minibuses) cluster around the ranks. Vendors' tables and umbrellas line First St, Robert Mugabe Rd and the ranks. Julius Nyerere Way at Samora Machel now has pedestrian footbridges (2021-22).

---

## 3. Summary table

"conf" gives the height/match confidence first and the style confidence second. Entries with `part_of` in the JSON are extra footprints (podiums, wings, cores) of the landmark named there.

| key | name | height m | floors | year | Overture id | conf (h / style) |
|---|---|---|---|---|---|---|
| `rbz` | Reserve Bank of Zimbabwe | 120 | 28 | 1997 | `135760d3` | high / medium |
| `rbz_podium` | RBZ podium | 20 | 5 | 1997 | `0dd9bf4b` | medium / low |
| `joina_city` | Joina City (tower) | 105 | 24 | 2010 | `c02aad16` | high / medium |
| `joina_city_podium` | Joina City mall podium | 22 | 5 | 2010 | `cc9964a4` | medium / low |
| `karigamombe` | Karigamombe Centre | 92 | 20 | 1985 | `30e93056` | high / low |
| `livingstone_house` | Livingstone House | 80 | 20 | 1960 | `d39bca33` | high / low |
| `livingstone_house_podium` | Livingstone House podium | 12 | 3 | - | `056d56bf` | low / low |
| `mukwati` | Mukwati Building (≈ "Earl Grey Building") | 76 | 21 | - | `cadc33d0` | high / low |
| `kaguvi` | Kaguvi Building | 73 | 18 | - | `35afc071` | high / low |
| `old_mutual_centre` | Old Mutual Centre | 72 | 18 | - | `ba5d9248` | medium / low |
| `defence_house` (+`_core`) | Defence House | 71 (core 77.5) | 20 | - | `eb21c32f` | medium / low |
| `zb_life_towers` | ZB Life Towers | 66 | 19 | - | `f1efdd93` | medium / low |
| `century_towers` | Century Towers | 64 | 18 | - | `7a4dcaee` | medium / low |
| `monomotapa` | Monomotapa Hotel | 62 | 19 | 1974 | `51104f8b` | medium / medium |
| `pearl_house` | Pearl (Assurance) House | 58 | 17 | 1959 | `2fcf0ef2` | low / low |
| `social_security_centre` | Social Security Centre (NSSA) | 58 | 16 | - | `4536040b` | low / low |
| `zanu_pf_hq` | ZANU-PF HQ ("Shake Shake") | 58 | 15 | 1990 | `fecdb06c` | medium / low |
| `compensation_house` (+`_core`, `_wing`) | Compensation House (probable) | 58.7 (70 / 45.2) | 17 | - | `bf3dc8ff` | low / low |
| `angwa_city` (+`_annex`) | Angwa City | 50 (46) | 12 | - | `139d1bfd` | medium / medium |
| `construction_house` | Construction House | 44 | 12 | - | `aeb51053` | low / low |
| `runhare_house` | Runhare House | 43 | 12 | - | `f3997add` | medium / low |
| `meikles` (+`_south`) | Meikles Hotel (Hyatt Regency) | 43 (42) | 13 (12) | 1976/80 | `e22c478a` | medium / low |
| `chiyedza_house` | Chiyedza House | 42 | 12 | - | `819a6e3c` | medium / low |
| `electra_house` | Electra House | 42 | 12 | - | `79f1011e` | medium / low |
| `chaminuka_building` | Chaminuka Building | 38.3 | 11 | - | `e9528786` | low / low |
| `holiday_inn` | Holiday Inn Harare | 38 | 11 | - | `4f446f0d` | low / low |
| `eastgate` (+`_block_n`, `_block_s`) | Eastgate Centre | atrium 22, blocks 33 (+chimneys) | 9 | 1996 | `85a3b9cc` | high / high |
| `rainbow_towers` | Rainbow Towers Hotel & HICC | complex 24, tower 75 (synthetic) | 19 | 1985 | `9db2ac07` | medium / medium |
| `munhumutapa_building` | Munhumutapa Building (OPC) | 20 | 5 | - | `bc535a44` | low / low |
| `main_post_office` | Harare Main Post Office | 18 | 4 | - | `4dc8db31` | low / low |
| `parliament_house` (+`_annex`) | Old Parliament House | 15 (18) | 3 (5) | 1899 | `d9f9a3a0` | medium / low |
| `anglican_cathedral` | Cathedral of St Mary & All Saints | 16 (tower ~28) | 1 | 1913-61 | `9a46dbf1` | medium / medium |
| `town_house` | Harare Town House | 14 (clock tower ~26) | 2 | 1933 | `3edd0d5d` | medium / medium |
| `sacred_heart_cathedral` | Cathedral of the Sacred Heart | 14 (towers ~24) | 1 | 1925 | `0f116200` | medium / medium |
| `national_gallery` | National Gallery of Zimbabwe | 10 | 2 | 1957 | `16ad6b4e` | high / medium |
| `harare_station` | Harare Railway Station | 10 | 2 | - | `effddafc` | medium / low |

**Known Overture data errors that the overrides fix:**

- **Karigamombe.** Overture has 8 floors; the building has 20 floors and is 92 m.
- **Joina City.** Overture has no height; the tower is 105 m.
- **RBZ.** Overture has 18 floors, but 120 m is right; the tower has 28 floors.
- **Livingstone House, Century Towers, the Monomotapa and the NSSA.** Overture has no height for any of them.
- **Rainbow Towers.** A single 1.3 ha footprint merges the hotel and the HICC. The JSON keeps that footprint at conference-centre height and adds a `synthetic_parts` hotel tower.
- **Eastgate.** Overture's "Eastgate Market" (`84c5496c`, 12,249 m², SE of Robert Mugabe Rd × Third St) is **not** the Eastgate Centre. The Centre is the two slabs plus the atrium listed above.

---

## 4. Landmark notes

The coordinates are Overture footprint centroids.

### Reserve Bank of Zimbabwe: `rbz` (Overture `135760d3-d950-40fa-9374-9a624e30a98e`)

- **Location.** 80 Samora Machel Ave, north side, between First St and Sam Nujoma St (-17.82615, 31.04947).
- **Size and date.** 120 m, 28 storeys: 5 podium levels and 23 office floors. Built 1993-1997. It has been the tallest building in Zimbabwe since 1997.
- **Architect.** Clinton & Evans (Marjem Chatterton) won the late-1980s design competition.
- **Concept.** The design is modelled on the **conical tower of Great Zimbabwe** and on a grain silo: a broad base tapering toward the top. It symbolises food reserves kept against drought.
- **Materials.** The walls are **polished granite, etched with images of rural Zimbabwe**. A car-park annex sits behind the tower.
- **Massing for the game.**
  - The OSM footprint is a 37 × 37 m chamfered square with 9 vertices.
  - Extrude it straight to about 85 m, then taper or step back in 2-3 setbacks to about 110 m.
  - Finish with a narrow crown and a mast to 120 m.
  - Add a 20 m granite podium on the adjoining footprint `0dd9bf4b` (`rbz_podium`).
- **Facade.** Vertical granite piers `#b8a99c` with narrow recessed dark-glass strips `#26323b`, giving a vertical "fin" read. The podium is heavier stone with etched relief panels.
- **Style check.** The exact taper shape and granite tint are *approx.*; check them against photos.
- **Sources.** [Wikipedia: New Reserve Bank Tower](https://en.wikipedia.org/wiki/New_Reserve_Bank_Tower), [Skyscraper Center](https://www.skyscrapercenter.com/building/new-reserve-bank-of-zimbabwe/4786), [SKYDB](https://www.skydb.net/building/801111770/), [Wikipedia: tallest buildings in Zimbabwe](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Zimbabwe), [Shades of Grey (Clinton & Evans brochure)](http://grevity.blogspot.com/2024/03/harare-buildings.html).

### Joina City: `joina_city` (tower `c02aad16-149d-4978-b37d-0bc0123c2d78`, podium `cc9964a4-086a-4722-85d3-883dbf9eb292`)

- **Location.** Corner of Jason Moyo Ave and Julius Nyerere Way (-17.83168, 31.04730).
- **Size and date.** 105 m. Sources say 24 floors: 3 basement parking levels (600 cars), 4 retail floors and 16 office floors. Construction began in 1998 (about US$27 m) and it opened in March 2010.
- **Owner and architect.** Owned by Masawara (ex-TA Holdings). The architect is credited as Vernon Mwamuka.
- **Massing.**
  - Mall podium of about 69 × 104 m, 22 m high (ground plus 4 retail floors), with wide glass roof-lights.
  - Office tower on a 33 × 32 m footprint.
  - Structure and Design magazine describes the tower: "the concrete form rises to a crescendo atop a circular ring under which the mass concrete structure evolves into concrete sheathed in glass". Model a pale concrete shaft, glazing that takes over toward the top, and a **circular ring crown**.
- **Colours (guesses).** Concrete `#dcd6ca`, glass blue-green `#3e6f80`, crown ring metal `#8f9aa1`. Large JOINA CITY signage.
- **Sources.** [Pindula](https://www.pindula.co.zw/Joina_City), [Structure & Design: Inside Joina City](https://structureanddesignzim.com/inside-joina-city/), [StartupBiz](https://startupbiz.co.zw/most-beautiful-buildings-in-harare/), [Wanderlog](https://wanderlog.com/place/details/11179169/joina-city), [SkyscraperPage forum](https://skyscraperpage.com/forum/showthread.php?s=18f4d53496f6caf2e9364f7ccc5fbaf9&p=10619487#post10619487).

### Karigamombe Centre: `karigamombe` (`30e93056-1f67-4e00-a0e4-1a81bd380433`)

- **Location.** 53 Samora Machel Ave, SE corner with Julius Nyerere Way (-17.82742, 31.04786).
- **Size and date.** 92 m, 20 floors, completed 1985, by Clinton & Evans. **Overture's `num_floors=8` is wrong.**
- **Massing and facade.** A slender point tower on a 26.5 × 22 m footprint, described as a combination of glass and concrete.
- **Occupants and neighbours.** NBS (National Building Society) lists this building as its address, and an "NBS Bank" footprint adjoins it. The **Mbuya Nehanda statue** and pedestrian footbridges are at this intersection.
- **Facade (guess, low confidence).** Light concrete `#cfc8bb` grid with dark glazing `#2d3a44`, and a flat roof with plant room.
- **Sources.** [SKYDB](https://www.skydb.net/building/263516490/karigamombe-centre/), [SkyscraperPage](https://skyscraperpage.com/cities/?buildingID=18373), [NBS FAQ (address)](https://www.nbs.co.zw/faq/), [Dreamstime photo](https://www.dreamstime.com/karigamombe-centre-exterior-harare-zimbabwe-exterior-view-karigamombe-centre-building-downtown-harare-zimbabwe-image202456297).

### Livingstone House: `livingstone_house` (`d39bca33-caf9-4f00-a7b5-44f3f7a7d67f`)

- **Location.** 30 Samora Machel Ave, north side, between Leopold Takawira St and Julius Nyerere Way (-17.82702, 31.04562).
- **Size and date.** 80 m, 20 floors, 1960. A 1960 press photo calls it the tallest building in the Federation of Rhodesia and Nyasaland. Classic 1969 photos look east down Jameson Ave from its roof.
- **Massing.** A modernist tower on a 32 × 27 m irregular footprint. The adjoining `056d56bf` (46 × 45 m) is treated as a 3-storey podium.
- **Facade (guess).** Off-white horizontal spandrel bands `#e3ddcf` with ribbon windows. Rooftop lift overrun and signage frame.
- **Sources.** [SKYDB](https://www.skydb.net/building/433077932/livingstone-house/), [SkyscraperPage](https://skyscraperpage.com/cities/?buildingID=18371), [1960 press photo (eBay)](https://www.ebay.com/itm/395671618122), [Wikipedia list](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Zimbabwe).

### Mukwati Building: `mukwati` (`cadc33d0-9a61-4c40-b86a-7728ce165e3e`) and Kaguvi Building: `kaguvi` (`35afc071-b1e5-46a5-8ecf-746b156fc9cd`)

- **Mukwati location.** Corner of Fourth St and Livingstone Ave (Oliver Tambo Ave), at -17.82224, 31.05371.
- **Kaguvi location.** Corner of Fourth St and Central Ave (Ahmed Ben Bella Ave), at -17.82364, 31.05409.
- **Sizes.**
  - Mukwati: 76 m, 21 floors.
  - Kaguvi: 73 m, 18 floors.
  - OSM gives both buildings 75 m.
- **Occupants.** Government ministries: Industry & Commerce and Home Affairs in Mukwati; Women Affairs and Justice in Kaguvi.
- **Massing.** The two are **near-identical parallel slabs** of 84 × 23.5 m, one block apart, long axes along the avenues. Build them with one kit.
- **Earl Grey Building.** Tallest-building lists include an "Earl Grey Building" at the same 76 m and 21 floors. One search summary equates it with Mukwati, so it is probably Mukwati's colonial name. Medium confidence.
- **Facade (guess).** Repetitive horizontal concrete bands `#c9bfae` with dark window strips.
- **Sources.** [SKYDB Mukwati](https://www.skydb.net/building/106190127/mukwati-building/), [Skyscraper Center](https://www.skyscrapercenter.com/building/mukwati-building/10206), [SKYDB Kaguvi](https://www.skydb.net/building/583713221/kaguvi-building/), [Wikipedia: Causeway](https://en.wikipedia.org/wiki/Causeway,_Harare), [Tripadvisor photo "Kaguvi and Mukwati Buildings with the RBZ"](https://www.tripadvisor.com/LocationPhotoDirectLink-g293760-i186850724-Harare_Harare_Province.html), [Top-10 list incl. Earl Grey Bldg](https://x.com/ny_emman/status/1860780519593537955).

### Old Mutual Centre: `old_mutual_centre` (`ba5d9248-6072-4901-aa4a-1e598b73a8f4`)

- **Location.** Corner of Jason Moyo Ave and Third St (Patrice Lumumba St), about 160 m east of Africa Unity Square (-17.82940, 31.05352).
- **Size.** 72 m and 18 storeys per the tallest-building lists; OSM gives 66 m. Footprint 40 × 28 m.
- **Facade (guess, low confidence).** Bronze-tinted glass grid `#4a3d30` with beige concrete `#c2b6a3`, and an OLD MUTUAL crown sign.
- **Sources.** [Wikipedia list](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Zimbabwe), [SkyscraperPage](https://skyscraperpage.com/b18372/harare/old-mutual-centre), [Old Mutual contacts](https://www.oldmutual.co.zw/contact-us).

### ZB Life Towers: `zb_life_towers` (`f1efdd93-9a1d-4e9e-b9bd-7247c5c5dd42`)

- **Location.** 77 Jason Moyo Ave. The footprint sits by Sam Nujoma St and Speke Ave (-17.83077, 31.05188).
- **Size.** A **19-storey** office and retail complex with 2 basement parking levels and a ground-floor shopping arcade and lobby. OSM gives 61.5 m; the JSON uses 66 m.
- **Massing.** The 74 × 30 m footprint has 47 vertices. Model it as a stepped tower above a lower wing.
- **Reputation.** StartupBiz lists it among the "most beautiful buildings in Harare CBD".
- **Facade.** Not verified; the JSON uses a curtain-glass guess.
- **Sources.** [Mash Holdings portfolio](https://www.masholdings.co.zw/portfolio/zb-life-towers), [Wanderlog](https://wanderlog.com/place/details/11179165/zb-life-towers), [StartupBiz](https://startupbiz.co.zw/most-beautiful-buildings-in-harare/).

### Defence House: `defence_house` (`eb21c32f-74da-481f-a657-2c21c98c9a40`, core `c7553a7c-…`)

- **Location.** Ministry of Defence HQ on Kwame Nkrumah Ave near Third St (-17.82688, 31.05134).
- **Massing.** OSM has a thin 54 × 10.7 m slab at 71 m plus a 13.6 × 11.4 m lift core at 77.5 m. The floor count (20) is estimated.
- **Sources.** [Ministry of Defence (Zimbabwe)](https://en.wikipedia.org/wiki/Ministry_of_Defence_(Zimbabwe)), OSM heights via Overture.

### Century Towers: `century_towers` (`7a4dcaee-501a-44ab-b384-ea8a11b7a96e`)

- **Location.** 45 Samora Machel Ave, south side, between Julius Nyerere Way and Leopold Takawira St (-17.82760, 31.04643).
- **Size.** Tenants are listed on floors 4, 15, 16 and 17, so the building has at least 17 floors. The JSON assumes 18 floors and 64 m.
- **Massing.** Footprint 33 × 25 m, with the adjoining `f031ec8c` as the lower block.
- **Sources.** [US Treasury OFAC notice listing floors](https://public-inspection.federalregister.gov/2020-17457.pdf), [Google Maps pin "14th Floor, Century Towers"](https://www.google.com/maps/place/14th+Floor,+45+Samora+Machel+Ave,+Harare/@-17.8273231,31.0435518,17z).

### Monomotapa Hotel: `monomotapa` (`51104f8b-901d-41d2-9c66-28f215484865`)

- **Location.** 54 Park Lane, overlooking Harare Gardens (-17.82613, 31.04710).
- **Size and date.** Opened 1974, designed by Roy Densem & Partners. 19 floors per SkyscraperPage; some sources say 20. The JSON uses 62 m.
- **Massing.** A **crescent-shaped / semicircular "open book" slab** with its concave face to the gardens.
  - The OSM footprint is only a thin 82 m arc (convexity 0.54).
  - Extrude a curved slab about 16-20 m deep along it.
- **The "S".** Seen from above, the Monomotapa and the curved **Charter House** (the former BSA Company HQ on Samora Machel Ave) form an "S", said to stand for Salisbury.
- **Facade.** Continuous horizontal balcony bands in white or cream `#ece8df`, and a rooftop hotel sign.
- **Sources.** [Rhodesian Study Circle](https://www.rhodesianstudycircle.org.uk/monomatapa-hotel/), [SkyscraperPage](https://skyscraperpage.com/b18366/harare/monomatapa-hotel), [Opinionista (S-shape)](https://opinionista.substack.com/p/here-for-a-good-time-the-new-architecture), [African Sun Hotels](https://www.africansunhotels.com/hotels/6/monomotapa).

### Pearl House (Pearl Assurance House / First Mutual Building): `pearl_house` (`2fcf0ef2-7718-4781-8675-2ede7463d1b2`)

- **Location.** 61 Samora Machel Ave, corner of First St (-17.82698, 31.04862).
- **Size and date.** 1959, 17 floors. The JSON uses 58 m.
- **How it was matched.** An Overture business record addressed "4th Floor, First Mutual Building/Pearl House Cnr Samora Machel" falls on this 35 × 13.5 m slab. Overture labels the slab "First Capital Bank", which is a ground-floor tenant.
- **Alternative.** The 60 × 23 m slab across First St (`4b76a206`) is also possible. **Low confidence.**
- **Facade (guess).** 1950s horizontal bands.
- **Sources.** [SKYDB](https://www.skydb.net/building/396792674/pearl-assurance-house-harare/), [SkyscraperPage](https://skyscraperpage.com/b18365), [First Money contact (address)](https://www.facebook.com/firstmoney.co.zw/posts/contact-detailsharare-branch1st-floor-pearl-house61-samora-machel-cnr-1st-street/2305643619660842/), [NewsDay renovation story](https://www.newsday.co.zw/news/article/139344/700k-for-pearl-house-renovations).

### Social Security Centre (NSSA): `social_security_centre` (`4536040b-9619-4840-9b2c-bb03e4355b46`)

- **Location.** Corner of Sam Nujoma St and Julius Nyerere Way, at the north head of Julius Nyerere Way opposite the National Gallery (-17.82473, 31.04971).
- **Size.** Tenants are listed on the 6th, 11th and 14th floors, so the building has at least 15 floors. The JSON assumes 16 floors and 58 m.
- **Occupants.** The Embassy of Japan and the Public Service Commission.
- **Massing.** An irregular 55 × 55 m footprint plus a 94 × 45 m lower complex (`832051c2`).
- **Sources.** [govserv (PSC 6th floor SSC)](https://www.govserv.org/ZW/Harare/101156034630423/Zimbabwe-Public-Service-Commission), [The Directory](https://thedirectory.co.zw/branch.cfm?branchid=17790).

### Chiyedza House: `chiyedza_house` (`819a6e3c-ed80-4983-ad1a-296021f373f9`)

- **Location.** Corner of First St and Kwame Nkrumah Ave.
- **Size.** 12 floors. OSM gives 38.5 m; the JSON uses 42 m. The slab is 44.5 × 24 m.
- **Sources.** [SKYDB](https://www.skydb.net/building/343550969/chiedza-house/), [property.co.zw](https://www.property.co.zw/for-rent/offices-chp145497).

### Angwa City: `angwa_city` (`139d1bfd-3efd-4e18-aba5-4059e5e6cf6f`, annex `cc564026-…`)

- **Location.** Corner of Angwa St (Sir Seretse Khama St) and Kwame Nkrumah Ave, by Julius Nyerere Way.
- **Size.** 12 floors. OSM gives 60 m for this part and 46 m for the adjoining annex; the JSON uses 50 m and 46 m.
- **Facade.** An award-winning modern high-rise with a "gleaming glass facade and steel structural details". Glass curtain `#4f7486`.
- **Sources.** [beglobality](https://beglobality.com/locations/angwa-city-building/), [Alamy](https://www.alamy.com/angwa-city-building-harare-zimbabwe-image659704422.html), [SkyscraperPage](https://skyscraperpage.com/cities/?buildingID=18368), [StartupBiz](https://startupbiz.co.zw/most-beautiful-buildings-in-harare/).

### ZANU-PF Headquarters ("Shake Shake Building"): `zanu_pf_hq` (`fecdb06c-680f-417d-b7fc-402d0ca00ff2`)

- **Location.** Corner of Samora Machel Ave and Rotten Row (Abdel Gamal Nasser Rd). The named OSM footprint sits about 140 m south of the corner, and `b551a4bb` (52 × 51 m) next to it may be the podium.
- **Size and date.** 15 storeys, postmodern, completed 1990. Designed by Peter Martin and Tony Wales-Smith; reportedly paid for by the Chinese Communist Party.
- **Nickname.** "Shake Shake" refers to the gable-top Chibuku Shake Shake beer carton. The JSON uses a pitched or gabled crown, which is **inferred from the nickname and not verified**.
- **Sources.** [Wikipedia](https://en.wikipedia.org/wiki/ZANU%E2%80%93PF_Building), [Pindula](https://www.pindula.co.zw/Zanu-PF_Building), [Wikipedia: Rotten Row](https://en.wikipedia.org/wiki/Rotten_Row,_Harare).

### Rainbow Towers Hotel & HICC: `rainbow_towers` (`9db2ac07-3dfe-4292-8f15-0598a175e21f`)

- **Location.** The complex is west of the Kopje/Rotten Row area (-17.8312, 31.0351).
- **History.** Formerly the Sheraton Harare: built 1981-84 and opened 1985 by Energoprojekt of Belgrade for the 1986 Non-Aligned Movement summit. The architects were Dragoljub and Ljiljana Bakić.
- **Tower.** The "golden icon" hotel tower has **gold reflective glass**, a curved lower section and a flat top.
  - "Towers rooms" are on floors 12-17.
  - Marketing copy says 104 m. The JSON assumes about 75 m and 19 floors.
- **HICC.** The Harare International Conference Centre has a 4,500-seat auditorium.
- **Overture footprint.** Overture merges the complex into one 192 × 107 m footprint. The JSON keeps that footprint at about 24 m (conference-centre level) and adds `synthetic_parts[0]`: a 55 × 20 × 75 m hotel tower near the hotel POI at the east side (-17.8314, 31.0359). Its position and orientation are *approx.*
- **Sources.** [RTG](https://rtgafrica.com/rainbow-towers-hotel/), [Zimbabwe Tourism](https://zimbabwetourism.net/rainbow-towers-harare/), [Architectuul](https://architectuul.com/architecture/sheraton-harare-hotel), [Wikipedia: HICC](https://en.wikipedia.org/wiki/Harare_International_Conference_Center), [The Herald](https://www.heraldonline.co.zw/rainbow-towers-centre-of-zims-hospitality/).

### Eastgate Centre: `eastgate` (atrium `85a3b9cc-…`, blocks `b44718b4-…` and `66a6bf36-…`)

- **Location.** Corner of Robert Mugabe Rd and Second St (Sam Nujoma St), running east to Third St (-17.83150, 31.05260).
- **Date and cost.** Opened 1996, designed by Mick Pearce with engineers Arup. It cost about US$36 m.
- **Program.** 5,600 m² of retail, 26,000 m² of offices and parking for 450 cars.
- **Passive cooling.** The ventilation is modelled on termite mounds. The building uses about 10% of the energy of a comparable air-conditioned building.
- **Massing.** **Two narrow parallel nine-storey precast-concrete blocks** linked by a **glass roof over a full-length atrium**.
  - Overture footprints: `b44718b4` and `66a6bf36` are each about 142 × 14.5 m, either side of the 131 × 24 m atrium `85a3b9cc`.
  - Retail occupies the first 2 floors, with 7 office floors above.
- **Roof.** "Along the ridge of the red tiled roof are **48 brick funnels** topping internal stacks." Use about 24 chimneys per block, about 1.5 m square, rising 4-6 m above the ridge (*approx.*).
- **Facade.**
  - Grey unpainted precast concrete `#b6ad9f` with **protruding precast "teeth"** that shade the recessed glazing. Pearce was inspired by the ridges of cacti.
  - **Columns of steel rings with green creepers** run up the outside.
  - Deep balconies and plants.
- **Atrium.** Steel lattice beams carry **suspended steel bridges and glass lifts**, and a glass skywalk runs the length of the atrium at level 2.
- **Sources.** [Wikipedia](https://en.wikipedia.org/wiki/Eastgate_Centre,_Harare), [Mick Pearce](https://www.mickpearce.com/Eastgate.html), [Hidden Architecture](https://hiddenarchitecture.net/eastgate-centre/), [constructsteel.org](https://constructsteel.org/steel-projects/eastgate-centre-harare-zimbabwe-termite-nest-inspired-architecture/), [Archnet](https://www.archnet.org/sites/1420), [Inhabitat](https://inhabitat.com/building-modelled-on-termites-eastgate-centre-in-zimbabwe/).

### Meikles Hotel (Hyatt Regency Harare The Meikles): `meikles` (north wing `e22c478a-…`, south wing `3b4e7482-…`)

- **Location.** Corner of Jason Moyo Ave and Third St, facing **Africa Unity Square** from the south.
- **History.** The hotel was founded in 1915. It was demolished and rebuilt from 1974, and the new building opened in November 1976. A 12-storey tower block opened in 1980, and 5 floors were added to the North Wing in 1991.
- **Massing.** **Two offset multi-storey wings**, North and South, with 312 rooms. The offset gives both wings' north-facing rooms views of the square.
- **Heights.** OSM gives the north wing 43 m (13 floors assumed). The south wing is assumed to be 42 m and 12 floors.
- **Facade (guess).** Cream facade with balcony bands. Roof signage for MEIKLES and HYATT REGENCY.
- **Sources.** [Rhodesian Study Circle](https://www.rhodesianstudycircle.org.uk/meikles-hotel/), [Meikles history](http://www.meikles.com/about/history), [south-african-hotels](https://www.south-african-hotels.com/hotels/meikles-hotel-harare-zimbabwe/), [Hyatt](https://www.hyatt.com/hyatt-regency/en-US/hrerh-hyatt-regency-harare-the-meikles).

### Harare Town House: `town_house` (`3edd0d5d-1dd3-40c3-a5e9-8df102eb4057`)

- **Location.** Corner of Julius Nyerere Way and Jason Moyo Ave (-17.83191, 31.04611), diagonally opposite Joina City.
- **Date and style.** 1933, in the "Mediterranean-classical" / Italian Renaissance style of the 1930s Public Works (Major Roberts). This is City Hall, with the Town Clerk's offices.
- **Features.**
  - Search summaries confirm a **clock tower**.
  - Gardens in front have a **floral clock and a fountain**.
- **Massing.**
  - The 40 × 50 m footprint is U-shaped around a courtyard.
  - The main block is 2 storeys (14 m) with cream render `#e8d9b5` and terracotta-tile roofs `#a3573a`, and an arched loggia at the entrance.
  - The tower is about 26 m (*assumed*).
- **Sources.** [Harare City Guide](https://www.hararecity.co.zw/places/tour/20/town-house), [Wanderlog](https://wanderlog.com/place/details/10525027/harare-town-house), [zimfieldguide Kopje area](https://zimfieldguide.com/harare/harare%E2%80%99s-historic-buildings-%E2%80%93-kopje-area), [Shades of Grey](http://grevity.blogspot.com/2024/03/harare-buildings.html), [Alamy: main entrance](https://www.alamy.com/main-entrance-to-the-city-of-harares-town-house-offices-on-julius-nyerere-way-harare-image349165835.html).

### Old Parliament House: `parliament_house` (`d9f9a3a0-0581-4a9e-b68c-90073031ed73` + `d1e9bc60-…`, annex `c99836f9-…`)

- **Location.** Corner of Nelson Mandela Ave and Third St, on the north side of Africa Unity Square.
- **History.**
  - Started in 1895 as a hotel by Snodgrass and Mitchell.
  - Bought unfinished by the BSA Company in 1898 and inaugurated as the Legislative Assembly on 31 May 1899; the chamber was the old hotel dining room.
  - Used by Parliament until November 2023, when it moved to the new Parliament at Mount Hampden.
- **Massing (assumed).** A 3-storey colonial block with an arcaded or verandah front and a hipped iron roof. The 5-floor annex is `c99836f9`.
- **Sources.** [Wikipedia](https://en.wikipedia.org/wiki/Parliament_House,_Harare), [African State Architecture](https://www.africanstatearchitecture.co.uk/post/who-owns-the-zimbabwean-parliament-building).

### Cathedral of St Mary and All Saints (Anglican): `anglican_cathedral` (`9a46dbf1-dcaa-4bfc-86b9-0c73ef2d0b50`)

- **Location.** Corner of Nelson Mandela Ave and Sam Nujoma St, at the NW corner of Africa Unity Square.
- **Architect and dates.** Herbert Baker. Begun 1913; sanctuary and choir 1914; the stone structure was only finished in 1961.
- **Style.** Romanesque Revival in stone. Sources say sandstone; Harare's local granite is also used.
- **Features.** A **bell tower with 10 bells** cast in London, four chapels, 14 murals and stained glass.
- **Massing.** A cruciform footprint of about 79 × 23 m. The nave is about 16 m. The square tower is about 28 m (*assumed*) and needs no clock face.
- **Sources.** [Wikipedia](https://en.wikipedia.org/wiki/Cathedral_of_St_Mary_and_All_Saints,_Harare), [Tripadvisor](https://www.tripadvisor.com/Attraction_Review-g293760-d8085417-Reviews-Anglican_Cathedral_Of_St_Mary_All_Saints-Harare_Harare_Province.html).

### Cathedral of the Sacred Heart (Catholic): `sacred_heart_cathedral` (`0f116200-dedd-41b7-af57-256178f53c39`)

- **Location.** Corner of Fourth St and Herbert Chitepo Ave.
- **Date and builders.** 1925, drawn by Father Le Boenf and built by Jesuit Brothers for £12,000.
- **Style.** Gothic Revival with **two heavily adorned front towers** and intricate stonework; timber roof inside, stained glass.
- **Massing.** Footprint 43 × 22 m. Towers about 24 m (*assumed*). The wall colour is a guess (brick or stone).
- **Sources.** [Wikipedia](https://en.wikipedia.org/wiki/Sacred_Heart_Cathedral,_Harare), [Open Council](https://opencouncil.co.zw/historic-buildings-cathedral-of-the-sacred-heart/), [GPSmyCity](https://www.gpsmycity.com/attractions/cathedral-of-the-sacred-heart-49907.html).

### National Gallery of Zimbabwe: `national_gallery` (`16ad6b4e-8312-4f41-aaca-283791103e2a`)

- **Location.** 20 Julius Nyerere Way, corner of Park Lane, at the SE corner of Harare Gardens.
- **Date and architects.** Opened 16 July 1957 as the Rhodes National Gallery; architects Montgomerie & Oldfield.
- **Design.** A modernist landmark built as one big naturally-lit open-plan space. The JSON models a white 2-storey box with clerestories and a flat roof.
- **Sources.** [Wikipedia](https://en.wikipedia.org/wiki/National_Gallery_of_Zimbabwe), [Routledge Encyclopedia of Modernism](https://www.rem.routledge.com/articles/the-national-gallery-of-zimbabwe).

### Smaller or lower-confidence entries

- **Chaminuka Building** (`e9528786`). An 80 × 18.5 m government slab next to Mukwati; an Overture place for the Central Intelligence Organization falls on it. OSM gives 38.3 m.
- **Compensation House (probable)** (`bf3dc8ff`, core `e85a413e`, wing `737201aa`).
  - This is an unnamed OSM tower cluster at 58.7 m, 70 m and 45.2 m on the Central Ave / Fourth St corner, where Compensation House is listed ([SKYDB](https://www.skydb.net/building/732571085/compensation-house-zimbabwe/)).
  - **Its identity is unconfirmed**, so its label is off.
- **Construction House** (`aeb51053` tower on the `d53604e5` podium).
  - It is at 110 Leopold Takawira St, near Park St and Nelson Mandela Ave; tenants are listed up to the 9th floor.
  - The height of 44 m and 12 floors is assumed. Sources: [SKYDB](https://www.skydb.net/building/151722974/construction-house-harare/) and [CIPF contact](https://cit.co.zw/contact/).
- **Runhare House** (`f3997add`, 12 floors, OSM 43 m) and **Electra House** (`79f1011e`, 12 floors). Both use Overture/OSM values.
- **Holiday Inn Harare** (`4f446f0d`). A 201-room hotel slab at the corner of Samora Machel Ave and Fifth St; the 11 floors are assumed ([IHG](https://www.ihg.com/holidayinn/hotels/us/en/harare/harsf/hoteldetail)).
- **Munhumutapa Building** (`bc535a44`). The seat of the Office of the President and Cabinet, with the Foreign Affairs and Information ministries, at Samora Machel Ave / Sam Nujoma St. The height of 20 m and 5 floors is assumed ([Alamy](https://www.alamy.com/stock-photo-munhumutapa-building-office-of-the-government-and-president-samora-100761770.html)).
- **Harare Main Post Office** (`4dc8db31`, with a second footprint `56182f90`). On Julius Nyerere Way / Inez Terrace; height and style not verified.
- **Harare Railway Station** (`effddafc`). On Kenneth Kaunda Ave, with a railway museum; a low colonial block ([Wanderlog](https://wanderlog.com/place/details/11218162/national-railways-zimbabwe-harare-station)).

---

## 5. Places

These are `places[]` in the JSON. The coordinates are lat/lon, and the notes explain the layout.

- **Africa Unity Square** (`africa_unity_square`, -17.8293, 31.0520, type square; bounds in the JSON from the Overture land_use polygon).
  - Formerly Cecil Square. The pioneer column raised the Union Jack here on 13 September 1890.
  - About 2 ha, bounded by Nelson Mandela Ave (N), Jason Moyo Ave (S), Sam Nujoma St (W) and Third St (E).
  - **The paths are laid out like the Union Jack**: two diagonal paths connect the corners, and one path lines up with George Silundika Ave.
  - There is a **large central fountain** and other fountains (renovation projects since 2017), and old jacarandas.
  - Flower sellers and photographers work along the edges. Parliament, the Anglican cathedral and Defence House stand to the north, the Meikles to the south, and the Old Mutual Centre one block east.
  - Sources: [GPSmyCity](https://www.gpsmycity.com/attractions/africa-unity-square-49912.html), [The Herald: "A square that misses African symbols"](https://www.heraldonline.co.zw/a-square-that-misses-african-symbols/), [Harare News: fountains](http://www.hararenews.co.zw/2017/04/africa-unity-square-fountains-reimagined/), [Petit Futé](https://www.petitfute.co.uk/v60941-harare/c1173-visites-points-d-interet/c971-parc-jardin/532194-africa-unity-square.html), [Tripadvisor photo caption](https://www.tripadvisor.com/LocationPhotoDirectLink-g3650647-i456047192-Harare_Province.html).
- **Harare Gardens** (`harare_gardens`, about -17.8243, 31.0463, park).
  - About 17 ha, bordered by Julius Nyerere Way, Park Lane and Herbert Chitepo Ave, with Leopold Takawira St on the west.
  - The SW corner holds the Les Brown pool, the Monomotapa Hotel and city parking.
  - Features: lawns, flower beds, a pond on the north side, a **1930s bandstand** (Sunday jazz), a restaurant and a playground. The National Gallery is at the SE corner.
  - There is no Overture polygon, so the corner points in the JSON notes are *approx.*
  - Sources: [MyGuide Zimbabwe](https://www.myguidezimbabwe.com/things-to-do/harare-gardens), [ExcursionMania](https://excursionmania.com/ttd/5459/harare-gardens-blg-5459).
- **The Kopje** (`the_kopje`, about -17.8410, 31.0386, hill; the JSON marker is clamped to -17.8398 to stay inside the map bbox).
  - The granite hill at the SW edge of the CBD where the city was founded; a national monument of about 15 ha.
  - The summit road is **Skipper Hoste Drive**, a one-way loop that climbs south from Robert Mugabe Rd / Kaguvi St. It is in the Overture segments.
  - The **Eternal Flame of Independence** is on the summit. It was lit by Robert Mugabe at Rufaro Stadium on 18 April 1980 and carried here.
  - The toposcope has been vandalised and its plaques stolen.
  - Elevation figures disagree: the toposcope is quoted at 1,539.8 m and PeakVisor gives 1,496 m. The JSON models about 45-55 m of relief above the CBD (*approx.*).
  - The summit is just south of the current map bbox (S = -17.840).
  - Sources: [PeakVisor](https://peakvisor.com/peak/the-kopje.html), [zimfieldguide toposcope](https://zimfieldguide.com/harare/harare-toposcope), [ExcursionMania](https://www.excursionmania.com/ttd/5472/the-kopje-blg-5472), [The Herald: kindling the flame](https://www.heraldonline.co.zw/kindling-the-eternal-flame-of-independence/).
- **First Street Mall** (`first_street_mall`, -17.8302, 31.0497, mall).
  - Harare's first pedestrian mall: First St from about Speke Ave / Robert Mugabe Rd north to Kwame Nkrumah Ave, per the Overture segment.
  - Edgars is at the Jason Moyo corner, alongside Galaxy Mall and OK. It is crowded, with vendors.
  - Sources: [gonexc: First Street](https://gonexc.com/2014/09/24/first-street/), [The Directory: Edgars](https://thedirectory.co.zw/branch.cfm?branchid=10305).
- **Mbuya Nehanda Statue** (`mbuya_nehanda_statue`, -17.82699, 31.04753, monument).
  - A bronze by David Mutasa, unveiled 25 May 2021: a 3 m figure on a 1.5 m pedestal.
  - It stands at the Samora Machel Ave / Julius Nyerere Way intersection, with new pedestrian footbridges.
  - Sources: [Wikipedia](https://en.wikipedia.org/wiki/Statue_of_Mbuya_Nehanda), [Pindula](https://www.pindula.co.zw/Mbuya_Nehanda_Statue), [Structure & Design](https://structureanddesignzim.com/mbuya-nehanda-statue-and-pedestrian-bridges-change-the-face-of-harare-cbd/).
- **Kombi ranks (type rank).** The official CBD termini are:
  - **Fourth Street / Simon Muzenda Terminus**: Ruwa, Marondera and the eastern and NE suburbs; a 2.6 ha lot.
  - **Charge Office**: Chitungwiza and the southern suburbs.
  - **Copacabana**: the western and NW suburbs; on Chinhoyi St / Speke Ave.
  - **Market Square**: the western and southern suburbs.
  - **Rezende St**: Mt Pleasant and UZ. Not placed; its location is unverified.
  - **Roadport**: long-distance and cross-border coaches.
  - Sources: [Pindula News: new kombi ranks](https://news.pindula.co.zw/2018/02/20/new-kombi-ranks-harare-map-inside-effective-21-february-2018/), [NewsDay](https://www.newsday.co.zw/news/article/173076/multimedia-no-dawn-yet-for-a-chaos-free-harare), [ZimbabweNow](https://zimbabwenow.co.zw/articles/9625/council-takes-back-fourth-street-terminus-from-touts), [NewsDay: Copacabana](https://www.newsday.co.zw/2015/01/copacabana-terminus-demolished).
- **Greenwood Park** (`greenwood_park`). A park in the Avenues; the Overture polygon covers about 5.8 ha.
- **National Heroes' Acre** (`heroes_acre`, out of map, about -17.826, 30.984, low confidence). About 7 km west on the Norton road. A 40 m obelisk carries an eternal flame lit in 1982, and it is visible from Harare. Use it only as a distant skyline or skybox marker. Sources: [Wikipedia](https://en.wikipedia.org/wiki/National_Heroes'_Acre_(Zimbabwe)), [The Herald](https://www.heraldonline.co.zw/eternal-flame-and-the-undying-love-of-heroes/).

---

## 6. Researched but not placed / open questions

- **Millennium Towers** (77 m, 19 floors, 2000). This is the third Clinton & Evans tower on Samora Machel Ave, using the practice's black granite and flush glazing. **The footprint was not found.** Candidates are unnamed footprints along Samora Machel Ave. Sources: [SkyscraperPage](https://skyscraperpage.com/b18369/harare/millennium-towers), [Shades of Grey](http://grevity.blogspot.com/2024/03/harare-buildings.html).
- **Charter House.** The ex-BSA Company HQ on Samora Machel Ave, which curves to form the "S" with the Monomotapa. It was reportedly to be converted into a hotel. The footprint was not identified; likely candidates are the slabs NW of Samora Machel × Julius Nyerere (`0ecf9853`, `b6b846c1`). Sources: [Alamy](https://www.alamy.com/stock-photo-zimbabwe-harare-samora-machel-avenue-in-downtown-charter-house-head-98510028.html), [SkyscraperPage](https://skyscraperpage.com/b205315/harare/charter-house).
- **Three Anchor House** (54 Jason Moyo Ave, between First St and Angwa St, 10 floors). Tenant points cluster around -17.8309, 31.0491, but the footprint is ambiguous. Source: [SkyscraperPage forum "Three Anchor House, 10F"](https://skyscraperpage.com/forum/showthread.php?s=310362875ca0a156cedb977d8c5e3bd5&p=10620322#post10620322).
- **Zimre Centre** (25 Kwame Nkrumah Ave, corner of Leopold Takawira St, 9+ floors). Near -17.82895, 31.04476; footprint unconfirmed. Source: [Ministry of National Housing contacts](https://www.nationalhousing.gov.zw/?page_id=298).
- **Linquenda House.** Corner of Nelson Mandela Ave and First St, at about -17.8287, 31.0499. Not researched further.
- **Trustee House** and **Emerald Hill.** Nothing found. Emerald Hill is a suburb NW of the CBD, outside the map.
- **Travel Plaza.** At Mazowe St / Josiah Chinamano Ave in the Avenues, north of the CBD core, so not a CBD landmark ([CityLink](https://www.citylinkcoaches.co.zw/contact/)).
- **Mbare Musika.** The huge market and long-distance bus terminus about 2.5 km south; outside the map bbox.
- **Facade colours in general.** None of the hexes were checked against photos. Anyone with photo access should correct RBZ, Karigamombe, Joina City, ZB Life, Old Mutual and Meikles first, because they carry the most skyline weight.

## 7. Sources

These are the sources consulted through search snippets, in addition to the per-entry links above.

- Lists and databases:
  - [Wikipedia: List of tallest buildings in Zimbabwe](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Zimbabwe)
  - [SKYDB Harare](https://www.skydb.net/city/699815027/harare/)
  - [Skyscraper Center: Harare](https://www.skyscrapercenter.com/city/harare)
  - [X: "Tallest Buildings in Zimbabwe" thread](https://x.com/WaltJackman/status/1756984759522042208)
  - [structrumlimited top-10](https://structrumlimited.co.ke/top-10-tallest-buildings-in-zimbabwe-the-marvel-construction-projects-in-history/)
- Street renaming:
  - [The Herald: New names for streets, buildings](https://www.herald.co.zw/new-names-for-streets-buildings/amp/)
  - [allAfrica](https://allafrica.com/stories/201911220754.html)
  - [S.I. 167 of 2020 (ZIMRA download)](https://www.zimra.co.zw/downloads/category/42-statutory-instruments-2020?download=2048:si-2020-167-names-alteration-amendment-of-schedule-notice-2020-1)
- City character and history:
  - [kupi.com: History of Harare](https://www.kupi.com/en/explore/zimbabwe/harare/history)
  - [Wikipedia: Causeway, Harare](https://en.wikipedia.org/wiki/Causeway,_Harare)
  - [Wikipedia: The Avenues, Harare](https://en.wikipedia.org/wiki/The_Avenues,_Harare)
  - [zimfieldguide: Historic buildings, Kopje area](https://zimfieldguide.com/harare/harare%E2%80%99s-historic-buildings-%E2%80%93-kopje-area)
  - [zimfieldguide: the Avenues](https://zimfieldguide.com/harare/harare%E2%80%99s-historic-buildings-%E2%80%93-avenues)
  - [newZWire: The walls remember](https://newzwire.live/the-walls-remember-the-old-buildings-disappearing-from-memory-in-harare-cbd-transformation/)
  - [Wikipedia: Harare](https://en.wikipedia.org/wiki/Harare)
- Data:
  - Overture Maps release 2026-09-23.0: building, segment, place, land_use and infrastructure themes, including OpenStreetMap contributors (ODbL). All footprint IDs, OSM heights, footprint dimensions and street geometry above come from it.
