import { polyArea } from '../core/geo.js';

// Vector map painter shared by the minimap (pre-rendered once) and the big map (redrawn on pan/zoom).
// Geometry is baked once into Path2D objects in world metres, bucketed into square tiles so a
// zoomed-in view only paints the few tiles it can see. Callers set the world -> pixel scale.

export const MAP_COLORS = {
  ground: '#1b4a89',
  outside: '#153c70',
  building: '#265999',
  landmark: '#3a70b8',
  casing: '#10325f',
  path: 'rgba(205, 225, 252, 0.5)',
  rail: 'rgba(205, 225, 252, 0.55)',
  label: '#f3f7ff',
  halo: 'rgba(10, 32, 66, 0.9)',
  player: '#ffffff',
  waypoint: '#f2c14e',
  rank: '#f2c14e',
  accent: '#d7263d',
};

const AREA_FILL = {
  park: '#2c8a74',
  grass: '#2a7f6f',
  golf: '#2a7f6f',
  pitch: '#2d8670',
  wood: '#277462',
  scrub: '#2a7466',
  school: '#21548f',
  hospital: '#21548f',
  parking: '#21548f',
  rank: 'rgba(242, 193, 78, 0.28)',
  platform: 'rgba(242, 193, 78, 0.22)',
};

// Road classes, drawn minor first. pave = extra metres of pavement drawn around the carriageway.
const ROAD_CLASSES = {
  service: { rank: 0, pave: 1, minPx: 0.9, color: '#8fb0de' },
  living_street: { rank: 1, pave: 2, minPx: 1.1, color: '#b4cdf0' },
  unclassified: { rank: 1, pave: 3, minPx: 1.2, color: '#b4cdf0' },
  residential: { rank: 2, pave: 3, minPx: 1.3, color: '#c3d8f4' },
  tertiary: { rank: 3, pave: 4, minPx: 1.7, color: '#d6e5f9' },
  secondary: { rank: 4, pave: 5, minPx: 2, color: '#e4eefc' },
  primary: { rank: 5, pave: 6, minPx: 2.3, color: '#f1f6ff' },
  trunk: { rank: 6, pave: 6, minPx: 2.5, color: '#f7faff' },
};

export const MAJOR_ROADS = new Set(['trunk', 'primary', 'secondary', 'tertiary']);

const TILE = 400;

export class MapPainter {
  constructor(data) {
    const b = data.meta.bounds;
    this.bounds = { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
    this.tiles = new Map();
    this.buckets = []; // road buckets {cls, w, style}, sorted in draw order
    this._buildRoadBuckets(data.roads);
    this._bake(data);
  }

  _tile(x, z) {
    const tx = Math.floor(x / TILE);
    const tz = Math.floor(z / TILE);
    const key = tx * 4096 + tz;
    let t = this.tiles.get(key);
    if (!t) {
      t = { tx, tz, areas: new Map(), buildings: new Path2D(), landmarks: new Path2D(), paths: new Path2D(), rail: new Path2D(), roads: [] };
      this.tiles.set(key, t);
    }
    return t;
  }

  _buildRoadBuckets(roads) {
    const index = new Map();
    for (const r of roads) {
      const key = bucketKey(r);
      if (!index.has(key)) index.set(key, { key, w: roadWidth(r), style: ROAD_CLASSES[r.cls] || ROAD_CLASSES.service });
    }
    this.buckets = [...index.values()].sort((a, b) => a.style.rank - b.style.rank || a.w - b.w);
    this._bucketIndex = new Map(this.buckets.map((bk, i) => [bk.key, i]));
  }

  _bake(data) {
    for (const a of data.areas || []) {
      if (!AREA_FILL[a.kind]) continue;
      const fp = a.pts;
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < fp.length; i += 2) {
        cx += fp[i];
        cz += fp[i + 1];
      }
      const n = fp.length / 2;
      const t = this._tile(cx / n, cz / n);
      if (!t.areas.has(a.kind)) t.areas.set(a.kind, new Path2D());
      addRing(t.areas.get(a.kind), fp);
    }

    for (const bld of data.buildings) {
      if (polyArea(bld.fp) < 12) continue;
      const fp = bld.fp;
      const t = this._tile(bld.cx ?? fp[0], bld.cz ?? fp[1]);
      const path = bld.lm ? t.landmarks : t.buildings;
      addRing(path, fp);
      for (const h of bld.holes || []) addRing(path, h);
    }

    for (const r of data.roads) {
      const bi = this._bucketIndex.get(bucketKey(r));
      this._addLine(r.pts, (t) => (t.roads[bi] ||= new Path2D()));
    }
    for (const p of data.paths || []) this._addLine(p.pts, (t) => t.paths);
    for (const r of data.rail || []) this._addLine(r.pts, (t) => t.rail, 300);
  }

