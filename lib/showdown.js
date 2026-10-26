// Question Showdown: a quick live game for a group on a call. Bud asks a "would you rather", everyone picks
// at the same time, then all the signs flip up together and you see who matched. Eight rounds, then the
// best-matched pairs. Rooms run on the server's clock and are advanced by whoever checks in next, so there's
// no always-on server: each player's page checks in about once a second.
// Rooms: guilds/{guild}/showdowns/{room}. A room from Discord's Activity uses the activity's instance ID,
// so everyone in that voice call lands in the same room; a link room gets a random ID.
import { db, refs, Timestamp } from './firebase.js';
import { GUILD_ID } from './discord.js';
import { budForWorld } from './bud.js';
import { rng } from './life.js';

export const PICK_MS = 10000, REVEAL_MS = 6000, READY_MS = 3500, ROUNDS = 8, MAX_PLAYERS = 12;
const AWAY_MS = 20000;       // no check-in for this long: not waiting for them
const SEEN_EVERY_MS = 8000;  // how often a check-in refreshes "still here" (keeps database writes down)
export const rooms = () => db().collection('guilds').doc(GUILD_ID).collection('showdowns');
const err = (message, status) => Object.assign(new Error(message), { status });

// would you rather…? two short answers each, painted on a sign
const W = (a, b) => [a, b];
export const QUESTIONS = [
  W('🐉 ride a dragon', '🐋 ride a whale'),
  W('🌋 live on a volcano', '🧊 live on a glacier'),
  W('🍕 only eat pizza', '🌮 only eat tacos'),
  W('🦖 have a tiny dinosaur', '🐘 have a huge hamster'),
  W('⏪ go back in time', '⏩ see the future'),
  W('🔮 read minds', '👻 be invisible'),
  W('🌙 always night', '☀️ always day'),
  W('🎤 sing everything', '💃 dance everywhere'),
  W('🐸 talk to animals', '🌍 speak every language'),
  W('🏰 live in a castle', '🌳 live in a treehouse'),
  W('🍩 donuts forever', '🍪 cookies forever'),
  W('🐌 move like a snail', '🐇 talk super fast'),
  W('🚀 visit space', '🌊 explore the deep sea'),
  W('🧦 wet socks', '🥶 cold toast'),
  W('🎮 one game forever', '📺 one show forever'),
  W('😂 laugh at bad times', '😭 cry at good times'),
  W('🦄 a unicorn', '🐉 a small dragon'),
  W('☔ always rain', '🔥 always too hot'),
  W('📚 know everything', '🎨 make anything'),
  W('🐱 be a cat', '🐶 be a dog'),
  W('🍦 ice cream for dinner', '🥞 pancakes for every meal'),
  W('🤖 robot best friend', '👽 alien best friend'),
  W('🏝️ stuck on an island', '🏔️ stuck on a mountain'),
  W('🕺 ugly dancing', '🎤 bad karaoke'),
  W('⚡ super speed', '🕊️ flying'),
  W('🐙 eight arms', '👀 eyes on your back'),
  W('🎂 birthday every month', '🎁 christmas every month'),
  W('🍿 always hungry', '😴 always sleepy'),
  W('🧙 be a wizard', '🦸 be a superhero'),
  W('📱 no phone a week', '🍫 no sweets a month'),
  W('🌈 hair changes with mood', '🎵 theme music follows you'),
  W('🐝 a bee army', '🐿️ a squirrel army'),
  W('🏃 always 10 min late', '⏰ always 1 hour early'),
  W('🥒 pickle-flavored everything', '🧄 garlic-flavored everything'),
  W('🎢 roller coaster commute', '🛶 canoe commute'),
  W('🗣️ say every thought', '🤐 never speak again'),
  W('🦆 fight 1 horse-sized duck', '🐴 fight 100 duck-sized horses'),
  W('🧸 be a toy for a day', '🐠 be a fish for a day'),
  W('🍝 spaghetti hair', '🥦 broccoli fingers'),
  W('🌌 see every star', '🌅 see every sunset'),
  W('🎈 float when happy', '❄️ snow when sad'),
  W('🛸 meet aliens', '🦕 meet dinosaurs'),
  W('🔊 sneeze super loud', '🐢 laugh super slow'),
  W('🎒 pockets that never fill', '🧃 a juice box that never empties'),
  W('🏆 win every game', '🤝 everyone always has fun'),
  W('🐧 live with penguins', '🐼 live with pandas'),
  W('🧩 solve any puzzle', '🗺️ never get lost'),
  W('🎨 every wall a mural', '🌸 every floor a garden'),
];

