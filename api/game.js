// Peekaboo games (lib/peekaboo.js). GET ?id= one game (your view of it) or your games;
// POST { action: 'create' | 'hide' | 'shoot' | 'resign', ... }
// Question Showdown rooms (lib/showdown.js) share this function: GET ?room= checks in (?buds=a,b,c for
// drawing them); POST { action: 'sd-new' | 'sd-join' | 'sd-start' | 'sd-pick', room, choice }
// Prankster rooms (lib/prankster.js) too: GET ?pk= checks in; POST { action: 'pk-new' | 'pk-join' | 'pk-start'
// | 'pk-night' | 'pk-ready' | 'pk-vote', room, target }
// Doodle Duel (lib/doodle.js): GET ?doodle= one game; POST { action: 'dd-new' | 'dd-pick' | 'dd-send' | 'dd-guess'
// | 'dd-giveup', id, opponent, choice, strokes, guess }
// Bud-a-pult test range (lib/catapult.js, the physics runs here): POST { action: 'bp-build' | 'bp-shoot' |
// 'bp-repair', pieces, bud, state, angle, power, add, remove }
// Island Race (lib/race.js, played on a call): GET ?rc=<room>[&full=1] checks in; POST { action: 'rc-new' |
// 'rc-join' | 'rc-start' | 'rc-roll', room, item, golden, fork }
// Bud-a-pult the game (lib/bpgame.js): GET ?bpg= one game; POST { action: 'bpg-new' | 'bpg-build' | 'bpg-shoot' |
// 'bpg-patch' | 'bpg-resign', id, opponent, pieces, bud, angle, power, add, remove, skip }
// Doodle mail (lib/doodlemail.js): GET ?mail=list (your bud's doodles) | ?mail=<id> (one, to replay) | ?mailto=<user>;
// POST { action: 'mail-send' | 'mail-star' | 'mail-toss', to, strokes, caption, id, fav }
import { readSession, sameOrigin } from '../lib/session.js';
import { createGame, hide, shoot, resign, getGame, myGames } from '../lib/peekaboo.js';
import { isDiscordId } from '../lib/notes.js';
import { newRoomId, joinRoom, checkIn, startGame, pick, budsFor } from '../lib/showdown.js';
import * as prank from '../lib/prankster.js';
import * as doodle from '../lib/doodle.js';
import * as mail from '../lib/doodlemail.js';
import * as pult from '../lib/catapult.js';
import * as bpg from '../lib/bpgame.js';
import * as race from '../lib/race.js';

const okRoom = (r) => typeof r === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(r);

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (err) => {
  if (err.status) return json({ error: err.message }, err.status);
  console.error('peekaboo failed:', err);
  return json({ error: 'something went wrong. try again?' }, 500);
};

