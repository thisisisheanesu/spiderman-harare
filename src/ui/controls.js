import { el } from './dom.js';

// Control reference for the help overlay, the pause menu and the first-minute hint.
// Each row: [keys[], action]. Mirrors the bindings in src/core/input.js. Dive is C, not Ctrl:
// Ctrl held with W (move) is the browser's close-tab shortcut, which no page can block.
const CONTROLS = {
  keyboard: {
    title: 'Keyboard & mouse',
    rows: [
      [['W', 'A', 'S', 'D'], 'Move'],
      [['Mouse'], 'Look'],
      [['Space'], 'Jump · wall-run'],
      [['Left click', 'Shift'], 'Swing (hold)'],
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
      [['WASD'], 'Move'],
      [['Space'], 'Jump'],
      [['Click'], 'Swing'],
      [['E'], 'Zip'],
      [['C'], 'Dive'],
      [['M'], 'Map'],
      [['H'], 'Help'],
    ],
  },
  gamepad: {
    title: 'Gamepad',
    rows: [
      [['Left stick'], 'Move'],
      [['Right stick'], 'Look'],
      [['A'], 'Jump · wall-run'],
      [['RT'], 'Swing (hold)'],
      [['LB', 'RB', 'LT'], 'Web-zip'],
      [['B'], 'Dive'],
      [['Y'], 'Change suit'],
      [['Back'], 'Map'],
      [['Start'], 'Pause'],
    ],
    hint: [
      [['A'], 'Jump'],
      [['RT'], 'Swing'],
      [['LB'], 'Zip'],
      [['B'], 'Dive'],
      [['Back'], 'Map'],
      [['Start'], 'Pause'],
    ],
  },
  touch: {
    title: 'Touch',
    rows: [
      [['Left thumb'], 'Move (joystick)'],
      [['Right thumb'], 'Drag to look'],
      [['Swing'], 'Hold to swing'],
      [['Jump'], 'Jump · wall-run'],
      [['Zip'], 'Web-zip'],
      [['Dive'], 'Dive'],
      [['Suit'], 'Change suit'],
      [['Minimap'], 'Open the map'],
      [['Pause'], 'Pause'],
    ],
    hint: [
      [['Left side'], 'Move'],
      [['Right side'], 'Look'],
      [['Swing'], 'Hold to swing'],
    ],
  },
};

// Keyboard + mouse when the page can't capture the mouse (sandboxed iframe): look by dragging,
// swing with Shift (left click only swings while the mouse is captured).
const FREE = {
  rows: [
    [['W', 'A', 'S', 'D'], 'Move'],
    [['Drag'], 'Look (hold a mouse button)'],
    [['Space'], 'Jump · wall-run'],
    [['Shift'], 'Swing (hold)'],
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
    [['WASD'], 'Move'],
    [['Drag'], 'Look'],
    [['Space'], 'Jump'],
    [['Shift'], 'Swing'],
    [['E'], 'Zip'],
    [['C'], 'Dive'],
    [['M'], 'Map'],
    [['H'], 'Help'],
  ],
};

const CONTROL_MODES = Object.keys(CONTROLS);

function keyList(keys) {
  const out = [];
  keys.forEach((k, i) => {
    if (i) out.push(el('span', 'key-sep', { text: '/' }));
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
          (free && mode === 'keyboard' ? FREE : CONTROLS[mode]).rows.flatMap(([keys, action]) => [
            el('dt', null, null, keyList(keys)),
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
