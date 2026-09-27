// Small DOM + formatting helpers shared by the HUD modules.

// el('div', 'cls', {text, html, title, onclick, ...attrs}, [children])
export function el(tag, className, props, children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v; // only ever used with our own static icon markup
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
  }
  if (children) for (const c of children) if (c) node.append(c);
  return node;
}

// Only touches the DOM when the text actually changed (avoids style recalcs at 5 Hz).
export function setText(node, text) {
  if (node._text !== text) {
    node._text = text;
    node.textContent = text;
  }
}

export function toggleClass(node, cls, on) {
  if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
}

// Resize a canvas backing store to its CSS box * devicePixelRatio. Returns the ratio used.
export function fitCanvas(canvas, cssW, cssH, maxRatio = 3) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxRatio);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return dpr;
}

export function fmtDistance(m) {
  if (m < 995) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 9950 ? 1 : 0)} km`;
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// Signed smallest difference a - b in degrees, in (-180, 180].
export function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export const isCoarsePointer = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;
