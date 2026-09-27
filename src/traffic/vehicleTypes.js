import { VEHICLE_TYPES, TRAFFIC, HWINDI_CALLS } from '../data/streetlife.js';

// Traffic mix and driver temperament, from the researched VEHICLE_TYPES (src/data/streetlife.js) with
// built-in fallbacks. Each entry maps a type onto one of the realistic models (vehicleAssets.js), picks
// its paint and toggle variants (kombi liveries, banners, route cards, roof racks; bus stripes and
// destination; Hilux cargo) and its IDM driving parameters.

const kmh = (v) => v / 3.6;

const FALLBACK_TYPES = [
  { type: 'kombi', weight: 0.2, maxSpeed: kmh(70), accel: 2.4, brakeDecel: 6, aggression: 0.85, colors: ['#efeee8'], roofRackChance: 0.12 },
  { type: 'hatch', weight: 0.3, maxSpeed: kmh(65), accel: 2.2, brakeDecel: 6.5, aggression: 0.45, colors: ['#eeeeea', '#b7bbbf', '#16181b', '#a3171c'] },
  { type: 'sedan', weight: 0.15, maxSpeed: kmh(70), accel: 2.0, brakeDecel: 6.5, aggression: 0.4, colors: ['#eeeeea', '#b7bbbf', '#4a4f55'] },
  { type: 'pickup', weight: 0.12, maxSpeed: kmh(70), accel: 1.8, brakeDecel: 6, aggression: 0.55, colors: ['#eeeeea', '#b7bbbf'] },
  { type: 'suv', weight: 0.08, maxSpeed: kmh(70), accel: 2.0, brakeDecel: 6, aggression: 0.6, colors: ['#16181b', '#eeeeea'] },
  { type: 'bus', weight: 0.03, maxSpeed: kmh(60), accel: 1.0, brakeDecel: 4, aggression: 0.35, colors: ['#f3f3f0'] },
];

// streetlife type (and subtype) -> model in public/models/vehicles.
const MODEL = {
  kombi: () => 'kombi',
  hatch: () => 'hatch_fit',
  mushikashika: () => 'hatch_fit',
  sedan: (sub) => (sub?.id === 'german_exec' ? 'sedan_mercedes' : 'sedan_corolla'),
  wagon: () => 'wagon_wish',
  pickup: () => 'pickup_hilux',
  suv: () => 'suv_landcruiser',
  taxi: () => 'taxi',
  police: () => 'police_landcruiser',
  bus: () => 'bus_zupco',
  truck: () => 'truck_isuzu',
};

// Kombi route cards in the model (route_0..7) and the destinations they read.
const ROUTE_CARDS = [
  ['mbare'],
  ['chitown', 'chitungwiza', 'zengeza', 'seke'],
  ['town'],
  ['glen view'],
  ['warren'],
  ['kuwadzana'],
  ['budiriro', 'budiro'],
  ['highfield', 'machipisa'],
];

// Vehicles that pull over at ranks and kerbs to load.
const STOPPERS = { kombi: 0.2, mushikashika: 0.12, bus: 0.1 };
const WILD = new Set(['kombi', 'mushikashika']);

export function routeCardFor(call) {
  const t = (call?.text || '').toLowerCase();
  for (let i = 0; i < ROUTE_CARDS.length; i++) if (ROUTE_CARDS[i].some((w) => t.includes(w))) return i;
  return -1;
}

