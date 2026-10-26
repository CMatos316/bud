// Prankster: a mafia-style game for a group on a call (played as bud's Discord Activity, like Showdown).
// Everyone gets a secret role. At night the Pranksters pick someone to prank, the Snoop peeks at one
// person, and the Guardian protects one. In the morning the island finds out who got pranked (they become
// a ghost). In the day everyone argues on the call, then votes; the bud with the most votes is out and their
// role is shown. The island wins by catching every Prankster; the Pranksters win once they match the rest.
//
// Like Showdown, rooms run on the server's clock and move along whenever someone checks in (about once a
// second), so there's no always-on server. Roles are never sent to anyone but their owner until the end:
// each player gets their own view (viewFor).
// Rooms: guilds/{guild}/pranks/{room}. In Discord the room is the activity's instance, so the whole call
// lands in the same game.
import { db, Timestamp } from './firebase.js';
import { GUILD_ID } from './discord.js';
import { rng } from './life.js';

export const MIN_PLAYERS = 4, MAX_PLAYERS = 12;
export const STAGE_MS = { roles: 9000, night: 35000, morning: 8000, day: 90000, vote: 30000, verdict: 9000 };
const AWAY_MS = 20000, SEEN_EVERY_MS = 8000;
export const rooms = () => db().collection('guilds').doc(GUILD_ID).collection('pranks');
const err = (message, status) => Object.assign(new Error(message), { status });

export const ROLES = {
  prankster: { name: 'Prankster', team: 'pranksters', blurb: 'Each night, pick someone to prank with the other Pranksters. In the day, blend in.' },
  snoop: { name: 'Snoop', team: 'island', blurb: 'Each night, peek at one bud to find out if they’re a Prankster.' },
  guardian: { name: 'Guardian', team: 'island', blurb: 'Each night, protect one bud from pranks (not the same one two nights in a row).' },
  islander: { name: 'Islander', team: 'island', blurb: 'Listen closely, ask questions, and vote out the Pranksters.' },
};
export function roleCounts(n) {
  const pranksters = n <= 5 ? 1 : n <= 8 ? 2 : 3;
  return { prankster: pranksters, snoop: n >= 5 ? 1 : 0, guardian: n >= 6 ? 1 : 0 };
}

const shuffle = (list, seed) => { const r = rng(seed), a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const isHere = (p, now) => now - (p.lastSeen || 0) < AWAY_MS;
const aliveIds = (g) => Object.keys(g.roles || {}).filter((id) => g.alive?.[id]);
const teamOf = (g, id) => ROLES[g.roles[id]]?.team;
const nightActors = (g) => aliveIds(g).filter((id) => ['prankster', 'snoop', 'guardian'].includes(g.roles[id]));

function winner(g) {
  const alive = aliveIds(g), bad = alive.filter((id) => teamOf(g, id) === 'pranksters').length;
  if (!bad) return 'island';
  if (bad >= alive.length - bad) return 'pranksters';
  return null;
}

// The Pranksters' pick for the night: the most-picked target (ties broken by the room's dice).
function prankTarget(g) {
  const picks = Object.entries(g.night?.prank || {}).filter(([id, t]) => g.alive[id] && g.alive[t]);
  if (!picks.length) return null;
  const tally = {};
  for (const [, t] of picks) tally[t] = (tally[t] || 0) + 1;
  const top = Math.max(...Object.values(tally)), best = Object.keys(tally).filter((t) => tally[t] === top).sort();
  return best.length === 1 ? best[0] : shuffle(best, `${g.id}:${g.game}:${g.day}`)[0];
}

// End the stage that's running and set up the next one. Mutates g and records what changed in patch.
function nextStage(g, at, patch) {
  const set = (k, v) => { g[k] = v; patch[k] = v; };
  const day = g.day;
  if (g.stage === 'roles') { set('stage', 'night'); }
  else if (g.stage === 'night') {
    const target = prankTarget(g), guard = Object.entries(g.night?.guard || {}).find(([id]) => g.alive[id])?.[1] ?? null;
    const event = { day, kind: 'quiet' };
    if (target && target === guard) Object.assign(event, { kind: 'saved' });
    else if (target) { Object.assign(event, { kind: 'pranked', who: target, role: g.roles[target] }); g.alive = { ...g.alive, [target]: false }; patch.alive = g.alive; }
    // the Snoop learns one thing
    const snoops = { ...(g.snoops || {}) };
    for (const [id, t] of Object.entries(g.night?.snoop || {})) if (g.alive[id] !== undefined && t) snoops[id] = [...(snoops[id] || []), { day, who: t, prankster: g.roles[t] === 'prankster' }];
    set('snoops', snoops);
    set('lastGuard', Object.fromEntries(Object.entries(g.night?.guard || {})));
    set('events', [...(g.events || []), event]);
    set('stage', 'morning');
  } else if (g.stage === 'morning') {
    const w = winner(g);
    if (w) { set('winner', w); set('phase', 'done'); set('stage', 'done'); set('stageAt', at); set('stageEnds', null); return; }
    set('stage', 'day'); set('ready', {});
  } else if (g.stage === 'day') { set('stage', 'vote'); set('votes', {}); }
  else if (g.stage === 'vote') {
    const votes = Object.entries(g.votes || {}).filter(([id]) => g.alive[id]), tally = {};
    for (const [, t] of votes) tally[t] = (tally[t] || 0) + 1;
    const ranked = Object.entries(tally).filter(([t]) => t !== 'skip').sort((a, b) => b[1] - a[1]);
    const skip = tally.skip || 0;
    const event = { day, kind: 'tie', votes: Object.fromEntries(votes) };
    if (ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) && ranked[0][1] > skip) {
      const out = ranked[0][0];
      Object.assign(event, { kind: 'out', who: out, role: g.roles[out] });
      g.alive = { ...g.alive, [out]: false }; patch.alive = g.alive;
    } else if (!votes.length || skip >= (ranked[0]?.[1] || 0)) event.kind = 'skipped';
    set('events', [...(g.events || []), event]);
    set('stage', 'verdict');
  } else if (g.stage === 'verdict') {
    const w = winner(g);
    if (w) { set('winner', w); set('phase', 'done'); set('stage', 'done'); set('stageAt', at); set('stageEnds', null); return; }
    set('day', day + 1); set('night', { prank: {}, snoop: {}, guard: {} }); set('stage', 'night');
  }
  set('stageAt', at); set('stageEnds', at + STAGE_MS[g.stage]);
}

