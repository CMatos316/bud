// The island's photo booth: post a snapshot of buds to the server's #photo-booth channel.
import { readSession, sameOrigin } from '../lib/session.js';
import { db, refs, Timestamp } from '../lib/firebase.js';
import { SITE_URL, GUILD_ID, PHOTO_CHANNEL_ID, postImage, linkButton, row } from '../lib/discord.js';
import { isDiscordId } from '../lib/notes.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const MAX_IMAGE_BYTES = 2_500_000;
const MAX_BUDS = 6;
const COOLDOWN_MS = 30_000;
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
// Keep Discord formatting from turning captions into pings, links or markdown tricks.
const plain = (s) => s.replace(/([\\*_~`|>#\[\]()<@:-])/g, '\\$1');

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'wrong origin' }, 403);
  const session = readSession(request);
  if (!session) return json({ error: 'sign in first' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  const { image, caption, buds } = body || {};
  if (typeof image !== 'string' || !image.startsWith('data:image/jpeg;base64,')) return json({ error: 'bad photo' }, 400);
  const bytes = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
  if (bytes.length < 1000 || bytes.length > MAX_IMAGE_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) return json({ error: 'bad photo' }, 400);
  if (!Array.isArray(buds) || !buds.length || buds.length > MAX_BUDS || !buds.every(isDiscordId)) return json({ error: 'who’s in it?' }, 400);
  const text = clean(caption, 100);

  try {
    // one photo every 30 seconds per person, so the channel doesn't get flooded
    const me = refs.user(session.id);
    const waitMs = await db().runTransaction(async (tx) => {
      const snap = await tx.get(me);
      const last = snap.exists ? snap.get('lastPhotoAt')?.toMillis() ?? 0 : 0;
      if (Date.now() - last < COOLDOWN_MS) return COOLDOWN_MS - (Date.now() - last);
      tx.set(me, { lastPhotoAt: Timestamp.now() }, { merge: true });
      return 0;
    });
    if (waitMs) return json({ error: `the camera’s still warming up. try again in ${Math.ceil(waitMs / 1000)}s` }, 429);

    // names come from the database, not the page
    const docs = await db().getAll(...[...new Set(buds)].map((id) => refs.bud(id)), { fieldMask: ['nickname', 'trueName'] });
    const names = docs.filter((d) => d.exists).map((d) => d.get('nickname') || d.get('trueName'));
    if (!names.length) return json({ error: 'those buds aren’t here anymore' }, 404);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

    const content = `📸 **${plain(session.name)}** took a photo of ${plain(list)} on the island` + (text ? `\n> ${plain(text)}` : '');
    const msg = await postImage(PHOTO_CHANNEL_ID, {
      content,
      components: [row(linkButton('Visit the island', `${SITE_URL}/world`))],
      filename: `bud-island-${Date.now()}.jpg`,
      bytes,
      alt: `Photo of ${list} on bud island`,
    });
    await refs.photos().add({ by: session.id, buds: docs.filter((d) => d.exists).map((d) => d.id), caption: text || null, messageId: msg.id, createdAt: Timestamp.now() });
    return json({ posted: true, url: `https://discord.com/channels/${GUILD_ID}/${PHOTO_CHANNEL_ID}/${msg.id}` });
  } catch (err) {
    console.error('photo booth failed:', err);
    return json({ error: 'the photo didn’t make it to Discord. try again?' }, 502);
  }
}
