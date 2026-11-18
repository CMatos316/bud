// Paints a doodle's strokes into a PNG on the server, so the picture the bot sends in a DM is always exactly
// the drawing (made from checked strokes and the bud maker's paints), never an image someone uploaded.
// No canvas on the server: each stroke is a round-capped polyline, filled with soft (anti-aliased) edges, and
// each paint-bucket fill is the patch js/doodle-fill.js works out (the same one the drawing page used).
// Painted over see-through, like the page's canvas, then laid on the paper at the end.
import { deflateSync } from 'node:zlib';
import { fillPatches, grow, isFill, GRID } from '../js/doodle-fill.js';

// the bud maker's paints and brush sizes, as in doodle.html (sizes in paper units: the paper is 1000 x 1000)
export const PAINTS = ['#FF6B5B', '#FF9F43', '#FFD23F', '#5ED6A0', '#4FB3FF', '#7C6CFF', '#FF7EB6', '#F6F2EC', '#2B2B3A'];
export const BRUSH = [12, 26, 52];
const PAPER = [0xFF, 0xFB, 0xEF];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// the big picture and the thumbnail are painted from the same strokes: work the fills out once
const patchCache = new WeakMap();

export function paint(strokes, size) {
  const n = size * size, R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n);
  const mask = new Float32Array(n), k = size / 1000;
  let patches = patchCache.get(strokes);
  if (!patches) { patches = fillPatches(strokes).patches; patchCache.set(strokes, patches); }
  const rims = [];
  // paint (colour cr, cg, cb) at coverage a over what's there, or under it
  const over = (j, a, cr, cg, cb) => { const b = 1 - a; R[j] = cr * a + R[j] * b; G[j] = cg * a + G[j] * b; B[j] = cb * a + B[j] * b; A[j] = a + A[j] * b; };
  const under = (j, a, cr, cg, cb) => { const u = a * (1 - A[j]); R[j] += cr * u; G[j] += cg * u; B[j] += cb * u; A[j] += u; };
  strokes.forEach((st, si) => {
    const [cr, cg, cb] = rgb(PAINTS[st.c] || PAINTS[8]);
    if (isFill(st)) {
      const pt = patches[si];
      if (pt) { patch(pt, size, (j, a) => over(j, a, cr, cg, cb)); rims.push([pt, cr, cg, cb]); }
      return;
    }
    const r = Math.max(0.7, (BRUSH[st.s] || 26) / 2 * k), p = st.p;
    const xs = [], ys = [];
    for (let i = 0; i < p.length; i += 3) { xs.push(p[i] * k); ys.push(p[i + 1] * k); }
    // this stroke's coverage, then blended in once (so its own overlaps don't double up at the edges)
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - r - 1)), x1 = Math.min(size - 1, Math.ceil(Math.max(...xs) + r + 1));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - r - 1)), y1 = Math.min(size - 1, Math.ceil(Math.max(...ys) + r + 1));
    if (x0 > x1 || y0 > y1) return;
    for (let y = y0; y <= y1; y++) mask.fill(0, y * size + x0, y * size + x1 + 1);
    const segs = Math.max(1, xs.length - 1);
    for (let s = 0; s < segs; s++) {
      const ax = xs[s], ay = ys[s], bx = xs[Math.min(s + 1, xs.length - 1)], by = ys[Math.min(s + 1, ys.length - 1)];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const sx0 = Math.max(x0, Math.floor(Math.min(ax, bx) - r - 1)), sx1 = Math.min(x1, Math.ceil(Math.max(ax, bx) + r + 1));
      const sy0 = Math.max(y0, Math.floor(Math.min(ay, by) - r - 1)), sy1 = Math.min(y1, Math.ceil(Math.max(ay, by) + r + 1));
      for (let y = sy0; y <= sy1; y++) {
        const cy = y + 0.5;
        for (let x = sx0; x <= sx1; x++) {
          const cx = x + 0.5;
          let t = len2 ? ((cx - ax) * dx + (cy - ay) * dy) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = cx - (ax + t * dx), ey = cy - (ay + t * dy);
          const cov = r + 0.5 - Math.sqrt(ex * ex + ey * ey);
          if (cov <= 0) continue;
          const j = y * size + x, c = cov > 1 ? 1 : cov;
          if (c > mask[j]) mask[j] = c;
        }
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const j = y * size + x, a = mask[j];
        if (a) over(j, a, cr, cg, cb);
      }
    }
  });
  // each fill's rim goes underneath, newest first: under the soft edges of the lines round it, and over the rim
  // of whatever fill it painted over (so changing a fill's colour doesn't leave the old colour peeking out)
  for (const [pt, cr, cg, cb] of rims.reverse()) patch(grow(pt), size, (j, a) => under(j, a, cr, cg, cb));
  const px = new Uint8Array(n * 3);
  for (let j = 0; j < n; j++) {
    const b = 1 - A[j], o = j * 3;
    px[o] = Math.round(R[j] + PAPER[0] * b); px[o + 1] = Math.round(G[j] + PAPER[1] * b); px[o + 2] = Math.round(B[j] + PAPER[2] * b);
  }
  return encodePng(px, size, size);
}

// A patch of grid cells, smoothed (each cell's middle is solid, blending into its neighbours, like the page's
// canvas does when it stretches the patch to fit): calls put(pixel, coverage) for each pixel it touches.
function patch(pt, size, put) {
  const cell = size / GRID;                      // pixels per cell
  const px0 = Math.max(0, Math.floor((pt.x0 - 0.5) * cell)), px1 = Math.min(size - 1, Math.ceil((pt.x0 + pt.w + 0.5) * cell));
  const py0 = Math.max(0, Math.floor((pt.y0 - 0.5) * cell)), py1 = Math.min(size - 1, Math.ceil((pt.y0 + pt.h + 0.5) * cell));
  const at = (x, y) => (x < 0 || y < 0 || x >= pt.w || y >= pt.h) ? 0 : pt.m[y * pt.w + x];
  for (let y = py0; y <= py1; y++) {
    const gy = (y + 0.5) / cell - 0.5 - pt.y0, iy = Math.floor(gy), fy = gy - iy;
    for (let x = px0; x <= px1; x++) {
      const gx = (x + 0.5) / cell - 0.5 - pt.x0, ix = Math.floor(gx), fx = gx - ix;
      const a = (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
      if (a > 0.001) put(y * size + x, a > 1 ? 1 : a);
    }
  }
}

/* ---------- a tiny PNG encoder (8-bit RGB) ---------- */
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length), body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
function encodePng(px, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(px.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;   // 8-bit, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
