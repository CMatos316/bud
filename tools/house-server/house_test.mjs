// Checks on lib/house.js and the keeper's shelf (lib/away.js) against the pretend Firestore in tools/royal-server:
//   node --import ./tools/royal-server/reg.mjs tools/house-server/house_test.mjs
import { store } from '../royal-server/fakefire.mjs';
const H = await import('../../lib/house.js'), A = await import('../../lib/away.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const throws = async (f, status) => { try { await f(); return false; } catch (e) { return e.status === status ? e.message : false; } };
const outline = Array.from({ length: 64 }, (_, i) => { const a = i / 64 * Math.PI * 2; return [Math.cos(a) * 60, Math.sin(a) * 55]; }).flat();
const id = (i) => `${i}000000`, bud = (i, name) => store.set(`guilds/G/buds/${id(i)}`, { trueName: name, nickname: null, outline, eye: { x: 0, y: -8, r: 16 }, eyeStyle: 'classic' });
bud(1, 'Mochi'); bud(2, 'Taro'); bud(3, 'Kelp');
const doodle = (did, from, to, kept = true) => store.set(`guilds/G/doodleMail/${did}`, { id: did, from: id(from), to: id(to), fromName: 'F' + from, fromBud: 'Bud' + from, caption: 'hi ' + did, thumb: 'data:image/jpeg;base64,xx', toKept: kept, fromKept: true, createdAt: { toMillis: () => 1000 } });
doodle('doodle01', 2, 1); doodle('doodle02', 3, 1); doodle('doodle03', 2, 1, false); doodle('doodle04', 1, 2);
store.set(`guilds/G/users/${id(1)}`, { away: { finds: { shell: 2, feather: 1 }, fond: 0, recent: ['shell', 'feather'] } });

let v = await H.houseView(id(1), id(1));
ok(v.mine && v.walls.length === 6 && v.shelves.length === 6 && v.walls.every((w) => w === null) && v.shelves.every((s) => s === null), 'a new home: six empty frames, six empty shelf spots');
ok(v.have.doodles.length === 2 && v.have.finds.shell === 2 && v.owner.name === 'Mochi' && v.you.id === id(1), 'the owner is shown what they could hang (kept doodles they were sent) and set out (their finds)');
v = await H.houseSet(id(1), { walls: ['doodle01', null, 'doodle02'], shelves: ['shell', 'shell', null, 'feather'] });
ok(v.walls[0].id === 'doodle01' && v.walls[0].from === 'Bud2' && v.walls[1] === null && v.walls[2].id === 'doodle02' && v.shelves.join() === 'shell,shell,,feather,,', 'hanging and setting out saves, spot by spot');
ok(await throws(() => H.houseSet(id(1), { walls: ['doodle04'], shelves: [] }), 403), 'you can’t hang a doodle that was sent to someone else');
ok(await throws(() => H.houseSet(id(1), { walls: ['doodle03'], shelves: [] }), 403), 'or one you threw away');
ok(await throws(() => H.houseSet(id(1), { walls: ['doodle01', 'doodle01'], shelves: [] }), 400), 'or the same doodle twice');
ok(/another/.test(await throws(() => H.houseSet(id(1), { walls: [], shelves: ['feather', 'feather'] }), 403) || ''), 'you can’t set out more of a find than you have');
ok(await throws(() => H.houseSet(id(1), { walls: [], shelves: ['crown'] }), 400), 'or something that isn’t a find');
const seen = await H.houseView(id(1), id(2));
ok(!seen.mine && !seen.have && seen.walls[0].id === 'doodle01' && seen.walls[0].thumb.startsWith('data:image/png;base64,') && seen.shelves[0] === 'shell' && seen.you.name === 'Taro' && seen.owner.name === 'Mochi', 'a visitor sees the walls and shelves, and nothing of what else the owner has');
store.get('guilds/G/doodleMail/doodle01').toKept = false;
ok((await H.houseView(id(1), id(2))).walls[0] === null && (await H.houseView(id(1), id(1))).walls[0] === null, 'a doodle the owner later throws away leaves its frame empty');
ok(await throws(() => H.houseView('424242424', id(1)), 404) && await throws(() => H.houseView('nope', id(1)), 404), 'no home for someone without a bud');
ok((await H.houseView(id(3), id(1))).walls.every((w) => w === null), 'someone who’s never arranged anything has an empty home you can still visit');

// the keeper's shelf
let r = await A.awayAct(id(1), { do: 'shelf', kind: 'shell' });
ok(r.shelf.length === 1 && r.shelf[0].kind === 'shell' && r.shelf[0].bud === 'Mochi' && r.away.finds.shell === 1 && r.away.fond === 1 && r.warmed && r.away.given === 1 && r.away.gaveToday, 'a find left on the keeper’s shelf leaves your pile, shows with your bud’s name, and warms it to you');
r = await A.awayAct(id(1), { do: 'shelf', kind: 'shell' });
ok(r.shelf.length === 2 && !r.away.finds.shell && r.away.fond === 1 && !r.warmed && !r.away.recent.includes('shell'), 'a second the same day goes on the shelf but doesn’t warm it twice; your last one comes off your porch');
r = await A.awayAct(id(1), { do: 'shelf', kind: 'shell' }); ok(r.status === 409, 'you can’t leave what you don’t have');
ok((await A.awayAct(id(1), { do: 'shelf', kind: 'crown' })).status === 400, 'only finds go on the shelf');
ok((await A.gloamShelf()).length === 2 && (await H.houseView(id(1), id(1))).shelves.join() === ',,,feather,,', 'everyone sees the keeper’s shelf; the shells you gave away come off your own');
store.set(`guilds/G/users/${id(2)}`, { away: { finds: { acorn: 30 } } });
for (let i = 0; i < 20; i++) await A.awayAct(id(2), { do: 'shelf', kind: 'acorn' });
const sh = await A.gloamShelf(); ok(sh.length === A.SHELF_MAX && sh[0].bud === 'Taro' && !sh.some((i) => i.bud === 'Mochi'), 'the shelf keeps the newest eighteen');
console.log(fails ? `${fails} FAILED` : 'all checks passed');
