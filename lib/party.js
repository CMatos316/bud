// Party night: everyone in one room, the island on a TV (a laptop plugged in) and every phone a controller.
// The TV opens /tv and gets a four-letter code. Phones open /join and type it, or scan the code on the TV.
// The code stays the same all night while the TV moves from game to game, and every phone follows along.
//   guilds/{guild}/parties/{CODE}: { code, host, hostName, game, pick, room, n, members, createdAt, updatedAt }
// game is where the TV is right now:
//   'lobby'  the picker (/tv)
//   'race'   Island Race, 'prank' Prankster: the same rooms as on a call (lib/race.js, lib/prankster.js), with
//            the TV watching instead of playing
//   'party'  Bumper Buds, Tug of War or Freeze (pick says which the TV opened with)
//
// Those three need a faster back-and-forth than checking in once a second, so they run on Firebase's Realtime
// Database: each phone writes its own controls, the TV runs the game and writes the score. It's the one place a
// page talks to Firebase itself. To get in, a page asks here for a sign-in token that's good for one room only
// (database.rules.json checks it), so the room is open to the people who typed the code and nobody else.
// Needs FIREBASE_DATABASE_URL and FIREBASE_WEB_API_KEY (neither is a secret: they go to the page as they are).
import { db, Timestamp, adminAuth, projectId } from './firebase.js';
import { GUILD_ID } from './discord.js';
import * as race from './race.js';
import * as prank from './prankster.js';

export const parties = () => db().collection('guilds').doc(GUILD_ID).collection('parties');
const err = (message, status) => Object.assign(new Error(message), { status });

// no vowels, so a code never spells anything; and nothing that looks like something else when read off a TV
const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
export const okCode = (c) => typeof c === 'string' && /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(c);
const newCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
const PARTY_MS = 12 * 3600e3;      // a code is good for the night
const SEEN_EVERY_MS = 60e3, HERE_MS = 3 * 3600e3;
export const GAMES = ['lobby', 'race', 'prank', 'bumper', 'tug', 'freeze'];
const LIVE = ['bumper', 'tug', 'freeze'];
const isFresh = (p, now) => !!p && now - (p.updatedAt || 0) < PARTY_MS;
export const rtReady = () => !!((process.env.FIREBASE_DATABASE_URL || '').trim() && (process.env.FIREBASE_WEB_API_KEY || '').trim());
// the live games' room: one per host, wiped clean each time their TV opens it
const liveRoom = (host) => `p${host}`;

function viewFor(p, me, now) {
  const members = Object.entries(p.members || {}).filter(([, m]) => now - (m.at || 0) < HERE_MS)
    .map(([id, m]) => ({ id, name: m.name, at: m.at })).sort((a, b) => a.at - b.at).map(({ id, name }) => ({ id, name }));
  return { code: p.code, host: p.host, hostName: p.hostName, mine: p.host === me, me, game: p.game, pick: p.pick || null, room: p.room || null, n: p.n || 0, members, live: rtReady(), now };
}

// The TV asks for a code. Its last one is handed back if it's still good, so a reload doesn't strand the phones.
export async function open(me, name, prev) {
  const now = Date.now();
  if (okCode(prev)) {
    const snap = await parties().doc(prev).get();
    if (snap.exists && snap.get('host') === me && isFresh(snap.data(), now)) return viewFor(snap.data(), me, now);
  }
  for (let tries = 0; tries < 8; tries++) {
    const code = newCode(), ref = parties().doc(code);
    const made = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && isFresh(snap.data(), now)) return null;   // someone else's party tonight
      const p = { code, host: me, hostName: name || 'someone', game: 'lobby', pick: null, room: null, n: 0, members: {}, createdAt: Timestamp.now(), updatedAt: now };
      tx.set(ref, p);
      return p;
    });
    if (made) return viewFor(made, me, now);
  }
  throw err('couldn’t find a free code. try again?', 503);
}

async function fresh(code) {
  const snap = await parties().doc(code).get(), now = Date.now();
  if (!snap.exists || !isFresh(snap.data(), now)) throw err('no party with that code. check the TV?', 404);
  return snap.data();
}

// Where's the party? Phones ask every few seconds and go wherever the TV went. Asking also puts you on the
// TV's list of who's here (written once, then at most once a minute).
export async function look(code, me, name, tv) {
  const p = await fresh(code), now = Date.now();
  if (!tv && now - (p.members?.[me]?.at || 0) > SEEN_EVERY_MS) {
    p.members = { ...p.members, [me]: { name: name || 'someone', at: now } };
    await parties().doc(code).update({ [`members.${me}`]: p.members[me] });
  }
  return viewFor(p, me, now);
}

// The TV picked a game (or went back to the picker).
export async function setGame(code, me, game) {
  if (!GAMES.includes(game)) throw err('which game?', 400);
  const p = await fresh(code), now = Date.now();
  if (p.host !== me) throw err('only the TV that started this party can pick the game', 403);
  if (LIVE.includes(game) && !rtReady()) throw err('that game isn’t set up yet', 503);
  let room = null, kind = game, pick = null;
  if (game === 'race') room = await race.newTvRoom(me);
  else if (game === 'prank') room = await prank.newTvRoom(me);
  else if (LIVE.includes(game)) { kind = 'party'; pick = game; room = liveRoom(me); }
  const patch = { game: kind, pick, room, n: (p.n || 0) + 1, updatedAt: now };
  await parties().doc(code).update(patch);
  return viewFor({ ...p, ...patch }, me, now);
}

// A sign-in token for the party's live room. The TV's says it may run the game; a phone's only lets it write
// its own controls. The name is baked in, so nobody can show up as someone else.
export async function rtToken(code, me, name, tv) {
  if (!rtReady()) throw err('that game isn’t set up yet', 503);
  const p = await fresh(code);
  if (tv && p.host !== me) throw err('only the TV that started this party can run the game', 403);
  const room = liveRoom(p.host), uid = tv ? `tv_${me}` : me, nm = String(name || 'someone').slice(0, 40);
  const token = await (await adminAuth()).createCustomToken(uid, { room, host: !!tv, nm });
  return {
    token, uid, room, name: nm, host: p.host, hostName: p.hostName, code: p.code,
    config: { apiKey: process.env.FIREBASE_WEB_API_KEY.trim(), databaseURL: process.env.FIREBASE_DATABASE_URL.trim(), projectId: projectId() },
  };
}
