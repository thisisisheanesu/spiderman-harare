import { el } from './dom.js';

// Credits page for the pause menu. Static attributions, plus the credit files shipped next to the
// assets, fetched when the page opens:
//   public/audio/CREDITS.md, CREDITS-extra.md    FLEURS voices, street recordings, FSI greetings
//                                               (rendered from a small Markdown subset, no innerHTML)
//   public/models/humans/CREDITS.md             clothing table: the CC BY items must be credited on
//                                               screen (asset, author, source link, licence)
//   public/models/props/CREDITS.md, public/textures/CREDITS.md   CC0 authors, credited anyway
// Each section keeps its static text when a file is missing (a build without those assets).

const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
const ODBL = 'https://opendatacommons.org/licenses/odbl/1-0/';
const CDLA = 'https://cdla.dev/permissive-2-0/';
const MH_REPO = 'http://www.makehumancommunity.org';

// The CC BY clothes as of public/models/humans/CREDITS.md (used only if that file can't be read).
const CC_BY_FALLBACK = [
  ['elvs_gored_midi_skirt', 'Elvaerwyn', 'http://www.makehumancommunity.org/node/2576'],
  ['elvs_hooded_sweat_jacket1', 'Elvaerwyn', 'http://www.makehumancommunity.org/node/1450'],
  ['elvs_ladies_apron', 'Elvaerwyn', 'http://www.makehumancommunity.org/node/1446'],
  ['elvs_male_shirt_tie_tucked1', 'Elvaerwyn', 'http://www.makehumancommunity.org/node/1799'],
  ['elvs_male_shirt_untucked_bd1', 'Elvaerwyn', 'http://www.makehumancommunity.org/node/1800'],
  ['elvs_male_trouser', 'Elvaerwyn', 'http://www.makehumancommunity.org/node/1796'],
  ['elvs_pencil_skirt', 'Elvaerwyn', 'http://www.makehumancommunity.org/node/2581'],
  ['punkduck_female_tight_jeans', 'punkduck', 'http://www.makehumancommunity.org/node/391'],
  ['punkduck_male_classic_jeans', 'punkduck', 'http://www.makehumancommunity.org/node/1655'],
  ['punkduck_v_neck_top', 'punkduck', 'http://www.makehumancommunity.org/node/419'],
  ['mindfront_patrol_cap', 'Mindfront', 'http://www.makehumancommunity.org/node/841'],
  ['janexx_old_female_sweater', 'janexx', 'http://www.makehumancommunity.org/node/2767'],
  ['culturalibre_sneakers', 'culturalibre', 'http://www.makehumancommunity.org/node/2555'],
];
const DERIVED_FALLBACK = [
  ['culturalibre_sneakers', 'brown-sneakers', 'yanix', 'https://sketchfab.com/3d-models/brown-sneakers-e6c51d2e77d945d1a0efbca530fb4b5b'],
];

