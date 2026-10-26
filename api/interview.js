// bud's getting-to-know-you chat. POST { action: 'turn' | 'finish', history: [{ role: 'bud' | 'you', text }] }
// Also hanging out with your bud (lib/hangout.js): POST { action: 'hangout-start' }, then
// { action: 'hangout-turn', sid, history } each message, and { action: 'hangout-end', sid } for the card.
import { readSession, sameOrigin } from '../lib/session.js';
import { db, refs, Timestamp } from '../lib/firebase.js';
import { budPersona, nextLine, writeProfile, validHistory } from '../lib/interview.js';
import { startSession, turn, endSession, validHangoutHistory } from '../lib/hangout.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const DAILY_CALLS = 80;   // plenty for a couple of chats a day, and keeps the AI bill tiny

// Count this call against today's allowance; false when it's used up.
async function spend(uid) {
  const ref = refs.user(uid), day = new Date().toISOString().slice(0, 10);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const u = snap.exists ? snap.get('aiUsage') : null;
    const calls = u && u.day === day ? u.calls : 0;
    if (calls >= DAILY_CALLS) return false;
    tx.set(ref, { aiUsage: { day, calls: calls + 1 } }, { merge: true });
    return true;
  });
}

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'wrong origin' }, 403);
  const session = readSession(request);
  if (!session) return json({ error: 'sign in first' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const { action, history = [] } = body || {};
  if (typeof action === 'string' && action.startsWith('hangout-')) return hangout(session, body);
  if (!['turn', 'finish'].includes(action) || !validHistory(history)) return json({ error: 'bad chat' }, 400);

  try {
    const budSnap = await refs.bud(session.id).get();
    if (!budSnap.exists) return json({ error: 'make your bud first' }, 409);
    if (!(await spend(session.id))) return json({ error: 'tired', say: 'i’m all talked out for today… let’s chat more tomorrow?' }, 429);
    const persona = budPersona(budSnap.data(), session.id);

    if (action === 'turn') return json(await nextLine(persona, history));

    // finish: write down what bud learned. It's saved with matching off; the person reviews it next.
    const profile = await writeProfile(persona, history);
    const ref = refs.profile(session.id), now = Timestamp.now();
    const existing = await ref.get();
    await ref.set({ ...profile, matchable: existing.exists ? !!existing.get('matchable') : false, source: 'interview', updatedAt: now, ...(existing.exists ? {} : { createdAt: now }) }, { merge: true });
    return json({ profile: { ...profile, matchable: existing.exists ? !!existing.get('matchable') : false } });
  } catch (err) {
    if (err.code === 'no-key') return json({ error: 'no-voice', say: 'i can’t really talk yet… my voice isn’t set up. ask whoever made this place!' }, 503);
    console.error('interview failed:', err);
    return json({ error: 'hiccup', say: 'hm, i got a little tongue-tied. say that again?' }, 502);
  }
}

async function hangout(session, body) {
  const { action, sid, history = [] } = body;
  if (action !== 'hangout-start' && (typeof sid !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(sid))) return json({ error: 'which hangout?' }, 400);
  if (action === 'hangout-turn' && !validHangoutHistory(history)) return json({ error: 'bad chat' }, 400);
  try {
    const budSnap = await refs.bud(session.id).get();
    if (!budSnap.exists) return json({ error: 'make your bud first' }, 409);
    const persona = budPersona(budSnap.data(), session.id, { fresh: false });
    if (action === 'hangout-start') return json(await startSession(persona, session.id));
    if (action === 'hangout-turn') return json(await turn(persona, session.id, sid, history));
    if (action === 'hangout-end') return json(await endSession(persona, session.id, sid));
    return json({ error: 'unknown move' }, 400);
  } catch (err) {
    if (err.status === 429) return json({ error: 'tired', say: 'the office is closed for today. i have a nap appointment. come back tomorrow!' }, 429);
    if (err.status) return json({ error: err.message }, err.status);
    if (err.code === 'no-key') return json({ error: 'no-voice', say: 'i can’t really talk yet… my voice isn’t set up. ask whoever made this place!' }, 503);
    console.error('hangout failed:', err);
    return json({ error: 'hiccup', say: 'hm, i got a little tongue-tied. say that again?' }, 502);
  }
}
