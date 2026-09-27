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
import { enableDragLook } from './dragLook.js';
import { controlsHint } from './controls.js';
import { el, isCoarsePointer, setText, toggleClass } from './dom.js';

const TEXT_INTERVAL = 0.2; // s between DOM text refreshes (~5 Hz)
const HINT_SECONDS = 20;
const WAYPOINT_REACHED = 25; // m
const LOCK_HINT_MS = 5000;
// npc:speak clip kinds that appear as speech bubbles, not subtitles (FLEURS barks, extras greetings).
const BUBBLE_KINDS = new Set(['bark', 'greet', 'exclaim', 'call']);

// HUD system (game.hud): minimap, compass, location readout, subtitles / toasts / objective,
// big map, pause menu, help and touch controls. Owns every overlay and pauses the game while one
// is open.
//
// Public API: showSubtitle({speaker, sn, en, ms}), toast(text, ms), setObjective(text|null),
// bigMapOpen, waypoint ({x, z, label} | null), setWaypoint(x, z), clearWaypoint(),
// openOverlay('map'|'pause'|'help'), closeOverlay(), settings.
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
    const left = el('div', 'hud-left', null, [
      el('div', 'location panel', null, [this.street, this.near, el('div', 'loc-stats', null, [this.alt, this.speed])]),
    ]);
    this.hint = el('div', 'controls-hint panel');
    this.lockHint = el('div', 'lock-hint', { text: 'Click to capture the mouse · or drag to look' });
    this.root.append(top, left, this.hint, this.lockHint);
    this.compass = new Compass(top, this.places);
    this.minimap = new Minimap(this.root, painter, this.places, this.game.quality.level);
    this.minimap.root.addEventListener('click', () => this.openOverlay('map'));
    this.notices = new Notices(this.root, left);
  }

  _wireEvents() {
    const { game } = this;
    game.events.on('hud:toast', (e) => this.toast(e?.text, e?.ms));
    game.events.on('npc:speak', (e) => this._npcSpoke(e));
    game.events.on('game:start', () => {
      this.started = true;
      this.root.classList.add('started');
      this._showHint(true);
    });
    const canvas = game.renderer.domElement;
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) {
        this._hadLock = true;
      } else if (this.started && this._hadLock && !game.paused && !this.overlay) {
        this.openOverlay('pause');
      }
    });
    // Mouse capture refused (no user gesture yet, Esc used to resume, sandboxed iframe...).
    document.addEventListener('pointerlockerror', () => {
      this._lockHintUntil = performance.now() + LOCK_HINT_MS;
    });
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

  showSubtitle(sub) {
    this.notices.showSubtitle(sub);
  }

  toast(text, ms) {
    this.notices.toast(text, ms);
  }

  setObjective(text) {
    this.notices.setObjective(text);
  }

  setWaypoint(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const near = this.places.nearest(x, z, 120);
    const label = near?.name || this.game.world.streetNameAt(x, z) || 'Marked spot';
    this.waypoint = { x, z, label };
    this.bigMap.syncWaypoint();
    this.game.audio?.playSfx?.('ui');
  }

  clearWaypoint() {
    this.waypoint = null;
    this.bigMap.syncWaypoint();
  }

  setSetting(key, value) {
    this.settings.set(key, value);
    this._apply(key, value);
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
    if (!this.touch.enabled) this.game.input.requestPointerLock();
  }

  // "Samora Machel Avenue · near Africa Unity Square"
  locationText() {
    const { street, detail } = this._location();
    return detail ? `${street} · ${detail}` : street;
  }

  // --- system hooks -----------------------------------------------------------------------------

  onResize() {
    this.minimap.resize();
    this.compass.resize();
    this.bigMap.resize();
  }

  update(dt, game) {
    const input = game.input;
    if (this.started) {
      if (input.pressed('map')) this.openOverlay('map');
      else if (input.pressed('pause')) this.openOverlay('pause');
      else if (input.pressed('help')) this.openOverlay('help');
    }

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

    if (this.started && this._hintOn) {
      this._hintT += dt;
      if (this._hintT > HINT_SECONDS) this._showHint(false);
    }
    this._textT += dt;
    if (this._textT >= TEXT_INTERVAL) {
      this._refreshText(p, speed);
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
    else if (key === 'subtitles') this.notices.enabled = v;
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
    setText(this.street, street);
    setText(this.near, detail);
    setText(this.alt, `ALT ${Math.max(0, Math.round(p.y))} m`);
    setText(this.speed, `${Math.round(speed * 3.6)} km/h`);
    this.compass.updateCaption();

    const mode = this.inputMode;
    if (this._hintOn && this._hintMode !== mode) this._fillHint(mode);

    // Desktop without pointer lock: briefly say how to get the mouse back.
    const unlocked = this.started && !this.game.paused && !this.touch.enabled && mode === 'keyboard' && !this.game.input.pointerLocked;
    toggleClass(this.lockHint, 'shown', unlocked && performance.now() < this._lockHintUntil);

    const wp = this.waypoint;
    if (wp && Math.hypot(wp.x - p.x, wp.z - p.z) < WAYPOINT_REACHED) {
      this.toast(`Waypoint reached · ${wp.label}`);
      this.clearWaypoint();
    }
  }

  _showHint(on) {
    this._hintOn = on;
    this._hintT = 0;
    if (on) this._fillHint(this.inputMode);
    toggleClass(this.root, 'hinting', on);
  }

  _fillHint(mode) {
    this._hintMode = mode;
    this.hint.replaceChildren(...controlsHint(mode));
  }

  // Full 'line' clips get a subtitle (deduped against the one the voice director shows itself).
  // Short exclamations / greetings / calls are shown in the NPC's speech bubble instead, unless the
  // event asks for a subtitle ({subtitle: true}).
  _npcSpoke(e) {
    const clip = e?.clip;
    if (BUBBLE_KINDS.has(clip?.kind) && !e?.subtitle) return;
    const sn = clip?.sn || (clip?.lang === 'sn' ? clip?.text : '') || '';
    const en = clip?.en || e?.text || '';
    if (!sn && !en) return;
    const role = e?.npc?.role || e?.npc?.name || '';
    const speaker = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Passer-by';
    this.showSubtitle({ speaker, sn, en, ms: clip?.dur ? clip.dur * 1000 + 1500 : undefined });
  }
}