export function creditsPage(game) {
  const audioBox = el('div', 'credits-audio');
  const extraBox = el('div', 'credits-audio');
  const clothesBox = el('div', 'credits-clothes', null, clothesCredits(CC_BY_FALLBACK, DERIVED_FALLBACK, null));
  const propsLine = para('Street furniture and clutter: scanned models from Poly Haven (CC0 1.0) and props modelled for this game (CC0 1.0).');
  const texLine = para('Surface textures (concrete, plaster, brick, stone, metal, roofing, asphalt, paving, grass, bark): ambientCG and Poly Haven, CC0 1.0. Sky lighting: Poly Haven "wide_street_01" by Sergej Majboroda (CC0 1.0).');
  let extraSection = null;
  const page = el('div', 'credits', null, [
    section('Spider-Man: Harare', [
      para('Fan project — not affiliated with, endorsed or sponsored by Marvel, Sony or Insomniac Games. Spider-Man is a trademark of Marvel.'),
    ]),
    section('Map data', [
      para(
        game.data?.meta?.attribution ||
          'Map data: Overture Maps Foundation, incl. OpenStreetMap contributors (ODbL), Google Open Buildings (CC BY 4.0), Microsoft ML Buildings (ODbL).',
      ),
      para('© OpenStreetMap contributors, available under the Open Database License (ODbL). © Overture Maps Foundation.'),
    ]),
    section('Shops, banks & businesses', [
      rich([
        'Business names, categories and positions: ',
        link('Overture Maps', 'https://docs.overturemaps.org/attribution/'),
        ' places (© Overture Maps Foundation, ',
        link('CDLA-Permissive-2.0', CDLA),
        '; records from Meta and Microsoft, AllThePlaces (CC0) and Foursquare OS Places (Apache-2.0)) and © ',
        link('OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'),
        ' (',
        link('ODbL 1.0', ODBL),
        '). Locations of well-known businesses were checked against branch locators, directories and news reports.',
      ]),
      rich([
        'The sign database (',
        link('data/shops.json', 'data/shops.json'),
        ') is a derivative of OpenStreetMap and is offered under the ODbL 1.0 (',
        link('sources', 'data/CREDITS-shops.md'),
        '). Business and brand names appear as plain lettering in the brands\' colours so the streets read as real; no logos are reproduced and no endorsement is implied.',
      ]),
    ]),
    section('People & animation', [
      rich([
        'Spider-Man and every passer-by are built on the MakeHuman base mesh, body morphs, game-engine rig and skin weights, skins, eyes, hair, shoes and system clothes (',
        link('MakeHuman', MH_REPO),
        ' / MPFB 2 by Data Collection AB, Joel Palmius, Jonas Hauquier and the MakeHuman team, ',
        link('CC0 1.0', CC0),
        ').',
      ]),
      rich([
        'Movement: ',
        link('Universal Animation Library', 'https://quaternius.itch.io/universal-animation-library'),
        ' and ',
        link('Universal Animation Library 2', 'https://quaternius.itch.io/universal-animation-library-2'),
        ' by Quaternius (animations with Gonzalo Furnier), CC0 1.0, retargeted to the MakeHuman rig. The swing, zip, dive, skydive and web-shooting clips and both suit designs were made for this game (CC0 1.0).',
      ]),
      clothesBox,
    ]),
    section('Vehicles', [
      para(
        'Kombi, ZUPCO bus, taxi, ZRP Land Cruiser and the other cars and trucks were modelled and textured for this game by script (Blender), CC0 1.0. They follow the published dimensions of the real models; no manufacturer logos or badges are reproduced. Lettering and number plates (all invented) use DejaVu Sans (Bitstream Vera licence).',
      ),
    ]),
    section('Street props & textures', [propsLine, texLine]),
    section('Voices', [
      para(
        'Shona (sn_zw) speech recordings from FLEURS (Conneau et al., 2022, Google), licensed CC BY 4.0. English translations of the lines come from FLoRes (CC BY-SA 4.0).',
      ),
      audioBox,
    ]),
    (extraSection = section('Street sounds & greetings', [
      para(
        'Street ambience recorded in Zimbabwe by KevZim (Freesound, CC0) and radio continental drift / Claudia Wegener (radio aporee ::: maps, CC BY-SA 3.0). Spoken Shona greetings from the FSI Shona Basic Course tapes (U.S. Foreign Service Institute, 1965, public domain), voice of Matthew Mataranyika.',
      ),
      extraBox,
    ])),
    section('Built with', [
      para(
        'Three.js and three-mesh-bvh (MIT), bundled with Vite; models compressed with meshoptimizer and glTF-Transform (MIT). Buildings, streets and the sky are generated in the browser from the map data, and every sound effect is synthesised there.',
      ),
    ]),
  ]);
  if (game.voices) loadAudioCredits(audioBox, 'audio/CREDITS.md');
  // Only credit the street recordings when this build ships them.
  extraSection.hidden = true;
  loadAudioCredits(extraBox, 'audio/CREDITS-extra.md').then((ok) => (extraSection.hidden = !ok));
  loadClothes(clothesBox);
  loadCc0Authors(propsLine, texLine);
  return page;
}

