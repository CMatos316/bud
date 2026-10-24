// What a saved bud looks like, and checking what the page sends before it's stored.
export const EYE_STYLES = [
  'classic', 'button', 'bean', 'bright', 'pebble', 'mellow', 'closeset', 'wideset',
  'boxy', 'donut', 'googly', 'lashes', 'slim', 'oddpair',
];
const POINTS = 64;
const MAX_PAINT_CHARS = 900_000; // the paint texture as a JPEG data URL; typically 60-250 KB

const num = (v, lim = 5000) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

// Returns { ok: true, doc } ready for Firestore, or { ok: false, error }.
export function validateBud(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'missing bud' };
  const { r, fx, fy, eyeRel, eyeR, eyes, trueName, nickname, paint } = input;
  if (!Array.isArray(r) || r.length !== POINTS || !r.every((p) => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]))) {
    return { ok: false, error: 'bad outline' };
  }
  if (!num(fx, 2) || !num(fy, 2)) return { ok: false, error: 'bad position' };
  if (!eyeRel || !num(eyeRel.x) || !num(eyeRel.y) || !num(eyeR, 200)) return { ok: false, error: 'bad eyes' };
  if (!EYE_STYLES.includes(eyes)) return { ok: false, error: 'unknown eye style' };
  const tn = clean(trueName, 6);
  if ([...tn].length < 3) return { ok: false, error: 'name must be 3 to 6 characters' };
  if (typeof paint !== 'string' || !paint.startsWith('data:image/jpeg;base64,') || paint.length > MAX_PAINT_CHARS) {
    return { ok: false, error: 'bad paint' };
  }
  return {
    ok: true,
    doc: {
      trueName: tn,
      nickname: clean(nickname, 16) || null,
      // Firestore can't store arrays inside arrays, so the outline is flat: [x0, y0, x1, y1, ...]
      outline: r.flat().map((v) => Math.round(v * 10) / 10),
      position: { fx, fy },
      eye: { x: eyeRel.x, y: eyeRel.y, r: eyeR },
      eyeStyle: eyes,
      paintJpeg: paint,
    },
  };
}

// Back to the shape the maker page uses.
export function budForClient(d) {
  const r = [];
  for (let i = 0; i + 1 < (d.outline || []).length; i += 2) r.push([d.outline[i], d.outline[i + 1]]);
  return {
    r, fx: d.position?.fx ?? 0.5, fy: d.position?.fy ?? 0.55,
    eyeRel: { x: d.eye?.x ?? 0, y: d.eye?.y ?? 0 }, eyeR: d.eye?.r ?? 18,
    eyes: d.eyeStyle, trueName: d.trueName, nickname: d.nickname || '', paint: d.paintJpeg || null,
  };
}
