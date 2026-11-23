// Bud Royal: the battle as pure numbers. No drawing, no network, no clock of its own.
// Two phones run this same file from the same seed and the same list of placements and must arrive at exactly the
// same battle, so the rules only ever use + - * / and Math.sqrt/floor/min/max/abs (which every phone computes
// identically). No sin, cos, atan, pow, exp or Math.random in here, ever. Random things come from the battle's
// own seeded dice.
//
// The meadow is 18 wide and 32 long. Side 0's home is at the bottom (y = 3), side 1's at the top (y = 29). A river
// runs across the middle with a bridge in each lane. Each side has two guardian trees, one per lane, in front of
// its home. A side's own bud lives in the home; the cards are other people's buds.
// You win by knocking the other home down, or by having felled more trees when time runs out.

export const ROYAL = {
  W: 18, L: 32, TICK: 20,                       // ticks a second
  RIVER0: 15, RIVER1: 17, BRIDGES: [3.5, 14.5], BRIDGE_HALF: 1.1,
  GLOW_MAX: 10, GLOW_START: 5, GLOW_S: 2.5,     // seconds for one Glow (half that in the last minute)
  MATCH_S: 180, DOUBLE_S: 60, OVER_S: 60,
  ARRIVE_S: 1,                                  // a bud takes this long to arrive after it's placed
  LAND_TICKS: 10,                               // a placement lands this many ticks after it's sent (hides lag)
  TREE_GIFT: 4,                                 // lose a tree and its last gift is this much Glow, to fight back with
  HAND: 4, DECK: 8, DEEP: 21,                   // how far up you may place once the tree in that lane is down
  TREE: { hp: 1250, dmg: 42, hit: 0.8, range: 6.5, r: 1.1, shot: 12 },
  HOME: { hp: 2300, dmg: 55, hit: 1.0, range: 6.5, r: 1.6, shot: 12 },
};
const T = ROYAL.TICK;

// The powers. cost in Glow; hp; dmg per hit; hit = seconds between hits; speed in squares a second; range (0.9 or
// less is hand to hand); r = how big it is. `only: 'build'` goes for trees, sprouts and homes and ignores buds.
export const KINDS = {
  bookworm: { name: 'Bookworm', loves: 'reading', role: 'Ranged', cost: 3, hp: 250, dmg: 58, hit: 1.1, speed: 1.6, range: 5.5, r: 0.5, shot: 11 },
  glitch: { name: 'Glitch', loves: 'tech', role: 'Splitter', cost: 4, hp: 560, dmg: 72, hit: 1.0, speed: 1.7, range: 0.9, r: 0.55, blink: 2.4, hop: 2.6, splits: 2 },
  bit: { name: 'Little Glitch', cost: 0, hp: 110, dmg: 34, hit: 0.8, speed: 2.3, range: 0.8, r: 0.32, mini: true },
  loud: { name: 'Loudspeaker', loves: 'music', role: 'Close-up blast', cost: 4, hp: 700, dmg: 66, hit: 1.2, speed: 1.15, range: 0.6, r: 0.6, aura: 2.3 },
  lifter: { name: 'Lifter', loves: 'fitness', role: 'Tank', cost: 5, hp: 1750, dmg: 95, hit: 1.5, speed: 1.1, range: 0.9, r: 0.75 },
  striker: { name: 'Striker', loves: 'sports', role: 'Tree chaser', cost: 4, hp: 860, dmg: 122, hit: 1.4, speed: 2.5, range: 1.0, r: 0.55, only: 'build' },
  masher: { name: 'Button Masher', loves: 'games', role: 'Fast fighter', cost: 2, hp: 300, dmg: 38, hit: 0.5, speed: 2.4, range: 0.8, r: 0.45 },
  lobber: { name: 'Popcorn Lobber', loves: 'movies', role: 'Ranged splash', cost: 4, hp: 320, dmg: 88, hit: 1.8, speed: 1.4, range: 5, r: 0.5, shot: 7, splash: 1.6 },
  pets: { name: 'Pet Pack', loves: 'pets', role: 'Swarm', cost: 3, brings: 'pet', count: 3 },
  pet: { name: 'Pet', cost: 0, hp: 150, dmg: 42, hit: 0.7, speed: 2.6, range: 0.75, r: 0.34, mini: true },
  chef: { name: 'Chef', loves: 'cooking', role: 'Support', cost: 3, hp: 330, dmg: 30, hit: 1.2, speed: 1.6, range: 4, r: 0.5, shot: 9, heal: 44 },
  gardener: { name: 'Gardener', loves: 'nature', role: 'Building', cost: 3, brings: 'sprout', count: 1 },
  sprout: { name: 'Sprout', cost: 0, hp: 760, dmg: 56, hit: 0.9, speed: 0, range: 5.5, r: 0.7, shot: 11, struct: true, lasts: 30 },
  islander: { name: 'Islander', loves: null, role: 'Fighter', cost: 2, hp: 400, dmg: 55, hit: 1.1, speed: 1.7, range: 0.85, r: 0.5 },
  squirrel: { name: 'Squirrel', loves: null, role: 'Pest', cost: 1, hp: 85, dmg: 18, hit: 0.8, speed: 3.4, range: 0.8, r: 0.35, only: 'build', steals: 1, quick: true },
  gloam: { name: 'Gloam', loves: null, role: 'Lighthouse beam', cost: 6, hp: 800, dmg: 115, hit: 2.6, speed: 1.0, range: 6.5, r: 0.65, beam: 0.85 },
};
// what a card can be (the rest are things cards bring along)
export const CARDS = ['bookworm', 'glitch', 'loud', 'lifter', 'striker', 'masher', 'lobber', 'pets', 'chef', 'gardener', 'islander', 'squirrel', 'gloam'];
// which interview category gives which power (lib/interests.js CATS); the second wave borrows the nearest one for now
export const POWER_FOR = {
  reading: 'bookworm', tech: 'glitch', music: 'loud', fitness: 'lifter', sports: 'striker', games: 'masher', movies: 'lobber', pets: 'pets',
  cooking: 'chef', food: 'chef', nature: 'gardener',
  art: 'lobber', photography: 'bookworm', anime: 'striker', fishing: 'gardener', dance: 'loud', fashion: 'chef', travel: 'masher', other: 'islander',
};
const TAGS = {   // for dealing fair stacks
  big: ['lifter', 'gloam', 'glitch', 'loud'], far: ['bookworm', 'lobber', 'gloam', 'gardener'], crowd: ['lobber', 'loud', 'gloam'], cheap: ['masher', 'islander', 'squirrel'],
};