// "Clothing (CC BY 4.0)": every CC BY item, grouped by author, each linked to its source, plus the
// works they derive from. A null `cc0` list leaves out the CC0 wardrobe line.
function clothesCredits(items, derived, cc0) {
  const byAuthor = new Map();
  for (const [asset, author, url] of items) {
    if (!byAuthor.has(author)) byAuthor.set(author, []);
    byAuthor.get(author).push([asset, url]);
  }
  const out = [
    el('h4', null, { text: 'Clothing (CC BY 4.0)' }),
    rich([
      'From the ',
      link('MakeHuman community asset repository', MH_REPO),
      ', licensed ',
      link('CC BY 4.0', CC_BY),
      '; recoloured, decimated and baked into texture atlases for this game:',
    ]),
    el(
      'ul',
      null,
      null,
      [...byAuthor].map(([author, list]) =>
        el('li', null, null, [
          el('strong', null, { text: author }),
          ': ',
          ...list.flatMap(([asset, url], i) => [i ? ', ' : '', url ? link(asset, url) : asset]),
        ]),
      ),
    ),
  ];
  for (const [asset, title, author, url] of derived) {
    out.push(rich([`${asset} is derived from "`, url ? link(title, url) : title, `" by ${author} (Sketchfab), `, link('CC BY 4.0', CC_BY), '.']));
  }
  if (cc0?.length) out.push(para(`CC0 clothes, hair and shoes by ${cc0.join(', ')}.`));
  return out;
}

async function loadClothes(box) {
  const rows = await loadTable('models/humans/CREDITS.md', 'licence');
  if (!rows?.length) return;
  const items = [];
  const derived = [];
  const cc0 = new Set();
  for (const r of rows) {
    const author = r.author || '';
    if (/^cc-?by/i.test(r.licence)) {
      items.push([r.asset.replace(/\s*\(.*$/, ''), author, firstUrl(r.source)]);
      const m = /derived from "([^"]+)" by ([^,(]+?),\s*CC BY[^:]*:\s*(https?:\/\/[^\s)]+)/i.exec(r.source || '');
      if (m) derived.push([r.asset, m[1].replace(/-[0-9a-f]{32}$/, ''), m[2].trim(), m[3]]);
    } else if (/cc0/i.test(r.licence) && author && author !== 'makehuman_system') {
      cc0.add(author);
    }
  }
  if (items.length) box.replaceChildren(...clothesCredits(items, derived, [...cc0, 'the MakeHuman team']));
}

// CC0 needs no attribution; the scan and texture authors are named anyway, per site.
async function loadCc0Authors(propsLine, texLine) {
  const [props, tex] = await Promise.all([loadTable('models/props/CREDITS.md', 'source'), loadTable('textures/CREDITS.md', 'source')]);
  const bySite = (rows) => {
    const sites = new Map();
    for (const r of rows || []) {
      const site = /poly ?haven/i.test(r.source) ? 'Poly Haven' : /ambientcg/i.test(r.source) ? 'ambientCG' : '';
      if (!site || !r.author) continue;
      if (!sites.has(site)) sites.set(site, new Set());
      for (const a of r.author.replace(/\([^)]*\)/g, '').split(/,|;| and /)) {
        const name = a.replace(/joints generated.*$/i, '').trim();
        if (name) sites.get(site).add(name);
      }
    }
    return sites;
  };
  const list = (sites) => [...sites].map(([site, names]) => `${site} (${[...names].join(', ')})`).join(' and ');
  const p = bySite(props);
  if (p.size) {
    propsLine.textContent = `Street furniture and clutter: scanned models from ${list(p)}, CC0 1.0, and props modelled for this game (CC0 1.0).`;
  }
  const t = bySite(tex);
  if (t.size) {
    texLine.textContent = `Surface textures: ${list(t)}, CC0 1.0. Sky lighting: Poly Haven "wide_street_01" by Sergej Majboroda (CC0 1.0). Window interiors and painted kerbs were rendered for this game (CC0 1.0).`;
  }
}

