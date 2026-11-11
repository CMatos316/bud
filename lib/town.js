// The island town: where every bud's home goes, and the lanes between them.
//
// Nobody lays the town out. Each bud, in the order they arrived, picks a spot by a few rules, and a lane grows
// from their door to the nearest lane. Homes never move once placed, so the first homes end up as the old town
// round the campfire and later ones spread out from it. The island is round, so there are no rows and no grid:
// the campfire square is the hub, five lanes wander out from it like the spokes of a wheel (the sixth spoke is
// the road down to the dock), and every home's own lane branches off whatever is nearest.
// A home fronts onto its lane, and no lane ever runs under a home: when a home is in the way, the lane bends
// round it.
//
// Who settles where:
// - founders (everyone who was already on the island when the town began): the first few ring the campfire
//   square; each one after settles beside some earlier bud, picked at random. They stay off the land by the
//   dock road, and their lanes do too.
// - a newcomer someone brought: next door to that bud.
// - a newcomer who came on their own: by the road up from the dock.
//
// Everything here is pure and deterministic (random choices are seeded by the bud's id), so the same arrivals
// always give the same town. Distances are in island units (a bud is about 1.9 across).

export const HOME_R = 1.35;      // how close a bud can walk to a home's middle
// A home's footprint, in its own frame (it faces +z): everything the island page draws for a home, roof,
// mailbox and flowers included, fits inside this rectangle. If the homes there get bigger, so must this.
const HX = 1.45, HZ_BACK = 1.3, HZ_FRONT = 1.6;
const FOOT = Math.hypot(HX, HZ_FRONT);   // so nothing of a home is further than this from its middle
const PAD = 0.8;                 // the middle of a lane stays this far from any home's footprint (a lane is 0.55 wide either side, and wanders a little)
const YARD = HZ_FRONT + PAD + 0.05;   // how far out front a home's lane runs before other lanes may join it
export const SPACE = 2 * (HX + PAD) + 0.3;   // the least distance between two homes: a lane can pass between
export const SQUARE_R = 3.4;     // the campfire square's ring of stones
const HOME_MIN_R = 6;            // homes stay this far from the campfire
export const ROAD_HALF = 1.2;    // half the width of the road from the square to the dock
const ROAD_PAD = 1.55 + 0.15;    // the road is drawn 1.55 either side of its middle; footprints keep clear of that
const NEWCOMER_STRIP = 7.4;      // the land either side of the dock road that founders leave for newcomers
const FIRST_RING = 4;            // this many founders settle round the square (one between each pair of spokes)
const LANE_MAX = 12;             // a lane longer than this isn't a lane, it's a hike

// Fixed spots, so the homes and the things they avoid always agree. +z is the south shore, where the dock is.
// The pond, the love tree and the plots each sit in the middle of a wedge between two spokes.
export const SITES = {
  fire: { x: 0, z: 0 },
  pond: { x: -5.8, z: -10.05, r: 2.2 },
  tree: { x: 5.55, z: -9.6, r: 1.5 },
  // plots kept free for buildings the island chooses later
  reserved: [{ x: -12.4, z: 0, r: 2.9 }, { x: 12.4, z: 0, r: 2.9 }],
  // the notice board and the well stand either side of the road, where it meets the square
  board: { x: -2.64, z: 3.77, r: 0.9 },
  well: { x: 2.64, z: 3.77, r: 0.9 },
};
const ROUND = [SITES.pond, SITES.tree, ...SITES.reserved, SITES.board, SITES.well];   // round things homes and lanes keep clear of
// The spokes: lanes that wander out from the square. Angles in degrees, where 90 is south (the dock road).
// A spoke is only drawn as far as someone uses it, but its whole line is kept clear so it can always go on.
const SPOKE_DEG = [150, 210, 270, 330, 30], SPOKE_STEP = 3;
const spokePoint = (k, i) => {
  const r = SQUARE_R + SPOKE_STEP * i, a = SPOKE_DEG[k] * Math.PI / 180 + (i ? 0.075 * Math.sin(i * 1.3 + k * 2.1) : 0);
  return [Math.cos(a) * r, Math.sin(a) * r];
};