// Everyone who can act this stage has: no need to wait out the clock.
function allDone(g, now) {
  const here = (id) => isHere(g.players[id] || {}, now);
  if (g.stage === 'night') {
    const n = g.night || {};
    return nightActors(g).filter(here).every((id) => {
      const r = g.roles[id];
      return r === 'prankster' ? id in (n.prank || {}) : r === 'snoop' ? id in (n.snoop || {}) : id in (n.guard || {});
    });
  }
  if (g.stage === 'day') { const alive = aliveIds(g).filter(here); return alive.length > 0 && alive.filter((id) => g.ready?.[id]).length > alive.length / 2; }
  if (g.stage === 'vote') return aliveIds(g).filter(here).every((id) => id in (g.votes || {}));
  return false;
}

function advance(g, now) {
  if (g.phase !== 'play') return null;
  const patch = {};
  for (let steps = 0; steps < 12 && g.phase === 'play'; steps++) {
    if (now >= g.stageEnds) { nextStage(g, g.stageEnds, patch); continue; }
    if (['night', 'day', 'vote'].includes(g.stage) && allDone(g, now)) { g.stageEnds = now; nextStage(g, now, patch); continue; }
    break;
  }
  return Object.keys(patch).length ? patch : null;
}

// What one player is allowed to see right now.
function viewFor(g, me, now) {
  const done = g.phase === 'done', role = g.roles?.[me] || null, alive = g.alive?.[me] ?? null;
  const players = Object.entries(g.players || {}).map(([id, p]) => ({
    id, name: p.name, here: isHere(p, now), joinedAt: p.joinedAt,
    playing: !!g.roles?.[id], alive: g.roles?.[id] ? !!g.alive?.[id] : null,
  })).sort((a, b) => a.joinedAt - b.joinedAt);
  const v = {
    id: g.id, me, host: g.host, phase: g.phase, stage: g.stage || 'lobby', day: g.day || 1, game: g.game || 1, now,
    stageAt: g.stageAt ?? null, stageEnds: g.stageEnds ?? null, players,
    role, roleInfo: role ? ROLES[role] : null, alive,
    counts: g.counts || null, events: g.events || [],
  };
  if (role === 'prankster' || done) {
    // Pranksters know each other, and see each other's picks at night
    v.team = Object.keys(g.roles || {}).filter((id) => g.roles[id] === 'prankster');
    if (role === 'prankster' && g.stage === 'night') v.teamPicks = g.night?.prank || {};
  }
  if (g.stage === 'night' && alive) {
    const n = g.night || {};
    v.myPick = role === 'prankster' ? n.prank?.[me] ?? null : role === 'snoop' ? n.snoop?.[me] ?? null : role === 'guardian' ? n.guard?.[me] ?? null : null;
    if (role === 'guardian') v.cantGuard = g.lastGuard?.[me] ?? null;
  }
  if (role === 'snoop') v.snoops = g.snoops?.[me] || [];
  if (g.stage === 'day') { v.ready = Object.keys(g.ready || {}).filter((id) => g.alive?.[id]); v.myReady = !!g.ready?.[me]; }
  if (g.stage === 'vote') { v.voted = Object.keys(g.votes || {}); v.myVote = g.votes?.[me] ?? null; }
  if (done) { v.roles = g.roles; v.winner = g.winner; }
  return v;
}

