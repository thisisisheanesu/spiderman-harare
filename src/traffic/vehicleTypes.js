import { VEHICLE_TYPES, TRAFFIC, HWINDI_CALLS } from '../data/streetlife.js';

// Traffic mix and driver temperament, from the researched VEHICLE_TYPES (src/data/streetlife.js) with
// built-in fallbacks. Each entry maps a type onto a procedural model and IDM driving parameters.

const kmh = (v) => v / 3.6;

const FALLBACK_TYPES = [
  { type: 'kombi', weight: 0.2, maxSpeed: kmh(70), accel: 2.4, brakeDecel: 6, aggression: 0.85, colors: ['#efeee8'], roofRackChance: 0.12 },
  { type: 'hatch', weight: 0.3, maxSpeed: kmh(65), accel: 2.2, brakeDecel: 6.5, aggression: 0.45, colors: ['#eeeeea', '#b7bbbf', '#16181b', '#a3171c'] },
  { type: 'sedan', weight: 0.15, maxSpeed: kmh(70), accel: 2.0, brakeDecel: 6.5, aggression: 0.4, colors: ['#eeeeea', '#b7bbbf', '#4a4f55'] },
  { type: 'pickup', weight: 0.12, maxSpeed: kmh(70), accel: 1.8, brakeDecel: 6, aggression: 0.55, colors: ['#eeeeea', '#b7bbbf'] },
  { type: 'suv', weight: 0.08, maxSpeed: kmh(70), accel: 2.0, brakeDecel: 6, aggression: 0.6, colors: ['#16181b', '#eeeeea'] },
  { type: 'bus', weight: 0.03, maxSpeed: kmh(60), accel: 1.0, brakeDecel: 4, aggression: 0.35, colors: ['#f3f3f0'] },
];

const MODEL = {
  kombi: (rng, def) => (rng() < (def.roofRackChance ?? 0.12) ? 'kombiRack' : 'kombi'),
  hatch: () => 'hatch',
  mushikashika: () => 'hatch',
  sedan: (rng, def, sub) => (sub?.id === 'german_exec' ? 'merc' : 'sedan'),
  wagon: () => 'wagon',
  pickup: (rng, def, sub) => (sub && sub.id !== 'double_cab' ? 'bakkie' : 'pickup'),
  suv: () => 'suv',
  taxi: () => 'taxi',
  bus: () => 'bus',
  truck: () => 'truck',
};

// Vehicles that pull over at ranks and kerbs to load.
const STOPPERS = { kombi: 0.2, mushikashika: 0.12, bus: 0.1 };
const WILD = new Set(['kombi', 'mushikashika']);
const CARGO = ['#cdb88c', '#ece8dc', '#c8b27c', '#6f8f4f', '#9c7a52'];
const SHIRTS = ['#c0392b', '#1f5fa8', '#e2b019', '#2e7d4f', '#ececec', '#222222', '#7b3fa0', '#d9661f'];
const TROUSERS = ['#20242c', '#2d3a55', '#4a3c2c', '#1b1b1b'];

export class TrafficMix {
  constructor(atlas) {
    this.atlas = atlas;
    const src = Array.isArray(VEHICLE_TYPES) && VEHICLE_TYPES.length ? VEHICLE_TYPES : FALLBACK_TYPES;
    this.types = src.filter((t) => MODEL[t.type] && (t.weight ?? 0) > 0);
    const behaviour = TRAFFIC?.behaviour || {};
    this.runRed = new Map();
    for (const t of this.types) {
      const b = behaviour[t.type] || (t.type === 'bus' ? behaviour.bus : behaviour.private) || {};
      this.runRed.set(t.type, b.runRedChance ?? (WILD.has(t.type) ? 0.35 : 0.05));
    }
    this.calls = Array.isArray(HWINDI_CALLS) && HWINDI_CALLS.length ? HWINDI_CALLS : [{ text: 'Town! Town! Town!', en: 'To the city centre!', kind: 'dest' }];
    this.destCalls = this.calls.filter((c) => c.kind === 'dest');
    if (!this.destCalls.length) this.destCalls = this.calls;
  }

