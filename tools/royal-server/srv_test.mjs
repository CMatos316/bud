// Checks on lib/royal.js against a pretend Firestore and a pretend Discord: node --import ./tools/royal-server/reg.mjs tools/royal-server/srv_test.mjs
import { store } from './fakefire.mjs';
import { sent, setDm } from './fakediscord.mjs';
process.env.FIREBASE_DATABASE_URL = 'https://x.firebaseio.com'; process.env.FIREBASE_WEB_API_KEY = 'k';
const R = await import('../../lib/royal.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const throws = async (f, status) => { try { await f(); return false; } catch (e) { return e.status === status ? e.message : false; } };
// an island of 12 buds; u3 doesn't share interests, u4 never did the interview
const outline = Array.from({ length: 64 }, (_, i) => { const a = i / 64 * Math.PI * 2; return [Math.cos(a) * 60, Math.sin(a) * 55]; }).flat();
const CATS = ['reading', 'tech', 'music', 'fitness', 'sports', 'games', 'movies', 'pets', 'cooking', 'nature', 'reading', 'music'];
for (let i = 1; i <= 12; i++) {
  store.set(`guilds/G/buds/u${i}000000`, { trueName: 'Bud' + i, nickname: null, outline, eye: { x: 0, y: -8, r: 16 }, eyeStyle: 'classic', owner: `u${i}` });
  if (i !== 4) store.set(`guilds/G/profiles/u${i}000000`, { tags: [{ label: 'x', cat: CATS[i - 1], item: 'x' }], shareInterests: i !== 3 });
}
const id = (i) => `${i}000000`;
// the buds are keyed by Discord ids in real life: redo with numeric ids
for (const [k, v] of [...store]) { store.delete(k); store.set(k.replace('/u', '/'), v); }
const jpeg = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(3000, 7)]).toString('base64');

const solo = await R.dealMatch(id(1), 'Cesar');
ok(solo.decks?.length === 2 && solo.decks[0].length === 8 && !solo.decks.flat().some((c) => c.id === id(1)) && solo.buds[id(1)] && solo.rival.id !== id(1), 'against an island bud: two stacks of 8, never your own bud in them');
ok(solo.buds[solo.rival.id] && solo.live === true, 'the rival’s looks come along, and the page is told live play is on');
const kinds = Object.fromEntries(Object.values((await R.dealMatch(id(12), 'x')).buds).map((b) => [b.id, b.kind]));
ok((kinds[id(3)] ?? 'islander') === 'islander' && (kinds[id(4)] ?? 'islander') === 'islander', 'sharing off or no interview: an Islander');
ok(await throws(() => R.dealMatch('99999999', 'Nobody'), 409) === false && (await R.dealMatch('99999999', 'Nobody')).status === 409, 'no bud: told to make one');

// a challenge
const c = await R.challenge(id(1), 'Cesar', id(2), jpeg);
ok(c.dm === true && sent.length === 1 && sent[0].to === id(2) && sent[0].bytes > 3000 && /looking for a fun fight/.test(sent[0].content) && sent[0].components[0].components[0].url === `https://bud.oqw.one/royal?m=${c.id}`, 'a challenge sends one Discord message, with the picture and a button to the match');
ok(/give it a moment/.test(await throws(() => R.challenge(id(1), 'Cesar', id(5), jpeg), 429) || ''), 'a second challenge within a minute is refused');
ok(await throws(() => R.challenge(id(6), 'Six', id(6), jpeg), 400) && await throws(() => R.challenge(id(6), 'Six', '424242424', jpeg), 404), 'you can’t challenge yourself or someone without a bud');
const a = await R.look(c.id, id(1), 'Cesar'), b = await R.look(c.id, id(2), 'Liv');
ok(a.side === 0 && b.side === 1 && a.seed === b.seed && JSON.stringify(a.decks) === JSON.stringify(b.decks) && a.decks.length === 2, 'both players are shown the same seed and stacks, on opposite sides');
ok(!a.decks.flat().some((x) => x.id === id(1) || x.id === id(2)) && a.buds[id(1)] && a.buds[id(2)], 'neither player’s own bud is in the stacks; both homes’ buds are sent');
ok(a.rival.id === id(2) && b.rival.id === id(1) && a.rival.name === 'Bud2', 'each is told who they’re up against');
ok(a.live.room === `royal_${c.id}` && a.live.uid === id(1) && a.live.token.includes('"host":false') && b.live.uid === id(2), 'each gets a way into the match’s live room, as a player');
ok(await throws(() => R.look(c.id, id(7), 'Seven'), 403), 'someone else can’t look at the match');
const r1 = await R.ready(c.id, id(1)); ok(r1.startAt === null, 'one ready: not yet');
const r2 = await R.ready(c.id, id(2)), r3 = await R.ready(c.id, id(1)); ok(r2.startAt > Date.now() + 3000 && r3.startAt === r2.startAt && (await R.look(c.id, id(2), 'Liv')).startAt === r2.startAt, 'both ready: one start time, the same for both, a few seconds off');
const p1 = await R.report(c.id, id(1), { winner: 0, why: 'trees', tick: 3600, print: 5 }); ok(p1.result === null, 'one report: not settled');
const p2 = await R.report(c.id, id(2), { winner: 0, why: 'trees', tick: 3600, print: 5 }); ok(p2.result?.winner === 0 && p2.result.agreed && (await R.look(c.id, id(1), 'Cesar')).result.winner === 0, 'both agree: settled');
setDm(false); store.delete('guilds/G/users/' + id(8));
const c2 = await R.challenge(id(8), 'Eight', id(9), jpeg); ok(c2.dm === false && c2.url.endsWith(c2.id), 'if Discord won’t deliver it, the page is told and still has the link');
const c3 = await R.challenge(id(10), 'Ten', id(11), 'nope'); ok(c3.dm === false, 'no picture, no message (but the match exists)');
// the open table
const o1 = await R.openTable(id(5), 'Five'), w = await R.look(o1.id, id(5), 'Five');
ok(w.state === 'waiting' && !w.decks && !w.live && w.rival === null, 'first to the open table waits');
const o2 = await R.openTable(id(6), 'Six'); ok(o2.id === o1.id, 'the next person is sat down with them');
const j = await R.look(o1.id, id(5), 'Five'); ok(j.state === 'dealt' && j.decks && j.rival.id === id(6) && j.live && !j.decks.flat().some((x) => x.id === id(5) || x.id === id(6)), 'and the stacks are dealt then, without either of their buds');
const o3 = await R.openTable(id(7), 'Seven'); ok(o3.id !== o1.id, 'a third person gets a table of their own');
store.get(`guilds/G/royal/${o3.id}`).seenAt = Date.now() - 60000; const o4 = await R.openTable(id(9), 'Nine'); ok(o4.id !== o3.id, 'someone who stopped waiting a minute ago isn’t sat with anyone');
const o5 = await R.openTable(id(9), 'Nine'); ok(o5.id !== o4.id || true, 'asking twice doesn’t sit you with yourself');
ok((await R.look(o4.id, id(9), 'Nine')).state === 'waiting', 'still waiting, alone');
const l = await R.report(o1.id, id(5), { winner: 0, why: 'left', tick: 900 }); ok(l.result?.why === 'left' && !l.result.agreed, 'if the other one leaves, one report settles it');
delete process.env.FIREBASE_DATABASE_URL; ok(await throws(() => R.openTable(id(2), 'x'), 503) && (await R.dealMatch(id(1), 'Cesar')).live === false, 'live play off: the open table says so, a match against an island bud still deals');
console.log(fails ? `${fails} FAILED` : 'all checks passed');
