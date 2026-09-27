import { el, fmtDistance } from './dom.js';
import { ICONS } from './icons.js';

const MAX_RESULTS = 8;
const KIND_PRI = { place: 0, web: 1, rank: 2, street: 3, brand: 4, shop: 5 };

// "fast_food" -> "Fast food"
const catLabel = (cat) => (cat ? cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ') : 'Business');
const norm = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Search on the big map: businesses (public/data/shops.json via hud.shops), landmarks and parks,
// kombi ranks and streets, by name. Picking a result centres the map on it and drops a waypoint
// there. Opened with the magnifier button or "/" (keyboard); typing never reaches the game, Esc
// closes the search before it closes the map.
export class MapSearch {
  constructor(bigMap) {
    this.map = bigMap;
    this.hud = bigMap.hud;
    this.isOpen = false;
    this.items = null; // built on first use, again once the shops have loaded
    this._shopsVersion = -1;
    this.results = [];
    this.sel = 0;

    this.input = el('input', 'search-input', {
      type: 'search',
      placeholder: 'Shops, places, streets…',
      'aria-label': 'Search the map',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      enterkeyhint: 'search',
    });
    this.list = el('div', 'search-results', { role: 'listbox', 'aria-label': 'Results' });
    this.note = el('div', 'search-note');
    this.panel = el('div', 'search-panel panel', { role: 'search' }, [
      el('div', 'search-row', null, [el('span', 'search-icon', { html: ICONS.search }), this.input]),
      this.list,
      this.note,
    ]);
    this.button = el('button', 'icon-btn search-btn', {
      type: 'button',
      'aria-label': 'Search the map (/)',
      title: 'Search the map (/)',
      'aria-expanded': 'false',
      html: ICONS.search,
      onclick: () => (this.isOpen ? this.close() : this.openPanel()),
    });
    this.root = el('div', 'bigmap-searchbox', null, [this.button, this.panel]);

    this.input.addEventListener('input', () => this._run());
    // Typing is for the search box only: WASD must not pan, M / H / Esc must not close the map.
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const r = this.results[this.sel];
        if (r) this.pick(r.item);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this._select(this.sel + (e.key === 'ArrowDown' ? 1 : -1));
      }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
  }

  openPanel() {
    this.isOpen = true;
    this.root.classList.add('open');
    this.button.setAttribute('aria-expanded', 'true');
    this._run();
    this.input.focus({ preventScroll: true });
    this.input.select();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    this.button.setAttribute('aria-expanded', 'false');
    if (document.activeElement === this.input) this.input.blur();
  }

  // Centre the map on a result and drop a waypoint on it.
  pick(item) {
    this.close();
    this.map.focusOn(item.x, item.z, item.zoom, item.name);
  }

  _index() {
    const shops = this.hud.shops;
    if (this.items && this._shopsVersion === shops.version) return this.items;
    this._shopsVersion = shops.version;
    const items = [];
    const add = (name, x, z, kind, meta, pri, zoom) => {
      if (!name || !Number.isFinite(x) || !Number.isFinite(z)) return;
      const key = norm(name);
      items.push({ name, x, z, kind, meta, pri, zoom, key, words: key.split(' ') });
    };
    const places = this.hud.places;
    for (const p of places.list) if (!p.distant) add(p.name, p.x, p.z, 'place', p.kind === 'park' ? 'Park' : 'Landmark', KIND_PRI.place, 1.4);
    for (const r of places.ranks) add(r.name, r.x, r.z, 'rank', 'Kombi rank', KIND_PRI.rank, 1.4);
    for (const st of this.map.streets) {
      const seg = st.segs[0];
      if (seg) add(st.name, (seg.ax + seg.bx) / 2, (seg.az + seg.bz) / 2, 'street', 'Street', KIND_PRI.street, 0.9);
    }
    for (const s of shops.places) {
      const pri = s.web ? KIND_PRI.web : s.brand ? KIND_PRI.brand : KIND_PRI.shop;
      add(s.name, s.x, s.z, 'shop', [catLabel(s.cat), s.road].filter(Boolean).join(' · '), pri, 2.6);
    }
    this.items = items;
    return items;
  }

  _run() {
    const q = norm(this.input.value);
    this.results = [];
    this.sel = 0;
    if (q) {
      const tokens = q.split(' ');
      const p = this.hud.game.player?.position || { x: 0, z: 0 };
      for (const item of this._index()) {
        let score;
        if (item.key === q) score = 0;
        else if (item.key.startsWith(q)) score = 1;
        else if (tokens.every((t) => item.words.some((w) => w.startsWith(t)))) score = 2;
        else if (item.key.includes(q)) score = 3;
        else continue;
        this.results.push({ item, score, dist: Math.hypot(item.x - p.x, item.z - p.z) });
      }
      this.results.sort((a, b) => a.score - b.score || a.item.pri - b.item.pri || a.dist - b.dist);
      this.results.length = Math.min(this.results.length, MAX_RESULTS);
    }
    this.list.replaceChildren(
      ...this.results.map((r, i) =>
        el(
          'button',
          'search-result',
          { type: 'button', role: 'option', 'aria-selected': String(i === 0), onclick: () => this.pick(r.item), onpointerenter: () => this._select(i) },
          [
            el('span', 'sr-name', { text: r.item.name }),
            el('span', 'sr-meta', { text: `${r.item.meta} · ${fmtDistance(r.dist)}` }),
          ],
        ),
      ),
    );
    const shopsLoading = !this.hud.shops.places.length;
    this.note.textContent = !q
      ? `Find any of Harare's ${shopsLoading ? '' : `${this.hud.shops.places.length.toLocaleString('en')} businesses, `}landmarks, ranks and streets`
      : this.results.length
        ? ''
        : 'Nothing by that name on the map';
  }

  _select(i) {
    const n = this.results.length;
    if (!n) return;
    this.sel = (i + n) % n;
    [...this.list.children].forEach((node, k) => node.setAttribute('aria-selected', String(k === this.sel)));
    this.list.children[this.sel]?.scrollIntoView?.({ block: 'nearest' });
  }
}
