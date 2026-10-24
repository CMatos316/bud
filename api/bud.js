// Save or delete the signed-in person's bud. The bud is stored under their Discord ID,
// so nobody can read or change anyone else's.
import { readSession, sameOrigin } from '../lib/session.js';
import { refs, Timestamp } from '../lib/firebase.js';
import { validateBud } from '../lib/bud.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

function guard(request) {
  if (!sameOrigin(request)) return json({ error: 'wrong origin' }, 403);
  const session = readSession(request);
  if (!session) return json({ error: 'sign in first' }, 401);
  return session;
}

export async function PUT(request) {
  const session = guard(request);
  if (session instanceof Response) return session;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const v = validateBud(body);
  if (!v.ok) return json({ error: v.error }, 400);
  try {
    const ref = refs.bud(session.id);
    const now = Timestamp.now();
    const existing = await ref.get();
    await ref.set({ ...v.doc, owner: session.id, updatedAt: now, ...(existing.exists ? {} : { createdAt: now }) }, { merge: true });
    return json({ saved: true });
  } catch (err) {
    console.error('saving bud failed:', err);
    return json({ error: 'could not save' }, 500);
  }
}

export async function DELETE(request) {
  const session = guard(request);
  if (session instanceof Response) return session;
  try {
    await refs.bud(session.id).delete();
    return json({ deleted: true });
  } catch (err) {
    console.error('deleting bud failed:', err);
    return json({ error: 'could not delete' }, 500);
  }
}
