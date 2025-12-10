export const keys = { ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false, w: false, a: false, s: false, d: false, e: false, ' ': false };
export function initInput() {
  window.addEventListener('keydown', (e) => { if (keys.hasOwnProperty(e.key)) keys[e.key] = true; });
  window.addEventListener('keyup',   (e) => { if (keys.hasOwnProperty(e.key)) keys[e.key] = false; });
}

