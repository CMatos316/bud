// bud's getting-to-know-you chat. POST { action: 'turn' | 'finish', history: [{ role: 'bud' | 'you', text }] }
// The first chat is 3 questions. Later, "Keep chatting" catches up one topic at a time, up to 10 in all:
// POST { action: 'turn' | 'finish', more: true, asked: [topic ids asked this time], history }
import { readSession, sameOrigin } from '../lib/session.js';
import { db, refs, Timestamp } from '../lib/firebase.js';
import { budPersona, nextLine, writeProfile, validHistory, nextTopic } from '../lib/interview.js';
import { cleanTags, noteWishes, TOPICS } from '../lib/interests.js';
import { waitUntil } from '@vercel/functions';

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
  const more = !!body?.more;
  const asked = Array.isArray(body?.asked) ? body.asked.filter((t) => TOPICS.some((x) => x.id === t)).slice(0, 12) : [];
  if (!['turn', 'finish'].includes(action) || !validHistory(history)) return json({ error: 'bad chat' }, 400);

  try {
    const budSnap = await refs.bud(session.id).get();
    if (!budSnap.exists) return json({ error: 'make your bud first' }, 409);
    if (!(await spend(session.id))) return json({ error: 'tired', say: 'i’m all talked out for today… let’s chat more tomorrow?' }, 429);
    const persona = budPersona(budSnap.data(), session.id, { fresh: !more });
    const ref = refs.profile(session.id), existing = await ref.get(), cur = existing.exists ? existing.data() : null;
    const answeredBefore = cur ? cur.answered ?? (cur.interests?.length ? 3 : 0) : 0;
    const topicsAsked = [...new Set([...(cur?.topicsAsked || []), ...asked])];

    if (action === 'turn') {
      if (!more) return json(await nextLine(persona, history));
      const topic = nextTopic(topicsAsked);
      return json(await nextLine(persona, history, { topic, total: answeredBefore }));
    }

    // finish: write down what bud learned and add it to what it already knew. The person reviews it next.
    const learned = await writeProfile(persona, history);
    const answers = history.filter((m) => m.role === 'you').length;
    const now = Timestamp.now();
    const oldTags = cleanTags(cur?.tags);
    const tags = cleanTags([...oldTags, ...learned.tags], 40);
    const newTags = tags.filter((t) => !oldTags.some((o) => o.cat === t.cat && o.item === t.item));
    const union = (a, b, n) => [...new Set([...(a || []), ...(b || [])])].slice(-n);
    const merged = {
      tags, interests: union(cur?.interests, learned.interests, 40),
      lookingFor: union(cur?.lookingFor, learned.lookingFor, 6),
      around: learned.around || cur?.around || '', vibe: learned.vibe || cur?.vibe || '',
      summary: learned.summary || cur?.summary || '',
      answered: answeredBefore + answers, topicsAsked,
      matchable: cur ? !!cur.matchable : false,
      shareInterests: cur ? cur.shareInterests !== false : true,   // "you have this in common": on unless they turn it off
    };
    await ref.set({ ...merged, source: 'interview', updatedAt: now, ...(existing.exists ? {} : { createdAt: now }) }, { merge: true });
    waitUntil(noteWishes(session.id, newTags).catch((err) => console.error('wishlist failed:', err)));
    return json({ profile: { ...merged, summary: learned.summary || merged.summary }, newTags, more });
  } catch (err) {
    if (err.code === 'no-key') return json({ error: 'no-voice', say: 'i can’t really talk yet… my voice isn’t set up. ask whoever made this place!' }, 503);
    console.error('interview failed:', err);
    return json({ error: 'hiccup', say: 'hm, i got a little tongue-tied. say that again?' }, 502);
  }
}