const shuffle = (list, seed) => { const r = rng(seed), a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const roundEnd = (g) => g.closedAt ?? g.roundAt + PICK_MS;
const activeIds = (g, now) => Object.entries(g.players || {}).filter(([, p]) => now - (p.lastSeen || 0) < AWAY_MS).map(([id]) => id);

// Move the game along to where the clock says it should be. Returns the fields that changed, or null.
function advance(g, now) {
  if (g.phase !== 'play') return null;
  const patch = {};
  let round = g.round, roundAt = g.roundAt, closedAt = g.closedAt ?? null, phase = g.phase, steps = 0;
  while (phase === 'play' && now >= (closedAt ?? roundAt + PICK_MS) + REVEAL_MS && steps++ < ROUNDS + 2) {
    const next = (closedAt ?? roundAt + PICK_MS) + REVEAL_MS;
    if (round + 1 >= ROUNDS) { phase = 'done'; patch.finishedAt = next; break; }
    round += 1; roundAt = next; closedAt = null;
  }
  // everyone who's here has picked: reveal now instead of waiting out the clock
  if (phase === 'play' && closedAt == null && now >= roundAt && now < roundAt + PICK_MS) {
    const here = activeIds(g, now), picks = g.answers?.[round] || {};
    if (here.length && here.every((id) => id in picks)) closedAt = now;
  }
  if (round !== g.round) patch.round = round;
  if (roundAt !== g.roundAt) patch.roundAt = roundAt;
  if ((closedAt ?? null) !== (g.closedAt ?? null)) patch.closedAt = closedAt;
  if (phase !== g.phase) patch.phase = phase;
  return Object.keys(patch).length ? patch : null;
}

// how in sync everyone was: every pair, how often they picked the same
export function summary(g) {
  const ids = Object.keys(g.players || {}), pairs = [], solo = Object.fromEntries(ids.map((id) => [id, 0]));
  let together = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const picks = g.answers?.[r] || {}, who = Object.keys(picks);
    if (who.length >= 2 && who.every((id) => picks[id] === picks[who[0]])) together++;
    for (const id of who) if (who.filter((o) => picks[o] === picks[id]).length === 1 && who.length >= 3) solo[id]++;
  }
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    let both = 0, same = 0;
    for (let r = 0; r < ROUNDS; r++) {
      const p = g.answers?.[r] || {};
      if (ids[i] in p && ids[j] in p) { both++; if (p[ids[i]] === p[ids[j]]) same++; }
    }
    if (both) pairs.push({ a: ids[i], b: ids[j], same, both });
  }
  pairs.sort((x, y) => y.same / y.both - x.same / x.both || y.both - x.both);
  const loneWolf = Object.entries(solo).sort((x, y) => y[1] - x[1])[0];
  return { pairs, together, loneWolf: loneWolf && loneWolf[1] >= 2 ? { id: loneWolf[0], rounds: loneWolf[1] } : null };
}

function viewFor(g, me, now) {
  const round = g.round, q = g.phase === 'lobby' ? null : QUESTIONS[g.qs[(g.offset + round) % g.qs.length]];
  const stage = g.phase !== 'play' ? g.phase : now < g.roundAt ? 'ready' : now < roundEnd(g) ? 'pick' : 'reveal';
  const picks = g.answers?.[round] || {};
  const players = Object.entries(g.players || {}).map(([id, p]) => ({ id, name: p.name, here: now - (p.lastSeen || 0) < AWAY_MS, joinedAt: p.joinedAt }))
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const view = {
    id: g.id, me, host: g.host, phase: g.phase, stage, round, rounds: ROUNDS, now,
    roundAt: g.roundAt ?? null, pickEnds: g.phase === 'play' ? roundEnd(g) : null, revealEnds: g.phase === 'play' ? roundEnd(g) + REVEAL_MS : null,
    question: q, players, mine: me in picks ? picks[me] : null,
    // while picking you only see who has locked in; what they picked shows when the signs flip
    locked: Object.keys(picks),
    picks: stage === 'reveal' || stage === 'done' ? picks : null,
    game: g.game || 1,
  };
  if (g.phase === 'done') view.summary = summary(g);
  return view;
}

