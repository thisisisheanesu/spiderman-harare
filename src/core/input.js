// Unified input: keyboard + mouse (pointer lock) + gamepad + virtual (touch) controls.
//
// Per frame, game.input exposes:
//   input.move      {x, y}   x = strafe right (+) / left (-), y = forward (+) / back (-), length <= 1
//   input.look      {x, y}   look delta this frame in "mouse pixels" (already includes sensitivity for pads)
//   input.down(a)            action held
//   input.pressed(a)         action went down this frame
//   input.released(a)        action went up this frame
// Actions: 'jump' 'swing' 'zip' 'dive' 'suit' 'map' 'pause' 'help' 'camera' 'photo' 'time'
//
// Touch UI (src/ui) feeds in through input.setVirtualMove(x, y), input.addLook(dx, dy),
// input.setVirtualButton(action, isDown).

const KEY_ACTIONS = {
  Space: 'jump',
  ShiftLeft: 'swing',
  ShiftRight: 'swing',
  KeyE: 'zip',
  KeyQ: 'zip',
  ControlLeft: 'dive',
  KeyC: 'dive',
  KeyF: 'suit',
  KeyM: 'map',
  Escape: 'pause',
  KeyP: 'pause',
  KeyH: 'help',
  KeyV: 'camera',
  KeyT: 'time',
};

const PAD_BUTTONS = {
  0: 'jump', // A / Cross
  1: 'dive', // B / Circle
  3: 'suit', // Y / Triangle
  4: 'zip', // LB
  5: 'zip', // RB
  7: 'swing', // RT
  6: 'zip', // LT
  8: 'map', // Back / Select
  9: 'pause', // Start
};

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.mouseSensitivity = 1;
    this.invertY = false;
    this.keys = new Set();
    this.mouseButtons = new Set();
    // Presses seen since the last update(), so a tap released before the next frame still registers.
    this.tappedKeys = new Set();
    this.tappedMouse = new Set();
    this.virtualButtons = new Set();
    this.padButtons = new Set();
    this.virtualMove = { x: 0, y: 0 };
    this.prev = new Set();
    this.curr = new Set();
    this.pendingLook = { x: 0, y: 0 };
    this.pointerLocked = false;
    this.enabled = true;
    this.usingGamepad = false;
    this.usingTouch = false;

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
      this.keys.add(e.code);
      this.tappedKeys.add(e.code);
      this.usingGamepad = false;
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseDown = (e) => {
      this.mouseButtons.add(e.button);
      this.tappedMouse.add(e.button);
      this.usingGamepad = false;
    };
    this._onMouseUp = (e) => this.mouseButtons.delete(e.button);
    this._onMouseMove = (e) => {
      if (!this.pointerLocked) return;
      this.pendingLook.x += e.movementX * this.mouseSensitivity;
      this.pendingLook.y += e.movementY * this.mouseSensitivity * (this.invertY ? -1 : 1);
    };
    this._onBlur = () => {
      this.keys.clear();
      this.tappedKeys.clear();
      this.mouseButtons.clear();
      this.virtualButtons.clear();
    };
    this._onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
      if (!this.pointerLocked) this.mouseButtons.clear();
    };
    this._onContext = (e) => e.preventDefault();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerlockchange', this._onLockChange);
    this.dom.addEventListener('contextmenu', this._onContext);
  }

  requestPointerLock() {
    if (this.usingTouch) return;
    try {
      const p = this.dom.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* not allowed here (e.g. iframe without permission) */
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  setVirtualMove(x, y) {
    this.virtualMove.x = x;
    this.virtualMove.y = y;
    this.usingTouch = true;
  }

  addLook(dx, dy) {
    this.pendingLook.x += dx;
    this.pendingLook.y += dy;
  }

  setVirtualButton(action, isDown) {
    if (isDown) this.virtualButtons.add(action);
    else this.virtualButtons.delete(action);
    this.usingTouch = true;
  }

  down(a) {
    return this.curr.has(a);
  }

  pressed(a) {
    return this.curr.has(a) && !this.prev.has(a);
  }

  released(a) {
    return !this.curr.has(a) && this.prev.has(a);
  }

  // Call once per frame before systems update.
  update(dt) {
    this.prev = this.curr;
    const next = new Set();
    if (this.enabled) {
      for (const code of this.keys) {
        const a = KEY_ACTIONS[code];
        if (a) next.add(a);
      }
      for (const code of this.tappedKeys) {
        const a = KEY_ACTIONS[code];
        if (a) next.add(a);
      }
      if (this.pointerLocked) {
        if (this.mouseButtons.has(0) || this.tappedMouse.has(0)) next.add('swing');
        if (this.mouseButtons.has(2) || this.tappedMouse.has(2)) next.add('zip');
      }
      for (const a of this.virtualButtons) next.add(a);
    }

    // Keyboard movement.
    let mx = 0;
    let my = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      mx += this.virtualMove.x;
      my += this.virtualMove.y;
    }

    // Gamepad.
    let lookX = this.pendingLook.x;
    let lookY = this.pendingLook.y;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const lx = dz(pad.axes[0] || 0);
      const ly = dz(pad.axes[1] || 0);
      const rx = dz(pad.axes[2] || 0);
      const ry = dz(pad.axes[3] || 0);
      if (lx || ly || rx || ry) this.usingGamepad = true;
      if (this.enabled) {
        mx += lx;
        my -= ly;
        lookX += rx * 900 * dt;
        lookY += ry * 600 * dt * (this.invertY ? -1 : 1);
        pad.buttons.forEach((b, i) => {
          const a = PAD_BUTTONS[i];
          if (a && (b.pressed || b.value > 0.4)) {
            next.add(a);
            this.usingGamepad = true;
          }
        });
      }
      break;
    }

    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.move.x = mx;
    this.move.y = my;
    this.look.x = this.enabled ? lookX : 0;
    this.look.y = this.enabled ? lookY : 0;
    this.pendingLook.x = 0;
    this.pendingLook.y = 0;
    this.tappedKeys.clear();
    this.tappedMouse.clear();
    this.curr = next;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    this.dom.removeEventListener('contextmenu', this._onContext);
  }
}
