// bud-core: the parts of a bud that every page shares, taken from the maker page.
// Geometry helpers, the "inflate the outline into a 3D balloon" mesh builder, and the eye styles.
// Needs THREE and Delaunator loaded as globals first.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const PUFF = 0.85, BACK = 0.55;
export const EYES = [
  ['classic', 'Classic'], ['button', 'Button'], ['bean', 'Bean'], ['bright', 'Bright'], ['pebble', 'Pebble'],
  ['mellow', 'Mellow'], ['closeset', 'Close-set'], ['wideset', 'Wide-set'], ['boxy', 'Boxy'], ['donut', 'Donut'],
  ['googly', 'Googly'], ['lashes', 'Lashes'], ['slim', 'Slim'], ['oddpair', 'Odd pair'],
];
const SPACING = { closeset: 0.42, wideset: 1.12, bean: 0.6, bright: 0.82, googly: 0.84, slim: 0.58, pebble: 0.8 };

// seconds, used by animated eye styles (dizzy spirals)
let clock = 0;
export const setClock = (t) => { clock = t; };

/* ---------- geometry ---------- */
function area(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return a / 2; }
function centroid(p) {
  const A = area(p);
  if (Math.abs(A) < 1) { let x = 0, y = 0; p.forEach(q => { x += q.x; y += q.y; }); return { x: x / p.length, y: y / p.length }; }
  let cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], f = a.x * b.y - b.x * a.y; cx += (a.x + b.x) * f; cy += (a.y + b.y) * f; }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}
