import './touch.css';
import { el } from './dom.js';
import { ICONS } from './icons.js';

const STICK_RADIUS = 50; // CSS px of knob travel
const LOOK_GAIN = 2.2; // touch px -> "mouse px" for the camera rig

// Thumb cluster (bottom right), drawn around the big Swing button.
const BUTTONS = [
  ['swing', 'Swing', 'tb-swing'],
  ['jump', 'Jump', 'tb-jump'],
  ['zip', 'Zip', 'tb-zip'],
  ['dive', 'Dive', 'tb-dive'],
  ['suit', 'Suit', 'tb-suit'],
];

// On-screen controls for phones and tablets: a floating joystick on the left, drag-to-look on the
// right, hold buttons for moves, and Map / Pause buttons. Multi-touch safe (one pointer id per
// control); every surface is touch-action: none so the page never scrolls or zooms.
export class TouchControls {
  constructor(hud) {
    this.hud = hud;
    this.input = hud.game.input;
    this.enabled = false;
    this.stickId = null;
    this.lookId = null;
    this.held = new Map(); // action -> pointer id holding its button

    this.zone = el('div', 'touch-zone');
    this.knob = el('div', 'stick-knob');
    this.stick = el('div', 'stick', null, [this.knob]);
    const cluster = el(
      'div',
      'touch-cluster',
      null,
      BUTTONS.map(([action, label, cls]) => this._holdButton(action, label, cls)),
    );
    const top = el('div', 'touch-top', null, [
      el('button', 'tb tb-small', { type: 'button', 'aria-label': 'Pause', html: ICONS.pause, onclick: () => hud.openOverlay('pause') }),
      el('button', 'tb tb-small', { type: 'button', 'aria-label': 'Map', html: ICONS.map, onclick: () => hud.openOverlay('map') }),
    ]);
    this.root = el('div', 'touch-ui', { 'aria-hidden': 'true' }, [this.zone, this.stick, cluster, top]);
    hud.root.append(this.root);

    this.zone.addEventListener('pointerdown', (e) => this._zoneDown(e));
    this.zone.addEventListener('pointermove', (e) => this._zoneMove(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.zone.addEventListener(type, (e) => this._zoneUp(e));
    }
    // iOS Safari pinch-zoom gestures are not covered by touch-action.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.input.setVirtualMove(0, 0); // marks the input as touch-driven (no pointer lock requests)
    this.hud.root.classList.add('touch');
    this.hud.onResize();
  }

  // Release everything (overlay opened, tab hidden...). A no-op until touch is in use: feeding the
  // virtual inputs marks the input as touch-driven, which would stop mouse capture on desktop.
  reset() {
    if (!this.enabled) return;
    this.stickId = null;
    this.lookId = null;
    this._setStick(0, 0);
    this.stick.classList.remove('active');
    this.stick.style.transform = '';
    this.held.clear();
    for (const [action] of BUTTONS) this.input.setVirtualButton(action, false);
    for (const b of this.root.querySelectorAll('.tb.pressed')) b.classList.remove('pressed');
  }

  _holdButton(action, label, cls) {
    const b = el('button', `tb ${cls}`, { type: 'button', 'aria-label': label, html: ICONS[action] }, [el('span', 'tb-label', { text: label })]);
    const release = (e) => {
      if (this.held.get(action) !== e.pointerId) return;
      this.held.delete(action);
      b.classList.remove('pressed');
      // A tap shorter than one frame would never reach input.update(): let a frame pass first.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!this.held.has(action)) this.input.setVirtualButton(action, false);
        }),
      );
    };
    b.addEventListener('pointerdown', (e) => {
      if (this.held.has(action)) return;
      e.preventDefault();
      this.held.set(action, e.pointerId);
      b.setPointerCapture(e.pointerId);
      b.classList.add('pressed');
      this.input.setVirtualButton(action, true);
    });
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  _zoneDown(e) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    const leftSide = e.clientX < window.innerWidth * (window.innerWidth > window.innerHeight ? 0.4 : 0.5);
    if (leftSide && this.stickId === null) {
      this.stickId = e.pointerId;
      this.zone.setPointerCapture(e.pointerId);
      // Float the stick under the thumb, measured from its resting place.
      this.stick.style.transform = '';
      const r = this.stick.getBoundingClientRect();
      this.stickCx = e.clientX;
      this.stickCy = e.clientY;
      this.stick.style.transform = `translate(${e.clientX - (r.left + r.width / 2)}px, ${e.clientY - (r.top + r.height / 2)}px)`;
      this.stick.classList.add('active');
    } else if (!leftSide && this.lookId === null) {
      this.lookId = e.pointerId;
      this.zone.setPointerCapture(e.pointerId);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    }
  }

  _zoneMove(e) {
    if (e.pointerId === this.stickId) {
      let dx = e.clientX - this.stickCx;
      let dy = e.clientY - this.stickCy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) {
        dx *= STICK_RADIUS / d;
        dy *= STICK_RADIUS / d;
      }
      this._setStick(dx, dy);
    } else if (e.pointerId === this.lookId) {
      const s = this.hud.settings;
      const k = LOOK_GAIN * s.get('sensitivity');
      this.input.addLook((e.clientX - this.lookX) * k, (e.clientY - this.lookY) * k * (s.get('invertY') ? -1 : 1));
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    }
  }

  _zoneUp(e) {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this._setStick(0, 0);
      this.stick.classList.remove('active');
      this.stick.style.transform = '';
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
    }
  }

  _setStick(dx, dy) {
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const x = dx / STICK_RADIUS;
    const y = -dy / STICK_RADIUS;
    const m = Math.hypot(x, y);
    // Small dead zone, then linear up to full speed.
    const s = m < 0.12 ? 0 : (m - 0.12) / 0.88 / m;
    this.input.setVirtualMove(x * s, y * s);
  }
}
