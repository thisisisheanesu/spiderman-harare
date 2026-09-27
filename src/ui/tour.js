// First-time objective chain ("the tour"): five short goals that teach the moves one at a time and
// walk a new player past the places the city is built around. Each step sets the HUD objective (title
// plus a one-line "how" for the device in use) and, where it has a destination, a gold waypoint on the
// compass / minimap / big map. A waypoint the player drops themselves wins; the tour's comes back once
// theirs is reached. Finishing (or switching "Guided tour" off in the pause menu) clears it for good;
// switching it back on replays it.

const RBZ_DROP = 18; // m below the perch that counts as "dived off"
const MALL_WIDTH = 14; // m either side of First Street Mall's centre line
const MALL_SECONDS = 3; // s on the mall's paving
const JOINA_REACH = 32; // m (horizontal) from the tower's centre
const JOINA_MIN_Y = 80; // m: on the crown, not the podium roof
const GROUNDED = new Set(['ground', 'perch']);
const ON_TOP = new Set(['ground', 'perch', 'wall']);

// Fallback coordinates (metres from Africa Unity Square) if the map has no such place.
const SAMORA = { x: -20, z: -372 };
const AUS = { x: 0, z: 0 };
const MALL = [-308, -161, -291, -98, -275, -32, -263, 13, -252, 58, -240, 106, -232, 147, -226, 166, -216, 204, -203, 259, -194, 295, -182, 340];
const MALL_TARGET = { x: -252, z: 58 };
const JOINA = { x: -500, z: 262 };

// how: per input mode ('keyboard' | 'touch' | 'gamepad'), plus 'free' = keyboard without mouse capture.
// ground (optional): the same, shown while Spider-Man is on the ground or a roof, where the swing
// button is the parkour sprint and jumping mid-sprint web-launches (src/player/controller.js).
const STEPS = [
  {
    id: 'dive',
    title: 'Dive off the Reserve Bank',
    how: {
      keyboard: 'Press C to swan-dive, or run off the edge with W',
      touch: 'Tap DIVE, or push the stick over the edge',
      gamepad: 'Press B to swan-dive off the edge',
    },
  },
  {
    id: 'swing',
    title: 'Swing down Samora Machel Avenue',
    how: {
      keyboard: 'Hold Left click or Shift to swing · steer with the mouse',
      free: 'Hold Shift to swing · drag the mouse to steer',
      touch: 'Hold SWING in the air · let go to fly',
      gamepad: 'Hold RT to swing · let go to fly',
    },
    ground: {
      keyboard: 'Hold Shift to sprint, then Space to web-launch into a swing',
      touch: 'Hold SWING to sprint, then tap JUMP to web-launch into a swing',
      gamepad: 'Hold RT to sprint, then A to web-launch into a swing',
    },
    target: 'samora',
    label: 'Samora Machel Avenue',
  },
  {
    id: 'aus',
    title: 'Land in Africa Unity Square',
    how: {
      keyboard: 'Let go over the square and land · people here speak Shona',
      touch: 'Let go of SWING over the square and land · people here speak Shona',
      gamepad: 'Let go over the square and land · people here speak Shona',
    },
    ground: {
      keyboard: 'Hold Shift to sprint there, Space to launch · people here speak Shona',
      touch: 'Hold SWING to sprint there, JUMP to launch · people here speak Shona',
      gamepad: 'Hold RT to sprint there, A to launch · people here speak Shona',
    },
    target: 'aus',
    label: 'Africa Unity Square',
  },
  {
    id: 'mall',
    title: 'Walk down First Street Mall',
    how: {
      keyboard: 'Hold Alt (or switch CapsLock on) to walk among the shoppers and vendors',
      touch: 'Push the stick lightly to walk among the shoppers and vendors',
      gamepad: 'Push the left stick lightly to walk among the shoppers and vendors',
    },
    target: 'mall',
    label: 'First Street Mall',
  },
  {
    id: 'joina',
    title: 'Perch on top of Joina City',
    how: {
      keyboard: 'Aim at the tower top and press E or Right click to web-zip',
      free: 'Aim at the tower top and press E to web-zip',
      touch: 'Look at the tower top and tap ZIP to web-zip',
      gamepad: 'Aim at the tower top and press LB to web-zip',
    },
    target: 'joina',
    label: 'Joina City',
  },
];

// The "how" line switches between its air and ground versions only once the new state has lasted
// this long (s), so a touch-and-go landing between swings doesn't flicker it.
const TO_GROUND = 0.4;
const TO_AIR = 0.6;

export class Tour {
  constructor(hud) {
    this.hud = hud;
    this.game = hud.game;
    this.step = -1; // index into STEPS; -1 = not running
    this.wp = null; // the waypoint object this tour set
    this.userWp = false; // the player replaced it with their own
    this.mallTime = 0;
    this._mode = '';
    this._ground = false; // on the ground / a roof, for the step's "how" line (see TO_GROUND)
    this._stateT = 0; // s the other state has lasted
    this._shownGround = null;
    const places = hud.places;
    const at = (key, fallback) => {
      const p = places.list.find((q) => q.key === key);
      return p ? { x: p.x, z: p.z } : fallback;
    };
    this.targets = {
      samora: SAMORA,
      aus: at('africa_unity_square', AUS),
      mall: MALL_TARGET,
      joina: JOINA, // tower shaft, not the podium-weighted landmark centre
    };
  }

