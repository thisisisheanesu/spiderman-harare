# Spider-Man: Harare

A fan-made web-swinging game set in a real-data recreation of **Harare's Central Business District, Zimbabwe**,
built with [Three.js](https://threejs.org). Perch on the Reserve Bank of Zimbabwe, dive down its glass face, swing
along Samora Machel Avenue under the jacarandas, and land among kombis, vendors and passers-by who speak with
**real Zimbabwean voices**.

> Fan project — not affiliated with, endorsed by or sponsored by Marvel, Sony or Insomniac.

## Play

```bash
npm install
npm run dev        # open http://localhost:5173
npm run build      # static build in dist/ (relative paths, host anywhere)
```

A GitHub Pages workflow (`.github/workflows/pages.yml`) deploys `dist/` on pushes to `main` once Pages is enabled
with "GitHub Actions" as the source.

### Controls

| Action | Keyboard / mouse | Gamepad | Touch |
|---|---|---|---|
| Run | WASD / arrows | Left stick | Left joystick |
| Walk | Hold Alt, or switch CapsLock on | Push the stick lightly | Push the joystick lightly |
| Look | Mouse (click to capture) | Right stick | Drag on the right half |
| Jump / wall-run | Space | A | Jump |
| Parkour sprint (on the ground: vaults, runs up walls) | Hold Shift or left click | Hold RT | Hold Swing |
| Web-launch into a swing | Space while sprinting (or Shift standing still) | A while sprinting | Jump while holding Swing |
| Web-swing (in the air) | Hold Shift or left click | Hold RT | Hold Swing |
| Web-zip to a point | E / Q / right click | LB / RB / LT | Zip |
| Dive | C | B | Dive |
| Switch suit (classic / symbiote) | F | Y | Suit |
| Map (waypoints, search shops and places) | M (then / to search) | Back | Tap the minimap |
| Time of day | T | — | Pause menu |
| Camera distance | V | — | — |
| Help / pause | H / Esc or P | — / Start | Pause button |

The swing button does two jobs: held on the ground it is a parkour sprint, and it
swings once you are in the air. Jump mid-sprint and the web goes out as you leave the ground; keep holding to swing
on. The touch button reads **Sprint** on the ground and **Swing** in the air.

A five-step guided tour (dive off the Reserve Bank, swing down Samora Machel Avenue, land in Africa Unity Square,
walk First Street Mall, perch on Joina City) runs on first play; replay or hide it in Pause → Settings. If the page
can't capture the mouse (some embedded views), drag with the mouse to look and hold Shift to sprint and swing.

URL flags for testing: `?quality=low|medium|high`, `?time=17.5`, `?spawn=x,y,z` (metres from Africa Unity Square),
`?autostart=1`, `?mute=1`.

## What's real

- **Map:** every building footprint, street, one-way rule, park, rank and named shop comes from
  [Overture Maps](https://overturemaps.org) (which includes OpenStreetMap, Google Open Buildings and Microsoft ML
  Buildings), with lane counts and shops merged in from OpenStreetMap. 8,134 buildings, 2,169 road segments.
  `tools/fetch_overture.py` + `tools/fetch_osm.py` download it, `tools/build_map.py` turns it into
  `public/data/harare.json`.
- **Landmarks:** heights and styles for 44 CBD landmarks were researched (`docs/references/LANDMARKS.md`) and
  checked against 146 freely licensed photos (`docs/references/PHOTOS.md`): the RBZ's octagonal glass shaft,
  Joina City's drum-and-disc crown, Eastgate's chimney stacks, Town House, the cathedrals, the Kopje and its
  Eternal Flame, Africa Unity Square, Harare Gardens, First Street Mall and more.
- **Businesses:** 1,529 shop, bank, hotel and office signs (`public/data/shops.json`) sit on the facades of the
  buildings they occupy, from Overture Maps places and OpenStreetMap; 176 of them (138 businesses: the big
  supermarkets, banks, fast-food chains, hotels) were checked against branch locators and news reports
  (`docs/references/BUSINESSES.md`). At street level the HUD says which one you are outside ("outside TM Pick n Pay"),
  and the big map names them when zoomed in and finds them by name (press / or the magnifier).
- **People and vehicles:** Spider-Man and 23 kinds of passer-by (school pupils, vendors, ZRP officers, apostolic
  church members, office workers…) are rigged MakeHuman characters sharing 65 motion clips; the kombis, ZUPCO bus,
  taxis and cars are modelled on the real vehicles' published dimensions (`public/models/*/README.md`). Buildings
  and streets wear CC0 photo-scanned materials (Poly Haven, ambientCG).
- **Street life:** keep-left traffic with robots, Toyota HiAce kombis with hwindis calling destinations, ZUPCO
  buses, Honda Fits, vendors, school pupils, apostolic church members, and jacarandas in late-September bloom
  (`docs/references/STREETLIFE.md`, `src/data/streetlife.js`). The sun and moon follow Harare's real sky for
  27 September.
- **Voices:** pedestrians speak **real Shona** recorded by Zimbabwean speakers for Google's FLEURS dataset
  (Shona subtitles with English translations), plus greetings from a 1960s Shona course voiced by
  Matthew Mataranyika, and street ambience recorded in Harare and Bulawayo.

## Credits & licences

The in-game credits (Pause → Credits) list all of these; the per-file details live next to the assets.

- Map data © Overture Maps Foundation, including © OpenStreetMap contributors (ODbL 1.0), Google Open Buildings
  (CC BY 4.0) and Microsoft ML Buildings (ODbL).
- Businesses (`public/data/shops.json`, `public/data/CREDITS-shops.md`): Overture Maps places (CDLA-Permissive-2.0;
  Meta and Microsoft records, AllThePlaces CC0, Foursquare OS Places Apache-2.0) and © OpenStreetMap contributors
  (ODbL 1.0); the file is a derivative database offered under the ODbL. Brand names appear as plain lettering, with no
  logos.
- People (`public/models/humans/CREDITS.md`): MakeHuman / MPFB 2 base mesh, rig, skins and system assets (CC0);
  animations from the Universal Animation Library 1 and 2 by Quaternius (CC0), retargeted; clothing from the
  MakeHuman community asset repository by **Elvaerwyn, punkduck, Mindfront, janexx and culturalibre** (the sneakers
  derive from a model by **yanix**), **CC BY 4.0**, recoloured and decimated; other clothes CC0. The suits and the
  swing / zip / dive clips were made for this game (CC0).
- Vehicles (`public/models/vehicles/CREDITS.md`): modelled for this game by script, CC0; no manufacturer logos.
  Lettering rasterised from DejaVu Sans (Bitstream Vera licence).
- Props and textures (`public/models/props/CREDITS.md`, `public/textures/CREDITS.md`): Poly Haven and ambientCG,
  CC0 1.0, plus props and textures generated for this game (CC0).
- Shona speech: FLEURS (Conneau et al., 2022, Google), `sn_zw`, CC BY 4.0; English lines from FLoRes (CC BY-SA 4.0).
  Details in `public/audio/CREDITS.md`.
- Street ambience: KevZim (Freesound, CC0); radio continental drift / Claudia Wegener (radio aporee, CC BY-SA 3.0).
  Shona greetings: *Shona Basic Course*, Foreign Service Institute (1965), public domain. Details in
  `public/audio/CREDITS-extra.md`.
- Built with Three.js (MIT) and three-mesh-bvh (MIT); models compressed with meshoptimizer / glTF-Transform (MIT).

## Code

See `docs/ARCHITECTURE.md` for the module contract. In short: `src/core` (loop, input, events), `src/world`
(collision BVH, city renderer, sky), `src/player` (Spider-Man model, traversal, camera), `src/traffic`,
`src/npc`, `src/audio`, `src/ui`. `node scripts/smoke.mjs` runs a headless playtest with screenshots.
