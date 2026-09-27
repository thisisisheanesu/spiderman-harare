import { GeoBuffer } from './geoBuffer.js';
import { polylineNormals, arcLengths, sampleAt, slice, SegmentGrid, resample } from './lines.js';
import { sidewalkWidth, kerbOffset, totalLanes, laneWidth, isMajor, KERB_HEIGHT } from './streetMetrics.js';
import { tint } from './palette.js';

// Streets: asphalt carriageways + junction patches, raised pavements with kerbs (cut wherever they
// would run into another carriageway), and SADC-style markings: broken white centre/lane lines,
// white edge lines (yellow on the left of one-way carriageways), zebra crossings + stop lines at
// busy junctions. Lane lines use the same laneWidth/totalLanes as traffic (keep left).

const MARKED = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);
const WHITE = tint('#f4f3ee');
const YELLOW = tint('#e9b83a');
const SIDE_STEP = 3;

export function buildStreets(ctx) {
  const { data, G, heightAt, crossingPoints, densify } = ctx;
  const roads = data.roads;
  const asphalt = new GeoBuffer(1 << 16);
  const walks = new GeoBuffer(1 << 16);
  const marks = new GeoBuffer(1 << 16);
  const sidewalkPaths = [];

  // Carriageway lookup for pavement clipping.
  const grid = new SegmentGrid(32);
  roads.forEach((r, ri) => grid.addPolyline(r.pts, ri));
  const maxHalfW = Math.max(...roads.map((r) => r.w / 2));

  // Junction topology.
  const nodeRoads = new Map();
  roads.forEach((r, ri) => {
    const p = r.pts;
    const n = p.length / 2;
    const add = (node, atStart, x, z, nx, nz) => {
      const dx = nx - x;
      const dz = nz - z;
      const l = Math.hypot(dx, dz) || 1;
      let arr = nodeRoads.get(node);
      if (!arr) nodeRoads.set(node, (arr = []));
      arr.push({ ri, atStart, dx: dx / l, dz: dz / l, w: r.w, x, z });
    };
    add(r.a, true, p[0], p[1], p[2], p[3]);
    add(r.b, false, p[(n - 1) * 2], p[(n - 1) * 2 + 1], p[(n - 2) * 2], p[(n - 2) * 2 + 1]);
  });

  // Set-back distance from each junction centre where a road's own markings may start.
  const trims = new Map();
  const crossingNodes = new Set();
  for (const [node, arr] of nodeRoads) {
    if (arr.length < 3) continue;
    let major = 0;
    for (const e of arr) if (isMajor(roads[e.ri])) major++;
    const [nx, nz] = data.nodes[node];
    const nearSignal = crossingPoints.some((f) => Math.hypot(f.x - nx, f.z - nz) < 14);
    if (major >= 3 || nearSignal) crossingNodes.add(node);
    for (const e of arr) {
      let t = 0;
      for (const o of arr) {
        if (o === e) continue;
        const sin = Math.abs(e.dx * o.dz - e.dz * o.dx);
        t = Math.max(t, (o.w / 2 + 0.6) / Math.max(sin, 0.35));
      }
      trims.set(`${e.ri}:${e.atStart ? 0 : 1}`, Math.min(t, 30));
    }
    emitJunction(asphalt, G, arr, trims, heightAt);
  }

  const tmp = { x: 0, z: 0, dx: 0, dz: 0, i: 0 };
  roads.forEach((r, ri) => {
    const pts = densify(r.pts) ? resample(r.pts, 4) : r.pts;
    const n = pts.length / 2;
    if (n < 2) return;
    const nrm = polylineNormals(pts);
    const lens = arcLengths(pts);
    const total = lens[n - 1];
    const hw = kerbOffset(r);

    // Carriageway ribbon.
    const tone = r.cls === 'service' ? tint('#f3eee6', 1.12) : isMajor(r) ? tint('#ffffff') : tint('#f6f2ec', 1.05);
    asphalt.brush(tone, G.asphalt, 0, 0);
    ribbon(asphalt, pts, nrm, -hw, hw, heightAt, 7);

    // Pavements on both sides.
    const sw = sidewalkWidth(r);
    if (sw > 0) {
      for (const side of [1, -1]) {
        const runs = sidewalkRuns(r, ri, pts, nrm, lens, side, hw, sw, grid, roads, maxHalfW);
        for (const run of runs) {
          emitSidewalk(walks, G, run, hw, side, heightAt);
          const path = [];
          for (const s of run) path.push(s.x + s.nx * side * (hw + s.w / 2), s.z + s.nz * side * (hw + s.w / 2));
          sidewalkPaths.push({ pts: path, width: run.reduce((m, s) => Math.min(m, s.w), sw), road: ri, side });
        }
      }
    }

    // Markings.
    if (!MARKED.has(r.cls) || r.link || r.w < 6) return;
    const trimA = trims.get(`${ri}:0`) || 0;
    const trimB = trims.get(`${ri}:1`) || 0;
    const zebraA = crossingNodes.has(r.a);
    const zebraB = crossingNodes.has(r.b);
    const s0 = trimA + (zebraA ? 6.2 : trimA ? 1 : 0);
    const s1 = total - trimB - (zebraB ? 6.2 : trimB ? 1 : 0);
    if (s1 - s0 < 5) return;
    const lanes = totalLanes(r);
    const lw = laneWidth(r);
    const major = isMajor(r);
    marks.brush(WHITE, G.paint, 0, 0);
    if (!r.oneway) {
      const per = Math.max(1, r.lanes || 1);
      dashes(marks, pts, lens, s0, s1, 0, 0.12, major ? 3 : 2.5, major ? 6 : 5, heightAt);
      for (let k = 1; k < per; k++) {
        dashes(marks, pts, lens, s0, s1, k * lw, 0.1, 3, 6, heightAt);
        dashes(marks, pts, lens, s0, s1, -k * lw, 0.1, 3, 6, heightAt);
      }
      if (major) {
        strip(marks, pts, lens, s0, s1, hw - 0.35, 0.1, heightAt);
        strip(marks, pts, lens, s0, s1, -hw + 0.35, 0.1, heightAt);
      }
    } else {
      for (let k = 1; k < lanes; k++) dashes(marks, pts, lens, s0, s1, (lanes / 2 - k) * lw, 0.1, 3, 6, heightAt);
      // Offsets are to the left of a->b; a b->a one-way flips which kerb is "left".
      const left = r.oneway === 1 ? 1 : -1;
      if (major || lanes > 1) {
        strip(marks, pts, lens, s0, s1, -left * (hw - 0.35), 0.1, heightAt);
        marks.setTint(YELLOW);
        strip(marks, pts, lens, s0, s1, left * (hw - 0.35), 0.1, heightAt);
        marks.setTint(WHITE);
      }
    }
    // Zebra crossings and stop lines at busy junction approaches.
    for (const [atStart, trim, node] of [[true, trimA, r.a], [false, trimB, r.b]]) {
      if (!crossingNodes.has(node)) continue;
      const base = atStart ? trim + 0.8 : total - trim - 0.8;
      const dir = atStart ? 1 : -1;
      const sa = Math.min(base, base + dir * 3.2);
      const sb = Math.max(base, base + dir * 3.2);
      if (sa < 0 || sb > total) continue;
      for (let o = -hw + 0.6; o <= hw - 0.5; o += 1.0) strip(marks, pts, lens, sa, sb, o + 0.25, 0.5, heightAt);
      // Stop line across the lanes arriving at the junction (keep left).
      const sStop = base + dir * 4.4;
      sampleAt(pts, lens, sStop, tmp);
      const into = r.oneway ? (r.oneway === 1) === !atStart : true;
      if (into) {
        // Arriving traffic keeps left of its travel direction: right of a->b when arriving at a.
        const sideSign = atStart ? -1 : 1;
        stopLine(marks, tmp, r.oneway ? -hw + 0.3 : 0, (hw - 0.3) * (r.oneway ? 1 : sideSign), heightAt);
      }
    }
  });

  return { asphalt, walks, marks, sidewalkPaths, crossingNodes, nodeRoads, trims };
}

