// Checking a drawing's strokes before the server keeps it or paints it (doodle mail, lib/doodlemail.js).
import { MAX_FILLS } from '../js/doodle-fill.js';

const MAX_POINTS = 9000, MAX_STROKES = 500, MAX_MS = 5 * 60e3;
const err = (message, status) => Object.assign(new Error(message), { status });

// Strokes: [{ c: color index, s: size index, p: [x, y, t, x, y, t, ...] }] with x, y in 0..1000 and t in ms.
// A paint-bucket fill is { c, f: 1, p: [x, y, t] } (js/doodle-fill.js works out what it covers). Lines may run a
// little off the paper (the page keeps them within 100 of it), so what's checked here is exactly what was drawn.
const EDGE = 100;
export function cleanStrokes(input) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_STROKES) throw err('that drawing didn’t come through. try again?', 400);
  let total = 0, fills = 0;
  const out = input.map((st) => {
    const c = Number(st?.c), s = Number(st?.s), p = Array.isArray(st?.p) ? st.p : [], fill = st?.f === 1;
    if (!Number.isInteger(c) || c < 0 || c > 9 || p.length < 3 || p.length % 3) throw err('that drawing didn’t come through. try again?', 400);
    if (fill ? p.length !== 3 : (!Number.isInteger(s) || s < 0 || s > 2)) throw err('that drawing didn’t come through. try again?', 400);
    const pts = p.map((v, i) => Math.round(i % 3 === 2 ? Math.max(0, Math.min(MAX_MS, Number(v) || 0)) : Math.max(-EDGE, Math.min(1000 + EDGE, Number(v) || 0))));
    total += pts.length / 3;
    if (fill) { fills++; return { c, f: 1, p: pts }; }
    return { c, s, p: pts };
  });
  if (total > MAX_POINTS) throw err('that drawing is a bit too detailed! try a simpler one', 413);
  if (fills > MAX_FILLS) throw err(`that’s a lot of paint buckets! ${MAX_FILLS} fills at most`, 413);
  return out;
}
