// Hold the Fort: makes new days and test-solves each one, so every day has a fort that holds and a "builders' best".
// None of this runs on the site (the folder is left out of the deploy); it only writes lib/fortDays.js.
//
//   cd tools/fort
//   node gen.mjs 1 80 3000 > days_all.jsonl     seeds 1..80, up to about 3000 forts tried per day (minutes, not seconds)
//   node order.mjs                              puts them in order, writes ../../lib/fortDays.js and answers.json
//   node verify.mjs                             every day's answer holds, through the code the server runs
//
// A seed always gives the same day. Days where nothing is needed, or one or two pieces do it, are thrown away,
// and so are days the solver can't hold at all. answers.json (the solver's forts) stays out of git: the repo's
// files are served by the site, and the answers shouldn't be.
import * as pult from '../../lib/catapult.js';
import * as fort from '../../lib/fort.js';
import { aim } from './aim.mjs';

const { CELL, COLS, ROWS, FORT_X } = pult;
const KINDS = fort.KINDS;
const rng = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const THINGS = ['melon', 'duck', 'bowling', 'piano', 'cheese', 'sock', 'beachball', 'anvil', 'gnome'];
const WEIGHT = { melon: 3, duck: 3, bowling: 2, piano: 3, cheese: 3, sock: 1.2, beachball: 2, anvil: 1.5, gnome: 3 };
const ROLLS = new Set(['cheese', 'bowling', 'duck', 'beachball']);

const HEAVY = { anvil: 5, piano: 4, bowling: 4, melon: 3, gnome: 2, cheese: 2, beachball: 1, duck: 1, sock: 0 };
function scenario(seed) {
  const r = rng(seed * 7919 + 13), int = (a, b) => a + Math.floor(r() * (b - a + 1)), pick = (arr) => arr[Math.floor(r() * arr.length)];
  const c = int(5, 10), h = pick([0, 0, 1, 1, 1, 2, 2]);
  const given = Array.from({ length: h }, (_, y) => ({ t: 'stone', x: c, y }));
  const bud = { x: c, y: h }, bx = FORT_X + (c + 0.5) * CELL, by = (h + 0.5) * CELL;
  // three different things
  const bag = [...THINGS], things = [];
  while (things.length < 3) {
    const total = bag.reduce((s, k) => s + WEIGHT[k], 0); let x = r() * total, k = 0;
    while (x > WEIGHT[bag[k]]) { x -= WEIGHT[bag[k]]; k++; }
    things.push(bag.splice(k, 1)[0]);
  }
  if (things.reduce((s, t) => s + HEAVY[t], 0) < 5) return null;   // too gentle a day
  // how each one comes in: one flat, one middling, one lobbed (now and then two the same way)
  let ways = r() < 0.8 ? ['flat', 'mid', 'lob'] : [pick(['flat', 'mid']), pick(['mid', 'lob']), 'lob'];
  for (let i = ways.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ways[i], ways[j]] = [ways[j], ways[i]]; }
  // more often than not, the heaviest thing is the one that comes in flat
  if (r() < 0.6 && ways.includes('flat')) {
    const hi = things.indexOf([...things].sort((a, b) => HEAVY[b] - HEAVY[a])[0]), fi = ways.indexOf('flat');
    [ways[hi], ways[fi]] = [ways[fi], ways[hi]];
  }
  const shots = [];
  for (let i = 0; i < 3; i++) {
    const what = things[i], way = ways[i];
    const angle = way === 'flat' ? int(16, 24) : way === 'mid' ? int(36, 50) : int(62, 72);
    const short = ROLLS.has(what) && h === 0 && way !== 'lob' && r() < 0.4;
    // flat: at the bud's middle. middling: at its top. lobbed: a touch past it, so it drops in behind a front wall.
    let tx = way === 'flat' ? bx - 0.2 : way === 'mid' ? bx + (r() - 0.5) * 0.3 : bx + 0.1 + r() * 0.25;
    let ty = way === 'flat' ? by : way === 'mid' ? by + 0.15 : by + 0.2;
    if (short) { tx = bx - (1.2 + r() * 1.8); ty = 0.25; }
    const power = aim(angle, tx, ty);
    if (power == null || power < 0.03 || power > 0.99) return null;
    shots.push({ what, angle, power });
  }
  const master = { wood: int(3, 5), stone: int(0, 1), beam: int(1, 2), pillar: int(2, 3), jelly: r() < 0.35 ? 1 : 0 };
  return { seed, bud, given, shots, master, c, h };
}

