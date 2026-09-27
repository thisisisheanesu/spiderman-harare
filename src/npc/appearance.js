import * as STREETLIFE from '../data/streetlife.js';
import { FLAG, PATTERN_SHIFT } from './bodies.js';

// Who is on the pavement: archetypes (weights, speeds, hours) from PEDESTRIAN_STYLES, turned into a
// body description the crowd renderer understands: flag bits for clothing/props and eight packed
// sRGB colours (skin, top, bottom, shoes, hair-or-load, accent, item, extra).

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

const pal = (key, fallback) => (STYLES[key]?.length ? STYLES[key] : fallback);
const SKIN = pal('skinTones', ['#3b2219', '#4a2c20', '#5a3825', '#6b4430', '#7a5038', '#8d5f42', '#a0714f']);
const SKIN_W = STYLES.skinToneWeights?.length === SKIN.length ? STYLES.skinToneWeights : SKIN.map(() => 1);
const HAIR = pal('hair', ['#0e0b0a', '#1a1412', '#2a1f1a', '#5c5752']);
const SHIRT = pal('shirt', ['#ffffff', '#bcd4ec', '#1e2d55', '#b01e23', '#f2c200', '#2e6b3f']);
const TROUSERS = pal('trousers', ['#1f2a44', '#3b3b3b', '#111111', '#6b5a43', '#5a6f8f']);
const SKIRT = pal('skirt', ['#111111', '#1e2d55', '#6b1f2a']);
const DRESS = pal('dress', ['#d62f3a', '#1d4fb8', '#f2c200', '#2e8b57', '#ff7f2a', '#7b2d8e']);
const WRAPS = pal('zambiaWrap', [['#d62f3a', '#f2c200', '#111111'], ['#1d4fb8', '#ffffff', '#f2c200']]);
const HEADWRAP = pal('headwrap', ['#d62f3a', '#f2c200', '#1d4fb8', '#2e8b57', '#ff7f2a']);
const SUIT = pal('suit', ['#1b2233', '#22262e', '#2f3440', '#111111']);
const SUIT_SHIRT = pal('suitShirt', ['#ffffff', '#dfe9f5']);
const TIE = pal('tie', ['#6b1f2a', '#1e2d55', '#2e6b3f']);
const SHOES = pal('shoes', ['#111111', '#3b2a1e', '#6b4a2e', '#ffffff']);
const BAGS = pal('bags', ['#111111', '#6b4a2e', '#d62f3a', '#c2b28f']);
const CARRIER = pal('shoppingBags', ['#ffffff', '#1d4fb8', '#d62f3a']);
const JERSEYS = pal('footballJerseys', ['#1a3fa6', '#1f7a3a', '#f2c200']);
const CAPS = STYLES.hats?.find((h) => h.id === 'baseball_cap')?.colors || ['#111111', '#d62f3a', '#1d4fb8', '#ffffff'];
const FLAT_CAPS = STYLES.hats?.find((h) => h.id === 'flat_cap')?.colors || ['#3b3b3b', '#6b5a43'];
const SUN_HATS = STYLES.hats?.find((h) => h.id === 'sun_hat')?.colors || ['#d8c9a3', '#ffffff'];
const UNIFORMS = Object.fromEntries((STYLES.uniforms || []).map((u) => [u.id, u]));
const BASINS = ['#c9ced3', '#2b56a1', '#d23a2a', '#e0b23a', '#2e8b57'];
const LOADS = ['#d6331f', '#f0d23c', '#f08c1a', '#2f7d32', '#b99b6b', '#b5654a'];

const FEMALE_IDS = new Set(['office_woman', 'casual_woman', 'market_woman']);
const MALE_SHARE = { youth: 0.7, school_kid: 0.5, elder: 0.5, hwindi: 1, security_guard: 0.85, police: 0.7, handcart_pusher: 1, street_preacher: 0.9, apostolic: 0.5, car_washer: 1 };
const FIRST_NAMES = STREETLIFE.NPC_FIRST_NAMES?.length ? STREETLIFE.NPC_FIRST_NAMES : [{ name: 'Tendai', g: 'u' }, { name: 'Chipo', g: 'f' }, { name: 'Simba', g: 'm' }];

