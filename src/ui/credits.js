import { el } from './dom.js';

// Credits page for the pause menu. Static attributions + public/audio/CREDITS.md (FLEURS voice
// sources) + public/audio/CREDITS-extra.md (street ambience recordings and the FSI Shona greetings),
// rendered from a small Markdown subset with DOM nodes (no innerHTML).

export function creditsPage(game) {
  const audioBox = el('div', 'credits-audio');
  const extraBox = el('div', 'credits-audio');
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
      para('Three.js and three-mesh-bvh (MIT), bundled with Vite. Buildings, streets, sky and every sound effect are generated in the browser.'),
    ]),
  ]);
  if (game.voices) loadAudioCredits(audioBox, 'audio/CREDITS.md');
  // Only credit the street recordings when this build ships them.
  extraSection.hidden = true;
  loadAudioCredits(extraBox, 'audio/CREDITS-extra.md').then((ok) => (extraSection.hidden = !ok));
  return page;
}

function section(title, children) {
  return el('section', 'credits-section', null, [el('h3', null, { text: title }), ...children]);
}

function para(text) {
  return el('p', null, { text });
}

async function loadAudioCredits(box, url) {
  try {
    const res = await fetch(url);
    const type = res.headers.get('content-type') || '';
    if (!res.ok || type.includes('html')) return false;
    box.replaceChildren(...renderMarkdown(await res.text()));
    return true;
  } catch {
    /* credits file not shipped: the static attribution above still applies */
    return false;
  }
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
