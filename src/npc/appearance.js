import * as STREETLIFE from '../data/streetlife.js';
import { BASIN_COLORS, LOAD_COLORS } from './humans.js';

// Who is on the pavement: archetypes (weights, speeds, hours) from PEDESTRIAN_STYLES, each dressed as one of
// the realistic variants (public/models/humans) of the right role and gender. A look carries the variant,
// a slight per-person scale and colour tint, a mirror flag (left/right swapped, for variety), the walking
// speed matched to the variant's stride (no foot sliding), and what the person carries.
//
// Gender comes first (it also picks the FLEURS voice, voices.js) and the variant always matches it.

const STYLES = STREETLIFE.PEDESTRIAN_STYLES || {};

const DEFAULT_ARCHETYPES = [
  { id: 'office_man', weight: 0.12, walkSpeed: [1.3, 1.6] },
  { id: 'office_woman', weight: 0.11, walkSpeed: [1.2, 1.5] },
  { id: 'casual_man', weight: 0.15, walkSpeed: [1.2, 1.6] },
  { id: 'casual_woman', weight: 0.13, walkSpeed: [1.1, 1.4] },
  { id: 'market_woman', weight: 0.08, walkSpeed: [0.9, 1.2], carryOnHeadChance: 0.6, babyOnBackChance: 0.3 },
  { id: 'youth', weight: 0.1, walkSpeed: [1.2, 1.7] },
  { id: 'school_kid', weight: 0.06, walkSpeed: [1.1, 1.8], hours: [6.5, 8, 13, 17] },
  { id: 'elder', weight: 0.05, walkSpeed: [0.7, 1.0] },
];
const ARCHETYPES = STYLES.archetypes?.length ? STYLES.archetypes : DEFAULT_ARCHETYPES;

// Archetype -> variants by gender (humans README). Roles without a variant of one gender are that gender only.
const VARIANTS = {
  office_man: { male: ['man_business_suit', 'man_business_suit', 'man_shirt_tie'] },
  office_woman: { female: ['woman_office_suit', 'woman_blouse_skirt'] },
  casual_man: { male: ['man_tshirt_jeans_cap', 'man_polo_chinos', 'man_polo_chinos', 'man_shirt_tie'] },
  casual_woman: { female: ['woman_dress_bright', 'woman_casual_tee', 'woman_jeans_top', 'woman_blouse_skirt'] },
  market_woman: { female: ['woman_zambia_wrap', 'woman_vendor_apron'] },
  youth: { male: ['man_hoodie', 'man_tshirt_jeans_cap'], female: ['woman_jeans_top', 'woman_casual_tee'] },
  hwindi: { male: ['man_hoodie', 'man_tshirt_jeans_cap'] },
  school_kid: { male: ['boy_primary_school', 'boy_high_school'], female: ['girl_primary_school', 'girl_high_school'] },
  elder: { male: ['man_elder_flatcap'], female: ['woman_elder'] },
  security_guard: { male: ['man_security_guard'] },
  police: { male: ['man_police_zrp'] },
  handcart_pusher: { male: ['man_overalls'] },
  car_washer: { male: ['man_overalls'] },
  street_preacher: { male: ['man_business_suit'] },
  apostolic: { male: ['man_apostolic'], female: ['woman_apostolic'] },
};
// Share of men where both genders exist.
const MALE_SHARE = { youth: 0.7, school_kid: 0.5, elder: 0.5, apostolic: 0.45 };
// Walking pace per role (m/s) where the research gives none: patrols are slow.
const PACE = { police: [0.8, 1.0], security_guard: [0.8, 1.0], street_preacher: [1.0, 1.2], apostolic: [0.9, 1.2], car_washer: [1.0, 1.3], hwindi: [1.2, 1.6] };
// Walk cadence the clips look natural at (playback rate range); the pace is clamped into it.
const RATE = [0.95, 1.45];
const FIRST_NAMES = STREETLIFE.NPC_FIRST_NAMES?.length ? STREETLIFE.NPC_FIRST_NAMES : [{ name: 'Tendai', g: 'u' }, { name: 'Chipo', g: 'f' }, { name: 'Simba', g: 'm' }];

let HUMANS = null;

// The loaded variants (humans.js) every look is dressed from.
export function useHumans(humans) {
  HUMANS = humans;
}

function inHours(a, hour) {
  if (!a.hours) return true;
  for (let i = 0; i + 1 < a.hours.length; i += 2) if (hour >= a.hours[i] && hour <= a.hours[i + 1]) return true;
  return false;
}

// Pick an archetype for a spawn context: {hour, nearRank, walking, group}.
export function pickArchetype(rng, ctx) {
  const list = ARCHETYPES.filter((a) => {
    if (!inHours(a, ctx.hour)) return false;
    if (a.nearRanks && !ctx.nearRank) return false;
    if (ctx.walking && (a.stationary ?? 0) >= 0.8) return false;
    if (a.groups && !ctx.group) return false;
    return true;
  });
  return rng.weighted(list.length ? list : DEFAULT_ARCHETYPES);
}

