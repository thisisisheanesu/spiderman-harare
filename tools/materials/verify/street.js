// Street mock-up: road, painted kerb, sidewalk, two facades with interior-mapped windows, props.
import { createInteriorGlassMaterial, buildWindowGeometry } from '/repo/tools/materials/interior_glass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export async function street({ THREE, scene, camera, pbr, byName, tex, texLoader, sun, BASE, Q }) {
  const night = Q.get('night') === '1';
  const lin = (hex) => new THREE.Color(hex); // THREE.Color from hex is linear-converted automatically
  function tinted(name, w, h, hex, extra = {}) {
    const m = pbr(name, w, h, extra);
    const e = byName[name];
    const t = lin(hex);
    m.color.setRGB(t.r / e.avgColorLinear[0], t.g / e.avgColorLinear[1], t.b / e.avgColorLinear[2]);
    return m;
  }
  const plane = (w, h, mat) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);

  // ---- road, kerb, sidewalk
  const road = plane(80, 14, pbr('asphalt_bleached', 80, 14));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, -1);
  road.receiveShadow = true;
  scene.add(road);
  const patch = plane(3.2, 2.1, pbr('asphalt_patch', 3.2, 2.1));
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(2, 0.005, 1.5);
  patch.receiveShadow = true;
  scene.add(patch);
  const kerbFace = plane(80, 0.15, pbr('kerb_painted_bw', 80, 0.15 * 1.0));
  kerbFace.position.set(0, 0.075, 6);
  kerbFace.receiveShadow = true;
  scene.add(kerbFace);
  const kerbTop = plane(80, 0.3, pbr('kerb_painted_bw', 80, 0.3));
  kerbTop.rotation.x = -Math.PI / 2;
  kerbTop.position.set(0, 0.15, 6.15);
  kerbTop.receiveShadow = true;
  scene.add(kerbTop);
  const walk = plane(80, 3.7, pbr('pavement_slabs', 80, 3.7));
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(0, 0.15, 8.15);
  walk.receiveShadow = true;
  scene.add(walk);
  const verge = plane(80, 3, pbr('soil_red', 80, 3));
  verge.rotation.x = -Math.PI / 2;
  verge.position.set(0, 0.001, -9.5);
  scene.add(verge);

  // ---- facades (face -z toward the road); build piers/spandrels around window holes
  const atlas = texLoader.load(BASE + 'textures/glass/interiors_atlas.webp');
  const gE = byName.window_glass;
  const gN = tex(gE.files.normal, false, 1, 1);
  const gO = tex(gE.files.orm, false, 1, 1);
  const gA = tex(gE.files.albedo, true, 1, 1);
  const dbg = Q.get('dbg') || '';
  const glassTeal = createInteriorGlassMaterial({ atlas, glassNormal: dbg.includes('n') ? null : gN, glassOrm: dbg.includes('o') ? null : gO, glassGrime: dbg.includes('g') ? null : gA, tint: 0xb9d2d6,
    exposure: dbg.includes('e') ? 0 : (night ? 1.2 : 0.55), darkLevel: night ? 0.04 : 1.0 });
  const glassShop = createInteriorGlassMaterial({ atlas, glassNormal: dbg.includes('n') ? null : gN, glassOrm: dbg.includes('o') ? null : gO, glassGrime: dbg.includes('g') ? null : gA, tint: 0xe8eeee,
    exposure: night ? 1.3 : 0.75, darkLevel: night ? 0.04 : 1.0 });

  function facade({ x0, x1, zWall, height, storey, podium, wallMat, podiumMat, winW, winH, sill, bay, cells, frameMat, shopCells }) {
    // wall seen from -z: "right" = -x, origin at x1 (left edge seen from outside)
    const wall = { origin: new THREE.Vector3(x1, 0, zWall), right: new THREE.Vector3(-1, 0, 0), normal: new THREE.Vector3(0, 0, -1) };
    const W = x1 - x0;
    const holes = [];
    const wins = [];
    const shops = [];
    let k = 0;
    // ground-floor shopfronts
    for (let bx = 0.4; bx + bay - 0.4 <= W; bx += bay) {
      holes.push({ x: bx, y: 0.45, w: bay - 0.8, h: 2.7 });
      shops.push({ x: bx, y: 0.45, w: bay - 0.8, h: 2.7, cell: shopCells[k++ % shopCells.length], mirror: k % 2, light: 1, depth: 1.6 });
    }
    for (let y = podium + sill; y + winH < height - 0.6; y += storey) {
      for (let bx = (bay - winW) / 2; bx + winW <= W; bx += bay) {
        holes.push({ x: bx, y, w: winW, h: winH });
        const h = Math.abs(Math.sin(bx * 12.9898 + y * 78.233) * 43758.5453) % 1;
        wins.push({ x: bx, y, w: winW, h: winH, cell: cells[Math.floor(h * cells.length)], mirror: h > 0.5, light: h > 0.35 ? 1 : 0, depth: 1 });
      }
    }
    // wall = full rectangle minus holes: build via a Shape with holes
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(W, 0); shape.lineTo(W, height); shape.lineTo(0, height); shape.lineTo(0, 0);
    for (const h of holes) {
      const p = new THREE.Path();
      p.moveTo(h.x, h.y); p.lineTo(h.x, h.y + h.h); p.lineTo(h.x + h.w, h.y + h.h); p.lineTo(h.x + h.w, h.y); p.lineTo(h.x, h.y);
      shape.holes.push(p);
    }
    const wg = new THREE.ShapeGeometry(shape);
    // shape is in the wall's (right, up) frame: map to world and set metre UVs
    const pos = wg.attributes.position;
    const uvs = [];
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i);
      const v = pos.getY(i);
      uvs.push(u, v);
      pos.setXYZ(i, x1 - u, v, zWall);
    }
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    wg.computeVertexNormals();
    // ShapeGeometry faces +z in its own frame; mirroring x (x1 - u) flips the winding, so it now faces -z
    const scaleUv = (m) => { for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap']) if (m[key]) m[key].repeat.set(1 / byName[m.userData.name].tileSizeMetres[0], 1 / byName[m.userData.name].tileSizeMetres[1]); };
    scaleUv(wallMat);
    const wm = new THREE.Mesh(wg, wallMat);
    wm.castShadow = true; wm.receiveShadow = true;
    scene.add(wm);
    // podium band (granite) over the ground floor
    if (podiumMat) {
      scaleUv(podiumMat);
      const band = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.9), podiumMat);
      band.rotation.y = Math.PI;
      band.position.set((x0 + x1) / 2, 3.55, zWall - 0.02);
      const bu = band.geometry.attributes.uv;
      for (let i = 0; i < bu.count; i++) bu.setXY(i, bu.getX(i) * W, bu.getY(i) * 0.9);
      scene.add(band);
      // cantilevered canopy
      const can = new THREE.Mesh(new THREE.BoxGeometry(W, 0.18, 2.2), tinted('concrete_painted', 10, 10, '#d8d2c6'));
      can.position.set((x0 + x1) / 2, 3.35, zWall - 1.1);
      can.castShadow = true; can.receiveShadow = true;
      scene.add(can);
    }
    // glass
    const gm = new THREE.Mesh(buildWindowGeometry(wall, wins, 0.14), glassTeal);
    scene.add(gm);
    const sm = new THREE.Mesh(buildWindowGeometry(wall, shops, 0.2), glassShop);
    scene.add(sm);
    // reveals (window sides) + mullions in aluminium
    const frames = [];
    const addBox = (cx, cy, cz, sx, sy, sz) => { const b = new THREE.BoxGeometry(sx, sy, sz); b.translate(cx, cy, cz); frames.push(b); };
    for (const h of [...wins, ...shops]) {
      const d = h.h > 2.5 ? 0.2 : 0.14;
      const xa = x1 - h.x;
      const xb = x1 - h.x - h.w;
      addBox(xa - 0.03, h.y + h.h / 2, zWall + d / 2 - 0.01, 0.06, h.h, d);
      addBox(xb + 0.03, h.y + h.h / 2, zWall + d / 2 - 0.01, 0.06, h.h, d);
      addBox((xa + xb) / 2, h.y + 0.03, zWall + d / 2 - 0.01, h.w, 0.06, d);
      addBox((xa + xb) / 2, h.y + h.h - 0.03, zWall + d / 2 - 0.01, h.w, 0.06, d);
      addBox((xa + xb) / 2, h.y + h.h / 2, zWall + d - 0.02, 0.05, h.h, 0.05); // mullion
      if (h.h < 2.5) addBox((xa + xb) / 2, h.y + h.h * 0.7, zWall + d - 0.02, h.w, 0.05, 0.05); // transom
    }
    const merged = mergeBoxes(THREE, frames);
    const fm = new THREE.Mesh(merged, frameMat);
    fm.castShadow = true;
    scene.add(fm);
    // parapet cap
    const cap = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 0.25, 0.5), frameMat);
    cap.position.set((x0 + x1) / 2, height + 0.12, zWall + 0.2);
    scene.add(cap);
  }

  const cream = tinted('plaster_smooth', 1, 1, '#dcd0b0');
  cream.userData.name = 'plaster_smooth';
  const granite = tinted('granite_cladding_light', 1, 1, '#aeb0ac', { roughness: 1 });
  granite.userData.name = 'granite_cladding_light';
  const alu = tinted('window_frame_aluminium', 1, 1, '#9aa0a4');
  facade({ x0: -2, x1: 22, zWall: 10, height: 20.5, storey: 3.3, podium: 3.3, sill: 0.9, bay: 3.0, winW: 2.0, winH: 1.9,
    wallMat: cream, podiumMat: granite, frameMat: alu, cells: [0, 1, 0, 1, 7, 2, 3], shopCells: [4, 5, 6] });
  const brick = pbr('brick_face_salmon', 1, 1);
  brick.userData.name = 'brick_face_salmon';
  const conc = tinted('concrete_board_formed', 1, 1, '#a9a497');
  conc.userData.name = 'concrete_board_formed';
  facade({ x0: -26, x1: -2.4, zWall: 11, height: 14.5, storey: 3.1, podium: 3.3, sill: 0.8, bay: 3.4, winW: 2.6, winH: 1.6,
    wallMat: brick, podiumMat: conc, frameMat: tinted('window_frame_aluminium', 1, 1, '#3a3a38'), cells: [2, 3, 2, 3, 1, 7], shopCells: [6, 4, 5] });
  // building side returns (so the blocks read as volumes)
  const sideGeo = new THREE.BoxGeometry(0.4, 14.5, 12);
  { const su = sideGeo.attributes.uv; const sp = sideGeo.attributes.position; const sn = sideGeo.attributes.normal;
    for (let i = 0; i < su.count; i++) { const ax = Math.abs(sn.getX(i)) > 0.5; su.setXY(i, ax ? sp.getZ(i) : sp.getX(i), sp.getY(i)); } }
  const side = new THREE.Mesh(sideGeo, brick);
  side.position.set(-2.2, 7.25, 17);
  scene.add(side);

  // ---- props
  const man = await (await fetch(BASE + 'models/props/props.json')).json();
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const cache = {};
  async function prop(name, x, z, rotY = 0, y = 0.15, lod = false) {
    const p = man.props.find((q) => q.name === name);
    const file = lod ? p.lod1 : p.file;
    cache[file] ??= loader.loadAsync(BASE + 'models/props/' + file);
    const g = (await cache[file]).scene.clone(true);
    g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true;
      if (night && m.material.name === 'LampLens') { m.material = m.material.clone(); m.material.emissive.setRGB(1, 0.92, 0.8); m.material.emissiveIntensity = 6; } } });
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    scene.add(g);
    return g;
  }
  await Promise.all([
    prop('street_lamp_single', 6, 6.55, Math.PI),
    prop('street_lamp_single', -12, 6.55, Math.PI),
    prop('street_lamp_double_solar', -3, -1.2, 0, 0.15),
    prop('bench_timber', 12, 9.3, Math.PI),
    prop('bin_metal', 9.5, 7.0, 0),
    prop('bollard_painted', 0.5, 6.7), prop('bollard_painted', -1.5, 6.7), prop('bollard_concrete', -3.5, 6.7),
    prop('umbrella_red_white', 2.8, 7.9), prop('crate_plastic_yellow', 2.2, 7.5, 0.3), prop('crate_plastic_red', 2.3, 7.5, 0.1, 0.4),
    prop('chair_monobloc', 3.6, 8.3, -2.4), prop('drum_plastic_blue', 1.8, 8.7), prop('cardboard_box', 3.3, 7.2, 0.5),
    prop('bus_shelter', -8, 8.1, Math.PI),
    prop('trash_bag', 10.3, 7.2, 1), prop('electrical_box', 15, 9.4, Math.PI),
    prop('plant_aloe_pot', 17.5, 9.4), prop('plant_leafy_pot', 18.5, 9.4),
    prop('traffic_cone', 4.5, 1.5, 0, 0), prop('traffic_cone', 5.2, 2.1, 0, 0),
    prop('barrier_concrete', -16, 1.0, 0.1, 0),
    prop('water_tank_stand', 16, 3.3 + 20.5 + 1.2 - 3.3, 0, 20.5), prop('satellite_dish', 8, 12, Math.PI, 20.5),
    prop('ac_unit', 4, 11.5, Math.PI, 20.5), prop('water_tank', -10, 14, 0, 14.5),
    prop('planter_concrete', -20, 8.9), prop('manhole_cover', 0, -2.5, 0, -0.06),
  ]);
  // roofs
  const roofA = new THREE.Mesh(new THREE.PlaneGeometry(24, 14), pbr('roof_membrane', 24, 14));
  roofA.rotation.x = -Math.PI / 2;
  roofA.position.set(10, 20.5, 17);
  scene.add(roofA);
  const roofB = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), pbr('roof_gravel', 24, 12));
  roofB.rotation.x = -Math.PI / 2;
  roofB.position.set(-14.2, 14.5, 17);
  scene.add(roofB);

  // ---- camera / light
  sun.position.set(-18, 40, -30); // Harare: sun in the north (-z) most of the year
  sun.target.position.set(0, 0, 8);
  sun.shadow.camera.left = -35; sun.shadow.camera.right = 35; sun.shadow.camera.top = 35; sun.shadow.camera.bottom = -35;
  sun.shadow.camera.far = 150;
  sun.shadow.camera.updateProjectionMatrix();
  const view = Q.get('view') || 'street';
  camera.fov = 55;
  if (view === 'street') { camera.position.set(9, 1.7, -3.5); camera.lookAt(-2, 5.5, 10); }
  if (view === 'close') { camera.position.set(6, 1.6, 4.2); camera.lookAt(9.5, 2.0, 10); }
  if (view === 'swing') { camera.position.set(14, 14, -8); camera.lookAt(-2, 6, 10); }
  if (view === 'oblique') { camera.position.set(-6, 9, 5); camera.lookAt(10, 8, 10); }
  if (night) {
    scene.environmentIntensity = 0.06;
    sun.intensity = 0.05;
    scene.background = new THREE.Color(0x0a0e18);
    for (const x of [6, -12]) { const pl = new THREE.PointLight(0xffe2b0, 60, 25, 2); pl.position.set(x, 7.9, 4.2); scene.add(pl); }
  }
  camera.updateProjectionMatrix();
}

function mergeBoxes(THREE, geoms) {
  let n = 0;
  let ni = 0;
  for (const g of geoms) { n += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const idx = new Uint32Array(ni);
  let o = 0;
  let oi = 0;
  for (const g of geoms) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    for (let i = 0; i < g.index.count; i++) idx[oi + i] = g.index.array[i] + o;
    o += g.attributes.position.count;
    oi += g.index.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  m.setIndex(new THREE.BufferAttribute(idx, 1));
  return m;
}
