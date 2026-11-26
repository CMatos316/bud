// A one-off hello from Bud to the whole server: "Happy Thanksgiving @everyone!" in #buds, on the dinner day only
// (js/away.js DINNER_DAY). A signed-in member opens /api/world?greet=thanksgiving and it goes out, once: a marker in
// the database means a second visit (by anyone) sends nothing. If Discord refuses the message the marker is taken
// away again so it can be retried.
import { db } from './firebase.js';
import { GUILD_ID, BUDS_CHANNEL_ID, discordApi } from './discord.js';
import { DINNER_DAY, dinnerOn } from '../js/away.js';

export const THANKSGIVING = 'Happy Thanksgiving @everyone! 🦃';
const ref = () => db().collection('guilds').doc(GUILD_ID).collection('meta').doc('greeting-' + DINNER_DAY);

export async function thanksgivingHello(uid) {
  if (!dinnerOn()) return { error: 'that was for one day only', status: 409 };
  const first = await db().runTransaction(async (tx) => { const d = await tx.get(ref()); if (d.exists) return false; tx.set(ref(), { by: uid, at: Date.now() }); return true; });
  if (!first) return { sent: false, already: true, note: 'Bud already said it.' };
  try {
    const msg = await discordApi(`/channels/${BUDS_CHANNEL_ID}/messages`, { method: 'POST', body: { content: THANKSGIVING, allowed_mentions: { parse: ['everyone'] } } });
    return { sent: true, pinged: !!(msg && msg.mention_everyone), url: `https://discord.com/channels/${GUILD_ID}/${BUDS_CHANNEL_ID}/${msg && msg.id}` };
  } catch (err) { await ref().delete().catch(() => {}); throw err; }
}
