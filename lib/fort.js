// Hold the Fort: the daily puzzle. Your bud ordered three things, the island delivers by catapult, and your bud
// is napping right where they'll land (and will not be moved). Everyone gets the same day: the same nap spot,
// the same pile of pieces, the same three deliveries. Build something that keeps the bud standing through all
// three, with as few pieces as you can. Whatever is delivered stays where it lands.
//
// This file is the rules, with no database in it: which puzzle is which day, whether a build is allowed, and
// what happens to it (the physics is Bud-a-pult's, lib/catapult.js). lib/fortStore.js keeps the scores.
import * as pult from './catapult.js';
import { DAYS } from './fortDays.js';

export const KINDS = { ...pult.PIECES, ...pult.MORE_PIECES };
export const PIECE_ORDER = ['wood', 'stone', 'beam', 'pillar', 'jelly'];
// What gets delivered. (How each one flies and lands is in lib/catapult.js, FLUNG.)
export const THINGS = {
  melon: { a: 'a watermelon', the: 'the watermelon', emoji: '🍉', note: 'heavy, and it does not bounce' },
  duck: { a: 'a rubber duck', the: 'the rubber duck', emoji: '🦆', note: 'weighs nothing, bounces off everything' },
  bowling: { a: 'a bowling ball', the: 'the bowling ball', emoji: '🎳', note: 'small, very heavy, keeps rolling' },
  piano: { a: 'a piano', the: 'the piano', emoji: '🎹', note: 'exactly as heavy as it looks' },
  cheese: { a: 'a wheel of cheese', the: 'the cheese', emoji: '🧀', note: 'lands rolling and doesn’t stop' },
  sock: { a: 'one sock', the: 'the sock', emoji: '🧦', note: 'it’s a sock' },
  beachball: { a: 'a beach ball', the: 'the beach ball', emoji: '🏖️', note: 'huge, light, very bouncy' },
  anvil: { a: 'an anvil', the: 'the anvil', emoji: '⚒️', note: 'nobody knows why your bud ordered this' },
  gnome: { a: 'a garden gnome', the: 'the gnome', emoji: '🧙', note: 'tumbles end over end' },
};
const err = (message, status = 400) => Object.assign(new Error(message), { status });

// Day 1 is this date on the island's clock (Eastern time); a new puzzle at midnight there.
const DAY_ONE = '2026-11-11';
const etDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const dayIndex = (ymd) => Math.round(Date.UTC(...ymd.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v)))) / 864e5);
export const dayNumber = (ms = Date.now()) => dayIndex(etDate(ms)) - dayIndex(DAY_ONE) + 1;
export const DAY_COUNT = DAYS.length;

// The puzzle for day n (1, 2, 3...). There are DAYS.length of them; after that they come round again.
export function puzzleFor(n) {
  const d = DAYS[((n - 1) % DAYS.length + DAYS.length) % DAYS.length];
  return { n, bud: d.bud, given: d.given, pile: d.pile, shots: d.shots, par: d.par };
}

// A try: pieces [{ t, x, y }] from the day's pile, on free squares. Returns the build for the physics.
export function checkTry(puzzle, pieces) {
  if (!Array.isArray(pieces) || pieces.length > 40) throw err('that fort didn’t come through');
  const used = {};
  for (const p of pieces) {
    if (!p || !Object.hasOwn(KINDS, p.t)) throw err('that fort didn’t come through');
    used[p.t] = (used[p.t] || 0) + 1;
    if (used[p.t] > (puzzle.pile[p.t] || 0)) throw err(`today’s pile only has ${puzzle.pile[p.t] || 0} of those`);
  }
  // (this also checks the grid, and that nothing shares a square with the bud or with what was already there)
  return pult.checkBuild([...puzzle.given, ...pieces.map((p) => ({ t: p.t, x: p.x, y: p.y }))], puzzle.bud, KINDS);
}

// Build it, let it settle, and deliver all three (stopping early if the bud is out). Throws if the bud won't
// even stay put once the pieces settle. Each launch comes back as a replay for the page.
export function run(puzzle, pieces) {
  const build = checkTry(puzzle, pieces);
  let state;
  try { state = pult.settle(pult.placeBuild(build)); }
  catch (e) { if (e.status === 409) throw err('that fort falls on your bud before anything is even flung!', 409); throw e; }
  const start = state, launches = [];
  let out = null;
  for (let i = 0; i < puzzle.shots.length; i++) {
    const s = puzzle.shots[i];
    const { after, ...replay } = pult.shoot(state, s.angle, s.power, { what: s.what, keep: true });
    launches.push({ ...replay, before: state });
    state = after;
    if (replay.ko) { out = { launch: i + 1, how: replay.ko.how, what: s.what }; break; }
  }
  return { held: !out, out, used: pieces.length, survived: out ? out.launch - 1 : puzzle.shots.length, dizzy: Math.round(state.dizzy || 0), start, launches, end: state };
}

// Which of two results is better: holding beats not; then fewer pieces; then fewer tries; then who got there first.
// (For results that didn't hold: more deliveries survived, then fewer tries.)
export function rank(a, b) {
  if (!!a.held !== !!b.held) return a.held ? -1 : 1;
  if (a.held) return (a.pieces - b.pieces) || (a.tries - b.tries) || (a.at - b.at);
  return (b.survived - a.survived) || (a.tries - b.tries) || (a.at - b.at);
}

// The line to paste in the server.
export function shareLine(puzzle, r) {
  const things = puzzle.shots.map((s) => THINGS[s.what].emoji).join('');
  if (r.held) return `Hold the Fort #${puzzle.n} ${things} held with ${r.pieces} piece${r.pieces === 1 ? '' : 's'}${r.pieces < puzzle.par ? ' (beat the builders!)' : r.pieces === puzzle.par ? ' (matched the builders)' : ''} · ${r.tries} ${r.tries === 1 ? 'try' : 'tries'}`;
  return `Hold the Fort #${puzzle.n} ${things} no fort yet · ${r.tries} ${r.tries === 1 ? 'try' : 'tries'}`;
}
