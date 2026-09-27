import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TRAFFIC } from '../data/streetlife.js';
import { ROAD_CLASSES } from './roadGraph.js';

// Traffic lights ("robots"). Signalised junctions are the mapped traffic_signals plus every crossing of
// two different major streets. Nodes within CLUSTER_DIST share one controller, so a dual carriageway
// crossing (two nodes) runs one phase plan and its median link is exempt. Two phase groups per
// controller: approaches along the main road's axis, and those across it.

export const GREEN = 0;
export const AMBER = 1;
export const RED = 2;
export const NONE = -1;

const CLUSTER_DIST = 36;
const MAJOR_RANK = ROAD_CLASSES.tertiary.rank;

const LAMP_ON = [new THREE.Color(0.1, 1.0, 0.45).multiplyScalar(2.2), new THREE.Color(1.0, 0.55, 0.05).multiplyScalar(2.2), new THREE.Color(1.0, 0.07, 0.04).multiplyScalar(2.2)];
const LAMP_OFF = [new THREE.Color(0.02, 0.07, 0.04), new THREE.Color(0.08, 0.05, 0.01), new THREE.Color(0.08, 0.015, 0.01)];

// Bounding box of the dense CBD (buildings flagged `core`), trimmed of outliers.
function coreBounds(buildings) {
  const xs = [];
  const zs = [];
  for (const b of buildings || []) {
    if (!b.core) continue;
    xs.push(b.fp[0]);
    zs.push(b.fp[1]);
  }
  if (xs.length < 20) return null;
  xs.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  const q = (arr, f) => arr[Math.floor((arr.length - 1) * f)];
  return { minX: q(xs, 0.03), maxX: q(xs, 0.97), minZ: q(zs, 0.03), maxZ: q(zs, 0.97) };
}

class Controller {
  constructor(id, nodes, axis, rng) {
    this.id = id;
    this.nodes = nodes;
    this.axis = axis;
    const cyc = TRAFFIC?.robots?.cycle || {};
    this.amber = cyc.amber ?? 3;
    this.allRed = Math.max(1.5, cyc.allRed ?? 2);
    this.green = [Math.round((cyc.green ?? 28) * 0.8), Math.round((cyc.green ?? 28) * 0.55)];
    this.cycle = this.green[0] + this.green[1] + 2 * (this.amber + this.allRed);
    this.offset = rng() * this.cycle;
    this.dead = rng() < (1 - (TRAFFIC?.robots?.workingFraction ?? 0.7)) * 0.35;
    this.state = [RED, RED];
    this.clear = [false, false];
    this.changed = true;
  }

  update(time) {
    let t = (time + this.offset) % this.cycle;
    let a = RED;
    let b = RED;
    let ca = false;
    let cb = false;
    const [gA, gB] = this.green;
    if (t < gA) a = GREEN;
    else if ((t -= gA) < this.amber) {
      a = AMBER;
      ca = true;
    } else if ((t -= this.amber) < this.allRed) ca = true;
    else if ((t -= this.allRed) < gB) b = GREEN;
    else if ((t -= gB) < this.amber) {
      b = AMBER;
      cb = true;
    } else cb = true;
    this.changed = a !== this.state[0] || b !== this.state[1];
    this.state[0] = a;
    this.state[1] = b;
    this.clear[0] = ca;
    this.clear[1] = cb;
  }
}

export class Signals {
  constructor(graph, data, rng) {
    this.graph = graph;
    this.controllers = [];
    this.byNode = new Map();
    this.heads = [];
    this._first = true;
    this._find(data, rng);
  }

