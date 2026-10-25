// Daily (9am Eastern in winter, 10am in summer): post today's question sign in #buds (lib/signs.js), send bud's next question to everyone who's due one (see vercel.json "crons" and lib/questions.js),
// and on Sundays publish the Island Times newsletter (lib/newsletter.js).
// Safe if someone else calls it: each person still gets at most one question per 48 hours, and it runs
// at most once an hour. If CRON_SECRET is set in Vercel, only Vercel's scheduler can run it.
import { db, Timestamp } from '../../lib/firebase.js';
import { GUILD_ID } from '../../lib/discord.js';
import { sendQuestions } from '../../lib/questions.js';
import { publishIssue } from '../../lib/newsletter.js';
import { postDailyQuestion } from '../../lib/signs.js';

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
    // today's question sign in #buds (runs right after signs go up at 9am Eastern)
    const sign = await postDailyQuestion().catch((err) => { console.error('daily question post failed:', err); return { posted: false }; });
    const questions = await sendQuestions();
    // Sundays: this week's Island Times in #buds
    const news = new Date().getUTCDay() === 0 ? await publishIssue().catch((err) => { console.error('newsletter failed:', err); return { published: false }; }) : null;
    return Response.json({ ran: true, ...questions, sign, news });
  } catch (err) {
    console.error('question round failed:', err);
    return Response.json({ ran: false, error: 'failed' }, { status: 500 });
  }
}
