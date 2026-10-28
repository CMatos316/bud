// Island Race: a board game for everyone on a call (played in bud's Discord Activity, like Prankster).
// Buds hop round the island one die roll at a time. Tiles hand out acorns and items, launch you ahead, slide
// you back, swap you with a rival or put you to sleep; passing a rival bumps an acorn off them. First bud past
// the campfire wins a race medal.
//
// Live: whoever's turn it is rolls, and everyone's screen plays the same hops (each turn is a list of steps
// the page animates). No timers: if someone leaves the call mid-race, their bud rolls for itself once it's
// their turn and they haven't been seen for a little while.
// Rooms: guilds/{guild}/races/{room}. In Discord the room is the activity's instance, so the whole call lands
// in the same race. The server does all the dice rolling.
import { db, refs, Timestamp } from './firebase.js';
import { GUILD_ID } from './discord.js';
import { TILES, DIST, FORK, launchTarget } from './raceBoard.js';

export const MIN_PLAYERS = 2, MAX_PLAYERS = 6, MAX_ITEMS = 2;
const AWAY_MS = 25000, SEEN_EVERY_MS = 6000, AWAY_GRACE_MS = 6000;
export const rooms = () => db().collection('guilds').doc(GUILD_ID).collection('races');
const err = (message, status) => Object.assign(new Error(message), { status });
export const ITEMS = {
  double: { name: 'Double Dice', icon: '🎲' },
  golden: { name: 'Golden Die', icon: '✨' },
  banana: { name: 'Banana Peel', icon: '🍌' },
  coffee: { name: 'Coffee', icon: '☕' },
};
const isHere = (p, now) => now - (p?.lastSeen || 0) < AWAY_MS;
const d6 = () => 1 + Math.floor(Math.random() * 6);

/* ---------- views ---------- */
// What one player sees: everything, except which items the others are holding (just how many).
function viewFor(g, me, now, full = false) {
  const players = Object.entries(g.players || {}).map(([id, p]) => ({ id, name: p.name, here: isHere(p, now), joinedAt: p.joinedAt }))
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const racers = g.racers || [];
  const hide = (steps) => (steps || []).map((s) => (s.k === 'item' && s.who !== me ? { ...s, item: null } : s));
  const v = {
    id: g.id, me, host: g.host, phase: g.phase || 'lobby', game: g.game || 0, now, players,
    racers, pos: g.pos || {}, acorns: g.acorns || {}, asleep: g.asleep || {}, traps: g.traps || {},
    itemCount: Object.fromEntries(racers.map((r) => [r, (g.items?.[r] || []).length])), myItems: g.items?.[me] || [],
    turn: g.turn || null, turnN: g.turnN || 0, round: g.round || 1,
    last: g.last ? { ...g.last, steps: hide(g.last.steps) } : null,
    log: (g.log || []).slice(-6), winner: g.winner || null, ranks: g.ranks || null,
  };
  if (full) v.board = TILES;
  return v;
}

/* ---------- joining, checking in ---------- */
async function touch(id, me, name, create, full) {
  const ref = rooms().doc(id), now = Date.now();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let g = snap.exists ? snap.data() : null;
    if (!g) {
      if (!create) throw err('that race isn’t around anymore', 404);
      g = { id, host: me, phase: 'lobby', players: {}, game: 0, createdAt: Timestamp.now() };
    }
    let changed = !snap.exists;
    if (!g.players[me]) {
      if (Object.keys(g.players).length >= 12) throw err('this race is full', 409);
      g.players[me] = { name, joinedAt: now, lastSeen: now }; changed = true;
    } else if (now - (g.players[me].lastSeen || 0) > SEEN_EVERY_MS) { g.players[me].lastSeen = now; changed = true; }
    // the host left? whoever's still here takes over the Start button
    if (g.phase !== 'play' && !isHere(g.players[g.host], now) && g.host !== me) { g.host = me; changed = true; }
    // someone left the call on their turn: their bud rolls for itself
    if (g.phase === 'play' && g.turn && g.turn !== me && !isHere(g.players[g.turn], now) && now - (g.turnAt || 0) > AWAY_GRACE_MS) {
      takeTurn(g, g.turn, {}, true); changed = true;
    }
    if (changed) tx.set(ref, g);
    return viewFor(g, me, now, full);
  });
}
export const newRoomId = () => rooms().doc().id.slice(0, 12);
export const joinRoom = (id, me, name) => touch(id, me, name, true, true);
export const checkIn = (id, me, name, full) => touch(id, me, name, false, full);