async function touch(id, me, name, create) {
  const ref = rooms().doc(id), now = Date.now();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let g = snap.exists ? snap.data() : null;
    if (!g) {
      if (!create) throw err('that game isn’t around anymore', 404);
      g = { id, host: me, phase: 'lobby', stage: 'lobby', players: {}, playerIds: [], game: 0, createdAt: Timestamp.now() };
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
    if (moved) Object.assign(patch, moved);
    if (!snap.exists) tx.set(ref, { ...g, playerIds: patch.playerIds || [me] });
    else if (Object.keys(patch).length) tx.update(ref, patch);
    return viewFor(g, me, now);
  });
}
export const newRoomId = () => rooms().doc().id.slice(0, 12);
export const joinRoom = (id, me, name) => touch(id, me, name, true);
export const checkIn = (id, me, name) => touch(id, me, name, false);

// Deal roles to everyone who's here and start the first night (also "play again").
export async function startGame(id, me) {
  const ref = rooms().doc(id), now = Date.now();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || !snap.get(`players.${me}`)) throw err('join the game first', 404);
    const g = snap.data();
    if (g.phase === 'play') return viewFor(g, me, now);
    const here = Object.entries(g.players || {}).filter(([, p]) => isHere(p, now)).map(([pid]) => pid);
    if (here.length < MIN_PLAYERS) throw err(`you need at least ${MIN_PLAYERS} players`, 409);
    const game = (g.game || 0) + 1, counts = roleCounts(here.length);
    const order = shuffle(here, `${id}:${game}:${now}`), roles = {};
    let k = 0;
    for (const [role, n] of Object.entries(counts)) for (let i = 0; i < n; i++) roles[order[k++]] = role;
    for (; k < order.length; k++) roles[order[k]] = 'islander';
    const patch = {
      phase: 'play', stage: 'roles', game, day: 1, roles, alive: Object.fromEntries(here.map((pid) => [pid, true])),
      counts: { players: here.length, ...counts }, night: { prank: {}, snoop: {}, guard: {} }, votes: {}, ready: {},
      snoops: {}, lastGuard: {}, events: [], winner: null, stageAt: now, stageEnds: now + STAGE_MS.roles, startedAt: now,
    };
    tx.update(ref, patch);
    return viewFor({ ...g, ...patch }, me, now);
  });
}

// One action: a night pick, "ready to vote", or a vote.
export async function act(id, me, kind, target) {
  const ref = rooms().doc(id), now = Date.now();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || !snap.get(`players.${me}`)) throw err('join the game first', 404);
    const g = snap.data(), patch = {};
    const moved = advance(g, now);
    if (moved) Object.assign(patch, moved);
    const fail = (msg) => { if (Object.keys(patch).length) tx.update(ref, patch); throw err(msg, 409); };
    if (g.phase !== 'play' || !g.roles?.[me]) fail('you’re not in this round');
    if (!g.alive[me]) fail('ghosts can’t do that… boo');
    const role = g.roles[me];
    if (kind === 'night') {
      if (g.stage !== 'night') fail('it’s not night');
      if (!g.alive[target]) fail('pick someone still in the game');
      if (role === 'prankster') { if (g.roles[target] === 'prankster') fail('that’s a fellow Prankster!'); g.night = { ...g.night, prank: { ...g.night.prank, [me]: target } }; patch.night = g.night; }
      else if (role === 'snoop') { if (target === me) fail('peek at someone else'); g.night = { ...g.night, snoop: { ...g.night.snoop, [me]: target } }; patch.night = g.night; }
      else if (role === 'guardian') { if (g.lastGuard?.[me] === target) fail('not the same bud two nights in a row'); g.night = { ...g.night, guard: { ...g.night.guard, [me]: target } }; patch.night = g.night; }
      else fail('islanders sleep at night');
    } else if (kind === 'ready') {
      if (g.stage !== 'day') fail('not now');
      g.ready = { ...g.ready, [me]: true }; patch.ready = g.ready;
    } else if (kind === 'vote') {
      if (g.stage !== 'vote') fail('it’s not time to vote');
      if (target !== 'skip' && !g.alive[target]) fail('vote for someone still in the game');
      g.votes = { ...g.votes, [me]: target }; patch.votes = g.votes;
    } else throw err('unknown move', 400);
    g.players[me].lastSeen = now; patch[`players.${me}.lastSeen`] = now;
    const after = advance(g, now);   // the last one in? move on right away
    if (after) Object.assign(patch, after);
    // (whole maps, not dotted paths: a stage change in this same request may have replaced them)
    tx.update(ref, patch);
    return viewFor(g, me, now);
  });
}
