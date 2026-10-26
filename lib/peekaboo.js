// Peekaboo: battleship with buds. Each player secretly hides 3 buds on their island (a 7x7 grid trimmed to
// the island's shape), then they take turns tapping the other's island. Miss: a pebble. Hit: a bud pops out.
// The bud twist: hidden buds giggle if you miss right next to them. Once per game you can "yell" instead,
// and learn how many hidden buds are within two tiles. First to find all 3 wins (and wears a crown for a day).
// The server is the referee: where someone hid their buds is never sent to their opponent until the game ends.
import { db, refs, Timestamp } from './firebase.js';
import { GUILD_ID, SITE_URL, sendDm, linkButton, row } from './discord.js';
import { rng } from './life.js';
import { crownPatch } from './wardrobe.js';

export const N = 7, CELL = 0.225, MAX_R = 0.72, HIDERS = 3;
// tiles inside the island's circle (37 of them); positions are in units of the island radius
export const TILES = [];
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (Math.hypot((c - 3) * CELL, (r - 3) * CELL) < MAX_R) TILES.push(r * N + c);
const VALID = new Set(TILES);
const cheb = (a, b) => Math.max(Math.abs((a % N) - (b % N)), Math.abs(Math.floor(a / N) - Math.floor(b / N)));
const DM_GAP_MS = 20 * 60e3;

