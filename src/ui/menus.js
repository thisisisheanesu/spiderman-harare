import { el } from './dom.js';
import { ICONS } from './icons.js';
import { controlsColumns } from './controls.js';
import { creditsPage } from './credits.js';
import { SettingsPage } from './settingsPage.js';

const TABS = [
  ['settings', 'Settings'],
  ['controls', 'Controls'],
  ['credits', 'Credits'],
];

// Pause menu: Resume + Settings / Controls / Credits tabs. Pages are built on first use.
export class PauseMenu {
  constructor(hud) {
    this.hud = hud;
    this.pages = {};
    this.tab = 'settings';
    this.title = el('h3', 'menu-title');
    this.body = el('div', 'menu-content');
    this.tabButtons = TABS.map(([id, text]) =>
      el('button', 'menu-item', { type: 'button', text, 'data-tab': id, onclick: () => this.select(id) }),
    );
    this.resumeBtn = el('button', 'menu-item primary', { type: 'button', text: 'Resume', onclick: () => hud.closeOverlay() });
    this.root = el('div', 'overlay pause', { role: 'dialog', 'aria-label': 'Paused', 'aria-hidden': 'true' }, [
      el('div', 'menu panel', null, [
        el('nav', 'menu-nav', null, [
          el('div', 'menu-brand', null, [el('div', 'eyebrow', { text: 'Paused' }), el('h2', null, { html: 'Spider-Man <span>Harare</span>' })]),
          this.resumeBtn,
          ...this.tabButtons,
        ]),
        el('section', 'menu-body', null, [this.title, this.body]),
      ]),
    ]);
    hud.root.append(this.root);
  }

  select(id) {
    this.tab = id;
    for (const b of this.tabButtons) b.setAttribute('aria-current', String(b.dataset.tab === id));
    this.title.textContent = TABS.find(([t]) => t === id)[1];
    if (!this.pages[id]) {
      if (id === 'settings') this.pages[id] = new SettingsPage(this.hud);
      else if (id === 'controls') this.pages[id] = { root: controlsColumns(this.hud.inputMode) };
      else this.pages[id] = { root: creditsPage(this.hud.game) };
    }
    const page = this.pages[id];
    page.refresh?.();
    if (id === 'controls') {
      for (const col of page.root.children) col.classList.toggle('is-active', col.dataset.mode === this.hud.inputMode);
    }
    this.body.replaceChildren(page.root);
    this.body.scrollTop = 0;
  }

  show() {
    this.select(this.tab);
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    this.resumeBtn.focus({ preventScroll: true });
  }

  hide() {
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
  }
}

// Help overlay (H): controls for every input method, current one highlighted.
export class HelpOverlay {
  constructor(hud) {
    this.hud = hud;
    this.content = el('div', 'help-content');
    this.root = el('div', 'overlay help', { role: 'dialog', 'aria-label': 'Controls', 'aria-hidden': 'true' }, [
      el('div', 'help-card panel', null, [
        el('header', 'help-head', null, [
          el('div', null, null, [el('div', 'eyebrow', { text: 'Help' }), el('h2', null, { text: 'Controls' })]),
          el('button', 'icon-btn close-btn', { type: 'button', 'aria-label': 'Close help (H)', html: ICONS.close, onclick: () => hud.closeOverlay() }),
        ]),
        this.content,
        el('p', 'help-foot', {
          text: 'Swing from buildings, zip to ledges, dive between towers. Press M for the map of Harare CBD and drop a waypoint anywhere.',
        }),
      ]),
    ]);
    hud.root.append(this.root);
  }

  show() {
    this.content.replaceChildren(controlsColumns(this.hud.inputMode));
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    this.root.querySelector('.close-btn').focus({ preventScroll: true });
  }

  hide() {
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
  }
}