function bbox(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  p.forEach(q => { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
function inPoly(p, x, y) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function distToPoly(p, x, y) {
  let best = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[j], b = p[i], vx = b.x - a.x, vy = b.y - a.y;
    const t = clamp(((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy || 1), 0, 1);
    const dx = a.x + vx * t - x, dy = a.y + vy * t - y, d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
function pathLen(p) { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y); return L; }
function resample(pts, n) {
  const P = pts.concat([pts[0]]);
  const L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
  const total = L[L.length - 1] || 1, out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const d = k * total / n;
    while (j < L.length - 2 && L[j + 1] < d) j++;
    const seg = (L[j + 1] - L[j]) || 1, u = (d - L[j]) / seg;
    out.push({ x: P[j].x + (P[j + 1].x - P[j].x) * u, y: P[j].y + (P[j + 1].y - P[j].y) * u });
  }
  return out;
}


export function setExtents(b) {
  const bb = bbox(b.r);
  b.minX = bb.x0; b.maxX = bb.x1; b.minY = bb.y0; b.maxY = bb.y1; b.w = bb.w; b.h = bb.h;
  return b;
}

/* ---------- eyes ---------- */
function drawEyeStyle(g, id, cx, cy, r, bl, happy, col, lk = { x: 0, y: 0 }, mood = null) {
  if (mood) happy = false;
  // Most styles slide as a pair; googly eyes keep the whites still and roll the pupils instead.
  const shift = id === 'googly' ? 0.08 : 0.35;
  cx += lk.x * r * shift; cy += lk.y * r * shift * 0.8;
  g.save();
  g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
  const open = (1 - bl * 0.9) * (mood === 'angry' ? 0.45 : mood === 'annoyed' ? 0.62 : 1), sp = r * (SPACING[id] || 0.75);
  const P = [{ x: cx - sp, y: cy, s: -1 }, { x: cx + sp, y: cy, s: 1 }];
  const oval = (p, rx, ry, dy = 0) => { g.beginPath(); g.ellipse(p.x, p.y + dy * r, rx * r, Math.max(r * 0.04, ry * r * open), 0, 0, Math.PI * 2); g.fill(); };
  const dotAt = (x, y, rr) => { g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill(); };
  const rrect = (x, y, w, h, rad) => {
    rad = Math.min(rad, w / 2, h / 2);
    g.beginPath(); g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad); g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad); g.arcTo(x, y, x + w, y, rad); g.closePath();
  };
  if (mood === 'dizzy') {
    g.lineWidth = Math.max(1.5, r * 0.09);
    P.forEach((p, k) => {
      const dir = k ? 1 : -1, rot = clock * 7 * dir;
      g.beginPath();
      for (let t = 0; t <= 1; t += 0.02) {
        const a = rot + dir * t * Math.PI * 5, rr = r * (0.04 + 0.34 * t);
        const x = p.x + Math.cos(a) * rr, y = p.y + Math.sin(a) * rr;
        t ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    });
    g.restore(); return;
  }
  // A poke still gets a quick ^ ^ so the buddy feels alive; real emotions come later.
  if (happy) {
    g.lineWidth = Math.max(1.5, r * 0.15);
    P.forEach(p => { g.beginPath(); g.arc(p.x, p.y + r * 0.2, r * 0.3, Math.PI * 1.12, Math.PI * 1.88); g.stroke(); });
    g.restore(); return;
  }
  switch (id) {
    case 'button': P.forEach(p => oval(p, 0.22, 0.22)); break;
    case 'bean': P.forEach(p => oval(p, 0.19, 0.58)); break;
    case 'bright':
      P.forEach(p => oval(p, 0.38, 0.4));
      if (open > 0.5) { g.fillStyle = '#FFFFFF'; P.forEach(p => { dotAt(p.x - r * 0.12, p.y - r * 0.13, r * 0.12); dotAt(p.x + r * 0.13, p.y + r * 0.13, r * 0.055); }); }
      break;
    case 'pebble': P.forEach(p => oval(p, 0.36, 0.21)); break;
    case 'mellow':
      P.forEach(p => { g.beginPath(); g.ellipse(p.x, p.y - r * 0.08, r * 0.33, Math.max(r * 0.04, r * 0.36 * open), 0, 0, Math.PI); g.closePath(); g.fill(); });
      break;
    case 'closeset': P.forEach(p => oval(p, 0.2, 0.24)); break;
    case 'wideset': P.forEach(p => oval(p, 0.24, 0.36)); break;
    case 'boxy':
      P.forEach(p => { const w = r * 0.5, h = Math.max(r * 0.06, r * 0.6 * open); rrect(p.x - w / 2, p.y - h / 2, w, h, r * 0.14); g.fill(); });
      break;
    case 'donut':
      g.lineWidth = r * 0.14;
      P.forEach(p => { g.beginPath(); g.ellipse(p.x, p.y, r * 0.27, Math.max(r * 0.04, r * 0.3 * open), 0, 0, Math.PI * 2); g.stroke(); });
      break;
    case 'googly':
      P.forEach(p => {
        g.fillStyle = '#FFFFFF';
        g.beginPath(); g.ellipse(p.x, p.y, r * 0.44, Math.max(r * 0.04, r * 0.46 * open), 0, 0, Math.PI * 2); g.fill();
        g.lineWidth = r * 0.07; g.strokeStyle = col; g.stroke();
        if (open > 0.4) {
          const m = Math.hypot(lk.x, lk.y), k = m > 1 ? 1 / m : 1;
          g.fillStyle = '#141820';
          dotAt(p.x + lk.x * k * r * 0.22, p.y + lk.y * k * r * 0.22 * open, r * 0.2);
        }
      });
      break;
    case 'lashes':
      P.forEach(p => {
        oval(p, 0.28, 0.44);
        if (open > 0.5) {
          g.lineWidth = r * 0.09;
          for (let k = 0; k < 3; k++) {
            const a = -Math.PI / 2 + p.s * (0.55 + k * 0.32);
            const x0 = p.x + Math.cos(a) * r * 0.28, y0 = p.y + Math.sin(a) * r * 0.44;
            g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a) * r * 0.2, y0 + Math.sin(a) * r * 0.2); g.stroke();
          }
        }
      });
      break;
    case 'slim': P.forEach(p => oval(p, 0.12, 0.5)); break;
    case 'oddpair': oval(P[0], 0.17, 0.19, 0.1); oval(P[1], 0.3, 0.5); break;
    default: P.forEach(p => oval(p, 0.3, 0.48));
  }
  if (mood) {
    g.strokeStyle = col; g.lineWidth = Math.max(1.5, r * 0.13);
    const tilt = mood === 'angry' ? 0.24 : 0.12;
    P.forEach(p => {
      const w = r * 0.34, y = p.y - r * 0.52, ix = p.x - p.s * w * 0.9, ox = p.x + p.s * w * 1.1;
      g.beginPath(); g.moveTo(ox, y - tilt * r); g.lineTo(ix, y + tilt * r); g.stroke();
    });
  }
  g.restore();
}