// Quad strip between lateral offsets o0..o1 along a polyline (mitred), world-space UVs.
export function ribbon(gb, pts, nrm, o0, o1, heightAt, uvScale, y = 0) {
  const n = pts.length / 2;
  const s = 1 / uvScale;
  const i0 = gb.iCount;
  let prevA = -1;
  let prevB = -1;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2];
    const z = pts[i * 2 + 1];
    const k = nrm[i * 3 + 2];
    const ax = x + nrm[i * 3] * o0 * k;
    const az = z + nrm[i * 3 + 1] * o0 * k;
    const bx = x + nrm[i * 3] * o1 * k;
    const bz = z + nrm[i * 3 + 1] * o1 * k;
    const a = gb.vertex(ax, heightAt(ax, az) + y, az, 0, 1, 0, ax * s, -az * s);
    const b = gb.vertex(bx, heightAt(bx, bz) + y, bz, 0, 1, 0, bx * s, -bz * s);
    if (prevA >= 0) {
      gb.tri(prevA, prevB, b);
      gb.tri(prevA, b, a);
    }
    prevA = a;
    prevB = b;
  }
  faceUp(gb, i0);
}

// Flips triangles emitted since index i0 so they all face up (+y).
export function faceUp(gb, i0) {
  const P = gb.pos;
  const I = gb.idx;
  for (let t = i0; t < gb.iCount; t += 3) {
    const a = I[t] * 3;
    const b = I[t + 1] * 3;
    const c = I[t + 2] * 3;
    const e1x = P[b] - P[a];
    const e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a];
    const e2z = P[c + 2] - P[a + 2];
    if (e1z * e2x - e1x * e2z < 0) {
      const tmp = I[t + 1];
      I[t + 1] = I[t + 2];
      I[t + 2] = tmp;
    }
  }
}

