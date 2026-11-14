// A bud drawn flat on a 2D canvas: the same outline, paint and eyes as on the island. Used where there's no 3D
// scene (the party games' TV and phone screens). b is a bud as /api/game?room=…&buds=… returns it:
// { r: [[x, y], …], eyeRel, eyeR, eyes, paint }. With no bud (still loading, or none made), a plain blob in `tint`.
import { drawEyeStyle } from '/js/bud-core.js';

const paintCache = new Map();
export function loadPaint(src) {
  if (!src) return Promise.resolve(null);
  if (!paintCache.has(src)) paintCache.set(src, new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }));
  return paintCache.get(src);
}
function eyeColor(img, b, box) {
  if (!img) return '#15161F';
  const c = document.createElement('canvas'); c.width = c.height = 6;
  const g = c.getContext('2d', { willReadFrequently: true }), W = img.width, H = img.height, er = b.eyeR;
  const sx = (b.eyeRel.x - er * 1.2 - box.x0) / box.w * W, sy = (b.eyeRel.y - er * 0.7 - box.y0) / box.h * H;
  try {
    g.drawImage(img, Math.max(0, sx), Math.max(0, sy), Math.max(1, er * 2.4 / box.w * W), Math.max(1, er * 1.4 / box.h * H), 0, 0, 6, 6);
    const d = g.getImageData(0, 0, 6, 6).data; let l = 0;
    for (let i = 0; i < d.length; i += 4) l += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return l / (d.length / 4) / 255 < 0.42 ? '#F3F4F8' : '#15161F';
  } catch (e) { return '#15161F'; }
}
// Draws into a square canvas of `size` CSS pixels (the canvas is resized for sharp screens). No ground shadow:
// whoever places the bud draws its own.
export async function drawBud(canvas, b, { size = canvas.clientWidth || 96, happy = false, sleepy = false, tint = '#D8D6E6', dpr = Math.min(2, globalThis.devicePixelRatio || 1) } = {}) {
  canvas.width = canvas.height = Math.round(size * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, size, size);
  if (!b || !b.r || b.r.length < 8) {
    g.fillStyle = tint; g.beginPath(); g.ellipse(size / 2, size * 0.58, size * 0.4, size * 0.36, 0, 0, Math.PI * 2); g.fill();
    const hi = g.createRadialGradient(size * 0.36, size * 0.38, 2, size * 0.5, size * 0.58, size * 0.5);
    hi.addColorStop(0, 'rgba(255,255,255,.5)'); hi.addColorStop(0.5, 'rgba(255,255,255,0)'); hi.addColorStop(1, 'rgba(20,10,50,.16)');
    g.fillStyle = hi; g.beginPath(); g.ellipse(size / 2, size * 0.58, size * 0.4, size * 0.36, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1D1C2B';
    for (const s of [-1, 1]) { g.beginPath(); if (sleepy) g.fillRect(size / 2 + s * size * 0.12 - size * 0.045, size * 0.55, size * 0.09, size * 0.02); else g.ellipse(size / 2 + s * size * 0.12, size * 0.54, size * 0.04, size * 0.065, 0, 0, Math.PI * 2); g.fill(); }
    return;
  }
  const pts = b.r.map((p) => ({ x: p[0], y: p[1] }));
  const box = pts.reduce((m, p) => ({ x0: Math.min(m.x0, p.x), y0: Math.min(m.y0, p.y), x1: Math.max(m.x1, p.x), y1: Math.max(m.y1, p.y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  box.w = box.x1 - box.x0; box.h = box.y1 - box.y0;
  const k = (size * 0.94) / Math.max(box.w, box.h), ox = (size - box.w * k) / 2 - box.x0 * k, oy = size - 2 - box.h * k - box.y0 * k;
  const X = (x) => ox + x * k, Y = (y) => oy + y * k;
  const path = () => { g.beginPath(); pts.forEach((p, i) => { const n = pts[(i + 1) % pts.length]; if (!i) g.moveTo(X((pts[pts.length - 1].x + p.x) / 2), Y((pts[pts.length - 1].y + p.y) / 2)); g.quadraticCurveTo(X(p.x), Y(p.y), X((p.x + n.x) / 2), Y((p.y + n.y) / 2)); }); g.closePath(); };
  const img = await loadPaint(b.paint);
  g.save(); path(); g.clip();
  g.fillStyle = '#E8E6F2'; g.fillRect(0, 0, size, size);
  if (img) g.drawImage(img, X(box.x0), Y(box.y0), box.w * k, box.h * k);
  const hi = g.createRadialGradient(X(box.x0 + box.w * 0.3), Y(box.y0 + box.h * 0.22), 2, X(box.x0 + box.w * 0.45), Y(box.y0 + box.h * 0.5), box.w * k * 0.75);
  hi.addColorStop(0, 'rgba(255,255,255,.45)'); hi.addColorStop(0.5, 'rgba(255,255,255,0)'); hi.addColorStop(1, 'rgba(20,10,50,.18)');
  g.fillStyle = hi; g.fillRect(0, 0, size, size);
  g.restore();
  try { drawEyeStyle(g, b.eyes || 'classic', X(b.eyeRel.x), Y(b.eyeRel.y), b.eyeR * k, sleepy ? 0.85 : 0, happy, eyeColor(img, b, box), { x: 0, y: 0.2 }); } catch (e) {}
}
