// Daily: nudge people who made a bud but skipped its questions (see vercel.json "crons").
// Safe if someone else calls it: it only ever sends each person their one nudge, and runs at most once an hour.
// If CRON_SECRET is set in Vercel, only Vercel's scheduler (which sends that secret) can run it.
import { db, Timestamp } from '../../lib/firebase.js';
import { GUILD_ID } from '../../lib/discord.js';
import { nudgeInterviews } from '../../lib/nudge.js';

export async function GET(request) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) return new Response('nope', { status: 401 });
  try {
    const lock = db().collection('guilds').doc(GUILD_ID).collection('meta').doc('nudge');
    const free = await db().runTransaction(async (tx) => {
      const snap = await tx.get(lock), last = snap.exists ? snap.get('lastRun')?.toMillis() ?? 0 : 0;
      if (Date.now() - last < 3600e3) return false;
      tx.set(lock, { lastRun: Timestamp.now() }, { merge: true });
      return true;
    });
    if (!free) return Response.json({ ran: false, why: 'ran less than an hour ago' });
    return Response.json({ ran: true, ...(await nudgeInterviews()) });
  } catch (err) {
    console.error('nudge cron failed:', err);
    return Response.json({ ran: false, error: 'failed' }, { status: 500 });
  }
}
