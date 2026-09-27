import * as THREE from 'three';

// Floating speech bubbles over the people of the street (Shona line + small English gloss): one pooled
// DOM layer under the HUD, shared by the pedestrians (social.js) and the hwindis calling from their
// kombis (src/traffic/bubbles.js). Bubbles follow the speaker, shrink with distance and hide when a
// building is between the camera and the speaker.
//
// The layer is also the screen's referee for world labels:
// - a budget (profile): how many bubbles may be up at once, how close the speaker must be, how often a
//   new one may start and how long it stays. Phones and other small screens ('compact', see
//   hud.compact) get at most one (portrait) or two (landscape) bubbles, only for speakers within 15 m of
//   Spider-Man and on screen, a new one every ~3 s at most, shorter-lived and smaller, with the English
//   gloss as one small line; ambient chatter (calls, overheard remarks) only when nothing else is up and
//   at most one every 6-9 s.
// - placement: a bubble never covers Spider-Man (his projected box, plus the centre third of the screen
//   on compact screens) or the HUD (hud.screenBlocks(): compass, panels, subtitles, touch controls). It
//   is pushed clear (its tail then detaches) or hidden when there is no room; on compact screens a bubble
//   that stays hidden (no room, off screen, behind a wall) gives its place up after DROP_HIDDEN s, and a
//   subtitle on screen (hud.subtitleShowing) takes one bubble's place, so there are never more than two
//   text overlays.
// Higher priority speech (a reaction to Spider-Man > a greeting > a call > an overheard remark) may take
// the place of lower priority speech when the budget is full.
//
// API (game.npcs.bubbles, also bubbleLayer(game | game.scene)):
//   show(agent, sn, en, ms, kind, delay)       -> item | null (null: refused by the budget)
//   showAt(key, id, anchor, sn, en, ms, kind, delay) -> item | null; anchor(out: Vector3) writes the world
//                                                 point the tail points at and returns false once gone
//   canShow(kind, pos?)                          -> would a new bubble of this kind be accepted now?
//   release(key), hasBubble(agent), activeCount(), visibleCount(), profile, compact,
//   heroBox ([x0, y0, x1, y1] CSS px: Spider-Man on screen this frame, with a small margin; null when he
//   is behind the camera) for other overlays that must keep off him (the HUD moves the subtitle)
// kind: 'say' (greeting / reply), 'remark' (overheard), 'react' (to Spider-Man), 'call' (vendor / hwindi).

const POOL = 8;
const OCCLUSION_CHECK = 0.25; // s between raycasts per bubble
const HEAD = 0.4; // m above the speaker's head joint (x look.scale) where the tail points
const EDGE = 6; // px kept clear of the screen edges
const PAD = 4; // px between a bubble and what it avoids
const DROP_HIDDEN = 0.8; // s: compact screens drop a bubble that could not be shown this long

export const PROFILES = {
  full: { max: 4, active: 6, range: 45, gap: 0.35, life: 1, minMs: 1800, maxMs: 7000, near: 14, minScale: 0.6, maxScale: 1.1, centre: false, ambient: null },
  compact: { max: 2, active: 2, range: 15, gap: 2.8, life: 0.7, minMs: 1500, maxMs: 3200, near: 10, minScale: 0.78, maxScale: 1, centre: true, ambient: [6, 9] },
};
// A portrait phone has room for one bubble beside Spider-Man.
PROFILES.compactPortrait = { ...PROFILES.compact, max: 1, active: 1 };
const PRIORITY = { react: 3, say: 2, call: 1, remark: 0 };
const AMBIENT = new Set(['call', 'remark']); // not addressed to Spider-Man

