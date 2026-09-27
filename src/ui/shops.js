// Named businesses of central Harare for the HUD: the street-level location label ("outside OK
// Supermarket"), business names on the big map and its search. Read from public/data/shops.json
// (Overture Maps places + OpenStreetMap, placed on the building facades; `verified: 'web'` = location
// checked against a web source, see public/data/CREDITS-shops.md) through the shared asset cache, so
// the city's sign builder and the HUD download it once. Everything here works (empty) until it loads.
//
//   signs        [{name, x, z, road, cat, web, brand, floor, color}]  one per sign (corner sites have two)
//   places       the same merged per business (same name within MERGE m), best first: web-verified,
//                then chains, then the rest; each has `rank` (0 best) for decluttering
//   nearest(x, z, r)   the street-level sign (ground / first floor) best placed within r m, or null
//   version      bumps when the data arrives (the big map redraws)

const SHOPS_URL = 'data/shops.json';
const CELL = 40; // m, grid cell for nearest()
const MERGE = 60; // m: signs of one business closer than this are one map label
export const STREET_FLOORS = 1; // signs up to this floor count as "outside" at street level

export class ShopIndex {
  constructor(game) {
    this.signs = [];
    this.places = [];
    this.grid = new Map();
    this.version = 0;
    const load = game.assets?.json
      ? game.assets.json(SHOPS_URL)
      : fetch(SHOPS_URL)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
    this.ready = Promise.resolve(load)
      .then((data) => this._build(data))
      .catch((err) => console.warn('[hud] shops.json unavailable', err));
  }

  _build(data) {
    if (!Array.isArray(data?.shops)) return;
    const styles = data.styles || {};
    for (const s of data.shops) {
      if (!s?.name || !Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
      const style = styles[s.style] || {};
      const sign = {
        name: s.name.trim(),
        x: s.x,
        z: s.z,
        road: s.road || '',
        cat: s.cat || '',
        web: s.verified === 'web',
        brand: !!s.brand,
        floor: s.floor || 0,
        color: /^#[0-9a-f]{6}$/i.test(style.bg || '') ? style.bg : '#cfd8e6',
      };
      this.signs.push(sign);
      if (sign.floor <= STREET_FLOORS) {
        const key = cellKey(Math.floor(sign.x / CELL), Math.floor(sign.z / CELL));
        let cell = this.grid.get(key);
        if (!cell) this.grid.set(key, (cell = []));
        cell.push(sign);
      }
    }
    this._merge();
    this.version++;
  }

  // One map entry per business: signs with the same name within MERGE m share a label at their
  // average position (the verified / street-level sign's position wins when there is one).
  _merge() {
    const byName = new Map();
    for (const s of this.signs) {
      const key = s.name.toLowerCase();
      let group = byName.get(key);
      if (!group) byName.set(key, (group = []));
      let place = group.find((p) => Math.hypot(p.x - s.x, p.z - s.z) < MERGE);
      if (!place) {
        place = { name: s.name, x: s.x, z: s.z, road: s.road, cat: s.cat, web: false, brand: s.brand, floor: s.floor, color: s.color, n: 0, sx: 0, sz: 0 };
        group.push(place);
      }
      place.n++;
      place.sx += s.x;
      place.sz += s.z;
      place.x = place.sx / place.n;
      place.z = place.sz / place.n;
      place.web ||= s.web;
      place.floor = Math.min(place.floor, s.floor);
      if (!place.road) place.road = s.road;
    }
    const list = [];
    for (const group of byName.values()) list.push(...group);
    for (const p of list) {
      p.rank = p.web ? 0 : p.brand ? 1 : p.floor <= STREET_FLOORS ? 2 : 3;
      delete p.sx;
      delete p.sz;
      delete p.n;
    }
    list.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length);
    this.places = list;
  }

  // Street-level sign nearest (x, z) within r m; verified and branded shops win small ties.
  nearest(x, z, r) {
    if (!this.grid.size) return null;
    const c0 = Math.floor((x - r) / CELL);
    const c1 = Math.floor((x + r) / CELL);
    const r0 = Math.floor((z - r) / CELL);
    const r1 = Math.floor((z + r) / CELL);
    let best = null;
    let bestScore = Infinity;
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = r0; cz <= r1; cz++) {
        const cell = this.grid.get(cellKey(cx, cz));
        if (!cell) continue;
        for (const s of cell) {
          const d = Math.hypot(s.x - x, s.z - z);
          if (d > r) continue;
          const score = d - (s.web ? 5 : 0) - (s.brand ? 2.5 : 0);
          if (score < bestScore) {
            bestScore = score;
            best = s;
          }
        }
      }
    }
    return best;
  }
}

function cellKey(cx, cz) {
  return (cx + 32768) * 65536 + (cz + 32768);
}
