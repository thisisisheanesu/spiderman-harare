import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as STREETLIFE from '../data/streetlife.js';
import { hashString, makeRng } from '../core/rng.js';
import { pointInPoly } from '../core/geo.js';
import { WALK, PATH } from './walkways.js';

// Street vendors: stalls placed once from the pedestrian network (busy junction corners, pavements in
// the core, First Street Mall, flower sellers around Africa Unity Square, kombi ranks) and drawn as a
// handful of instanced prop meshes. Each stall has a vendor spot the crowd fills when the player is near.

const TYPES = STREETLIFE.VENDOR_TYPES?.length
  ? STREETLIFE.VENDOR_TYPES
  : [
      { type: 'fruit_veg', weight: 0.3, placement: ['pavement', 'corner', 'rank'], vendor: 'woman' },
      { type: 'airtime_phone', weight: 0.2, placement: ['corner', 'rank', 'pavement'], vendor: 'young man' },
      { type: 'flowers', weight: 0.05, placement: ['square'], vendor: 'women and men' },
    ];
const RANKS = STREETLIFE.KOMBI_RANKS || [];
const PRODUCE = Object.values(TYPES.find((t) => t.type === 'fruit_veg')?.goodsColors || { tomatoes: '#d6331f', onions: '#b5654a', bananas: '#f0d23c', oranges: '#f08c1a' });
const FLOWERS = TYPES.find((t) => t.type === 'flowers')?.goodsColors || ['#c8102e', '#ffffff', '#f7c21b', '#e75480'];
const UMBRELLAS = STREETLIFE.STREET_PROPS?.vendorUmbrella?.colors || ['#d6201f', '#1d4fb8', '#2e8b57', '#f2c200', '#ffffff'];
const HEADLINES = TYPES.find((t) => t.type === 'newspaper')?.headlines || ['MYSTERY WEB-SLINGER SPOTTED IN CBD!'];
// Stall types we can build props for (others fall back to a simple table).
const BUILDERS = new Set(['fruit_veg', 'airtime_phone', 'sweets_snacks', 'newspaper', 'shoe_mender', 'flowers', 'secondhand_clothes', 'roast_maize', 'megaphone_herbalist', 'money_changer', 'umbrella_accessories']);

const _p = { x: 0, z: 0 };

// Heading that faces back across edge e from its `out` side (+1 = left of a→b).
function facingIn(e, out) {
  return Math.atan2(out * e.uz, -out * e.ux);
}

const PROP_KINDS = ['box', 'table', 'umbrella', 'pile', 'basin', 'heap', 'bucket', 'blooms', 'board'];

function propGeometries() {
  const g = {};
  g.box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const top = new THREE.BoxGeometry(1.2, 0.05, 0.62).translate(0, 0.74, 0);
  const legs = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => new THREE.BoxGeometry(0.05, 0.72, 0.05).translate(sx * 0.55, 0.36, sz * 0.26)));
  g.table = mergeGeometries([top, ...legs]);
  // Umbrella: pole + eight-panel canopy with alternating white panels (vertex colours tinted per instance).
  const pole = new THREE.CylinderGeometry(0.02, 0.02, 2.1, 5).translate(0, 1.05, 0);
  const canopy = new THREE.ConeGeometry(1.15, 0.45, 8, 1, true).translate(0, 2.2, 0).toNonIndexed();
  const col = [];
  const pos = canopy.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const tri = Math.floor(i / 3);
    const w = tri % 2 === 0 ? 1 : 0.35;
    col.push(1, w, w);
  }
  canopy.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const poleNI = pole.toNonIndexed();
  poleNI.setAttribute('color', new THREE.Float32BufferAttribute(new Array(poleNI.attributes.position.count * 3).fill(0.35), 3));
  canopy.deleteAttribute('uv');
  poleNI.deleteAttribute('uv');
  g.umbrella = mergeGeometries([canopy, poleNI]);
  // Produce pyramid: 4 + 1 balls, the classic stacked "heap" of tomatoes.
  const balls = [];
  for (const [x, y, z] of [[-0.05, 0.04, -0.05], [0.05, 0.04, -0.05], [-0.05, 0.04, 0.05], [0.05, 0.04, 0.05], [0, 0.1, 0]]) {
    balls.push(new THREE.IcosahedronGeometry(0.045, 0).translate(x, y, z));
  }
  g.pile = mergeGeometries(balls);
  g.basin = new THREE.CylinderGeometry(0.28, 0.2, 0.13, 10, 1, false).translate(0, 0.065, 0);
  g.heap = new THREE.SphereGeometry(0.25, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1).translate(0, 0.1, 0);
  g.bucket = new THREE.CylinderGeometry(0.16, 0.12, 0.34, 8).translate(0, 0.17, 0);
  const blooms = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = i === 0 ? 0 : 0.1;
    blooms.push(new THREE.IcosahedronGeometry(0.06, 0).translate(Math.cos(a) * r, 0.52 + (i % 3) * 0.04, Math.sin(a) * r));
  }
  g.blooms = mergeGeometries(blooms);
  // A-frame board: two leaning panels, the front one carries the painted sign.
  const front = new THREE.PlaneGeometry(0.6, 0.8).rotateY(Math.PI).rotateX(0.2).translate(0, 0.42, -0.08);
  const back = new THREE.PlaneGeometry(0.6, 0.8).rotateX(-0.2).translate(0, 0.42, 0.08);
  g.board = mergeGeometries([front, back]);
  for (const k of PROP_KINDS) if (k !== 'umbrella' && k !== 'board') g[k].deleteAttribute('uv');
  return g;
}