export const games = () => db().collection('guilds').doc(GUILD_ID).collection('games');
const other = (g, me) => g.players.find((p) => p !== me);
const plain = (s) => String(s ?? '').replace(/([\\*_~`|>#\[\]()<@:-])/g, '\\$1');

// your bud plus two friends' buds (or other buds on the island if you don't have two friends yet)
async function pickSquad(me, opponent, seed) {
  const [friendSnap, budSnap] = await Promise.all([
    refs.friends().where('members', 'array-contains', me).get(),
    db().collection('guilds').doc(GUILD_ID).collection('buds').select().get(),
  ]);
  const all = budSnap.docs.map((d) => d.id);
  const friends = friendSnap.docs.map((f) => f.get('members').find((m) => m !== me)).filter((id) => all.includes(id) && id !== opponent);
  const r = rng(seed);
  const others = all.filter((id) => id !== me && id !== opponent && !friends.includes(id)).sort(() => r() - 0.5);
  const squad = [me, ...friends.sort(() => r() - 0.5), ...others].slice(0, HIDERS);
  if (squad.length < HIDERS && all.includes(opponent)) squad.push(opponent);   // tiny island: hide their bud too!
  while (squad.length < HIDERS) squad.push(me);
  return squad;
}

async function names(ids) {
  const [users, buds] = await Promise.all([
    db().getAll(...ids.map((id) => refs.user(id)), { fieldMask: ['displayName'] }),
    db().getAll(...ids.map((id) => refs.bud(id)), { fieldMask: ['nickname', 'trueName'] }),
  ]);
  return {
    people: Object.fromEntries(users.map((u) => [u.id, (u.exists && u.get('displayName')) || 'someone'])),
    buds: Object.fromEntries(buds.map((b) => [b.id, (b.exists && (b.get('nickname') || b.get('trueName'))) || 'a bud'])),
  };
}

async function ping(game, to, text, label) {
  const at = game.dmAt?.[to] ?? 0;
  if (Date.now() - at < DM_GAP_MS) return;
  await sendDm(to, { content: text, components: [row(linkButton(label, `${SITE_URL}/world?game=${game.id}`))] });
  await games().doc(game.id).set({ dmAt: { [to]: Date.now() } }, { merge: true });
}

// What one player is allowed to see.
export function viewFor(g, me) {
  const them = other(g, me), over = g.status === 'done' || g.status === 'resigned';
  const found = (shots) => (shots || []).filter((s) => s.hit).length;
  return {
    id: g.id, me, them, status: g.status, turn: g.turn, winner: g.winner || null, tiles: TILES, n: N, cell: CELL,
    people: g.people, buds: g.budNames,
    mySquad: g.squads[me], myHides: g.hides?.[me] || [], ready: g.ready || {},
    myShots: g.shots?.[me] || [], theirShots: g.shots?.[them] || [],
    theirSquad: over ? g.squads[them] : (g.shots?.[me] || []).filter((s) => s.hit).map((s) => s.bud),
    theirHides: over ? g.hides?.[them] || [] : null,
    found: found(g.shots?.[me]), lost: found(g.shots?.[them]), hiders: HIDERS,
    yelled: !!g.yelled?.[me], challenger: g.players[0],
  };
}

export async function createGame(me, opponent) {
  if (me === opponent) throw Object.assign(new Error('you can’t play against yourself (yet)'), { status: 400 });
  const [mine, theirs, existing, friendship] = await Promise.all([
    refs.bud(me).get(), refs.bud(opponent).get(),
    games().where('players', 'array-contains', me).get(),
    refs.friend(me, opponent).get(),
  ]);
  // friends only: a challenge sends them a DM, and only people who said yes to a sticky note signed up for that
  if (!friendship.exists) throw Object.assign(new Error('you can only challenge friends'), { status: 403 });
  if (!mine.exists) throw Object.assign(new Error('make your bud first'), { status: 409 });
  if (!theirs.exists) throw Object.assign(new Error('that bud isn’t here anymore'), { status: 404 });
  const active = existing.docs.find((d) => d.get('players').includes(opponent) && ['setup', 'playing'].includes(d.get('status')));
  if (active) return { id: active.id, existing: true };
  const ref = games().doc();
  const [squadA, squadB] = await Promise.all([pickSquad(me, opponent, ref.id + me), pickSquad(opponent, me, ref.id + opponent)]);
  const label = await names([...new Set([me, opponent, ...squadA, ...squadB])]);
  const now = Timestamp.now();
  const game = {
    id: ref.id, players: [me, opponent], status: 'setup', turn: null,
    squads: { [me]: squadA, [opponent]: squadB }, hides: {}, ready: { [me]: false, [opponent]: false },
    shots: { [me]: [], [opponent]: [] }, yelled: { [me]: false, [opponent]: false },
    people: label.people, budNames: label.buds, createdAt: now, updatedAt: now, dmAt: {},
  };
  await ref.set(game);
  await ping(game, opponent, `🙈 **${plain(label.people[me])}** challenged you to **Peekaboo**! Hide 3 buds on your island, then try to find theirs.`, 'Play Peekaboo');
  return { id: ref.id };
}

export async function hide(me, id, tiles) {
  if (!Array.isArray(tiles) || tiles.length !== HIDERS || new Set(tiles).size !== HIDERS || !tiles.every((t) => VALID.has(t))) {
    throw Object.assign(new Error('pick 3 different spots on the island'), { status: 400 });
  }
  const ref = games().doc(id);
  const g = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || !snap.get('players').includes(me)) throw Object.assign(new Error('no such game'), { status: 404 });
    const game = snap.data();
    if (game.status !== 'setup' || game.ready?.[me]) throw Object.assign(new Error('your buds are already hidden'), { status: 409 });
    const ready = { ...game.ready, [me]: true }, both = Object.values(ready).every(Boolean);
    const patch = { [`hides.${me}`]: tiles, [`ready.${me}`]: true, updatedAt: Timestamp.now() };
    if (both) { patch.status = 'playing'; patch.turn = game.players[1]; }   // the one who was challenged goes first
    tx.update(ref, patch);
    return { ...game, ...(both ? { status: 'playing', turn: game.players[1] } : {}), hides: { ...game.hides, [me]: tiles }, ready };
  });
  if (g.status === 'playing') {
    const first = g.turn, them = other(g, first);
    await ping(g, first, `🙈 Everyone's hidden! You go first against **${plain(g.people[them])}** in Peekaboo.`, 'Take your turn');
  }
  return viewFor(g, me);
}

export async function shoot(me, id, tile, yell = false) {
  if (!VALID.has(tile)) throw Object.assign(new Error('that’s not on the island'), { status: 400 });
  const ref = games().doc(id);
  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || !snap.get('players').includes(me)) throw Object.assign(new Error('no such game'), { status: 404 });
    const g = snap.data();
    if (g.status !== 'playing') throw Object.assign(new Error('this game isn’t on right now'), { status: 409 });
    if (g.turn !== me) throw Object.assign(new Error('it’s not your turn'), { status: 409 });
    const them = other(g, me), theirHides = g.hides[them], mine = g.shots[me] || [];
    const foundTiles = new Set(mine.filter((s) => s.hit).map((s) => s.t));
    let shot;
    if (yell) {
      if (g.yelled?.[me]) throw Object.assign(new Error('you already yelled this game'), { status: 409 });
      const count = theirHides.filter((h) => !foundTiles.has(h) && cheb(h, tile) <= 2).length;
      shot = { t: tile, yell: count };
    } else {
      if (mine.some((s) => s.t === tile && !('yell' in s))) throw Object.assign(new Error('you already looked there'), { status: 409 });
      const idx = theirHides.indexOf(tile);
      if (idx >= 0) shot = { t: tile, hit: true, bud: g.squads[them][idx] };
      else shot = { t: tile, hit: false, giggle: theirHides.some((h) => !foundTiles.has(h) && cheb(h, tile) === 1) };
    }
    const shots = [...mine, shot], found = shots.filter((s) => s.hit).length;
    const now = Timestamp.now(), patch = { [`shots.${me}`]: shots, updatedAt: now, turn: them };
    if (yell) patch[`yelled.${me}`] = true;
    if (found >= theirHides.length) Object.assign(patch, { status: 'done', winner: me, turn: null, finishedAt: now });
    tx.update(ref, patch);
    return { g: { ...g, ...patch, shots: { ...g.shots, [me]: shots }, yelled: { ...g.yelled, ...(yell ? { [me]: true } : {}) } }, shot, them };
  });
  const { g, shot, them } = result;
  if (g.status === 'done') {
    await refs.user(me).set(crownPatch(), { merge: true });   // the crown goes into their wardrobe for good, and on right away
    await ping({ ...g, dmAt: {} }, them, `👑 **${plain(g.people[me])}** found all your hiders in Peekaboo! Rematch?`, 'See the island');
  } else {
    const what = shot.yell != null ? 'yelled across your island' : shot.hit ? `found **${plain(g.budNames[shot.bud])}**!` : 'looked and missed';
    await ping(g, them, `🎯 Your turn in Peekaboo! **${plain(g.people[me])}** ${what}`, 'Take your turn');
  }
  return { ...viewFor(g, me), last: shot };
}

