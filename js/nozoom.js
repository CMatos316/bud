// No zooming on phones: pages here are made to fit the screen, and pinching or double-tapping only gets you
// stuck halfway into a zoomed island. The viewport tag says "no zoom", but iPhones ignore that for pinches,
// so Safari's own pinch gesture is cancelled here too. (Double-tap zoom is off via touch-action in each page.)
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
// two fingers on the page (outside a canvas that handles its own pinch, like the island's camera zoom)
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1 && !(e.target instanceof HTMLCanvasElement)) e.preventDefault();
}, { passive: false });