async function touch(id, me, name, create) {
  const ref = rooms().doc(id), now = Date.now();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let g = snap.exists ? snap.data() : null;
    if (!g) {
      if (!create) throw err('that game isn’t around anymore', 404);
      g = { id, host: me, phase: 'lobby', round: 0, roundAt: null, closedAt: null, players: {}, playerIds: [], answers: {},
        qs: shuffle(QUESTIONS.map((_, i) => i), id), offset: 0, game: 1, createdAt: Timestamp.now() };
    }
    const patch = {}, p = g.players?.[me];
    if (!p) {
      if (Object.keys(g.players || {}).length >= MAX_PLAYERS) throw err('this game is full', 409);
      patch[`players.${me}`] = { name, joinedAt: now, lastSeen: now };
      patch.playerIds = [...new Set([...(g.playerIds || []), me])];
      g.players = { ...g.players, [me]: patch[`players.${me}`] };
    } else if (now - (p.lastSeen || 0) > SEEN_EVERY_MS) {
      patch[`players.${me}.lastSeen`] = now; p.lastSeen = now;
    }
    const moved = advance(g, now);
    if (moved) { Object.assign(patch, moved); Object.assign(g, moved); }
    if (!snap.exists) tx.set(ref, { ...g, players: g.players, playerIds: patch.playerIds || [me] });
    else if (Object.keys(patch).length) tx.update(ref, patch);
    return viewFor(g, me, now);
  });
}

export const newRoomId = () => rooms().doc().id.slice(0, 12);
export const joinRoom = (id, me, name) => touch(id, me, name, true);
export const checkIn = (id, me, name) => touch(id, me, name, false);

export async function startGame(id, me) {
  const ref = rooms().doc(id), now = Date.now();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || !snap.get(`players.${me}`)) throw err('join the game first', 404);
    const g = snap.data();
    if (g.phase === 'play') return viewFor(g, me, now);
    if (activeIds(g, now).length < 2) throw err('you need at least one more player', 409);
    const again = g.phase === 'done';
    const patch = { phase: 'play', round: 0, roundAt: now + READY_MS, closedAt: null, answers: {}, finishedAt: null,
      offset: again ? (g.offset + ROUNDS) % g.qs.length : g.offset, game: again ? (g.game || 1) + 1 : g.game || 1 };
    tx.update(ref, patch);
    return viewFor({ ...g, ...patch }, me, now);
  });
}

export async function pick(id, me, choice) {
  if (choice !== 0 && choice !== 1) throw err('pick one of the two', 400);
  const ref = rooms().doc(id), now = Date.now();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || !snap.get(`players.${me}`)) throw err('join the game first', 404);
    const g = snap.data();
    const moved = advance(g, now);
    if (moved) Object.assign(g, moved);
    if (g.phase !== 'play' || now < g.roundAt || now >= roundEnd(g)) {
      if (moved) tx.update(ref, moved);
      throw err('too late for this one!', 409);
    }
    g.answers = { ...g.answers, [g.round]: { ...(g.answers?.[g.round] || {}), [me]: choice } };
    g.players[me].lastSeen = now;
    const patch = { ...(moved || {}), [`answers.${g.round}.${me}`]: choice, [`players.${me}.lastSeen`]: now };
    const after = advance(g, now);   // last one in? reveal right away
    if (after) { Object.assign(patch, after); Object.assign(g, after); }
    tx.update(ref, patch);
    return viewFor(g, me, now);
  });
}

// the buds of everyone in the room, for drawing them (fetched once per new player, not every check-in)
export async function budsFor(ids) {
  ids = ids.slice(0, MAX_PLAYERS);
  if (!ids.length) return {};
  const snaps = await db().getAll(...ids.map((id) => refs.bud(id)), { fieldMask: ['trueName', 'nickname', 'outline', 'eye', 'eyeStyle', 'paintSmallJpeg', 'paintJpeg'] });
  const out = {};
  for (const s of snaps) if (s.exists) {
    const d = s.data(); d.paintJpeg = d.paintSmallJpeg ? null : d.paintJpeg;
    out[s.id] = budForWorld(s.id, d, null, false);
  }
  return out;
}