function solver(sc, budget, r) {
  const { c, h } = sc; let evals = 0;
  const puzzle = { n: 0, bud: sc.bud, given: sc.given, pile: sc.master, shots: sc.shots, par: 0 };
  const memo = new Map();
  const key = (ps) => ps.map((p) => p.t[0] + p.t[1] + p.x + ',' + p.y).sort().join(' ');
  const evaluate = (pieces) => {
    const k = key(pieces); if (memo.has(k)) return memo.get(k);
    evals++;
    let res;
    try {
      const out = fort.run(puzzle, pieces);
      const last = out.launches[out.launches.length - 1];
      res = { held: out.held, survived: out.survived, dizzy: out.dizzy,
        score: out.held ? 1000 - 20 * pieces.length - out.dizzy * 0.05 : out.survived * 100 + Math.min(60, (last.ko?.frame || 0) / 3) - pieces.length };
    } catch (e) { res = { held: false, survived: -1, dizzy: 0, score: -50 }; }
    memo.set(k, res); return res;
  };
  const x0 = Math.max(0, c - 6), x1 = Math.min(COLS - 1, c + 3), yTop = Math.min(ROWS - 1, h + 5);
  const occOf = (pieces) => {
    const o = new Set([`${sc.bud.x},${sc.bud.y}`]);
    for (const p of [...sc.given, ...pieces]) { const P = KINDS[p.t]; for (let i = 0; i < P.w; i++) for (let j = 0; j < P.h; j++) o.add(`${p.x + i},${p.y + j}`); }
    return o;
  };
  const left = (pieces) => { const n = { ...sc.master }; for (const p of pieces) n[p.t]--; return n; };
  // every square a new piece could go where it would rest on the ground or on something
  const spots = (pieces) => {
    const o = occOf(pieces), n = left(pieces), out = [];
    for (const t of Object.keys(n)) {
      if (n[t] <= 0) continue; const P = KINDS[t];
      for (let x = x0; x + P.w - 1 <= Math.min(COLS - 1, x1 + P.w - 1) && x + P.w <= COLS; x++) for (let y = 0; y + P.h - 1 <= yTop; y++) {
        let free = true, held = y === 0;
        for (let i = 0; i < P.w && free; i++) { for (let j = 0; j < P.h; j++) if (o.has(`${x + i},${y + j}`)) { free = false; break; } if (y > 0 && o.has(`${x + i},${y - 1}`) && !(x + i === sc.bud.x && y - 1 === sc.bud.y)) held = true; }
        if (free && held) out.push({ t, x, y });
      }
    }
    return out;
  };
  const sample = (arr, k) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };
  let best = null;
  const consider = (pieces) => { if (!best || pieces.length < best.length) best = pieces.map((p) => ({ ...p })); };
  const prune = (pieces) => {
    let cur = pieces, changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < cur.length; i++) { const less = cur.filter((_, k) => k !== i); if (evaluate(less).held) { cur = less; changed = true; break; } }
    }
    return cur;
  };
  // does nothing at all hold? does any single piece?
  const empty = evaluate([]);
  if (empty.held) return { best: [], evals, empty };
  for (const s of spots([])) { if (evaluate([s]).held) { consider([s]); break; } }
  if (best) return { best, evals, empty };
  // build up greedily, a few times over, looking a handful of placements ahead each step
  for (let run = 0; run < 14 && evals < budget * 0.6; run++) {
    let cur = [];
    for (let step = 0; step < 9; step++) {
      const cand = sample(spots(cur), 12); if (!cand.length) break;
      let top = null;
      for (const s of cand) { const e = evaluate([...cur, s]); if (!top || e.score > top.e.score) top = { s, e }; if (e.held) break; }
      cur = [...cur, top.s];
      if (top.e.held) { consider(prune(cur)); break; }
      if (best && cur.length >= best.length - 1) break;   // no shorter than what we have
    }
  }
  if (!best) return { best: null, evals, empty };
  // try to do it with one fewer: take two away, put one back; or move one
  let tries = 0;
  while (evals < budget && tries < 4000 && best.length > 1) {
    tries++;
    const cur = best.filter(() => true), n = cur.length;
    const drop = sample([...cur.keys()], r() < 0.7 ? 2 : 1), kept = cur.filter((_, i) => !drop.includes(i));
    const add = sample(spots(kept), drop.length - 1 || (r() < 0.5 ? 0 : 1));
    const next = [...kept, ...add];
    if (next.length < n && evaluate(next).held) { best = prune(next); tries = 0; }
  }
  // and a sample of pairs from scratch (a fluke two-piece fort would make the day too easy)
  if (best.length > 2) {
    const all = spots([]);
    for (let i = 0; i < 500 && evals < budget + 500; i++) {
      const a = all[Math.floor(r() * all.length)], sp = spots([a]); if (!sp.length) continue;
      const pair = [a, sp[Math.floor(r() * sp.length)]];
      if (evaluate(pair).held) { best = pair; break; }
    }
  }
  return { best, evals, empty };
}