  get running() {
    return this.step >= 0;
  }

  // Start from the first step that still makes sense where the player is.
  start() {
    const p = this.game.player?.position;
    if (!p) return;
    this.startY = p.y;
    const onPerch = this.game.player.state === 'perch' && p.y > 60;
    this._go(onPerch ? 0 : 1);
  }

  stop() {
    this.step = -1;
    this._dropWaypoint();
    this.hud.setObjective(null);
  }

  // ~5 Hz from the HUD while the game runs.
  update(dt) {
    if (!this.running) return;
    const { player } = this.game;
    const p = player.position;
    this._syncWaypoint();
    this._trackGround(player.state, dt);
    const mode = this.hud.hintMode();
    if (mode !== this._mode || this._ground !== this._shownGround) this._show();
    if (this._done(STEPS[this.step], p, player.state, dt)) this._advance();
  }

  _done(step, p, state, dt) {
    const t = this.targets;
    switch (step.id) {
      case 'dive':
        return state === 'swing' || (state !== 'perch' && p.y < this.startY - RBZ_DROP);
      case 'swing':
        return Math.hypot(p.x - t.samora.x, p.z - t.samora.z) < 50;
      case 'aus':
        return GROUNDED.has(state) && p.y < 4 && this.hud.places.areaAt(p.x, p.z) === 'Africa Unity Square';
      case 'mall':
        if (GROUNDED.has(state) && p.y < 4 && distToLine(p.x, p.z, MALL) < MALL_WIDTH) this.mallTime += dt;
        return this.mallTime >= MALL_SECONDS;
      case 'joina':
        return ON_TOP.has(state) && p.y > JOINA_MIN_Y && Math.hypot(p.x - t.joina.x, p.z - t.joina.z) < JOINA_REACH;
      default:
        return true;
    }
  }

  _trackGround(state, dt) {
    const grounded = GROUNDED.has(state);
    if (grounded === this._ground) {
      this._stateT = 0;
      return;
    }
    this._stateT += dt;
    if (this._stateT >= (grounded ? TO_GROUND : TO_AIR)) {
      this._ground = grounded;
      this._stateT = 0;
    }
  }

  _advance() {
    const hud = this.hud;
    hud.flashObjective();
    hud.game.audio?.playSfx?.('ui');
    if (this.step + 1 < STEPS.length) {
      this._go(this.step + 1);
      return;
    }
    this.step = -1;
    this._dropWaypoint();
    hud.setObjective(null);
    const map = hud.hintMode() === 'touch' ? 'tap the minimap' : hud.hintMode() === 'gamepad' ? 'press Back' : 'press M';
    hud.toast(hud.compact ? `Tour complete! ${map[0].toUpperCase()}${map.slice(1)} to explore` : `Tour complete! Harare is yours — ${map} to pick your next spot`, 6000);
    hud.setSetting('tour', false);
  }

  _go(i) {
    this.step = i;
    this.mallTime = 0;
    this._ground = GROUNDED.has(this.game.player?.state);
    this._stateT = 0;
    this.userWp = false;
    this._dropWaypoint();
    const step = STEPS[i];
    if (step.target) {
      const t = this.targets[step.target];
      // Never overwrite a waypoint the player chose.
      if (!this.hud.waypoint) this.wp = this.hud.setWaypoint(t.x, t.z, { label: step.label, tour: true, quiet: true });
      else this.userWp = true;
    }
    this._show();
  }

  _show() {
    const step = STEPS[this.step];
    const mode = (this._mode = this.hud.hintMode());
    this._shownGround = this._ground;
    const lines = (this._ground && step.ground) || step.how;
    // 'free' (keyboard without mouse capture) falls back to the keyboard line.
    const how = lines[mode] || lines.keyboard;
    this.hud.setObjective(step.title, { how, step: `${this.step + 1}/${STEPS.length}` });
  }

  _dropWaypoint() {
    if (this.wp && this.hud.waypoint === this.wp) this.hud.clearWaypoint();
    this.wp = null;
  }

  // The player dropped their own waypoint over the tour's (called by hud.setWaypoint).
  yieldWaypoint() {
    if (!this.running || !this.wp) return;
    this.wp = null;
    this.userWp = true;
  }

  // The player's own waypoint wins; the tour's returns once theirs has been reached or cleared.
  _syncWaypoint() {
    const hud = this.hud;
    const wp = hud.waypoint;
    const step = STEPS[this.step];
    if (!step.target) return;
    if (wp && wp !== this.wp) {
      this.userWp = true;
      this.wp = null;
    } else if (!wp && this.userWp) {
      this.userWp = false;
      const t = this.targets[step.target];
      this.wp = hud.setWaypoint(t.x, t.z, { label: step.label, tour: true, quiet: true });
    } else if (!wp && this.wp) {
      // Cleared from the big map: leave it off for this step.
      this.wp = null;
    }
  }
}

// Distance from (x, z) to a polyline [x0, z0, x1, z1, ...].
function distToLine(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const az = pts[i + 1];
    const dx = pts[i + 2] - ax;
    const dz = pts[i + 3] - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
