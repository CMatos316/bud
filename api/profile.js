// What bud learned about you: read it, edit it (remove tags, turn friend suggestions on or off), or delete it.
import { readSession, sameOrigin } from '../lib/session.js';
import { refs, Timestamp } from '../lib/firebase.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const FIELDS = ['interests', 'lookingFor', 'around', 'vibe', 'summary', 'matchable', 'tags', 'answered', 'shareInterests'];
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
  if (!snap.exists) return json({ profile: null, dms });
  const d = snap.data();
  const profile = Object.fromEntries(FIELDS.map((k) => [k, d[k] ?? null]));
  profile.shareInterests = d.shareInterests !== false;
  return json({ profile, dms });
}

// Edits only narrow what bud learned (remove things) or flip matching; new facts come from the chat.
export async function PUT(request) {
  const session = guard(request, true);
  if (session instanceof Response) return session;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  // bud's question DMs on or off (works even before there's a profile)
  if (typeof body?.dms === 'boolean') await refs.user(session.id).set({ questionsOff: !body.dms }, { merge: true });
  const ref = refs.profile(session.id), snap = await ref.get();
  if (!snap.exists) return typeof body?.dms === 'boolean' ? json({ saved: true }) : json({ error: 'chat with your bud first' }, 404);
  const cur = snap.data(), patch = { updatedAt: Timestamp.now() };
  const keep = (list, old) => (list ? list.filter((t) => (old || []).includes(t)) : undefined);
  const interests = keep(tagList(body?.interests, 40, 32), cur.interests);
  const lookingFor = keep(tagList(body?.lookingFor, 4, 60), cur.lookingFor);
  if (interests) { patch.interests = interests; patch.tags = (cur.tags || []).filter((t) => interests.includes(t.label)); }
  if (lookingFor) patch.lookingFor = lookingFor;
  if (typeof body?.matchable === 'boolean') patch.matchable = body.matchable;
  if (typeof body?.shareInterests === 'boolean') patch.shareInterests = body.shareInterests;   // "you have this in common" on others' cards
  await ref.set(patch, { merge: true });
  return json({ saved: true });
}

export async function DELETE(request) {
  const session = guard(request, true);
  if (session instanceof Response) return session;
  await refs.profile(session.id).delete();
  return json({ deleted: true });
}