// Hand-painted sign boards: airtime, newspaper headline, snacks, shoe repairs (atlas, 4 tiles across).
function signTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 320;
  const g = c.getContext('2d');
  const tiles = [
    { bg: '#f2c200', fg: '#1a1a1a', lines: ['AIRTIME', '$1  $2  $5', 'DATA · CHARGERS'] },
    { bg: '#f4f1e6', fg: '#b01e23', lines: HEADLINES.slice(0, 1).concat(['DAILY NEWS', '']) },
    { bg: '#1d4fb8', fg: '#ffffff', lines: ['MAPUTI', 'SWEETS · DRINKS', 'MVURA INOTONHORA'] },
    { bg: '#2e8b57', fg: '#ffffff', lines: ['SHOE', 'REPAIRS', 'KUGADZIRA SHANGU'] },
  ];
  tiles.forEach((t, i) => {
    const x0 = i * 256;
    g.fillStyle = t.bg;
    g.fillRect(x0, 0, 256, 320);
    g.strokeStyle = t.fg;
    g.lineWidth = 8;
    g.strokeRect(x0 + 8, 8, 240, 304);
    g.fillStyle = t.fg;
    g.textAlign = 'center';
    t.lines.forEach((line, j) => {
      let size = j === 0 ? 54 : 30;
      g.font = `bold ${size}px sans-serif`;
      // Headlines are long: wrap them over two lines.
      const words = line.split(' ');
      const rows = [];
      let row = '';
      for (const w of words) {
        const test = row ? `${row} ${w}` : w;
        if (g.measureText(test).width > 220 && row) {
          rows.push(row);
          row = w;
        } else row = test;
      }
      if (row) rows.push(row);
      if (rows.length > 2) {
        size = 26;
        g.font = `bold ${size}px sans-serif`;
      }
      rows.forEach((r, k) => g.fillText(r, x0 + 128, 70 + j * 100 + k * (size + 4), 230));
    });
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class Vendors {
  constructor(game, walkways) {
    this.game = game;
    this.walk = walkways;
    this.stalls = [];
    this.props = []; // {kind, x, y, z, rot, sx, sy, sz, color, tile}
    this.obstacles = []; // {x, z, r}
  }

  build() {
    const rng = makeRng(hashString('harare-vendors'));
    const w = this.walk;
    const taken = [];
    const clear = (x, z, r) => taken.every((t) => (t.x - x) ** 2 + (t.z - z) ** 2 > (t.r + r) ** 2);
    const place = (type, x, z, y, heading, where, rankName) => {
      if (!clear(x, z, 2.2)) return false;
      // Footprint: centre, the four corners of a 1.4 x 1.8 box and the vendor spot must be walkable ground.
      const fx = -Math.sin(heading);
      const fz = -Math.cos(heading);
      const rx = -fz;
      const rz = fx;
      for (const [a, b] of [[0, 0], [0.7, 0.5], [-0.7, 0.5], [0.7, -1.3], [-0.7, -1.3]]) {
        if (!w.free(x + rx * a - fx * b, z + rz * a - fz * b)) return false;
      }
      const stall = { type: type.type, def: type, x, z, y, heading, where, rank: rankName, seed: rng.int(0, 1e9) };
      this._layout(stall, rng);
      this.stalls.push(stall);
      taken.push({ x, z, r: 2.2 });
      return true;
    };
    const typeFor = (where) => {
      const list = TYPES.filter((t) => BUILDERS.has(t.type) && t.placement?.includes(where));
      return list.length ? rng.weighted(list) : TYPES[0];
    };

    // Busy junction corners: the stall sits in the corner square of pavement, facing the junction.
    for (const id of w.corners) {
      const n = w.nodes[id];
      if (!n.edges.length || !(n.corner > 0.6 && n.corner < Math.PI - 0.3)) continue;
      if (w.activity(n.x, n.z) < 0.6 || rng() > 0.4) continue;
      let bx = n.x - n.jx;
      let bz = n.z - n.jz;
      const bl = Math.hypot(bx, bz) || 1;
      bx /= bl;
      bz /= bl;
      const x = n.x + bx * 1.1;
      const z = n.z + bz * 1.1;
      place(typeFor('corner'), x, z, n.y, Math.atan2(bx, bz), 'corner');
    }
    // Pavements and pedestrian streets in the core: against the building line, facing the walkway.
    for (const e of w.edges) {
      const mall = e.kind === PATH && e.spread > 2;
      if (!(mall || (e.kind === WALK && e.spread >= 0.5))) continue;
      const act = w.activity((w.nodes[e.a].x + w.nodes[e.b].x) / 2, (w.nodes[e.a].z + w.nodes[e.b].z) / 2);
      if (act < (mall ? 0.3 : 0.65)) continue;
      const every = mall ? 16 : 45;
      for (let s = rng.range(2, every); s < e.len - 2; s += every * rng.range(0.7, 1.4)) {
        if (rng() > (mall ? 0.75 : 0.35)) continue;
        const out = mall ? (rng() < 0.5 ? 1 : -1) : e.side || 1;
        const p = w.pointOn(e, s, out * (e.spread + (mall ? -0.4 : 0.15)), _p);
        place(typeFor('pavement'), p.x, p.z, w.nodes[e.a].y, facingIn(e, out), mall ? 'mall' : 'pavement');
      }
    }
    this._flowerSellers(rng, place);
    this._rankStalls(rng, place, typeFor);
    this._buildMeshes();
  }

  // Flower sellers line the pavements around Africa Unity Square.
  _flowerSellers(rng, place) {
    const flowers = TYPES.find((t) => t.type === 'flowers');
    const square = this.game.data.areas?.find((a) => a.kind === 'park' && /unity/i.test(a.name || ''));
    if (!flowers || !square) return;
    const w = this.walk;
    let n = 0;
    for (const e of w.edges) {
      if (e.kind !== WALK || n >= 9) continue;
      for (let s = 3; s < e.len - 3 && n < 9; s += 7) {
        // Only on the park side: a point a few metres further out must be inside the square.
        const o = w.pointOn(e, s, e.side * (e.spread + 3), _p);
        if (!pointInPoly(o.x, o.z, square.pts) || rng() > 0.5) continue;
        const p = w.pointOn(e, s, e.side * (e.spread + 0.15), _p);
        if (place(flowers, p.x, p.z, w.nodes[e.a].y, facingIn(e, e.side), 'square')) n++;
      }
    }
  }

  // Ranks: stalls from the rank's own vendor list, on the pavements around it.
  _rankStalls(rng, place, typeFor) {
    const w = this.walk;
    const seen = [];
    for (const rank of this.game.data.ranks || []) {
      if (seen.some((s) => Math.hypot(s.x - rank.x, s.z - rank.z) < 40)) continue;
      seen.push(rank);
      const info = RANKS.find((r) => rank.name.toLowerCase().includes(r.name.toLowerCase().split(' ')[0]));
      const types = (info?.vendors || []).map((id) => TYPES.find((t) => t.type === id)).filter((t) => t && BUILDERS.has(t.type));
      let n = 0;
      const want = rank.kind === 'bus_stop' ? 3 : 8;
      for (let tries = 0; tries < 80 && n < want; tries++) {
        const near = w.nearestEdge(rank.x + rng.range(-45, 45), rank.z + rng.range(-45, 45), 25);
        if (!near) continue;
        const e = w.edges[near.edge];
        if (e.kind !== WALK && e.kind !== PATH) continue;
        const out = e.side || (rng() < 0.5 ? 1 : -1);
        const p = w.pointOn(e, near.t * e.len, out * (e.spread + (e.kind === PATH ? -0.4 : 0.15)), _p);
        if (place(types.length ? rng.pick(types) : typeFor('rank'), p.x, p.z, w.nodes[e.a].y, facingIn(e, out), 'rank', rank.name)) n++;
      }
    }
  }

  // Props in stall-local space (x right, z toward the customers = -z forward) and the vendor spot.
  _layout(st, rng) {
    const P = [];
    const add = (kind, x, y, z, sx, sy, sz, color, rot = 0, tile = 0) => P.push({ kind, x, y, z, sx, sy, sz, color, rot, tile });
    const umbrella = () => add('umbrella', 0.35, 0, 0.35, 1, 1, 1, rng.pick(UMBRELLAS), rng.range(0, 6.28));
    const produce = (n, y) => {
      for (let i = 0; i < n; i++) add('pile', -0.45 + (0.9 * i) / Math.max(1, n - 1), y, rng.range(-0.12, 0.12), 1.2, 1.2, 1.2, rng.pick(PRODUCE));
    };
    let sit = true;
    let vendorZ = 0.75;
    switch (st.type) {
      case 'fruit_veg':
        if (rng() < 0.55) {
          add('table', 0, 0, 0, 1, 1, 1, '#8a6a48');
          produce(rng.int(4, 6), 0.765);
          if (rng() < 0.6) add('basin', 0.5, 0, -0.55, 1, 1, 1, rng.pick(['#c9ced3', '#2b56a1', '#d23a2a']));
        } else {
          // On the ground: cardboard sheet, basins and heaps, vendor on an upturned crate.
          add('box', 0, 0, -0.1, 1.5, 0.01, 0.9, '#b58f5d');
          for (let i = 0; i < 3; i++) {
            const x = -0.5 + i * 0.5;
            add('basin', x, 0.01, -0.2, 0.8, 0.8, 0.8, rng.pick(['#c9ced3', '#2b56a1', '#d23a2a', '#e0b23a']));
            add('heap', x, 0.06, -0.2, 0.75, 0.75, 0.75, rng.pick(PRODUCE));
          }
          vendorZ = 0.55;
        }
        if (rng() < 0.6) umbrella();
        add('box', 0, 0, vendorZ + 0.05, 0.42, 0.32, 0.34, rng.pick(['#d23a2a', '#2b56a1', '#e0b23a', '#2e8b57']));
        break;
      case 'airtime_phone':
      case 'umbrella_accessories':
        add('table', 0, 0, 0, 0.7, 1, 0.9, '#6f6a62');
        add('board', 0.7, 0, -0.35, 1, 1, 1, '#ffffff', 0.25, 0);
        if (rng() < 0.5) umbrella();
        sit = false;
        break;
      case 'sweets_snacks':
        add('box', -0.25, 0, 0, 0.55, 0.42, 0.4, rng.pick(['#1d4fb8', '#d6201f']));
        add('box', -0.25, 0.42, 0, 0.57, 0.05, 0.42, '#f2f2f2');
        add('box', 0.35, 0, 0, 0.42, 0.32, 0.34, '#e0b23a');
        add('box', 0.35, 0.32, 0, 0.5, 0.04, 0.42, '#c9a26b');
        add('board', 0.9, 0, -0.2, 1, 1, 1, '#ffffff', -0.3, 2);
        add('box', 0, 0, vendorZ + 0.05, 0.42, 0.32, 0.34, '#2e8b57');
        break;
      case 'newspaper':
        add('box', 0, 0, -0.1, 0.45, 0.22, 0.32, '#e8e4d8');
        add('box', 0.5, 0, -0.1, 0.45, 0.16, 0.32, '#d9d4c6');
        add('board', -0.6, 0, -0.2, 1, 1, 1, '#ffffff', 0.2, 1);
        sit = false;
        break;
      case 'shoe_mender':
        for (let i = 0; i < 6; i++) add('box', -0.6 + i * 0.22, 0, -0.35, 0.1, 0.09, 0.26, rng.pick(['#1a1a1a', '#3b2a1e', '#6b4a2e']));
        add('board', 0.9, 0, -0.1, 1, 1, 1, '#ffffff', -0.25, 3);
        add('box', 0, 0, vendorZ + 0.05, 0.36, 0.34, 0.36, '#6b4a2e');
        umbrella();
        break;
      case 'flowers':
        for (let i = 0; i < 5; i++) {
          const x = -0.8 + i * 0.4;
          const z = -0.15 + (i % 2) * 0.25;
          add('bucket', x, 0, z, 1, 1, 1, '#9aa3a8');
          add('blooms', x, 0, z, 1, 1, 1, rng.pick(FLOWERS));
        }
        sit = false;
        break;
      case 'secondhand_clothes':
        add('box', 0, 0, -0.1, 1.8, 0.01, 1.1, '#2b56a1');
        for (let i = 0; i < 6; i++) {
          add('box', -0.65 + (i % 3) * 0.6, 0.01, -0.35 + Math.floor(i / 3) * 0.45, 0.45, rng.range(0.1, 0.22), 0.36, rng.pick(['#d6201f', '#1e2d55', '#f2c200', '#2e8b57', '#ffffff', '#7b2d8e', '#5a6f8f']), rng.range(-0.3, 0.3));
        }
        sit = false;
        break;
      case 'roast_maize':
        add('basin', -0.3, 0, -0.2, 1, 1.4, 1, '#2a2a2a');
        add('heap', -0.3, 0.1, -0.2, 0.8, 0.6, 0.8, '#e9c25a');
        add('basin', 0.4, 0, -0.2, 0.9, 0.9, 0.9, '#c9ced3');
        add('heap', 0.4, 0.06, -0.2, 0.7, 0.8, 0.7, '#f0d23c');
        add('box', 0, 0, vendorZ + 0.05, 0.42, 0.32, 0.34, '#d23a2a');
        break;
      case 'megaphone_herbalist':
        add('box', 0, 0, -0.1, 1.2, 0.01, 0.8, '#6b1f2a');
        for (let i = 0; i < 8; i++) add('box', -0.45 + (i % 4) * 0.3, 0.01, -0.3 + Math.floor(i / 4) * 0.3, 0.14, 0.03, 0.1, rng.pick(['#f2c200', '#d6201f', '#ffffff']));
        sit = false;
        break;
      default:
        sit = false;
    }
    st.sit = sit && st.type !== 'money_changer';
    st.localProps = P;
    st.vendorLocal = { x: 0, z: st.type === 'money_changer' ? 0 : vendorZ };
    const r = st.type === 'money_changer' ? 0.5 : 1.15;
    this.obstacles.push({ x: st.x, z: st.z, r });
  }

  _buildMeshes() {
    const geos = propGeometries();
    const buckets = Object.fromEntries(PROP_KINDS.map((k) => [k, []]));
    for (const st of this.stalls) {
      const c = Math.cos(st.heading);
      const s = Math.sin(st.heading);
      // Local (x right, z back) → world, with the stall facing -z at heading 0.
      const toWorld = (lx, lz) => ({ x: st.x + lx * c + lz * s, z: st.z - lx * s + lz * c });
      for (const p of st.localProps) {
        const wpos = toWorld(p.x, p.z);
        buckets[p.kind].push({ ...p, x: wpos.x, z: wpos.z, y: st.y + p.y, rot: st.heading + p.rot });
      }
      const v = toWorld(st.vendorLocal.x, st.vendorLocal.z);
      st.vendorSpot = { x: v.x, z: v.z, y: st.y, heading: st.heading };
    }
    const shadows = this.game.quality.shadows;
    const boardMat = new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.9, side: THREE.DoubleSide });
    boardMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aTile;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv.x = (vMapUv.x + aTile) * 0.25;');
    };
    boardMat.customProgramCacheKey = () => 'npc-board';
    this.group = new THREE.Group();
    this.group.name = 'vendor-stalls';
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const color = new THREE.Color();
    for (const kind of PROP_KINDS) {
      const list = buckets[kind];
      if (!list.length) continue;
      const geo = geos[kind];
      let mat;
      if (kind === 'board') {
        geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(Float32Array.from(list.map((p) => p.tile)), 1));
        mat = boardMat;
      } else {
        mat = new THREE.MeshStandardMaterial({ roughness: kind === 'bucket' ? 0.45 : 0.8, metalness: kind === 'bucket' ? 0.4 : 0, vertexColors: kind === 'umbrella', side: kind === 'umbrella' ? THREE.DoubleSide : THREE.FrontSide });
      }
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        m.compose(pos.set(p.x, p.y, p.z), q, scl.set(p.sx, p.sy, p.sz));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color.set(p.color));
      });
      mesh.castShadow = shadows && (kind === 'umbrella' || kind === 'table');
      mesh.receiveShadow = shadows;
      mesh.computeBoundingSphere();
      mesh.name = `stall-${kind}`;
      this.group.add(mesh);
    }
    this.game.scene.add(this.group);
  }

  // Vendor call-outs for a stall (Shona + English), if the research lists any.
  calloutsFor(stall) {
    return stall.def.callouts || [];
  }
}
