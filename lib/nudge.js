// "hey! it's Ronn. I have a few questions for you." A Discord DM, in their bud's voice, to people who
// made a bud but haven't done the getting-to-know-you chat yet. One nudge per person, unless a server
// manager asks again with /bud-nudge (then people last nudged over a week ago get one more).
import { db, refs, Timestamp } from './firebase.js';
import { GUILD_ID, SITE_URL, discordApi, sendDm, linkButton, row } from './discord.js';

const HOUR = 3600e3, DAY = 24 * HOUR;
const LINES = [
  (bud, who) => `hey ${who}! it’s ${bud} 👋 I have a few questions for you… got a minute?`,
  (bud, who) => `psst, ${who}. it’s ${bud}. I’ve been wanting to ask you some stuff! it won’t take long.`,
  (bud, who) => `hi ${who}!! ${bud} here. can I ask you a few questions? so I can find you some friends`,
];

// { minAgeMs: how long after making a bud before nudging, again: re-nudge people nudged over a week ago }
export async function nudgeInterviews({ minAgeMs = 6 * HOUR, again = false, limit = 40 } = {}) {
  const buds = await db().collection('guilds').doc(GUILD_ID).collection('buds').select('nickname', 'trueName', 'createdAt').get();
  const profiles = await db().collection('guilds').doc(GUILD_ID).collection('profiles').select().get();
  const known = new Set(profiles.docs.map((d) => d.id));
  const now = Date.now();
  const waiting = buds.docs.filter((d) => !known.has(d.id) && now - (d.get('createdAt')?.toMillis() ?? 0) >= minAgeMs);
  if (!waiting.length) return { sent: 0, skipped: 0, waiting: 0 };

  const users = await db().getAll(...waiting.map((d) => refs.user(d.id)), { fieldMask: ['displayName', 'interviewNudgedAt'] });
  const byId = new Map(users.map((u) => [u.id, u]));
  let sent = 0, skipped = 0;
  for (const d of waiting) {
    if (sent >= limit) break;
    const u = byId.get(d.id), last = u?.exists ? u.get('interviewNudgedAt')?.toMillis() ?? 0 : 0;
    if (last && !(again && now - last > 7 * DAY)) { skipped++; continue; }
    // still in the server?
    try { await discordApi(`/guilds/${GUILD_ID}/members/${d.id}`); } catch { skipped++; continue; }
    const bud = d.get('nickname') || d.get('trueName') || 'your bud';
    const who = (u?.exists && u.get('displayName')) || 'you';
    const line = LINES[Math.floor(Math.random() * LINES.length)](bud, who);
    const ok = await sendDm(d.id, { content: line, components: [row(linkButton(`Answer ${bud}’s questions`, `${SITE_URL}/?chat=1`))] });
    // remember the attempt either way, so someone with DMs off isn't retried every day
    await refs.user(d.id).set({ interviewNudgedAt: Timestamp.now(), interviewNudgeDelivered: ok }, { merge: true });
    ok ? sent++ : skipped++;
  }
  return { sent, skipped, waiting: waiting.length };
}
