import { el } from './dom.js';

// Settings form for the pause menu. Every control writes through hud.setSetting(), which persists
// the value and applies it live; quality needs a reload (offered with a button).

const QUALITIES = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
];

export class SettingsPage {
  constructor(hud) {
    this.hud = hud;
    this.game = hud.game;
    this.settings = hud.settings;
    this.refreshers = [];
    this.root = el('div', 'settings', null, [
      this._group('Audio', [
        this._slider('master', 'Master volume', 0, 1, 0.05, pct),
        this._slider('voices', 'Voices', 0, 1, 0.05, pct),
        this._slider('sfx', 'Effects', 0, 1, 0.05, pct),
        this._slider('ambience', 'City ambience', 0, 1, 0.05, pct),
        this._toggle('muted', 'Mute all sound'),
      ]),
      this._group('Controls', [
        this._slider('sensitivity', 'Look sensitivity', 0.2, 3, 0.1, (v) => `${v.toFixed(1)}×`),
        this._toggle('invertY', 'Invert vertical look'),
      ]),
      this._group('Display', [this._quality(), this._toggle('subtitles', 'Subtitles')]),
      this.game.sky?.setTimeOfDay ? this._group('World', [this._timeOfDay()]) : null,
    ]);
  }

  refresh() {
    for (const fn of this.refreshers) fn();
  }

  _group(title, rows) {
    return el('section', 'settings-group', null, [el('h3', null, { text: title }), ...rows]);
  }

  _slider(key, label, min, max, step, fmt) {
    const value = el('output', 'setting-value');
    const input = el('input', 'range', { type: 'range', min, max, step, 'aria-label': label });
    const sync = (v) => {
      input.value = String(v);
      value.textContent = fmt(v);
      input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
    };
    input.addEventListener('input', () => {
      const v = Math.min(max, Math.max(min, Number(input.value)));
      this.hud.setSetting(key, v);
      sync(v);
    });
    this.refreshers.push(() => sync(this.settings.get(key)));
    return el('label', 'setting', null, [el('span', 'setting-label', { text: label }), value, input]);
  }

  _toggle(key, label) {
    const sw = el('button', 'switch', { type: 'button', role: 'switch', 'aria-label': label });
    const sync = () => sw.setAttribute('aria-checked', String(!!this.settings.get(key)));
    sw.addEventListener('click', () => {
      this.hud.setSetting(key, !this.settings.get(key));
      sync();
    });
    this.refreshers.push(sync);
    return el('div', 'setting setting-row', null, [el('span', 'setting-label', { text: label }), sw]);
  }

  _quality() {
    const current = this.game.quality.level;
    const reload = el('button', 'chip-btn accent hidden', {
      type: 'button',
      text: 'Reload to apply',
      onclick: () => {
        const url = new URL(location.href);
        url.searchParams.set('quality', this.settings.get('quality') || current);
        location.assign(url.toString());
      },
    });
    const buttons = QUALITIES.map(([level, text]) =>
      el('button', 'seg-btn', {
        type: 'button',
        text,
        'data-level': level,
        onclick: () => {
          this.hud.setSetting('quality', level);
          sync();
        },
      }),
    );
    const sync = () => {
      const chosen = this.settings.get('quality') || current;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.level === chosen));
      reload.classList.toggle('hidden', chosen === current);
    };
    this.refreshers.push(sync);
    return el('div', 'setting', null, [
      el('span', 'setting-label', { text: 'Graphics quality' }),
      el('div', 'setting-quality', null, [el('div', 'segmented', { role: 'group', 'aria-label': 'Graphics quality' }, buttons), reload]),
    ]);
  }

  _timeOfDay() {
    const sky = this.game.sky;
    const value = el('output', 'setting-value');
    const input = el('input', 'range', { type: 'range', min: 0, max: 24, step: 0.25, 'aria-label': 'Time of day' });
    const sync = (h) => {
      input.value = String(h);
      value.textContent = clock(h);
      input.style.setProperty('--fill', `${(h / 24) * 100}%`);
    };
    input.addEventListener('input', () => {
      const h = Number(input.value) % 24;
      sky.setTimeOfDay(h);
      sync(h);
    });
    this.refreshers.push(() => sync(sky.timeOfDay ?? 12));
    return el('label', 'setting', null, [el('span', 'setting-label', { text: 'Time of day' }), value, input]);
  }
}

function pct(v) {
  return `${Math.round(v * 100)}%`;
}

function clock(h) {
  const m = Math.round((((h % 24) + 24) % 24) * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