/* ---------- dice: one number of state, the same on every phone ---------- */
export function roll(s) { s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0; return s.seed / 4294967296; }

/* ---------- dealing: 8 buds each, random but fair ---------- */
// pool: [{ id, kind }] (the island's buds and what each one's power is). Returns two stacks of 8 cards. Both stacks
// have something big, something that reaches far, something for crowds and something cheap, cost about the same,
// and neither holds the same power more than twice. The same bud may be dealt to both sides.
export function deal(pool, dice) {
  const ok = (d) => {
    const kinds = d.map((c) => c.kind), cost = kinds.reduce((a, k) => a + KINDS[k].cost, 0);
    if (cost < 25 || cost > 30) return false;
    for (const t of Object.values(TAGS)) if (!kinds.some((k) => t.includes(k))) return false;
    for (const k of kinds) if (kinds.filter((x) => x === k).length > 2) return false;
    return true;
  };
  const draw = () => {
    for (let tries = 0; tries < 400; tries++) {
      const left = pool.slice(), d = [];
      while (d.length < ROYAL.DECK && left.length) d.push(left.splice(Math.floor(roll(dice) * left.length), 1)[0]);
      if (d.length === ROYAL.DECK && ok(d)) return d;
    }
    return null;
  };
  for (let tries = 0; tries < 60; tries++) {
    const a = draw(), b = draw(); if (!a || !b) break;
    const cost = (d) => d.reduce((s, c) => s + KINDS[c.kind].cost, 0);
    if (Math.abs(cost(a) - cost(b)) <= 1) return [a, b];
  }
  return null;
}
// an island too small or too lopsided to deal from gets topped up with stand-ins, one of each power
export function fillPool(pool) {
  const out = pool.slice();
  for (const k of CARDS) for (let i = out.filter((c) => c.kind === k).length; i < (k === 'squirrel' || k === 'gloam' ? 1 : 2); i++) out.push({ id: k === 'squirrel' || k === 'gloam' ? k : `cpu_${k}_${i}`, kind: k });
  return out;
}

