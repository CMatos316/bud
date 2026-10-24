// Every couple of days, each bud DMs its person one new question (Claude Haiku writes it, in the bud's
// own voice). They answer right in Discord: tap a quick answer, or "Answer in my own words" for a text box.
// The bud reacts, and anything new goes into what it remembers about them (the profile used for friends).
// Gentle by design: a "Stop asking" button on every question; if questions go unanswered, bud waits longer,
// and after 3 ignored in a row it stops until they visit the island again.
import { db, refs, Timestamp } from './firebase.js';
import { GUILD_ID, SITE_URL, APP_ID, discordApi, sendDm, button, linkButton, row } from './discord.js';
import { budPersona, newQuestion, learnFromAnswer } from './interview.js';

const HOUR = 3600e3, DAY = 24 * HOUR;
export const EVERY_MS = 48 * HOUR;          // a new question this often
const IF_IGNORED_MS = 6 * DAY;              // ...or this long if the last one went unanswered
const MAX_IGNORED = 3;                      // then pause until they come back to the island
const SETTLE_MS = 12 * HOUR;                // don't DM someone who only just made their bud

const plain = (s) => String(s ?? '').replace(/([\\*_~`|>#\[\]()<@:-])/g, '\\$1');
const label = (s) => String(s).slice(0, 80);

function questionMessage(bud, q) {
  return {
    content: `**${plain(bud)}**: ${plain(q.question)}`,
    components: [
      ...(q.chips.length ? [row(...q.chips.map((c, i) => button(label(c), `q:a:${i}`, 2)))] : []),
      row(button('Answer in my own words', 'q:own', 1), button('Stop asking', 'q:stop', 2), linkButton('Visit the island', `${SITE_URL}/world`)),
    ],
  };
}

// Send everyone who's due their next question. force: skip the 48-hour wait (for /bud-nudge).
export async function sendQuestions({ force = false, limit = 40 } = {}) {
  const buds = await db().collection('guilds').doc(GUILD_ID).collection('buds').get();
  if (buds.empty) return { sent: 0, skipped: 0, due: 0 };
  const users = await db().getAll(...buds.docs.map((d) => refs.user(d.id)));
  const byId = new Map(users.map((u) => [u.id, u]));
  const now = Date.now();
  let sent = 0, skipped = 0, due = 0;

  for (const b of buds.docs) {
    if (sent >= limit) break;
    const u = byId.get(b.id), ud = u?.exists ? u.data() : {};
    if (ud.questionsOff) continue;
    if (now - (b.get('createdAt')?.toMillis() ?? 0) < SETTLE_MS) continue;
    const q = ud.q || {}, last = q.lastAskedAt?.toMillis() ?? 0;
    let ignored = q.ignored || 0;
    const unanswered = !!q.pending;
    if (unanswered && ignored >= MAX_IGNORED - 1) {
      // they've let a few go by: wait until they visit the island again
      const visited = ud.lastIslandVisit?.toMillis() ?? 0;
      if (visited <= last) continue;
      ignored = 0;
    }
    const wait = force ? 0 : unanswered ? IF_IGNORED_MS : EVERY_MS;
    if (now - last < wait) continue;
    due++;
    try { await discordApi(`/guilds/${GUILD_ID}/members/${b.id}`); } catch { skipped++; continue; }   // still in the server?

    const persona = budPersona(b.data(), b.id, { fresh: false });
    const profile = (await refs.profile(b.id).get()).data() || null;
    let question;
    try { question = await newQuestion(persona, profile, q.recent || []); } catch (err) { console.error('question failed:', err); skipped++; continue; }
    const msg = await sendDm(b.id, questionMessage(persona.name, question));
    await refs.user(b.id).set({
      q: {
        pending: msg ? { text: question.question, chips: question.chips, askedAt: Timestamp.now(), messageId: msg.id, channelId: msg.channel_id } : null,
        lastAskedAt: Timestamp.now(),
        ignored: unanswered ? ignored + 1 : 0,
        recent: [...(q.recent || []), question.question].slice(-8),
      },
    }, { merge: true });
    msg ? sent++ : skipped++;
  }
  return { sent, skipped, due };
}

// Handle a tap on one of the question buttons, or the "own words" text box. Returns a Discord response.
export async function handleQuestionInteraction(interaction, waitUntil) {
  const uid = interaction.user?.id || interaction.member?.user?.id;
  const id = interaction.data?.custom_id || '';
  const messageId = interaction.message?.id;
  const userRef = refs.user(uid);
  const userSnap = await userRef.get();
  const pending = userSnap.exists ? userSnap.get('q')?.pending : null;
  const stale = !pending || (messageId && pending.messageId !== messageId);

  if (id === 'q:stop') {
    await userRef.set({ questionsOff: true, q: { pending: null } }, { merge: true });
    return {
      type: 7,
      data: {
        content: `${interaction.message?.content || ''}\n\n*okay! I’ll stop asking. you can turn my questions back on from my card on the island.*`,
        components: [row(linkButton('Visit the island', `${SITE_URL}/world`))],
        allowed_mentions: { parse: [] },
      },
    };
  }
  if (stale) {
    return { type: 4, data: { flags: 64, content: 'that one’s an old question! I’ll ask you a new one soon.' } };
  }
  if (id === 'q:own') {
    return {
      type: 9,
      data: {
        custom_id: 'q:modal', title: 'Your answer',
        components: [row({ type: 4, custom_id: 'answer', style: 2, label: pending.text.slice(0, 45), max_length: 300, required: true, placeholder: 'type anything…' })],
      },
    };
  }
  let answer = null;
  if (id.startsWith('q:a:')) answer = pending.chips?.[Number(id.slice(4))] ?? null;
  if (id === 'q:modal') answer = interaction.data?.components?.[0]?.components?.[0]?.value ?? null;
  answer = String(answer || '').trim().slice(0, 300);
  if (!answer) return { type: 4, data: { flags: 64, content: 'hm, I didn’t catch that. try again?' } };

  // react and learn in the background; show "bud is thinking" meanwhile
  waitUntil((async () => {
    const budSnap = await refs.bud(uid).get();
    const persona = budPersona(budSnap.exists ? budSnap.data() : { trueName: 'bud' }, uid, { fresh: false });
    const pRef = refs.profile(uid), pSnap = await pRef.get(), profile = pSnap.exists ? pSnap.data() : null;
    let learned;
    try { learned = await learnFromAnswer(persona, profile, pending.text, answer); } catch (err) { console.error(err); learned = { say: 'ooh, noted!', interests: [], lookingFor: [], around: '', vibe: '' }; }
    const now = Timestamp.now();
    const merge = (a, b, n) => [...new Set([...(a || []), ...(b || [])])].slice(-n);
    await pRef.set({
      interests: merge(profile?.interests, learned.interests, 20),
      lookingFor: merge(profile?.lookingFor, learned.lookingFor, 6),
      ...(learned.around ? { around: learned.around } : {}),
      ...(learned.vibe ? { vibe: learned.vibe } : {}),
      ...(pSnap.exists ? {} : { matchable: false, createdAt: now, summary: '', source: 'questions' }),
      updatedAt: now,
    }, { merge: true });
    await userRef.set({ q: { pending: null, ignored: 0, lastAnsweredAt: now } }, { merge: true });
    await discordApi(`/webhooks/${APP_ID}/${interaction.token}/messages/@original`, {
      method: 'PATCH',
      body: {
        content: `**${plain(persona.name)}**: ${plain(pending.text)}\n> ${plain(answer)}\n**${plain(persona.name)}**: ${plain(learned.say)}`,
        components: [row(linkButton('Visit the island', `${SITE_URL}/world`))],
        allowed_mentions: { parse: [] },
      },
    }).catch((err) => console.error('editing question failed:', err));
  })());
  return { type: 6 };
}