function emitJunction(gb, G, arr, trims, heightAt) {
  // Convex hull of the carriageway corners around the node.
  const pts = [];
  for (const e of arr) {
    const t = (trims.get(`${e.ri}:${e.atStart ? 0 : 1}`) || 0) + 0.5;
    const px = -e.dz;
    const pz = e.dx;
    const cx = e.x + e.dx * t;
    const cz = e.z + e.dz * t;
    pts.push([cx + px * (e.w / 2), cz + pz * (e.w / 2)], [cx - px * (e.w / 2), cz - pz * (e.w / 2)]);
    pts.push([e.x + px * (e.w / 2), e.z + pz * (e.w / 2)], [e.x - px * (e.w / 2), e.z - pz * (e.w / 2)]);
  }
  const hull = convexHull(pts);
  if (hull.length < 3) return;
  const ring = [];
  for (const p of hull) ring.push(p[0], p[1]);
  gb.brush(tint('#ffffff'), G.asphalt, 0, 0);
  const cx = arr[0].x;
  const cz = arr[0].z;
  const i0 = gb.iCount;
  const c = gb.vertex(cx, heightAt(cx, cz), cz, 0, 1, 0, cx / 7, -cz / 7);
  const base = gb.vCount;
  for (const p of hull) gb.vertex(p[0], heightAt(p[0], p[1]), p[1], 0, 1, 0, p[0] / 7, -p[1] / 7);
  for (let i = 0; i < hull.length; i++) gb.tri(c, base + i, base + ((i + 1) % hull.length));
  faceUp(gb, i0);
}