/* ---------- a battle ---------- */
const homeY = (side) => (side === 0 ? 3 : ROYAL.L - 3), treeY = (side) => (side === 0 ? 6.5 : ROYAL.L - 6.5);
export function newBattle(seed, decks) {
  const s = { seed: seed >>> 0 || 1, tick: 0, nextId: 1, over: false, winner: null, why: null, sudden: false, ents: [], shots: [], ev: [], sides: [] };
  for (const side of [0, 1]) {
    const d = decks[side].map((c) => ({ id: c.id, kind: c.kind }));
    s.sides.push({ glow: ROYAL.GLOW_START, part: 0, deck: d, hand: [0, 1, 2, 3], queue: [4, 5, 6, 7], awake: false, felled: 0, spent: 0 });
    for (const [lane, x] of ROYAL.BRIDGES.entries()) s.ents.push({ id: s.nextId++, side, kind: 'tree', lane, x, y: treeY(side), hp: ROYAL.TREE.hp, max: ROYAL.TREE.hp, cd: 0, tgt: 0, build: true });
    s.ents.push({ id: s.nextId++, side, kind: 'home', x: ROYAL.W / 2, y: homeY(side), hp: ROYAL.HOME.hp, max: ROYAL.HOME.hp, cd: 0, tgt: 0, build: true });
  }
  return s;
}
export const statOf = (e) => (e.kind === 'tree' ? ROYAL.TREE : e.kind === 'home' ? ROYAL.HOME : KINDS[e.kind]);
export const tree = (s, side, lane) => s.ents.find((e) => e.kind === 'tree' && e.side === side && e.lane === lane);
export const home = (s, side) => s.ents.find((e) => e.kind === 'home' && e.side === side);
export const timeLeft = (s) => Math.max(0, (s.sudden ? ROYAL.MATCH_S + ROYAL.OVER_S : ROYAL.MATCH_S) - s.tick / T);
export const doubled = (s) => s.sudden || s.tick / T >= ROYAL.MATCH_S - ROYAL.DOUBLE_S;

// May this side put a bud down here? Your own half; and past the river on a side whose tree you've felled.
export function canPlace(s, side, x, y) {
  if (!(x >= 0.5 && x <= ROYAL.W - 0.5)) return false;
  const yy = side === 0 ? y : ROYAL.L - y;   // seen from that side's own end
  if (!(yy >= 0.5)) return false;
  if (yy <= ROYAL.RIVER0 - 0.3) return true;
  const lane = x < ROYAL.W / 2 ? 0 : 1, t = tree(s, 1 - side, lane);
  return (!t || t.hp <= 0) && yy >= ROYAL.RIVER1 + 0.3 && yy <= ROYAL.DEEP;
}
// A placement: { side, slot (0 to 3, which card in hand), x, y }. Returns false (and changes nothing) if it isn't
// allowed: no such card, not enough Glow, not a place you may use.
export function place(s, c) {
  const S = s.sides[c.side]; if (s.over || !S || !(c.slot >= 0 && c.slot < ROYAL.HAND)) return false;
  const card = S.deck[S.hand[c.slot]], K = KINDS[card.kind];
  if (S.glow < K.cost || !canPlace(s, c.side, c.x, c.y)) return false;
  S.glow -= K.cost; S.spent += K.cost;
  S.queue.push(S.hand[c.slot]); S.hand[c.slot] = S.queue.shift();
  const kind = K.brings || card.kind, n = K.count || 1, f = c.side === 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const ox = n === 1 ? 0 : (i - 1) * 0.8, oy = n === 1 ? 0 : (i === 1 ? 0.5 : -0.3) * f;
    spawn(s, c.side, kind, c.x + ox, c.y + oy, card.id, ROYAL.ARRIVE_S);
  }
  s.ev.push({ k: 'place', side: c.side, kind: card.kind, bud: card.id, x: c.x, y: c.y });
  return true;
}
function spawn(s, side, kind, x, y, bud, wait) {
  const K = KINDS[kind], e = { id: s.nextId++, side, kind, bud, x: Math.min(ROYAL.W - 0.4, Math.max(0.4, x)), y, hp: K.hp, max: K.hp, cd: 0, tgt: 0, wait: Math.round(wait * T), bank: null, blink: K.blink ? Math.round(K.blink * T) : 0, hcd: 0, split: false, stole: false, age: 0 };
  s.ents.push(e); s.ev.push({ k: 'spawn', id: e.id, side, kind, bud, x: e.x, y: e.y }); return e;
}