// Start (or race again): everyone who's here lines up at the campfire. A roll-off sets the order.
export async function startRace(id, me) {
  const ref = rooms().doc(id), now = Date.now();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || !snap.get(`players.${me}`)) throw err('join the race first', 404);
    const g = snap.data();
    if (g.phase === 'play') return viewFor(g, me, now);
    const here = Object.entries(g.players).filter(([, p]) => isHere(p, now)).map(([pid]) => pid).slice(0, MAX_PLAYERS);
    if (here.length < MIN_PLAYERS) throw err(`you need at least ${MIN_PLAYERS} racers`, 409);
    // roll-off: highest goes first (ties keep joining order)
    const rolls = Object.fromEntries(here.map((pid) => [pid, d6()]));
    const racers = [...here].sort((a, b) => rolls[b] - rolls[a]);
    Object.assign(g, {
      phase: 'play', game: (g.game || 0) + 1, racers, rolls,
      pos: Object.fromEntries(racers.map((r) => [r, 0])), acorns: Object.fromEntries(racers.map((r) => [r, 0])),
      items: Object.fromEntries(racers.map((r) => [r, []])), asleep: {}, traps: {}, trail: Object.fromEntries(racers.map((r) => [r, [0]])),
      turn: racers[0], turnAt: now, turnN: 0, round: 1, last: { n: 0, by: null, steps: [{ k: 'order', rolls, order: racers }] },
      log: [`${g.players[racers[0]].name} rolled highest and goes first!`], winner: null, ranks: null, startedAt: now,
    });
    tx.set(ref, g);
    return viewFor(g, me, now, true);
  });
}

/* ---------- a turn ---------- */
// opts: { item: 'double' | 'golden' | 'banana' | 'coffee', golden: 1..6, fork: 0 | 1 }
export async function roll(id, me, opts) {
  const ref = rooms().doc(id), now = Date.now();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || !snap.get(`players.${me}`)) throw err('join the race first', 404);
    const g = snap.data();
    if (g.phase !== 'play') throw err('the race hasn’t started', 409);
    if (g.turn !== me) throw err('it’s not your turn', 409);
    g.players[me].lastSeen = now;
    takeTurn(g, me, opts || {}, false);
    tx.set(ref, g);
    return viewFor(g, me, now);
  });
}

const nameOf = (g, id) => g.players[id]?.name || 'someone';
function rank(g) {
  return [...g.racers].sort((a, b) => (DIST[g.pos[b]] ?? 0) === (DIST[g.pos[a]] ?? 0) ? (g.acorns[b] || 0) - (g.acorns[a] || 0) : DIST[g.pos[a]] - DIST[g.pos[b]]);
}
// Item boxes go easier on whoever's ahead: the leader mostly gets coffee and peels, the back of the pack golden dice.
function drawItem(g, who) {
  const order = rank(g), place = order.indexOf(who) / Math.max(1, order.length - 1);   // 0 = leading, 1 = last
  const table = place < 0.34 ? ['coffee', 'coffee', 'banana', 'banana', 'double'] : place < 0.67 ? ['coffee', 'banana', 'double', 'double', 'golden'] : ['double', 'golden', 'golden', 'banana', 'double'];
  return table[Math.floor(Math.random() * table.length)];
}
const others = (g, me) => g.racers.filter((r) => r !== me);

// Resolve one turn (mutates g): optional item, the roll, the hops, what the tile does, then the next player.
// auto: the bud rolls for its player (they left the call): no items, the long way at the fork.
function takeTurn(g, me, opts, auto) {
  const steps = [], log = [], name = nameOf(g, me), items = [...(g.items[me] || [])];
  const use = !auto && opts.item && items.includes(opts.item) ? opts.item : null;
  if (use) { items.splice(items.indexOf(use), 1); steps.push({ k: 'use', who: me, item: use }); }
  if (auto) steps.push({ k: 'auto', who: me });
  let dice;
  if (use === 'golden') dice = [Math.max(1, Math.min(6, Math.round(Number(opts.golden) || 6)))];
  else if (use === 'double') dice = [d6(), d6()];
  else dice = [d6()];
  let move = dice.reduce((a, b) => a + b, 0) + (use === 'coffee' ? 1 : 0);
  steps.push({ k: 'roll', who: me, dice, total: move });
  if (use === 'banana') {
    // dropped on the tile you're standing on, for whoever lands there next
    g.traps = { ...g.traps, [g.pos[me]]: me };
    steps.push({ k: 'trap', who: me, at: g.pos[me] });
    log.push(`${name} dropped a banana peel 🍌`);
  }
  g.items[me] = items;

  // hop, tile by tile
  let at = g.pos[me], finished = false;
  const trail = [...(g.trail?.[me] || [at])];
  for (let i = 0; i < move; i++) {
    const t = TILES[at];
    if (!t.next.length) { finished = true; break; }
    at = t.next.length > 1 ? t.next[auto ? 0 : (opts.fork === 1 ? 1 : 0)] : t.next[0];
    trail.push(at);
    steps.push({ k: 'hop', who: me, to: at, fork: t.id === FORK ? (at === t.next[1] ? 'woods' : 'beach') : undefined });
    // passing someone (not where you stop) bumps an acorn off them
    if (i < move - 1) for (const o of others(g, me)) {
      if (g.pos[o] === at && g.acorns[o] > 0) { g.acorns[o]--; g.acorns[me]++; steps.push({ k: 'bump', who: me, from: o }); log.push(`${name} bumped ${nameOf(g, o)} and grabbed an acorn!`); }
    }
  }
  g.pos[me] = at;
  // stepping past the last tile (or landing on it) gets you home
  if (finished || !TILES[at].next.length) {
    finish(g, me, steps, log);
  } else {
    landOn(g, me, at, steps, log, trail);
    g.trail = { ...g.trail, [me]: trail.slice(-12) };
  }
  if (g.phase === 'play') nextTurn(g, steps, log);
  g.turnN = (g.turnN || 0) + 1;
  g.last = { n: g.turnN, by: me, auto: !!auto, steps };
  g.log = [...(g.log || []), ...log].slice(-12);
}

