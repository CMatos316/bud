// Everyone's buds in this server, for the floating island. Members only.
import { readSession } from '../lib/session.js';
import { db, refs } from '../lib/firebase.js';
import { GUILD_ID } from '../lib/discord.js';
import { budForWorld } from '../lib/bud.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const MAX_BUDS = 200;
// Everything the world needs except the full-size paint, which is fetched only for buds without a small copy.
const FIELDS = ['trueName', 'nickname', 'outline', 'eye', 'eyeStyle', 'paintSmallJpeg', 'owner', 'updatedAt'];

export async function GET(request) {
  const session = readSession(request);
  if (!session) return json({ error: 'sign in first' }, 401);
  try {
    const buds = db().collection('guilds').doc(GUILD_ID).collection('buds');
    const snap = await buds.select(...FIELDS).limit(MAX_BUDS).get();

    // Older buds saved before the small copy existed: fall back to their full paint.
    const missing = snap.docs.filter((d) => !d.get('paintSmallJpeg'));
    const full = missing.length ? await db().getAll(...missing.map((d) => d.ref), { fieldMask: ['paintJpeg'] }) : [];
    const fullPaint = new Map(full.map((d) => [d.id, d.get('paintJpeg')]));

    // Owner display names, so a bud can say whose it is.
    const owners = snap.docs.length ? await db().getAll(...snap.docs.map((d) => refs.user(d.id)), { fieldMask: ['displayName'] }) : [];
    const names = new Map(owners.map((d) => [d.id, d.exists ? d.get('displayName') : null]));

    const list = snap.docs.map((d) => {
      const data = d.data();
      if (!data.paintSmallJpeg && fullPaint.has(d.id)) data.paintJpeg = fullPaint.get(d.id);
      return budForWorld(d.id, data, names.get(d.id), d.id === session.id);
    }).filter((b) => b.r.length === 64);

    const avatarUrl = session.avatar
      ? `https://cdn.discordapp.com/avatars/${session.id}/${session.avatar}.png?size=64`
      : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(session.id) >> 22n) % 6}.png`;
    return json({ me: { id: session.id, name: session.name, avatarUrl }, buds: list });
  } catch (err) {
    console.error('loading world failed:', err);
    return json({ error: 'could not load the world' }, 500);
  }
}