const dist = (a, b) => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
// which bank a spot is on, from side 0's end: 0 near, 1 the river, 2 far
const bankOf = (y) => (y < ROYAL.RIVER0 ? 0 : y > ROYAL.RIVER1 ? 2 : 1);
const nearBridge = (x) => (Math.abs(x - ROYAL.BRIDGES[0]) <= Math.abs(x - ROYAL.BRIDGES[1]) ? ROYAL.BRIDGES[0] : ROYAL.BRIDGES[1]);

function hurt(s, e, dmg, by) {
  if (e.hp <= 0) return;
  e.hp -= dmg;
  const S = s.sides[e.side];
  if (e.kind === 'home' && !S.awake) { S.awake = true; s.ev.push({ k: 'wake', side: e.side, why: 'hit' }); }
  // a Glitch that's taken half its knocks comes apart into little ones
  const K = KINDS[e.kind];
  if (K && K.splits && !e.split && e.hp <= e.max / 2) {
    e.split = true;
    for (let i = 0; i < K.splits; i++) spawn(s, e.side, 'bit', e.x + (i ? 0.7 : -0.7), e.y, e.bud, 0.3);
    s.ev.push({ k: 'split', id: e.id, x: e.x, y: e.y });
  }
  if (e.hp > 0) return;
  e.hp = 0; s.ev.push({ k: 'down', id: e.id, kind: e.kind, side: e.side, x: e.x, y: e.y, by });
  if (e.kind === 'tree') {
    s.sides[1 - e.side].felled++;
    if (!S.awake) { S.awake = true; s.ev.push({ k: 'wake', side: e.side, why: 'tree' }); }
    if (s.sudden) end(s, 1 - e.side, 'sudden');
    else { const n = Math.min(ROYAL.TREE_GIFT, ROYAL.GLOW_MAX - S.glow); S.glow += n; s.ev.push({ k: 'gift', side: e.side, n, x: e.x, y: e.y }); }
  } else if (e.kind === 'home') end(s, 1 - e.side, 'home');
}
function end(s, winner, why) { if (s.over) return; s.over = true; s.winner = winner; s.why = why; s.ev.push({ k: 'over', winner, why }); }

// who a bud or building goes for: the nearest thing it may hit, within what it can see
function pick(s, e, K) {
  const see = e.build || K.struct ? K.range : Math.max(K.range, 5.5) + 0.5;
  let best = null, bd = 1e9;
  for (const o of s.ents) {
    if (o.side === e.side || o.hp <= 0 || o.wait > 0) continue;
    const isBuild = o.build || KINDS[o.kind].struct;
    if (K.only === 'build' && !isBuild) continue;
    if ((e.build || K.struct) && isBuild) continue;                       // trees, homes and sprouts only go for buds
    const d = dist(e, o) - statOf(o).r;
    if (d > see && !(isBuild && !e.build && !K.struct)) continue;         // buds always know where the buildings are
    // a building is only chosen when no bud is close enough to see
    const score = d + (isBuild && K.only !== 'build' ? 100 : 0);
    if (score < bd || (score === bd && o.id < best.id)) { bd = score; best = o; }
  }
  // buildings behind the lane's tree wait their turn: go for the tree in your lane first, then the home
  if (best && best.kind === 'home' && !e.build) {
    const lane = e.x < ROYAL.W / 2 ? 0 : 1, t = tree(s, best.side, lane);
    if (t && t.hp > 0) best = t;
  }
  return best;
}
// one step towards a spot, going round by a bridge if the river's in the way
function walk(e, tx, ty, step) {
  const b = bankOf(e.y), tb = bankOf(ty);
  let gx = tx, gy = ty;
  if (b !== 1 && tb !== b) {
    const bx = nearBridge(e.x), edge = b === 0 ? ROYAL.RIVER0 : ROYAL.RIVER1;
    if (Math.abs(e.x - bx) > 0.5 && Math.abs(e.y - edge) > 0.3) { gx = bx; gy = edge + (b === 0 ? -0.2 : 0.2); }
    else { gx = bx; gy = b === 0 ? ROYAL.RIVER1 + 0.3 : ROYAL.RIVER0 - 0.3; }
  } else if (b === 1) { gx = nearBridge(e.x); gy = ty > e.y ? ROYAL.RIVER1 + 0.3 : ROYAL.RIVER0 - 0.3; if (tb === 1) { gy = ty; } }
  const dx = gx - e.x, dy = gy - e.y, d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) return;
  const k = Math.min(1, step / d); e.x += dx * k; e.y += dy * k;
}
// nobody stands in the river: you're on a bank or on a bridge
function keepDry(e) {
  if (e.y <= ROYAL.RIVER0 || e.y >= ROYAL.RIVER1) { e.bank = e.y <= ROYAL.RIVER0 ? 0 : 2; return; }
  const bx = nearBridge(e.x);
  if (Math.abs(e.x - bx) <= ROYAL.BRIDGE_HALF) return;
  if (Math.abs(e.x - bx) <= ROYAL.BRIDGE_HALF + 0.6) { e.x = bx + (e.x > bx ? ROYAL.BRIDGE_HALF : -ROYAL.BRIDGE_HALF); return; }
  e.y = (e.bank === 2 || (e.bank == null && e.y > (ROYAL.RIVER0 + ROYAL.RIVER1) / 2)) ? ROYAL.RIVER1 : ROYAL.RIVER0;
}

