# Harare CBD: photo references

These notes come from looking at freely licensed photos of central Harare. They cover landmark massing, facades, colours, roofs, street furniture, vehicles and street life, for the city artists. `LANDMARKS.md` was written from search snippets only. These notes check it against real photos, and the style fields of `tools/landmark_overrides.json` were corrected where the photos clearly disagreed (see [Changes to landmark_overrides.json](#changes-to-landmark_overridesjson)).

**Where the images are.** The images are **not** in the repo. The ~800 px copies are in the orchestrator's scratch directory:
`/tmp/claude-0/-home-user-spiderman-harare/e6051643-6af1-580e-a761-33b3fad97763/scratchpad/photos/`.

- `wc_*.jpg` files come from Wikimedia Commons.
- `ov_*.jpg` files come from Flickr, found through the Openverse API.
- `commons_meta.json` and `openverse_meta.json` in the same folder hold the full metadata.
- If the scratch folder is gone, every file page URL below still works.

**Licences.** Most photos are CC BY, CC BY-SA, CC0 or public domain. Photos marked **non-commercial** (NC) were used only as visual reference, because no free photo of that subject was found. Do not ship any of these images in the game. Any texture made from a CC BY or CC BY-SA photo needs attribution; BY-SA also requires the texture to be shared alike.

**How colours were sampled.** PIL crops of each facade were colour-quantised (median cut). Each crop reports:

- the median colour;
- a "lit" colour: the mean of the 70th-90th luminance percentile, which approximates the sunlit face;
- 2-4 dominant clusters.

Photo exposure varies a lot. Overcast and shaded faces come out 30-45% darker than their albedo, and phone photos at sunset are strongly warm. The *recommended* hexes below are therefore judged from the lit values and several photos. The raw samples are given so the artist can see the spread.

## Contents

1. [Ten best photos](#ten-best-photos)
2. [Most important corrections for the city renderer](#most-important-corrections-for-the-city-renderer)
3. [Changes to landmark_overrides.json](#changes-to-landmark_overridesjson)
4. [Skyline](#1-skyline)
5. [Reserve Bank of Zimbabwe](#2-reserve-bank-of-zimbabwe-rbz)
6. [Joina City](#3-joina-city)
7. [Karigamombe Centre (tentative)](#4-karigamombe-centre-tentative-id)
8. [Old Mutual Centre / ZB Life (Intermarket Life) Towers](#5-old-mutual-centre-and-zb-life-intermarket-life-towers)
9. [Eastgate Centre](#6-eastgate-centre)
10. [Monomotapa Hotel](#7-monomotapa-hotel)
11. [Meikles Hotel](#8-meikles-hotel)
12. [Pearl House](#9-pearl-house)
13. [Parliament and the Anglican cathedral](#10-parliament-house-and-the-anglican-cathedral)
14. [Munhumutapa Building](#11-munhumutapa-building)
15. [Town House, Livingstone House, Sacred Heart](#12-town-house-and-livingstone-house)
16. [National Gallery and Social Security Centre](#13-national-gallery-and-social-security-centre)
17. [ZANU-PF HQ and Rainbow Towers](#14-zanu-pf-hq-and-rainbow-towers--hicc)
18. [Harare railway station](#15-harare-railway-station)
19. [Africa Unity Square](#16-africa-unity-square)
20. [Harare Gardens](#17-harare-gardens)
21. [The Kopje](#18-the-kopje)
22. [First Street Mall](#19-first-street-mall)
23. [Typical CBD streets](#20-typical-cbd-streets-samora-machel-julius-nyerere-jason-moyo-nelson-mandela-robert-mugabe)
24. [Everyday CBD buildings (procedural fill)](#21-everyday-cbd-buildings-procedural-fill)
25. [Jacaranda avenues and street trees](#22-jacaranda-avenues-and-street-trees)
26. [Kombis](#23-kombis)
27. [ZUPCO and other buses](#24-zupco-and-other-buses)
28. [Street vendors](#25-street-vendors)
29. [Pedestrians](#26-pedestrians)
30. [Open questions](#27-open-questions)

---

## Ten best photos

These are the ten most useful images, in the scratch `photos/` folder:

1. `ov_76155c39_P1000983.jpg`: the RBZ, full elevation from Samora Machel Ave, showing the glass shaft, frieze bands, raked legs, podium and the neighbouring telecom mast (public domain).
2. `wc_Eastgate_Centre_Harare_Zimbabwe.jpg`: the whole Eastgate south facade from the railway, with chimneys, X-lattice towers and the MEIKLES HOTEL sign behind (CC BY-SA).
3. `ov_57452f27_P1000957.jpg`: Eastgate at street level (probably Robert Mugabe Rd), showing precast teeth, brick infill, the fan canopy, kombis and a yellow taxi (public domain).
4. `wc_Joina_City4.jpg`: the Joina City tower and its drum-and-disc crown, the RBZ and the spire tower, over Kopje-side corrugated roofs (CC BY).
5. `wc_Harare_Munhumutapa_Bldg.jpg`: Samora Machel Ave, showing the carriageway, painted median kerbs, double-arm lights and the clock-tower government block (CC BY-SA).
6. `ov_f833cf86_Crowne_Plaza_Harare.jpg`: the Monomotapa's whole crescent from Harare Gardens (CC BY; HDR-processed, so ignore its saturation).
7. `ov_6a77b6d3_100_5747.jpg`: the Africa Unity Square fountain with the Meikles arched-top tower behind (CC BY).
8. `wc_First_Street_Harare_Zimbabwe.jpg`: First Street Mall, showing the arch, paving, planters, CABS brick building and crowd (CC BY).
9. `wc_Harare_Central_Station.jpg`: the station frontage, with brick, blue columns and the cupola (CC BY-SA).
10. `ov_d706b8c1_Harare_2.jpg`: a typical street with a white HiAce kombi, 1930s-50s blocks with arcades, and yellow number plates (CC BY-SA).

Runners-up:

- `wc_Harare_Harare3496.jpg`: a jacaranda tunnel (CC0).
- `ov_2de47b8d_100_5748.jpg`: Parliament and jacaranda (CC BY).
- `wc_Harare.jpg`: Pearl House, a ZUPCO bus and Samora Machel in 1995.
- `wc_Carts_loaded_with_fruits_and_vegetables_for_sale_in_Harare.jpg`: vendor carts.
- `ov_d9e4adc4_Samora_Machel_Avenue_Harare_Zimbabwe_2019.jpg`: the Samora Machel median with solar lights (NC).

## Most important corrections for the city renderer

The renderer hard-codes some of these in `src/world/landmarks.js` (`STYLE`, `rbzTaper`, `ringCrown`). The JSON now says the right thing, but the city owner has to change the code. Most important first:

1. **The RBZ is a glass tower, not a granite one.**
   - It is a chamfered octagonal shaft of blue-green/teal reflective curtain glass, with thin light-grey granite piers at each facet edge.
   - It has **no taper, no setbacks, no coronet of fins and no mast.** It runs straight up to a ~4 m carved light-grey granite chevron frieze, which flares slightly as a cornice.
   - A second frieze band sits at ~level 6. Below it is a recessed glass lobby storey between **raked granite legs that splay out** to a 4-5 level grey granite podium with ribbon windows.
   - The lattice telecom mast in all the photos stands on the **neighbouring** building to the east.
   - Colours: glass `#5b808c`, piers and frieze `#aeb0ac`, podium `#8f9593`.
   - The current `rbzTaper` + `upper: 'granite'` is the single biggest visual error in the skyline.
2. **The Joina City crown is a drum and disc, not a ring on four posts.**
   - The top ~3 storeys become a full-width cylindrical blue-grey glass drum.
   - Above it is a narrower (~60% diameter) ribbed silver drum, capped by a thin flat disc about 1.4 times that diameter, with two antenna masts.
   - The shaft is pale grey precast (`#b9bab6`) with **horizontal strip windows** ("bands"), not a curtain wall.
3. **The Monomotapa is sandy tan, not white.** Use `#cdbd9c` for the concave crescent: continuous tan spandrel bands with ribbon windows and blank tan end walls. It glows golden-brown in low sun.
4. **Eastgate chimneys and facade.**
   - The chimneys are **cylindrical stacks with flared caps** (~2 m diameter, 3-4 m tall, pale tan with dark rings), about 24 per block in one even row, with small triangular roof vents between them. They are not square brick funnels.
   - The long facades carry **full-height precast X-lattice service towers** every ~30 m, rising one storey above the roof. Add these; they read strongly from a distance.
   - The facade grid is deep grey precast "teeth" with salmon-brick infill (`#b5957c`). From afar it reads dark (`~#5a5953`) because of self-shadowing.
5. **The Meikles north tower is a white grid with an arched attic, not balcony bands.** It is off-white precast with vertical piers and dark windows, topped by a row of ~8 round arches under the roof. The block facing south over Eastgate is grey concrete with **MEIKLES HOTEL** in raised letters on its parapet. Switch `meikles` from `upper: 'balcony'` to a grid.
6. **Harare station is red face brick**, not cream render. Use brick `#8a5c46`, cream trims, **blue-painted colonnade columns** (`#365374`), a red cupola and red-brown tile hip roofs.
7. **The Munhumutapa Building is a 3-storey butter-yellow colonial block with a ~30 m clock tower** and red-brown tile hip roofs, not a 5-storey grid block. Its height is now 16 m, and it needs a clock tower like `town_house`.
8. **Pearl House is golden ochre, with the "Pearl" sculpture on its roof.** Add the ~8-10 m stick figure holding a gold sphere aloft, and PEARL letters; it is a skyline marker.
9. **The Anglican cathedral is brown-grey granite rubble** (`#8f806c`). Its tower has a **clock face** and a green copper pyramid roof with a cross. The notes used to say "no clock face".
10. **The National Gallery's defining feature is a big abstract mosaic mural** on the upper storey, which is pale stone over round pilotis.
11. **Karigamombe Centre is probably the blue-glass tower with wide light-grey concrete corner piers and a white needle spire** just WSW of the RBZ (identity inferred from five photo bearings; see §4). It has a set-back glass lantern at the top and blue glass `#5177a4`. Its roof is now `spire`, pattern `curtain`.
12. **The Sacred Heart cathedral is buff rock-faced stone, not brick.** Its two west towers have **flat crenellated tops with corner pinnacles, not spires** (`sacred_heart_cathedral`).
13. **Livingstone House (probable ID) is a white slab**, not banded. It has a full-height recessed dark-glass bay, a semicircular end bay with vertical strip windows and a rooftop lift box with a porthole window.
14. **Sun and shade.** Harare is at 17.8°S, so the sun is in the north for most of the year. **South-facing facades are in shade most of the day**, which is why so many photos of Parliament, the National Gallery and the RBZ frontage look grey. Treat the shaded hexes as shaded versions of the lighter albedos given here.
15. **Streets.**
    - **Asphalt is pale, sun-bleached grey** (`#8f8c83` to `#9d998d` in sun), not near-black. Patches are darker.
    - **Painted kerbs.** Median kerbs on Samora Machel are painted in **alternating black and white blocks**. Rank and bus-stop kerbs are painted yellow.
    - **Street lights.** Main avenues use tall grey **double-arm** poles in the median; Samora Machel's carry **solar panels on top**. Older side streets have single-arm poles.
    - **Traffic-light poles** have black and white bands.
    - **Sidewalks** are grey concrete slabs, often cracked, with earth verges of red-brown laterite (`#7c6556`).
16. **Number plates are yellow** (sampled `#c89c1f` in mixed light; use ~`#e0b020`) with black characters, front and rear, on modern cars and kombis.
17. **Rooftop clutter.** Add **green plastic water tanks** (JoJo tanks; sampled `#4f8a68` / `#325f47`, use ~`#3f7d5a`) on steel stands. They are very common on low and mid-rise roofs.
18. **Precast "durawall" fences.** Grey concrete slab-and-post boundary walls (`#b7b2a8`), ~2 m high, line the railway corridor and many yards and service lots (station tracks, Kopje side).

## Changes to landmark_overrides.json

The file keeps its schema and keys; nothing was removed. Changes were made only where a photo clearly showed the old guess was wrong. Every corrected `notes` field now starts with "Photo-checked". The JSON was validated afterwards: it parses, keys are unique, every style has its fields, and hexes are well-formed.

The tallest-buildings heights were cross-checked against the Wikipedia "List of tallest buildings in Zimbabwe" (RBZ 120 m/28, Joina City 105 m/24, Karigamombe 92 m/20, Livingstone House 80 m/20, Earl Grey 76 m/21, Kaguvi 73 m/18, Old Mutual 72 m/18, Millennium Towers 77 m/19). They all agree with the JSON, so no height in that list was changed.

| key | what changed (old → new) |
|---|---|
| `rbz` | pattern fins→**curtain**, roof crown→flat (frieze parapet, no mast), facade `#b8a99c`→`#aeb0ac`, accent→`#80878a`, glass `#26323b`→`#5b808c`; notes rewritten; style_confidence medium→high |
| `rbz_podium` | pattern fins→**bands**, colours → grey granite `#8f9593` / glass `#4f6f78` |
| `joina_city` | pattern curtain→**bands**, facade `#dcd6ca`→`#b9bab6`, accent→`#c9cac6` (disc), glass `#3e6f80`→`#5a7189`; crown described as drum + disc; style_confidence →high |
| `karigamombe` | pattern grid→**curtain**, roof flat→**spire**, facade `#cfc8bb`→`#b8b5b3` (light-grey piers), accent→`#e8e6e0` (spire), glass `#2d3a44`→**`#5177a4`**; probable ID; style_confidence low→medium |
| `monomotapa` | facade `#ece8df`→**`#cdbd9c`** (tan), accent→`#b09c78`, glass→`#5f6c73`; style_confidence →high |
| `meikles` | pattern bands→**grid**, facade→`#e3e0da`, accent→`#cfc8bc`, glass→`#4b535d`; arched attic noted |
| `meikles_south` | facade→grey concrete **`#9c9a92`**; MEIKLES HOTEL parapet letters |
| `pearl_house` | facade `#e0d9c9`→**`#c29a4e`** (ochre), pattern bands→grid; rooftop sculpture noted |
| `munhumutapa_building` | **height 20→16, floors 5→3**, pattern grid→colonial, roof flat→**clocktower**, facade→`#e2d596`, accent→`#8a5a42` |
| `harare_station` | facade `#e3d6b8`→**`#8a5c46` brick**, accent→`#e6e4d6` (trim), pattern colonial→**brick**, roof flat→hip |
| `parliament_house` | floors 3→2, roof flat→hip, facade→`#dcd2b8`; grey plinth, arched porch and peach gable ends noted |
| `anglican_cathedral` | facade `#b39a7c`→**`#8f806c`**, accent→`#6f7a66` (green copper roof); clock face exists |
| `national_gallery` | facade→`#d9d4ca`, accent→`#c8b068` (mosaic ground); mural/pilotis noted |
| `social_security_centre` | facade→`#a9a497`, glass→`#6f9ab5`; SSC letters, blue glass wing; looks ~18 storeys (height not changed) |
| `zanu_pf_hq` | facade `#dcd3c2`→**`#a09a8c`**, accent→`#5f5b55`; gable crown confirmed |
| `rainbow_towers` | facade→`#d6c48c` (sand frame around gold glass), accent→`#b8a36a` |
| `eastgate_block_n`, `eastgate_block_s` | notes: cylindrical chimneys, X-lattice towers, brick infill; style_confidence stays high |
| `livingstone_house` | probable ID; facade `#e3ddcf`→`#dfdfda` (white), pattern bands→**grid**, accent→`#4a5258` (dark glass bay); style_confidence low→medium |
| `sacred_heart_cathedral` | facade `#a86f52` brick→**`#ad9d80` buff stone**, accent→`#5a4e42`, pattern brick→colonial, roof spire→**towers** (flat crenellated); style_confidence →high |

These entries were not changed because no usable free photo was found: `town_house`, `old_mutual_centre`, `zb_life_towers`, `kaguvi`, `mukwati`, `defence_house`, `century_towers`, `chiyedza_house`, `angwa_city`, `holiday_inn`, `main_post_office` and the rest.

The new roof word `towers` (Sacred Heart) and the existing `hip` sense are descriptive only; no code reads `style.roof` today.

---

## 1. Skyline

- **Silhouette.** The skyline is a compact cluster about 1.2 × 0.8 km. It is dominated by the **RBZ**, a teal glass octagon at 120 m that is visibly the tallest from every direction. Just WSW of it stands the **spire tower** (probably Karigamombe, §4), and south of both the **Joina City** drum-and-disc crown.
- **The rest.** Around them are 30-60 m slabs of the 1950s-80s in beige, tan, ochre, dark red-brown brick and grey concrete. Very few are glass; the glass ones are blue or teal.
- **Telecom masts.** Two or three lattice masts break the skyline. The most visible is next to the RBZ; a red-and-white one stands in the east.
- **Seen from the Kopje (south-west).**
  - The foreground is the low western CBD: 1-3 storey blocks with flat or low-pitch roofs in grey or silver corrugated iron, faded red iron and white.
  - Behind that, the mid-rise core rises abruptly. The towers are spread along Samora Machel Ave (north edge of the cluster) and Julius Nyerere Way.
  - Tree canopy fills the gaps and completely surrounds the CBD. From Harare Gardens and the Avenues, only the towers show above a continuous dark-green canopy.
- **Atmosphere.** There is a light haze, and distant hills are a blue-grey band on the horizon. The sky is deep blue with fair-weather cumulus. The rainy season (Nov-Mar) brings towering cumulus.
- **Colour samples.**
  - Kopje view: roofscape `#666664` / `#9d9892`; tree canopy `#12150a`-`#333628` in shade.
  - Monomotapa 2019 panorama: Harare Gardens canopy `#37311b` / `#736b47` (winter, dry-season olive).

- `wc_Harare_from_the_Kopje.jpg`: "Harare from the Kopje.jpg", Andrew Balet, CC BY 2.5. <https://commons.wikimedia.org/wiki/File:Harare_from_the_Kopje.jpg>
- `wc_Harare_Skyline.jpg`: "Harare Skyline.jpg", User:Macvivo, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare_Skyline.jpg>
- `ov_7663bb25_Reserve_Bank_of_Zimbabwe.jpg`: "Reserve Bank of Zimbabwe", Bayhaus, CC BY 2.0. <https://www.flickr.com/photos/47293505@N06/4813483200>
- `ov_cb4f557f_Monomotapa_Hotel_Harare_Zimbabwe_2019.jpg`: "Monomotapa Hotel - Harare - Zimbabwe 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50606842777>
- `ov_df311797_Monomotapa_Hotel_Harare_Zimbabwe_2019.jpg`: "Monomotapa Hotel - Harare - Zimbabwe 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50605978458>
- `wc_Joina_City4.jpg`: "Joina City4.jpg", Mindthem, CC BY 4.0. <https://commons.wikimedia.org/wiki/File:Joina_City4.jpg>
- `wc_Harare_skyline.jpg`: "Harare skyline.jpg", Radozw at Serbian Wikipedia, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare_skyline.jpg>
- `wc_View_from_the_Kopje_Salisbury_Rhodesia_ca1975_6970085175.jpg`: "View from the Kopje, Salisbury Rhodesia ca1975 6970085175.jpg", Rob from United Kingdom, CC BY 2.0. <https://commons.wikimedia.org/wiki/File:View_from_the_Kopje,_Salisbury_Rhodesia_ca1975_6970085175.jpg>
- `ov_b0cfbf3f_Harare_Skyline.jpg`: "Harare Skyline", jnwakeling, CC BY-NC-ND 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/156344046@N05/35594935742>
- `ov_e3f46574_Aerial_views_of_Harare_in_Zimbabwe.jpg`: "Aerial views of Harare in Zimbabwe", adam79, CC BY-NC-ND 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/31723929@N00/2610912852>
- `ov_759e5497_Scan10689.jpg`: "Scan10689", damien_farrell, CC BY 2.0. <https://www.flickr.com/photos/92094658@N00/3153001621>
- `wc_View_of_tallest_building_in_Harare.jpg`: "View of tallest building in Harare.jpg", Itaisibanda, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:View_of_tallest_building_in_Harare.jpg>
- `wc_Harare_Wikivoyage_banner.jpg`: "Harare Wikivoyage banner.jpg", David Brazier, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare_Wikivoyage_banner.jpg>
- `wc_2006_Harare_Zimbabwe_95120342.jpg`: "2006 Harare Zimbabwe 95120342.jpg", ctsnow from Hsinchu, Taiwan, CC BY 2.0. <https://commons.wikimedia.org/wiki/File:2006_Harare_Zimbabwe_95120342.jpg>
- `wc_2006_Harare_Zimbabwe_95120344.jpg`: "2006 Harare Zimbabwe 95120344.jpg", ctsnow from Hsinchu, Taiwan, CC BY 2.0. <https://commons.wikimedia.org/wiki/File:2006_Harare_Zimbabwe_95120344.jpg>

## 2. Reserve Bank of Zimbabwe (`rbz`, `rbz_podium`)

**Massing, from the ground up.**

- **Podium.** 4-5 levels of mid-grey granite with continuous horizontal ribbon windows of dark teal glass (~35% glazing).
- **Legs.** Raked granite legs splay outward from the tower corners down onto the podium roof.
- **Lobby storey.** A recessed, fully glazed storey sits between the legs.
- **First frieze.** A ~3-4 m carved granite frieze band at about level 6, with a Great Zimbabwe chevron/zig-zag relief in low contrast.
- **Shaft.** About 20 storeys of **continuous reflective curtain glass** on a chamfered octagon plan. The four wide faces alternate with narrower diagonal faces, each edged by a slim light-grey granite pier (~0.8 m). The mullions are fine and vertical; there are no visible spandrels.
- **Crown.** A second carved frieze band (~4 m) whose faceted parapet flares slightly outward like a cornice. The roof is flat, with **no mast, no setback and no taper.**
- **Legibility.** The shaft is straight from bottom to top. The "grain silo" idea shows only in the rounded, chamfered plan and the frieze bands.

**Colour samples.**

| surface | samples (photo, light) | recommended |
|---|---|---|
| curtain glass | `#577791` / `#7298ad` (1997, sun); `#668790` (overcast); `#39555c` (shade); HDR `#398ca0` | `#5b808c` |
| granite piers and friezes | `#9ba1a0` / `#828989` (overcast), frieze lit `#e3e7ef` edges | `#aeb0ac` |
| podium granite | `#697470` / `#616b64` (overcast) | `#8f9593` |

**Context.**

- A ~40 m galvanised lattice telecom mast stands just east of the tower, and a cylindrical concrete stair drum and a white spiral car-park ramp stand behind it (1997 photo).
- Samora Machel frontage: iron palisade fence, palms and a planted strip.

- `ov_76155c39_P1000983.jpg`: "P1000983", damien_farrell, Public Domain Mark. <https://www.flickr.com/photos/92094658@N00/7661979216>
- `ov_7ee7b21e_P1000988.jpg`: "P1000988", damien_farrell, Public Domain Mark. <https://www.flickr.com/photos/92094658@N00/7661984166>
- `wc_1997_Harare_Zimbabwe_3140056352.jpg`: "1997 Harare Zimbabwe 3140056352.jpg", damien_farrell, CC BY 2.0. <https://commons.wikimedia.org/wiki/File:1997_Harare_Zimbabwe_3140056352.jpg>
- `ov_7663bb25_Reserve_Bank_of_Zimbabwe.jpg`: "Reserve Bank of Zimbabwe", Bayhaus, CC BY 2.0. <https://www.flickr.com/photos/47293505@N06/4813483200>
- `ov_d9e4adc4_Samora_Machel_Avenue_Harare_Zimbabwe_2019.jpg`: "Samora Machel Avenue - Harare, Zimbabwe 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50606690096>
- `ov_00a926b7_Samora_Machel_Avenue_Harare_Zimbabwe_2019.jpg`: "Samora Machel Avenue - Harare, Zimbabwe 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50606880767>
- `wc_Distant_view_of_tallest_building_in_Harare.jpg`: "Distant view of tallest building in Harare.jpg", Itaisibanda, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Distant_view_of_tallest_building_in_Harare.jpg>

## 3. Joina City

**Tower (2023 photos from the station tracks).**

- **Shaft.** A slab-like tower with chamfered corners. The main faces have **continuous horizontal strip windows**: dark blue-grey glass with vertical mullions, ~40% glazing, and pale grey precast spandrels. A narrower side bay has punched windows and one full-height vertical glass slot. About 21 office and retail rows are visible above the podium.
- **Crown, from the bottom up:**
  - (a) the top ~3 storeys wrap into a **full-width glass cylinder** of blue-grey glass with pale spandrel rings;
  - (b) a **narrower ribbed silver drum**, about 60% of that diameter and ~6 m tall;
  - (c) a **thin flat circular disc**, about 1.4 times the upper drum's diameter and ~1 m thick, overhanging like a flying saucer;
  - (d) two thin antenna masts.
- **Construction history.** A 2001 Kopje photo shows a bare concrete tower with a crane in about the right place. It is probably Joina City, which was begun in 1998.

**Colour samples.**

- precast `#b5b7b6` lit / `#898d92`;
- glass drum `#6e8196` / lit `#a1b0bf`;
- silver drum and disc `#a2bdda` lit / `#797e81`.

Recommended: facade `#b9bab6`, glass `#5a7189`, disc `#c9cac6`.

**Podium.** The 4-5 storey mall podium was not visible in any free photo. Keep the JSON guess.

- `wc_Joina_City4.jpg`: "Joina City4.jpg", Mindthem, CC BY 4.0. <https://commons.wikimedia.org/wiki/File:Joina_City4.jpg>
- `wc_Joina_City5.jpg`: "Joina City5.jpg", Mindthem, CC BY 4.0. <https://commons.wikimedia.org/wiki/File:Joina_City5.jpg>
- `wc_Harare_from_the_Kopje.jpg`: "Harare from the Kopje.jpg", Andrew Balet, CC BY 2.5. <https://commons.wikimedia.org/wiki/File:Harare_from_the_Kopje.jpg>

## 4. Karigamombe Centre (tentative ID)

No photo is captioned "Karigamombe". One tower recurs just WSW of the RBZ in photos from five independent viewpoints. Its bearing matches Karigamombe's footprint (Samora Machel × Julius Nyerere, SE corner) every time:

- from the Kopje, it appears just left of the RBZ;
- from the station, it appears between Joina City and the RBZ;
- looking west along Samora Machel, it appears left of and behind the RBZ;
- from east of Africa Unity Square, it appears far left of the RBZ;
- it also appears in a sunlit street view from the north (`wc_The_Avenues_Harare.jpg`).

Livingstone House, Old Mutual and ZB Life do not fit these bearings.

**Appearance.** The sunlit view shows it best.

- A slender square tower. All four faces are **blue reflective glass in horizontal floor bands**: `#5177a4` sunlit, `#648bb9` lit, `#677c8a` grey-blue when overcast.
- **Wide full-height light-grey concrete corner piers** (`#b1afb0` to `#c7c3c0` in sun). They read dark (`#4b4f50`) when backlit, which is why they look black in several skyline photos.
- A small emblem high on one pier.
- The two lowest floors have darker glass.
- **Top:** a set-back one-storey glass screen or lantern (lighter blue, `#5f8cc0`), and a slender **white conical needle spire** of about 8-10 m.
- About 20 storeys. This fits the 92 m / 20 floor figure, with the spire extra.

`karigamombe` is updated (pattern `curtain`, roof `spire`, glass `#5177a4`, piers `#b8b5b3`) with style_confidence `medium`. **If someone finds a captioned photo, verify it.** The candidate could instead be Millennium Towers (77 m, 2000, also by Clinton & Evans).

- `wc_The_Avenues_Harare.jpg`: "The Avenues, Harare.jpg", Maipo, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:The_Avenues,_Harare.jpg>
- `ov_cef77ace_Harare_1.jpg`: "Harare 1", SqueakyMarmot, CC BY-SA 2.0. <https://www.flickr.com/photos/37804160@N00/14521853568>
- `wc_Joina_City4.jpg`: "Joina City4.jpg", Mindthem, CC BY 4.0. <https://commons.wikimedia.org/wiki/File:Joina_City4.jpg>
- `ov_7663bb25_Reserve_Bank_of_Zimbabwe.jpg`: "Reserve Bank of Zimbabwe", Bayhaus, CC BY 2.0. <https://www.flickr.com/photos/47293505@N06/4813483200>
- `wc_Harare_from_the_Kopje.jpg`: "Harare from the Kopje.jpg", Andrew Balet, CC BY 2.5. <https://commons.wikimedia.org/wiki/File:Harare_from_the_Kopje.jpg>
- `ov_d9e4adc4_Samora_Machel_Avenue_Harare_Zimbabwe_2019.jpg`: "Samora Machel Avenue - Harare, Zimbabwe 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50606690096>
- `wc_Harare_Zimbabwe_04.jpg`: "Harare, Zimbabwe. 04.JPG", Suesen, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare,_Zimbabwe._04.JPG>

## 5. Old Mutual Centre and ZB Life (Intermarket Life) Towers

- **ZB Life Towers was "Intermarket Life Towers".**
  - A 2005 photo looking south down Second St (Sam Nujoma) past the Anglican cathedral shows a tower signed **INTERMARKET LIFE TOWERS**; Intermarket Life is now ZB Life.
  - It is a white slab with full-height blue glass bays and stacked, stepped white fins. Its footprint (`zb_life_towers`, south of the square on Sam Nujoma) matches this view. So `curtain` + `stepped` is roughly right; add white vertical fins framing blue glass bays.
  - Style was not changed, because the photo is small.
- **An "OLD MUTUAL" roof sign** appears on a ~12-storey beige slab with horizontal window bands.
  - The same 2005 photo places it on the **west** side of Sam Nujoma St south of Nelson Mandela Ave.
  - The JSON's `old_mutual_centre` is at Jason Moyo × Third St, east of the square.
  - It may be a different Old Mutual property. **Open question**; `old_mutual_centre` was not changed.
- **Blue-glass towers elsewhere.**
  - A 2014 photo (`wc_Harare_Zimbabwe_02.jpg`, street not identified) shows a curved, stepped blue-glass office block with a rooftop sign frame.
  - `ov_70b81282_Harare_5.jpg` shows a blue-glass block with white horizontal balcony bands and "property services" signage.
  - Neither could be tied to a JSON key.

- `wc_DrugaUlicaHarare03042005.jpg`: "DrugaUlicaHarare03042005.jpg", Radozw at Serbian Wikipedia, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:DrugaUlicaHarare03042005.jpg>
- `wc_Harare_parlament_24032005.jpg`: "Harare parlament 24032005.jpg", Radozw at Serbian Wikipedia, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare_parlament_24032005.jpg>
- `wc_Harare_Zimbabwe_02.jpg`: "Harare, Zimbabwe. 02.JPG", Suesen, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare,_Zimbabwe._02.JPG>
- `ov_70b81282_Harare_5.jpg`: "Harare 5", SqueakyMarmot, CC BY-SA 2.0. <https://www.flickr.com/photos/37804160@N00/14708114552>

## 6. Eastgate Centre

**Seen from the south (railway).**

- A 9-storey slab, about 140 m long. The whole face is a dense grid of **deep precast window hoods ("teeth")**, 3-4 per bay per floor, with dark recessed glass.
- **Four or five full-height precast X-lattice (diamond-braced) towers** divide the facade into bays and poke one storey above the parapet.
- A thin red-brown **tile roof strip** runs along the top. On it stands a single row of about **24 cylindrical chimney stacks** per block: pale tan, flared caps, a dark ring near the top, ~2 m diameter and 3-4 m tall, evenly spaced about 6 m apart. Small grey triangular roof vents sit between them.

**Street level (probably Robert Mugabe Rd).**

- Stacked grey precast "teeth" and deep balconies alternate with **salmon face-brick infill** panels.
- Green creepers hang from the balconies.
- The atrium entrance has a **fan of radiating steel rods** over the EASTGATE letters, and a **dark-green steel canopy** runs over the pavement.
- The atrium end wall is clad in silver vertical metal louvres.

**Atrium (2024 photos).**

- A tall canyon between the two slabs. Its walls are stacked precast balconies and lattice.
- A **glass roof on steel lattice trusses** spans it, with suspended glass-floored steel bridges and escalators.
- The ground-floor mall (2003 photo) has **mint/teal-green painted steel stairs and railings** and pale pink-beige floor tiles with white bands. Green planters line the balconies.

**Colour samples.**

| surface | samples | recommended |
|---|---|---|
| precast (lit / shade) | `#c5bbab` `#d9cfbe` / `#534d47` | `#b3aa9c` (albedo); overall far read `#5a5953` |
| brick infill | `#b5957c` `#aa9076` | `#b5957c` |
| roof strip | `#857067` (hazy, far) | tile red `#9c4a33` (unchanged) |
| chimneys | pale tan, not reliably sampled at this distance | `#c9b8a0` |

- `wc_Eastgate_Centre_Harare_Zimbabwe.jpg`: "Eastgate Centre, Harare, Zimbabwe.jpg", David Brazier, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Eastgate_Centre,_Harare,_Zimbabwe.jpg>
- `ov_57452f27_P1000957.jpg`: "P1000957", damien_farrell, Public Domain Mark. <https://www.flickr.com/photos/92094658@N00/7661976432>
- `ov_66bee88c_Scan10693.jpg`: "Scan10693", damien_farrell, CC BY 2.0. <https://www.flickr.com/photos/92094658@N00/3153841072>
- `ov_3f4d8537_Zimbabwe_Harare_Eastgate_Shopping_Mall.jpg`: "Zimbabwe Harare Eastgate Shopping Mall", Tips For Travellers, CC BY 2.0. <https://www.flickr.com/photos/8327374@N02/557269907>
- `wc_Harare_2024_3.jpg`: "Harare 2024 3.jpg", Peter in s, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Harare_2024_3.jpg>
- `wc_Harare_2024_4.jpg`: "Harare 2024 4.jpg", Peter in s, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Harare_2024_4.jpg>
- `wc_Natural_ventilation_high_rise_buildings.jpg`: "Natural ventilation high-rise buildings.JPG", KVDP, Public domain. <https://commons.wikimedia.org/wiki/File:Natural_ventilation_high-rise_buildings.JPG>

## 7. Monomotapa Hotel

**Massing.**

- A concave crescent slab facing Harare Gardens. The Crowne Plaza photo shows about 17 window rows plus a plant storey; the roof is flat.
- The curved faces carry **continuous horizontal tan spandrel bands** alternating with **continuous ribbon windows**, which have light frames and pale grey glass.
- The end walls are thick, blank and tan, with a faint square panel grid.

**Signage and grounds.**

- Rooftop letters: CROWNE PLAZA MONOMOTAPA in the 2010-2012 photos. The hotel now trades as the Monomotapa Hotel (African Sun), so use MONOMOTAPA.
- Antennas stand on the roof.
- At the foot are tall shaggy Washingtonia palms with dead-frond skirts and dense garden trees.

**Colour samples.**

- End wall `#d0c2a4` (sun) and `#d4c6a8`.
- Upper facade in late sun `#9f7644` / `#ad8351`.
- Recommended: facade `#cdbd9c`, spandrels `#b09c78`, glass `#5f6c73`.

- `ov_f833cf86_Crowne_Plaza_Harare.jpg`: "Crowne Plaza, Harare", Bayhaus, CC BY 2.0. <https://www.flickr.com/photos/47293505@N06/4813530610>
- `ov_20d651ad_Zimbabwe_Harare_Monomatapa_Hotel.jpg`: "Zimbabwe Harare Monomatapa Hotel", Tips For Travellers, CC BY 2.0. <https://www.flickr.com/photos/8327374@N02/557270789>
- `ov_df311797_Monomotapa_Hotel_Harare_Zimbabwe_2019.jpg`: "Monomotapa Hotel - Harare - Zimbabwe 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50605978458>
- `ov_cb4f557f_Monomotapa_Hotel_Harare_Zimbabwe_2019.jpg`: "Monomotapa Hotel - Harare - Zimbabwe 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50606842777>
- `ov_6ef347af_P1000984.jpg`: "P1000984", damien_farrell, Public Domain Mark. <https://www.flickr.com/photos/92094658@N00/7661980608>

## 8. Meikles Hotel

**North tower (faces the square, ~12-13 storeys).**

- Off-white precast. Full-height vertical piers divide bays of paired windows with dark grey-blue glass; the spandrels are light.
- The **top storey is a row of 8 semicircular arches** (arched attic), and the corners have a small sloping parapet.
- Colour samples: facade `#dbd7d5` lit / `#a6a5a4`, glass `#55585a`.

**South block (faces Eastgate).**

- A grey concrete slab with horizontal window bands.
- A blank top band carries **MEIKLES HOTEL** in raised letters.
- Colour samples: `#656560` (hazy, overcast); recommended `#9c9a92`.

**Low wing.** A beige low wing next to the square carries "MEIKLES" letters (`#bcb1a8`).

**Street life.** A flower sellers' pitch was on the Jason Moyo pavement in front: rows of bouquets in buckets along a brick planter (Mary Gillham archive photo; older, undated).

- `ov_6a77b6d3_100_5747.jpg`: "100_5747", damien_farrell, CC BY 2.0. <https://www.flickr.com/photos/92094658@N00/269671973>
- `wc_Eastgate_Centre_Harare_Zimbabwe.jpg`: "Eastgate Centre, Harare, Zimbabwe.jpg", David Brazier, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Eastgate_Centre,_Harare,_Zimbabwe.jpg>
- `ov_665dff12_Flower_stall_by_Meikles_5_Star_Hotel_Harare.jpg`: "Flower stall by Meikles 5 Star Hotel. Harare", Mary Gillham Archive Project, CC BY 2.0. <https://www.flickr.com/photos/139791896@N06/23923363878>

## 9. Pearl House

**1995 photo.** Seen looking west along Samora Machel, with Pearl House on the south side.

- A slender slab clad in **golden-ochre** panels with a regular punched-window grid.
- **PEARL** letters on the parapet.
- On top, a white/steel **stick figure with splayed legs holding a gold sphere** aloft, ~8-10 m tall.

**2014 photo.** The ochre top storey and the sculpture are still there.

**Colour samples.** Sunlit side `#b99041` / `#c5a25a`, shaded front `#736445`. Recommended `#c29a4e`.

**Other things in the 1995 photo.**

- A ZUPCO bus in blue and cream (§24).
- White Peugeot 404/504-era cars.
- The CABS "Arkade" block with blue-grey cladding.
- Bus shelters.

- `wc_Harare.jpg`: "Harare.jpg", Greenmnm69 (assumed), CC BY-SA 2.5. <https://commons.wikimedia.org/wiki/File:Harare.jpg>
- `ov_e504fe94_Harare_4.jpg`: "Harare 4", SqueakyMarmot, CC BY-SA 2.0. <https://www.flickr.com/photos/37804160@N00/14685506386>

## 10. Parliament House and the Anglican cathedral

**Parliament.**

- **Walls and base.** Cream render, 2 storeys plus a tall parapet, with a strong cornice at first-floor level and at the roof. A **~1 m grey-painted plinth** runs along the base.
- **Windows.** White-framed multi-pane sash windows, with a round-arched door in the west bay.
- **Entrance porch.** A projecting porch with 2-3 tall round arches, **PARLIAMENT OF ZIMBABWE** lettering and the coat of arms. A flagpole stands above it.
- **Roof.** Red tile pitched roofs behind the parapet, with a white gable showing.
- **Frontage.** A black iron palisade fence runs along Nelson Mandela Ave, facing the square's lawn and jacarandas.
- **Colour samples.**
  - Overcast: wall `#a29882`, lit `#b3a790`.
  - In shade: `#868078`.
  - Sunset: `#b2a598`.
  - Plinth: `#565d63`.
  - Recommended: `#dcd2b8`.

**Cathedral of St Mary and All Saints.** It stands at the NE corner of Sam Nujoma × Nelson Mandela, next to Parliament.

- **Walls.** Brown-grey rough granite ashlar: `#897c6b` (overcast), recommended `#8f806c`.
- **Tower.** Square, ~28 m, with twin louvred lancets near the top, a **round clock face** below them, and a green/grey-green copper **pyramidal roof** with a cross (`#7d8071`).
- **Nave.** Grey-green roofs.

**2022 official photo.** It shows **pale peach gable ends** with white trim above the parapet. Samples: wall in shade `#6d7376` / `#7e807e`, against a sunlit road `#c6c6c1`. The walls are a cool cream; the south face is in shade most of the day.

- `wc_Parlament_of_Zimbabwe.jpg`: "Parlament of Zimbabwe.jpg", Parliament of Zimbabwe, Public domain. <https://commons.wikimedia.org/wiki/File:Parlament_of_Zimbabwe.jpg>
- `ov_2de47b8d_100_5748.jpg`: "100_5748", damien_farrell, CC BY 2.0. <https://www.flickr.com/photos/92094658@N00/269677724>
- `ov_5eafd623_Parliament_of_Zimbabwe_Harare_Zimbabwe_Southern_Af.jpg`: "Parliament of Zimbabwe, Harare - Zimbabwe, Southern Africa 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50606880002>
- `wc_Harare_parlament_24032005.jpg`: "Harare parlament 24032005.jpg", Radozw at Serbian Wikipedia, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare_parlament_24032005.jpg>
- `wc_DrugaUlicaHarare03042005.jpg`: "DrugaUlicaHarare03042005.jpg", Radozw at Serbian Wikipedia, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:DrugaUlicaHarare03042005.jpg>
- `ov_7663bb25_Reserve_Bank_of_Zimbabwe.jpg`: "Reserve Bank of Zimbabwe", Bayhaus, CC BY 2.0. <https://www.flickr.com/photos/47293505@N06/4813483200>

## 11. Munhumutapa Building

The photo is a 2023 view looking east along Samora Machel Ave. The building is on the right.

**The building.**

- A long 3-storey colonial block in **butter-yellow render**: sunlit `#e3da94` / `#f9f3ad`; shaded faces read sage `#889d83` under the blue sky.
- White-framed windows and one arched window. Red-brown clay tile **hipped roofs**: `#815e45` in sun, `#443f46` in shade.
- A **square clock tower** of ~30 m (about twice the eaves height), with a clock face on each side, an open round-arched belfry and a small hipped cap.

**Next to it.**

- A tall white 1960s-70s slab with continuous ribbon windows.
- A dark-grey clad shop with a big red TV SALES & HOME roundel.

The street itself is described in §20.

- `wc_Harare_Munhumutapa_Bldg.jpg`: "Harare Munhumutapa Bldg.jpg", Fritz Joubert, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Harare_Munhumutapa_Bldg.jpg>

## 12. Town House and Livingstone House

**Town House.** No freely licensed photo was found; keep the JSON guess. `wc_Harare_2024_6.jpg` shows a cream church with a slate spire, clock and arched porch behind a terracotta balustrade wall. It is **not** Town House, and its location is unidentified. It is useful as a generic CBD church, and it shows green plastic rooftop water tanks next door.

**Livingstone House (probable ID).** One white tower recurs on the north side of Samora Machel Ave just west of the Julius Nyerere footbridge. It stands directly behind the green-spired church on Samora Machel, and it is already there in the 1970s Jameson Ave photo. That matches Livingstone House (1960, 30 Samora Machel, north side).

- **Facade.** An off-white slab: `#acbcc0` in shade, albedo ~`#dfdfda`, with a regular punched-window grid.
- **Central bay.** A **full-height recessed dark-glass bay** down the middle of the long face (`#656c73` / `#4a5258`).
- **East end.** The end is a **semicircular rounded bay** with narrow vertical strip windows. Its top floor is a curved dark-glass band carrying a sign.
- **Roof.** A boxy lift house with a round porthole window.

`livingstone_house` is updated to pattern `grid`, facade `#dfdfda`, style_confidence `medium`.

**The church.** The church in front has a slender pale tower with a **green pointed spire** and green roofs (Samora Machel, next to Livingstone House). The 1970s photo shows the same church.

- `wc_Harare_Zimbabwe_2026_Samora_Machel.jpg`: "Harare Zimbabwe.jpg", Zimfarek, CC0. <https://commons.wikimedia.org/wiki/File:Harare_Zimbabwe.jpg>
- `ov_6ef347af_P1000984.jpg`: "P1000984", damien_farrell, Public Domain Mark. <https://www.flickr.com/photos/92094658@N00/7661980608>
- `ov_4dff88b3_P1000987.jpg`: "P1000987", damien_farrell, Public Domain Mark. <https://www.flickr.com/photos/92094658@N00/7661982950>
- `wc_1970s_Jameson_Avenue_Salisbury_Rhodesia_6875739032.jpg`: "1970s Jameson Avenue, Salisbury, Rhodesia 6875739032.jpg", Rob from United Kingdom, CC BY 2.0. <https://commons.wikimedia.org/wiki/File:1970s_Jameson_Avenue,_Salisbury,_Rhodesia_6875739032.jpg>
- `wc_Harare_2024_6.jpg`: "Harare 2024 6.jpg", Peter in s, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Harare_2024_6.jpg>

### Sacred Heart cathedral (`sacred_heart_cathedral`)

- **Material.** **Buff/tan rock-faced coursed stone blocks**, not brick: `#8e8173` lit in overcast light, albedo ~`#ad9d80`. The plinth is darker stone (`#5a4e42`).
- **West front.** Gothic Revival: a central gable with a cross and a rose window below it, a pointed-arch doorway with statues in niches, and paired lancet windows with tracery.
- **Towers.** **Two square towers** with paired louvred lancets and **flat crenellated tops with small corner pinnacles**. There are **no spires.** The towers are about 1.4 times the gable apex, roughly 26 m.
- **Forecourt.** Concrete paving, with a granite crucifix memorial (1937) in front.

- `wc_Sacred_Heart_Cathedral_Harare.jpg`: "Sacred Heart Cathedral, Harare.jpg", Mangwanani, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Sacred_Heart_Cathedral,_Harare.jpg>

## 13. National Gallery and Social Security Centre

**National Gallery.**

- **Upper storey.** Clad in large pale stone or concrete panels: shaded `#8f8c88`, recommended `#d9d4ca`. It is cantilevered over a recessed ground floor of dark glass and timber slat screens on **round pilotis**.
- **Mosaic mural.** A huge **abstract mosaic mural** (~20 × 5 m) fills most of the upper facade on Julius Nyerere Way: reds, blues and yellows on an ochre ground (`#c8b068`).
- **Clerestory.** A tall clerestory glass band runs at the upper right.
- **Entrance.** A reflecting pool and stone sculptures.
- **Grounds.** In front are a lawn, fan palms and a jacaranda, with a knee-high rope-and-post fence.

**Social Security Centre ("SSC").** It stands behind the gallery.

- A big grey-beige stone-clad tower (`#8e919a` / lit `#9b9ea8`) with a dense punched grid.
- A full-height blue glass strip, and a curved blue glass wing (`#9fbcca` lit) printed with **dark bird silhouettes**.
- **SSC** letters on the roof, and two-arm solar street lights in front.

- `ov_6a038393_Zimbabwe_Art_Gallery_Harare.jpg`: "Zimbabwe Art Gallery Harare", Tips For Travellers, CC BY 2.0. <https://www.flickr.com/photos/8327374@N02/557271359>
- `wc_Harare_Harare3497.jpg`: "Harare - Harare3497.jpg", lumoplank, CC0. <https://commons.wikimedia.org/wiki/File:Harare_-_Harare3497.jpg>
- `wc_National_Gallery_Zimbabwe.jpg`: "National Gallery Zimbabwe.jpg", Awinda, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:National_Gallery_Zimbabwe.jpg>
- `wc_Entrance_to_the_National_Gallery_of_Zimbabwe.jpg`: "Entrance to the National Gallery of Zimbabwe.jpg", Unknown author, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Entrance_to_the_National_Gallery_of_Zimbabwe.jpg>

## 14. ZANU-PF HQ and Rainbow Towers / HICC

**ZANU-PF HQ.** Seen from the Samora Machel Ave West side, with grass verges.

- A taupe-grey concrete slab tower (`#78766e` / lit `#95958a`) with chamfered corners and vertical window strips.
- A **steep gable ("Shake Shake" carton) top** with the cockerel emblem on the gable face.
- Arched openings at the base.

**Rainbow Towers and the HICC.** Only a blurred 2005 dusk photo was found.

- The hotel tower is gold/bronze glass framed by **thick solid sand-coloured end piers and a parapet frame** (`#e5cf8a` in warm light).
- The HICC is a massive **sand-coloured sculpted concrete** mass with curved roof profiles (`#dad19e`).

A 2009 close-up shows more of the ZANU-PF top:

- The carton top is a **steep dark slate-grey hipped/gabled roof** (`#363934`).
- **ZANU PF** letters sit in a pale band at the eaves.
- The body is brown-grey concrete (`#535447` in shade) with deep-set window rows and a projecting glazed corner bay.

- `ov_769061fd_The_sinister_tower_block_with_black_cockerel_that.jpg`: "The sinister tower block with black cockerel that is Zanu-PF HQ in Harare", frontlineblogger, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/12086274@N05/2379103027>
- `wc_Zanu_PF_Building.jpg`: "Zanu PF Building.jpg", Greg + Jannelle, CC BY 2.0. <https://commons.wikimedia.org/wiki/File:Zanu_PF_Building.jpg>
- `wc_Harare_Sheraton22032005.jpg`: "Harare Sheraton22032005.jpg", Radozw at Serbian Wikipedia, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare_Sheraton22032005.jpg>

## 15. Harare railway station

**Frontage** (Kenneth Kaunda Ave, 2006):

- 2 storeys of **red-brown face brick** (`#895c46` / `#7b4f3b`).
- Cream/white trim bands, window surrounds, cornice and a lettering band (`#bfc1ac` in shade; recommended `#e6e4d6`) reading **HARARE STATION** in black.
- Tall round-arched ground-floor windows with white glazing bars.
- The left wing has a **ground-floor colonnade of blue-painted columns** (`#365374`) under a first-floor balcony with a white balustrade.
- Red-brown tile hipped roofs with blue-painted fascia boards.
- A **red cupola** with white columns and a red dome on a brick base (`#603437`).
- Crowds, pickups and potted palms on the forecourt.

**Platforms (2023).**

- Blue steel canopy roofs on blue lattice columns.
- Black lattice catenary gantries.
- A red-brick signal cabin with a pyramidal tile roof.
- Ballast, and brown NRZ box wagons.
- Grey precast "durawall" fences along the tracks.
- The wooded **Kopje** is visible to the west.

- `wc_Harare_Central_Station.jpg`: "Harare Central Station.jpg", Samwise Gamgee, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare_Central_Station.jpg>
- `wc_NRZ_Harare_Station.jpg`: "NRZ Harare Station.jpg", Mindthem, CC BY 4.0. <https://commons.wikimedia.org/wiki/File:NRZ_Harare_Station.jpg>
- `ov_b25d8aa4_Railway_station_Harare.jpg`: "Railway station, Harare", frontlineblogger, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/12086274@N05/2379975322>
- `wc_Joina_City5.jpg`: "Joina City5.jpg", Mindthem, CC BY 4.0. <https://commons.wikimedia.org/wiki/File:Joina_City5.jpg>

## 16. Africa Unity Square

**Central fountain.**

- A **circular pool** about 15 m across with a knee-high wall. It is painted **bright turquoise-blue inside** (`#3d86a0` / `#43add3`).
- The wall is ringed by a low hoop-top railing, red-and-white in 1992 and yellow in 2006.
- A tall central jet (~15-20 m) plus ring jets.

**Paving and paths.**

- The plaza around the fountain is grey concrete block paving with a grid of joints.
- Paths are ~2.5 m wide grey concrete with low kerbs, running through lawns.

**Planting.**

- Very tall dark **cypresses** (columnar, 20-25 m), Canary and Washingtonia palms, and huge old jacarandas and flat-topped shade trees.
- Aloe and agave beds.

**Furniture and people.**

- Black lampposts with lantern heads.
- A black palisade fence on the perimeter, with gates at the corners.
- Flower sellers along Jason Moyo Ave.
- Photographers, and people sitting on the lawns.

**Surroundings.** Meikles to the south, Parliament and the cathedral to the north.

- `wc_Harare_Africa_Unity_1992.jpg`: "Harare Africa Unity 1992.jpg", Rob Worsnop, Public domain. <https://commons.wikimedia.org/wiki/File:Harare_Africa_Unity_1992.jpg>
- `ov_6a77b6d3_100_5747.jpg`: "100_5747", damien_farrell, CC BY 2.0. <https://www.flickr.com/photos/92094658@N00/269671973>
- `ov_2d4861b0_Africa_Unity_Square_Harare_Zimbabwe_2019.jpg`: "Africa Unity Square, Harare - Zimbabwe 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50606755246>
- `ov_eb970b72_Trees_in_Africa_Unity_Square_Harare_Zimbabwe.jpg`: "Trees in Africa Unity Square Harare Zimbabwe", amanderson2, CC BY 2.0. <https://www.flickr.com/photos/49399018@N00/28484810185>
- `wc_2006_Harare_Zimbabwe_279073454.jpg`: "2006 Harare Zimbabwe 279073454.jpg", damien_farrell, CC BY 2.0. <https://commons.wikimedia.org/wiki/File:2006_Harare_Zimbabwe_279073454.jpg>
- `wc_1997_Harare_Zimbabwe_3140056352.jpg`: "1997 Harare Zimbabwe 3140056352.jpg", damien_farrell, CC BY 2.0. <https://commons.wikimedia.org/wiki/File:1997_Harare_Zimbabwe_3140056352.jpg>

## 17. Harare Gardens

- **Canopy.** Seen from the Monomotapa, the gardens are a continuous, dense canopy: dark green in the wet season, olive in the dry season. It mixes rounded evergreen shade trees, feathery jacarandas, tall palms and some autumn-red species.
- **Inside.** A pond or stream and lawns. A festival crowd in front of a **white tensile-membrane stage canopy** shows that the gardens host HIFA-type events.
- **Monument.** A **tall pale stone obelisk** (World War memorial) stands on a stepped base in an open clearing, ringed by tall eucalyptus, cypress and palms. The RBZ is visible over the trees.
- **Edges.** Shaggy fan palms along Park Lane, and big open lawns.

- `ov_cb4f557f_Monomotapa_Hotel_Harare_Zimbabwe_2019.jpg`: "Monomotapa Hotel - Harare - Zimbabwe 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50606842777>
- `ov_f833cf86_Crowne_Plaza_Harare.jpg`: "Crowne Plaza, Harare", Bayhaus, CC BY 2.0. <https://www.flickr.com/photos/47293505@N06/4813530610>
- `wc_Monument_in_Harare_Gardens.jpg`: "Monument in Harare Gardens.jpg", MbuleloMwanza, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Monument_in_Harare_Gardens.jpg>
- `ov_7663bb25_Reserve_Bank_of_Zimbabwe.jpg`: "Reserve Bank of Zimbabwe", Bayhaus, CC BY 2.0. <https://www.flickr.com/photos/47293505@N06/4813483200>

## 18. The Kopje

- **Terrain.** A granite hill with **rounded grey boulders** (`#9d9892`), dry grass and red-brown earth.
- **Vegetation.** Msasa and other dry-woodland trees, tall **candelabra euphorbias**, aloes, and dense scrub on the slopes.
- **Summit lookout.** It has a lawn and an **old cast-iron lamp post with a green lantern**.
- **The view** looks NE over the low western CBD to the tower cluster (§1).

- `wc_Harare_from_the_Kopje.jpg`: "Harare from the Kopje.jpg", Andrew Balet, CC BY 2.5. <https://commons.wikimedia.org/wiki/File:Harare_from_the_Kopje.jpg>
- `wc_View_from_the_Kopje_Salisbury_Rhodesia_ca1975_6970085175.jpg`: "View from the Kopje, Salisbury Rhodesia ca1975 6970085175.jpg", Rob from United Kingdom, CC BY 2.0. <https://commons.wikimedia.org/wiki/File:View_from_the_Kopje,_Salisbury_Rhodesia_ca1975_6970085175.jpg>
- `wc_NRZ_Harare_Station.jpg`: "NRZ Harare Station.jpg", Mindthem, CC BY 4.0. <https://commons.wikimedia.org/wiki/File:NRZ_Harare_Station.jpg>

## 19. First Street Mall

**Paving.**

- **Terracotta clay pavers** laid in running bond (`#a58375` lit, `#836458` / `#977669`).
- Divided by **grey concrete paver bands** into a large grid of ~6 m squares (`#ada49b`).
- Small steps and ramps where levels change.

**Mall furniture.**

- A **black steel lattice arch** spans the mall on **red-painted posts**, with a white obelisk sign (the "Mayor's Cheer Fund").
- Raised planters with brick or stone edges hold shade trees (msasa or ficus-like) and **tall Washingtonia palms**.
- Black steel bins, kiosks and benches. People sit on the planter edges.

**Buildings.**

- 5-12 storey buildings: the CABS building (red-brown brick with a punched grid and blue "B" / "S" projecting signs), cream 1950s slabs with ribbon windows, and a grey 1970s block with sawtooth fins.
- Shopfronts under continuous cantilevered canopies: Edgars, Bata, TV Sales & Home, Appliance Centre and similar.

**At the Robert Mugabe Rd end.**

- Ornate **cream-painted cast-iron verandah columns** with lace spandrels.
- Colonial 2-storey facades with pilasters, arched windows and balustraded balconies.

- `wc_First_Street_Harare_Zimbabwe.jpg`: "First Street, Harare, Zimbabwe.jpg", Gary Bembridge, CC BY 2.0. <https://commons.wikimedia.org/wiki/File:First_Street,_Harare,_Zimbabwe.jpg>
- `wc_First_Street_Harare_Zimbabwe_2.jpg`: "First Street, Harare, Zimbabwe 2.jpg", Gary Bembridge, CC BY 2.0. <https://commons.wikimedia.org/wiki/File:First_Street,_Harare,_Zimbabwe_2.jpg>
- `ov_81203640_First_Street_Harare_Zimbabwe_Southern_Africa_2019.jpg`: "First Street, Harare - Zimbabwe, Southern Africa 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50606875637>
- `ov_7d6a94d3_Robert_Mugabe_Road_First_Street_Harare_Zimbabwe_20.jpg`: "Robert Mugabe Road/First Street, Harare - Zimbabwe 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50606754501>
- `ov_31b4786b_Robert_Mugabe_Road_First_Street_Harare_Zimbabwe_20.jpg`: "Robert Mugabe Road/First Street, Harare - Zimbabwe 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50606754126>

## 20. Typical CBD streets (Samora Machel, Julius Nyerere, Jason Moyo, Nelson Mandela, Robert Mugabe)

**Samora Machel Ave.**

- **Cross-section.** A dual carriageway with **3 lanes each way**, or 2 lanes plus a parking lane.
- **Median.** A narrow raised median, 1.5-3 m wide. Its kerbs are painted in **alternating black and white blocks** (~1 m each). It is planted with small palms, aloes and shrubs, and holds billboards on single poles.
- **Lights.** Tall grey **double-arm street lights** stand in the median; since ~2018 many carry a **solar panel on top**. Older sections have single-arm poles at the kerb.
- **Markings.** White dashed lane lines, and white turn arrows at junctions.
- **Traffic lights.** Black heads on **black-and-white banded poles**.
- **Street signs.** Black-on-white corner signs fixed to buildings (e.g. "R. MUGABE RD").
- **Pedestrian crossing** at the Julius Nyerere corner (Nehanda statue and footbridges, not photographed).

**Julius Nyerere Way and Jason Moyo Ave.** Photos of Julius Nyerere Way were not identified with certainty.

- Undivided 4-lane avenues, ~20 m kerb to kerb, with 4-5 m pavements.
- Most buildings have a **continuous cantilevered concrete canopy** over the pavement at first-floor level. The canopy carries fascia shop signs (NetOne, Kitty's Chicken, Bata and so on).
- Canopies alternate with **ground-floor arcades** (square piers, covered walkway) on 1930s-50s blocks.
- Security: roll-down steel shutters and cream-painted expanded-metal mesh grilles.

**Pavements and verges.**

- Pavements are grey concrete slabs (`#bfbdbc` sunlit), cracked and patched.
- Kerbs are plain grey concrete, painted yellow at ranks and no-stopping zones.
- In the Avenues and on the fringe, verges are unkerbed **red-brown earth or dry grass**, with litter.

**Road surface.** Pale sun-bleached asphalt: `#918e83` (sun), `#636261` (overcast). Recommended `#848178`, with darker patch repairs.

**Street level in January 2019 (rainy season).** A Mapillary drive, CC BY-SA on Commons, runs from Jason Moyo Ave past Africa Unity Square and north through the Avenues.

- **CBD streets:** 2 moving lanes plus kerbside parking on both sides, packed with white and silver cars and kombis. The buildings are 1960s white balcony blocks with pavement canopies.
- **Paving.** Sidewalks and forecourts outside the core use **interlocking concrete or clay pavers** (herringbone, grey and brick-red mix).
- **Bollards.** Short conical concrete bollards painted in bands (red/white/green/white).
- **Kerbs** are painted in white and black segments.
- **Divided roads north of the CBD.** Wide **grass medians** (unmown, with red earth at the edges), **red-and-white painted barrier blocks** at the median noses, and galvanised gantry-arm traffic signals.
- **Along the carriageway.** **Solar street lights** (panel on top of the pole), and large bank billboards on single poles (Nedbank green, CBZ and so on).
- **Road surface.** The asphalt is patchy grey with dark repair patches and faded white edge lines.

**Traffic.**

- White or silver Japanese used cars dominate: Honda Fit, Toyota Wish and Corolla, Mazda Demio, Nissan.
- Also white Toyota Hilux and Nissan pickups, often loaded, and white HiAce kombis.
- Occasional older 1980s-90s cars and yellow taxis.
- Plates are **yellow**, front and rear.
- Pickups are often loaded high (furniture, sacks), and cars and pickups carry company advertising wraps (TelOne, etc.).
- **Parking structures.** A multi-storey concrete car park with a covered pedestrian bridge spans the street near the Main Post Office (Tips For Travellers photo).
- **History.**
  - The 1936 Stanley Ave view (now Jason Moyo) shows angle parking in painted bays both at the kerb and down the centre of the avenue, 2-3 storey buildings with giant-order colonnades and first-floor balconies, pavement verandahs on slender posts, and canvas awnings.
  - The 1970s Jameson Ave view (now Samora Machel) shows the same width with tall disc-topped lamp standards. Handy for a "flashback" skin.

- `wc_Mapillary_380273663274629_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg`: "Mapillary (380273663274629, 6Rd1ig7CTn2kV9-YgGdUEw) (rubynikki) 2019-01-09 13H11M56S000.jpg", rubynikki, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Mapillary_(380273663274629,_6Rd1ig7CTn2kV9-YgGdUEw)_(rubynikki)_2019-01-09_13H11M56S000.jpg>
- `wc_Mapillary_138205998291259_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg`: "Mapillary (138205998291259, 6Rd1ig7CTn2kV9-YgGdUEw) (rubynikki) 2019-01-09 13H13M11S000.jpg", rubynikki, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Mapillary_(138205998291259,_6Rd1ig7CTn2kV9-YgGdUEw)_(rubynikki)_2019-01-09_13H13M11S000.jpg>
- `wc_Mapillary_981883909298347_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg`: "Mapillary (981883909298347, 6Rd1ig7CTn2kV9-YgGdUEw) (rubynikki) 2019-01-09 13H15M02S000.jpg", rubynikki, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Mapillary_(981883909298347,_6Rd1ig7CTn2kV9-YgGdUEw)_(rubynikki)_2019-01-09_13H15M02S000.jpg>
- `wc_Mapillary_196761335623742_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg`: "Mapillary (196761335623742, 6Rd1ig7CTn2kV9-YgGdUEw) (rubynikki) 2019-01-09 13H17M11S000.jpg", rubynikki, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Mapillary_(196761335623742,_6Rd1ig7CTn2kV9-YgGdUEw)_(rubynikki)_2019-01-09_13H17M11S000.jpg>
- `wc_Mapillary_4079194532123539_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki.jpg`: "Mapillary (4079194532123539, 6Rd1ig7CTn2kV9-YgGdUEw) (rubynikki) 2019-01-09 13H20M17S000.jpg", rubynikki, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Mapillary_(4079194532123539,_6Rd1ig7CTn2kV9-YgGdUEw)_(rubynikki)_2019-01-09_13H20M17S000.jpg>
- `wc_Mapillary_935472137229781_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg`: "Mapillary (935472137229781, 6Rd1ig7CTn2kV9-YgGdUEw) (rubynikki) 2019-01-09 13H24M00S000.jpg", rubynikki, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Mapillary_(935472137229781,_6Rd1ig7CTn2kV9-YgGdUEw)_(rubynikki)_2019-01-09_13H24M00S000.jpg>
- `wc_Mapillary_340690094063036_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg`: "Mapillary (340690094063036, 6Rd1ig7CTn2kV9-YgGdUEw) (rubynikki) 2019-01-09 13H30M48S000.jpg", rubynikki, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Mapillary_(340690094063036,_6Rd1ig7CTn2kV9-YgGdUEw)_(rubynikki)_2019-01-09_13H30M48S000.jpg>
- `wc_Mapillary_110386021120860_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg`: "Mapillary (110386021120860, 6Rd1ig7CTn2kV9-YgGdUEw) (rubynikki) 2019-01-09 13H29M29S000.jpg", rubynikki, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Mapillary_(110386021120860,_6Rd1ig7CTn2kV9-YgGdUEw)_(rubynikki)_2019-01-09_13H29M29S000.jpg>
- `wc_Mapillary_387168872440630_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg`: "Mapillary (387168872440630, 6Rd1ig7CTn2kV9-YgGdUEw) (rubynikki) 2019-01-09 13H25M51S000.jpg", rubynikki, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Mapillary_(387168872440630,_6Rd1ig7CTn2kV9-YgGdUEw)_(rubynikki)_2019-01-09_13H25M51S000.jpg>
- `wc_Mapillary_1161218104319257_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki.jpg`: "Mapillary (1161218104319257, 6Rd1ig7CTn2kV9-YgGdUEw) (rubynikki) 2019-01-09 13H27M43S000.jpg", rubynikki, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Mapillary_(1161218104319257,_6Rd1ig7CTn2kV9-YgGdUEw)_(rubynikki)_2019-01-09_13H27M43S000.jpg>
- `wc_Mapillary_3084971671789906_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki.jpg`: "Mapillary (3084971671789906, 6Rd1ig7CTn2kV9-YgGdUEw) (rubynikki) 2019-01-09 13H22M09S000.jpg", rubynikki, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Mapillary_(3084971671789906,_6Rd1ig7CTn2kV9-YgGdUEw)_(rubynikki)_2019-01-09_13H22M09S000.jpg>
- `wc_Mapillary_335170627955279_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg`: "Mapillary (335170627955279, 6Rd1ig7CTn2kV9-YgGdUEw) (rubynikki) 2019-01-09 13H18M25S000.jpg", rubynikki, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Mapillary_(335170627955279,_6Rd1ig7CTn2kV9-YgGdUEw)_(rubynikki)_2019-01-09_13H18M25S000.jpg>
- `wc_Harare_Munhumutapa_Bldg.jpg`: "Harare Munhumutapa Bldg.jpg", Fritz Joubert, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Harare_Munhumutapa_Bldg.jpg>
- `ov_d9e4adc4_Samora_Machel_Avenue_Harare_Zimbabwe_2019.jpg`: "Samora Machel Avenue - Harare, Zimbabwe 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50606690096>
- `ov_00a926b7_Samora_Machel_Avenue_Harare_Zimbabwe_2019.jpg`: "Samora Machel Avenue - Harare, Zimbabwe 2019", eriktorner, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/39267804@N05/50606880767>
- `ov_4dff88b3_P1000987.jpg`: "P1000987", damien_farrell, Public Domain Mark. <https://www.flickr.com/photos/92094658@N00/7661982950>
- `ov_6ef347af_P1000984.jpg`: "P1000984", damien_farrell, Public Domain Mark. <https://www.flickr.com/photos/92094658@N00/7661980608>
- `wc_Jason_Moyo_ave_Harare.jpg`: "Jason Moyo ave Harare.jpg", Itaisibanda, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Jason_Moyo_ave_Harare.jpg>
- `wc_The_Avenues_Harare.jpg`: "The Avenues, Harare.jpg", Maipo, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:The_Avenues,_Harare.jpg>
- `wc_Harare_CBD.jpg`: "Harare CBD.jpg", Agororo1, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Harare_CBD.jpg>
- `wc_Harare_Zimbabwe_02.jpg`: "Harare, Zimbabwe. 02.JPG", Suesen, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare,_Zimbabwe._02.JPG>
- `wc_Harare_Zimbabwe_11.jpg`: "Harare, Zimbabwe. 11.JPG", Suesen, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare,_Zimbabwe._11.JPG>
- `ov_cef77ace_Harare_1.jpg`: "Harare 1", SqueakyMarmot, CC BY-SA 2.0. <https://www.flickr.com/photos/37804160@N00/14521853568>
- `ov_d706b8c1_Harare_2.jpg`: "Harare 2", SqueakyMarmot, CC BY-SA 2.0. <https://www.flickr.com/photos/37804160@N00/14522064757>
- `ov_8b8ae35f_Harare_3.jpg`: "Harare 3", SqueakyMarmot, CC BY-SA 2.0. <https://www.flickr.com/photos/37804160@N00/14521848209>
- `ov_e7f525ec_Harare_Street_Zimbabwe.jpg`: "Harare Street, Zimbabwe", Tips For Travellers, CC BY 2.0. <https://www.flickr.com/photos/8327374@N02/557275201>
- `ov_5a39a227_Harare_Street_Scene.jpg`: "Harare Street Scene", mifl68, CC BY-NC-ND 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/8443411@N05/3351644299>
- `wc_Late_afternoon_traffic_on_Robert_Mugabe_road.jpg`: "Late afternoon traffic on Robert Mugabe road.jpg", Itaisibanda, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Late_afternoon_traffic_on_Robert_Mugabe_road.jpg>
- `wc_Harare_Zimbabwe_2026_Samora_Machel.jpg`: "Harare Zimbabwe.jpg", Zimfarek, CC0. <https://commons.wikimedia.org/wiki/File:Harare_Zimbabwe.jpg>
- `wc_HARARE_ZIMBABWE.jpg`: "HARARE ZIMBABWE.jpg", Ryen Gwaze, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:HARARE_ZIMBABWE.jpg>
- `wc_Downtown_Harare.jpg`: "Downtown Harare.jpg", Croquant, CC BY 3.0. <https://commons.wikimedia.org/wiki/File:Downtown_Harare.jpg>
- `wc_1997_Harare_Zimbabwe_3140053190.jpg`: "1997 Harare Zimbabwe 3140053190.jpg", damien_farrell, CC BY 2.0. <https://commons.wikimedia.org/wiki/File:1997_Harare_Zimbabwe_3140053190.jpg>
- `ov_c5f592ec_Zimbabwe_Harare_Post_Office.jpg`: "Zimbabwe Harare Post Office", Tips For Travellers, CC BY 2.0. <https://www.flickr.com/photos/8327374@N02/557106824>
- `ov_e7b3dcf2_Harare_Traffic.jpg`: "Harare Traffic", The Advocacy Project, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/42487558@N00/42184790280>
- `wc_Harare_Zimbabwe_07.jpg`: "Harare, Zimbabwe. 07.JPG", Suesen, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare,_Zimbabwe._07.JPG>
- `wc_1970s_Jameson_Avenue_Salisbury_Rhodesia_6875739032.jpg`: "1970s Jameson Avenue, Salisbury, Rhodesia 6875739032.jpg", Rob from United Kingdom, CC BY 2.0. <https://commons.wikimedia.org/wiki/File:1970s_Jameson_Avenue,_Salisbury,_Rhodesia_6875739032.jpg>
- `wc_Stanley_Avenue_Salisbury_1936.jpg`: "Stanley Avenue, Salisbury, 1936.jpg", Department of Publicity, Southern Rhodesia, Public domain. <https://commons.wikimedia.org/wiki/File:Stanley_Avenue,_Salisbury,_1936.jpg>

## 21. Everyday CBD buildings (procedural fill)

These are palettes and types seen repeatedly in the street photos. The hexes are overcast or shaded samples, with albedo suggestions in brackets.

- **1950s-60s slabs (8-15 storeys).**
  - Horizontal ribbon windows with pastel spandrels. Throgmorton House has **mint-teal** panels (`#466d6e` / `#678181`, albedo ~`#7fa39c`); others use powder blue or orange-tan bands.
  - The end walls are often face brick, or have large painted letters (e.g. THROGMORTON running vertically).
  - Many have **curved balcony drums** at the corners and blue-painted balconies.
- **Red-brown brick slabs (6-12 storeys).** Punched window grids with white frames: `#4a2e2b` / `#4c332e` in shade (albedo ~`#7a4436`).
- **1930s-50s commercial blocks (3-6 storeys).**
  - Cream, ochre or pale-yellow render with pilasters and cornices, and Art Deco curved corners.
  - Arcades or colonnades at ground level; balconies with steel tube railings.
- **Colonial 1-2 storey shops on the Kopje side and at the west end of Robert Mugabe.**
  - Painted render or brick fronts with parapets.
  - **Verandahs** of corrugated iron on thin steel posts, or ornate cast-iron columns.
  - Painted fascia boards with shop names, e.g. "Treasure Trove" (1997).
- **Modern (1990s-2010s).** Blue or teal reflective glass boxes framed by grey stone or concrete piers. Many have a shallow crown frame or a rooftop sign.
- **Rooftops.**
  - Lift overruns and billboard frames, some with painted brand walls.
  - **Green plastic water tanks on steel stands**, satellite dishes, and telecom masts on a few roofs.
- **Brand colours seen:** Irvine's (yellow), OK and TM Pick n Pay (red), CABS (blue), NetOne, Econet (blue), TV Sales & Home (red roundel), Kingdom Bank (green), Coca-Cola/Pepsi red and blue umbrellas.

- `wc_Harare_Zimbabwe_04.jpg`: "Harare, Zimbabwe. 04.JPG", Suesen, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare,_Zimbabwe._04.JPG>
- `ov_e504fe94_Harare_4.jpg`: "Harare 4", SqueakyMarmot, CC BY-SA 2.0. <https://www.flickr.com/photos/37804160@N00/14685506386>
- `wc_Harare_Zimbabwe_03.jpg`: "Harare, Zimbabwe. 03.JPG", Suesen, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare,_Zimbabwe._03.JPG>
- `wc_Harare_Zimbabwe_01.jpg`: "Harare, Zimbabwe. 01.JPG", Suesen, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare,_Zimbabwe._01.JPG>
- `ov_5a87b2d6_Station_Furnishers.jpg`: "Station Furnishers", Artbandito, CC BY-NC-ND 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/33859819@N00/75735799>
- `wc_Harare_Downtown1.jpg`: "Harare Downtown1.jpg", Macvivo at English Wikipedia (Original text: Samwise Gamgee), CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare_Downtown1.jpg>
- `wc_Harare_secondst.jpg`: "Harare secondst.jpg", Damien Farrell, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare_secondst.jpg>
- `wc_Harare_2024_5.jpg`: "Harare 2024 5.jpg", Peter in s, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Harare_2024_5.jpg>
- `ov_250d61be_IMG_0829_JPG.jpg`: "IMG_0829.JPG", ethanz, CC BY-NC 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/51035577930@N01/248624560>

## 22. Jacaranda avenues and street trees

**Jacarandas.**

- Old jacarandas line many avenues. Their **ochre-brown, low-branching trunks** splay out and arch over the road into a closed tunnel.
- Bark: `#3d2d1f` with orange-brown highlights `#5f4a33`.
- **In flower (September-November)** the canopy is a pale **lavender-blue**, not saturated purple: `#9994a6` / `#b5bfdd` lit, `#70697d` shade, `#5d5370` in deep shade. The flowers carpet the verges.
- Out of flower, the canopy is feathery mid-green.

**Other trees.**

- **Flamboyant (flame) trees**, scarlet in Oct-Dec.
- Tall **Washingtonia and Canary palms**, and cypresses in the squares.
- Big evergreen shade trees on Julius Nyerere and Nelson Mandela.

**Verges.** Bare **red laterite earth** (`#7c6556` / `#9b816a`) with leaf litter. There are no tree grates.

- `wc_Harare_Harare3496.jpg`: "Harare - Harare3496.jpg", lumoplank, CC0. <https://commons.wikimedia.org/wiki/File:Harare_-_Harare3496.jpg>
- `wc_Harare_Harare3492.jpg`: "Harare - Harare3492.jpg", lumoplank, CC0. <https://commons.wikimedia.org/wiki/File:Harare_-_Harare3492.jpg>
- `wc_Harare_Harare3497.jpg`: "Harare - Harare3497.jpg", lumoplank, CC0. <https://commons.wikimedia.org/wiki/File:Harare_-_Harare3497.jpg>
- `wc_Jacaranda_flowering.jpg`: "Jacaranda flowering.jpg", Damien Farrell, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Jacaranda_flowering.jpg>
- `wc_2006_Harare_Zimbabwe_279073454.jpg`: "2006 Harare Zimbabwe 279073454.jpg", damien_farrell, CC BY 2.0. <https://commons.wikimedia.org/wiki/File:2006_Harare_Zimbabwe_279073454.jpg>
- `ov_2de47b8d_100_5748.jpg`: "100_5748", damien_farrell, CC BY 2.0. <https://www.flickr.com/photos/92094658@N00/269677724>
- `ov_547e9532_2011_10_22_Harare.jpg`: "2011.10.22 Harare", tlupic, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/57128374@N02/6308389747>
- `ov_6d2e964f_jacaranda_s_in_Harare.jpg`: "jacaranda's in Harare", Victoria_Hume, CC BY-NC 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/41193915@N04/8114963856>
- `wc_Jacaranda_trees_in_Montagu_Ave_Harare_Zimbabwe_in_1975.jpg`: "Jacaranda trees in Montagu Ave, Harare, Zimbabwe in 1975.jpg", GrahamBould, Public domain. <https://commons.wikimedia.org/wiki/File:Jacaranda_trees_in_Montagu_Ave,_Harare,_Zimbabwe_in_1975.jpg>
- `ov_8c6650b7_Harare_Zimbabwe.jpg`: "Harare, Zimbabwe", Artbandito, CC BY-NC-ND 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/33859819@N00/75721100>
- `ov_6d29610e_Harare_Street_Scene.jpg`: "Harare Street Scene", mifl68, CC BY-NC-ND 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/8443411@N05/3351641151>
- `wc_Harare_2024_1.jpg`: "Harare 2024 1.jpg", Peter in s, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Harare_2024_1.jpg>

## 23. Kombis

**2010s-2020s.**

- Almost all are **white Toyota HiAce**: the older high-roof H100 "Commuter" with a long body and square nose, and the H200 "Quantum".
- The body is off-white or dusty white. Side panels are often dented or scraped, with mismatched repaired panels.
- **Other makes.** Some are silver **HiAce H200** or **Nissan Caravan**, with a red reflective stripe on the rear bumper (2019).
- **Waist stripe.** Many carry a faded factory **stripe of gold/orange over thin black** (`#b0782a` + black; `#472d14` / `#562f08` sampled in shade) along the waistline and the sliding door.
- **Windows.** Tinted, with stickers along the top of the windscreen. The route is shown on a card in the windscreen or called out by the tout (*hwindi*).
- **ZUPCO franchise stickers** appear from 2019 on.
- **Plates.** Yellow, front and rear.
- **Behaviour.** They cluster at kerbs, often double-parked, with the sliding door open.

**1990s.** The fleet was mixed white Ford Transits, Mitsubishi L300s and Toyota HiAces with plain white bodies.

**Larger commuter omnibuses.** Toyota Coaster-type 25-30 seaters.

- White with a red/orange side stripe.
- A **roof rack** with luggage and a heavy **bull bar**.
- A yellow destination card (e.g. "MBARE") in the windscreen.

**At the ranks.** Kombis queue nose to tail. Touts and passengers stand around, a few roof racks are loaded, and the ground is compacted earth.

- `ov_d706b8c1_Harare_2.jpg`: "Harare 2", SqueakyMarmot, CC BY-SA 2.0. <https://www.flickr.com/photos/37804160@N00/14522064757>
- `wc_Mapillary_138205998291259_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg`: "Mapillary (138205998291259, 6Rd1ig7CTn2kV9-YgGdUEw) (rubynikki) 2019-01-09 13H13M11S000.jpg", rubynikki, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Mapillary_(138205998291259,_6Rd1ig7CTn2kV9-YgGdUEw)_(rubynikki)_2019-01-09_13H13M11S000.jpg>
- `wc_Mapillary_981883909298347_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg`: "Mapillary (981883909298347, 6Rd1ig7CTn2kV9-YgGdUEw) (rubynikki) 2019-01-09 13H15M02S000.jpg", rubynikki, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Mapillary_(981883909298347,_6Rd1ig7CTn2kV9-YgGdUEw)_(rubynikki)_2019-01-09_13H15M02S000.jpg>
- `ov_57452f27_P1000957.jpg`: "P1000957", damien_farrell, Public Domain Mark. <https://www.flickr.com/photos/92094658@N00/7661976432>
- `ov_00281687_Scan10384.jpg`: "Scan10384", damien_farrell, CC BY 2.0. <https://www.flickr.com/photos/92094658@N00/3140056962>
- `wc_Toyota_Commuter_Omnibus_Harare_11761304886.jpg`: "Toyota Commuter Omnibus Harare (11761304886).jpg", Bob Adams from George, South Africa, CC BY-SA 2.0. <https://commons.wikimedia.org/wiki/File:Toyota_Commuter_Omnibus_Harare_(11761304886).jpg>
- `ov_b792e823_4th_Street_Bus_Terminus.jpg`: "4th Street Bus Terminus", Bayhaus, CC BY 2.0. <https://www.flickr.com/photos/47293505@N06/4813484926>
- `wc_Harare_Roadport.jpg`: "Harare Roadport.jpg", Tappzman, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Harare_Roadport.jpg>
- `ov_05c73255_IMG_3558.jpg`: "IMG_3558", john.culley (Flickr), CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/135932382@N08/29011721813>

## 24. ZUPCO and other buses

**ZUPCO in the 1990s.**

- Front-engined rigid buses with a **cream/white upper body and a blue lower body** divided by a thin dark line, and a blue-and-cream front (1995).
- In 1999 the rear was pale cream, with a painted ZUPCO slogan panel ("A COMMITMENT TO SAFE & RELIABLE TRAVEL"), a ladder to a roof rack and a red/orange chevron bumper bar.

**Private buses at the 4th Street terminus (c. 2010).** Bright **yellow and green** livery with painted cartoons.

**Recent city buses.** Recent photos show white buses (a white city bus under tow, 2014). The STREETLIFE notes cover the ZUPCO 2019+ white livery.

**Other liveries seen (2006-2014).**

- A Scania/Marcopolo city bus in **light blue with a yellow-and-red swoosh stripe**, "HARARE" on the destination blind.
- An older front-engined bus in **green over cream** with a full-length roof rack (Maranga Transport, 2011).
- A modern white-and-navy long-distance coach (Tenda, 2014).
- People ride on bus roofs to load luggage.

**Long-distance and rural buses** (Roadport, Mbare): high-floor coaches in bright liveries, often with roof racks piled with luggage.

**Termini.**

- Steel palisade fences painted yellow or orange.
- Kerbs painted yellow.
- **Tall multi-head floodlight masts.**
- Red Coca-Cola kiosks.

- `wc_Harare.jpg`: "Harare.jpg", Greenmnm69 (assumed), CC BY-SA 2.5. <https://commons.wikimedia.org/wiki/File:Harare.jpg>
- `wc_Zupco.jpg`: "Zupco.jpg", K Comandich, CC BY-SA 2.0. <https://commons.wikimedia.org/wiki/File:Zupco.jpg>
- `ov_da88d797_Scan10382.jpg`: "Scan10382", damien_farrell, CC BY 2.0. <https://www.flickr.com/photos/92094658@N00/3140055300>
- `ov_b792e823_4th_Street_Bus_Terminus.jpg`: "4th Street Bus Terminus", Bayhaus, CC BY 2.0. <https://www.flickr.com/photos/47293505@N06/4813484926>
- `ov_5abac832_Bus_Station_Harare_Zimbabwe.jpg`: "Bus Station, Harare, Zimbabwe.", tonywright617, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/129893691@N07/34264946316>
- `ov_f7b6234d_Bus.jpg`: "Bus", Artbandito, CC BY-NC-ND 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/33859819@N00/75738865>
- `ov_70b81282_Harare_5.jpg`: "Harare 5", SqueakyMarmot, CC BY-SA 2.0. <https://www.flickr.com/photos/37804160@N00/14708114552>
- `wc_Bus_truck_Harare_11760783763.jpg`: "Bus-truck Harare (11760783763).jpg", Bob Adams from George, South Africa, CC BY-SA 2.0. <https://commons.wikimedia.org/wiki/File:Bus-truck_Harare_(11760783763).jpg>
- `wc_Volvo_FL10_Artic_Bus_Harare_11761299076.jpg`: "Volvo FL10 Artic Bus Harare (11761299076).jpg", Bob Adams from George, South Africa, CC BY-SA 2.0. <https://commons.wikimedia.org/wiki/File:Volvo_FL10_Artic_Bus_Harare_(11761299076).jpg>
- `wc_Scania_Marcopolo_Harare_11760537105.jpg`: "Scania Marcopolo Harare (11760537105).jpg", Bob Adams from Amanzimtoti, South Africa, CC BY-SA 2.0. <https://commons.wikimedia.org/wiki/File:Scania_Marcopolo_Harare_(11760537105).jpg>
- `wc_Maranga_Transport.jpg`: "Maranga Transport.jpg", Tappzman, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Maranga_Transport.jpg>
- `wc_Tenda_Bus_baba_acho.jpg`: "Tenda Bus "baba acho".jpg", Tappzman, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Tenda_Bus_%22baba_acho%22.jpg>
- `wc_Peeping_over_bus.jpg`: "Peeping over bus.jpg", Joemuodzi, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Peeping_over_bus.jpg>

## 25. Street vendors

- **Ground spreads.** Goods laid on a **green or blue tarpaulin** on the pavement: shoes, flip-flops, socks, clothes. The vendor sits on the ground or on an upturned **white 20 L bucket**, against a shop's security mesh or a precast "durawall".
- **Airtime sellers.** A shallow cardboard tray of airtime scratch cards in rows, on a box.
- **Fruit and vegetable carts.** Two-wheel **steel push carts** on car or wheelbarrow tyres, heaped with oranges, apples, bananas or carrots. They park in the kerbside parking lane and in rows along the pavement edge.
- **Grocery stacks (2018-2020 markets).** Pyramids of **yellow cooking-oil bottles**, bags of maize meal (red and blue print) and soap, on cardboard boxes and crates. Litter underfoot.
- **Shade and props.** Tarps, a branded blue drinks cooler (Pepsi seen at First St/Robert Mugabe), and upturned crates as tables.
- **Women fruit sellers.** They sit on the pavement edge with basins and boxes of fruit, and orange hi-vis vests are common.
- **Headloads.** Baskets of tomatoes, buckets, and boxes carried on the head.
- **Flower sellers** along Africa Unity Square and Jason Moyo Ave.

- `wc_Carts_loaded_with_fruits_and_vegetables_for_sale_in_Harare.jpg`: "Carts loaded with fruits and vegetables for sale in Harare.jpg", Cecil Dzwowa, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Carts_loaded_with_fruits_and_vegetables_for_sale_in_Harare.jpg>
- `ov_e2821058_Informal_Market_in_Harare.jpg`: "Informal Market in Harare", The Advocacy Project, CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/42487558@N00/42185350320>
- `wc_Vendors_in_pavements.jpg`: "Vendors in pavements.jpg", ProtaJkz03, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Vendors_in_pavements.jpg>
- `wc_Vendors_in_Zimbabwe_selling_in_pavements.jpg`: "Vendors in Zimbabwe selling in pavements.jpg", ProtaJkz03, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Vendors_in_Zimbabwe_selling_in_pavements.jpg>
- `wc_Harare_street_vendor.jpg`: "Harare street vendor.jpg", Ben Chanz Chanditeya, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Harare_street_vendor.jpg>
- `wc_Fruit_ladies.jpg`: "Fruit ladies.jpg", Jeremy Kupfuwa, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Fruit_ladies.jpg>
- `wc_Banana_seller_in_Zimbabwe_2017.jpg`: "Banana seller in Zimbabwe, 2017.jpg", Jeremy Kupfuwa, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Banana_seller_in_Zimbabwe,_2017.jpg>
- `wc_Harare_Zimbabwe_10.jpg`: "Harare, Zimbabwe. 10.JPG", Suesen, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare,_Zimbabwe._10.JPG>
- `wc_Harare_Zimbabwe_09.jpg`: "Harare, Zimbabwe. 09.JPG", Suesen, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare,_Zimbabwe._09.JPG>
- `ov_18a39165_Harare_Zimbabwe.jpg`: "Harare - Zimbabwe", ILO PHOTOS NEWS, CC BY-NC-ND 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/71226001@N06/49865915398>
- `ov_c5a9c855_Harare_Zimbabwe.jpg`: "Harare - Zimbabwe", ILO PHOTOS NEWS, CC BY-NC-ND 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/71226001@N06/49866767747>
- `ov_8380db77_Harare_Zimbabwe.jpg`: "Harare - Zimbabwe", ILO PHOTOS NEWS, CC BY-NC-ND 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/71226001@N06/49865913098>
- `wc_Cooked_beetle_Vendor_Zimbabwe_Oct_2017.jpg`: "Cooked beetle Vendor (Zimbabwe, Oct 2017).jpg", Olivia Logan, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Cooked_beetle_Vendor_(Zimbabwe,_Oct_2017).jpg>
- `ov_665dff12_Flower_stall_by_Meikles_5_Star_Hotel_Harare.jpg`: "Flower stall by Meikles 5 Star Hotel. Harare", Mary Gillham Archive Project, CC BY 2.0. <https://www.flickr.com/photos/139791896@N06/23923363878>

## 26. Pedestrians

- **Office workers.** Men in dark suits, or white or light-blue shirts with ties and dark trousers.
- **Older women.** Long print dresses or wraps (*zambia* cloth, often gingham or checks), knitted or cloth headwraps and hats. They carry handbags or shopping bags on the head.
- **Young men.** Bright T-shirts (red is common), caps, track tops, football shirts, jeans and chinos, and trainers. Many carry shoulder bags.
- **Workers.** Council workers wear navy overalls with reflective bands and wide-brim hats, and push wheeled bins. A soldier in camouflage fatigues appears on First Street.
- **Skin tones** are mostly dark brown.
- **Crowd density.** Dense along First Street, Jason Moyo, and the ranks and their approaches. Sparse on Samora Machel's wide pavements.

- `ov_05c73255_IMG_3558.jpg`: "IMG_3558", john.culley (Flickr), CC BY-NC-SA 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/135932382@N08/29011721813>
- `wc_Harare_Africa_Unity_1992.jpg`: "Harare Africa Unity 1992.jpg", Rob Worsnop, Public domain. <https://commons.wikimedia.org/wiki/File:Harare_Africa_Unity_1992.jpg>
- `ov_1fe043a9_Harare_Zimbabwe.jpg`: "Harare - Zimbabwe", ILO PHOTOS NEWS, CC BY-NC-ND 2.0 **(non-commercial: reference only)**. <https://www.flickr.com/photos/71226001@N06/49865918843>
- `wc_Citizens_In_the_Streets_of_Harare_Zimbabwe_November_19_2017.jpg`: "Citizens In the Streets of Harare, Zimbabwe, November 19, 2017.jpg", Nanorsuaq, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Citizens_In_the_Streets_of_Harare,_Zimbabwe,_November_19,_2017.jpg>
- `wc_Fellowship_amongst_street_vendors.jpg`: "Fellowship amongst street vendors.jpg", Ben Chanz Chanditeya, CC BY-SA 4.0. <https://commons.wikimedia.org/wiki/File:Fellowship_amongst_street_vendors.jpg>
- `wc_Harare_Zimbabwe_11.jpg`: "Harare, Zimbabwe. 11.JPG", Suesen, CC BY-SA 3.0. <https://commons.wikimedia.org/wiki/File:Harare,_Zimbabwe._11.JPG>

## 27. Open questions

- **Karigamombe vs Millennium Towers.** Which one is the spired blue-glass tower WSW of the RBZ? Bearings favour Karigamombe. A captioned photo would settle it.
- **Old Mutual Centre.** Where is it? The only "OLD MUTUAL" rooftop sign found is on a beige slab west of Sam Nujoma St.
- **No free photos found for:** Town House, Mukwati/Kaguvi, Defence House, Century Towers, Angwa City, Holiday Inn, the Joina City podium and the Mbuya Nehanda statue. The footbridge over Samora Machel at Julius Nyerere is visible in `wc_Harare_Zimbabwe_2026_Samora_Machel.jpg` (2026): a grey steel truss bridge.
- **Livingstone House** is a probable ID only; confirm it with a captioned photo.
- **Where to look next.** Mapillary street-level imagery covers the CBD (a CC BY-SA 2019 sequence around Africa Unity Square is on Commons as "Mapillary (…) (rubynikki) 2019-01-09"). It is the best next source for streets and building fronts.
- **Social Security Centre height.** The SSC looks ~18 storeys against the JSON's 16. Check before changing the height.
