// The paint bucket for doodles, worked out the same way everywhere: on the drawing page, in the replay, and in
// the picture the bot paints for a DM (lib/raster.js imports this file too).
//
// A fill never looks at screen pixels, which differ from phone to phone (a gap that's open on one screen can be
// closed on another, and then the whole background floods). Instead the drawing so far is laid on a 500 x 500
// grid, each cell holding the paint on top of it (or bare paper), and the fill takes the patch of matching cells
// joined to the one you tapped. Whole numbers only, so every phone and the server get exactly the same patch.
//
// A fill is a stroke with f: 1 and a single point: { c: paint, f: 1, p: [x, y, t] } (paper units, 0..1000).

export const GRID = 500;                 // cells across; each is 2 x 2 paper units
const CELL = 1000 / GRID;
export const BRUSH = [12, 26, 52];       // brush widths, as in doodle.html
export const PAPER = 255;                // a cell nobody has painted
export const MAX_FILLS = 60;
export const isFill = (st) => !!st && st.f === 1;
export const cellOf = (v) => Math.max(0, Math.min(GRID - 1, Math.floor(v / CELL)));

// Paint a stroke onto the grid: every cell whose middle is within the brush's reach of the line. A cell's middle
// is at 2i + 1, and the test is done in squares and cross products, so it's exact (no rounding anywhere).
function stamp(lab, st) {
  const r = (BRUSH[st.s] ?? 26) / 2, rr = r * r, p = st.p, n = p.length / 3, c = st.c;
  for (let k = 0; k < Math.max(1, n - 1); k++) {
    const j = Math.min(k + 1, n - 1);
    const ax = p[k * 3], ay = p[k * 3 + 1], bx = p[j * 3], by = p[j * 3 + 1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx) - r - 1) / CELL)), i1 = Math.min(GRID - 1, Math.floor((Math.max(ax, bx) + r - 1) / CELL));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by) - r - 1) / CELL)), j1 = Math.min(GRID - 1, Math.floor((Math.max(ay, by) + r - 1) / CELL));
    for (let y = j0; y <= j1; y++) {
      const cy = y * CELL + 1, row = y * GRID;
      for (let x = i0; x <= i1; x++) {
        const cx = x * CELL + 1, ex = cx - ax, ey = cy - ay, dot = ex * dx + ey * dy;
        let near;
        if (dot <= 0) near = ex * ex + ey * ey <= rr;
        else if (dot >= len2) { const fx = cx - bx, fy = cy - by; near = fx * fx + fy * fy <= rr; }
        else { const cr = ex * dy - ey * dx; near = cr * cr <= rr * len2; }
        if (near) lab[row + x] = c;
      }
    }
  }
}

// Fill from paper point (x, y) with paint c: every cell of the same paint joined to it, side to side (not
// corner to corner, so a fill can't slip through a diagonal line). Changes lab, and returns the patch:
// { x0, y0, w, h, m } in cells, m one byte per cell of the box (1 = filled). null: that spot is already paint c.
export function fillAt(lab, x, y, c) {
  const sx = cellOf(x), sy = cellOf(y), from = lab[sy * GRID + sx];
  if (from === c) return null;
  const cells = [], stack = [sx, sy];
  while (stack.length) {
    const y0 = stack.pop(), row = y0 * GRID;
    let x0 = stack.pop();
    if (lab[row + x0] !== from) continue;
    while (x0 > 0 && lab[row + x0 - 1] === from) x0--;
    let up = false, down = false;
    for (let xx = x0; xx < GRID && lab[row + xx] === from; xx++) {
      lab[row + xx] = c; cells.push(row + xx);
      if (y0 > 0) { const u = lab[row - GRID + xx] === from; if (u && !up) stack.push(xx, y0 - 1); up = u; }
      if (y0 < GRID - 1) { const d = lab[row + GRID + xx] === from; if (d && !down) stack.push(xx, y0 + 1); down = d; }
    }
  }
  let bx0 = GRID, by0 = GRID, bx1 = 0, by1 = 0;
  for (const i of cells) { const cx = i % GRID, cy = (i - cx) / GRID; if (cx < bx0) bx0 = cx; if (cx > bx1) bx1 = cx; if (cy < by0) by0 = cy; if (cy > by1) by1 = cy; }
  const w = bx1 - bx0 + 1, h = by1 - by0 + 1, m = new Uint8Array(w * h);
  for (const i of cells) { const cx = i % GRID, cy = (i - cx) / GRID; m[(cy - by0) * w + cx - bx0] = 1; }
  return { x0: bx0, y0: by0, w, h, m };
}

function apply(lab, pt, c) {
  for (let y = 0; y < pt.h; y++) for (let x = 0; x < pt.w; x++) if (pt.m[y * pt.w + x]) lab[(pt.y0 + y) * GRID + pt.x0 + x] = c;
}

// Works through a drawing in order. Returns the grid as it ends up, and each fill's patch (null for strokes and
// for fills that change nothing). known: a WeakMap of patches already worked out (it gets the new ones too), so a
// page doesn't redo them every time; a fill's patch only depends on what came before it.
// from/lab: carry on from a grid that already has strokes[0 .. from) on it (the drawing page does this, so a tap
// on a busy drawing doesn't lay every stroke down again). Patches before from come back as null.
export function fillPatches(strokes, known, from = 0, lab = null) {
  if (!lab) { lab = new Uint8Array(GRID * GRID).fill(PAPER); from = 0; }
  const patches = new Array(from).fill(null);
  let fills = 0;
  for (let i = 0; i < from; i++) if (isFill(strokes[i])) fills++;
  for (let i = from; i < strokes.length; i++) {
    const st = strokes[i];
    if (!isFill(st)) { stamp(lab, st); patches.push(null); continue; }
    let pt = known ? known.get(st) : undefined;
    if (pt === undefined) {
      pt = ++fills > MAX_FILLS ? null : fillAt(lab, st.p[0], st.p[1], st.c);
      if (known) known.set(st, pt);
    } else { fills++; if (pt) apply(lab, pt, st.c); }
    patches.push(pt);
  }
  return { lab, patches };
}

// The patch grown by one cell all round (corners too). It's painted underneath what's already there, so the
// fill tucks in under the soft edges of the lines around it instead of leaving a pale rim.
export function grow(pt) {
  const w = pt.w + 2, h = pt.h + 2, m = new Uint8Array(w * h);
  for (let y = 0; y < pt.h; y++) {
    for (let x = 0; x < pt.w; x++) {
      if (!pt.m[y * pt.w + x]) continue;
      for (let dy = 0; dy < 3; dy++) { const o = (y + dy) * w + x; m[o] = m[o + 1] = m[o + 2] = 1; }
    }
  }
  return { x0: pt.x0 - 1, y0: pt.y0 - 1, w, h, m };
}
