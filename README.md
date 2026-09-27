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
| Move | WASD / arrows | Left stick | Left joystick |
| Look | Mouse (click to capture) | Right stick | Drag on the right half |
| Jump / wall-run | Space | A | Jump |
| Web-swing (hold) | Left click or Shift | RT | Swing |
| Web-zip to a point | E / Q / right click | LB / RB / LT | Zip |
| Dive | C | B | Dive |
| Switch suit (classic / symbiote) | F | Y | Suit |
| Map (waypoints) | M | Back | Tap the minimap |
| Time of day | T | — | Pause menu |
| Camera distance | V | — | — |
| Help / pause | H / Esc or P | — / Start | Pause button |

A five-step guided tour (dive off the Reserve Bank, swing down Samora Machel Avenue, land in Africa Unity Square,
walk First Street Mall, perch on Joina City) runs on first play; replay or hide it in Pause → Settings. If the page
can't capture the mouse (some embedded views), drag with the mouse to look and hold Shift to swing.

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
- **Street life:** keep-left traffic with robots, Toyota HiAce kombis with hwindis calling destinations, ZUPCO
  buses, Honda Fits, vendors, school pupils, apostolic church members, and jacarandas in late-September bloom
  (`docs/references/STREETLIFE.md`, `src/data/streetlife.js`). The sun and moon follow Harare's real sky for
  27 September.
- **Voices:** pedestrians speak **real Shona** recorded by Zimbabwean speakers for Google's FLEURS dataset
  (Shona subtitles with English translations), plus greetings from a 1960s Shona course voiced by
  Matthew Mataranyika, and street ambience recorded in Harare and Bulawayo.

## Credits & licences

- Map data © Overture Maps Foundation, including © OpenStreetMap contributors (ODbL 1.0), Google Open Buildings
  (CC BY 4.0) and Microsoft ML Buildings (ODbL).
- Shona speech: FLEURS (Conneau et al., 2022, Google), `sn_zw`, CC BY 4.0; English lines from FLoRes (CC BY-SA 4.0).
  Details in `public/audio/CREDITS.md`.
- Street ambience: KevZim (Freesound, CC0); radio continental drift / Claudia Wegener (radio aporee, CC BY-SA 3.0).
  Shona greetings: *Shona Basic Course*, Foreign Service Institute (1965), public domain. Details in
  `public/audio/CREDITS-extra.md`.
- Built with Three.js (MIT) and three-mesh-bvh (MIT).

## Code

See `docs/ARCHITECTURE.md` for the module contract. In short: `src/core` (loop, input, events), `src/world`
(collision BVH, city renderer, sky), `src/player` (Spider-Man model, traversal, camera), `src/traffic`,
`src/npc`, `src/audio`, `src/ui`. `node scripts/smoke.mjs` runs a headless playtest with screenshots.
