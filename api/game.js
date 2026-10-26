// Peekaboo games (lib/peekaboo.js). GET ?id= one game (your view of it) or your games;
// POST { action: 'create' | 'hide' | 'shoot' | 'resign', ... }
// Question Showdown rooms (lib/showdown.js) share this function: GET ?room= checks in (?buds=a,b,c for
// drawing them); POST { action: 'sd-new' | 'sd-join' | 'sd-start' | 'sd-pick', room, choice }
import { readSession, sameOrigin } from '../lib/session.js';
import { createGame, hide, shoot, resign, getGame, myGames } from '../lib/peekaboo.js';
import { isDiscordId } from '../lib/notes.js';
import { newRoomId, joinRoom, checkIn, startGame, pick, budsFor } from '../lib/showdown.js';

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