  // Splits a polyline over the tiles its segment midpoints fall in. Continuous runs inside one tile
  // stay one sub-path; round caps hide the joins between tiles.
  _addLine(pts, pathOf, clipMargin = Infinity) {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    let current = null;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i];
      const az = pts[i + 1];
      const bx = pts[i + 2];
      const bz = pts[i + 3];
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      if (mx < minX - clipMargin || mx > maxX + clipMargin || mz < minZ - clipMargin || mz > maxZ + clipMargin) {
        current = null;
        continue;
      }
      const path = pathOf(this._tile(mx, mz));
      if (path !== current) {
        path.moveTo(ax, az);
        current = path;
      }
      path.lineTo(bx, bz);
    }
  }

  // Paint everything intersecting the world rectangle `view` (metres). The context must already map
  // world metres to device pixels with uniform scale `s` (px per metre): ctx.setTransform(s,0,0,s,tx,ty).
  paint(ctx, s, view) {
    const margin = 120;
    const tiles = [];
    for (const t of this.tiles.values()) {
      const x0 = t.tx * TILE;
      const z0 = t.tz * TILE;
      if (x0 > view.maxX + margin || x0 + TILE < view.minX - margin) continue;
      if (z0 > view.maxZ + margin || z0 + TILE < view.minZ - margin) continue;
      tiles.push(t);
    }

    for (const [kind, color] of Object.entries(AREA_FILL)) {
      ctx.fillStyle = color;
      for (const t of tiles) {
        const p = t.areas.get(kind);
        if (p) ctx.fill(p);
      }
    }
    ctx.fillStyle = MAP_COLORS.building;
    for (const t of tiles) ctx.fill(t.buildings);
    ctx.fillStyle = MAP_COLORS.landmark;
    for (const t of tiles) ctx.fill(t.landmarks);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = MAP_COLORS.path;
    ctx.lineWidth = Math.max(2, 1 / s);
    for (const t of tiles) ctx.stroke(t.paths);

    ctx.strokeStyle = MAP_COLORS.rail;
    ctx.lineWidth = Math.max(2.5, 1.4 / s);
    ctx.setLineDash([6, 5].map((v) => Math.max(v, (v * 0.6) / s)));
    for (const t of tiles) ctx.stroke(t.rail);
    ctx.setLineDash([]);

    // Casings first (all classes), then fills minor -> major so junctions read cleanly.
    ctx.strokeStyle = MAP_COLORS.casing;
    this.buckets.forEach((bk, i) => {
      ctx.lineWidth = Math.max(bk.w + bk.style.pave + 2.5, (bk.style.minPx + 1.5) / s);
      for (const t of tiles) if (t.roads[i]) ctx.stroke(t.roads[i]);
    });
    this.buckets.forEach((bk, i) => {
      ctx.strokeStyle = bk.style.color;
      ctx.lineWidth = Math.max(bk.w + bk.style.pave, bk.style.minPx / s);
      for (const t of tiles) if (t.roads[i]) ctx.stroke(t.roads[i]);
    });
  }

  // Pre-render the whole map at `scale` px/m. Returns {canvas, scale, x0, z0} where pixel (0,0) is
  // world (x0, z0).
  renderImage(scale) {
    const pad = 150;
    const x0 = this.bounds.minX - pad;
    const z0 = this.bounds.minZ - pad;
    const w = Math.ceil((this.bounds.maxX + pad - x0) * scale);
    const h = Math.ceil((this.bounds.maxZ + pad - z0) * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = MAP_COLORS.ground;
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -z0 * scale);
    this.paint(ctx, scale, { minX: x0, maxX: x0 + w / scale, minZ: z0, maxZ: z0 + h / scale });
    return { canvas, scale, x0, z0 };
  }
}

// Half-resolution copy of a pre-rendered map (a mip level for zoomed-out, rotating views).
export function halfImage(img) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(img.canvas.width / 2);
  canvas.height = Math.ceil(img.canvas.height / 2);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img.canvas, 0, 0, canvas.width, canvas.height);
  return { canvas, scale: img.scale / 2, x0: img.x0, z0: img.z0 };
}

// Roads are grouped by class and carriageway width (rounded to 2 m) so each group is one stroke.
function roadWidth(r) {
  return Math.max(3, Math.round(r.w / 2) * 2);
}

function bucketKey(r) {
  return `${r.cls}|${roadWidth(r)}`;
}

function addRing(path, fp) {
  path.moveTo(fp[0], fp[1]);
  for (let i = 2; i < fp.length; i += 2) path.lineTo(fp[i], fp[i + 1]);
  path.closePath();
}