function slideBack(g, me, n, trail) {
  const back = trail.slice(0, -1).reverse(), to = back[Math.min(n, back.length) - 1] ?? g.pos[me];
  trail.splice(Math.max(1, trail.length - n));   // forget the tiles slid back over
  if (trail[trail.length - 1] !== to) trail.push(to);
  return to;
}

function landOn(g, me, at, steps, log, trail) {
  const name = nameOf(g, me), t = TILES[at];
  // a banana peel left here?
  if (g.traps?.[at] != null) {
    const owner = g.traps[at], traps = { ...g.traps }; delete traps[at]; g.traps = traps;
    const to = slideBack(g, me, 3, trail);
    g.pos[me] = to; steps.push({ k: 'slip', who: me, to, owner });
    log.push(owner === me ? `${name} slipped on their own banana peel 😅` : `${name} slipped on ${nameOf(g, owner)}’s banana peel!`);
    return;
  }
  if (t.type === 'plain' || t.type === 'start' || t.type === 'fork') {
    g.acorns[me] = (g.acorns[me] || 0) + 1; steps.push({ k: 'acorn', who: me, n: 1 });
  } else if (t.type === 'item') {
    if ((g.items[me] || []).length < MAX_ITEMS) {
      const item = drawItem(g, me); g.items[me] = [...g.items[me], item];
      steps.push({ k: 'item', who: me, item }); log.push(`${name} found an item!`);
    } else { g.acorns[me] = (g.acorns[me] || 0) + 1; steps.push({ k: 'acorn', who: me, n: 1, full: true }); }
  } else if (t.type === 'launch') {
    const to = launchTarget(at);
    g.pos[me] = to; trail.push(to); steps.push({ k: 'launch', who: me, to });
    log.push(`${name} launched ahead! 🚀`);
    g.acorns[me] = (g.acorns[me] || 0) + 1; steps.push({ k: 'acorn', who: me, n: 1 });
  } else if (t.type === 'slide') {
    const to = slideBack(g, me, 3, trail);
    g.pos[me] = to; steps.push({ k: 'slide', who: me, to });
    log.push(`${name} slid back in the mud`);
  } else if (t.type === 'swap') {
    const pool = others(g, me);
    if (pool.length) {
      const o = pool[Math.floor(Math.random() * pool.length)], mine = g.pos[me];
      g.pos[me] = g.pos[o]; g.pos[o] = mine;
      g.trail = { ...g.trail, [o]: [mine] }; trail.splice(0, trail.length, g.pos[me]);   // slides only go back along your own path
      steps.push({ k: 'swap', who: me, with: o, a: g.pos[me], b: g.pos[o] });
      log.push(`${name} swapped places with ${nameOf(g, o)}! 🔄`);
    }
  } else if (t.type === 'nap') {
    g.asleep = { ...g.asleep, [me]: true }; steps.push({ k: 'nap', who: me });
    log.push(`${name} dozed off in the woods 💤`);
  }
}

function finish(g, me, steps, log) {
  steps.push({ k: 'finish', who: me });
  const order = [me, ...rank(g).filter((r) => r !== me)];
  g.phase = 'done'; g.winner = me; g.ranks = order; g.turn = null; g.finishedAt = Date.now();
  log.push(`${nameOf(g, me)} made it back to the campfire first! 🏁`);
  prize(me).catch((e) => console.error('race medal failed:', e));
}
async function prize(winner) {
  await refs.user(winner).set({ wardrobe: { items: { medal: { from: 'island race', at: Date.now() } } } }, { merge: true });
}

// Pass the die on. A napping bud skips its turn (Coffee wakes it up instead).
function nextTurn(g, steps, log) {
  let i = g.racers.indexOf(g.turn);
  for (let tries = 0; tries < g.racers.length * 2; tries++) {
    i = (i + 1) % g.racers.length;
    if (i === 0) g.round = (g.round || 1) + 1;
    const r = g.racers[i];
    if (g.asleep?.[r]) {
      const asleep = { ...g.asleep }; delete asleep[r]; g.asleep = asleep;
      const items = g.items[r] || [];
      if (items.includes('coffee')) {
        g.items[r] = items.filter((x, k) => k !== items.indexOf('coffee'));
        steps.push({ k: 'wake', who: r }); log.push(`${nameOf(g, r)} drank a coffee and woke right up ☕`);
      } else { steps.push({ k: 'skip', who: r }); log.push(`${nameOf(g, r)} is napping and misses a turn`); continue; }
    }
    g.turn = r; g.turnAt = Date.now();
    return;
  }
}