  _find(data, rng) {
    const { roads, nodes, features } = data;
    const ends = new Map();
    roads.forEach((r) => {
      const cls = ROAD_CLASSES[r.cls];
      if (!cls) return;
      for (const [node, atA] of [[r.a, true], [r.b, false]]) {
        const p = r.pts;
        const n = p.length;
        const dx = atA ? p[2] - p[0] : p[n - 4] - p[n - 2];
        const dz = atA ? p[3] - p[1] : p[n - 3] - p[n - 1];
        const l = Math.hypot(dx, dz) || 1;
        if (!ends.has(node)) ends.set(node, []);
        ends.get(node).push({ road: r, rank: cls.rank, dx: dx / l, dz: dz / l });
      }
    });
    const mapped = (features || []).filter((f) => f.kind === 'traffic_signals');
    const core = coreBounds(data.buildings);
    const signalised = [];
    for (const [node, list] of ends) {
      if (list.length < 3) continue;
      const [x, z] = nodes[node];
      // Inside the CBD grid, a major street crossing any wide named street gets a robot as well.
      const inCore = core && x > core.minX && x < core.maxX && z > core.minZ && z < core.maxZ;
      let yes = mapped.some((f) => Math.hypot(f.x - x, f.z - z) < 18);
      for (let i = 0; i < list.length && !yes; i++) {
        for (let k = i + 1; k < list.length; k++) {
          const a = list[i];
          const b = list[k];
          const hi = Math.max(a.rank, b.rank);
          const lo = Math.min(a.rank, b.rank);
          const minor = inCore ? a.road.name && b.road.name && Math.min(a.road.w, b.road.w) >= 8 : false;
          if (hi < MAJOR_RANK || (lo < MAJOR_RANK && !minor)) continue;
          const cross = Math.abs(a.dx * b.dz - a.dz * b.dx);
          if (cross > 0.6 && (a.road.name || a.road) !== (b.road.name || b.road)) {
            yes = true;
            break;
          }
        }
      }
      if (yes) signalised.push(node);
    }

    // Cluster nearby signalised nodes (union-find).
    const parent = new Map(signalised.map((n) => [n, n]));
    const find = (n) => {
      while (parent.get(n) !== n) n = parent.get(n);
      return n;
    };
    for (let i = 0; i < signalised.length; i++) {
      const [ax, az] = nodes[signalised[i]];
      for (let k = i + 1; k < signalised.length; k++) {
        const [bx, bz] = nodes[signalised[k]];
        if (Math.abs(ax - bx) < CLUSTER_DIST && Math.abs(az - bz) < CLUSTER_DIST && Math.hypot(ax - bx, az - bz) < CLUSTER_DIST) {
          parent.set(find(signalised[i]), find(signalised[k]));
        }
      }
    }
    const clusters = new Map();
    for (const n of signalised) {
      const root = find(n);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(n);
    }
    for (const members of clusters.values()) {
      let best = null;
      for (const n of members) {
        for (const e of ends.get(n)) if (!best || e.rank > best.rank || (e.rank === best.rank && e.road.w > best.road.w)) best = e;
      }
      const c = new Controller(this.controllers.length, members, { x: best.dx, z: best.dz }, rng);
      this.controllers.push(c);
      for (const n of members) this.byNode.set(n, c);
    }

    for (const lane of this.graph.lanes) {
      const c = this.byNode.get(lane.to);
      if (!c) continue;
      lane.signal = c;
      lane.internal = this.byNode.get(lane.from) === c;
      const p = lane.pts;
      const n = p.length;
      const dx = p[n - 2] - p[n - 4];
      const dz = p[n - 1] - p[n - 3];
      const l = Math.hypot(dx, dz) || 1;
      lane.signalGroup = Math.abs((dx * c.axis.x + dz * c.axis.z) / l) >= Math.SQRT1_2 ? 0 : 1;
    }
  }

  update(time) {
    for (const c of this.controllers) c.update(time);
  }

  // GREEN | AMBER | RED for a lane approaching a working robot, NONE otherwise.
  state(lane) {
    const c = lane.signal;
    if (!c || c.dead || lane.internal) return NONE;
    return c.state[lane.signalGroup];
  }

  // True during this approach's amber and the all-red that follows it (lets a waiting right-turner clear).
  clearance(lane) {
    return !!lane.signal && lane.signal.clear[lane.signalGroup];
  }

  // Public: 'green' | 'amber' | 'red' | null for traffic entering `node` from `fromNode` (or the main axis).
  signalAt(node, fromNode) {
    const c = this.byNode.get(node);
    if (!c || c.dead) return null;
    let group = 0;
    if (fromNode !== undefined) {
      const lane = this.graph.lanesInto(node, fromNode)[0];
      if (!lane) return null;
      if (lane.internal) return 'green';
      group = lane.signalGroup;
    }
    return ['green', 'amber', 'red'][c.state[group]];
  }

