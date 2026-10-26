// What bud learned about you: read it, edit it (remove tags, turn friend suggestions on or off), or delete it.
import { readSession, sameOrigin } from '../lib/session.js';
import { refs, Timestamp } from '../lib/firebase.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const FIELDS = ['interests', 'lookingFor', 'around', 'vibe', 'summary', 'matchable'];
const tidy = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const tagList = (v, n, max) => (Array.isArray(v) ? [...new Set(v.map((t) => tidy(t, max).toLowerCase()).filter(Boolean))].slice(0, n) : null);

function guard(request, write) {
  if (write && !sameOrigin(request)) return json({ error: 'wrong origin' }, 403);
  const session = readSession(request);
  if (!session) return json({ error: 'sign in first' }, 401);
  return session;
}

export async function GET(request) {
  const session = guard(request, false);
  if (session instanceof Response) return session;
  const [snap, user] = await Promise.all([refs.profile(session.id).get(), refs.user(session.id).get()]);
  const dms = !(user.exists && user.get('questionsOff'));
  // small things your bud remembers from hanging out (lib/hangout.js)
  const rem = user.exists ? user.get('budRemembers') : null;
  const remembers = Array.isArray(rem) ? rem.map((r) => r?.t).filter((t) => typeof t === 'string') : [];
  if (!snap.exists) return json({ profile: null, dms, remembers });
  const d = snap.data();
  return json({ profile: Object.fromEntries(FIELDS.map((k) => [k, d[k] ?? null])), dms, remembers });
}

// Edits only narrow what bud learned (remove things) or flip matching; new facts come from the chat.
export async function PUT(request) {
  const session = guard(request, true);
  if (session instanceof Response) return session;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  // bud's question DMs on or off (works even before there's a profile)
  if (typeof body?.dms === 'boolean') await refs.user(session.id).set({ questionsOff: !body.dms }, { merge: true });
  // what your bud remembers from hanging out: remove-only, like the rest ([] forgets everything)
  if (Array.isArray(body?.remembers)) {
    const u = await refs.user(session.id).get(), cur = u.exists && Array.isArray(u.get('budRemembers')) ? u.get('budRemembers') : [];
    const keep = new Set(body.remembers.filter((t) => typeof t === 'string'));
    await refs.user(session.id).set({ budRemembers: cur.filter((r) => keep.has(r?.t)) }, { merge: true });
    if (typeof body?.dms !== 'boolean' && !('interests' in body) && !('lookingFor' in body) && !('matchable' in body)) return json({ saved: true });
  }
  const ref = refs.profile(session.id), snap = await ref.get();
  if (!snap.exists) return typeof body?.dms === 'boolean' || Array.isArray(body?.remembers) ? json({ saved: true }) : json({ error: 'chat with your bud first' }, 404);
  const cur = snap.data(), patch = { updatedAt: Timestamp.now() };
  const keep = (list, old) => (list ? list.filter((t) => (old || []).includes(t)) : undefined);
  const interests = keep(tagList(body?.interests, 12, 32), cur.interests);
  const lookingFor = keep(tagList(body?.lookingFor, 4, 60), cur.lookingFor);
  if (interests) patch.interests = interests;
  if (lookingFor) patch.lookingFor = lookingFor;
  if (typeof body?.matchable === 'boolean') patch.matchable = body.matchable;
  await ref.set(patch, { merge: true });
  return json({ saved: true });
}

export async function DELETE(request) {
  const session = guard(request, true);
  if (session instanceof Response) return session;
  await refs.profile(session.id).delete();
  return json({ deleted: true });
}
