// Everyone's buds in this server, for the floating island, with the sticky notes on them. Members only.
import { readSession } from '../lib/session.js';
import { db, refs } from '../lib/firebase.js';
import { GUILD_ID } from '../lib/discord.js';
import { budForWorld } from '../lib/bud.js';
import { RETRY_AFTER_MS } from '../lib/notes.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const MAX_BUDS = 200;
// Everything the world needs except the full-size paint, which is fetched only for buds without a small copy.
const FIELDS = ['trueName', 'nickname', 'outline', 'eye', 'eyeStyle', 'paintSmallJpeg', 'owner', 'updatedAt'];

export async function GET(request) {
  const session = readSession(request);
  if (!session) return json({ error: 'sign in first' }, 401);
  try {
    const me = session.id;
    const buds = db().collection('guilds').doc(GUILD_ID).collection('buds');
    const [snap, pending, sent, friendships] = await Promise.all([
      buds.select(...FIELDS).limit(MAX_BUDS).get(),
      // every unanswered note on the island: anyone can see that a bud has notes on it, not what they say
      refs.notes().where('status', '==', 'pending').select('from', 'to', 'color', 'text', 'createdAt').limit(2000).get(),
      refs.notes().where('from', '==', me).select('to', 'color', 'text', 'status', 'answeredAt').get(),
      refs.friends().where('members', 'array-contains', me).get(),
    ]);
    const stickies = new Map();   // bud owner -> colors of the notes stuck on it
    const inbox = [];             // notes stuck on my bud, which only I can read
    for (const n of pending.docs) {
      const { from, to, color, text, createdAt } = n.data();
      if (!stickies.has(to)) stickies.set(to, []);
      stickies.get(to).push(color);
      if (to === me) inbox.push({ from, color, text, at: createdAt?.toMillis() ?? 0 });
    }
    const mySent = new Map(sent.docs.map((n) => [n.get('to'), {
      text: n.get('text'), color: n.get('color'), status: n.get('status'),
      retryAt: n.get('status') === 'declined' ? (n.get('answeredAt')?.toMillis() ?? 0) + RETRY_AFTER_MS : null,
    }]));
    const friendIds = new Set(friendships.docs.flatMap((f) => f.get('members')).filter((id) => id !== me));

    // Older buds saved before the small copy existed: fall back to their full paint.
    const missing = snap.docs.filter((d) => !d.get('paintSmallJpeg'));
    const full = missing.length ? await db().getAll(...missing.map((d) => d.ref), { fieldMask: ['paintJpeg'] }) : [];
    const fullPaint = new Map(full.map((d) => [d.id, d.get('paintJpeg')]));

    // Owner display names, so a bud can say whose it is.
    const people = [...new Set([...snap.docs.map((d) => d.id), ...inbox.map((n) => n.from)])];
    const owners = people.length ? await db().getAll(...people.map((id) => refs.user(id)), { fieldMask: ['displayName'] }) : [];
    const names = new Map(owners.map((d) => [d.id, d.exists ? d.get('displayName') : null]));

    const list = snap.docs.map((d) => {
      const data = d.data();
      if (!data.paintSmallJpeg && fullPaint.has(d.id)) data.paintJpeg = fullPaint.get(d.id);
      return {
        ...budForWorld(d.id, data, names.get(d.id), d.id === me),
        stickies: (stickies.get(d.id) || []).slice(0, 8),
        myNote: mySent.get(d.id) || null,
        friend: friendIds.has(d.id),
      };
    }).filter((b) => b.r.length === 64);
    const budNames = new Map(list.map((b) => [b.id, b.nickname || b.trueName]));
    inbox.sort((a, b) => a.at - b.at);

    const avatarUrl = session.avatar
      ? `https://cdn.discordapp.com/avatars/${session.id}/${session.avatar}.png?size=64`
      : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(session.id) >> 22n) % 6}.png`;
    return json({
      me: { id: me, name: session.name, avatarUrl },
      buds: list,
      inbox: inbox.map((n) => ({ from: n.from, fromName: names.get(n.from) || 'someone', fromBud: budNames.get(n.from) || null, text: n.text, color: n.color })),
    });
  } catch (err) {
    console.error('loading world failed:', err);
    return json({ error: 'could not load the world' }, 500);
  }
}
