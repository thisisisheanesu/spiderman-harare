import * as THREE from 'three';

// Floating speech bubbles over NPC heads (Shona line + small English gloss), as a pooled DOM layer
// under the HUD. Bubbles follow the speaker, shrink with distance and hide when a building is between
// the camera and the speaker.

const POOL = 10;
const MAX_DIST = 45;
const STYLE_ID = 'npc-bubble-style';
const CSS = `
.npc-bubbles { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.npc-bubble { position: absolute; left: 0; top: 0; max-width: 220px; transform-origin: 50% 100%; padding: 6px 10px 7px; border-radius: 12px;
  background: rgba(255, 253, 246, 0.95); color: #17130f; font: 600 15px/1.2 system-ui, sans-serif;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28); opacity: 0; transition: opacity 0.18s; white-space: normal;
  text-align: center; will-change: transform, opacity; }
.npc-bubble::after { content: ''; position: absolute; left: 50%; bottom: -7px; margin-left: -7px;
  border: 7px solid transparent; border-bottom: 0; border-top-color: rgba(255, 253, 246, 0.95); }
.npc-bubble .en { display: block; margin-top: 2px; font: italic 500 11.5px/1.2 system-ui, sans-serif; color: #6a6258; }
.npc-bubble.react { background: rgba(255, 214, 64, 0.96); }
.npc-bubble.react::after { border-top-color: rgba(255, 214, 64, 0.96); }
.npc-bubble.call { background: rgba(255, 244, 228, 0.96); border: 2px solid #e2711d; }
.npc-bubble.call::after { border-top-color: #e2711d; }
.npc-bubble.show { opacity: 1; }
`;

export class Bubbles {
  constructor(game) {
    this.game = game;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'npc-bubbles';
    (document.getElementById('app') || document.body).appendChild(this.root);
    this.items = [];
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'npc-bubble';
      const sn = document.createElement('span');
      sn.lang = 'sn';
      const en = document.createElement('span');
      en.className = 'en';
      en.lang = 'en';
      el.append(sn, en);
      this.root.appendChild(el);
      this.items.push({ el, sn, en, agent: null, id: 0, until: 0, born: 0, occluded: false, checkT: 0, shown: false, visible: false, x: 0, y: 0, s: 1, dist: 0 });
    }
    this._v = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  // Show text over an agent for `ms` (after `delay` s). kind: 'say' | 'react' | 'call'.
  show(agent, sn, en, ms = 2600, kind = 'say', delay = 0) {
    const t = this.game.time + delay;
    let item = this.items.find((b) => b.agent === agent && b.id === agent.id);
    if (!item) item = this.items.find((b) => !b.agent) || this.items.reduce((p, q) => (q.born < p.born ? q : p));
    item.agent = agent;
    item.id = agent.id;
    item.until = t + ms / 1000;
    item.born = t;
    item.checkT = 0;
    item.sn.textContent = sn || '';
    // Glosses in the phrase data carry translator notes such as "(respectful)"; bubbles show the plain gloss.
    const gloss = (en || '').replace(/\s*\([^)]*\)/g, '').trim();
    item.en.textContent = gloss;
    item.en.style.display = gloss ? '' : 'none';
    item.el.className = `npc-bubble ${kind}${item.shown ? ' show' : ''}`;
    return item;
  }

  activeCount() {
    return this.items.reduce((n, b) => n + (b.agent ? 1 : 0), 0);
  }

  hasBubble(agent) {
    return this.items.some((b) => b.agent === agent && b.id === agent.id);
  }

  update(dt) {
    const game = this.game;
    const cam = game.camera;
    const hidden = game.paused || game.hud?.bigMapOpen;
    const w = game.renderer.domElement.clientWidth;
    const h = game.renderer.domElement.clientHeight;
    const t = game.time;
    for (const b of this.items) {
      if (!b.agent) continue;
      const a = b.agent;
      if (a.id !== b.id || t > b.until) {
        this._hide(b);
        b.agent = null;
        continue;
      }
      // Delayed bubble (possibly on an item that was still showing someone else's words).
      if (t < b.born) {
        this._hide(b);
        continue;
      }
      const v = this._v.set(a.position.x, a.position.y + 2.05 * a.look.scale, a.position.z);
      const dist = v.distanceTo(cam.position);
      if ((b.checkT -= dt) <= 0) {
        b.checkT = 0.25;
        this._dir.subVectors(v, cam.position).normalize();
        const hit = dist < MAX_DIST ? game.world.raycast(cam.position, this._dir, dist - 0.5) : null;
        b.occluded = !!hit && hit.buildingId >= 0;
      }
      v.project(cam);
      if (hidden || dist > MAX_DIST || v.z > 1 || b.occluded || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) {
        this._hide(b);
        continue;
      }
      b.x = (v.x * 0.5 + 0.5) * w;
      b.y = (-v.y * 0.5 + 0.5) * h;
      b.s = Math.max(0.6, Math.min(1.1, 14 / Math.max(1, dist)));
      b.dist = dist;
      b.visible = true;
    }
    // Nudge overlapping bubbles apart vertically (nearest speaker keeps its place).
    const vis = this._vis || (this._vis = []);
    vis.length = 0;
    for (const b of this.items) if (b.agent && b.visible) vis.push(b);
    vis.sort((p, q) => p.dist - q.dist);
    for (let i = 1; i < vis.length; i++) {
      for (let j = 0; j < i; j++) {
        const p = vis[i];
        const q = vis[j];
        if (Math.abs(p.x - q.x) < 170 * Math.max(p.s, q.s) && Math.abs(p.y - q.y) < 46 * Math.max(p.s, q.s)) p.y = q.y - 48 * Math.max(p.s, q.s);
      }
    }
    for (const b of vis) {
      b.el.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px) translate(-50%, -100%) scale(${b.s.toFixed(3)})`;
      if (!b.shown) {
        b.el.classList.add('show');
        b.shown = true;
      }
      b.visible = false;
    }
  }

  _hide(b) {
    if (!b.shown) return;
    b.el.classList.remove('show');
    b.shown = false;
  }
}
