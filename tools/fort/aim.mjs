// Aim a launch: the power that makes something flung at this angle pass through (tx, ty), following the same
// steps the physics takes (60 a second), not the textbook curve.
export const LAUNCH = { x: 0.6, y: 1.5 }, MIN_SPEED = 9, MAX_SPEED = 19, G = 9.8, HZ = 60;
export function pathOf(angle, power, tMax = 4) {
  const a = angle * Math.PI / 180, v = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * power;
  let x = LAUNCH.x, y = LAUNCH.y, vx = Math.cos(a) * v, vy = Math.sin(a) * v; const pts = [[x, y]];
  for (let i = 0; i < tMax * HZ; i++) { vy -= G / HZ; x += vx / HZ; y += vy / HZ; pts.push([x, y]); if (y < -1) break; }
  return pts;
}
// height of the path when it crosses x = tx (on the way down if it crosses twice)
export function heightAt(angle, power, tx) {
  const pts = pathOf(angle, power);
  for (let i = 1; i < pts.length; i++) if (pts[i][0] >= tx) { const k = (tx - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k; }
  return -Infinity;
}
export function aim(angle, tx, ty) {
  let lo = 0, hi = 1;
  if (heightAt(angle, 1, tx) < ty) return null;   // can't reach
  if (heightAt(angle, 0, tx) > ty) return null;   // overshoots even at the weakest
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (heightAt(angle, mid, tx) < ty) lo = mid; else hi = mid; }
  return Math.round((lo + hi) / 2 * 1000) / 1000;
}