// how big the island is with no town on it (the same formula the island has always used)
export const baseRadius = (n) => Math.min(30, Math.max(11, 9 + Math.sqrt(n) * 2.2));

function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
const TAU = Math.PI * 2;
const r2 = (v) => Math.round(v * 100) / 100;
// distance from a point to a segment
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, len2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2));
  return Math.hypot(ax + vx * t - px, az + vz * t - pz);
}
const inStrip = (x, z) => z > 4.5 && Math.abs(x) < NEWCOMER_STRIP;
// how far a stretch of lane (a to b) passes from a home's footprint: 0 if it crosses it
function rectGap(h, ax, az, bx, bz) {
  const c = Math.cos(h.rot), s = Math.sin(h.rot);
  // into the home's own frame, where +z is out of the front door
  const x0 = (ax - h.x) * c - (az - h.z) * s, z0 = (ax - h.x) * s + (az - h.z) * c;
  const x1 = (bx - h.x) * c - (bz - h.z) * s, z1 = (bx - h.x) * s + (bz - h.z) * c;
  // does it cross the rectangle? (clip the stretch to it)
  let t0 = 0, t1 = 1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  const dx = x1 - x0, dz = z1 - z0;
  if (clip(-dx, x0 + HX) && clip(dx, HX - x0) && clip(-dz, z0 + HZ_BACK) && clip(dz, HZ_FRONT - z0) && t0 <= t1) return 0;
  const toRect = (x, z) => Math.hypot(Math.max(-HX - x, 0, x - HX), Math.max(-HZ_BACK - z, 0, z - HZ_FRONT));
  let d = Math.min(toRect(x0, z0), toRect(x1, z1));
  for (const [cx, cz] of [[-HX, -HZ_BACK], [HX, -HZ_BACK], [HX, HZ_FRONT], [-HX, HZ_FRONT]]) d = Math.min(d, segDist(cx, cz, x0, z0, x1, z1));
  return d;
}
// a lane as the rules keep it: the stretches from the home's middle, through any bends, to where it joins
const segsOf = (x, z, pts) => pts.map((q, k) => (k ? [pts[k - 1][0], pts[k - 1][1], q[0], q[1]] : [x, z, q[0], q[1]]));

