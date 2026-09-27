import * as THREE from 'three';
import './hud.css';
import { headingDeg } from '../core/geo.js';
import { Settings } from './settings.js';
import { Places } from './places.js';
import { MapPainter } from './mapPainter.js';
import { Minimap } from './minimap.js';
import { Compass } from './compass.js';
import { BigMap } from './bigmap.js';
import { Notices } from './notices.js';
import { PauseMenu, HelpOverlay } from './menus.js';
import { MenuNav } from './menuNav.js';
import { TouchControls } from './touch.js';
import { Tour } from './tour.js';
import { PerfWatch } from './perf.js';
import { enableDragLook } from './dragLook.js';
import { controlsHint } from './controls.js';
import { el, isCoarsePointer, setText, toggleClass } from './dom.js';
import './compact.css';

const TEXT_INTERVAL = 0.2; // s between DOM text refreshes (~5 Hz)
const HINT_SECONDS = 20;
const COMPACT_HINT_SECONDS = 7;
const LOCATION_MS = 6000; // compact: the location chip shows this long after the street changes
const BLOCKS_MS = 250; // screenBlocks() refresh
const SUBS_FLIP_MS = 1000; // compact: the subtitle's slot changes at most this often
// Compact layout (phones): the smaller side of the view at most this (px); a mouse-only window must be
// smaller still (a small desktop window keeps the full HUD).
const COMPACT_TOUCH = 540;
const COMPACT_MOUSE = 420;
const WAYPOINT_REACHED = 25; // m
const LOCK_HINT_MS = 5000;
const FREE_HINT_MS = 9000; // first "drag to look" notice when the mouse can't be captured
const LOCK_TEXT = 'Click to capture the mouse · or drag to look';
const FREE_TEXT = 'Drag the mouse to look · hold Shift to swing';
// npc:speak clip kinds that appear as speech bubbles, not subtitles (FLEURS barks, extras greetings).
const BUBBLE_KINDS = new Set(['bark', 'greet', 'exclaim', 'call']);

// HUD system (game.hud): minimap, compass, location readout, subtitles / toasts / objective,
// big map, pause menu, help and touch controls. Owns every overlay and pauses the game while one
// is open.
//
// Public API: showSubtitle({speaker, sn, en, ms}), toast(text, ms), setObjective(text|null),
// bigMapOpen, waypoint ({x, z, label} | null), setWaypoint(x, z), clearWaypoint(),
// openOverlay('map'|'pause'|'help'), closeOverlay(), settings,
// compact (bool: phone-sized view; the HUD folds into chips and world labels are rationed, see
// src/npc/bubbles.js), portrait (bool), subtitleMode ('full' | 'compact' | 'off', resolved from the
// 'subtitles' setting), subtitleShowing (bool), safeInsets ({top, right, bottom, left} CSS px of notches /
// home indicator), screenBlocks() -> [[x0, y0, x1, y1], ...] (CSS px boxes of the HUD on screen now:
// compass, panels, subtitle, toasts, hints, minimap, touch controls, unsafe screen edges) for anything
// drawn over the world that must not sit under / over the HUD.
function rectOf(node) {
  const b = node.getBoundingClientRect();
  return [b.left, b.top, b.right, b.bottom];
}

export class Hud {
  async init(game) {
    this.game = game;
    this.settings = new Settings();
    this.places = new Places(game.data);
    this.overlay = null;
    this.waypoint = null;
    this.started = false;
    this.heading = 0;
    this._dir = new THREE.Vector3();
    this._textT = TEXT_INTERVAL; // refresh the text on the first frame
    this._hintT = 0;
    this._lockHintUntil = 0;
    this.lockless = false; // desktop without pointer lock (refused, e.g. in a sandboxed iframe)
    this.lockBlocked = false; // ...for good: the page may never capture the mouse
    this.compact = false;
    this.portrait = false;
    this._blocks = [];
    this._blocksAt = -1e9;
    this._locUntil = 0;
    this._subsSlot = 0; // compact subtitle: 0 = usual slot, 1 = the other one (landscape), -1 = held back
    this._subsFlipAt = 0;
    this.safeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

    this.root = document.getElementById('hud');
    this.root.classList.add('hud');
    this.root.replaceChildren();

    const painter = new MapPainter(game.data);
    this._buildHud(painter);
    this.bigMap = new BigMap(this, painter, this.minimap.levels);
    this.pauseMenu = new PauseMenu(this);
    this.help = new HelpOverlay(this);
    this.overlays = { map: this.bigMap, pause: this.pauseMenu, help: this.help };
    this.nav = new MenuNav();
    this.touch = new TouchControls(this);
    this.tour = new Tour(this);
    this.perf = new PerfWatch(this);
    enableDragLook(game, this.settings);

    for (const k of Object.keys(this.settings.values)) this._apply(k, this.settings.get(k));
    this._wireEvents();
    if (isCoarsePointer()) this.touch.enable();
    this.onResize();
  }