  // Poles + back-to-back heads at the left kerb of every approach (plus the median side of one-way
  // carriageways), merged into one static mesh; the lamps are one instanced mesh recoloured by phase.
  buildMeshes(scene) {
    const poses = [];
    const seen = new Set();
    for (const lane of this.graph.lanes) {
      if (!lane.signal || lane.internal || lane.laneIndex !== 0) continue;
      const key = `${lane.roadIndex}:${lane.dir}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = lane.pts;
      const n = p.length;
      const dx = p[n - 2] - p[n - 4];
      const dz = p[n - 1] - p[n - 3];
      const l = Math.hypot(dx, dz) || 1;
      const fx = dx / l;
      const fz = dz / l;
      const lx = fz;
      const lz = -fx;
      const off = lane.kerbSpace + 0.75;
      poses.push({ x: p[n - 2] + lx * off - fx * 0.8, z: p[n - 1] + lz * off - fz * 0.8, fx, fz, c: lane.signal, g: lane.signalGroup });
      if (lane.road.oneway && lane.siblings.length > 1) {
        const inner = lane.siblings[lane.siblings.length - 1];
        const q = inner.pts;
        const m = q.length;
        const toEdge = lane.road.w / lane.siblings.length / 2 + 0.6;
        poses.push({ x: q[m - 2] - lx * toEdge - fx * 0.8, z: q[m - 1] - lz * toEdge - fz * 0.8, fx, fz, c: lane.signal, g: lane.signalGroup });
      }
    }

    const parts = [];
    const color = new THREE.Color();
    const paint = (g, hex) => {
      const nv = g.attributes.position.count;
      const arr = new Float32Array(nv * 3);
      color.set(hex);
      for (let i = 0; i < nv; i++) color.toArray(arr, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g;
    };
    const base = [];
    const pole = new THREE.CylinderGeometry(0.075, 0.09, 3.6, 8);
    pole.translate(0, 1.8, 0);
    base.push(paint(pole, '#4d5156'));
    const band = new THREE.CylinderGeometry(0.095, 0.095, 0.5, 8);
    band.translate(0, 1.0, 0);
    base.push(paint(band, '#e9e6dc'));
    for (const side of [1, -1]) {
      const board = new THREE.BoxGeometry(0.54, 1.18, 0.03);
      board.translate(0, 2.95, side * 0.1);
      base.push(paint(board, '#f1efe6'));
      const head = new THREE.BoxGeometry(0.34, 1.0, 0.24);
      head.translate(0, 2.95, side * 0.24);
      base.push(paint(head, '#141516'));
      for (let k = -1; k <= 1; k++) {
        const visor = new THREE.BoxGeometry(0.26, 0.03, 0.16);
        visor.translate(0, 2.95 + k * 0.3 + 0.14, side * 0.43);
        base.push(paint(visor, '#141516'));
      }
    }
    const unit = mergeGeometries(base.map((g) => g.toNonIndexed()), false);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const pose of poses) {
      q.setFromAxisAngle(up, Math.atan2(-pose.fx, -pose.fz));
      m.compose(new THREE.Vector3(pose.x, 0, pose.z), q, new THREE.Vector3(1, 1, 1));
      parts.push(unit.clone().applyMatrix4(m));
    }
    if (!parts.length) return;
    const merged = mergeGeometries(parts, false);
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    mesh.name = 'robots';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    this.poleMesh = mesh;

    const lampGeo = new THREE.CircleGeometry(0.1, 10);
    const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), poses.length * 6);
    lamps.name = 'robot-lamps';
    const pos = new THREE.Vector3();
    for (const pose of poses) {
      for (const side of [1, -1]) {
        // side 1 faces approaching drivers (-f); side -1 faces the far side.
        const facing = Math.atan2(-pose.fx * side, -pose.fz * side);
        q.setFromAxisAngle(up, facing);
        for (let k = 0; k < 3; k++) {
          pos.set(pose.x - pose.fx * side * 0.365, 2.95 + (1 - k) * 0.3, pose.z - pose.fz * side * 0.365);
          m.compose(pos, q, new THREE.Vector3(1, 1, 1));
          const i = this.heads.length;
          lamps.setMatrixAt(i, m);
          lamps.setColorAt(i, LAMP_OFF[2 - k]);
          this.heads.push({ c: pose.c, g: pose.g, lamp: 2 - k });
        }
      }
    }
    lamps.instanceMatrix.needsUpdate = true;
    lamps.computeBoundingSphere();
    scene.add(lamps);
    this.lamps = lamps;
  }

  // Recolour lamps whose controller changed phase this frame.
  updateLamps() {
    if (!this.lamps) return;
    let dirty = false;
    for (let i = 0; i < this.heads.length; i++) {
      const h = this.heads[i];
      if (!h.c.changed && !this._first) continue;
      const on = !h.c.dead && h.c.state[h.g] === h.lamp;
      this.lamps.setColorAt(i, on ? LAMP_ON[h.lamp] : LAMP_OFF[h.lamp]);
      dirty = true;
    }
    this._first = false;
    if (dirty) this.lamps.instanceColor.needsUpdate = true;
  }
}