export function packColor(hex) {
  const v = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
  return Number.isFinite(v) ? v : 0x808080;
}

function inHours(a, hour) {
  if (!a.hours) return true;
  for (let i = 0; i + 1 < a.hours.length; i += 2) if (hour >= a.hours[i] && hour <= a.hours[i + 1]) return true;
  return false;
}

// Pick an archetype for a spawn context: {hour, nearRank, stationary}.
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

// Build a complete look for an archetype id. `opts.gender` forces a gender (vendors, groups).
export function makeLook(rng, archetype, opts = {}) {
  const id = archetype.id || archetype;
  const male = opts.gender ? opts.gender === 'male' : FEMALE_IDS.has(id) ? false : rng() < (MALE_SHARE[id] ?? 1);
  const L = {
    archetype: id,
    gender: male ? 'male' : 'female',
    child: false,
    flags: male ? 0 : FLAG.FEMALE,
    col: new Float32Array(8),
    build: rng.range(-0.25, 0.45),
    scale: male ? rng.range(0.97, 1.08) : rng.range(0.92, 1.02),
    speed: rng.range(...(archetype.walkSpeed || [1.1, 1.5])),
    stationary: rng() < (archetype.stationary || 0),
    name: '',
  };
  const skin = rng.weighted(SKIN.map((c, i) => ({ c, weight: SKIN_W[i] }))).c;
  const set = (slot, hex) => (L.col[slot] = packColor(hex));
  set(0, skin);
  set(3, rng.pick(SHOES));
  set(4, rng.pick(HAIR.slice(0, 3)));
  set(6, rng.pick(BAGS));
  const f = (bit) => (L.flags |= bit);
  const pattern = (type, top, bottom, alt) => {
    L.flags |= (type << PATTERN_SHIFT) | (top ? FLAG.PAT_TOP : 0) | (bottom ? FLAG.PAT_BOTTOM : 0);
    set(7, alt);
  };
  const femaleHair = () => {
    const r = rng();
    if (r < 0.3) {
      f(FLAG.WRAP);
      set(5, rng.pick(HEADWRAP));
    } else if (r < 0.55) f(FLAG.BUN);
  };

  switch (id) {
    case 'office_man':
      if (rng() < 0.6) {
        f(FLAG.SUIT);
        const suit = rng.pick(SUIT);
        set(1, suit);
        set(2, suit);
        set(7, rng.pick(SUIT_SHIRT));
        set(5, rng.pick(TIE));
      } else {
        set(1, rng.pick(SUIT_SHIRT.concat(['#bcd4ec'])));
        set(2, rng.pick(TROUSERS.slice(0, 4)));
      }
      set(3, rng.pick(SHOES.slice(0, 3)));
      if (rng() < 0.45) f(FLAG.HANDBAG);
      if (rng() < 0.2) f(FLAG.GLASSES);
      break;
    case 'office_woman': {
      const r = rng();
      if (r < 0.45) {
        f(FLAG.SKIRT);
        set(1, rng.pick(SHIRT.slice(0, 6)));
        set(2, rng.pick(SKIRT));
      } else if (r < 0.8) {
        f(rng() < 0.6 ? FLAG.SKIRT : FLAG.LONG);
        const dress = rng.pick(DRESS);
        set(1, dress);
        set(2, dress);
      } else {
        const suit = rng.pick(SUIT);
        set(1, rng.pick(SUIT_SHIRT));
        set(2, suit);
      }
      femaleHair();
      if (rng() < 0.65) f(FLAG.HANDBAG);
      set(3, rng.pick(SHOES.slice(0, 3)));
      break;
    }
    case 'casual_woman': {
      if (rng() < 0.55) {
        f(rng() < 0.5 ? FLAG.LONG : FLAG.SKIRT);
        const dress = rng.pick(DRESS);
        set(1, dress);
        set(2, dress);
        if (rng() < 0.35) pattern(rng.int(1, 3), true, true, rng.pick(['#ffffff', '#f2c200', '#111111']));
      } else {
        f(FLAG.SKIRT | FLAG.SHORTSLEEVE);
        set(1, rng.pick(SHIRT));
        set(2, rng.pick(SKIRT.concat(TROUSERS.slice(4))));
      }
      femaleHair();
      if (rng() < 0.4) f(FLAG.HANDBAG);
      else if (rng() < 0.3) {
        f(FLAG.BAGHAND);
        set(6, rng.pick(CARRIER));
      }
      break;
    }
    case 'market_woman': {
      const wrap = rng.pick(WRAPS);
      f(FLAG.LONG | FLAG.WRAP);
      set(2, wrap[0]);
      set(1, rng() < 0.5 ? rng.pick(SHIRT) : wrap[0]);
      pattern(3, false, true, wrap[1]);
      set(5, rng.pick(HEADWRAP));
      if (rng() < (archetype.carryOnHeadChance ?? 0.5)) {
        f(FLAG.LOAD);
        set(6, rng.pick(BASINS));
        set(4, rng.pick(LOADS));
      } else if (rng() < 0.3) {
        f(FLAG.BAGHAND);
        set(6, rng.pick(CARRIER));
      }
      if (rng() < (archetype.babyOnBackChance ?? 0.25)) f(FLAG.BABY);
      L.build = rng.range(0.1, 0.6);
      break;
    }
    case 'youth':
    case 'hwindi':
    case 'casual_man':
    case 'car_washer':
    case 'handcart_pusher': {
      const tee = rng() < 0.6;
      if (tee) f(FLAG.SHORTSLEEVE);
      if (rng() < 0.2) set(1, rng.pick(JERSEYS));
      else set(1, rng.pick(SHIRT));
      if (!male) {
        f(rng() < 0.5 ? FLAG.SKIRT : 0);
        femaleHair();
      }
      set(2, rng.pick(TROUSERS));
      if (id === 'car_washer' || (id === 'casual_man' && rng() < 0.12)) f(FLAG.SHORTS);
      if (male && rng() < (id === 'hwindi' || id === 'youth' ? 0.6 : 0.3)) {
        f(FLAG.CAP);
        set(5, rng.pick(CAPS));
      }
      if (rng() < 0.12) f(FLAG.GLASSES);
      if (rng() < 0.4) set(3, '#f2f2f2');
      if (id === 'casual_man' && rng() < 0.25) {
        f(FLAG.BAGHAND);
        set(6, rng.pick(CARRIER));
      }
      if (id === 'handcart_pusher') {
        set(1, '#1e2d55');
        set(2, '#1e2d55');
      }
      L.build = rng.range(-0.3, 0.3);
      break;
    }
    case 'school_kid': {
      L.child = true;
      const older = rng() < 0.5;
      L.scale = older ? rng.range(0.86, 0.96) : rng.range(0.7, 0.8);
      L.build = rng.range(-0.3, 0.1);
      const pick = (idm, idf) => UNIFORMS[male ? idm : idf];
      const u = older ? pick(rng() < 0.5 ? 'high_boy_maroon' : 'high_boy_navy', rng() < 0.5 ? 'high_girl_green' : 'high_girl_navy') : pick('primary_boy', 'primary_girl');
      if (!older && male) {
        f(FLAG.SHORTS | FLAG.SHORTSLEEVE);
        set(1, u?.shirt || '#c9b27c');
        set(2, u?.shorts || '#8b6f47');
      } else if (!older) {
        f(FLAG.SKIRT | FLAG.SHORTSLEEVE);
        set(1, u?.dress || '#7fb2e5');
        set(2, u?.dress || '#7fb2e5');
        pattern(2, true, true, '#ffffff');
      } else if (male) {
        set(1, u?.blazer || u?.jersey || '#6b1f2a');
        set(2, u?.trousers || '#6f7378');
        set(7, u?.shirt || '#ffffff');
        set(5, u?.tie || '#6b1f2a');
        f(FLAG.SUIT);
      } else {
        f(FLAG.SKIRT);
        set(1, u?.blazer || u?.jersey || u?.blouse || '#1e2d55');
        set(2, u?.pinafore || u?.skirt || '#1e2d55');
      }
      if (!older && rng() < 0.3 && u?.hat) {
        f(FLAG.HAT);
        set(5, u.hat.color);
      }
      set(3, '#111111');
      if (!male && !older) f(FLAG.BUN);
      if (rng() < 0.85) {
        f(FLAG.PACK);
        set(6, rng.pick(['#1e2d55', '#111111', '#d62f3a', '#2b56a1', '#6b1f2a']));
      }
      break;
    }
    case 'elder':
      set(4, rng.pick(HAIR.slice(3)));
      if (male) {
        set(1, rng.pick(['#6b5a43', '#3b3b3b', '#4a3b2e', '#7c8187']));
        set(2, rng.pick(TROUSERS.slice(0, 5)));
        if (rng() < 0.6) {
          const cap = rng() < 0.6;
          f(cap ? FLAG.CAP : FLAG.HAT);
          set(5, rng.pick(cap ? FLAT_CAPS : SUN_HATS));
        }
      } else {
        f(FLAG.LONG | FLAG.WRAP);
        const d = rng.pick(DRESS);
        set(1, d);
        set(2, d);
        set(5, rng.pick(HEADWRAP));
      }
      L.build = rng.range(0, 0.5);
      break;
    case 'security_guard':
    case 'police': {
      const u = UNIFORMS[id === 'police' ? 'zrp_officer' : 'security_guard'] || {};
      set(1, u.shirt || '#6f7c8f');
      set(2, u.trousers || '#1e2d55');
      set(3, u.boots || '#111111');
      f(FLAG.CAP);
      set(5, u.cap || '#1e2d55');
      if (!male) f(FLAG.SKIRT);
      break;
    }
    case 'street_preacher': {
      f(FLAG.SUIT);
      const suit = rng.pick(SUIT);
      set(1, suit);
      set(2, suit);
      set(7, '#ffffff');
      set(5, rng.pick(TIE));
      break;
    }
    case 'apostolic': {
      const robe = UNIFORMS.apostolic?.robe || '#f8f8f4';
      f(FLAG.LONG);
      set(1, robe);
      set(2, robe);
      set(3, '#6b4a2e');
      if (male) f(FLAG.BALD);
      else {
        f(FLAG.WRAP);
        set(5, UNIFORMS.apostolic?.headscarf || robe);
      }
      break;
    }
    default:
      set(1, rng.pick(SHIRT));
      set(2, rng.pick(TROUSERS));
  }
  if (male && id !== 'school_kid' && rng() < 0.12) f(FLAG.BALD);
  const names = FIRST_NAMES.filter((n) => n.g === 'u' || n.g === (male ? 'm' : 'f'));
  L.name = rng.pick(names).name;
  return L;
}

// Vendors: mostly women at produce tables, young men with airtime, older men mending shoes.
export function vendorLook(rng, type) {
  const woman = /woman|women/i.test(type.vendor || '') ? rng() < 0.85 : /man/i.test(type.vendor || '') ? rng() < 0.2 : rng() < 0.5;
  const arch = woman ? ARCHETYPES.find((a) => a.id === 'market_woman') || { id: 'market_woman' } : { id: /older/i.test(type.vendor || '') ? 'elder' : 'youth' };
  const look = makeLook(rng, arch, { gender: woman ? 'female' : 'male' });
  look.flags &= ~FLAG.LOAD;
  look.archetype = 'vendor';
  return look;
}
