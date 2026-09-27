// Focus navigation for the open overlay with a gamepad (D-pad / left stick, A, B) and with the keys
// input.js reserves for gameplay (arrows, Tab, Space, which it preventDefaults). Handled keys stop
// here so they don't also reach gameplay (e.g. Space on "Resume" must not make Spider-Man jump).

const REPEAT = 0.22;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href]';

export class MenuNav {
  constructor() {
    this.container = null;
    this.prev = new Set();
    this.repeat = 0;
    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey, true);
  }

  attach(container) {
    this.container = container;
  }

  detach() {
    this.container = null;
    this._mark(null);
  }

  _items() {
    return [...this.container.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
  }

  move(dir) {
    const items = this._items();
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    const next = items[i < 0 ? 0 : (i + dir + items.length) % items.length];
    next.focus({ preventScroll: false });
    next.scrollIntoView?.({ block: 'nearest' });
    this._mark(next);
  }

  _mark(node) {
    this.marked?.classList.remove('nav-focus');
    this.marked = node;
    node?.classList.add('nav-focus');
  }

  _step(dir) {
    const a = document.activeElement;
    if (a?.type === 'range' && this.container?.contains(a)) {
      const step = Number(a.step) || 1;
      a.value = String(Number(a.value) + step * dir);
      a.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    return false;
  }

  _activate() {
    const a = document.activeElement;
    if (!a || !this.container?.contains(a)) {
      this.move(0);
      return;
    }
    if (a.type === 'range') return;
    a.click();
  }

  _key(e) {
    if (!this.container) return;
    let handled = true;
    switch (e.code) {
      case 'ArrowDown':
        this.move(1);
        break;
      case 'ArrowUp':
        this.move(-1);
        break;
      case 'Tab':
        this.move(e.shiftKey ? -1 : 1);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!this._step(e.code === 'ArrowRight' ? 1 : -1)) this.move(e.code === 'ArrowRight' ? 1 : -1);
        break;
      case 'Space':
      case 'Enter':
      case 'NumpadEnter':
        if (e.target?.tagName === 'INPUT' && e.target.type !== 'range') return;
        this._activate();
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // Poll the first gamepad. Returns 'back' when B was pressed.
  poll(dt) {
    if (!this.container) return null;
    const pad = [...(navigator.getGamepads?.() || [])].find((p) => p && p.connected);
    if (!pad) return null;
    const b = (i) => !!pad.buttons[i]?.pressed;
    const ay = pad.axes[1] || 0;
    const ax = pad.axes[0] || 0;
    const now = new Set();
    if (b(12) || ay < -0.6) now.add('up');
    if (b(13) || ay > 0.6) now.add('down');
    if (b(14) || ax < -0.6) now.add('left');
    if (b(15) || ax > 0.6) now.add('right');
    if (b(0)) now.add('a');
    if (b(1)) now.add('b');
    const fresh = (k) => now.has(k) && !this.prev.has(k);
    this.repeat -= dt;
    const held = (k) => fresh(k) || (now.has(k) && this.repeat <= 0);
    let result = null;
    if (held('up') || held('down') || held('left') || held('right')) {
      if (held('up')) this.move(-1);
      else if (held('down')) this.move(1);
      else if (!this._step(held('right') ? 1 : -1)) this.move(held('right') ? 1 : -1);
      this.repeat = fresh('up') || fresh('down') || fresh('left') || fresh('right') ? REPEAT * 1.8 : REPEAT;
    }
    if (fresh('a')) this._activate();
    if (fresh('b')) result = 'back';
    this.prev = now;
    return result;
  }
}