function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// Samples one side of a road and returns runs of pavement samples {x, z, nx, nz, w} that stay
// clear of every other carriageway.
function sidewalkRuns(r, ri, pts, nrm, lens, side, hw, sw, grid, roads, maxHalfW) {
  const n = pts.length / 2;
  const samples = [];
  const blocked = (x, z) => {
    let hit = false;
    grid.query(x, z, maxHalfW + 0.3, (seg, d) => {
      if (hit || seg.ref === ri) return;
      if (d < roads[seg.ref].w / 2 + 0.25) hit = true;
    });
    return hit;
  };
  const widthAt = (x, z, nx, nz) => {
    const o = side * hw;
    if (!blocked(x + nx * (o + side * sw), z + nz * (o + side * sw)) && !blocked(x + nx * (o + side * sw * 0.5), z + nz * (o + side * sw * 0.5))) return sw;
    if (!blocked(x + nx * (o + side * sw * 0.5), z + nz * (o + side * sw * 0.5))) return sw * 0.5;
    if (!blocked(x + nx * (o + side * 0.5), z + nz * (o + side * 0.5))) return 0.8;
    return 0;
  };
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2];
    const z = pts[i * 2 + 1];
    const k = nrm[i * 3 + 2];
    const nx = nrm[i * 3] * k;
    const nz = nrm[i * 3 + 1] * k;
    samples.push({ x, z, nx, nz, s: lens[i], w: widthAt(x, z, nrm[i * 3], nrm[i * 3 + 1]), vertex: true });
    if (i === n - 1) break;
    const segLen = lens[i + 1] - lens[i];
    const steps = Math.floor(segLen / SIDE_STEP);
    const dx = (pts[i * 2 + 2] - x) / (segLen || 1);
    const dz = (pts[i * 2 + 3] - z) / (segLen || 1);
    for (let s = 1; s <= steps; s++) {
      const t = (s * segLen) / (steps + 1);
      const sx = x + dx * t;
      const szz = z + dz * t;
      samples.push({ x: sx, z: szz, nx: dz, nz: -dx, s: lens[i] + t, w: widthAt(sx, szz, dz, -dx) });
    }
  }
  // Runs of usable samples; their ends are refined by bisection so pavements stop right at the
  // kerb line of the crossing street (corners then overlap instead of leaving gaps).
  const tmp = { x: 0, z: 0, dx: 0, dz: 0, i: 0 };
  const probe = (s) => {
    sampleAt(pts, lens, s, tmp);
    return { x: tmp.x, z: tmp.z, nx: tmp.dz, nz: -tmp.dx, s, w: widthAt(tmp.x, tmp.z, tmp.dz, -tmp.dx) };
  };
  const refine = (good, bad) => {
    let a = good.s;
    let b = bad.s;
    for (let k = 0; k < 5; k++) {
      const m = (a + b) / 2;
      if (probe(m).w > 0) a = m;
      else b = m;
    }
    const p = probe(a);
    p.w = Math.min(good.w, p.w || good.w);
    return p;
  };
  const runs = [];
  let cur = null;
  for (let k = 0; k < samples.length; k++) {
    const smp = samples[k];
    if (smp.w > 0) {
      if (!cur) {
        runs.push((cur = []));
        if (k > 0) cur.push(refine(smp, samples[k - 1]));
      }
      cur.push(smp);
    } else if (cur) {
      cur.push(refine(samples[k - 1], smp));
      cur = null;
    }
  }
  // Drop in-between samples on straight stretches where the width does not change.
  return runs
    .filter((run) => run.length >= 2 && run[run.length - 1].s - run[0].s > 1.5)
    .map((run) => run.filter((p, k) => k === 0 || k === run.length - 1 || p.vertex || p.w !== run[k - 1].w || p.w !== run[k + 1].w));
}