export async function GET(request) {
  const session = readSession(request);
  if (!session) return json({ error: 'sign in first' }, 401);
  const url = new URL(request.url), id = url.searchParams.get('id'), room = url.searchParams.get('room');
  const dd = url.searchParams.get('doodle');
  if (dd != null) {
    if (!/^[A-Za-z0-9]{10,40}$/.test(dd)) return json({ error: 'which game?' }, 400);
    try { return json(await doodle.getGame(session.id, dd)); } catch (err) { return fail(err); }
  }
  const rc = url.searchParams.get('rc');
  if (rc != null) {
    if (!okRoom(rc)) return json({ error: 'which race?' }, 400);
    try { return json(await race.checkIn(rc, session.id, session.name, url.searchParams.get('full') === '1')); } catch (err) { return fail(err); }
  }
  const bg = url.searchParams.get('bpg');
  if (bg != null) {
    if (!/^[A-Za-z0-9]{10,40}$/.test(bg)) return json({ error: 'which game?' }, 400);
    try { return json(await bpg.getGame(session.id, bg)); } catch (err) { return fail(err); }
  }
  const ml = url.searchParams.get('mail'), mailTo = url.searchParams.get('mailto');
  if (ml != null || mailTo != null) {
    try {
      if (mailTo != null) return isDiscordId(mailTo) ? json(await mail.target(session.id, mailTo)) : json({ error: 'who is it for?' }, 400);
      if (ml === 'list') return json(await mail.inventory(session.id));
      if (!/^[A-Za-z0-9]{10,40}$/.test(ml)) return json({ error: 'which doodle?' }, 400);
      return json(await mail.open(session.id, ml));
    } catch (err) { return fail(err); }
  }
  const pk = url.searchParams.get('pk');
  if (pk != null) {
    if (!okRoom(pk)) return json({ error: 'which game?' }, 400);
    try { return json(await prank.checkIn(pk, session.id, session.name)); } catch (err) { return fail(err); }
  }
  if (room != null) {
    if (!okRoom(room)) return json({ error: 'which game?' }, 400);
    try {
      const ids = (url.searchParams.get('buds') || '').split(',').filter(isDiscordId);
      return json(ids.length ? { buds: await budsFor(ids) } : await checkIn(room, session.id, session.name));
    } catch (err) { return fail(err); }
  }
  try { return json(id ? await getGame(session.id, id) : { games: await myGames(session.id) }); } catch (err) { return fail(err); }
}

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'wrong origin' }, 403);
  const session = readSession(request);
  if (!session) return json({ error: 'sign in first' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const { action, id } = body || {};
  if (typeof action === 'string' && action.startsWith('dd-')) {
    try {
      if (action === 'dd-new') {
        if (!isDiscordId(body.opponent)) return json({ error: 'who are you doodling with?' }, 400);
        return json(await doodle.createGame(session.id, body.opponent));
      }
      if (typeof id !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(id)) return json({ error: 'which game?' }, 400);
      if (action === 'dd-pick') return json(await doodle.pickWord(session.id, id, Number(body.choice)));
      if (action === 'dd-send') return json(await doodle.sendDrawing(session.id, id, body.strokes));
      if (action === 'dd-guess') return json(await doodle.guess(session.id, id, String(body.guess || '').slice(0, 60)));
      if (action === 'dd-giveup') return json(await doodle.giveUp(session.id, id));
      return json({ error: 'unknown move' }, 400);
    } catch (err) { return fail(err); }
  }
  if (typeof action === 'string' && action.startsWith('rc-')) {
    try {
      if (action === 'rc-new') return json(await race.joinRoom(race.newRoomId(), session.id, session.name));
      if (!okRoom(body.room)) return json({ error: 'which race?' }, 400);
      if (action === 'rc-join') return json(await race.joinRoom(body.room, session.id, session.name));
      if (action === 'rc-start') return json(await race.startRace(body.room, session.id));
      if (action === 'rc-roll') {
        const item = typeof body.item === 'string' && race.ITEMS[body.item] ? body.item : null;
        return json(await race.roll(body.room, session.id, { item, golden: Number(body.golden), fork: body.fork === 1 ? 1 : 0 }));
      }
      return json({ error: 'unknown move' }, 400);
    } catch (err) { return fail(err); }
  }
  if (typeof action === 'string' && action.startsWith('bpg-')) {
    try {
      if (action === 'bpg-new') {
        if (!isDiscordId(body.opponent)) return json({ error: 'who are you playing?' }, 400);
        return json(await bpg.createGame(session.id, body.opponent));
      }
      if (typeof id !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(id)) return json({ error: 'which game?' }, 400);
      if (action === 'bpg-build') return json(await bpg.build(session.id, id, body.pieces, body.bud));
      if (action === 'bpg-shoot') return json(await bpg.shoot(session.id, id, body.angle, body.power));
      if (action === 'bpg-patch') return json(await bpg.patch(session.id, id, body.skip ? null : { add: body.add, remove: body.remove, bud: body.bud }));
      if (action === 'bpg-resign') return json(await bpg.resign(session.id, id));
      return json({ error: 'unknown move' }, 400);
    } catch (err) { return fail(err); }
  }
  if (typeof action === 'string' && action.startsWith('bp-')) {
    try {
      if (action === 'bp-build') return json({ state: pult.settle(pult.placeBuild(pult.checkBuild(body.pieces, body.bud))) });
      if (action === 'bp-shoot') return json(pult.shoot(pult.cleanState(body.state), body.angle, body.power));
      if (action === 'bp-repair') return json({ state: pult.repair(pult.cleanState(body.state), { add: body.add, remove: body.remove, bud: body.bud }) });
      return json({ error: 'unknown move' }, 400);
    } catch (err) { return fail(err); }
  }
  if (typeof action === 'string' && action.startsWith('mail-')) {
    try {
      if (action === 'mail-send') {
        if (!isDiscordId(body.to)) return json({ error: 'who is it for?' }, 400);
        return json(await mail.send(session.id, session.name, body.to, body.strokes, body.caption));
      }
      if (typeof id !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(id)) return json({ error: 'which doodle?' }, 400);
      if (action === 'mail-star') return json(await mail.star(session.id, id, !!body.fav));
      if (action === 'mail-toss') return json(await mail.toss(session.id, id));
      return json({ error: 'unknown move' }, 400);
    } catch (err) { return fail(err); }
  }
  if (typeof action === 'string' && action.startsWith('pk-')) {
    try {
      if (action === 'pk-new') return json(await prank.joinRoom(prank.newRoomId(), session.id, session.name));
      if (!okRoom(body.room)) return json({ error: 'which game?' }, 400);
      const target = typeof body.target === 'string' && (body.target === 'skip' || isDiscordId(body.target) || /^[0-9]{5,25}$/.test(body.target)) ? body.target : null;
      if (action === 'pk-join') return json(await prank.joinRoom(body.room, session.id, session.name));
      if (action === 'pk-start') return json(await prank.startGame(body.room, session.id));
      if (action === 'pk-night') return json(await prank.act(body.room, session.id, 'night', target));
      if (action === 'pk-ready') return json(await prank.act(body.room, session.id, 'ready'));
      if (action === 'pk-vote') return json(await prank.act(body.room, session.id, 'vote', target));
      return json({ error: 'unknown move' }, 400);
    } catch (err) { return fail(err); }
  }
  if (typeof action === 'string' && action.startsWith('sd-')) {
    try {
      if (action === 'sd-new') return json(await joinRoom(newRoomId(), session.id, session.name));
      if (!okRoom(body.room)) return json({ error: 'which game?' }, 400);
      if (action === 'sd-join') return json(await joinRoom(body.room, session.id, session.name));
      if (action === 'sd-start') return json(await startGame(body.room, session.id));
      if (action === 'sd-pick') return json(await pick(body.room, session.id, Number(body.choice)));
      return json({ error: 'unknown move' }, 400);
    } catch (err) { return fail(err); }
  }
  const okId = typeof id === 'string' && /^[A-Za-z0-9]{10,40}$/.test(id);
  try {
    if (action === 'create') {
      if (!isDiscordId(body.opponent)) return json({ error: 'who are you playing?' }, 400);
      return json(await createGame(session.id, body.opponent));
    }
    if (!okId) return json({ error: 'which game?' }, 400);
    if (action === 'hide') return json(await hide(session.id, id, (body.tiles || []).map(Number)));
    if (action === 'shoot') return json(await shoot(session.id, id, Number(body.tile), !!body.yell));
    if (action === 'resign') return json(await resign(session.id, id));
    return json({ error: 'unknown move' }, 400);
  } catch (err) { return fail(err); }
}