// One tick. cmds: the placements that land on this tick, in a fixed order (side 0's first).
export function step(s, cmds) {
  if (s.over) return;
  if (cmds) for (const c of cmds.slice().sort((a, b) => a.side - b.side || a.slot - b.slot)) place(s, c);
  s.tick++;
  // Glow trickles in
  const per = Math.round(ROYAL.GLOW_S * T / (doubled(s) ? 2 : 1));
  for (const S of s.sides) if (S.glow < ROYAL.GLOW_MAX && ++S.part >= per) { S.part = 0; S.glow++; }
  const byId = new Map(); for (const e of s.ents) byId.set(e.id, e);
  // things already in the air come down
  if (s.shots.length) {
    const keep = [];
    for (const sh of s.shots) {
      if (sh.at > s.tick) { keep.push(sh); continue; }
      if (sh.splash) { s.ev.push({ k: 'pop', x: sh.x, y: sh.y, r: sh.splash, side: sh.side }); for (const o of s.ents) if (o.side !== sh.side && o.hp > 0 && !(o.wait > 0) && Math.sqrt((o.x - sh.x) * (o.x - sh.x) + (o.y - sh.y) * (o.y - sh.y)) <= sh.splash + statOf(o).r) hurt(s, o, o.build ? Math.round(sh.dmg * 0.6) : sh.dmg, sh.from); }
      else { const o = byId.get(sh.to); if (o && o.hp > 0) hurt(s, o, sh.dmg, sh.from); }
    }
    s.shots = keep;
  }
  for (const e of s.ents) {
    if (e.hp <= 0 || s.over) continue;
    if (e.wait > 0) { e.wait--; continue; }
    const K = statOf(e), S = s.sides[e.side];
    if (e.kind === 'home' && !S.awake) continue;
    e.age++;
    if (K.lasts) { e.hp -= K.hp / (K.lasts * T); if (e.hp <= 0) { e.hp = 0; s.ev.push({ k: 'down', id: e.id, kind: e.kind, side: e.side, x: e.x, y: e.y, by: 0 }); continue; } }
    if (e.cd > 0) e.cd--;
    let t = e.tgt ? byId.get(e.tgt) : null;
    if (!t || t.hp <= 0 || e.age % 5 === 0) { t = pick(s, e, K); e.tgt = t ? t.id : 0; }
    // a chef looks after its friends first
    if (K.heal && (e.hcd = Math.max(0, (e.hcd || 0) - 1)) <= 0) {
      let pal = null, most = 0;
      for (const o of s.ents) { if (o.side !== e.side || o === e || o.hp <= 0 || o.build || KINDS[o.kind].struct || o.wait > 0) continue; const lost = o.max - o.hp; if (lost > most && dist(e, o) <= K.range) { most = lost; pal = o; } }
      if (pal && most >= 30) { pal.hp = Math.min(pal.max, pal.hp + K.heal); e.hcd = Math.round(K.hit * T); e.cd = Math.max(e.cd, Math.round(K.hit * T * 0.5)); s.ev.push({ k: 'heal', id: e.id, to: pal.id }); }
    }
    if (!t) continue;
    const d = dist(e, t) - statOf(t).r, reach = K.aura ? K.aura * 0.75 : K.range;
    if (d > reach) {
      if (K.speed > 0) {
        // a Glitch flickers forward now and then
        if (K.blink && --e.blink <= 0) { e.blink = Math.round(K.blink * T); if (d > K.hop + 1 && bankOf(e.y) !== 1) { const x0 = e.x, y0 = e.y; walk(e, t.x, t.y, K.hop); keepDry(e); s.ev.push({ k: 'blink', id: e.id, x0, y0, x: e.x, y: e.y }); continue; } }
        walk(e, t.x, t.y, K.speed / T); keepDry(e);
      }
      if (!K.aura) { if (!K.quick && e.cd < Math.round(K.hit * T * 0.35)) e.cd = Math.round(K.hit * T * 0.35); continue; }   // a breath before the first swing
    }
    if (e.cd > 0) continue;
    if (K.aura) {
      // the loudspeaker: everything close gets it, nothing further off does
      let any = false;
      for (const o of s.ents) if (o.side !== e.side && o.hp > 0 && !(o.wait > 0) && dist(e, o) - statOf(o).r <= K.aura) { any = true; hurt(s, o, o.build ? Math.round(K.dmg * 0.7) : K.dmg, e.id); }
      if (any) { e.cd = Math.round(K.hit * T); s.ev.push({ k: 'boom', id: e.id, x: e.x, y: e.y, r: K.aura }); }
      continue;
    }
    e.cd = Math.round(K.hit * T);
    if (K.beam) {
      // Gloam's lantern: a beam out to as far as it reaches, through everything in the way
      const dx = t.x - e.x, dy = t.y - e.y, len = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / len, uy = dy / len, far = K.range + 1.5;
      for (const o of s.ents) {
        if (o.side === e.side || o.hp <= 0 || o.wait > 0) continue;
        const px = o.x - e.x, py = o.y - e.y, along = px * ux + py * uy; if (along < 0 || along > far + statOf(o).r) continue;
        const off = Math.abs(px * uy - py * ux); if (off <= K.beam + statOf(o).r * 0.6) hurt(s, o, o.build ? Math.round(K.dmg * 0.55) : K.dmg, e.id);
      }
      s.ev.push({ k: 'beam', id: e.id, x: e.x, y: e.y, x1: e.x + ux * far, y1: e.y + uy * far });
    } else if (K.shot) {
      const fly = Math.max(1, Math.round((d + statOf(t).r) / K.shot * T));
      s.shots.push(K.splash ? { at: s.tick + fly, x: t.x, y: t.y, dmg: K.dmg, splash: K.splash, side: e.side, from: e.id } : { at: s.tick + fly, to: t.id, dmg: K.dmg, side: e.side, from: e.id });
      s.ev.push({ k: 'throw', id: e.id, kind: e.kind, to: t.id, x: t.x, y: t.y, fly });
    } else {
      s.ev.push({ k: 'hit', id: e.id, kind: e.kind, to: t.id });
      hurt(s, t, t.build && K.mini ? Math.round(K.dmg * 0.8) : K.dmg, e.id);
      // the squirrel's first nibble at a tree pinches some of the other side's Glow
      if (K.steals && !e.stole && t.build) { e.stole = true; const O = s.sides[1 - e.side], n = Math.min(K.steals, O.glow); O.glow -= n; S.glow = Math.min(ROYAL.GLOW_MAX, S.glow + n); s.ev.push({ k: 'steal', id: e.id, side: e.side, n }); }
    }
  }
  // buds don't stand on top of each other, or inside trees and homes
  const live = s.ents.filter((e) => e.hp > 0 && !(e.wait > 0));
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j], A = statOf(a), B = statOf(b), fa = a.build || A.struct, fb = b.build || B.struct;
    if (fa && fb) continue;
    let dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy); const need = (A.r + B.r) * (a.side === b.side ? 0.8 : 1);
    if (d >= need) continue;
    if (d < 1e-4) { dx = a.id < b.id ? 0.01 : -0.01; dy = 0.01; d = Math.sqrt(dx * dx + dy * dy); }
    const push = (need - d) * 0.5, nx = dx / d, ny = dy / d, wa = fa ? 0 : fb ? 2 : B.r / (A.r + B.r) * 2, wb = fb ? 0 : fa ? 2 : A.r / (A.r + B.r) * 2;
    a.x -= nx * push * wa; a.y -= ny * push * wa; b.x += nx * push * wb; b.y += ny * push * wb;
  }
  for (const e of live) if (!e.build && !statOf(e).struct) { e.x = Math.min(ROYAL.W - 0.4, Math.max(0.4, e.x)); e.y = Math.min(ROYAL.L - 0.4, Math.max(0.4, e.y)); keepDry(e); }
  if (s.ents.length > 24) s.ents = s.ents.filter((e) => e.hp > 0 || e.build);
  // the clock
  if (!s.over && s.tick === ROYAL.MATCH_S * T) {
    const a = s.sides[0].felled, b = s.sides[1].felled;
    if (a !== b) end(s, a > b ? 0 : 1, 'trees'); else { s.sudden = true; s.ev.push({ k: 'sudden' }); }
  }
  if (!s.over && s.tick >= (ROYAL.MATCH_S + ROYAL.OVER_S) * T) {
    // still level: whoever's weakest tree or home is in better shape
    const worst = (side) => Math.min(...s.ents.filter((e) => e.build && e.side === side && e.hp > 0).map((e) => e.hp / e.max));
    const a = worst(0), b = worst(1);
    end(s, a === b ? null : a > b ? 0 : 1, 'health');
  }
}
// a fingerprint of the whole battle, for two phones to compare now and then
export function fingerprint(s) {
  let h = s.seed ^ s.tick;
  for (const e of s.ents) h = (Math.imul(h, 31) + e.id * 7 + Math.floor(e.x * 1000) + Math.floor(e.y * 1000) * 3 + Math.floor(e.hp * 10)) >>> 0;
  for (const S of s.sides) h = (Math.imul(h, 31) + S.glow * 13 + S.part + S.hand.join('').length + S.hand[0] * 5 + S.hand[3]) >>> 0;
  return h;
}