  _buildHud(painter) {
    this.street = el('div', 'loc-street');
    this.near = el('div', 'loc-near');
    this.alt = el('span', 'stat');
    this.speed = el('span', 'stat');
    const top = el('div', 'hud-top');
    this.locationPanel = el('div', 'location panel', null, [this.street, this.near, el('div', 'loc-stats', null, [this.alt, this.speed])]);
    const left = el('div', 'hud-left', null, [this.locationPanel]);
    this.hint = el('div', 'controls-hint panel');
    this.lockHint = el('div', 'lock-hint', { text: LOCK_TEXT });
    this.safeProbe = el('div', 'safe-probe', { 'aria-hidden': 'true' });
    this.root.append(top, left, this.hint, this.lockHint, this.safeProbe);
    this.compass = new Compass(top, this.places);
    this.minimap = new Minimap(this.root, painter, this.places, this.game.quality.level);
    this.minimap.root.addEventListener('click', () => this.openOverlay('map'));
    this.notices = new Notices(this.root, left);
    this.notices.onChange = () => {
      this._blocksAt = -1e9; // screenBlocks() measures again on its next call
    };
  }

  _wireEvents() {
    const { game } = this;
    game.events.on('hud:toast', (e) => this.toast(e?.text, e?.ms));
    game.events.on('npc:speak', (e) => this._npcSpoke(e));
    game.events.on('game:pause', () => this.perf.reset());
    game.events.on('game:start', () => {
      this.started = true;
      this.root.classList.add('started');
      this._showHint(true);
      if (this.settings.get('tour')) this.tour.start();
    });
    const canvas = game.renderer.domElement;
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) {
        this._hadLock = true;
        this._setLockless(false);
      } else if (this.started && this._hadLock && !game.paused && !this.overlay) {
        this.openOverlay('pause');
      }
    });
    // Mouse capture refused (no user gesture yet, Esc used to resume...): browsers without the
    // promise form of requestPointerLock only report it here.
    document.addEventListener('pointerlockerror', () => this._lockFailed(null));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      this.touch.reset();
      if (this.started && !this.overlay) this.openOverlay('pause');
    });
    // First touch anywhere switches the HUD to touch controls (also on hybrid laptops).
    window.addEventListener('touchstart', () => this.touch.enable(), { capture: true, passive: true, once: true });
  }

  // --- public API -------------------------------------------------------------------------------

  get bigMapOpen() {
    return this.overlay === 'map';
  }

  get inputMode() {
    if (this.game.input.usingGamepad) return 'gamepad';
    return this.touch?.enabled ? 'touch' : 'keyboard';
  }

  // Capture the mouse (desktop). Refusals switch the HUD to drag-to-look hints; a refusal because the
  // page is sandboxed without pointer-lock permission is final, so later clicks stop asking.
  requestLock() {
    const input = this.game.input;
    if (this.touch.enabled || input.usingTouch || this.lockBlocked || input.pointerLocked) return;
    let req;
    try {
      req = input.dom.requestPointerLock?.();
    } catch (err) {
      this._lockFailed(err);
      return;
    }
    if (req?.then) req.then(() => this._setLockless(false), (err) => this._lockFailed(err));
  }

  // 'keyboard' | 'touch' | 'gamepad', or 'free' for keyboard + mouse without pointer lock.
  hintMode() {
    const mode = this.inputMode;
    return mode === 'keyboard' && this.lockless ? 'free' : mode;
  }

  // A subtitle is on screen now.
  get subtitleShowing() {
    return !!this.notices?.current;
  }

  // 'full' | 'compact' | 'off': the 'subtitles' setting, with 'auto' resolved by the device: compact on
  // phones and on touch tablets (whose full subtitle box sat on Spider-Man), full with a mouse / gamepad.
  get subtitleMode() {
    const v = this.settings.get('subtitles');
    return v === 'full' || v === 'compact' || v === 'off' ? v : this.compact || this.touch?.enabled ? 'compact' : 'full';
  }

  // Boxes (CSS px, [x0, y0, x1, y1]) the HUD occupies on screen right now, refreshed a few times a
  // second. World labels (speech bubbles) keep out of them. The array is reused: copy what you keep.
  screenBlocks() {
    const now = performance.now();
    if (now - this._blocksAt < BLOCKS_MS) return this._blocks;
    this._blocksAt = now;
    const out = this._blocks;
    out.length = 0;
    if (!this.started || this.overlay) return out;
    // appearing: fading in right now (count it before its opacity rises).
    const add = (node, appearing = false) => {
      if (!node?.isConnected) return;
      const r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const cs = getComputedStyle(node);
      if (cs.visibility === 'hidden' || (!appearing && Number(cs.opacity) < 0.05)) return;
      out.push([r.left, r.top, r.right, r.bottom]);
    };
    add(this.compass.root);
    if (!this.compass.caption.classList.contains('is-empty')) add(this.compass.caption);
    add(this.locationPanel);
    if (this.notices.objective.classList.contains('shown')) add(this.notices.objective);
    add(this.notices.current?.node, true);
    for (const t of this.notices.toastRoot.children) if (!t.classList.contains('out')) add(t, true);
    if (this._hintOn) add(this.hint, true);
    add(this.lockHint.classList.contains('shown') ? this.lockHint : null);
    add(this.minimap.root);
    if (this.touch.enabled) for (const node of this.touch.blocks()) add(node);
    // Notches, rounded corners, the home indicator.
    const s = this.safeInsets;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (s.left > 0) out.push([0, 0, s.left, h]);
    if (s.right > 0) out.push([w - s.right, 0, w, h]);
    if (s.top > 0) out.push([0, 0, w, s.top]);
    if (s.bottom > 0) out.push([0, h - s.bottom, w, h]);
    return out;
  }

  showSubtitle(sub) {
    this.notices.showSubtitle(sub);
  }

  // Remove a subtitle whose speaker is out of earshot ({sn, en} as it was shown).
  dropSubtitle(sub) {
    this.notices.dropSubtitle(sub);
  }

  toast(text, ms) {
    this.notices.toast(text, ms);
  }

  // detail (optional): {how: one line on how to do it, step: e.g. '2/5'}.
  setObjective(text, detail) {
    this.notices.setObjective(text, detail);
  }

  flashObjective() {
    this.notices.flashObjective();
  }

  // opts (optional): {label, tour (set by the objective chain: no "reached" toast), quiet (no click)}.
  // Returns the waypoint.
  setWaypoint(x, z, opts = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const near = this.places.nearest(x, z, 120);
    const label = opts.label || near?.name || this.game.world.streetNameAt(x, z) || 'Marked spot';
    if (!opts.tour && this.waypoint?.tour) this.tour.yieldWaypoint(); // the player's own pin wins
    this.waypoint = { x, z, label, tour: !!opts.tour };
    this.bigMap.syncWaypoint();
    if (!opts.quiet) this.game.audio?.playSfx?.('ui');
    return this.waypoint;
  }

  clearWaypoint() {
    this.waypoint = null;
    this.bigMap.syncWaypoint();
  }

  setSetting(key, value) {
    this.settings.set(key, value);
    this._apply(key, value);
    // Switching the guided tour on (again) replays it; off drops its objective and waypoint.
    if (key === 'tour' && this.started) {
      if (value && !this.tour.running) this.tour.start();
      else if (!value && this.tour.running) this.tour.stop();
    }
  }

  openOverlay(name) {
    if (!this.started || this.overlay === name) return;
    if (this.overlay) this.overlays[this.overlay].hide();
    else this.game.audio?.playSfx?.('ui');
    this.overlay = name;
    this._openedAt = performance.now();
    this.overlays[name].show();
    this.root.classList.add('has-overlay');
    if (name === 'map') this.nav.detach();
    else this.nav.attach(this.overlays[name].root);
    this.touch.reset();
    if (name === 'help') this._showHint(false);
    this.game.setPaused(true);
    this.game.input.exitPointerLock();
  }

  closeOverlay() {
    if (!this.overlay) return;
    this.overlays[this.overlay].hide();
    this.overlay = null;
    this.nav.detach();
    this.root.classList.remove('has-overlay');
    document.activeElement?.blur?.();
    this.game.audio?.playSfx?.('ui');
    this.game.setPaused(false);
    this.requestLock();
  }

  // "Samora Machel Avenue · near Africa Unity Square"
  locationText() {
    const { street, detail } = this._location();
    return detail ? `${street} · ${detail}` : street;
  }

  // --- system hooks -----------------------------------------------------------------------------

  onResize() {
    this._layout();
    this.minimap.resize();
    this.compass.resize();
    this.bigMap.resize();
  }

  // Compact (phone) layout on small views; see COMPACT_TOUCH.
  _layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const touch = this.touch?.enabled || isCoarsePointer();
    const compact = Math.min(w, h) <= (touch ? COMPACT_TOUCH : COMPACT_MOUSE);
    this.portrait = h > w;
    const r = this.safeProbe.getBoundingClientRect();
    const s = this.safeInsets;
    s.left = Math.max(0, r.left);
    s.top = Math.max(0, r.top);
    s.right = Math.max(0, w - r.right);
    s.bottom = Math.max(0, h - r.bottom);
    toggleClass(this.root, 'portrait', this.portrait);
    toggleClass(this.root, 'landscape', !this.portrait);
    this._blocksAt = -1e9;
    if (compact !== this.compact || !this._laidOut) {
      this._laidOut = true;
      this.compact = compact;
      toggleClass(this.root, 'compact', compact);
      this.notices.setCompact(compact);
      this._locUntil = performance.now() + LOCATION_MS;
    }
    // Also when only the input changed (touch.enable() lays out again): 'auto' follows it.
    this.notices.setMode(this.subtitleMode);
  }

  update(dt, game) {
    const input = game.input;
    if (this.started) {
      if (input.pressed('map')) this.openOverlay('map');
      else if (input.pressed('pause')) this.openOverlay('pause');
      else if (input.pressed('help')) this.openOverlay('help');
    }

    if (this.started) this.perf.update();

    const p = game.player?.position;
    if (!p) return;
    game.camera.getWorldDirection(this._dir);
    if (Math.hypot(this._dir.x, this._dir.z) > 0.02) this.heading = headingDeg(this._dir.x, this._dir.z);
    const facing = (((-(game.player.heading || 0) * 180) / Math.PI) % 360 + 360) % 360;
    const speed = game.player.speed ?? game.player.velocity?.length() ?? 0;
    this.minimap.draw(dt, p, this.heading, facing, speed, this.waypoint);
    this.compass.draw(this.heading, p, this.waypoint);
    // Subtitles follow wall-clock time like the voices do (dt is clamped when frames are slow).
    const now = performance.now();
    this.notices.updateSubtitles(Math.min(250, now - (this._lastFrame ?? now)));
    this._lastFrame = now;
    if (this.compact) this._keepSubtitleOffHero(now, false);

    if (this.started && this._hintOn) {
      this._hintT += dt;
      if (this._hintT > (this.compact ? COMPACT_HINT_SECONDS : HINT_SECONDS)) this._showHint(false);
    }
    this._textT += dt;
    if (this._textT >= TEXT_INTERVAL) {
      this._refreshText(p, speed);
      if (this.started) this.tour.update(this._textT);
      this._textT = 0;
    }
  }

  pausedUpdate(dt, game) {
    const input = game.input;
    this._lastFrame = performance.now(); // pause time doesn't count against subtitles
    if (!this.started) {
      // Gamepad players can start from the title screen with A.
      if (input.usingGamepad && input.pressed('jump')) document.getElementById('start')?.click();
      return;
    }
    if (!this.overlay) return;
    const fresh = performance.now() - this._openedAt > 250;
    const padBack = this.overlay === 'map' ? input.usingGamepad && input.pressed('dive') : this.nav.poll(dt) === 'back';
    if (this.overlay === 'map') this.bigMap.update(dt, input, this.inputMode);

    if (!fresh) return;
    if (padBack || input.pressed('pause') || input.pressed(this.overlay)) this.closeOverlay();
    else if (input.pressed('map')) this.openOverlay('map');
    else if (input.pressed('help')) this.openOverlay('help');
  }

  // --- internals --------------------------------------------------------------------------------

  _apply(key, v) {
    const { game } = this;
    if (key === 'master') game.audio?.setMasterVolume?.(v);
    else if (key === 'voices' || key === 'sfx' || key === 'ambience') game.audio?.setBusVolume?.(key, v);
    else if (key === 'muted' && game.audio) game.audio.muted = v;
    else if (key === 'sensitivity') game.input.mouseSensitivity = v;
    else if (key === 'invertY') game.input.invertY = v;
    else if (key === 'subtitles') this.notices.setMode(this.subtitleMode);
  }

  // Street as the title; the detail says which rooftop / park the player is on, or what is nearby.
  _location() {
    const { world } = this.game;
    const p = this.game.player.position;
    const street = world.streetNameAt(p.x, p.z);
    const area = this.places.areaAt(p.x, p.z);
    const near = this.places.nearest(p.x, p.z, 350);
    const district = this.places.district(p.x, p.z);
    const title = street || area || near?.name || district;
    const roof = world.buildingAt(p.x, p.z);
    const roofName = roof && p.y > roof.h - 3 ? this.places.nameOf(roof) : '';
    let detail = '';
    if (roofName) detail = `atop ${roofName}`;
    else if (area && area !== title) detail = `in ${area}`;
    else if (near && near.name !== title) detail = `near ${near.name}`;
    else if (title !== district) detail = district;
    return { street: title, detail };
  }

  _refreshText(p, speed) {
    const { street, detail } = this._location();
    // Compact: the location chip comes up when the street changes, then fades (the compass caption
    // and the minimap keep saying where things are).
    const now = performance.now();
    if (street !== this.street._text) this._locUntil = now + LOCATION_MS;
    toggleClass(this.locationPanel, 'faded', this.compact && now > this._locUntil);
    setText(this.street, street);
    setText(this.near, detail);
    this._keepSubtitleOffHero(now, true);
    setText(this.alt, `ALT ${Math.max(0, Math.round(p.y))} m`);
    setText(this.speed, `${Math.round(speed * 3.6)} km/h`);
    this.compass.updateCaption();

    const mode = this.hintMode();
    if (this._hintOn && this._hintMode !== mode) this._fillHint(mode);

    // Desktop without pointer lock: briefly say how to look around (and get the mouse back).
    const unlocked = this.started && !this.game.paused && !this.touch.enabled && (mode === 'keyboard' || mode === 'free') && !this.game.input.pointerLocked;
    toggleClass(this.lockHint, 'shown', unlocked && performance.now() < this._lockHintUntil);

    const wp = this.waypoint;
    if (wp && !wp.tour && Math.hypot(wp.x - p.x, wp.z - p.z) < WAYPOINT_REACHED) {
      this.toast(`Waypoint reached · ${wp.label}`);
      this.clearWaypoint();
    }
  }

  // Compact: the subtitle never covers Spider-Man (his box from the bubble layer). Its usual slot is
  // under the top HUD (portrait) or low between the thumbs (landscape); when he is there (a jump, a
  // dive, a camera tilt) a landscape subtitle moves up under the compass, and one with nowhere to go
  // waits hidden (its time keeps running) until he has moved on. Checked every frame against the
  // subtitle's last measured box; measured again (measure = true) at the text refresh rate.
  _keepSubtitleOffHero(now, measure) {
    const node = this.notices.current?.node;
    const hero = this.game.npcs?.bubbles?.heroBox;
    if (!this.compact || !node || !hero) {
      this._subsNode = null;
      this._subsSlot = 0;
      this._setSubsSlot(0);
      return;
    }
    if (node !== this._subsNode || measure || !this._subsRect) {
      this._subsNode = node;
      this._subsRect = rectOf(node);
    }
    const hits = (r) => r[0] < hero[2] && r[2] > hero[0] && r[1] < hero[3] && r[3] > hero[1];
    const held = this._subsSlot === -1;
    const blocked = !held && hits(this._subsRect);
    // Held back, or away from the usual slot: look again at the text rate (the usual slot at most
    // every SUBS_FLIP_MS).
    const retry = measure && (held || (this._subsSlot === 1 && now >= this._subsFlipAt));
    if (!blocked && !retry) return;
    let slot = -1;
    for (const s of this.portrait ? [0] : [0, 1]) {
      this._setSubsSlot(s);
      const r = rectOf(node);
      if (!hits(r)) {
        slot = s;
        this._subsRect = r;
        break;
      }
    }
    if (slot === -1 && !blocked && !held) slot = this._subsSlot; // nothing better than where it is
    if (slot !== this._subsSlot) this._subsFlipAt = now + SUBS_FLIP_MS;
    this._subsSlot = slot;
    this._setSubsSlot(slot);
  }

  _setSubsSlot(slot) {
    const alt = slot === 1;
    const off = slot === -1;
    if (this.root.classList.contains('subs-alt') === alt && this.root.classList.contains('subs-off') === off) return;
    toggleClass(this.root, 'subs-alt', alt);
    toggleClass(this.root, 'subs-off', off);
    this._blocksAt = -1e9;
  }

  _showHint(on) {
    this._hintOn = on;
    this._hintT = 0;
    this._blocksAt = -1e9;
    if (on) this._fillHint(this.hintMode());
    toggleClass(this.root, 'hinting', on);
  }

  // err: the requestPointerLock rejection (null from the pointerlockerror event).
  _lockFailed(err) {
    if (this.touch.enabled || this.game.input.pointerLocked) return;
    if (/sandbox/i.test(err?.message || '')) this.lockBlocked = true;
    const first = !this.lockless;
    this._setLockless(true);
    const until = performance.now() + (first ? FREE_HINT_MS : LOCK_HINT_MS);
    this._lockHintUntil = Math.max(this._lockHintUntil, until);
  }

  _setLockless(on) {
    const changed = this.lockless !== on;
    this.lockless = on;
    setText(this.lockHint, !on ? LOCK_TEXT : this.lockBlocked ? FREE_TEXT : `${FREE_TEXT} · click to capture the mouse`);
    if (!changed) return;
    if (!on) toggleClass(this.lockHint, 'shown', false);
    this._textT = TEXT_INTERVAL; // refresh hints and the objective's "how" line on the next frame
  }

  _fillHint(mode) {
    this._hintMode = mode;
    this.hint.replaceChildren(...controlsHint(mode));
  }

  // Full 'line' clips get a subtitle (deduped against the one the voice director shows itself).
  // Short exclamations / greetings / calls are shown in the NPC's speech bubble instead, unless the
  // event asks for a subtitle ({subtitle: true}); {subtitle: false} never gets one (e.g. a passer-by
  // off screen on a phone).
  _npcSpoke(e) {
    const clip = e?.clip;
    if (e?.subtitle === false || (BUBBLE_KINDS.has(clip?.kind) && !e?.subtitle)) return;
    const sn = clip?.sn || (clip?.lang === 'sn' ? clip?.text : '') || '';
    const en = clip?.en || e?.text || '';
    if (!sn && !en) return;
    const role = e?.npc?.role || e?.npc?.name || '';
    const speaker = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Passer-by';
    this.showSubtitle({ speaker, sn, en, ms: clip?.dur ? clip.dur * 1000 + 1500 : undefined });
  }
}