/* ---------- 3D mesh ---------- */
function buildMesh(b) {
  // Smooth the outline exactly the way the 2D body draws it (a quadratic B-spline, via Chaikin
  // corner cutting), then sample it finely so the 3D silhouette has no flat facets.
  let C = b.r.map(p => ({ x: p.x, y: p.y }));
  for (let k = 0; k < 3; k++) {
    const out = [];
    for (let i = 0; i < C.length; i++) {
      const p = C[i], q = C[(i + 1) % C.length];
      out.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 }, { x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
    }
    C = out;
  }
  const per = pathLen(C.concat([C[0]]));
  const B = resample(C, clamp(Math.round(per / 4), 140, 260)), M = B.length;
  const s = per / M;

  // inward normals along the outline
  const nB = B.map((p, i) => {
    const a = B[(i + M - 1) % M], c = B[(i + 1) % M];
    const nx = -(c.y - a.y), ny = c.x - a.x, m = Math.hypot(nx, ny) || 1;
    return { x: nx / m, y: ny / m };
  });
  const sgn = inPoly(B, B[0].x + nB[0].x * 0.5, B[0].y + nB[0].y * 0.5) ? 1 : -1;
  nB.forEach(q => { q.x *= sgn; q.y *= sgn; });

  // Distance to the outline, plus which way the surface slopes there. The slope direction is blended
  // between the outline's neighbouring normals, so shading flows smoothly instead of stepping per segment.
  const near = (x, y) => {
    let best = Infinity, bi = 0, bj = 0, bt = 0;
    for (let i = 0, j = M - 1; i < M; j = i++) {
      const a = B[j], c = B[i], vx = c.x - a.x, vy = c.y - a.y;
      const t = clamp(((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy || 1), 0, 1);
      const d = (a.x + vx * t - x) ** 2 + (a.y + vy * t - y) ** 2;
      if (d < best) { best = d; bi = i; bj = j; bt = t; }
    }
    const gx = nB[bj].x * (1 - bt) + nB[bi].x * bt, gy = nB[bj].y * (1 - bt) + nB[bi].y * bt, m = Math.hypot(gx, gy) || 1;
    return { d: Math.sqrt(best), gx: gx / m, gy: gy / m };
  };
  const mk = (x, y, q) => ({ x, y, d: q.d, gx: q.gx, gy: q.gy });

  let dmax = 0;
  const bb = bbox(B), stepD = Math.min(bb.w, bb.h) / 24;
  for (let y = bb.y0; y < bb.y1; y += stepD) for (let x = bb.x0; x < bb.x1; x += stepD)
    if (inPoly(B, x, y)) dmax = Math.max(dmax, distToPoly(B, x, y));
  const cap = Math.max(10, Math.min(dmax, 140));
  const pts = B.map((p, i) => ({ x: p.x, y: p.y, d: 0, gx: nB[i].x, gy: nB[i].y }));

  // Rings that hug the rim. Each ring climbs the same angle around the rounded edge,
  // so they bunch up where the surface curves fastest and spread out as it flattens.
  const K = 10, maxT = Math.PI / 2 * 0.74;
  let prevD = 0;
  for (let k = 1; k <= K; k++) {
    const dk = Math.max(0.4, cap * (1 - Math.cos(k / K * maxT)));
    const stride = Math.max(1, Math.round((dk - prevD) / (s * 1.3)));
    prevD = dk;
    for (let i = 0; i < M; i += stride) {
      const x = B[i].x + nB[i].x * dk, y = B[i].y + nB[i].y * dk;
      if (!inPoly(B, x, y)) continue;
      const q = near(x, y);
      if (q.d < dk * 0.75) continue;
      pts.push(mk(x, y, q));
    }
  }
  // A coarser grid fills the flatter middle.
  const dLast = cap * (1 - Math.cos(maxT));
  const si = Math.max(s * 2, Math.sqrt(Math.abs(area(B)) / 1500));
  let row = 0;
  for (let y = bb.y0 + si * 0.5; y < bb.y1; y += si * 0.866, row++)
    for (let x = bb.x0 + (row % 2 ? si * 0.5 : 0) + si * 0.25; x < bb.x1; x += si) {
      if (!inPoly(B, x, y)) continue;
      const q = near(x, y);
      if (q.d > dLast + si * 0.45) pts.push(mk(x, y, q));
    }

  const del = Delaunator.from(pts, p => p.x, p => p.y), tri = [];
  for (let i = 0; i < del.triangles.length; i += 3) {
    const a = del.triangles[i], c = del.triangles[i + 1], e = del.triangles[i + 2];
    if (inPoly(B, (pts[a].x + pts[c].x + pts[e].x) / 3, (pts[a].y + pts[c].y + pts[e].y) / 3)) tri.push(a, c, e);
  }
  const nb = pts.map(() => new Set());
  for (let i = 0; i < tri.length; i += 3) { const a = tri[i], c = tri[i + 1], e = tri[i + 2]; nb[a].add(c).add(e); nb[c].add(a).add(e); nb[e].add(a).add(c); }

  // Heights and normals come straight from the balloon profile, not from the triangles,
  // so shading stays smooth even where the triangles are uneven.
  const h = [], fn = [];
  for (const p of pts) {
    const v = Math.min(p.d, cap) / cap, u = 1 - v, w = Math.sqrt(Math.max(0, 1 - u * u));
    h.push(cap * w * PUFF);
    const nx = -PUFF * u * p.gx, ny = PUFF * u * p.gy, m = Math.hypot(nx, ny, w) || 1;
    fn.push([nx / m, ny / m, w / m]);
  }
  for (let it = 0; it < 2; it++) {
    const nxt = fn.map((v, i) => {
      if (i < M || !nb[i].size) return v;
      let x = v[0] * 2, y = v[1] * 2, z = v[2] * 2;
      nb[i].forEach(j => { x += fn[j][0]; y += fn[j][1]; z += fn[j][2]; });
      const m = Math.hypot(x, y, z) || 1;
      return [x / m, y / m, z / m];
    });
    fn.splice(0, fn.length, ...nxt);
  }

  const n = pts.length, total = n + (n - M);
  const pos = new Float32Array(total * 3), uv = new Float32Array(total * 2), fuv = new Float32Array(total * 2), nor = new Float32Array(total * 3);
  const back = (i) => i < M ? i : n + (i - M);
  const r = b.eyeR, fw = r * 4.4, fh = r * 3.0, fx0 = b.eyeRel.x - fw / 2, fy0 = b.eyeRel.y - fh / 2;
  // paint coordinates: the outline's bounding box maps onto the whole paint canvas
  const pu = (x) => (x - b.minX) / b.w, pv = (y) => 1 - (y - b.minY) / b.h;
  for (let i = 0; i < n; i++) {
    const p = pts[i], f = fn[i];
    pos.set([p.x, -p.y, h[i]], i * 3);
    nor.set(f, i * 3);
    uv.set([pu(p.x), pv(p.y)], i * 2);
    fuv.set([(p.x - fx0) / fw, 1 - (p.y - fy0) / fh], i * 2);
    if (i >= M) {
      const j = back(i), bx = f[0] * BACK, by = f[1] * BACK, m = Math.hypot(bx, by, f[2]) || 1;
      pos.set([p.x, -p.y, -h[i] * BACK], j * 3);
      nor.set([bx / m, by / m, -f[2] / m], j * 3);
      uv.set([pu(p.x), pv(p.y)], j * 2);
      fuv.set([-1, -1], j * 2);
    }
  }
  const front = [], idx = [];
  for (let i = 0; i < tri.length; i += 3) {
    let a = tri[i], c = tri[i + 1], e = tri[i + 2];
    const z = (pts[c].x - pts[a].x) * (pts[a].y - pts[e].y) - (pts[a].y - pts[c].y) * (pts[e].x - pts[a].x);
    if (z < 0) [c, e] = [e, c];
    front.push(a, c, e); idx.push(a, c, e, back(a), back(e), back(c));
  }
  const geom = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3);
  geom.setAttribute('position', posAttr);
  geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.setIndex(idx);

  const face = new THREE.BufferGeometry();
  face.setAttribute('position', posAttr);
  face.setAttribute('normal', geom.attributes.normal);
  face.setAttribute('uv', new THREE.BufferAttribute(fuv, 2));
  face.setIndex(front);
  return { geom, face };
}

export { area, centroid, bbox, inPoly, distToPoly, pathLen, resample, drawEyeStyle, buildMesh, SPACING };
