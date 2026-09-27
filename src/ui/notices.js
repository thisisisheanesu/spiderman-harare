import { el, setText } from './dom.js';

const FADE_MS = 280;
const MAX_QUEUE = 3;

// Subtitles (bottom centre, queued), toasts (under the compass) and the objective panel.
export class Notices {
  constructor(parent, objectiveParent = parent) {
    this.subsRoot = el('div', 'subs', { 'aria-live': 'polite' });
    this.toastRoot = el('div', 'toasts', { 'aria-live': 'polite' });
    this.objText = el('div', 'objective-text');
    this.objective = el('div', 'objective panel', null, [el('div', 'eyebrow', { text: 'Objective' }), this.objText]);
    parent.append(this.subsRoot, this.toastRoot);
    objectiveParent.append(this.objective);
    this.queue = [];
    this.current = null;
    this.enabled = true;
  }

  // {speaker, sn (Shona line), en (English translation), ms}
  showSubtitle({ speaker = '', sn = '', en = '', ms } = {}) {
    if (!this.enabled || (!sn && !en)) return;
    const same = (s) => s && s.sn === sn && s.en === en;
    if (same(this.current) || this.queue.some(same)) return;
    const len = Math.max(sn.length, en.length);
    const item = { speaker, sn, en, ms: ms || Math.min(7000, Math.max(2600, 1400 + len * 55)) };
    this.queue.push(item);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
    if (!this.current) this._next();
  }

  _next() {
    const item = this.queue.shift();
    this.current = item || null;
    if (!item) return;
    const node = el('div', 'sub', null, [
      item.speaker ? el('span', `sub-speaker${/spider/i.test(item.speaker) ? ' is-hero' : ''}`, { text: item.speaker }) : null,
      item.sn ? el('div', 'sub-sn', { text: item.sn, lang: 'sn' }) : null,
      item.en ? el('div', 'sub-en', { text: item.en, lang: 'en' }) : null,
    ]);
    item.node = node;
    item.left = item.ms;
    this.subsRoot.append(node);
    requestAnimationFrame(() => node.classList.add('in'));
  }

  // Subtitles only advance while the game runs (voices are ducked while paused).
  updateSubtitles(dtMs) {
    const c = this.current;
    if (!c) return;
    c.left -= dtMs;
    if (c.left > 0) return;
    const node = c.node;
    node.classList.remove('in');
    setTimeout(() => node.remove(), FADE_MS);
    this._next();
  }

  toast(text, ms = 2600) {
    if (!text) return;
    const last = this.toastRoot.lastElementChild;
    if (last && last._text === text && !last.classList.contains('out')) return;
    const node = el('div', 'toast', { text });
    node._text = text;
    this.toastRoot.append(node);
    while (this.toastRoot.children.length > 3) this.toastRoot.firstElementChild.remove();
    requestAnimationFrame(() => node.classList.add('in'));
    setTimeout(() => {
      node.classList.add('out');
      node.classList.remove('in');
      setTimeout(() => node.remove(), FADE_MS);
    }, ms);
  }

  setObjective(text) {
    if (text) setText(this.objText, text);
    this.objective.classList.toggle('shown', !!text);
  }
}