  pickType(rng, kombiBoost = 1) {
    let total = 0;
    for (const t of this.types) total += t.weight * (t.type === 'kombi' ? kombiBoost : 1);
    let r = rng() * total;
    for (const t of this.types) {
      r -= t.weight * (t.type === 'kombi' ? kombiBoost : 1);
      if (r <= 0) return t;
    }
    return this.types[0];
  }

  // Fills a Vehicle's look and temperament for the given type definition.
  dress(v, def, rng, models) {
    const sub = def.subtypes ? rng.weighted(def.subtypes) : null;
    const modelKey = MODEL[def.type](rng, def, sub);
    const model = models[modelKey];
    v.type = def.type;
    v.def = def;
    v.modelKey = modelKey;
    v.model = model;
    v.length = model.length;
    v.width = model.width;
    v.height = model.height;
    const wf = model.wheels[0];
    const wr = model.wheels[1];
    v.frontAxle = v.length / 2 - wf.u;
    v.wheelbase = wf.u - wr.u;

    const aggr = def.aggression ?? 0.5;
    v.wild = WILD.has(def.type);
    v.a = (def.accel ?? 2) * rng.range(0.85, 1.1);
    v.b = Math.min(3.2, (def.brakeDecel ?? 6) * 0.5);
    v.T = Math.max(0.7, 1.7 - aggr * 1.0 + rng.range(-0.15, 0.15));
    v.s0 = Math.max(1.0, 2.6 - aggr * 1.6);
    v.maxSpeed = def.maxSpeed ?? kmh(65);
    v.speedFactor = v.wild ? rng.range(1.0, 1.2) : rng.range(0.82, 1.05);
    // Per junction approach; the researched figure is per red light a driver meets, most of which
    // they reach mid-phase with the box occupied, so only a fraction turns into an attempt here.
    v.runRedChance = (this.runRed.get(def.type) ?? 0.05) * 0.3;
    v.stopChance = STOPPERS[def.type] ?? 0;

    const colors = sub?.colors || def.colors || ['#eeeeea'];
    v.color.set(rng.pick(colors));
    v.color2.copy(v.color);
    let rowA = this.atlas.row('none');
    let rowB = this.atlas.row('none');
    if (def.type === 'kombi') {
      const liv = def.liveries?.length ? rng.weighted(def.liveries) : { id: 'plain_white', body: '#efeee8' };
      v.color.set(Array.isArray(liv.body) ? rng.pick(liv.body) : liv.body || '#efeee8');
      v.color2.copy(v.color);
      if (liv.id === 'zupco_franchise') {
        v.color2.set('#1c3f94');
        rowA = this.atlas.row('ZUPCO');
      } else if (Array.isArray(liv.stripe)) v.color2.set(rng.pick(liv.stripe));
      else if (liv.lower) v.color2.set(liv.lower);
      if (liv.banner || liv.id === 'slogan_banner') rowA = rng.pick(this.atlas.slogans);
      const dirt = liv.dirt ?? 0.4;
      v.color.multiplyScalar(1 - dirt * 0.12);
      v.hwindi = rng() < 0.8;
      v.call = rng.pick(this.destCalls);
    } else if (def.type === 'bus') {
      const liv = def.liveries?.length ? rng.weighted(def.liveries) : { body: '#f3f3f0', stripe: '#1c3f94' };
      v.color.set(liv.body || '#f3f3f0');
      v.color2.set(liv.stripe || '#1c3f94');
      rowA = this.atlas.row('ZUPCO');
      rowB = rng.pick(this.atlas.destinations);
    } else if (def.type === 'taxi') {
      rowA = this.atlas.row('TAXI');
    } else if (def.type === 'truck') {
      v.color2.set(rng.pick(def.bodyColors || ['#e8e8e2']));
    } else if (modelKey === 'bakkie') {
      v.color2.set(rng.pick(CARGO));
    }
    v.rows = rowA + 64 * rowB;
    if (v.hwindi) {
      v.hwindiShirt.set(rng.pick(SHIRTS));
      v.hwindiTrousers.set(rng.pick(TROUSERS));
    }
  }
}