export function archetypeById(id) {
  return ARCHETYPES.find((a) => a.id === id) || { id };
}

// The walking clip a person uses: elders shuffle, market women steady a load on the head, uniforms and
// most suits walk upright (`formal`: a per-person roll, 0..1).
export function walkClipFor(variant, load, formal = 0) {
  if (load && variant.has('carry_on_head')) return 'carry_on_head';
  if (variant.roles.includes('elder') && variant.has('walk_slow')) return 'walk_slow';
  if (formal > 0.35 && variant.has('walk_formal')) return 'walk_formal';
  return variant.has('walk') ? 'walk' : 'walk_female';
}

// Build a complete look for an archetype id. opts: {gender, variant (id), school: 'primary'|'high', load: false}.
export function makeLook(rng, archetype, opts = {}) {
  const id = archetype.id || archetype;
  const table = VARIANTS[id] || (opts.gender === 'female' ? VARIANTS.casual_woman : VARIANTS.casual_man);
  let gender = opts.gender;
  if (!gender || !table[gender]) {
    if (table.male && table.female) gender = rng() < (MALE_SHARE[id] ?? 0.5) ? 'male' : 'female';
    else gender = table.male ? 'male' : 'female';
  }
  // A forced gender the role has no clothes for (a woman guard): dress her as a casual woman.
  const ids = table[gender] || (gender === 'male' ? VARIANTS.casual_man.male : VARIANTS.casual_woman.female);
  let vid = opts.variant || rng.pick(ids);
  if (id === 'school_kid' && opts.school) vid = ids.find((v) => v.includes(opts.school)) || vid;
  const variant = HUMANS?.byId.get(vid) || HUMANS?.variants.find((v) => v.gender === gender) || null;
  const scale = rng.range(0.96, 1.04);
  const warm = rng.range(-0.025, 0.025);
  const bright = rng.range(0.93, 1.05);
  const L = {
    archetype: id,
    gender,
    child: id === 'school_kid',
    variant,
    scale,
    height: (variant?.height ?? 1.7) * scale,
    tint: [bright * (1 + warm), bright, bright * (1 - warm)],
    mirror: rng() < 0.5,
    build: rng.range(-0.25, 0.45), // (voice rate seed)
    speed: 1.2,
    runSpeed: 0,
    walkMax: 1.5,
    walkClip: 'walk',
    stationary: rng() < (archetype.stationary || 0),
    load: false, // a basin of produce on the head (market women)
    basin: 0, // colour indices (humans.js palettes)
    produce: 0,
    name: '',
  };
  if (id === 'market_woman' && opts.load !== false && rng() < (archetype.carryOnHeadChance ?? 0.5)) {
    L.load = true;
    L.basin = rng.int(0, BASIN_COLORS.length - 1);
    L.produce = rng.int(0, LOAD_COLORS.length - 1);
  }
  if (variant) {
    // Stride-matched pace: ground speed = clip speed x stride x scale x rate, with the rate kept natural.
    L.walkClip = walkClipFor(variant, L.load, rng());
    const clip = HUMANS.clips[L.walkClip];
    const natural = (clip?.speed || 1.05) * variant.stride * scale;
    const [lo, hi] = PACE[id] || archetype.walkSpeed || [1.1, 1.5];
    L.speed = Math.min(natural * RATE[1], Math.max(natural * RATE[0], rng.range(lo, hi)));
    L.walkMax = natural * 1.6;
    if (variant.has('flee_run')) L.runSpeed = HUMANS.clips.flee_run.speed * variant.stride * scale * rng.range(0.72, 0.85);
  }
  const names = FIRST_NAMES.filter((n) => n.g === 'u' || n.g === (gender === 'male' ? 'm' : 'f'));
  L.name = rng.pick(names).name;
  return L;
}

// Vendors: mostly women at produce tables (apron or wax-print wrap and dhuku), young men with airtime,
// older men mending shoes.
export function vendorLook(rng, type) {
  const v = type.vendor || '';
  const woman = /woman|women/i.test(v) ? rng() < 0.85 : /man/i.test(v) ? rng() < 0.2 : rng() < 0.5;
  let look;
  if (woman) look = makeLook(rng, archetypeById('market_woman'), { gender: 'female', variant: rng() < 0.55 ? 'woman_vendor_apron' : 'woman_zambia_wrap', load: false });
  else if (/older/i.test(v) || type.type === 'shoe_mender') look = makeLook(rng, archetypeById(rng() < 0.6 ? 'elder' : 'handcart_pusher'), { gender: 'male' });
  else look = makeLook(rng, archetypeById(rng() < 0.6 ? 'youth' : 'casual_man'), { gender: 'male' });
  look.archetype = 'vendor';
  return look;
}
