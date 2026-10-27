// Picnic Clash: two friends take turns setting dishes on a picnic blanket, played over time like Peekaboo.
// Each turn you're offered 3 dishes from the basket (a sandwich, a pie, a slice of pizza...) and set one down
// anywhere it fits. Fence in one of your friend's dishes (every square around it is yours, and the blanket's
// edge counts as a wall) and your bud snags it. After 8 turns each, whoever has more of the blanket wins a
// picnic basket. (Dishes can go anywhere on purpose: if they had to touch your side, nothing could ever be
// fenced in, since every dish would always have one of its owner's squares next to it.)
// Games: guilds/{guild}/picnics/{id}. Nothing is secret here, but only the player whose turn it is gets
// their dishes, and every move is checked on the server.
import { db, refs, Timestamp } from './firebase.js';
import { GUILD_ID, SITE_URL, sendDm, linkButton, row } from './discord.js';

// No bonus for going second: moving last is already worth about that (tested with simulated games).
export const N = 8, TURNS = 8, BONUS = 0;
const DM_GAP_MS = 20 * 60e3;
export const picnics = () => db().collection('guilds').doc(GUILD_ID).collection('picnics');
const err = (message, status) => Object.assign(new Error(message), { status });
const other = (g, me) => g.players.find((p) => p !== me);
const plain = (s) => String(s ?? '').replace(/([\\*_~`|>#\[\]()<@:-])/g, '\\$1');

// the dishes: [x, y] squares, and how often each one turns up in the basket
export const DISHES = {
  strawberry: { name: 'strawberry', cells: [[0, 0]], weight: 2 },
  sandwich: { name: 'sandwich', cells: [[0, 0], [1, 0]], weight: 3 },
  hotdog: { name: 'hot dog', cells: [[0, 0], [1, 0], [2, 0]], weight: 3 },
  cheese: { name: 'cheese wedge', cells: [[0, 0], [1, 0], [0, 1]], weight: 3 },
  baguette: { name: 'baguette', cells: [[0, 0], [1, 0], [2, 0], [3, 0]], weight: 2 },
  pie: { name: 'pie', cells: [[0, 0], [1, 0], [0, 1], [1, 1]], weight: 2 },
  pizza: { name: 'slice of pizza', cells: [[0, 0], [0, 1], [0, 2], [1, 2]], weight: 2 },
  watermelon: { name: 'watermelon slice', cells: [[0, 0], [1, 0], [2, 0], [1, 1]], weight: 2 },
  pretzel: { name: 'pretzel', cells: [[1, 0], [2, 0], [0, 1], [1, 1]], weight: 2 },
  cake: { name: 'layer cake', cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]], weight: 1 },
};
const DISH_IDS = Object.keys(DISHES);

function mulberry(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
// three different dishes for turn n (the same three if you reload)
export function offersFor(seed, n) {
  const r = mulberry(`${seed}:${n}`), left = [...DISH_IDS], out = [];
  while (out.length < 3) {
    const total = left.reduce((s, id) => s + DISHES[id].weight, 0);
    let x = r() * total, i = 0;
    while (x >= DISHES[left[i]].weight) { x -= DISHES[left[i]].weight; i++; }
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

// every way a dish can be turned or flipped, each as squares moved to start at 0,0 (as "x,y" strings, sorted)
const shapeKey = (cells) => cells.map(([x, y]) => `${x},${y}`).sort().join(' ');
function normalize(cells) {
  const mx = Math.min(...cells.map((c) => c[0])), my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my]);
}
export function orientations(id) {
  const out = new Map();
  let cells = DISHES[id].cells;
  for (let f = 0; f < 2; f++) {
    for (let r = 0; r < 4; r++) {
      const n = normalize(cells);
      out.set(shapeKey(n), n);
      cells = cells.map(([x, y]) => [-y, x]);
    }
    cells = cells.map(([x, y]) => [-x, y]);
  }
  return [...out.values()];
}
const ORIENT = Object.fromEntries(DISH_IDS.map((id) => [id, orientations(id)]));
const KEYS = Object.fromEntries(DISH_IDS.map((id) => [id, new Set(ORIENT[id].map(shapeKey))]));

const xy = (i) => [i % N, Math.floor(i / N)];
const around = (i) => {
  const [x, y] = xy(i), out = [];
  if (x > 0) out.push(i - 1); if (x < N - 1) out.push(i + 1);
  if (y > 0) out.push(i - N); if (y < N - 1) out.push(i + N);
  return out;
};
// where each bud sits: the first player at the top-left corner, the second at the bottom-right
export const cornerOf = (g, uid) => (uid === g.players[0] ? 0 : N * N - 1);

// who owns each square: the owner of the dish sitting on it (or null)
export function boardOf(g) {
  const b = new Array(N * N).fill(null), piece = new Array(N * N).fill(-1);
  g.pieces.forEach((p, k) => { for (const i of p.cells) { b[i] = p.owner; piece[i] = k; } });
  return { owner: b, piece };
}

// Is setting these squares down a legal move for me? Returns the reason it isn't, or ''.
function problem(g, me, cells, board) {
  if (!cells.length || cells.some((i) => !Number.isInteger(i) || i < 0 || i >= N * N)) return 'that doesn’t fit on the blanket';
  if (new Set(cells).size !== cells.length) return 'that doesn’t fit on the blanket';
  if (cells.some((i) => board.owner[i] !== null)) return 'something’s already there';
  return '';
}
// The friend's dishes that would be fenced in after I set these squares down (indexes into g.pieces).
export function stealsFor(g, me, cells, board = boardOf(g)) {
  const owner = [...board.owner];
  for (const i of cells) owner[i] = me;
  const out = [];
  g.pieces.forEach((p, k) => {
    if (p.owner === me) return;
    const inside = new Set(p.cells);
    const edge = [...new Set(p.cells.flatMap(around))].filter((j) => !inside.has(j));
    if (edge.length && edge.every((j) => owner[j] === me)) out.push(k);
  });
  return out;
}
// Can I set any of these dishes down anywhere?
export function canMove(g, me, offers, board = boardOf(g)) {
  for (const id of offers) {
    for (const shape of ORIENT[id]) {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (shape.some(([dx, dy]) => x + dx >= N || y + dy >= N)) continue;
        if (!problem(g, me, shape.map(([dx, dy]) => (y + dy) * N + x + dx), board)) return true;
      }
    }
  }
  return false;
}

export function score(g) {
  const s = Object.fromEntries(g.players.map((p) => [p, 0]));
  for (const p of g.pieces) s[p.owner] += p.cells.length;
  s[g.players[1]] += BONUS;
  return s;
}
const turnsLeft = (g, uid) => TURNS - (g.taken?.[uid] || 0);

// What one player sees.
export function viewFor(g, me) {
  const them = other(g, me), myTurn = g.status === 'playing' && g.turn === me;
  const v = {
    id: g.id, me, them, players: g.players, people: g.people, buds: g.budNames, status: g.status, turn: g.turn, myTurn,
    pieces: g.pieces.map((p) => ({ dish: p.dish, by: p.by, owner: p.owner, cells: p.cells })),
    moves: (g.moves || []).slice(-6), moveCount: (g.moves || []).length, score: score(g), bonus: BONUS, turns: TURNS,
    left: { [me]: turnsLeft(g, me), [them]: turnsLeft(g, them) }, corner: { [me]: cornerOf(g, me), [them]: cornerOf(g, them) },
    winner: g.winner || null,
  };
  if (myTurn) { v.offers = offersFor(g.seed, (g.moves || []).length); v.canMove = canMove(g, me, v.offers); }
  return v;
}

async function ping(g, to, text) {
  if (Date.now() - (g.dmAt?.[to] ?? 0) < DM_GAP_MS) return;
  await sendDm(to, { content: text, components: [row(linkButton('Go to the picnic', `${SITE_URL}/world?picnic=${g.id}`))] });
  await picnics().doc(g.id).set({ dmAt: { [to]: Date.now() } }, { merge: true });
}

export async function createGame(me, opponent) {
  if (me === opponent) throw err('you need a friend for a picnic!', 400);
  const [mine, theirs, friendship, existing] = await Promise.all([
    refs.bud(me).get(), refs.bud(opponent).get(), refs.friend(me, opponent).get(),
    picnics().where('players', 'array-contains', me).get(),
  ]);
  // friends only: turns come as DMs, and only people who said yes to a sticky note signed up for that
  if (!friendship.exists) throw err('you can only picnic with friends', 403);
  if (!mine.exists) throw err('make your bud first', 409);
  if (!theirs.exists) throw err('that bud isn’t here anymore', 404);
  const active = existing.docs.find((d) => d.get('status') === 'playing' && d.get('players').includes(opponent));
  if (active) return { id: active.id, existing: true };
  const ref = picnics().doc();
  const [u1, u2] = await Promise.all([refs.user(me).get(), refs.user(opponent).get()]);
  const people = { [me]: (u1.exists && u1.get('displayName')) || 'someone', [opponent]: (u2.exists && u2.get('displayName')) || 'someone' };
  const budNames = { [me]: mine.get('nickname') || mine.get('trueName'), [opponent]: theirs.get('nickname') || theirs.get('trueName') };
  const now = Timestamp.now();
  const g = {
    id: ref.id, players: [me, opponent], people, budNames, seed: ref.id, status: 'playing', turn: me,
    pieces: [], moves: [], taken: { [me]: 0, [opponent]: 0 }, passes: 0, winner: null, dmAt: {}, createdAt: now, updatedAt: now,
  };
  await ref.set(g);
  return { id: ref.id };
}

async function load(tx, ref, me) {
  const snap = await tx.get(ref);
  if (!snap.exists || !snap.get('players').includes(me)) throw err('no such picnic', 404);
  return snap.data();
}
// after a turn: next player, or the end (8 turns each, or neither of you can fit anything)
function advance(g, me, patch) {
  const taken = { ...g.taken, [me]: (g.taken?.[me] || 0) + 1 }, them = other(g, me);
  const next = { ...g, ...patch, taken };
  const done = (taken[me] >= TURNS && taken[them] >= TURNS) || next.passes >= 2;
  if (done) {
    const s = score(next);
    next.status = 'done'; next.turn = null; next.score = s;
    next.winner = s[me] === s[them] ? 'tie' : s[me] > s[them] ? me : them;
    next.finishedAt = Timestamp.now();
  } else next.turn = taken[them] < TURNS ? them : me;
  next.updatedAt = Timestamp.now();
  return next;
}

// Set a dish down: offer is 0..2 (which of your three), cells are the squares it covers.
export async function place(me, id, offer, cellsIn) {
  const ref = picnics().doc(id);
  const cells = Array.isArray(cellsIn) ? cellsIn.map(Number).slice(0, 8) : [];
  const g = await db().runTransaction(async (tx) => {
    const g = await load(tx, ref, me);
    if (g.status !== 'playing' || g.turn !== me) throw err('it’s not your turn', 409);
    const dish = offersFor(g.seed, g.moves.length)[offer];
    if (!dish) throw err('pick one of your three dishes', 400);
    if (cells.length !== DISHES[dish].cells.length || !KEYS[dish].has(shapeKey(normalize(cells.map(xy))))) throw err('that’s not the shape of a ' + DISHES[dish].name, 400);
    const board = boardOf(g), why = problem(g, me, cells, board);
    if (why) throw err(why, 409);
    const steals = stealsFor(g, me, cells, board);
    const pieces = g.pieces.map((p, k) => (steals.includes(k) ? { ...p, owner: me } : p));
    pieces.push({ dish, by: me, owner: me, cells });
    const move = { by: me, dish, cells, steals, at: Date.now() };
    const next = advance(g, me, { pieces, moves: [...g.moves, move], passes: 0 });
    tx.set(ref, next);
    return next;
  });
  await notify(g, me);
  return { ...viewFor(g, me), last: g.moves.at(-1) };
}

// Nothing fits: skip your turn (only allowed when that's true)
export async function pass(me, id) {
  const ref = picnics().doc(id);
  const g = await db().runTransaction(async (tx) => {
    const g = await load(tx, ref, me);
    if (g.status !== 'playing' || g.turn !== me) throw err('it’s not your turn', 409);
    if (canMove(g, me, offersFor(g.seed, g.moves.length))) throw err('one of your dishes still fits somewhere!', 409);
    const next = advance(g, me, { moves: [...g.moves, { by: me, pass: true, at: Date.now() }], passes: (g.passes || 0) + 1 });
    tx.set(ref, next);
    return next;
  });
  await notify(g, me);
  return { ...viewFor(g, me), last: g.moves.at(-1) };
}

export async function resign(me, id) {
  const ref = picnics().doc(id);
  const g = await db().runTransaction(async (tx) => {
    const g = await load(tx, ref, me);
    if (g.status !== 'playing') throw err('this picnic is already over', 409);
    const next = { ...g, status: 'resigned', turn: null, winner: other(g, me), score: score(g), finishedAt: Timestamp.now(), updatedAt: Timestamp.now() };
    tx.set(ref, next);
    return next;
  });
  await prize(g).catch((e) => console.error('picnic prize failed:', e));
  return viewFor(g, me);
}

// The winner's bud gets a picnic basket to hold (kept for good).
async function prize(g) {
  if (!g.winner || g.winner === 'tie') return;
  await refs.user(g.winner).set({ wardrobe: { items: { basket: { from: 'picnic', at: Date.now() } } } }, { merge: true });
}

async function notify(g, me) {
  const them = other(g, me), last = g.moves.at(-1), who = plain(g.people[me]);
  const stole = last.steals?.length ? ` and snagged ${last.steals.length === 1 ? `your ${DISHES[g.pieces[last.steals[0]].dish].name}` : `${last.steals.length} of your dishes`}! 😱` : '';
  try {
    if (g.status === 'done') {
      await prize(g);
      const s = g.score, end = g.winner === 'tie' ? 'It’s a tie!' : g.winner === them ? `You win, ${s[them]} to ${s[me]}! 🧺` : `${who} wins, ${s[me]} to ${s[them]}.`;
      await ping({ ...g, dmAt: {} }, them, `🧺 The picnic with **${who}** is over. ${end}`);
    } else if (g.turn === them) {
      const did = last.pass ? `${who} couldn’t fit anything on the blanket` : `${who} set down a ${DISHES[last.dish].name}${stole}`;
      await ping(g, them, `🧺 ${did} in Picnic Clash. Your turn!`);
    }
  } catch (e) { console.warn('picnic DM failed:', e.message); }
}

export async function getGame(me, id) {
  const snap = await picnics().doc(id).get();
  if (!snap.exists || !snap.get('players').includes(me)) throw err('no such picnic', 404);
  return viewFor(snap.data(), me);
}
// for the island: picnics still going, whose turn it is
export async function myPicnics(me) {
  const snap = await picnics().where('players', 'array-contains', me).select('players', 'turn', 'status').get();
  return snap.docs.filter((d) => d.get('status') === 'playing')
    .map((d) => ({ id: d.id, them: d.get('players').find((p) => p !== me), myTurn: d.get('turn') === me }));
}
