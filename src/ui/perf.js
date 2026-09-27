// Frame-rate watchdog for unknown hardware. The hosted page can't take URL flags, and any desktop
// starts on 'high' quality, so a weak laptop GPU would otherwise play the whole first minute as a
// slideshow (the simulation also slows down below 20 fps). While the game runs in a visible tab,
// two slow measurements in a row step the render resolution down (not below one pixel per CSS pixel);
// still slow at that floor, the player is told once where to lower the graphics quality.

const WARMUP = 5; // s of play before judging (shader warm-up, first frames of streaming)
const WINDOW = 3; // s per measurement
const LOW_FPS = 40; // below this (twice running) the resolution steps down...
const STEP = 0.25; // ...by this much of the device pixel ratio
const FLOOR = 1;
const SLOW_FPS = 22; // still below this at the floor: suggest Low quality
const MAX_GAP = 2; // s: longer gaps are pauses / tab switches, not slowness

export class PerfWatch {
  constructor(hud) {
    this.hud = hud;
    this.game = hud.game;
    this.played = 0;
    this.acc = 0;
    this.frames = 0;
    this.strikes = 0;
    this.suggested = false;
    this._last = 0;
  }

  // Every frame while the game is running (not paused).
  update() {
    const now = performance.now();
    const dt = (now - this._last) / 1000;
    this._last = now;
    if (document.hidden || dt <= 0 || dt > MAX_GAP) return;
    this.played += dt;
    if (this.played < WARMUP) return;
    this.acc += dt;
    this.frames++;
    if (this.acc < WINDOW) return;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    this.strikes = fps < LOW_FPS ? this.strikes + 1 : 0;
    if (this.strikes < 2) return;
    this.strikes = 0;
    const renderer = this.game.renderer;
    const ratio = renderer.getPixelRatio();
    if (ratio > FLOOR + 0.01) {
      renderer.setPixelRatio(Math.max(FLOOR, ratio - STEP)); // (resizes the drawing buffer)
      return;
    }
    if (fps < SLOW_FPS && !this.suggested && this.game.quality?.level !== 'low') {
      this.suggested = true;
      const how = this.hud.hintMode() === 'touch' ? 'Pause' : 'Pause (Esc)';
      this.hud.toast(`Running slowly? ${how} → Settings → Graphics quality: Low`, 7000);
    }
  }

  // Frames around a pause or an overlay don't count.
  reset() {
    this._last = 0;
    this.acc = 0;
    this.frames = 0;
  }
}
