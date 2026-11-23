import { ROYAL, KINDS, CARDS, deal, fillPool, newBattle, step, botMove, roll } from '../js/royal-rules.js';
const N = +process.argv[2] || 400, verbose = process.argv[3] === 'v';
const dice = { seed: +process.argv[4] || 12345 };
const pool = fillPool([]).concat(fillPool([]));   // an even island: every power as common as every other
const st = {}; for (const k of CARDS) st[k] = { in: 0, win: 0, played: 0 };
let side0 = 0, draws = 0, len = 0, firstTree = 0, firstN = 0; const why = {}; const bySpend = [];
for (let m = 0; m < N; m++) {
  const decks = deal(pool, dice); if (!decks) throw new Error('could not deal');
  const s = newBattle(Math.floor(roll(dice) * 4e9), decks), bots = [{ seed: Math.floor(roll(dice) * 4e9), skill: 1 }, { seed: Math.floor(roll(dice) * 4e9), skill: 1 }];
  let ft = null; const pending = [];
  while (!s.over) {
    const now = []; for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= s.tick) now.push(pending.splice(i, 1)[0].c);
    step(s, now);
    for (const e of s.ev) { if (e.k === 'down' && e.kind === 'tree' && ft == null) ft = s.tick / ROYAL.TICK; if (e.k === 'place') st[e.kind].played++; }
    s.ev.length = 0;
    for (const side of [0, 1]) { const c = botMove(s, side, bots[side]); if (c) pending.push({ at: s.tick + ROYAL.LAND_TICKS, c }); }
  }
  len += s.tick / ROYAL.TICK; why[s.why] = (why[s.why] || 0) + 1; if (ft != null) { firstTree += ft; firstN++; }
  if (s.winner == null) draws++; else if (s.winner === 0) side0++;
  for (const side of [0, 1]) for (const k of new Set(decks[side].map((c) => c.kind))) { st[k].in++; st[k].win += s.winner == null ? 0.5 : s.winner === side ? 1 : 0; }
}
console.log(`${N} matches: side 0 wins ${(side0 / (N - draws) * 100).toFixed(1)}% of decided, draws ${(draws / N * 100).toFixed(1)}%, average length ${(len / N).toFixed(0)}s, first tree at ${(firstTree / firstN).toFixed(0)}s (${(firstN / N * 100).toFixed(0)}% of matches)`);
console.log('ended by', Object.entries(why).map(([k, v]) => `${k} ${(v / N * 100).toFixed(0)}%`).join(', '));
for (const k of CARDS) console.log(k.padEnd(10), `cost ${KINDS[k].cost}`, `wins ${(st[k].win / st[k].in * 100).toFixed(1)}%`, `in ${st[k].in}`, `played ${(st[k].played / st[k].in).toFixed(1)}/match`);