function emitSidewalk(gb, G, run, hw, side, heightAt) {
  const y = KERB_HEIGHT;
  const inner = [];
  const outer = [];
  for (const s of run) {
    const ix = s.x + s.nx * side * hw;
    const iz = s.z + s.nz * side * hw;
    const ox = s.x + s.nx * side * (hw + s.w);
    const oz = s.z + s.nz * side * (hw + s.w);
    inner.push(ix, iz, heightAt(ix, iz));
    outer.push(ox, oz, heightAt(ox, oz));
  }
  const m = run.length;
  gb.brush(tint('#ffffff'), G.paving, 0, 0);
  for (let i = 0; i < m - 1; i++) {
    const a = i * 3;
    const b = a + 3;
    gb.quad(
      inner[a], inner[a + 2] + y, inner[a + 1], inner[b], inner[b + 2] + y, inner[b + 1],
      outer[b], outer[b + 2] + y, outer[b + 1], outer[a], outer[a + 2] + y, outer[a + 1],
      0, 1, 0, inner[a] / 3, -inner[a + 1] / 3, inner[b] / 3, -outer[a + 1] / 3,
    );
  }
  // Paving UVs: redo as world-space per vertex (quad() takes a rect; re-map the last quads).
  const P = gb.pos;
  const U = gb.uv;
  for (let v = gb.vCount - (m - 1) * 4; v < gb.vCount; v++) {
    U[v * 2] = P[v * 3] / 3;
    U[v * 2 + 1] = -P[v * 3 + 2] / 3;
  }
  // Kerb face (towards the road) and outer edge.
  gb.brush(tint('#ffffff'), G.kerb, 0, 0);
  for (let i = 0; i < m - 1; i++) {
    const a = i * 3;
    const b = a + 3;
    const len = Math.hypot(inner[b] - inner[a], inner[b + 1] - inner[a + 1]);
    const dx = (inner[b] - inner[a]) / (len || 1);
    const dz = (inner[b + 1] - inner[a + 1]) / (len || 1);
    // Normal pointing to the road side: -side * left(d) = -side * (dz, -dx).
    const nx = -side * dz;
    const nz = side * dx;
    gb.quad(inner[a], inner[a + 2], inner[a + 1], inner[b], inner[b + 2], inner[b + 1], inner[b], inner[b + 2] + y, inner[b + 1], inner[a], inner[a + 2] + y, inner[a + 1], nx, 0, nz, 0, 0, len / 2, y / 2);
    gb.quad(outer[a], outer[a + 2], outer[a + 1], outer[b], outer[b + 2], outer[b + 1], outer[b], outer[b + 2] + y, outer[b + 1], outer[a], outer[a + 2] + y, outer[a + 1], -nx, 0, -nz, 0, 0, len / 2, y / 2);
  }
  // End caps.
  for (const [i, sgn] of [[0, -1], [m - 1, 1]]) {
    const a = i * 3;
    const dx = run[Math.min(m - 1, i + 1)].x - run[Math.max(0, i - 1)].x;
    const dz = run[Math.min(m - 1, i + 1)].z - run[Math.max(0, i - 1)].z;
    const l = Math.hypot(dx, dz) || 1;
    gb.quad(inner[a], inner[a + 2], inner[a + 1], outer[a], outer[a + 2], outer[a + 1], outer[a], outer[a + 2] + y, outer[a + 1], inner[a], inner[a + 2] + y, inner[a + 1], (sgn * dx) / l, 0, (sgn * dz) / l, 0, 0, 1, y / 2);
  }
}

// Continuous line at lateral offset o (left of a->b), width w, between arc lengths s0..s1.
function strip(gb, pts, lens, s0, s1, o, w, heightAt) {
  const sub = slice(pts, lens, s0, s1);
  const nrm = polylineNormals(sub);
  ribbon(gb, sub, nrm, o - w / 2, o + w / 2, heightAt, 2, 0.01);
}

function dashes(gb, pts, lens, s0, s1, o, w, dash, gap, heightAt) {
  const period = dash + gap;
  const count = Math.floor((s1 - s0 + gap) / period);
  if (count < 1) return;
  const start = s0 + (s1 - s0 - (count * period - gap)) / 2;
  for (let k = 0; k < count; k++) {
    const a = start + k * period;
    strip(gb, pts, lens, a, a + dash, o, w, heightAt);
  }
}

function stopLine(gb, at, o0, o1, heightAt) {
  const nx = at.dz;
  const nz = -at.dx;
  const t = 0.25;
  const ax = at.x + nx * o0;
  const az = at.z + nz * o0;
  const bx = at.x + nx * o1;
  const bz = at.z + nz * o1;
  const y0 = heightAt(ax, az) + 0.01;
  const y1 = heightAt(bx, bz) + 0.01;
  gb.quad(ax - at.dx * t, y0, az - at.dz * t, bx - at.dx * t, y1, bz - at.dz * t, bx + at.dx * t, y1, bz + at.dz * t, ax + at.dx * t, y0, az + at.dz * t, 0, 1, 0, 0, 0, 1, 0.2);
}