const STYLE_ID = 'npc-bubble-style';
const CSS = `
.npc-bubbles { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.npc-bubble { --tail-x: 50%; position: absolute; left: 0; top: 0; max-width: 220px; transform-origin: 0 0; padding: 6px 10px 7px;
  border-radius: 12px; background: rgba(255, 253, 246, 0.95); color: #17130f; font: 600 15px/1.2 system-ui, sans-serif;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28); opacity: 0; transition: opacity 0.18s; white-space: normal;
  text-align: center; will-change: transform, opacity; }
.npc-bubble::after { content: ''; position: absolute; left: var(--tail-x); bottom: -7px; margin-left: -7px;
  border: 7px solid transparent; border-bottom: 0; border-top-color: rgba(255, 253, 246, 0.95); }
.npc-bubble.detached::after { display: none; }
.npc-bubble .en { display: block; margin-top: 2px; font: italic 500 11.5px/1.2 system-ui, sans-serif; color: #6a6258; }
.npc-bubble.react { background: rgba(255, 214, 64, 0.96); }
.npc-bubble.react::after { border-top-color: rgba(255, 214, 64, 0.96); }
.npc-bubble.call { background: rgba(255, 244, 228, 0.96); border: 2px solid #e2711d; }
.npc-bubble.call::after { border-top-color: #e2711d; }
.npc-bubble.show { opacity: 1; }
.npc-bubbles.compact .npc-bubble { max-width: 168px; padding: 4px 8px 5px; border-radius: 10px; font-size: 13px; line-height: 1.18;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25); }
.npc-bubbles.compact .npc-bubble .en { margin-top: 1px; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.npc-bubbles.compact .npc-bubble::after { bottom: -5px; margin-left: -5px; border-width: 5px; border-bottom: 0; }
`;

const layers = new WeakMap();

// The bubble layer of a game (or of its scene), or null before the npcs system made it.
export function bubbleLayer(key) {
  return (key && layers.get(key)) || null;
}

function isCompactScreen() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  return Math.min(w, h) <= (coarse ? 540 : 420);
}

