# Spider-Man: Harare — architecture & module contract

Browser game built with Three.js (r186) + three-mesh-bvh, bundled by Vite. Everything ships as static
files (no runtime network requests beyond the page's own `data/` and `audio/` files, no CDNs).

## Run

```
npm install
npm run dev            # http://localhost:5173
npm run build          # -> dist/ (static, relative paths, works from any sub-path)
node scripts/smoke.mjs --url http://localhost:5173/ --out shots   # headless playtest + screenshots
```

URL flags: `?autostart=1` (skip start screen), `?quality=low|medium|high`, `?spawn=x,y,z`, `?time=17.5`, `?mute=1`.
`window.__game` is the Game instance; `window.__ready` becomes true after init.

## Coordinates

Metres. **x = east, z = south (north = -z), y = up.** Origin = centre of Africa Unity Square
(-17.82932, 31.05202). `src/core/geo.js` converts lon/lat ↔ x/z and gives compass headings.
Ground is flat at y = 0 everywhere (the CBD is flat; extra relief such as the Kopje hill must be
added as a collider via `world.addCollider`). Zimbabwe **drives on the left**.

## Map data — `public/data/harare.json` (built by `tools/build_map.py` from Overture Maps)

```
meta:      {origin, bounds{minX,maxX,minZ,maxZ}, attribution, landmarks:[{key,name,height,floors,style,label}], landmarksApplied}
buildings: [{id, oid, fp:[x0,z0,x1,z1,…] (outer ring, CCW seen from above with north up), holes?:[[…]],
             h (roof height m), minH?, fl (floors), name?, cls?, src:'osm'|'google'|'ms', est?:1 (height estimated),
             core?:1 (in the dense CBD), lm?:'<landmark key>', facade?, roofColor?, roofShape?}]
             + at runtime (collision.js adds): cx, cz, minX, maxX, minZ, maxZ
nodes:     [[x,z], …]                    road graph nodes (junctions / segment ends)
roads:     [{cls, w (carriageway width m), lanes (per direction), oneway: 0 | 1 (a→b only) | -1 (b→a only),
             a, b (node indices), len, pts:[x,z,…] (from node a to node b), name?, link?, bridge?, speed? (km/h)}]
             cls ∈ trunk primary secondary tertiary residential unclassified service living_street
             (dual carriageways such as Samora Machel Ave are two one-way roads)
paths:     [{cls: pedestrian|footway|path|cycleway|track|steps, w, pts, name?}]   (First Street Mall is 'pedestrian')
rail:      [{cls, pts}]
areas:     [{kind: park|grass|pitch|golf|school|hospital|wood|scrub|parking|rank|platform, pts, name?}]
           (Africa Unity Square, Harare Gardens are 'park')
ranks:     [{name, x, z, kind}]           kombi ranks / bus termini (Copacabana, Market Square, Fourth Street, Charge Office, Roadport…)
features:  [{kind, name?, key?, x, z}]    traffic_signals, crossings, fountain, railway_station, researched places
trees:     [[x,z], …]                     the few mapped trees (plant more procedurally)
pois:      [{name, cat, x, z, b?}]        named businesses; b = index of the building they belong to (for shop signs)
lamps:     [[x,z], …]                     OSM highway=street_lamp nodes (none mapped in the CBD yet: place procedurally)
markets:   [{name, x, z, pts?}]           OSM amenity=marketplace (+ OSM shops named "… Market"); pts = outline if mapped
```

OSM extras (`tools/fetch_osm.py` → `build_map.py --osm osm.json`; all optional; without `--osm` they are absent
(except buildings[].material from Overture) and lamps/markets are empty):
```
meta.osmTimestamp                         OSM snapshot time of the Overpass data
roads[].lanes      from OSM lanes tags via the OSM way the Overture segment cites (lanes/2 on two-way roads,
                   lanes:forward/backward averaged up; capped at 5); w widened (≤ +40 %) or lanes reduced so
                   lanes stay ≥ 2.5 m
roads[].lanesF?, lanesB?   OSM lane counts a→b / b→a, only on asymmetric two-way roads
roads[].osmSidewalk?       'both'|'left'|'right'|'no'|'separate' (left/right relative to a→b)
roads[].w          replaced by OSM width= when tagged and plausible
buildings[].material?      building:material (Overture facade_material even without --osm, else the cited OSM way)
buildings[]        facade?/roofColor?/roofShape? filled from the cited OSM building when Overture lacks them;
                   est heights replaced by OSM height/building:levels (lm heights from overrides stay authoritative)
features[]         + kind bus_stop (name?), stop, give_way, bench, waste_basket, taxi from OSM nodes;
                   traffic_signals get node? = nearest road graph node within 25 m; crossing signals?:1 if signalised
pois[]             + named OSM shop nodes Overture lacks (cat mapped to Overture-style, e.g. fashion_and_apparel_store)
```

Reference research (produced alongside the code):
- `docs/references/LANDMARKS.md` + `tools/landmark_overrides.json` (heights/styles per landmark key; applied into
  `buildings[].lm/h` and echoed in `meta.landmarks`)
- `docs/references/STREETLIFE.md` + `src/data/streetlife.js` (vehicle types, kombi liveries/ranks, hwindi calls,
  pedestrian palettes, vendors, Shona phrases, trees, sky)
- `public/audio/voices.json` (+ `voices_f.mp3`, `voices_m.mp3`, `crowd_loop.mp3`, `CREDITS.md`): real Shona speech
  from Google FLEURS (sn_zw, CC BY 4.0). Clip schema:
  `{id, sprite:'f'|'m', start, dur, kind:'line'|'bark', gender:'female'|'male', voice, sn, en}`;
  `sprites` maps sprite key → relative URL.
- `public/audio/extras.json` (+ `street/*.mp3`, `CREDITS-extra.md`): four 60 s seamless street-ambience loops recorded in
  Zimbabwe (`ambience[]` with `use` 'market'|'rank'|'street'|'park') and a sprite of 32 spoken Shona greetings / calls
  (`clips[]`, one male voice, FSI Shona course 1965, public domain). Read through `audio.extraClips` / `playExtra`.

## Game & systems (`src/core/game.js`, wired in `src/main.js`)

`game` fields: `renderer, scene, camera, input, events, data, voices (manifest or null), quality, time, paused, fps`
and every system by name. Systems are registered in this order and updated every frame in this order:

| name        | class          | file(s)                 | owner   |
|-------------|----------------|-------------------------|---------|
| `world`     | CollisionWorld | `src/world/collision.js`| core (not a system; built before the others) |
| `sky`       | Sky            | `src/world/sky.js`      | city    |
| `city`      | City           | `src/world/*.js`        | city    |
| `player`    | Player         | `src/player/*.js`       | player  |
| `cameraRig` | CameraRig      | `src/player/camera.js`  | player  |
| `traffic`   | Traffic        | `src/traffic/*.js`      | traffic |
| `npcs`      | Npcs           | `src/npc/*.js`          | npc     |
| `audio`     | AudioManager   | `src/audio/*.js`        | ui+audio|
| `hud`       | Hud            | `src/ui/*.js`           | ui+audio|

System interface: `async init(game)`, `update(dt, game)` (dt ≤ 0.05 s), optional `pausedUpdate(dt, game)`,
`onResize(w, h, game)`. `game.input.update()` runs before systems; `renderer.render()` after.
Other systems may be placeholders while you work — **always guard cross-system calls** with optional chaining
(`game.hud.showSubtitle?.(…)`) so each module works alone.

### Public APIs other modules rely on

**world** (`CollisionWorld`): `raycast(origin, dir, maxDist, out?) → {point, normal, distance, buildingId}|null` (fills `out` when given),
`collideCapsule(start, end, radius)`, `sweep(from, to, radius)`, `buildingAt(x,z)`, `roofHeightAt(x,z)`,
`buildingsNear(x,z,r)`, `nearestRoad(x,z,maxDist)`, `streetNameAt(x,z)`, `addCollider(geometry, id)`,
`addBuilding(record)` (index an extra volume such as a synthetic tower for the lookups; it wins over the footprint it stands on), `bounds`, `data`.
`collideCapsule` classifies contacts by push direction (ground if the push points up, ceiling if down, otherwise a wall
whose `wallNormal` is the horizontal push) and returns an object from a ring of 4 reused results.

**sky**: `sun` (DirectionalLight, follows the player), `hemi`, `setTimeOfDay(hours)`, `timeOfDay`,
`isNight` (bool), `nightFactor` (0..1), `sunDirection` (true sun direction; below the horizon at night),
`moonDirection`, `lightDirection` (current key light: sun by day, moon at night), `palette` {zenith, horizon, ground, version}.

**city**: `group` (Object3D), `update(dt)` (LOD / night lights), `setNight(t)` (0..1 night factor; called by sky),
`sidewalkPaths` [{pts:[x,z,…], width, road (index into data.roads), side (+1 left / -1 right of a→b)}],
`heightAt(x, z)` (visual + physical ground height: 0 except on the Kopje hill), `crossingNodes` (Set of road-node indices
with zebra crossings / stop lines), `obstacles` [{x, z, r}] (street-level solids for pedestrian avoidance: lamp posts,
street trees and palms, benches, bins, bollards, planters, rank-shelter posts and benches, verandah posts, billboard legs,
colonnade columns, the Nehanda statue and the Africa Unity Square fountain), `obstaclesNear(x, z, r)` (those whose circle
reaches within r), `anchorsNear(x, z, r)` → [{x, y, z}] web anchors within r (horizontal) for swinging where nothing is
tall: crowns of trees ≥ 7 m and streetlight pole tops (9–10 m). Both queries use grids built once at load and return one
shared array that the next call overwrites (copy what you keep; no allocation per call). Synthetic volumes (the Rainbow
Towers hotel tower, id -7; Monomotapa's thickened slab) are registered with `world.addBuilding`.

**player**: `position` (feet, Vector3), `velocity`, `state` ('ground'|'air'|'swing'|'zip'|'wall'|'perch'|'dive'),
`heading` (rad, 0 = facing north/-z, CCW positive, i.e. forward = (-sin h, 0, -cos h)), `object`, `suit`,
`radius`, `height`, `teleport(x,y,z)`, `speed` (m/s getter), `setSuit(name)`, `hands` (world positions of both palms),
`controller` (read-only traversal state, e.g. current swing anchor / wall normal).

**cameraRig**: `yaw` (same convention as heading: the camera looks along (-sin yaw, 0, -cos yaw)), `pitch`,
`shake(amount)`, `fovKick(amount)`, `preset` ('close'|'far', V toggles), `snap()` (jump to the target pose).

**traffic**: `vehicles` [{position: Vector3, heading (rad, same convention), speed, type:'kombi'|'hatch'|'sedan'|'pickup'|'suv'|'bus'|…,
length, width, height, parked, slope}] (position = body centre at road level — on the Kopje `position.y` follows the road
surface and `slope` is the pitch along the road in rad, 0 elsewhere; roof at position.y + height; parked rank kombis
included), `vehiclesNear(x, z, r)` (any vehicle whose footprint reaches within r), `signalAt(nodeIndex, fromNodeIndex?)`
→ 'green'|'amber'|'red'|null (without fromNodeIndex: the main road's state), `honk(vehicle)`.

**npcs**: `list` [{position, heading, gender:'female'|'male', state, name, role}] (state ∈ walk wait cross idle chat vendor
react flee), `npcsNear(x, z, r)`, `crossers` (refreshed every frame: the people out on a carriageway, each with
`crossRoad` = index into data.roads and velocity `vx, vz`; traffic brakes for them lane by lane).

**audio**: `unlock()`, `playVoice(clipId, position|null, {volume, rate, delay, onEnd}) → {stop(), duration, clip, setPosition(v)}|null`
(`rate` = playbackRate, clamped 0.5..2, e.g. a stable 0.94..1.06 per NPC so people sharing a FLEURS speaker sound distinct;
`duration` is wall-clock seconds = clip.dur / rate; `delay` = seconds on the audio clock before it starts, ≤ 10, for a
repeat that must keep its rhythm however slowly frames run), `setBusVolume('voices'|'sfx'|'ambience', v)`,
`voiceClips(filter)` (FLEURS clips; every given field must match, an array value matches any of its entries),
`extraClips(filter)` (greetings from `audio/extras.json`: `{id, start, dur, kind:'greet'|'exclaim'|'call', lang:'sn', text, sn (= text), en, gender:'male', bank:'extras'}`;
`[]` until the manifest is fetched after unlock — `extrasReady` is a Promise of the clip list, `[]` if the file is absent),
`playExtra(clipId, position|null, {volume, rate, delay, onEnd})` → same handle as playVoice, or null until the greetings sprite is
decoded (voices bus, positional like playVoice), `voicesActive` (voices / extras playing within 30 m; the beds dip under them),
`playSfx(name, position|null, {volume, pitch})` where name ∈
`'thwip' 'zip' 'whoosh' 'land' 'landHard' 'horn' 'kombiHoot' 'step' 'ui'`, `setAmbience(key, level 0..1)` with
key ∈ `'crowd'` (set by npcs from local crowd density; plays the real Shona chatter bed) and `'traffic'` (set by
traffic from nearby vehicle count), `setMasterVolume(v)`, `muted`. The four real street recordings in `extras.json`
(`rank`, `market`, `park`, `street`) need no calls: `ambience.js` blends them from the player's position
(`src/audio/zones.js`: ranks, markets / First Street Mall / vendor clusters, parks, CBD), time of day and height.

**hud**: `showSubtitle({speaker, sn, en, ms})`, `toast(text, ms)`, `setObjective(text|null)`, `bigMapOpen` (bool),
`waypoint` ({x, z, label}|null), `setWaypoint(x, z)`, `clearWaypoint()`, `openOverlay('map'|'pause'|'help')`, `closeOverlay()`,
`settings` (persisted user settings), `inputMode` ('mouse'|'touch'|'gamepad'), `setObjective(text, {how, step})`,
`setWaypoint(x, z, {label, tour, quiet})` (returns the waypoint), `dropSubtitle({sn, en})`, `requestLock()`, `hintMode()`,
`tour` (guided first-time objectives; `settings.tour` toggles it).
Pause / help / map overlays are HUD-owned and call `game.setPaused(bool)`. `npc:speak` events are subtitled only for
clip kind 'line' (deduped against `showSubtitle`); 'bark' / 'greet' / 'exclaim' / 'call' clips are left to the NPC's
speech bubble unless the event carries `subtitle: true`.

### Street cross-sections — `src/world/streetMetrics.js` (core)

Shared by city (road/kerb/marking rendering), traffic (lane positions) and npcs (sidewalks):
`sidewalkWidth(road)`, `kerbOffset(road)`, `sidewalkCenterOffset(road)`, `laneWidth(road)`, `totalLanes(road)`,
`laneOffset(road, laneIndex)` (offset to the LEFT of the travel direction — keep-left traffic), `leftOf(dx, dz)`,
`allowsDirection(road, dirSign)`, `KERB_HEIGHT`. Use these instead of re-deriving widths so cars stay in the lanes the
city paints and pedestrians stay on the sidewalks the city builds.

### Events (`game.events`, see `src/core/events.js`)

`player:land {pos, speed, hard}`, `player:jump`, `player:webShot {from, to}`, `player:swingStart {anchor}`,
`player:swingEnd {pos, vel}`, `player:zip {from, to}`, `player:wallStart {pos, normal}`, `player:perch {pos}`,
`player:suit {suit}`, `npc:speak {npc, clip, text}`, `hud:toast {text, ms}`, `game:pause {paused}`, `game:start`.

### Input actions (`src/core/input.js`)

`input.move {x, y}` (y forward), `input.look {x, y}` (pixels this frame), `down/pressed/released(action)` with
actions `jump swing zip dive suit map pause help camera time`. Keyboard: WASD/arrows, Space jump, Shift or
left-click (pointer-locked) swing, E/Q or right-click zip, C dive (not Ctrl: Ctrl+W closes the tab), F suit, M map, Esc/P pause, H help, V camera,
T time of day. Gamepad: sticks, A jump, RT swing, LB/RB/LT zip, B dive, Y suit, Back map, Start pause.
Touch UI calls `input.setVirtualMove(x, y)`, `input.addLook(dx, dy)`, `input.setVirtualButton(action, down)`.

## Rules for every module

- Plain modern JS ES modules, 2-space indent, single quotes, semicolons (match existing files). No TypeScript.
- **Only edit files you own** (table above). `src/main.js`, `src/core/*`, `src/world/collision.js` belong to core;
  if you need a change there, describe it in your final report instead (ui+audio may edit the start/pause flow
  in `main.js` and `index.html`/`src/style.css`).
- No new npm dependencies besides `three`, `three-mesh-bvh`. No external URLs, fonts or CDNs; all textures are
  procedural (`CanvasTexture` / `DataTexture`) or generated at runtime. No new files in `public/` except your data.
- Performance budget (desktop, high quality): ≥ 60 fps on a mid-range laptop GPU; ≤ ~250 draw calls total;
  use merged geometry and `InstancedMesh`; no per-frame allocations in hot loops (reuse Vector3s); LOD/cull
  distant detail. `game.quality.level` is 'low'|'medium'|'high' (phones use 'low': no shadows, fewer props,
  crowd/traffic scaled by `quality.crowd` / `quality.traffic`).
- Headless testing: Chromium is at `/opt/pw-browsers/chromium` (SwiftShader, so ~3–10 fps; that is expected).
  Use `node scripts/smoke.mjs --url http://localhost:<port>/ --out <dir> --query "quality=low&spawn=…" --width 800 --height 450`.
  Start your own dev server on your own port (`npx vite --port <port> --strictPort`), never `npm run build` into
  the shared `dist/` (use `npx vite build --outDir <scratch dir>` if you need a build check).