/* ---------- an island bud playing a side (and the players in the practice matches) ---------- */
// Simple and readable on purpose: it defends the lane that's in trouble with something that suits the trouble,
// saves up, then pushes the lane where the other side is weakest with something big in front and help behind.
// `me` holds its own dice and mood so it doesn't touch the battle's dice.
export function botMove(s, side, me) {
  me.wait = (me.wait || 0) - 1; if (me.wait > 0 || s.over) return null;
  // It looks things over every couple of seconds and sometimes lets a moment pass (practice matches showed a
  // player that reacts to everything at once wastes its Glow). An easy-going one (me.think 3, me.idle 0.55) is
  // slower still, and loses about three matches in four to this one.
  me.wait = Math.round((me.think ?? 1.8) * T);
  const rnd = () => { me.seed = (Math.imul(me.seed || 7, 1103515245) + 12345) >>> 0; return me.seed / 4294967296; };
  const S = s.sides[side], f = side === 0 ? 1 : -1, own = (y) => (side === 0 ? y : ROYAL.L - y), toY = (yy) => (side === 0 ? yy : ROYAL.L - yy);
  if (rnd() < (me.idle ?? 0.4)) return null;
  const hand = S.hand.map((i, slot) => ({ slot, kind: S.deck[i].kind, K: KINDS[S.deck[i].kind] })).filter((c) => c.K.cost <= S.glow);
  if (!hand.length) return null;
  const foes = s.ents.filter((e) => e.side !== side && e.hp > 0 && !e.build && !KINDS[e.kind].struct), mine = s.ents.filter((e) => e.side === side && e.hp > 0 && !e.build);
  // trouble: the other side's buds on my half, by lane
  const threat = [0, 0], where = [null, null];
  for (const e of foes) { const yy = own(e.y); if (yy > ROYAL.RIVER1 + 2) continue; const lane = e.x < ROYAL.W / 2 ? 0 : 1; threat[lane] += KINDS[e.kind].cost || 1; if (!where[lane] || own(e.y) < own(where[lane].y)) where[lane] = e; }
  const lane = threat[0] >= threat[1] ? 0 : 1, defended = mine.filter((e) => (e.x < ROYAL.W / 2 ? 0 : 1) === lane && own(e.y) < ROYAL.RIVER0).reduce((a, e) => a + (KINDS[e.kind].cost || 1), 0);
  const choose = (score) => { let best = null, bs = -1e9; for (const c of hand) { const v = score(c) + rnd() * (1.5 - (me.skill ?? 1)); if (v > bs) { bs = v; best = c; } } return best; };
  const myTree = tree(s, side, lane), sturdy = myTree && myTree.hp > myTree.max * 0.5;
  if (threat[lane] > defended + (sturdy ? 2.5 : 0.5) && where[lane]) {
    const foe = where[lane], crowd = foes.filter((e) => Math.abs(e.x - foe.x) < 3 && Math.abs(e.y - foe.y) < 3).length, big = KINDS[foe.kind].hp >= 600, chaser = KINDS[foe.kind].only === 'build';
    const c = choose((c) => {
      const k = c.kind; let v = 0;
      if (crowd >= 3 && (k === 'lobber' || k === 'loud' || k === 'gloam')) v += 4;
      if (big && (k === 'masher' || k === 'pets' || k === 'glitch' || k === 'gloam')) v += 3;
      if (chaser && (k === 'gardener' || k === 'masher' || k === 'pets' || k === 'islander')) v += 3;
      if (k === 'striker' || k === 'squirrel') v -= 5;
      if (k === 'chef') v -= 2;
      return v - Math.abs(c.K.cost - threat[lane]) * 0.6;
    });
    if (!c || (c.kind === 'striker' || c.kind === 'squirrel')) return null;
    const lx = ROYAL.BRIDGES[lane], yy = Math.min(ROYAL.RIVER0 - 1, Math.max(4, own(foe.y) - (c.K.range > 2 || c.kind === 'gardener' ? 4.5 : 1.5)));
    return { side, slot: c.slot, x: lx + (rnd() - 0.5) * 2 + (c.K.range > 2 ? (lane ? -1.5 : 1.5) : 0), y: toY(yy) };
  }
  // nothing pressing: save up, then push
  const want = Math.min(10, (doubled(s) ? 6 : 7) + (me.patience ?? 0));
  const pushing = mine.filter((e) => KINDS[e.kind].speed > 0 && own(e.y) > 8);
  if (S.glow < want && !pushing.length) return null;
  if (S.glow < 4 && pushing.length) { const c = choose((c) => (c.K.cost <= 2 ? 2 : -3)); if (!c || c.K.cost > 2) return null; }
  // which lane: behind a push already going, else where their tree is weakest
  let L = pushing.length ? (pushing[0].x < ROYAL.W / 2 ? 0 : 1) : null;
  if (L == null) { const t0 = tree(s, 1 - side, 0), t1 = tree(s, 1 - side, 1), h0 = t0 && t0.hp > 0 ? t0.hp : 0, h1 = t1 && t1.hp > 0 ? t1.hp : 0; L = h0 === h1 ? (rnd() < 0.5 ? 0 : 1) : (h0 > 0 && (h0 < h1 || h1 === 0)) ? 0 : 1; }
  const front = pushing.filter((e) => (e.x < ROYAL.W / 2 ? 0 : 1) === L).sort((a, b) => own(b.y) - own(a.y))[0];
  const hasBig = pushing.some((e) => KINDS[e.kind].hp >= 550);
  const c = choose((c) => {
    const k = c.kind; let v = 0;
    if (!hasBig && (k === 'lifter' || k === 'glitch' || k === 'loud' || k === 'gloam')) v += 3;
    if (hasBig && (k === 'bookworm' || k === 'lobber' || k === 'chef' || k === 'pets' || k === 'masher')) v += 3;
    if (hasBig && (k === 'striker' || k === 'squirrel')) v += 2;
    if (k === 'chef' && !pushing.length) v -= 4;
    if (k === 'gardener') v -= 1;
    return v;
  });
  if (!c) return null;
  const lx = ROYAL.BRIDGES[L]; let yy;
  if (c.kind === 'gardener') yy = ROYAL.RIVER0 - 2.5;
  else if (front) yy = Math.min(ROYAL.RIVER0 - 0.8, Math.max(2, own(front.y) - (c.K.range > 2 ? 2.5 : 1)));
  else yy = c.K.speed < 1.3 ? 2 + rnd() * 3 : c.K.only === 'build' ? ROYAL.RIVER0 - 0.8 : 8 + rnd() * 4;
  return { side, slot: c.slot, x: lx + (rnd() - 0.5) * 1.6, y: toY(yy) };
}
