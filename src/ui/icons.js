// Inline SVG icons (24x24, stroked with currentColor). Static markup only.
const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  swing: svg('<path d="M20 3.5 9.5 14"/><circle cx="20" cy="3.5" r="1.3" fill="currentColor"/><path d="M4 13.5c1.4 3.6 4.6 6.2 8.6 6.6"/><circle cx="8" cy="15.5" r="2.6"/>'),
  jump: svg('<path d="m6 13 6-6 6 6"/><path d="m6 19 6-6 6 6"/>'),
  zip: svg('<path d="M5 19 19 5"/><path d="M11 5h8v8"/><path d="M4 12.5 8 8.5M11.5 20l4-4"/>'),
  dive: svg('<path d="M12 4v15"/><path d="m6 13 6 6 6-6"/>'),
  suit: svg('<ellipse cx="12" cy="12.5" rx="2.6" ry="4"/><path d="M9.6 10.5 5 6.5 4.5 3.5M9.4 12.5H3.5M9.6 14.5 5 18.5l-.5 2.5M14.4 10.5 19 6.5l.5-3M14.6 12.5h5.9M14.4 14.5l4.6 4 .5 2.5"/>'),
  map: svg('<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  pause: svg('<path d="M8.5 5v14M15.5 5v14"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  locate: svg('<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  pin: svg('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.2"/>'),
};
