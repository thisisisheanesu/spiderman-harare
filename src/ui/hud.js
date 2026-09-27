import { headingDeg, cardinal } from '../core/geo.js';

// Baseline HUD: street name + compass heading + fps (placeholder — the full HUD replaces this file).
export class Hud {
  async init(game) {
    this.game = game;
    this.root = document.getElementById('hud');
    this.el = document.createElement('div');
    this.el.className = 'hud-basic';
    this.root.appendChild(this.el);
    this._t = 0;
  }

  update(dt, game) {
    this._t += dt;
    if (this._t < 0.2) return;
    this._t = 0;
    const p = game.player.position;
    const dir = game.camera.getWorldDirection(this._dir || (this._dir = p.clone()));
    const deg = headingDeg(dir.x, dir.z);
    const street = game.world.streetNameAt(p.x, p.z) || 'Harare CBD';
    this.el.textContent = `${street} · ${cardinal(deg)} ${deg.toFixed(0)}° · ${p.y.toFixed(0)} m · ${game.fps.toFixed(0)} fps`;
  }
}
