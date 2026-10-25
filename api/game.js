// Peekaboo games (lib/peekaboo.js). GET ?id= one game (your view of it) or your games;
// POST { action: 'create' | 'hide' | 'shoot' | 'resign', ... }
import { readSession, sameOrigin } from '../lib/session.js';
import { createGame, hide, shoot, resign, getGame, myGames } from '../lib/peekaboo.js';
import { isDiscordId } from '../lib/notes.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (err) => {
  if (err.status) return json({ error: err.message }, err.status);
  console.error('peekaboo failed:', err);
  return json({ error: 'something went wrong. try again?' }, 500);
};

export async function GET(request) {
  const session = readSession(request);
  if (!session) return json({ error: 'sign in first' }, 401);
  const id = new URL(request.url).searchParams.get('id');
  try { return json(id ? await getGame(session.id, id) : { games: await myGames(session.id) }); } catch (err) { return fail(err); }
}

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'wrong origin' }, 403);
  const session = readSession(request);
  if (!session) return json({ error: 'sign in first' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const { action, id } = body || {};
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
