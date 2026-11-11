// The island town: where every bud's home goes, and the lanes between them.
//
// Nobody lays the town out. Each bud, in the order they arrived, picks a spot by a few rules, and a lane grows
// from their door to the nearest lane. Homes never move once placed, so the first homes end up as the old town
// round the campfire and later ones spread out from it. The island is round, so there are no rows and no grid:
// just the campfire square in the middle, one road down to the dock, and lanes branching off like a tree.
//
// Who settles where:
// - founders (everyone who was already on the island when the town began): next to some earlier bud, picked
//   at random; the first few ring the campfire square. They stay off the land by the dock road.
// - a newcomer someone brought: next door to that bud.
// - a newcomer who came on their own: by the road up from the dock.
//
// Everything here is pure and deterministic (random choices are seeded by the bud's id), so the same arrivals
// always give the same town. Distances are in island units (a bud is about 1.9 across).

export const SPACE = 4.3;        // the least distance between two homes
export const HOME_R = 1.35;      // a home's footprint: lanes and other things keep this far from its middle
export const SQUARE_R = 3.4;     // the campfire square's ring of stones
const HOME_MIN_R = 5.9;          // homes stay this far from the campfire
export const ROAD_HALF = 1.2;    // half the width of the road from the square to the dock
const ROAD_CLEAR = ROAD_HALF + HOME_R + 0.5;   // homes keep their middles this far from the road's middle
const NEWCOMER_STRIP = 6.8;      // the land either side of the dock road that founders leave for newcomers
const FIRST_RING = 6;            // this many founders settle round the square before homes branch off homes
const LANE_MAX = 11;             // a lane longer than this isn't a lane, it's a hike

