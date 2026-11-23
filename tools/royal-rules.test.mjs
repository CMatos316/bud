import { ROYAL, KINDS, CARDS, POWER_FOR, deal, fillPool, newBattle, step, place, canPlace, botMove, roll, fingerprint, tree, home, timeLeft, doubled } from '../js/royal-rules.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const T = ROYAL.TICK, deckOf = (...k) => k.map((kind, i) => ({ id: 'b' + i, kind }));
const D = deckOf('bookworm', 'glitch', 'loud', 'lifter', 'striker', 'masher', 'lobber', 'pets'), M = deckOf('masher', 'striker', 'glitch', 'squirrel', 'lifter', 'loud', 'lobber', 'pets');
const run = (s, secs, f) => { const ev = []; for (let i = 0; i < secs * T && !s.over; i++) { step(s, f ? f(i) : null); ev.push(...s.ev); s.ev.length = 0; } return ev; };
const battle = (d0 = D, d1 = D) => newBattle(42, [d0, d1]);
{ // dealing
  const dice = { seed: 5 }, pool = fillPool([]); let good = true, same = true;
  for (let i = 0; i < 200; i++) { const d = deal(pool, dice); if (!d) { good = false; break; } const cost = (x) => x.reduce((a, c) => a + KINDS[c.kind].cost, 0); if (d[0].length !== 8 || d[1].length !== 8 || Math.abs(cost(d[0]) - cost(d[1])) > 1) good = false; for (const x of d) if (!x.some((c) => ['lifter', 'gloam', 'glitch', 'loud'].includes(c.kind)) || !x.some((c) => ['lobber', 'loud', 'gloam'].includes(c.kind))) good = false; }
  ok(good, '200 deals: 8 buds each, costs within 1 of each other, each stack has something big and something for crowds');
  ok(JSON.stringify(deal(pool, { seed: 9 })) === JSON.stringify(deal(pool, { seed: 9 })), 'the same dice deal the same stacks');
  ok(fillPool([{ id: 'u1', kind: 'bookworm' }]).filter((c) => c.kind === 'bookworm').length === 2 && fillPool([]).some((c) => c.id === 'gloam') && fillPool([]).some((c) => c.id === 'squirrel'), 'a small island is topped up with stand-ins, Gloam and the squirrel');
  ok(CARDS.every((k) => KINDS[k].cost >= 1 && KINDS[k].cost <= 6) && Object.values(POWER_FOR).every((k) => CARDS.includes(k)), 'every power costs 1 to 6 Glow, and every interest maps to a power');
}
{ // glow, hand, placing
  const s = battle(); ok(s.sides[0].glow === 5 && s.sides[0].hand.join() === '0,1,2,3', 'start: 5 Glow, four cards showing');
  ok(canPlace(s, 0, 4, 10) && !canPlace(s, 0, 4, 20) && canPlace(s, 1, 4, 22) && !canPlace(s, 1, 4, 10) && !canPlace(s, 0, 4, 16), 'you place on your own half only');
  ok(!place(s, { side: 0, slot: 1, x: 4, y: 20 }) && s.sides[0].glow === 5, 'a placement on their half is refused');
  ok(place(s, { side: 0, slot: 0, x: 4, y: 10 }) && s.sides[0].glow === 2 && s.sides[0].hand[0] === 4 && s.sides[0].queue.join() === '5,6,7,0', 'playing a card costs its Glow and brings the next one in');
  ok(!place(s, { side: 0, slot: 1, x: 4, y: 10 }), 'not enough Glow: refused');
  run(s, 2.5); ok(s.sides[0].glow === 3 && s.sides[1].glow === 6, 'one Glow every 2.5 seconds');
  run(s, 30); ok(s.sides[1].glow === 10, 'Glow stops at 10');
  const s2 = battle(); s2.tick = (ROYAL.MATCH_S - ROYAL.DOUBLE_S) * T; s2.sides[0].glow = 0; run(s2, 2.5); ok(doubled(s2) && s2.sides[0].glow === 2, 'the last minute: Glow twice as fast');
}
{ // arriving, crossing by the bridge, trees fight back
  const s = battle(M, M); s.sides[0].glow = 10; place(s, { side: 0, slot: 0, x: 8, y: 13 });   // a masher mid-field
  let ev = run(s, 0.9); const m = s.ents.find((e) => e.kind === 'masher'); ok(m.y === 13, 'a bud takes a second to arrive');
  let wet = false; for (let i = 0; i < 12 * T; i++) { step(s, null); s.ev.length = 0; if (m.hp > 0 && m.y > ROYAL.RIVER0 + 0.05 && m.y < ROYAL.RIVER1 - 0.05 && Math.abs(m.x - 3.5) > ROYAL.BRIDGE_HALF + 0.01 && Math.abs(m.x - 14.5) > ROYAL.BRIDGE_HALF + 0.01) wet = true; }
  ok(!wet, 'nobody walks through the river: across a bridge or not at all');
  ok(m.hp <= 0 && tree(s, 1, 0).hp < ROYAL.TREE.hp + 1 && !s.sides[1].awake, 'a lone masher is seen off by the tree, and the home sleeps on');
}
{ // a tree falls: home wakes, deeper placing opens
  const s = battle(M, M); const t = tree(s, 1, 0); t.hp = 30; s.sides[0].glow = 10; s.sides[1].glow = 0; place(s, { side: 0, slot: 1, x: 3.5, y: 14 });
  const ev = run(s, 8);
  ok(ev.some((e) => e.k === 'down' && e.kind === 'tree') && s.sides[0].felled === 1, 'the striker runs past everything and fells the tree');
  ok(ev.some((e) => e.k === 'wake' && e.side === 1 && e.why === 'tree') && s.sides[1].awake, 'when a tree falls, the home behind it wakes up');
  ok(canPlace(s, 0, 4, 19) && !canPlace(s, 0, 14, 19) && !canPlace(s, 0, 4, 23), 'and you may place deeper, on that side only');
  const g = ev.find((e) => e.k === 'gift'); ok(g && g.side === 1 && g.n === 4, 'the side that lost the tree is given 4 Glow');
  const s9 = battle(M, M); tree(s9, 1, 0).hp = 30; s9.sides[0].glow = 10; place(s9, { side: 0, slot: 1, x: 3.5, y: 14 }); let before = null, after = null;
  for (let i = 0; i < 8 * T && after == null; i++) { s9.sides[1].glow = 8; s9.sides[1].part = 0; before = 8; step(s9, null); if (s9.ev.some((e) => e.k === 'gift')) after = s9.sides[1].glow; s9.ev.length = 0; }
  ok(after === 10, 'the gift stops at 10 Glow');
}
{ // home down ends it
  const s = battle(M, M); home(s, 1).hp = 20; tree(s, 1, 0).hp = 0; s.sides[1].awake = true; s.sides[0].glow = 10; place(s, { side: 0, slot: 1, x: 3.5, y: 14 });
  const ev = run(s, 12); ok(s.over && s.winner === 0 && s.why === 'home' && ev.some((e) => e.k === 'over'), 'knock the home down and you win at once');
}
{ // Glitch: flickers and splits
  const s = battle(); s.sides[0].glow = 10; place(s, { side: 0, slot: 1, x: 3.5, y: 8 });
  const ev = run(s, 14); ok(ev.some((e) => e.k === 'blink'), 'a Glitch flickers forward');
  ok(ev.some((e) => e.k === 'split') && ev.filter((e) => e.k === 'spawn' && e.kind === 'bit').length === 2, 'hurt to half, it splits off two little ones');
}
{ // Loudspeaker: only close up
  const s = battle(deckOf('loud', 'loud', 'loud', 'loud', 'masher', 'masher', 'masher', 'masher'), deckOf('lifter', 'lifter', 'lifter', 'lifter', 'masher', 'masher', 'masher', 'masher'));
  s.sides[0].glow = 10; s.sides[1].glow = 10; place(s, { side: 0, slot: 0, x: 9, y: 5 }); place(s, { side: 1, slot: 0, x: 9, y: 27 });
  let first = null, gap = null; for (let i = 0; i < 30 * T && first == null; i++) { step(s, null); for (const e of s.ev) if (e.k === 'boom') { first = s.tick; const a = s.ents.find((x) => x.kind === 'loud'), b = s.ents.find((x) => x.kind === 'lifter'); gap = Math.hypot(a.x - b.x, a.y - b.y) - KINDS.lifter.r; } s.ev.length = 0; }
  ok(first != null && gap <= KINDS.loud.aura + 0.01, `the loudspeaker does nothing until it's close (first blast at ${gap?.toFixed(2)} away)`);
}
{ // Chef heals, sprout fades, squirrel pinches Glow
  const s = battle(deckOf('chef', 'lifter', 'gardener', 'squirrel', 'masher', 'masher', 'masher', 'masher'));
  s.sides[0].glow = 10; place(s, { side: 0, slot: 1, x: 9, y: 8 }); place(s, { side: 0, slot: 0, x: 9, y: 6 }); run(s, 1.2);
  const l = s.ents.find((e) => e.kind === 'lifter'); l.hp = 500; const ev = run(s, 2); ok(ev.some((e) => e.k === 'heal') && l.hp > 500, 'a chef feeds a hurt friend');
  s.sides[0].glow = 10; place(s, { side: 0, slot: 2, x: 5, y: 10 }); run(s, 1.5); const sp = s.ents.find((e) => e.kind === 'sprout'); ok(!!sp, 'the gardener plants a sprout');
  run(s, 31); ok(!s.ents.some((e) => e.kind === 'sprout' && e.hp > 0), 'which wilts after 30 seconds');
  const s2 = battle(deckOf('squirrel', 'masher', 'masher', 'masher', 'masher', 'masher', 'masher', 'lifter')); s2.sides[0].glow = 3; s2.sides[1].glow = 6; tree(s2, 1, 0).hp = 99999;
  place(s2, { side: 0, slot: 0, x: 3.5, y: 14 }); let stolen = null; for (let i = 0; i < 8 * T && !stolen; i++) { const before = s2.sides[1].glow; step(s2, null); for (const e of s2.ev) if (e.k === 'steal') stolen = { n: e.n, drop: before - s2.sides[1].glow }; s2.ev.length = 0; }
  ok(stolen && stolen.n === 1 && stolen.drop >= 0, 'a squirrel that reaches a tree pinches 1 Glow');
}
{ // Gloam's beam goes through a line of buds
  const s = battle(deckOf('gloam', 'masher', 'masher', 'masher', 'masher', 'masher', 'masher', 'lifter'), deckOf('masher', 'islander', 'masher', 'islander', 'masher', 'masher', 'lifter', 'lobber'));
  s.sides[0].glow = 10; s.sides[1].glow = 10; place(s, { side: 0, slot: 0, x: 3.5, y: 6 }); place(s, { side: 1, slot: 0, x: 3.5, y: 19 }); place(s, { side: 1, slot: 2, x: 3.5, y: 19.9 });
  let hitBoth = false; for (let i = 0; i < 20 * T && !hitBoth; i++) { const hp = s.ents.filter((e) => e.side === 1 && !e.build).map((e) => [e.id, e.hp]); step(s, null); if (s.ev.some((e) => e.k === 'beam')) { const lost = hp.filter(([id, h]) => { const e = s.ents.find((x) => x.id === id); return !e || e.hp < h - 100; }).length; if (lost >= 2) hitBoth = true; } s.ev.length = 0; }
  ok(hitBoth, 'Gloam’s beam goes through everything in its line');
}
{ // the clock
  const s = battle(); s.tick = ROYAL.MATCH_S * T - 1; s.sides[0].felled = 1; step(s, null); ok(s.over && s.winner === 0 && s.why === 'trees', 'time up: more trees felled wins');
  const s2 = battle(M, M); s2.tick = ROYAL.MATCH_S * T - 1; step(s2, null); ok(!s2.over && s2.sudden && timeLeft(s2) > 59, 'level at time: sudden death, a minute more');
  tree(s2, 0, 1).hp = 1; s2.sides[1].glow = 10; place(s2, { side: 1, slot: 1, x: 14.5, y: 18 }); run(s2, 10); ok(s2.over && s2.winner === 1 && s2.why === 'sudden', 'in sudden death the first tree to fall decides it');
  const s3 = battle(); s3.tick = (ROYAL.MATCH_S + ROYAL.OVER_S) * T - 1; s3.sudden = true; tree(s3, 0, 0).hp = 700; step(s3, null); ok(s3.over && s3.winner === 1 && s3.why === 'health', 'still level: the side in better shape wins');
  const s4 = battle(); s4.tick = (ROYAL.MATCH_S + ROYAL.OVER_S) * T - 1; s4.sudden = true; step(s4, null); ok(s4.over && s4.winner === null, 'dead level: a draw');
}
{ // two phones, one battle
  const play = (order) => { const dice = { seed: 77 }, decks = deal(fillPool([]), dice), s = newBattle(999, decks), bots = [{ seed: 1 }, { seed: 2 }], pend = [], prints = [];
    while (!s.over) { const now = pend.filter((p) => p.at === s.tick).map((p) => p.c); if (order) now.reverse(); step(s, now); s.ev.length = 0; for (const side of [0, 1]) { const c = botMove(s, side, bots[side]); if (c) pend.push({ at: s.tick + ROYAL.LAND_TICKS, c }); } if (s.tick % 100 === 0) prints.push(fingerprint(s)); }
    return { prints, winner: s.winner, tick: s.tick }; };
  const a = play(false), b = play(true);
  ok(a.prints.length > 20 && JSON.stringify(a) === JSON.stringify(b), `the same seed and the same placements give the same battle, tick for tick (${a.prints.length} fingerprints match), whatever order they arrive in`);
  const src = (await import('node:fs')).readFileSync(new URL('../js/royal-rules.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/Math\.(sin|cos|tan|atan|atan2|pow|exp|log|random|hypot)\b/.test(src) && !/Date\.now|performance\./.test(src), 'the rules use no maths that could differ between phones, no clock and no Math.random');
}
console.log(fails ? `${fails} FAILED` : 'all checks passed');