export class TrafficMix {
  constructor() {
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

  // Only the types whose model loaded take part.
  setModels(models) {
    this.types = this.types.filter((t) => models[MODEL[t.type]()]);
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

  // Fills a Vehicle's look (model, paint, toggles, crew) and temperament for the type definition.
  dress(v, def, rng, models) {
    const sub = def.subtypes ? rng.weighted(def.subtypes) : null;
    const model = models[MODEL[def.type](sub)];
    v.type = def.type;
    v.def = def;
    v.sub = sub?.id || null;
    v.model = model;
    v.length = model.length;
    v.width = model.width;
    v.height = model.height;
    v.frontAxle = model.frontAxle;
    v.wheelbase = model.wheelbase;

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

    const toggles = [];
    const groups = model.toggleGroups || {};
    const pickOf = (group) => (groups[group]?.length ? rng.pick(groups[group]) : null);
    const colors = sub?.colors || def.colors || model.paints;
    v.color.set(rng.pick(colors));
    v.hwindi = false;
    v.siren = false;
    if (def.type === 'kombi') {
      const liv = def.liveries?.length ? rng.weighted(def.liveries) : { id: 'plain_white', body: '#efeee8' };
      v.livery = liv.id;
      v.color.set(Array.isArray(liv.body) ? rng.pick(liv.body) : liv.body || '#efeee8');
      if (liv.id === 'zupco_franchise' && groups.livery_zupco) toggles.push(groups.livery_zupco[0]);
      else if (liv.id === 'factory_stripes' && groups.livery_stripe) toggles.push(groups.livery_stripe[0]);
      // Slogan banners on the slogan liveries, and on a good share of the rest too.
      if ((liv.banner || liv.id === 'slogan_banner' || rng() < 0.3) && groups.banner) toggles.push(rng.pick(groups.banner));
      if (rng() < (def.roofRackChance ?? 0.12) && groups.roof_rack) toggles.push(groups.roof_rack[0]);
      const dirt = liv.dirt ?? 0.4;
      v.color.multiplyScalar(1 - dirt * 0.12);
      v.hwindi = rng() < 0.8;
      v.call = rng.pick(this.destCalls);
      v.routeGroup = groups.route || null;
      v.routeCall = null;
      this.routeCard(v, rng);
    } else if (def.type === 'bus') {
      const liv = def.liveries?.length ? rng.weighted(def.liveries) : { id: 'zupco_white_blue', body: '#f3f3f0' };
      v.color.set(liv.body || '#f3f3f0');
      if (liv.id !== 'zupco_white_plain' && groups.livery_stripes) toggles.push(groups.livery_stripes[0]);
      const dest = pickOf('dest');
      if (dest) toggles.push(dest);
    } else if (def.type === 'taxi') {
      // Harare cabs: mostly the yellow livery, some white / silver.
      v.color.set(rng() < 0.6 ? model.paints[0] : rng.pick(model.paints));
    } else if (def.type === 'police') {
      v.color.set(model.paints[0]);
      v.siren = rng() < 0.5;
    } else if (def.type === 'pickup') {
      if (v.sub === 'single_cab_load' && groups.cargo) toggles.push(groups.cargo[0]);
      else if (rng() < 0.3 && groups.sports_bar) toggles.push(groups.sports_bar[0]);
    }
    v.toggles = toggles;

    // Who is on board (indices into the baked figure variants; -1 = nobody).
    const busy = def.type === 'kombi' || def.type === 'bus';
    v.crew = {
      driver: Math.floor(rng() * 64),
      mate: !busy && rng() < 0.35 ? Math.floor(rng() * 64) : -1,
      passengers: busy && rng() < 0.9 ? Math.floor(rng() * 64) : -1,
    };
  }

  // The kombi's yellow route card follows its destination call (which kombi.js may later replace with
  // a recorded one); unknown destinations keep a random card.
  routeCard(v, rng = Math.random) {
    if (!v.routeGroup || v.routeCall === v.call) return;
    v.routeCall = v.call;
    const i = routeCardFor(v.call);
    const card = i >= 0 ? v.routeGroup.find((n) => n.endsWith(`_${i}`)) : null;
    const next = card || v.routeGroup[Math.floor(rng() * v.routeGroup.length)];
    const k = v.toggles.findIndex((n) => v.routeGroup.includes(n));
    if (k >= 0) v.toggles[k] = next;
    else v.toggles.push(next);
  }
}