function overlaps(a, b) {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

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
      this.items.push({
        el, sn, en, key: null, id: 0, anchor: null, kind: 'say', prio: 0, until: 0, born: 0,
        occluded: false, checkT: 0, shown: false, hiddenT: 0, w: 0, h: 0, x: 0, y: 0, s: 1, dist: 0, ax: 0, ay: 0, tail: -1, detached: false,
      });
    }
    this.compact = false;
    this.portrait = false;
    this.profile = PROFILES.full;
    this.lastStart = -1e9;
    this.ambientAt = 0; // compact: game time from which ambient chatter may show again
    this.stats = { shown: 0, refused: 0 };
    this._v = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._vis = [];
    this._placed = [];
    this._centre = [0, 0, 0, 0];
    this._hero = [0, 0, 0, 0];
    this.heroBox = null;
    this._keep = []; // the boxes above that apply this frame
    this._syncProfile();
    layers.set(game, this);
    if (game.scene) layers.set(game.scene, this);
  }

  // --- budget -------------------------------------------------------------------------------------

  _syncProfile() {
    const hud = this.game.hud;
    const compact = typeof hud?.compact === 'boolean' ? hud.compact : isCompactScreen();
    const w = this.game.renderer?.domElement?.clientWidth || window.innerWidth;
    const h = this.game.renderer?.domElement?.clientHeight || window.innerHeight;
    this.portrait = h > w;
    if (compact !== this.compact || !this._profiled) {
      this.compact = compact;
      this._profiled = true;
      this.root.classList.toggle('compact', compact);
      for (const b of this.items) b.w = 0; // re-measure in the new style
    }
    this.profile = !compact ? PROFILES.full : this.portrait ? PROFILES.compactPortrait : PROFILES.compact;
  }

  _listener() {
    return this.game.player?.position || this.game.camera.position;
  }

  // Speaker close enough (compact: to Spider-Man) and in front of the camera, on screen?
  _inView(pos, slack = 1) {
    const prof = this.profile;
    const l = this._listener();
    if (Math.hypot(pos.x - l.x, pos.z - l.z) > prof.range * slack) return false;
    if (!this.compact) return true;
    const v = this._dir.copy(pos).project(this.game.camera);
    return v.z < 1 && Math.abs(v.x) < 0.96 && Math.abs(v.y) < 0.96;
  }

  _live(t) {
    let n = 0;
    for (const b of this.items) if (b.key && b.until > t) n++;
    return n;
  }

  // The lowest-priority live bubble a `prio` bubble may replace (null if none).
  _evictable(prio, t) {
    let worst = null;
    for (const b of this.items) {
      if (!b.key || b.until <= t || b.prio >= prio) continue;
      if (!worst || b.prio < worst.prio || (b.prio === worst.prio && b.born < worst.born)) worst = b;
    }
    return worst;
  }

  // Would a new bubble of `kind` (spoken at world position `pos`, optional) be accepted now?
  canShow(kind = 'say', pos = null) {
    const t = this.game.time;
    const prof = this.profile;
    const prio = PRIORITY[kind] ?? 1;
    if (pos && !this._inView(pos)) return false;
    if (prof.ambient && AMBIENT.has(kind) && (t < this.ambientAt || this._live(t) > 0)) return false;
    // Reactions to Spider-Man may start inside the gap; everything else waits its turn.
    if (t - this.lastStart < prof.gap && !(prio >= PRIORITY.react && this._live(t) === 0)) return false;
    return this._live(t) < prof.active || !!this._evictable(prio, t);
  }

  // --- showing ------------------------------------------------------------------------------------

  // Show text over a pedestrian for `ms` (after `delay` s).
  show(agent, sn, en, ms = 2600, kind = 'say', delay = 0) {
    const id = agent.id;
    const anchor = (out) => {
      if (agent.id !== id) return false;
      out.set(agent.position.x, (agent.headY ?? agent.position.y + 1.65) + HEAD * (agent.look?.scale ?? 1), agent.position.z);
      return true;
    };
    return this.showAt(agent, id, anchor, sn, en, ms, kind, delay);
  }

  // Show text anchored to anything: `key` identifies the speaker (one bubble each), `id` must still match
  // key.id when shown (pooled objects), `anchor(out)` gives the world point (false once gone).
  showAt(key, id, anchor, sn, en, ms = 2600, kind = 'say', delay = 0) {
    this._syncProfile();
    const prof = this.profile;
    const t = this.game.time;
    const prio = PRIORITY[kind] ?? 1;
    let item = this.items.find((b) => b.key === key && b.id === id);
    if (!item) {
      const pos = anchor(this._v) ? this._v : null;
      if (!pos || !this.canShow(kind, pos)) {
        this.stats.refused++;
        return null;
      }
      if (this._live(t) >= prof.active) item = this._evictable(prio, t);
      if (!item) item = this.items.find((b) => !b.key || b.until <= t) || this.items.reduce((p, q) => (q.born < p.born ? q : p));
      this.lastStart = t + delay;
      if (prof.ambient && AMBIENT.has(kind)) this.ambientAt = t + prof.ambient[0] + Math.random() * (prof.ambient[1] - prof.ambient[0]);
      this.stats.shown++;
    }
    if (item.key !== key || item.id !== id) this._hide(item);
    item.key = key;
    item.id = id;
    item.anchor = anchor;
    item.kind = kind;
    item.prio = prio;
    item.born = t + delay;
    item.until = item.born + Math.min(prof.maxMs, Math.max(prof.minMs, ms * prof.life)) / 1000;
    item.checkT = 0;
    item.hiddenT = 0;
    item.w = 0;
    item.tail = -1;
    item.sn.textContent = sn || '';
    // Glosses in the phrase data carry translator notes such as "(respectful)"; bubbles show the plain gloss.
    const gloss = (en || '').replace(/\s*\([^)]*\)/g, '').trim();
    item.en.textContent = gloss === sn ? '' : gloss;
    item.en.style.display = item.en.textContent ? '' : 'none';
    item.el.className = `npc-bubble ${kind}${item.shown ? ' show' : ''}${item.detached ? ' detached' : ''}`;
    return item;
  }

  release(key) {
    for (const b of this.items) {
      if (b.key !== key) continue;
      this._hide(b);
      b.key = null;
      b.anchor = null;
    }
  }

  activeCount() {
    const t = this.game.time;
    return this._live(t);
  }

  visibleCount() {
    let n = 0;
    for (const b of this.items) if (b.shown) n++;
    return n;
  }

  hasBubble(agent) {
    return this.items.some((b) => b.key === agent && b.id === agent.id);
  }

  // --- per frame ----------------------------------------------------------------------------------

  update(dt) {
    const game = this.game;
    const cam = game.camera;
    this._syncProfile();
    const prof = this.profile;
    // A subtitle on screen counts as one of a compact screen's text overlays.
    const max = this.compact && game.hud?.subtitleShowing ? Math.max(1, prof.max - 1) : prof.max;
    const hidden = game.paused || game.hud?.bigMapOpen;
    const w = game.renderer.domElement.clientWidth;
    const h = game.renderer.domElement.clientHeight;
    const t = game.time;
    const listener = this._listener();
    const vis = this._vis;
    vis.length = 0;
    for (const b of this.items) {
      if (!b.key) continue;
      const v = this._v;
      const lost = this.compact && b.hiddenT > DROP_HIDDEN;
      if (t > b.until || lost || !b.anchor(v)) {
        this._hide(b);
        b.key = null;
        b.anchor = null;
        continue;
      }
      // Delayed bubble (possibly on an item that was still showing someone else's words).
      if (t < b.born || hidden) {
        this._hide(b);
        continue;
      }
      const dist = v.distanceTo(cam.position);
      if ((b.checkT -= dt) <= 0) {
        b.checkT = OCCLUSION_CHECK;
        this._dir.subVectors(v, cam.position).normalize();
        const hit = dist < prof.range + 20 ? game.world.raycast(cam.position, this._dir, dist - 0.5) : null;
        b.occluded = !!hit && hit.buildingId >= 0;
      }
      const far = Math.hypot(v.x - listener.x, v.z - listener.z) > prof.range * 1.25;
      v.project(cam);
      if (far || v.z > 1 || b.occluded || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) {
        this._hide(b);
        b.hiddenT += dt;
        continue;
      }
      b.ax = (v.x * 0.5 + 0.5) * w;
      b.ay = (-v.y * 0.5 + 0.5) * h;
      b.s = Math.max(prof.minScale, Math.min(prof.maxScale, prof.near / Math.max(1, dist)));
      b.dist = dist;
      vis.push(b);
    }
    this._keepOut(w, h);
    if (!vis.length) return;
    // Most important first, then nearest; only the budget's worth is drawn.
    vis.sort((p, q) => q.prio - p.prio || p.dist - q.dist);
    const blocks = game.hud?.screenBlocks?.() || [];
    const placed = this._placed;
    placed.length = 0;
    let drawn = 0;
    for (const b of vis) {
      if (drawn >= max || !this._place(b, w, h, blocks, placed)) {
        this._hide(b);
        b.hiddenT += dt;
        continue;
      }
      b.hiddenT = 0;
      drawn++;
      placed.push([b.x, b.y, b.x + b.w * b.s, b.y + b.h * b.s]);
      b.el.style.transform = `translate3d(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px, 0) scale(${b.s.toFixed(3)})`;
      if (!b.shown) {
        b.el.classList.add('show');
        b.shown = true;
      }
    }
  }

  // Screen boxes that bubbles must stay out of (this._keep): Spider-Man (projected, with a margin) and,
  // on compact screens, the centre third of the view.
  _keepOut(w, h) {
    const player = this.game.player;
    const cam = this.game.camera;
    const keep = this._keep;
    keep.length = 0;
    this.heroBox = null;
    if (this.profile.centre) {
      const c = this._centre;
      c[0] = w / 3;
      c[1] = h / 3;
      c[2] = (2 * w) / 3;
      c[3] = (2 * h) / 3;
      keep.push(c);
    }
    if (!player?.position) return;
    const p = player.position;
    const ht = player.height || 1.8;
    const r = (player.radius || 0.4) + 0.35;
    const right = this._right.setFromMatrixColumn(cam.matrixWorld, 0);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < 4; i++) {
      const sx = i & 1 ? r : -r;
      const up = i & 2 ? ht + 0.35 : -0.15;
      const v = this._v.set(p.x + right.x * sx, p.y + up, p.z + right.z * sx).project(cam);
      if (v.z > 1) return;
      const px = (v.x * 0.5 + 0.5) * w;
      const py = (-v.y * 0.5 + 0.5) * h;
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    const m = 10;
    const hero = this._hero;
    hero[0] = x0 - m;
    hero[1] = y0 - m;
    hero[2] = x1 + m;
    hero[3] = y1 + m;
    keep.push(hero);
    this.heroBox = hero;
  }

  // Put bubble b next to its speaker, clear of Spider-Man, the HUD and the bubbles already placed.
  // Returns false when there is no room nearby (the bubble then stays hidden this frame).
  _place(b, w, h, blocks, placed) {
    if (!b.w) {
      b.w = b.el.offsetWidth;
      b.h = b.el.offsetHeight;
      if (!b.w) return false;
    }
    const bw = b.w * b.s;
    const bh = b.h * b.s;
    const tail = (this.compact ? 5 : 7) * b.s;
    const ox = Math.min(Math.max(b.ax - bw / 2, EDGE), w - EDGE - bw);
    const oy = b.ay - bh - tail;
    const obstacles = this._obstacles || (this._obstacles = []);
    obstacles.length = 0;
    for (const r of this._keep) obstacles.push(r);
    for (const r of blocks) obstacles.push(r);
    for (const r of placed) obstacles.push(r);
    const rect = this._rect || (this._rect = [0, 0, 0, 0]);
    const free = (x, y) => {
      if (x < EDGE || y < EDGE || x + bw > w - EDGE || y + bh > h - EDGE) return false;
      rect[0] = x;
      rect[1] = y;
      rect[2] = x + bw;
      rect[3] = y + bh;
      for (const o of obstacles) if (overlaps(rect, o)) return false;
      return true;
    };
    let bx = ox;
    let by = oy;
    if (!free(ox, oy)) {
      // Candidates: slide above / below / beside each obstacle the bubble runs into, two levels deep.
      let best = Infinity;
      const maxShift = Math.max(90, Math.min(w, h) * 0.4);
      const tryFrom = (x, y, depth) => {
        rect[0] = x;
        rect[1] = y;
        rect[2] = x + bw;
        rect[3] = y + bh;
        const hits = [];
        for (const o of obstacles) if (overlaps(rect, o)) hits.push(o);
        for (const o of hits) {
          const cands = [
            [x, o[1] - bh - PAD],
            [x, o[3] + PAD],
            [o[0] - bw - PAD, y],
            [o[2] + PAD, y],
          ];
          for (const [cx, cy] of cands) {
            const d = Math.hypot(cx - ox, cy - oy);
            if (d >= best || d > maxShift) continue;
            if (free(cx, cy)) {
              best = d;
              bx = cx;
              by = cy;
            } else if (depth > 0) tryFrom(cx, cy, depth - 1);
          }
        }
      };
      tryFrom(ox, oy, 1);
      if (best === Infinity) return false;
    }
    b.x = bx;
    b.y = by;
    // The tail points at the speaker while the bubble sits over them; a pushed-aside bubble loses it.
    const detached = by + bh + tail < b.ay - 18 || by > b.ay || b.ax < bx + 6 || b.ax > bx + bw - 6;
    if (detached !== b.detached) {
      b.detached = detached;
      b.el.classList.toggle('detached', detached);
    }
    if (!detached) {
      const tx = Math.round(Math.min(b.w - 10, Math.max(10, (b.ax - bx) / b.s)));
      if (tx !== b.tail) {
        b.tail = tx;
        b.el.style.setProperty('--tail-x', `${tx}px`);
      }
    }
    return true;
  }

  _hide(b) {
    if (!b.shown) return;
    b.el.classList.remove('show');
    b.shown = false;
  }
}
