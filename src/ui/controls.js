import { el } from './dom.js';

// Control reference for the help overlay, the pause menu and the first-minute hint.
// Each row: [keys[], action, sep?] (sep '+' = press together; default '/' = either key). Mirrors the bindings in src/core/input.js and the gaits in
// src/player/controller.js: the stick / WASD runs (a light push, Alt held or CapsLock switched on
// walks); the swing button held on the ground is the parkour sprint, and jumping mid-sprint (or
// pressing swing standing still) web-launches into a swing. Dive is C, not Ctrl: Ctrl held with W
// (move) is the browser's close-tab shortcut, which no page can block.
const CONTROLS = {
  keyboard: {
    title: 'Keyboard & mouse',
    rows: [
      [['W', 'A', 'S', 'D'], 'Run'],
      [['Alt', 'CapsLock'], 'Walk (hold Alt, or CapsLock on)'],
      [['Mouse'], 'Look'],
      [['Space'], 'Jump · wall-run'],
      [['Left click', 'Shift'], 'Hold: swing · sprint on the ground'],
      [['Shift', 'Space'], 'Web-launch (jump mid-sprint)', '+'],
      [['E', 'Right click'], 'Web-zip'],
      [['C'], 'Dive'],
      [['F'], 'Change suit'],
      [['V'], 'Camera'],
      [['T'], 'Time of day'],
      [['M'], 'Map'],
      [['H'], 'Help'],
      [['Esc', 'P'], 'Pause'],
    ],
    hint: [
      [['WASD'], 'Run'],
      [['Alt'], 'Walk'],
      [['Shift'], 'Sprint · swing'],
      [['Space'], 'Jump'],
      [['E'], 'Zip'],
      [['C'], 'Dive'],
      [['M'], 'Map'],
      [['H'], 'Help'],
    ],
  },
  gamepad: {
    title: 'Gamepad',
    rows: [
      [['Left stick'], 'Run (push lightly to walk)'],
      [['Right stick'], 'Look'],
      [['A'], 'Jump · wall-run'],
      [['RT'], 'Hold: swing · sprint on the ground'],
      [['RT', 'A'], 'Web-launch (jump mid-sprint)', '+'],
      [['LB', 'RB', 'LT'], 'Web-zip'],
      [['B'], 'Dive'],
      [['Y'], 'Change suit'],
      [['Back'], 'Map'],
      [['Start'], 'Pause'],
    ],
    hint: [
      [['RT'], 'Sprint · swing'],
      [['A'], 'Jump'],
      [['LB'], 'Zip'],
      [['B'], 'Dive'],
      [['Back'], 'Map'],
      [['Start'], 'Pause'],
    ],
  },
  touch: {
    title: 'Touch',
    rows: [
      [['Left thumb'], 'Run (push lightly to walk)'],
      [['Right thumb'], 'Drag to look'],
      [['Swing'], 'Hold: swing · sprint on the ground'],
      [['Jump'], 'Jump · wall-run'],
      [['Swing', 'Jump'], 'Web-launch (jump mid-sprint)', '+'],
      [['Zip'], 'Web-zip'],
      [['Dive'], 'Dive'],
      [['Suit'], 'Change suit'],
      [['Minimap'], 'Open the map'],
      [['Pause'], 'Pause'],
    ],
    hint: [
      [['Left side'], 'Move'],
      [['Right side'], 'Look'],
      [['Swing'], 'Sprint · swing'],
    ],
  },
};

// Keyboard + mouse when the page can't capture the mouse (sandboxed iframe): look by dragging,
// swing / sprint with Shift (left click only swings while the mouse is captured).
const FREE = {
  rows: [
    [['W', 'A', 'S', 'D'], 'Run'],
    [['Alt', 'CapsLock'], 'Walk (hold Alt, or CapsLock on)'],
    [['Drag'], 'Look (hold a mouse button)'],
    [['Space'], 'Jump · wall-run'],
    [['Shift'], 'Hold: swing · sprint on the ground'],
    [['Shift', 'Space'], 'Web-launch (jump mid-sprint)', '+'],
    [['E', 'Q'], 'Web-zip'],
    [['C'], 'Dive'],
    [['F'], 'Change suit'],
    [['V'], 'Camera'],
    [['T'], 'Time of day'],
    [['M'], 'Map'],
    [['H'], 'Help'],
    [['Esc', 'P'], 'Pause'],
  ],
  hint: [
    [['WASD'], 'Run'],
    [['Drag'], 'Look'],
    [['Shift'], 'Sprint · swing'],
    [['Space'], 'Jump'],
    [['E'], 'Zip'],
    [['C'], 'Dive'],
    [['M'], 'Map'],
    [['H'], 'Help'],
  ],
};

const CONTROL_MODES = Object.keys(CONTROLS);

function keyList(keys, sep = '/') {
  const out = [];
  keys.forEach((k, i) => {
    if (i) out.push(el('span', 'key-sep', { text: sep }));
    out.push(el('kbd', null, { text: k }));
  });
  return out;
}

// One table per input method; `active` (the device the player is using now) comes first, highlighted.
// 'free' is the keyboard column for a mouse that can't be captured.
export function controlsColumns(active) {
  const free = active === 'free';
  if (free) active = 'keyboard';
  const modes = [active, ...CONTROL_MODES.filter((m) => m !== active)];
  return el(
    'div',
    'controls-cols',
    null,
    modes.map((mode) =>
      el('section', `controls-col${mode === active ? ' is-active' : ''}`, { 'data-mode': mode }, [
        el('h3', null, { text: CONTROLS[mode].title }),
        el(
          'dl',
          'controls-list',
          null,
          (free && mode === 'keyboard' ? FREE : CONTROLS[mode]).rows.flatMap(([keys, action, sep]) => [
            el('dt', null, null, keyList(keys, sep)),
            el('dd', null, { text: action }),
          ]),
        ),
      ]),
    ),
  );
}

export function controlsHint(mode) {
  return (mode === 'free' ? FREE : CONTROLS[mode] || CONTROLS.keyboard).hint.map(([keys, action]) => el('span', 'hint-item', null, [...keyList(keys), el('span', null, { text: action })]));
}

// One-paragraph primer under the help overlay's tables, for the device in use.
const TIPS = {
  keyboard:
    'On the ground, hold Shift to sprint: it vaults railings and runs up walls. Press Space mid-sprint to web-launch into a swing, and keep holding Shift to swing on. Hold Alt (or switch CapsLock on) to walk. Press M for the map of Harare CBD and drop a waypoint anywhere.',
  touch:
    'On the ground, hold Swing to sprint: it vaults railings and runs up walls. Tap Jump mid-sprint to web-launch into a swing, and keep holding Swing to swing on. Push the stick lightly to walk. Tap the minimap for the map of Harare CBD and drop a waypoint anywhere.',
  gamepad:
    'On the ground, hold RT to sprint: it vaults railings and runs up walls. Press A mid-sprint to web-launch into a swing, and keep holding RT to swing on. Push the left stick lightly to walk. Press Back for the map of Harare CBD and drop a waypoint anywhere.',
};

export function controlsTip(mode) {
  return TIPS[mode] || TIPS.keyboard;
}
