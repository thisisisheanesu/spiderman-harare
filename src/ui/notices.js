import { el, setText } from './dom.js';

const FADE_MS = 280;
const MAX_QUEUE = 3;
const READ_TAIL_MS = 1500; // reading time a subtitle keeps after its line ends (voices.js: dur + 1.5 s) ...
const MIN_LEFT_MS = 600; // ... which it gives up, down to this, when the next line is already waiting
const MIN_PAGE_MS = 1100; // compact subtitles: shortest time a page stays up
const MAX_PAGES = 6; // a page that still doesn't fit then wraps (.sub.compact.wrap) rather than lose words
// Compact subtitle type: Shona / English font sizes in px (fallbacks; compact.css sets --sub-sn and
// --sub-en). Lines are measured in these fonts to decide how many pages a line needs.
const SN_PX = 12.5;
const EN_PX = 11;
const FIT = 1.08; // safety margin on measured widths (pages split at words, not exactly in half)
const TOAST_MS = 2600;
const COMPACT_TOAST_MS = [1800, 3600];
const OBJECTIVE_OPEN_MS = 5000; // compact: a new objective shows in full this long, then folds to a chip

// Subtitles (one at a time, queued), toasts and the objective panel.
//
// Subtitle modes (hud.subtitleMode): 'full' = speaker, the whole Shona line and its English translation;
// 'compact' = at most two short lines (Shona over English, small type) paged through in step with the
// voice; 'off'. Compact layout (setCompact(true), phones): toasts come one at a time and short, and the
// objective folds into a one-line chip that opens on tap (and by itself for a few seconds when the
// objective changes).
export class Notices {
  constructor(parent, objectiveParent = parent) {
    this.subsRoot = el('div', 'subs', { 'aria-live': 'polite' });
    this.toastRoot = el('div', 'toasts', { 'aria-live': 'polite' });
    this.objText = el('div', 'objective-text');
    this.objHow = el('div', 'objective-how');
    this.objStep = el('span', 'objective-step');
    this.objective = el('div', 'objective panel', { 'aria-live': 'polite' }, [
      el('div', 'eyebrow', null, [el('span', 'objective-label', { text: 'Objective' }), this.objStep]),
      this.objText,
      this.objHow,
    ]);
    this.objective.addEventListener('click', () => this.toggleObjective());
    parent.append(this.subsRoot, this.toastRoot);
    objectiveParent.append(this.objective);
    this.queue = [];
    this.current = null;
    this.mode = 'full';
    this.compact = false;
    this.toastQueue = [];
    this.toastNode = null; // compact: the one toast on screen
    this._objTimer = 0;
    this.onChange = null; // called when something appears / goes / changes size (hud.screenBlocks)
  }

  _changed() {
    this.onChange?.();
  }

  get enabled() {
    return this.mode !== 'off';
  }

  set enabled(on) {
    this.setMode(on ? 'full' : 'off');
  }

  setMode(mode) {
    this.mode = mode === 'compact' || mode === 'off' ? mode : 'full';
    this.subsRoot.classList.toggle('compact', this.mode === 'compact');
    if (this.mode === 'off') {
      this.queue.length = 0;
      if (this.current) this.current.left = Math.min(this.current.left, 0);
    }
  }

  setCompact(on) {
    this.compact = on;
    if (!on) this._openObjective(false);
  }

  // {speaker, sn (Shona line), en (English translation), ms}
  showSubtitle({ speaker = '', sn = '', en = '', ms } = {}) {
    if (!this.enabled || (!sn && !en)) return;
    const same = (s) => s && s.sn === sn && s.en === en;
    if (same(this.current) || this.queue.some(same)) return;
    const len = Math.max(sn.length, en.length);
    const item = { speaker, sn, en, ms: ms || Math.min(7000, Math.max(2600, 1400 + len * 55)) };
    this.queue.push(item);
    const max = this.mode === 'compact' ? 1 : MAX_QUEUE;
    while (this.queue.length > max) this.queue.shift();
    const c = this.current;
    if (!c) this._next();
    else if (!c.trimmed) {
      // Someone else has started talking: don't hold their subtitle back for the reading tail.
      c.trimmed = true;
      c.left = Math.min(c.left, Math.max(MIN_LEFT_MS, c.left - READ_TAIL_MS));
    }
  }

