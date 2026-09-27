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

**world** (`CollisionWorld`): `raycast(origin, dir, maxDist) → {point, normal, distance, buildingId}|null`,
`collideCapsule(start, end, radius)`, `sweep(from, to, radius)`, `buildingAt(x,z)`, `roofHeightAt(x,z)`,
`buildingsNear(x,z,r)`, `nearestRoad(x,z,maxDist)`, `streetNameAt(x,z)`, `addCollider(geometry, id)`, `bounds`, `data`.

**sky**: `sun` (DirectionalLight, follows the player), `hemi`, `setTimeOfDay(hours)`, `timeOfDay`,
`isNight` (bool), `sunDirection` (Vector3).

**city**: `group` (Object3D), `update(dt)` (LOD / night lights), `sidewalkPaths` (optional helper for NPCs, see below),
`setNight(t)` (0..1 night factor; called by sky).

**player**: `position` (feet, Vector3), `velocity`, `state` ('ground'|'air'|'swing'|'zip'|'wall'|'perch'|'dive'),
`heading` (rad, 0 = facing north/-z, CCW positive, i.e. forward = (-sin h, 0, -cos h)), `object`, `suit`,
`radius`, `height`, `teleport(x,y,z)`, `speed` (m/s getter).

**cameraRig**: `yaw`, `pitch`, `shake(amount)`, `fovKick(amount)`.

**traffic**: `vehicles` [{position: Vector3, heading (rad, same convention), speed, type:'kombi'|'hatch'|'sedan'|'pickup'|'suv'|'bus'|…,
length, width, height}], `vehiclesNear(x, z, r)`, `signalAt(nodeIndex) → 'green'|'amber'|'red'|null` (for the direction
of travel given by `signalAt(nodeIndex, fromNodeIndex)`), `honk(vehicle)`.

**npcs**: `list` [{position, heading, gender:'female'|'male', state}], `npcsNear(x, z, r)`.

**audio**: `unlock()`, `playVoice(clipId, position|null, {volume, onEnd}) → {stop(), duration}|null`,
`voiceClips(filter)` (manifest clips), `playSfx(name, position|null, {volume, pitch})` where name ∈
`'thwip' 'zip' 'whoosh' 'land' 'landHard' 'horn' 'kombiHoot' 'step' 'ui'`, `setAmbience(key, level 0..1)` with
key ∈ `'crowd'` (set by npcs from local crowd density; plays the real Shona chatter bed) and `'traffic'` (set by
traffic from nearby vehicle count), `setMasterVolume(v)`, `muted`.

**hud**: `showSubtitle({speaker, sn, en, ms})`, `toast(text, ms)`, `setObjective(text|null)`, `bigMapOpen` (bool).
Pause / help / map overlays are HUD-owned and call `game.setPaused(bool)`.

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
left-click (pointer-locked) swing, E/Q or right-click zip, Ctrl/C dive, F suit, M map, Esc/P pause, H help, V camera,
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