const first = Number(process.argv[2] || 1), count = Number(process.argv[3] || 5), budget = Number(process.argv[4] || 1500);
for (let seed = first; seed < first + count; seed++) {
  const sc = scenario(seed);
  if (!sc) { console.error(seed, 'no scenario'); continue; }
  const t0 = Date.now(), r = rng(seed * 104729 + 7);
  const { best, evals, empty } = solver(sc, budget, r);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (!best) { console.error(seed, 'no fort found', evals, 'evals', secs + 's'); continue; }
  if (best.length < 3 || best.length > 7) { console.error(seed, 'par', best.length, '(want 3 to 7)', evals, 'evals', secs + 's'); continue; }
  // the day's pile: what the builders used, plus a few spare, never more than the master pile
  const used = {}; for (const p of best) used[p.t] = (used[p.t] || 0) + 1;
  const pile = {}; let spare = 0;
  for (const t of fort.PIECE_ORDER) { const m = sc.master[t] || 0, u = used[t] || 0; if (!m) continue; const extra = Math.min(m - u, Math.floor(r() * 3)); pile[t] = u + extra; spare += extra; }
  if (spare < 2) for (const t of ['wood', 'pillar', 'beam']) if ((pile[t] || 0) < sc.master[t]) { pile[t] = (pile[t] || 0) + 1; spare++; if (spare >= 3) break; }
  for (const t of Object.keys(pile)) if (!pile[t]) delete pile[t];
  // check once more against the pile the players get
  const out = fort.run({ n: 0, bud: sc.bud, given: sc.given, pile, shots: sc.shots, par: best.length }, best);
  if (!out.held) { console.error(seed, 'the answer stopped holding?!'); continue; }
  console.log(JSON.stringify({ seed, bud: sc.bud, given: sc.given, pile, shots: sc.shots, par: best.length, sol: best, emptySurvived: empty.survived, dizzy: out.dizzy, evals, secs: Number(secs) }));
  console.error(seed, 'ok par', best.length, evals, 'evals', secs + 's', sc.shots.map((s) => s.what).join('+'));
}