// people: [{ id, at (ms they arrived), by (who brought them, or null), founder (true if here before the town) }]
// in arrival order. Returns the whole town. Pass an earlier town as `before` to keep its homes exactly where
// they are and only place the newcomers.
export function growTown(people, before = null) {
  const homes = [], lanes = [], byId = new Map(), ring = [];
  let lim = 0, founders = 0;
  const keep = new Map((before?.homes || []).map((h) => [h.id, h]));

  // the stretches of each spoke, out to a little past where homes can be right now: [k, i, ax, az, bx, bz]
  const spokeSegs = () => {
    const out = [], count = Math.ceil((lim + 5 - SQUARE_R) / SPOKE_STEP);
    for (let k = 0; k < SPOKE_DEG.length; k++) for (let i = 0; i < count; i++) { const a = spokePoint(k, i), b = spokePoint(k, i + 1); out.push([k, i, a[0], a[1], b[0], b[1]]); }
    return out;
  };
  let spokes = [];
  const clearOf = (x, z, pad) => {
    for (const s of ROUND) if (Math.hypot(x - s.x, z - s.z) < s.r + pad) return false;
    return true;
  };
  const okSpot = (x, z, founder) => {
    const d = Math.hypot(x, z);
    if (d > lim || d < HOME_MIN_R) return false;
    if (z > 0 && Math.abs(x) < ROAD_PAD + HX) return false;
    if (founder && inStrip(x, z)) return false;
    if (!clearOf(x, z, FOOT + 0.4)) return false;
    for (const h of homes) if (Math.hypot(x - h.x, z - h.z) < SPACE) return false;
    for (const l of lanes) for (const g of l.segs) if (segDist(x, z, g[0], g[1], g[2], g[3]) < HX + PAD) return false;   // (a quick first look; `fits` is the real test)
    for (const g of spokes) if (segDist(x, z, g[2], g[3], g[4], g[5]) < HX + PAD) return false;
    return true;
  };
  // once we know which way a home would face: is its whole footprint clear of every lane and the dock road?
  const fits = (x, z, rot) => {
    const me = { x, z, rot };
    for (const l of lanes) for (const g of l.segs) if (rectGap(me, g[0], g[1], g[2], g[3]) < PAD) return false;
    for (const g of spokes) if (rectGap(me, g[2], g[3], g[4], g[5]) < PAD) return false;
    return z < -FOOT - ROAD_PAD || rectGap(me, 0, SQUARE_R, 0, 1e4) >= ROAD_PAD;
  };
  // What's in the way of a stretch of lane: a home, the pond, the tree or a plot (returned, so the lane can
  // bend round it), or something a lane can't go round (true): the dock road, or for founders the road's land.
  const blocker = (ax, az, bx, bz, founder) => {
    for (const h of homes) if (rectGap(h, ax, az, bx, bz) < PAD - 0.02) return h;
    for (const st of ROUND) if (segDist(st.x, st.z, ax, az, bx, bz) < st.r + 0.9) return { x: st.x, z: st.z, round: st.r + 0.9 };
    if (Math.max(az, bz) > SQUARE_R && ax * bx < 0) return true;   // no crossing the dock road
    if (founder) for (let k = 0; k <= 6; k++) if (inStrip(ax + (bx - ax) * k / 6, az + (bz - az) * k / 6)) return true;
    return null;
  };
  // a way from a to b that keeps clear of everything, with up to `bends` bends round whatever's in the way:
  // the points after a
  const route = (ax, az, bx, bz, bends, founder) => {
    const hit = blocker(ax, az, bx, bz, founder);
    if (!hit) return [[bx, bz]];
    if (hit === true || !bends) return null;
    const d = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / d, uz = (bz - az) / d;
    for (const k of hit.round ? [hit.round + 0.15, hit.round + 0.9] : [HX + PAD + 0.1, FOOT + PAD + 0.1, FOOT + PAD + 0.8]) for (const side of [1, -1]) {
      const wx = hit.x - uz * side * k, wz = hit.z + ux * side * k, wr = Math.hypot(wx, wz);
      if (wr > lim + FOOT || wr < SQUARE_R + 1 || (wz > 0 && Math.abs(wx) < ROAD_HALF + 0.9)) continue;
      if (blocker(ax, az, wx, wz, founder)) continue;
      const rest = route(wx, wz, bx, bz, bends - 1, founder);
      if (rest) return [[wx, wz], ...rest];
    }
    return null;
  };
  // If a lane comes right alongside another lane on its way, it joins that one there instead of running
  // beside it: lanes meet, they don't braid.
  const meet = (x, z, pts, ref, founder) => {
    let px = x, pz = z, walked = 0;
    for (let k = 0; k < pts.length; k++) {
      const [qx, qz] = pts[k], len = Math.hypot(qx - px, qz - pz), steps = Math.max(1, Math.ceil(len / 0.4));
      for (let i = 1; i <= steps; i++) {
        walked += len / steps;
        if (walked < YARD + 0.4 || (k === pts.length - 1 && i === steps)) continue;
        const sx = px + (qx - px) * i / steps, sz = pz + (qz - pz) * i / steps;
        const fromX = k ? pts[k - 1][0] : x, fromZ = k ? pts[k - 1][1] : z;
        const touch = (ax, az, bx, bz, joinRef) => {
          const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((sx - ax) * vx + (sz - az) * vz) / (vx * vx + vz * vz || 1)));
          const jx = ax + vx * t, jz = az + vz * t;
          if (Math.hypot(jx - sx, jz - sz) > 1.1 || blocker(fromX, fromZ, jx, jz, founder)) return null;
          return { pts: [...pts.slice(0, k), [jx, jz]], ref: joinRef(jx, jz) };
        };
        for (const g of spokes) { const hit = touch(g[2], g[3], g[4], g[5], (jx, jz) => ({ t: 'spoke', k: g[0], r: r2(Math.hypot(jx, jz)) })); if (hit) return hit; }
        for (const l of lanes) for (const g of l.segs) { const hit = touch(g[0], g[1], g[2], g[3], () => ({ t: 'home', id: l.id })); if (hit) return hit; }
      }
      px = qx; pz = qz;
    }
    return { pts, ref };
  };
  // The best way for a home at (x, z) to join the network: the edge of the square, a spoke, the dock road
  // (not for founders), or the nearest point along someone else's lane (lanes branch off lanes).
  const laneFrom = (x, z, anchor, founder) => {
    const options = [];
    for (const da of [0, 0.35, -0.35, 0.7, -0.7]) { const a = Math.atan2(z, x) + da; options.push({ px: Math.cos(a) * SQUARE_R, pz: Math.sin(a) * SQUARE_R, ref: { t: 'square' }, w: 1 + Math.abs(da) * 0.3 }); }
    if (!founder && lim + 2 > SQUARE_R) { const rz = Math.max(SQUARE_R, Math.min(lim + 2, z)); options.push({ px: Math.sign(x || 1) * ROAD_HALF * 0.6, pz: rz, ref: { t: 'road' }, w: 1 }); }
    for (let k = 0; k < SPOKE_DEG.length; k++) {   // the nearest point on each spoke
      let near = null;
      for (const g of spokes) {
        if (g[0] !== k) continue;
        const vx = g[4] - g[2], vz = g[5] - g[3], t = Math.max(0, Math.min(1, ((x - g[2]) * vx + (z - g[3]) * vz) / (vx * vx + vz * vz)));
        const px = g[2] + vx * t, pz = g[3] + vz * t, d = Math.hypot(px - x, pz - z);
        if (Math.hypot(px, pz) <= lim + 2 && (!near || d < near.d)) near = { px, pz, d };
      }
      if (near) options.push({ px: near.px, pz: near.pz, ref: { t: 'spoke', k, r: r2(Math.hypot(near.px, near.pz)) }, w: 0.9 });
    }
    for (const l of lanes) l.segs.forEach((g, k) => {
      let [ax, az, bx, bz] = g;
      if (k === 0) {   // others may join a lane only once it has left its owner's front yard
        const len = Math.hypot(bx - ax, bz - az), t0 = Math.min(1, YARD / (len || 1));
        ax += (bx - ax) * t0; az += (bz - az) * t0;
      }
      const vx = bx - ax, vz = bz - az, len2 = vx * vx + vz * vz, t = len2 > 1e-6 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2)) : 0;
      options.push({ px: ax + vx * t, pz: az + vz * t, ref: { t: 'home', id: l.id }, w: anchor && l.id === anchor.id ? 0.7 : 1 });
    });
    for (const o of options) o.d = Math.hypot(o.px - x, o.pz - z);
    options.sort((p, q) => p.d * p.w - q.d * q.w);
    let best = null;
    for (const o of options.slice(0, 10)) {
      if (o.d > LANE_MAX || o.d < HZ_FRONT + 0.3) continue;
      const way = route(x, z, o.px, o.pz, 2, founder);
      if (!way) continue;
      const { pts, ref } = meet(x, z, way, o.ref, founder);
      let d = 0, px = x, pz = z;
      for (const [qx, qz] of pts) { d += Math.hypot(qx - px, qz - pz); px = qx; pz = qz; }
      const first = Math.hypot(pts[0][0] - x, pts[0][1] - z);
      if (first < HZ_FRONT + 0.3 || d > LANE_MAX + 3) continue;
      if (!best || d * o.w < best.cost) best = { pts, d, cost: d * o.w, ux: (pts[0][0] - x) / first, uz: (pts[0][1] - z) / first, ref };
      if (pts.length === 1) break;   // a straight lane to the nearest thing: can't do better
    }
    return best;
  };

  for (const p of people) {
    const n = homes.length, rnd = seeded('plot:' + p.id);
    const founder = !!p.founder;
    lim = r2(Math.max(lim, 0.78 * baseRadius(n + 1) - FOOT - 0.4));   // (kept to two places, so a saved town grows the same way)
    spokes = spokeSegs();
    const kept = keep.get(p.id);
    if (kept) {   // already has a home: it stays exactly where it is
      const h = { ...kept, n };
      homes.push(h); byId.set(p.id, h); lim = r2(Math.max(lim, h.lim || Math.hypot(h.x, h.z)));
      lanes.push({ id: h.id, segs: segsOf(h.x, h.z, h.lane.pts) });
      if (founder) { founders++; if (h.ring) ring.push(Math.atan2(h.z, h.x)); }
      continue;
    }
    const inviter = p.by && byId.get(p.by) || null;
    const kind = inviter ? 'invited' : founder ? 'founder' : 'solo';
    const strict = founder && !inviter;   // founders keep off the dock road's land, lanes and all
    const inRing = strict && founders < FIRST_RING;
    // founders settle beside some earlier bud, picked at random: a few are tried and the snuggest spot wins
    const pals = inviter ? [inviter] : strict && !inRing && n > 0 ? [0, 1, 2].map(() => homes[Math.floor(rnd() * n)]) : [];
    let anchor = pals[0] || null;
    let best = null;
    const consider = (x, z, bias) => {
      if (!okSpot(x, z, strict)) return false;
      const lane = laneFrom(x, z, anchor, strict);
      if (!lane || !fits(x, z, Math.atan2(lane.ux, lane.uz))) return false;
      const score = bias + lane.d * 0.7 + Math.hypot(x, z) * 0.45 + rnd() * 0.5;   // near their person, a short lane, and not far out
      if (!best || score < best.score) best = { x, z, lane, score };
      return true;
    };
    // the nearest free grass to a spot: rings of tries, widening until one of them has room
    const near = (cx, cz, from, to) => {
      for (let d = from, got = false; d <= to && !got; d += 0.7) {
        const turn = rnd() * TAU, tries = Math.max(14, Math.round(d * 3));
        for (let t = 0; t < tries; t++) { const a = turn + t / tries * TAU, dd = d + rnd() * 0.7; if (consider(cx + Math.cos(a) * dd, cz + Math.sin(a) * dd, dd)) got = true; }
      }
    };
    for (let grow = 0; grow < 80 && !best; grow++) {
      if (grow) { lim = r2(lim + 1.2); spokes = spokeSegs(); }   // no room: the island gets a little bigger
      if (inRing) {
        // round the square, in the widest gap between the homes already there
        for (let t = 0; t < 90; t++) {
          const a = rnd() * TAU, d = HOME_MIN_R + 0.1 + rnd() * 1.4;
          const gap = ring.length ? Math.min(...ring.map((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))))) : 1;
          consider(Math.cos(a) * d, Math.sin(a) * d, -gap * 6);
        }
      } else if (pals.length) for (const pal of pals) { anchor = pal; near(pal.x, pal.z, SPACE + 0.05, 13 + grow * 2); }
      else if (kind === 'solo') {
        // by the dock road: either side, as near the square as there's room, then a row or two back.
        // When that's full the island grows and the road gets longer.
        for (let t = 0; t < 90; t++) { const side = rnd() < 0.5 ? -1 : 1, z = HOME_MIN_R + rnd() * Math.max(1, lim - HOME_MIN_R); consider(side * (ROAD_PAD + HZ_FRONT + 0.1 + rnd() * 1.2), z, z * 0.5); }
        for (let t = 0; t < 160 && !best; t++) { const side = rnd() < 0.5 ? -1 : 1, z = HOME_MIN_R - 1 + rnd() * Math.max(1, lim - HOME_MIN_R); consider(side * (ROAD_PAD + HZ_FRONT + 1.3 + rnd() * (NEWCOMER_STRIP - 3.3)), z, z * 0.5 + 3); }
        continue;
      }
      // still nothing: anywhere there's grass, from the middle out (someone who was brought keeps looking
      // near their person for longer first)
      if (!best && (inRing || grow >= (inviter ? 6 : 1))) for (let r = HOME_MIN_R; r <= lim && !best; r += 0.8) for (let t = 0; t < 30; t++) { const a = rnd() * TAU; consider(Math.cos(a) * r, Math.sin(a) * r, r); }
    }
    if (!best) throw new Error('no room for a home');   // can't happen: the island keeps growing until there is
    const x = r2(best.x), z = r2(best.z), L = best.lane, pts = L.pts.map(([px, pz]) => [r2(px), r2(pz)]);
    const out = Math.min(2, Math.hypot(pts[0][0] - x, pts[0][1] - z));
    const h = {
      id: p.id, n, x, z, rot: r2(Math.atan2(L.ux, L.uz)),
      kind, by: inviter ? inviter.id : null, at: p.at || 0, up: L.ref, lim: r2(lim),
      // (x0, z0) is the spot just outside the front door; pts is any bends, then where the lane joins
      lane: { x0: r2(x + L.ux * out), z0: r2(z + L.uz * out), pts },
    };
    if (inRing) { h.ring = true; ring.push(Math.atan2(z, x)); }
    homes.push(h); byId.set(p.id, h); lanes.push({ id: p.id, segs: segsOf(x, z, pts) });
    if (founder) founders++;
  }

  // how many homes use each lane, and each stretch of each spoke, to reach the square
  const use = new Array(homes.length).fill(0), reach = SPOKE_DEG.map(() => []);
  for (const h of homes) {
    let k = h, end = h;
    for (let hop = 0; k && hop < 400; hop++) { use[k.n]++; end = k; k = k.up.t === 'home' ? byId.get(k.up.id) : null; }
    if (end.up.t === 'spoke') reach[end.up.k].push(end.up.r);
  }
  const spokesOut = SPOKE_DEG.map((deg, k) => {
    const far = Math.max(0, ...reach[k]), pieces = far ? Math.ceil((far - SQUARE_R) / SPOKE_STEP) : 0, pts = [], uses = [];
    for (let i = 0; i <= pieces; i++) {
      let pt = spokePoint(k, i);
      if (i === pieces && pieces) { const a = spokePoint(k, i - 1), t = (far - (SQUARE_R + SPOKE_STEP * (i - 1))) / SPOKE_STEP; pt = [a[0] + (pt[0] - a[0]) * t, a[1] + (pt[1] - a[1]) * t]; }   // stop where the last lane joins
      pts.push([r2(pt[0]), r2(pt[1])]);
      if (i < pieces) uses.push(reach[k].filter((r) => r > SQUARE_R + SPOKE_STEP * i + 0.01).length);
    }
    return { pts: pieces ? pts : [], use: uses };
  });
  const townR = homes.reduce((m, h) => Math.max(m, Math.hypot(h.x, h.z)), HOME_MIN_R);
  const n = homes.length;
  return {
    v: 3, n, lim: r2(lim), townR: r2(townR),
    // the island must be big enough to hold the town, with grass left over to wander on
    R: r2(Math.max(baseRadius(n), (townR + FOOT + 0.4) / 0.78)),
    homes: homes.map((h) => ({ ...h, use: use[h.n] })),
    spokes: spokesOut,
  };
}

// What the island page needs to draw it.
export function townForWorld(town) {
  return {
    v: town.v, R: town.R, squareR: SQUARE_R, roadHalf: ROAD_HALF, homeR: HOME_R, sites: SITES, spokes: town.spokes,
    homes: town.homes.map((h) => ({ id: h.id, x: h.x, z: h.z, rot: h.rot, kind: h.kind, by: h.by, at: h.at, use: h.use, lane: h.lane, up: h.up.t })),
  };
}
