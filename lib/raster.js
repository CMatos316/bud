// Paints a doodle's strokes into a PNG on the server, so the picture the bot sends in a DM is always exactly
// the drawing (made from checked strokes and the bud maker's paints), never an image someone uploaded.
// No canvas on the server: each stroke is a round-capped polyline, filled with soft (anti-aliased) edges.
import { deflateSync } from 'node:zlib';

// the bud maker's paints and brush sizes, as in doodle.html (sizes in paper units: the paper is 1000 x 1000)
export const PAINTS = ['#FF6B5B', '#FF9F43', '#FFD23F', '#5ED6A0', '#4FB3FF', '#7C6CFF', '#FF7EB6', '#F6F2EC', '#2B2B3A'];
export const BRUSH = [12, 26, 52];
const PAPER = [0xFF, 0xFB, 0xEF];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function paint(strokes, size) {
  const px = new Uint8Array(size * size * 3);
  for (let i = 0; i < px.length; i += 3) px.set(PAPER, i);
  const mask = new Float32Array(size * size), k = size / 1000;
  for (const st of strokes) {
    const [cr, cg, cb] = rgb(PAINTS[st.c] || PAINTS[8]);
    const r = Math.max(0.7, (BRUSH[st.s] || 26) / 2 * k), p = st.p;
    const xs = [], ys = [];
    for (let i = 0; i < p.length; i += 3) { xs.push(p[i] * k); ys.push(p[i + 1] * k); }
    // this stroke's coverage, then blended in once (so its own overlaps don't double up at the edges)
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - r - 1)), x1 = Math.min(size - 1, Math.ceil(Math.max(...xs) + r + 1));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - r - 1)), y1 = Math.min(size - 1, Math.ceil(Math.max(...ys) + r + 1));
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
        const a = mask[y * size + x];
        if (!a) continue;
        const o = (y * size + x) * 3;
        px[o] += (cr - px[o]) * a; px[o + 1] += (cg - px[o + 1]) * a; px[o + 2] += (cb - px[o + 2]) * a;
      }
    }
  }
  return encodePng(px, size, size);
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
