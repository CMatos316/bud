// Doodle Duel: a two-player drawing game between friends, played in turns (like Peekaboo).
// The drawer picks one of three words and paints it with the bud maker's brushes. The other player watches
// it replay stroke by stroke and guesses. A right guess grows the pair's shared streak; giving up resets it.
// Then the guesser draws next. The word is never sent to the guesser: guesses are checked here.
// Games: guilds/{guild}/doodles/{id}.
import { db, refs, Timestamp } from './firebase.js';
import { GUILD_ID, SITE_URL, sendDm, linkButton, row } from './discord.js';

const DM_GAP_MS = 20 * 60e3;
const MAX_POINTS = 9000, MAX_STROKES = 500, MAX_MS = 5 * 60e3;
export const games = () => db().collection('guilds').doc(GUILD_ID).collection('doodles');
const err = (message, status) => Object.assign(new Error(message), { status });
const other = (g, me) => g.players.find((p) => p !== me);
const plain = (s) => String(s ?? '').replace(/([\\*_~`|>#\[\]()<@:-])/g, '\\$1');

// easy (1 point), medium (2), hard (3)
export const WORDS = [
  ['cat', 'sun', 'tree', 'fish', 'pizza', 'moon', 'house', 'flower', 'apple', 'snowman', 'rainbow', 'ghost', 'star', 'cloud', 'boat',
    'cake', 'heart', 'banana', 'snail', 'frog', 'pumpkin', 'donut', 'balloon', 'mushroom', 'cookie', 'egg', 'bee', 'duck', 'hat', 'kite'],
  ['campfire', 'volcano', 'robot', 'castle', 'octopus', 'guitar', 'rocket', 'dinosaur', 'penguin', 'cactus', 'lighthouse', 'skateboard',
    'umbrella', 'unicorn', 'hamburger', 'waterfall', 'tornado', 'spider web', 'treasure', 'island', 'popcorn', 'headphones', 'snowflake',
    'basketball', 'video game', 'sandcastle', 'jellyfish', 'telescope', 'sleepover', 'birthday'],
  ['homework', 'monday', 'wifi', 'sneeze', 'nightmare', 'friendship', 'group chat', 'traffic jam', 'brain freeze', 'sunburn', 'echo',
    'thunderstorm', 'jet lag', 'déjà vu', 'gravity', 'procrastination', 'hiccups', 'tickle fight', 'road trip', 'stage fright', 'awkward silence',
    'time travel', 'peekaboo', 'sticky note', 'nap time', 'snack attack', 'surprise party', 'lost sock', 'bad haircut', 'sleepwalking'],
];
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
function choicesFor(seed) {
  const r = mulberry(seed);
  return WORDS.map((list, i) => ({ word: list[Math.floor(r() * list.length)], points: i + 1 }));
}
function mulberry(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
// the blanks the guesser sees ("_ _ _   _ _"), and a bank of letters with the word's letters mixed in
function wordShape(word) { return word.split(' ').map((w) => norm(w).length); }
function letterBank(word, seed) {
  const r = mulberry(seed), letters = norm(word).split('');
  const size = Math.max(12, letters.length + 4);
  while (letters.length < size) letters.push(LETTERS[Math.floor(r() * 26)]);
  return letters.sort(() => r() - 0.5).join('');
}

// Strokes: [{ c: color index, s: size index, p: [x, y, t, x, y, t, ...] }] with x, y in 0..1000 and t in ms.
export function cleanStrokes(input) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_STROKES) throw err('that drawing didn’t come through. try again?', 400);
  let total = 0;
  const out = input.map((st) => {
    const c = Number(st?.c), s = Number(st?.s), p = Array.isArray(st?.p) ? st.p : [];
    if (!Number.isInteger(c) || c < 0 || c > 9 || !Number.isInteger(s) || s < 0 || s > 2 || p.length < 3 || p.length % 3) throw err('that drawing didn’t come through. try again?', 400);
    const pts = p.map((v, i) => Math.round(Math.max(0, Math.min(i % 3 === 2 ? MAX_MS : 1000, Number(v) || 0))));
    total += pts.length / 3;
    return { c, s, p: pts };
  });
  if (total > MAX_POINTS) throw err('that drawing is a bit too detailed! try a simpler one', 413);
  return out;
}

async function ping(game, to, text, label) {
  const at = game.dmAt?.[to] ?? 0;
  if (Date.now() - at < DM_GAP_MS) return;
  await sendDm(to, { content: text, components: [row(linkButton(label, `${SITE_URL}/doodle?id=${game.id}`))] });
  await games().doc(game.id).set({ dmAt: { [to]: Date.now() } }, { merge: true });
}

// What one player is allowed to see.
export function viewFor(g, me) {
  const myTurn = g.turn === me;
  const v = {
    id: g.id, me, them: other(g, me), people: g.people, buds: g.budNames, stage: g.stage, turn: g.turn, myTurn,
    drawer: g.drawer || null, streak: g.streak || 0, best: g.best || 0, points: g.points || 0,
    rounds: (g.rounds || []).slice(-8), tries: g.tries || 0,
  };
  if (myTurn && g.stage === 'pick') v.choices = g.choices;
  if (myTurn && g.stage === 'draw') { v.word = g.word; v.wordPoints = g.wordPoints; }
  if (g.stage === 'guess') {
    v.strokes = g.strokes; v.drawMs = g.drawMs || 0; v.wordPoints = g.wordPoints;
    if (myTurn) { v.shape = wordShape(g.word); v.bank = letterBank(g.word, `${g.id}:${g.round}`); }
    else v.word = g.word;   // the drawer knows what they drew
  }
  return v;
}

export async function createGame(me, opponent) {
  if (me === opponent) throw err('you can’t doodle against yourself (yet)', 400);
  const [mine, theirs, friendship, existing] = await Promise.all([
    refs.bud(me).get(), refs.bud(opponent).get(), refs.friend(me, opponent).get(),
    games().where('players', 'array-contains', me).get(),
  ]);
  // friends only: your turn comes as a DM, and only people who said yes to a sticky note signed up for that
  if (!friendship.exists) throw err('you can only doodle with friends', 403);
  if (!mine.exists) throw err('make your bud first', 409);
  if (!theirs.exists) throw err('that bud isn’t here anymore', 404);
  const active = existing.docs.find((d) => d.get('players').includes(opponent));
  if (active) return { id: active.id, existing: true };
  const ref = games().doc();
  const [u1, u2] = await Promise.all([refs.user(me).get(), refs.user(opponent).get()]);
  const people = { [me]: (u1.exists && u1.get('displayName')) || 'someone', [opponent]: (u2.exists && u2.get('displayName')) || 'someone' };
  const budNames = { [me]: mine.get('nickname') || mine.get('trueName'), [opponent]: theirs.get('nickname') || theirs.get('trueName') };
  const now = Timestamp.now();
  const game = {
    id: ref.id, players: [me, opponent], people, budNames, stage: 'pick', turn: me, drawer: me, round: 1,
    choices: choicesFor(`${ref.id}:1`), word: null, wordPoints: 0, strokes: null, tries: 0,
    streak: 0, best: 0, points: 0, rounds: [], dmAt: {}, createdAt: now, updatedAt: now,
  };
  await ref.set(game);
  return { id: ref.id };
}

async function load(tx, ref, me) {
  const snap = await tx.get(ref);
  if (!snap.exists || !snap.get('players').includes(me)) throw err('no such game', 404);
  return snap.data();
}

export async function pickWord(me, id, i) {
  const ref = games().doc(id);
  const g = await db().runTransaction(async (tx) => {
    const g = await load(tx, ref, me);
    if (g.stage !== 'pick' || g.turn !== me) throw err('it’s not your turn to pick', 409);
    const c = g.choices?.[i];
    if (!c) throw err('pick one of the three', 400);
    const patch = { stage: 'draw', word: c.word, wordPoints: c.points, updatedAt: Timestamp.now() };
    tx.update(ref, patch);
    return { ...g, ...patch };
  });
  return viewFor(g, me);
}

export async function sendDrawing(me, id, strokes) {
  const clean = cleanStrokes(strokes);
  const drawMs = Math.max(...clean.map((s) => s.p[s.p.length - 1]), 0);
  const ref = games().doc(id);
  const g = await db().runTransaction(async (tx) => {
    const g = await load(tx, ref, me);
    if (g.stage !== 'draw' || g.turn !== me) throw err('it’s not your turn to draw', 409);
    const patch = { stage: 'guess', turn: other(g, me), drawer: me, strokes: clean, drawMs, tries: 0, updatedAt: Timestamp.now() };
    tx.update(ref, patch);
    return { ...g, ...patch };
  });
  await ping(g, g.turn, `🎨 **${plain(g.people[me])}** drew you something in Doodle Duel! Can you guess it?`, 'Guess it').catch(() => {});
  return viewFor(g, me);
}

// A guess: right → the streak grows and the guesser draws next. Wrong → try again.
export async function guess(me, id, text) {
  const ref = games().doc(id);
  const g = await db().runTransaction(async (tx) => {
    const g = await load(tx, ref, me);
    if (g.stage !== 'guess' || g.turn !== me) throw err('it’s not your turn to guess', 409);
    if (!norm(text)) throw err('type a guess', 400);
    if (norm(text) !== norm(g.word)) {
      const patch = { tries: (g.tries || 0) + 1, updatedAt: Timestamp.now() };
      tx.update(ref, patch);
      return { ...g, ...patch, last: { right: false } };
    }
    return finishRound(tx, ref, g, me, true);
  });
  if (g.last?.right) await ping(g, other(g, me), `🎨 **${plain(g.people[me])}** guessed your doodle (**${plain(g.rounds.at(-1).word)}**)! Streak: ${g.streak}. Now they’re drawing for you.`, 'See the game').catch(() => {});
  return { ...viewFor(g, me), last: g.last };
}
export async function giveUp(me, id) {
  const ref = games().doc(id);
  const g = await db().runTransaction(async (tx) => {
    const g = await load(tx, ref, me);
    if (g.stage !== 'guess' || g.turn !== me) throw err('it’s not your turn', 409);
    return finishRound(tx, ref, g, me, false);
  });
  return { ...viewFor(g, me), last: g.last };
}
function finishRound(tx, ref, g, me, right) {
  const streak = right ? (g.streak || 0) + 1 : 0, round = (g.round || 1) + 1;
  const rounds = [...(g.rounds || []), { by: g.drawer, word: g.word, points: g.wordPoints, guessed: right, tries: (g.tries || 0) + (right ? 1 : 0), at: Date.now() }].slice(-20);
  const patch = {
    stage: 'pick', turn: me, drawer: me, round, choices: choicesFor(`${g.id}:${round}`), word: null, wordPoints: 0,
    strokes: null, tries: 0, streak, best: Math.max(g.best || 0, streak), points: (g.points || 0) + (right ? g.wordPoints : 0),
    rounds, updatedAt: Timestamp.now(),
  };
  tx.update(ref, patch);
  return { ...g, ...patch, last: { right, word: g.word, points: right ? g.wordPoints : 0 } };
}

export async function getGame(me, id) {
  const snap = await games().doc(id).get();
  if (!snap.exists || !snap.get('players').includes(me)) throw err('no such game', 404);
  return viewFor(snap.data(), me);
}
// for the island: your doodle games, whose turn it is
export async function myDoodles(me) {
  const snap = await games().where('players', 'array-contains', me).get();
  return snap.docs.map((d) => d.data()).map((g) => ({ id: g.id, them: other(g, me), myTurn: g.turn === me, stage: g.stage, streak: g.streak || 0 }));
}
