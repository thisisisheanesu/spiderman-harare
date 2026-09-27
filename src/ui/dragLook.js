// Desktop mouse without pointer lock (the browser refused it, e.g. in a sandboxed iframe, or the
// player resumed with Esc, which can't re-capture the mouse): hold a button and drag to look.
export function enableDragLook(game, settings) {
  let dragging = false;
  game.renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && !game.input.pointerLocked) dragging = true;
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerType !== 'mouse' || game.input.pointerLocked || game.paused) return;
    const k = settings.get('sensitivity');
    game.input.addLook(e.movementX * k, e.movementY * k * (settings.get('invertY') ? -1 : 1));
  });
}