export async function resign(me, id) {
  const ref = games().doc(id), snap = await ref.get();
  if (!snap.exists || !snap.get('players').includes(me)) throw Object.assign(new Error('no such game'), { status: 404 });
  const g = snap.data();
  if (!['setup', 'playing'].includes(g.status)) return viewFor(g, me);
  const patch = { status: 'resigned', winner: other(g, me), turn: null, finishedAt: Timestamp.now(), updatedAt: Timestamp.now() };
  await ref.update(patch);
  return viewFor({ ...g, ...patch }, me);
}

export async function getGame(me, id) {
  const snap = await games().doc(id).get();
  if (!snap.exists || !snap.get('players').includes(me)) throw Object.assign(new Error('no such game'), { status: 404 });
  return viewFor(snap.data(), me);
}

// my games: everything still going, plus the last few that finished
export async function myGames(me) {
  const snap = await games().where('players', 'array-contains', me).get();
  return snap.docs.map((d) => d.data())
    .sort((a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0))
    .filter((g, i) => ['setup', 'playing'].includes(g.status) || i < 5)
    .map((g) => {
      const them = other(g, me);
      return {
        id: g.id, them, theirName: g.people?.[them], theirBud: g.budNames?.[them], status: g.status, winner: g.winner || null,
        myTurn: g.status === 'playing' ? g.turn === me : g.status === 'setup' && !g.ready?.[me],
        finishedAt: g.finishedAt?.toMillis() ?? null,
      };
    });
}
