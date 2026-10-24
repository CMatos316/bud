// Sticky notes: stick one on someone's bud to ask to be friends, take it back, or answer one on your own bud.
import { readSession, sameOrigin } from '../lib/session.js';
import { db, refs, Timestamp } from '../lib/firebase.js';
import { SITE_URL, sendDm, linkButton, row } from '../lib/discord.js';
import { validateNote, isDiscordId, RETRY_AFTER_MS } from '../lib/notes.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

function guard(request) {
  if (!sameOrigin(request)) return json({ error: 'wrong origin' }, 403);
  const session = readSession(request);
  if (!session) return json({ error: 'sign in first' }, 401);
  return session;
}

const budName = (snap) => (snap.exists && (snap.get('nickname') || snap.get('trueName'))) || 'your bud';
const islandButton = (label, query = '') => [row(linkButton(label, `${SITE_URL}/world${query}`))];

// Stick a note on someone's bud. If they already stuck one on yours, you're friends right away.
export async function POST(request) {
  const session = guard(request);
  if (session instanceof Response) return session;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const v = validateNote(body);
  if (!v.ok) return json({ error: v.error }, 400);
  const me = session.id, them = v.to;
  if (them === me) return json({ error: 'that’s your own bud' }, 400);

  try {
    const result = await db().runTransaction(async (tx) => {
      const [theirBud, myBud, mine, theirs, friendship] = await tx.getAll(
        refs.bud(them), refs.bud(me), refs.note(me, them), refs.note(them, me), refs.friend(me, them));
      if (!theirBud.exists) return { error: 'that bud isn’t here anymore', status: 404 };
      if (!myBud.exists) return { error: 'make your own bud first', status: 409 };
      if (friendship.exists) return { error: 'you’re already friends', status: 409 };
      if (mine.exists && mine.get('status') === 'declined' && Date.now() - (mine.get('answeredAt')?.toMillis() ?? 0) < RETRY_AFTER_MS) {
        return { error: 'they said not now. give it a few days', status: 409 };
      }
      const now = Timestamp.now();
      const base = { from: me, to: them, text: v.text, color: v.color, updatedAt: now, createdAt: mine.exists && mine.get('status') === 'pending' ? mine.get('createdAt') : now };
      if (theirs.exists && theirs.get('status') === 'pending') {
        // They asked first: both notes are answered, and you're friends.
        tx.set(refs.note(me, them), { ...base, status: 'accepted', answeredAt: now });
        tx.update(refs.note(them, me), { status: 'accepted', answeredAt: now });
        tx.set(refs.friend(me, them), { members: [me, them].sort(), since: now });
        return { friends: true, theirBud: budName(theirBud), myBud: budName(myBud) };
      }
      tx.set(refs.note(me, them), { ...base, status: 'pending' });
      return { friends: false, fresh: !(mine.exists && mine.get('status') === 'pending'), theirBud: budName(theirBud), myBud: budName(myBud) };
    });
    if (result.error) return json({ error: result.error }, result.status);

    if (result.friends) {
      await sendDm(them, {
        content: `🎉 **${session.name}** stuck a note on ${result.theirBud} right after you stuck one on theirs. You're friends now!`,
        components: islandButton('Visit the island'),
      });
    } else if (result.fresh) {
      await sendDm(them, {
        content: `📝 **${session.name}** stuck a note on ${result.theirBud}:\n> ${v.text.replace(/\n/g, '\n> ')}`,
        components: islandButton('Read it on the island', '?notes=1'),
      });
    }
    return json({ stuck: true, friends: result.friends, note: { text: v.text, color: v.color, status: result.friends ? 'accepted' : 'pending' } });
  } catch (err) {
    console.error('sticking note failed:', err);
    return json({ error: 'could not stick the note' }, 500);
  }
}

// Answer a note stuck on your bud: { from, answer: 'yes' | 'no' }
export async function PATCH(request) {
  const session = guard(request);
  if (session instanceof Response) return session;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const { from, answer } = body || {};
  if (!isDiscordId(from) || !['yes', 'no'].includes(answer)) return json({ error: 'bad answer' }, 400);
  const me = session.id;
  try {
    const result = await db().runTransaction(async (tx) => {
      const [note, theirBud] = await tx.getAll(refs.note(from, me), refs.bud(from));
      if (!note.exists || note.get('status') !== 'pending') return { error: 'that note is gone', status: 404 };
      const now = Timestamp.now();
      tx.update(refs.note(from, me), { status: answer === 'yes' ? 'accepted' : 'declined', answeredAt: now });
      if (answer === 'yes') tx.set(refs.friend(me, from), { members: [me, from].sort(), since: now });
      return { theirBud: budName(theirBud) };
    });
    if (result.error) return json({ error: result.error }, result.status);
    // Only good news gets a DM. "Not now" is quiet.
    if (answer === 'yes') {
      await sendDm(from, {
        content: `🎉 **${session.name}** said yes to the note you stuck on their bud. You're friends now!`,
        components: islandButton('Visit the island'),
      });
    }
    return json({ answered: true, friends: answer === 'yes' });
  } catch (err) {
    console.error('answering note failed:', err);
    return json({ error: 'could not answer the note' }, 500);
  }
}

// Take back a note you stuck that hasn't been answered yet: ?to=<their id>
export async function DELETE(request) {
  const session = guard(request);
  if (session instanceof Response) return session;
  const to = new URL(request.url).searchParams.get('to');
  if (!isDiscordId(to)) return json({ error: 'who?' }, 400);
  try {
    const ref = refs.note(session.id, to);
    const snap = await ref.get();
    if (snap.exists && snap.get('status') === 'pending') await ref.delete();
    return json({ removed: true });
  } catch (err) {
    console.error('removing note failed:', err);
    return json({ error: 'could not take the note back' }, 500);
  }
}