  // The speaker is out of earshot: fade their line out now (or drop it if it is still queued).
  dropSubtitle({ sn = '', en = '' } = {}) {
    const same = (s) => s && s.sn === sn && s.en === en;
    this.queue = this.queue.filter((q) => !same(q));
    const c = this.current;
    if (same(c)) c.left = Math.min(c.left, 250);
  }

  _next() {
    const item = this.queue.shift();
    this.current = item || null;
    if (!item) return;
    item.left = item.ms;
    item.age = 0;
    item.page = 0;
    item.node = this.mode === 'compact' ? this._compactNode(item) : this._fullNode(item);
    this.subsRoot.append(item.node);
    requestAnimationFrame(() => item.node.classList.add('in'));
    this._changed();
  }

  _fullNode(item) {
    return el('div', 'sub', null, [
      item.speaker ? el('span', `sub-speaker${/spider/i.test(item.speaker) ? ' is-hero' : ''}`, { text: item.speaker }) : null,
      item.sn ? el('div', 'sub-sn', { text: item.sn, lang: 'sn' }) : null,
      item.en ? el('div', 'sub-en', { text: item.en, lang: 'en' }) : null,
    ]);
  }

  // Two lines: [Name] Shona / English, split into pages that fit the box, shown in step with the voice.
  _compactNode(item) {
    const name = String(item.speaker || '').split(',')[0].trim();
    const cs = getComputedStyle(this.subsRoot);
    const snPx = parseFloat(cs.getPropertyValue('--sub-sn')) || SN_PX;
    const enPx = parseFloat(cs.getPropertyValue('--sub-en')) || EN_PX;
    const family = cs.fontFamily || 'system-ui, sans-serif';
    const width = Math.max(160, (this.subsRoot.clientWidth || 320) - 20);
    const tagPx = name ? measure(`800 8.5px ${family}`, name.toUpperCase()) + name.length + 18 : 0;
    const snFont = `italic 600 ${snPx}px ${family}`;
    const enFont = `500 ${enPx}px ${family}`;
    const snRoom = Math.max(80, width - tagPx);
    const fits = (pages, font, room) => pages.every((p) => measure(font, p) <= room);
    // Fewest pages that fit: from the measured length, one more while a page (split at words) is too wide.
    let n = Math.max(1, Math.ceil((measure(snFont, item.sn) * FIT) / snRoom), Math.ceil((measure(enFont, item.en) * FIT) / width));
    let sn;
    let en;
    for (n = Math.min(n, MAX_PAGES); ; n++) {
      sn = splitText(item.sn, n);
      en = splitText(item.en, n);
      if (n >= MAX_PAGES || (fits(sn, snFont, snRoom) && fits(en, enFont, width))) break;
    }
    const wrap = !(fits(sn, snFont, snRoom) && fits(en, enFont, width));
    // Page k ends at a share of the spoken part proportional to its length (the last keeps the tail).
    const speech = Math.max(item.ms - READ_TAIL_MS, item.ms * 0.6);
    const weights = sn.map((s, k) => Math.max(s.length, en[k].length, 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    item.pages = sn.map((s, k) => {
      acc += weights[k];
      return { sn: s, en: en[k], end: k === n - 1 ? Infinity : Math.max(MIN_PAGE_MS * (k + 1), (speech * acc) / total) };
    });
    item.snNode = el('span', 'sub-sn', { text: item.pages[0].sn, lang: 'sn' });
    item.enNode = el('div', 'sub-en', { text: item.pages[0].en, lang: 'en' });
    return el('div', wrap ? 'sub compact wrap' : 'sub compact', null, [
      el('div', 'sub-line', null, [name ? el('span', `sub-speaker${/spider/i.test(name) ? ' is-hero' : ''}`, { text: name }) : null, item.snNode]),
      item.en ? item.enNode : null,
    ]);
  }

  // Subtitles only advance while the game runs (voices are ducked while paused).
  updateSubtitles(dtMs) {
    const c = this.current;
    if (!c) return;
    c.left -= dtMs;
    c.age += dtMs;
    if (c.pages) {
      let k = c.page;
      while (k < c.pages.length - 1 && c.age >= c.pages[k].end) k++;
      if (k !== c.page) {
        c.page = k;
        setText(c.snNode, c.pages[k].sn);
        setText(c.enNode, c.pages[k].en);
      }
    }
    if (c.left > 0) return;
    const node = c.node;
    node.classList.remove('in');
    setTimeout(() => node.remove(), FADE_MS);
    this._next();
    this._changed();
  }

  toast(text, ms) {
    if (!text) return;
    if (this.compact) {
      this._compactToast(text, ms);
      return;
    }
    ms = ms || TOAST_MS;
    const last = this.toastRoot.lastElementChild;
    if (last && last._text === text && !last.classList.contains('out')) return;
    const node = el('div', 'toast', { text });
    node._text = text;
    this.toastRoot.append(node);
    while (this.toastRoot.children.length > 3) this.toastRoot.firstElementChild.remove();
    requestAnimationFrame(() => node.classList.add('in'));
    this._changed();
    setTimeout(() => this._fadeToast(node), ms);
  }

  // Phones: one short toast at a time; the next waits (at most two waiting, no repeats).
  _compactToast(text, ms) {
    if (this.toastNode?._text === text || this.toastQueue.some((q) => q.text === text)) return;
    this.toastQueue.push({ text, ms: Math.min(COMPACT_TOAST_MS[1], Math.max(COMPACT_TOAST_MS[0], (ms || TOAST_MS) * 0.6)) });
    while (this.toastQueue.length > 2) this.toastQueue.shift();
    if (!this.toastNode) this._nextToast();
  }

  _nextToast() {
    const q = this.toastQueue.shift();
    this.toastNode = null;
    if (!q) return;
    const node = el('div', 'toast', { text: q.text });
    node._text = q.text;
    this.toastNode = node;
    this.toastRoot.append(node);
    requestAnimationFrame(() => node.classList.add('in'));
    this._changed();
    setTimeout(() => {
      this._fadeToast(node);
      setTimeout(() => {
        if (this.toastNode === node) this._nextToast();
      }, FADE_MS);
    }, q.ms);
  }

  _fadeToast(node) {
    node.classList.add('out');
    node.classList.remove('in');
    setTimeout(() => {
      node.remove();
      this._changed();
    }, FADE_MS);
  }

  // text: the goal; detail: {how (one line on how to do it), step ('2/5')} (both optional).
  setObjective(text, detail) {
    const changed = !!text && text !== this.objText._text;
    if (text) {
      setText(this.objText, text);
      setText(this.objHow, detail?.how || '');
      setText(this.objStep, detail?.step || '');
    }
    this.objective.classList.toggle('shown', !!text);
    this._changed();
    if (!text) this._openObjective(false);
    else if (changed && this.compact) this._openObjective(true, OBJECTIVE_OPEN_MS);
  }

  // Compact: tap the objective chip to read it in full (it folds again by itself).
  toggleObjective() {
    if (!this.compact || !this.objective.classList.contains('shown')) return;
    this._openObjective(!this.objective.classList.contains('open'), OBJECTIVE_OPEN_MS + 1500);
  }

  _openObjective(open, ms) {
    clearTimeout(this._objTimer);
    this.objective.classList.toggle('open', open);
    this._changed();
    if (open && ms) {
      this._objTimer = setTimeout(() => {
        this.objective.classList.remove('open');
        this._changed();
      }, ms);
    }
  }

  // Brief highlight when an objective is completed.
  flashObjective() {
    const o = this.objective;
    o.classList.remove('flash');
    void o.offsetWidth; // restart the animation
    o.classList.add('flash');
  }
}

let measureCtx = null;

// Width in px of `text` set in the CSS `font`.
function measure(font, text) {
  if (!text) return 0;
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

// Split text into n pieces of similar length at word boundaries (always n entries; some may be '').
function splitText(text, n) {
  if (n <= 1 || !text) return [text || '', ...Array(Math.max(0, n - 1)).fill('')];
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const left = words.slice(i).join(' ');
    const target = left.length / (n - k);
    let piece = '';
    while (i < words.length && (k === n - 1 || !piece || piece.length + 1 + words[i].length <= target * 1.15 || piece.length < target * 0.6)) {
      piece = piece ? `${piece} ${words[i]}` : words[i];
      i++;
      if (k < n - 1 && piece.length >= target) break;
    }
    out.push(piece);
  }
  return out;
}
