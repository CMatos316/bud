// Bud-a-pult, the two-player game: played over time between friends, like Peekaboo.
// 1. Both of you build a fort around your bud (you don't see theirs until both are done).
// 2. Round 1: the player who started flings their bud at the other's fort, up to 3 launches. Between launches
//    the defender can patch up (clear pieces, move their bud, add 2 pieces).
// 3. Round 2: swap. 4. Whoever did better wins: a knockout beats none; two knockouts, fewer launches wins;
//    no knockouts, more dizziness dealt wins. The winner's bud gets a little helmet.
// The physics runs here (lib/catapult.js), so both players see the same shots. A DM when it's your turn.
// Games: guilds/{guild}/catapults/{id}.
import { db, refs, Timestamp } from './firebase.js';
import { GUILD_ID, SITE_URL, sendDm, linkButton, row } from './discord.js';
import { budForWorld } from './bud.js';
import * as pult from './catapult.js';

const LAUNCHES = 3, DM_GAP_MS = 20 * 60e3;
export const games = () => db().collection('guilds').doc(GUILD_ID).collection('catapults');
const err = (message, status) => Object.assign(new Error(message), { status });
const other = (g, me) => g.players.find((p) => p !== me);
const plain = (s) => String(s ?? '').replace(/([\\*_~`|>#\[\]()<@:-])/g, '\\$1');
const now = () => Timestamp.now();

// who attacks in each round: the starter first, then the other player
const attackerOf = (g, round) => g.players[round === 1 ? 0 : 1];
const defenderOf = (g, round) => g.players[round === 1 ? 1 : 0];

// What one player is allowed to see. Their fort stays hidden until both are built.
export function viewFor(g, me) {
  const them = other(g, me), both = !!(g.forts?.[me] && g.forts?.[them]);
  const v = {
    id: g.id, me, them, players: g.players, people: g.people, budNames: g.budNames,
    stage: g.stage, turn: g.turn, myTurn: g.turn === me, round: g.round,
    attacker: g.stage === 'build' || g.stage === 'done' ? null : attackerOf(g, g.round),
    launches: g.launches || 0, maxLaunches: LAUNCHES,
    built: { [me]: !!g.forts?.[me], [them]: !!g.forts?.[them] },
    forts: { [me]: g.forts?.[me]?.state || null, [them]: both ? g.forts[them].state : null },
    results: g.results || {}, winner: g.winner || null,
    shot: g.lastShot ? { n: g.lastShot.n, round: g.lastShot.round, by: g.lastShot.by, data: g.lastShot.json } : null,
  };
  return v;
}

async function budsFor(ids) {
  const docs = await db().getAll(...ids.map((id) => refs.bud(id)), { fieldMask: ['outline', 'eye', 'eyeStyle', 'paintSmallJpeg', 'paintJpeg', 'nickname', 'trueName', 'position'] });
  return Object.fromEntries(docs.filter((d) => d.exists).map((d) => [d.id, budForWorld(d.id, d.data(), null, false)]));
}

async function ping(g, to, text, label = 'Go to Bud-a-pult') {
  if (Date.now() - (g.dmAt?.[to] ?? 0) < DM_GAP_MS) return;
  try {
    await sendDm(to, { content: text, components: [row(linkButton(label, `${SITE_URL}/catapult?id=${g.id}`))] });
    await games().doc(g.id).set({ dmAt: { [to]: Date.now() } }, { merge: true });
  } catch (e) { console.warn('bud-a-pult DM failed:', e.message); }
}

export async function createGame(me, opponent) {
  if (me === opponent) throw err('you need a friend to fling at!', 400);
  const [mine, theirs, friendship, existing] = await Promise.all([
    refs.bud(me).get(), refs.bud(opponent).get(), refs.friend(me, opponent).get(),
    games().where('players', 'array-contains', me).get(),
  ]);
  if (!friendship.exists) throw err('you can only play Bud-a-pult with friends', 403);
  if (!mine.exists) throw err('make your bud first', 409);
  if (!theirs.exists) throw err('that bud isn’t here anymore', 404);
  const active = existing.docs.find((d) => d.get('stage') !== 'done' && d.get('players').includes(opponent));
  if (active) return { id: active.id, existing: true };
  const [u1, u2] = await Promise.all([refs.user(me).get(), refs.user(opponent).get()]);
  const ref = games().doc();
  const g = {
    id: ref.id, players: [me, opponent],
    people: { [me]: (u1.exists && u1.get('displayName')) || 'someone', [opponent]: (u2.exists && u2.get('displayName')) || 'someone' },
    budNames: { [me]: mine.get('nickname') || mine.get('trueName'), [opponent]: theirs.get('nickname') || theirs.get('trueName') },
    stage: 'build', turn: null, round: 1, launches: 0, forts: {}, results: {}, winner: null, lastShot: null, shots: 0,
    dmAt: {}, createdAt: now(), updatedAt: now(),
  };
  await ref.set(g);
  await ping(g, opponent, `🎯 **${plain(g.people[me])}** challenged you to **Bud-a-pult**! Build a fort around ${plain(g.budNames[opponent])}, then take turns flinging your buds at each other’s forts.`, 'Build your fort');
  return { id: ref.id };
}

async function load(tx, ref, me) {
  const snap = await tx.get(ref);
  if (!snap.exists || !snap.get('players').includes(me)) throw err('no such game', 404);
  return snap.data();
}
function startRound(g, round) {
  return { ...g, stage: 'launch', round, launches: 0, turn: attackerOf(g, round) };
}

// Your fort: the same grid and pieces as the test range.
export async function build(me, id, pieces, bud) {
  const state = pult.settle(pult.placeBuild(pult.checkBuild(pieces, bud)));   // throws if the bud won't stay put
  const ref = games().doc(id);
  const g = await db().runTransaction(async (tx) => {
    const g = await load(tx, ref, me);
    if (g.stage !== 'build') throw err('the forts are already built', 409);
    if (g.forts?.[me]) throw err('you already built your fort', 409);
    let next = { ...g, forts: { ...g.forts, [me]: { start: state, state } }, updatedAt: now() };
    if (next.forts[other(g, me)]) next = startRound(next, 1);
    tx.set(ref, next);
    return next;
  });
  if (g.stage === 'launch') {
    const a = g.turn;
    await ping(g, a, `🎯 Both forts are built in **Bud-a-pult** with **${plain(g.people[other(g, a)])}**. You go first: fling ${plain(g.budNames[a])}!`, 'Fling!');
  }
  return viewFor(g, me);
}

// A launch at the other fort. Returns the shot to replay.
export async function shoot(me, id, angle, power) {
  const ref = games().doc(id);
  const g = await db().runTransaction(async (tx) => {
    const g = await load(tx, ref, me);
    if (g.stage !== 'launch' || g.turn !== me) throw err('it’s not your turn to fling', 409);
    const def = defenderOf(g, g.round), state = g.forts[def].state;
    const r = pult.shoot(state, angle, power);
    const launches = (g.launches || 0) + 1, { after, ...replay } = r;
    let next = {
      ...g, launches, forts: { ...g.forts, [def]: { ...g.forts[def], state: after } },
      shots: (g.shots || 0) + 1, updatedAt: now(),
    };
    next.lastShot = { n: next.shots, round: g.round, by: me, json: JSON.stringify(replay) };
    if (r.ko || launches >= LAUNCHES) {
      next.results = { ...g.results, [g.round]: { attacker: me, ko: r.ko ? r.ko.how : null, launches, dizzy: Math.round(after.dizzy || 0) } };
      if (g.round === 1) next = startRound(next, 2);
      else next = finish(next);
    } else {
      next.stage = 'patch'; next.turn = def;
    }
    tx.set(ref, next);
    return next;
  });
  await notify(g, me);
  return viewFor(g, me);
}

// The defender patches up between launches (or skips).
export async function patch(me, id, changes) {
  const ref = games().doc(id);
  const g = await db().runTransaction(async (tx) => {
    const g = await load(tx, ref, me);
    if (g.stage !== 'patch' || g.turn !== me) throw err('it’s not your turn to patch up', 409);
    const state = changes ? pult.repair(g.forts[me].state, changes) : g.forts[me].state;
    const next = { ...g, forts: { ...g.forts, [me]: { ...g.forts[me], state } }, stage: 'launch', turn: attackerOf(g, g.round), updatedAt: now() };
    tx.set(ref, next);
    return next;
  });
  await ping(g, g.turn, `🎯 **${plain(g.people[me])}** patched up their fort in **Bud-a-pult**. Launch ${g.launches + 1} of ${LAUNCHES} is yours!`, 'Fling!');
  return viewFor(g, me);
}

// Who did better as the attacker: a knockout beats none, then fewer launches, then more dizziness.
function better(a, b) {
  if (!!a.ko !== !!b.ko) return a.ko ? 1 : -1;
  if (a.ko) return a.launches === b.launches ? 0 : a.launches < b.launches ? 1 : -1;
  return a.dizzy === b.dizzy ? 0 : a.dizzy > b.dizzy ? 1 : -1;
}
function finish(g) {
  const r1 = g.results[1], r2 = g.results[2], c = better(r1, r2);
  return { ...g, stage: 'done', turn: null, winner: c === 0 ? 'tie' : c > 0 ? r1.attacker : r2.attacker, finishedAt: now() };
}
async function prize(g) {
  if (!g.winner || g.winner === 'tie') return;
  await refs.user(g.winner).set({ wardrobe: { items: { helmet: { from: 'bud-a-pult', at: Date.now() } } } }, { merge: true });
}

async function notify(g, me) {
  const them = other(g, me), last = g.results?.[g.round === 2 && g.stage === 'launch' && g.launches === 0 ? 1 : g.round];
  if (g.stage === 'patch') {
    await ping(g, them, `🎯 **${plain(g.people[me])}** just flung ${plain(g.budNames[me])} at your fort in **Bud-a-pult**! Watch what happened, then patch it up.`, 'Watch and patch up');
  } else if (g.stage === 'launch' && g.round === 2 && g.launches === 0) {
    const how = last?.ko ? `knocked out ${plain(g.budNames[them])}` : `couldn’t knock out ${plain(g.budNames[them])}`;
    await ping(g, them, `🎯 Round 1 of **Bud-a-pult** is over: **${plain(g.people[me])}** ${how}. Your turn to fling ${plain(g.budNames[them])} at their fort!`, 'Fling!');
  } else if (g.stage === 'done') {
    await prize(g).catch((e) => console.error('bud-a-pult prize failed:', e));
    for (const p of g.players) {
      const won = g.winner === p, tie = g.winner === 'tie';
      await ping({ ...g, dmAt: {} }, p, `🎯 **Bud-a-pult** with **${plain(g.people[other(g, p)])}** is over: ${tie ? 'it’s a tie!' : won ? `you win! ${plain(g.budNames[p])} gets a helmet 🪖` : `${plain(g.people[other(g, p)])} wins this one.`}`, 'See how it went');
    }
  }
}

export async function resign(me, id) {
  const ref = games().doc(id);
  const g = await db().runTransaction(async (tx) => {
    const g = await load(tx, ref, me);
    if (g.stage === 'done') throw err('this game is already over', 409);
    const next = { ...g, stage: 'done', turn: null, winner: other(g, me), resigned: me, finishedAt: now(), updatedAt: now() };
    tx.set(ref, next);
    return next;
  });
  await prize(g).catch(() => {});
  return viewFor(g, me);
}

export async function getGame(me, id) {
  const snap = await games().doc(id).get();
  if (!snap.exists || !snap.get('players').includes(me)) throw err('no such game', 404);
  const g = snap.data();
  return { ...viewFor(g, me), buds: await budsFor(g.players) };
}
// for the island: games still going and whether it's your move
export async function myGames(me) {
  const snap = await games().where('players', 'array-contains', me).select('players', 'turn', 'stage', 'forts').get();
  return snap.docs.filter((d) => d.get('stage') !== 'done').map((d) => {
    const g = d.data(), myMove = g.stage === 'build' ? !g.forts?.[me] : g.turn === me;
    return { id: d.id, them: g.players.find((p) => p !== me), myTurn: myMove, stage: g.stage };
  });
}
