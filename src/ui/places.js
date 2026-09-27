import { lonLatToXZ, polyArea, polyCentroid, pointInPoly } from '../core/geo.js';

// Named places for the compass, minimap, big map and location label: landmarks, parks, kombi ranks.
//
// Sources, in priority order (duplicates — same key, same name or within 60 m — are merged):
//   1. landmark buildings in the map (buildings[].lm, described by meta.landmarks)
//   2. researched places baked into the map (features[] with a key)
//   3. tools/landmark_overrides.json itself (read at build time, so markers work before the map is rebuilt)
//   4. named parks, the railway station and a few well-known buildings found by name in the map data
// Landmark records carry `label: true|false` (false = podium / annex parts that get no marker).
//
// Place: {key, name, x, z, kind: 'landmark'|'park'|'place', distant} (distant = outside the map: compass only)
// Rank:  {name, label, x, z}

const OVERRIDES =
  Object.values(import.meta.glob('/tools/landmark_overrides.json', { eager: true, import: 'default' }))[0] || {};

// Well-known buildings looked up by name when the landmark research has not covered them.
const KNOWN_BUILDINGS = [
  ['Reserve Bank', /^reserve bank of zimbabwe$/i],
  ['Parliament', /^parliament of zimbabwe$/i],
  ['National Gallery', /^national gallery of zimbabwe$/i],
  ['Eastgate', /^eastgate shopping mall$/i],
  ['Town House', /^harare town house$/i],
  ['Joina City', /^joina city/i],
  ['Meikles Hotel', /meikles$/i],
  ['Karigamombe Centre', /^karigamombe centre$/i],
  ['Old Mutual Centre', /^old mutual centre$/i],
  ['Main Post Office', /^main post office$/i],
];

const PLACE_KIND = { park: 'park', square: 'park', garden: 'park' };
const AREA_KINDS = new Set(['park', 'golf', 'rank', 'platform', 'school', 'hospital']);
const MERGE_DIST = 60;
const RANK_MERGE_DIST = 80;
const DISTANT_MARGIN = 300; // m outside the map bounds

// "Meikles Hotel (Hyatt Regency Harare The Meikles)" -> "Meikles Hotel"
const shortName = (name) => name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
const shortRankName = (name) => shortName(name).replace(/\s+(taxi rank|bus terminus|terminus|bus station|rank)$/i, '');
const norm = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export class Places {
  constructor(data) {
    this.list = [];
    this.ranks = [];
    this.areas = [];
    this.bounds = data.meta.bounds;
    const meta = new Map((data.meta.landmarks || []).map((m) => [m.key, m]));

    this._addLandmarkBuildings(data, meta);
    for (const f of data.features || []) {
      if (f.key && f.name) this._addResearched(f.key, f.name, f.kind, f.x, f.z);
    }
    for (const lm of OVERRIDES.landmarks || []) {
      const m = lm.match || {};
      if (lm.label === false || m.lat === undefined || m.lon === undefined || !lm.name) continue;
      const { x, z } = lonLatToXZ(m.lon, m.lat);
      this._add({ key: lm.key, name: shortName(lm.name), x, z, kind: 'landmark' });
    }
    for (const pl of OVERRIDES.places || []) {
      if (pl.lat === undefined || pl.lon === undefined || !pl.name) continue;
      const { x, z } = lonLatToXZ(pl.lon, pl.lat);
      this._addResearched(pl.key, pl.name, pl.type, x, z);
    }
    this._addAreas(data);
    for (const f of data.features || []) {
      if (f.kind === 'railway_station') this._add({ key: 'station', name: 'Harare Railway Station', x: f.x, z: f.z, kind: 'landmark' });
    }
    this._addKnownBuildings(data);
    for (const r of data.ranks || []) this._addRank(r.name, r.x, r.z);
  }

  _add(p) {
    const n = norm(p.name);
    for (const q of this.list) {
      if ((p.key && q.key === p.key) || norm(q.name) === n || Math.hypot(q.x - p.x, q.z - p.z) < MERGE_DIST) return;
    }
    const b = this.bounds;
    const m = DISTANT_MARGIN;
    const distant = p.x < b.minX - m || p.x > b.maxX + m || p.z < b.minZ - m || p.z > b.maxZ + m;
    this.list.push({ ...p, distant });
  }

  // Researched place of any type: ranks join the rank list, parks / squares are green.
  _addResearched(key, name, type, x, z) {
    if (type === 'rank') this._addRank(name, x, z);
    else this._add({ key, name: shortName(name), x, z, kind: PLACE_KIND[type] || 'landmark' });
  }

  _addRank(name, x, z) {
    if (this.ranks.some((q) => Math.hypot(q.x - x, q.z - z) < RANK_MERGE_DIST)) return;
    this.ranks.push({ name: shortName(name), label: shortRankName(name), x, z });
  }

  _addLandmarkBuildings(data, meta) {
    const byKey = new Map();
    for (const b of data.buildings) {
      if (!b.lm) continue;
      const area = polyArea(b.fp);
      const best = byKey.get(b.lm);
      if (!best || area > best.area) byKey.set(b.lm, { b, area });
    }
    for (const [key, { b }] of byKey) {
      const m = meta.get(key) || {};
      if (m.label === false) continue;
      const c = b.cx !== undefined ? { x: b.cx, z: b.cz } : polyCentroid(b.fp);
      this._add({ key, name: shortName(m.name || b.name || key), x: c.x, z: c.z, kind: 'landmark' });
    }
  }

  _addAreas(data) {
    for (const a of data.areas || []) {
      if (!a.name || !AREA_KINDS.has(a.kind)) continue;
      const fp = a.pts;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < fp.length; i += 2) {
        minX = Math.min(minX, fp[i]);
        maxX = Math.max(maxX, fp[i]);
        minZ = Math.min(minZ, fp[i + 1]);
        maxZ = Math.max(maxZ, fp[i + 1]);
      }
      this.areas.push({ name: a.name, kind: a.kind, fp, minX, maxX, minZ, maxZ });
      if (a.kind === 'park') {
        const c = polyCentroid(fp);
        this._add({ key: `park:${a.name}`, name: a.name, x: c.x, z: c.z, kind: 'park' });
      }
    }
  }

  _addKnownBuildings(data) {
    const named = data.buildings.filter((b) => b.name);
    for (const [name, re] of KNOWN_BUILDINGS) {
      let best = null;
      for (const b of named) {
        if (re.test(b.name) && (!best || b.h > best.h)) best = b;
      }
      if (!best) continue;
      const c = best.cx !== undefined ? { x: best.cx, z: best.cz } : polyCentroid(best.fp);
      this._add({ name, x: c.x, z: c.z, kind: 'landmark' });
    }
  }

  // Display name of a building: its landmark's place name, else its mapped name ('' if none).
  nameOf(b) {
    if (b.lm) {
      const p = this.list.find((q) => q.key === b.lm);
      if (p) return p.name;
    }
    return b.name ? shortName(b.name) : '';
  }

  // Nearest on-map place within maxDist (m), or null.
  nearest(x, z, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const p of this.list) {
      if (p.distant) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  // Name of the named park / rank / school / hospital area containing the point, or ''.
  areaAt(x, z) {
    for (const a of this.areas) {
      if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) continue;
      if (pointInPoly(x, z, a.fp)) return a.name;
    }
    return '';
  }
}
