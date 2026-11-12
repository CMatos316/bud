// Hold the Fort scores: guilds/{guild}/forts/{day}_{person}. One doc per person per day: how many tries, their
// best result, and the last fort they built (so the page can hand it back). The rules are in lib/fort.js.
// Only today's puzzle counts. Any other day can be played as practice: nothing is saved.
import { db } from './firebase.js';
import { GUILD_ID } from './discord.js';
import * as fort from './fort.js';
import { FLUNG } from './catapult.js';

const forts = () => db().collection('guilds').doc(GUILD_ID).collection('forts');
const err = (message, status = 400) => Object.assign(new Error(message), { status });
const okDay = (n) => Number.isInteger(n) && n >= 1 && n <= 100000;

// what the page needs to draw and explain a day
function publicPuzzle(n) {
  const p = fort.puzzleFor(n);
  return {
    ...p,
    shots: p.shots.map((s) => {
      const T = fort.THINGS[s.what], F = FLUNG[s.what];
      return { ...s, a: T.a, the: T.the, emoji: T.emoji, note: T.note, ...(F.r ? { r: F.r } : { w: F.w, h: F.h }) };
    }),
  };
}
// a fort that held counts the try it took to get there; one that hasn't held yet counts every try so far
const triesOf = (d) => (d.held ? d.bestTries ?? d.tries : d.tries) || 0;
const mine = (d) => (d ? { tries: d.tries || 0, held: !!d.held, pieces: d.pieces ?? null, survived: d.survived ?? 0, bestTries: d.bestTries ?? null, last: d.last || null, best: d.best || null } : null);

async function board(n, me) {
  const snap = await forts().where('n', '==', n).get();
  const rows = snap.docs.map((d) => d.data()).filter((d) => (d.tries || 0) > 0)
    .map((d) => ({ uid: d.uid, name: d.name || 'someone', held: !!d.held, pieces: d.pieces ?? null, survived: d.survived ?? 0, tries: triesOf(d), at: d.bestAt ?? 0 }));
  rows.sort(fort.rank);
  return rows.map(({ uid, at, ...r }) => ({ ...r, me: uid === me }));
}
// days in a row with a fort that held, counting back from today (or from yesterday, if today isn't done yet)
async function streak(me, today) {
  const snap = await forts().where('uid', '==', me).get();
  const heldOn = new Set(snap.docs.filter((d) => d.get('held')).map((d) => d.get('n')));
  let n = heldOn.has(today) ? today : today - 1, count = 0;
  while (heldOn.has(n)) { count++; n--; }
  return count;
}

export async function view(me, nIn) {
  const today = fort.dayNumber(), n = nIn == null ? today : nIn;
  if (!okDay(n)) throw err('which day?');
  const practice = n !== today;
  const puzzle = publicPuzzle(n);
  if (practice) return { n, today, practice, puzzle, me: null, board: null, streak: 0, days: fort.DAY_COUNT };
  const snap = await forts().doc(`${n}_${me}`).get();
  const d = snap.exists ? snap.data() : null;
  const played = !!d && (d.tries || 0) > 0;
  const [b, s] = await Promise.all([played ? board(n, me) : null, streak(me, today)]);
  return { n, today, practice, puzzle, me: mine(d), board: b, streak: s, days: fort.DAY_COUNT, share: played ? fort.shareLine(puzzle, { held: !!d.held, pieces: d.pieces, tries: triesOf(d) }) : null };
}

// One try at a day. Returns what happened (the three launches, to replay) and where that leaves you.
export async function attempt(me, name, nIn, pieces) {
  const today = fort.dayNumber(), n = nIn == null ? today : nIn;
  if (!okDay(n)) throw err('which day?');
  const puzzle = fort.puzzleFor(n);
  const out = fort.run(puzzle, pieces);   // throws if the build isn't allowed, or falls on the bud
  const clean = pieces.map((p) => ({ t: p.t, x: Number(p.x), y: Number(p.y) }));
  const result = { held: out.held, out: out.out, used: out.used, survived: out.survived, dizzy: out.dizzy };
  const replay = { start: out.start, launches: out.launches, end: out.end };
  if (n !== today) return { n, today, practice: true, result, ...replay, me: null, board: null, streak: 0 };
  const ref = forts().doc(`${n}_${me}`), now = Date.now();
  const d = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const was = snap.exists ? snap.data() : { n, uid: me, tries: 0, held: false, pieces: null, survived: 0, firstAt: now };
    const next = { ...was, name: String(name || 'someone').slice(0, 80), tries: (was.tries || 0) + 1, last: clean, lastAt: now };
    const better = out.held ? (!was.held || out.used < was.pieces) : (!was.held && (was.tries || 0) === 0 ? true : !was.held && out.survived > (was.survived || 0));
    if (better) Object.assign(next, { held: out.held, pieces: out.held ? out.used : null, survived: out.survived, best: clean, bestAt: now, bestTries: next.tries });
    tx.set(ref, next);
    return next;
  });
  const [b, s] = await Promise.all([board(n, me), streak(me, today)]);
  return { n, today, practice: false, result, ...replay, me: mine(d), board: b, streak: s, share: fort.shareLine(puzzle, { held: !!d.held, pieces: d.pieces, tries: triesOf(d) }) };
}