// Rows of the first Markdown table in `url` whose header has a `needed` column, as objects keyed by
// the lower-cased header names; null if the file is missing.
async function loadTable(url, needed) {
  const text = await fetchText(url);
  if (!text) return null;
  let header = null;
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      if (header && rows.length) break;
      header = null;
      continue;
    }
    const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (!header) {
      const names = cells.map((c) => c.toLowerCase());
      if (names.includes(needed)) header = names;
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push(Object.fromEntries(header.map((h, i) => [h, stripMd(cells[i] || '')])));
  }
  return rows;
}

// Plain text of a table cell: [text](url) -> "text url", `code` -> code, **bold** -> bold.
function stripMd(cell) {
  return cell
    .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, '$1 $2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .trim();
}

function firstUrl(text) {
  return /https?:\/\/[^\s)]+/.exec(text || '')?.[0] || '';
}

async function fetchText(url) {
  try {
    const res = await fetch(url);
    const type = res.headers.get('content-type') || '';
    if (!res.ok || type.includes('html')) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// A paragraph mixing text and link nodes.
function rich(parts) {
  return el('p', null, null, parts.map((x) => (typeof x === 'string' ? document.createTextNode(x) : x)));
}

function section(title, children) {
  return el('section', 'credits-section', null, [el('h3', null, { text: title }), ...children]);
}

function para(text) {
  return el('p', null, { text });
}

async function loadAudioCredits(box, url) {
  const text = await fetchText(url);
  if (!text) return false; // credits file not shipped: the static attribution above still applies
  box.replaceChildren(...renderMarkdown(text));
  return true;
}

// Headings, bullet lists, tables, fenced code, paragraphs, **bold**, *italic*, `code`, [links](https://…)
// and <https://…> autolinks.
function renderMarkdown(src) {
  const out = [];
  let list = null;
  let table = null;
  let code = null;
  let para = [];
  const flush = () => {
    if (para.length) out.push(el('p', null, null, inline(para.join(' '))));
    para = [];
  };
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (code) {
      if (line.startsWith('```')) {
        out.push(el('pre', null, null, [el('code', null, { text: code.join('\n') })]));
        code = null;
      } else {
        code.push(raw);
      }
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^[-*]\s+(.*)$/.exec(line);
    const row = line.startsWith('|') ? line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()) : null;
    if (!item) list = null;
    if (!row) table = null;
    if (line.startsWith('```')) {
      flush();
      code = [];
    } else if (heading) {
      flush();
      out.push(el('h4', null, null, inline(heading[2])));
    } else if (item) {
      flush();
      if (!list) out.push((list = el('ul')));
      list.append(el('li', null, null, inline(item[1])));
    } else if (row) {
      flush();
      if (row.every((c) => /^:?-+:?$/.test(c))) continue;
      const cell = table ? 'td' : 'th';
      if (!table) out.push(el('div', 'credits-table', null, [(table = el('table'))]));
      table.append(el('tr', null, null, row.map((c) => el(cell, null, null, inline(c)))));
    } else if (!line) {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  return out;
}

function inline(text) {
  const nodes = [];
  const re = /\*\*(.+?)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|<(https?:\/\/[^>\s]+)>/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(document.createTextNode(text.slice(last, m.index)));
    if (m[1]) nodes.push(el('strong', null, { text: m[1] }));
    else if (m[2]) nodes.push(el('em', null, { text: m[2] }));
    else if (m[3]) nodes.push(el('code', null, { text: m[3] }));
    else if (m[6]) nodes.push(link(m[6], m[6]));
    else nodes.push(/^https?:\/\//.test(m[5]) ? link(m[4], m[5]) : document.createTextNode(m[4]));
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

function link(text, href) {
  return el('a', null, { text, href, target: '_blank', rel: 'noopener noreferrer' });
}
