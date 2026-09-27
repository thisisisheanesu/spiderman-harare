import * as STREETLIFE from '../data/streetlife.js';
import { lonLatToXZ } from '../core/geo.js';

// Kombi ranks: the mapped ones (data.ranks and bus stops, near-duplicates merged) plus researched
// ranks the map lacks (KOMBI_RANKS, e.g. Rezende), each with its research record (destinations,
// vendor types).

const RESEARCH = STREETLIFE.KOMBI_RANKS || [];

function researchFor(name) {
  const key = name.toLowerCase();
  return RESEARCH.find((r) => [r.name, ...(r.altNames || [])].some((n) => key.includes(n.toLowerCase().split(' ')[0])));
}

export function rankSites(data) {
  const out = [];
  const stops = (data.features || []).filter((f) => f.kind === 'bus_stop').map((f) => ({ name: f.name || 'Bus stop', x: f.x, z: f.z, kind: 'bus_stop' }));
  for (const rk of [...(data.ranks || []), ...stops]) {
    if (out.some((o) => Math.hypot(o.x - rk.x, o.z - rk.z) < 40)) continue;
    out.push({ name: rk.name, x: rk.x, z: rk.z, kind: rk.kind, info: researchFor(rk.name) });
  }
  for (const r of RESEARCH) {
    if (r.lat === undefined) continue;
    const p = lonLatToXZ(r.lon, r.lat);
    if (out.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 150)) continue;
    out.push({ name: r.name, x: p.x, z: p.z, kind: 'bus_station', info: r });
  }
  return out;
}