// Fixed spots, so the homes and the things they avoid always agree. +z is the south shore, where the dock is.
export const SITES = {
  fire: { x: 0, z: 0 },
  pond: { x: -7.6, z: -6.6, r: 2.2 },
  tree: { x: 7.4, z: -6.2, r: 1.5 },
  // plots kept free near the square for buildings the island chooses later
  reserved: [{ x: -10.8, z: 1.6, r: 2.9 }, { x: 10.8, z: 1.6, r: 2.9 }],
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

// people: [{ id, at (ms they arrived), by (who brought them, or null), founder (true if here before the town) }]
// in arrival order. Returns the whole town. Pass an earlier town as `before` to keep its homes exactly where
// they are and only place the newcomers.
export function growTown(people, before = null) {
  const homes = [], lanes = [], byId = new Map();
  let lim = 0, founders = 0;
  const keep = new Map((before?.homes || []).map((h) => [h.id, h]));

  const clearOf = (x, z, pad) => {
    const { pond, tree, reserved } = SITES;
    if (Math.hypot(x - pond.x, z - pond.z) < pond.r + pad || Math.hypot(x - tree.x, z - tree.z) < tree.r + pad) return false;
    for (const s of reserved) if (Math.hypot(x - s.x, z - s.z) < s.r + pad) return false;
    return true;
  };
  const okSpot = (x, z, founder) => {
    const d = Math.hypot(x, z);
    if (d > lim || d < HOME_MIN_R) return false;
    if (z > 0 && Math.abs(x) < ROAD_CLEAR) return false;
    if (founder && z > 4.5 && Math.abs(x) < NEWCOMER_STRIP) return false;
    if (!clearOf(x, z, HOME_R + 0.9)) return false;
    for (const h of homes) if (Math.hypot(x - h.x, z - h.z) < SPACE) return false;
    for (const l of lanes) if (segDist(x, z, l.x0, l.z0, l.x1, l.z1) < HOME_R + 0.7) return false;
    return true;
  };
  // the best thing already on the network to run a lane to from (x, z): [point, ref, length], or null
  const laneFrom = (x, z, anchor) => {
    const options = [];
    const a = Math.atan2(z, x); options.push({ px: Math.cos(a) * SQUARE_R, pz: Math.sin(a) * SQUARE_R, ref: { t: 'square' }, w: 1 });
    const roadEnd = lim + 2;
    if (roadEnd > SQUARE_R) { const rz = Math.max(SQUARE_R, Math.min(roadEnd, z)); options.push({ px: Math.sign(x || 1) * ROAD_HALF * 0.6, pz: rz, ref: { t: 'road' }, w: 1 }); }
    for (const h of homes) options.push({ px: h.gx, pz: h.gz, ref: { t: 'home', id: h.id }, w: anchor && h.id === anchor.id ? 0.7 : 1 });
    for (const o of options) o.d = Math.hypot(o.px - x, o.pz - z);
    options.sort((p, q) => p.d * p.w - q.d * q.w);
    for (const o of options.slice(0, 4)) {
      if (o.d > LANE_MAX || o.d < HOME_R + 0.5) continue;
      const ux = (o.px - x) / o.d, uz = (o.pz - z) / o.d, gx = x + ux * (HOME_R + 0.4), gz = z + uz * (HOME_R + 0.4);
      // the lane mustn't cut through another home, the pond, the tree or a plot kept for later
      let clear = true;
      for (const h of homes) if (!(o.ref.t === 'home' && o.ref.id === h.id) && segDist(h.x, h.z, gx, gz, o.px, o.pz) < HOME_R + 0.45) { clear = false; break; }
      const { pond, tree, reserved } = SITES;
      if (clear) for (const s of [pond, tree, ...reserved]) if (segDist(s.x, s.z, gx, gz, o.px, o.pz) < s.r + 0.5) { clear = false; break; }
      if (clear) return { ...o, gx, gz, ux, uz };
    }
    return null;
  };

  for (const p of people) {
    const n = homes.length, rnd = seeded('plot:' + p.id);
    const founder = !!p.founder;
    lim = Math.max(lim, 0.78 * baseRadius(n + 1) - HOME_R - 1.2);
    const kept = keep.get(p.id);
    if (kept) {   // already has a home: it stays exactly where it is
      const h = { ...kept, n };
      homes.push(h); byId.set(p.id, h); lim = Math.max(lim, h.lim || Math.hypot(h.x, h.z));
      if (h.lane) lanes.push({ ...h.lane, child: n });
      if (founder) founders++;
      continue;
    }
    const inviter = p.by && byId.get(p.by) || null;
    const kind = inviter ? 'invited' : founder ? 'founder' : 'solo';
    // founders settle beside some earlier bud, picked at random: a few are tried and the snuggest spot wins
    const pals = inviter ? [inviter] : founder && founders >= FIRST_RING && n > 0 ? [0, 1, 2].map(() => homes[Math.floor(rnd() * n)]) : [];
    let anchor = pals[0] || null;
    let best = null;
    const consider = (x, z, bias) => {
      if (!okSpot(x, z, founder && !inviter)) return false;
      const lane = laneFrom(x, z, anchor);
      if (!lane) return false;
      const score = bias + lane.d * 0.6 + Math.hypot(x, z) * 0.45 + rnd() * 0.5;   // near their person, a short lane, and not far out
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
      if (grow) lim += 1.2;   // no room: the island gets a little bigger
      if (pals.length) for (const pal of pals) { anchor = pal; near(pal.x, pal.z, SPACE + 0.05, 13 + grow * 2); }
      else if (kind === 'solo') {
        // by the dock road: either side, as near the square as there's room, then a row or two back.
        // When that's full the island grows and the road gets longer.
        for (let t = 0; t < 90; t++) { const side = rnd() < 0.5 ? -1 : 1, z = HOME_MIN_R + rnd() * Math.max(1, lim - HOME_MIN_R); consider(side * (ROAD_CLEAR + 0.2 + rnd() * 1.3), z, z * 0.5); }
        for (let t = 0; t < 160 && !best; t++) { const side = rnd() < 0.5 ? -1 : 1, z = HOME_MIN_R - 1 + rnd() * Math.max(1, lim - HOME_MIN_R); consider(side * (ROAD_CLEAR + 1.5 + rnd() * (NEWCOMER_STRIP - ROAD_CLEAR)), z, z * 0.5 + 3); }
        continue;
      } else near(0, 0, HOME_MIN_R + 0.1, HOME_MIN_R + 2.5);   // the first founders ring the square
      // still nothing after the island has grown a few times: anywhere there's grass, from the middle out
      if (grow >= 3) for (let r = HOME_MIN_R; r <= lim && !best; r += 0.8) for (let t = 0; t < 30; t++) { const a = rnd() * TAU; consider(Math.cos(a) * r, Math.sin(a) * r, r); }
    }
    if (!best) throw new Error('no room for a home');   // can't happen: the island keeps growing until there is
    const { lane } = best;
    const h = {
      id: p.id, n, x: r2(best.x), z: r2(best.z), rot: r2(Math.atan2(lane.ux, lane.uz)), gx: r2(lane.gx), gz: r2(lane.gz),
      kind, by: inviter ? inviter.id : null, at: p.at || 0, up: lane.ref, lim: r2(lim),
      lane: { x0: r2(lane.gx), z0: r2(lane.gz), x1: r2(lane.px), z1: r2(lane.pz) },
    };
    homes.push(h); byId.set(p.id, h); lanes.push({ ...h.lane, child: n });
    if (founder) founders++;
  }

  // how many homes use each lane to reach the square or the road
  const use = new Array(homes.length).fill(0);
  for (const h of homes) { let k = h; for (let hop = 0; k && hop < 400; hop++) { use[k.n]++; k = k.up.t === 'home' ? byId.get(k.up.id) : null; } }
  const townR = homes.reduce((m, h) => Math.max(m, Math.hypot(h.x, h.z)), HOME_MIN_R);
  const n = homes.length;
  return {
    v: 1, n, lim: r2(lim), townR: r2(townR),
    // the island must be big enough to hold the town, with grass left over to wander on
    R: r2(Math.max(baseRadius(n), (townR + HOME_R + 1.2) / 0.78)),
    homes: homes.map((h) => ({ ...h, use: use[h.n] })),
  };
}

// What the island page needs to draw it.
export function townForWorld(town) {
  return {
    v: town.v, R: town.R, squareR: SQUARE_R, roadHalf: ROAD_HALF, homeR: HOME_R, sites: SITES,
    homes: town.homes.map((h) => ({ id: h.id, x: h.x, z: h.z, rot: h.rot, kind: h.kind, by: h.by, at: h.at, use: h.use, lane: h.lane, up: h.up.t })),
  };
}
