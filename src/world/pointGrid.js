// Static spatial hash over point-like items ({x, z} plus an optional radius r), built once at load.
// near() writes into one reused array, so per-frame queries allocate nothing.
export class PointGrid {
  constructor(items, cell = 32) {
    this.cell = cell;
    this.items = items;
    this.cells = new Map();
    this.maxR = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const k = this._key(Math.floor(it.x / cell), Math.floor(it.z / cell));
      let arr = this.cells.get(k);
      if (!arr) this.cells.set(k, (arr = []));
      arr.push(it);
      if (it.r > this.maxR) this.maxR = it.r;
    }
    this._out = [];
  }

  _key(gx, gz) {
    return gx * 73856093 + gz;
  }

  // Items within r of (x, z); an item with a radius counts when its circle reaches the query
  // circle. Returns a shared array that the next call overwrites (copy what you keep).
  near(x, z, r) {
    const out = this._out;
    out.length = 0;
    const c = this.cell;
    const reach = r + this.maxR;
    const gx1 = Math.floor((x + reach) / c);
    const gz0 = Math.floor((z - reach) / c);
    const gz1 = Math.floor((z + reach) / c);
    for (let gx = Math.floor((x - reach) / c); gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const arr = this.cells.get(this._key(gx, gz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const it = arr[i];
          const dx = it.x - x;
          const dz = it.z - z;
          const rr = r + (it.r || 0);
          if (dx * dx + dz * dz <= rr * rr) out.push(it);
        }
      }
    }
    return out;
  }
}
