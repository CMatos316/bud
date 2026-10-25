// The Island Times: a weekly newsletter about the island, posted in #buds and readable on the island.
// Built from what actually happened this week (new buds, friendships, photos, notes) plus island gossip
// from the buds' own diaries, with a short editor's note from Scoop, the bud reporter (Claude Haiku).
import { db, refs, Timestamp } from './firebase.js';
import { GUILD_ID, BUDS_CHANNEL_ID, SITE_URL, discordApi, linkButton, row } from './discord.js';
import { lifeDiary, hobbyOf, HOBBY_LABEL, rng } from './life.js';
import { editorsNote } from './interview.js';
import { weekOfSigns } from './signs.js';

const DAY = 864e5;
const plain = (s) => String(s ?? '').replace(/([\\*_~`|>#\[\]()<@:-])/g, '\\$1');
const guild = () => db().collection('guilds').doc(GUILD_ID);
export const issues = () => guild().collection('newsletters');

export async function buildIssue(now = Date.now()) {
  const since = now - 7 * DAY, sinceTs = Timestamp.fromMillis(since);
  const [budSnap, friendSnap, photoAgg, noteAgg] = await Promise.all([
    guild().collection('buds').select('nickname', 'trueName', 'createdAt').get(),
    refs.friends().where('since', '>=', sinceTs).get(),
    refs.photos().where('createdAt', '>=', sinceTs).count().get(),
    refs.notes().where('createdAt', '>=', sinceTs).count().get(),
  ]);
  const buds = budSnap.docs.map((d) => ({ id: d.id, name: d.get('nickname') || d.get('trueName') || 'a bud', createdAt: d.get('createdAt')?.toMillis() ?? 0 }));
  const nameOf = new Map(buds.map((b) => [b.id, b.name]));
  const id = new Date(now).toISOString().slice(0, 10);
  const r = rng('news:' + id);

  const newBuds = buds.filter((b) => b.createdAt >= since).sort((a, b) => a.createdAt - b.createdAt).map((b) => ({ id: b.id, name: b.name }));
  const friendships = friendSnap.docs.map((f) => f.get('members').map((m) => ({ id: m, name: nameOf.get(m) || 'a bud' }))).slice(0, 8);

  const counts = {};
  for (const b of buds) { const h = hobbyOf(b.id); counts[h] = (counts[h] || 0) + 1; }
  const [topKey, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ['clouds', 0];

  // island gossip: what buds got up to this week, from their diaries (so it matches what they tell their people)
  const shuffled = [...buds].sort(() => r() - 0.5);
  const gossip = [], used = new Set();
  for (const b of shuffled) {
    if (gossip.length >= 3 || used.has(b.id)) continue;
    const entry = lifeDiary(b.id, buds, since, now).find((e) => e.kind === 'play' && !used.has(e.with)) || null;
    if (!entry) continue;
    used.add(b.id); used.add(entry.with);
    gossip.push({ id: b.id, name: b.name, text: entry.text });
  }
  let budOfWeek = null;
  if (buds.length) {
    const pickB = buds[Math.floor(r() * buds.length)];
    const line = lifeDiary(pickB.id, buds, since, now)[0];
    budOfWeek = { id: pickB.id, name: pickB.name, hobby: HOBBY_LABEL[hobbyOf(pickB.id)], line: line ? `${line.kind === 'play' || line.kind === 'solo' ? 'I ' : ''}${line.text}` : null };
  }

  const issue = {
    id, publishedAt: now, weekStart: since, weekEnd: now,
    population: buds.length, newBuds, friendships, photos: photoAgg.data().count, notes: noteAgg.data().count,
    topHobby: { label: HOBBY_LABEL[topKey], count: topCount }, budOfWeek, gossip,
    halloween: (() => { const d = new Date(now); return (d.getUTCMonth() === 9 && d.getUTCDate() >= 17) || (d.getUTCMonth() === 10 && d.getUTCDate() <= 1); })(),
  };
  const facts = [
    `${issue.population} buds live on the island`,
    newBuds.length ? `new buds: ${newBuds.map((b) => b.name).join(', ')}` : 'no new buds this week',
    friendships.length ? `new friendships: ${friendships.map((p) => p.map((x) => x.name).join(' and ')).join('; ')}` : 'no new friendships yet',
    `${issue.photos} photos taken, ${issue.notes} sticky notes stuck`,
    `most popular hobby: ${issue.topHobby.label}`,
    ...gossip.map((g) => `${g.name} ${g.text}`),
    issue.halloween ? 'it is halloween season: pumpkins, bats and costumes on the island' : '',
  ].filter(Boolean).join('\n');
  try {
    // the week's daily questions: the most lopsided and the closest call
    const week = await weekOfSigns(now);
    issue.signs = week.map((t) => { const best = t.people.indexOf(Math.max(...t.people)); return { question: t.question, top: t.choices[best], pct: Math.round(t.people[best] / t.total * 100), total: t.total }; });
  } catch (err) { console.error('sign week failed:', err); issue.signs = []; }
  try { issue.note = await editorsNote(facts); } catch (err) { console.error('editor note failed:', err); }
  if (!issue.note) issue.note = newBuds.length ? `big week on the island! say hi to our newest neighbors.` : `a cozy week on the island. here’s what everyone got up to.`;
  return issue;
}

function embedFor(issue) {
  const date = new Date(issue.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  const names = (list) => list.map((b) => `**${plain(b.name)}**`).join(', ');
  const fields = [
    { name: '🏝️ Population', value: `**${issue.population}** buds${issue.newBuds.length ? ` (+${issue.newBuds.length} this week)` : ''}`, inline: true },
    { name: '📸 Photos', value: `**${issue.photos}** taken`, inline: true },
    { name: '📝 Notes', value: `**${issue.notes}** stuck`, inline: true },
  ];
  if (issue.newBuds.length) fields.push({ name: '🌱 New on the island', value: names(issue.newBuds).slice(0, 1000) });
  if (issue.friendships.length) fields.push({ name: '💛 New friends', value: issue.friendships.map((p) => p.map((x) => `**${plain(x.name)}**`).join(' & ')).join(' · ').slice(0, 1000) });
  if (issue.budOfWeek) fields.push({ name: '⭐ Bud of the week', value: `**${plain(issue.budOfWeek.name)}**, who loves ${plain(issue.budOfWeek.hobby)}` + (issue.budOfWeek.line ? `\n*“${plain(issue.budOfWeek.line)}”*` : '') });
  if (issue.gossip.length) fields.push({ name: '🗞️ Island gossip', value: issue.gossip.map((g) => `• **${plain(g.name)}** ${plain(g.text)}`).join('\n').slice(0, 1000) });
  if (issue.signs?.length) fields.push({ name: '🪧 This week’s questions', value: issue.signs.slice(0, 5).map((s) => `“${plain(s.question)}” → **${plain(s.top)}** (${s.pct}%)`).join('\n').slice(0, 1000) });
  fields.push({ name: '🎈 Most popular hobby', value: `${plain(issue.topHobby.label)} (${issue.topHobby.count} ${issue.topHobby.count === 1 ? 'bud' : 'buds'})` });
  return {
    title: `${issue.halloween ? '🎃 ' : '📰 '}The Island Times`,
    description: `*${date}*\n\n${plain(issue.note)}`,
    color: issue.halloween ? 0xF08A24 : 0x8DB9FF,
    fields,
    footer: { text: 'written by Scoop, the island’s bud reporter · the buddie system' },
  };
}

// Publish this week's issue (once per day at most unless forced): store it, and post it in #buds.
export async function publishIssue({ force = false } = {}) {
  const id = new Date().toISOString().slice(0, 10);
  const ref = issues().doc(id), existing = await ref.get();
  if (existing.exists && !force) return { published: false, why: 'already out today', id };
  const issue = await buildIssue();
  const msg = await discordApi(`/channels/${BUDS_CHANNEL_ID}/messages`, {
    method: 'POST',
    body: { embeds: [embedFor(issue)], allowed_mentions: { parse: [] }, components: [row(linkButton('Read it on the island', `${SITE_URL}/world?news=1`))] },
  });
  await ref.set({ ...issue, messageId: msg.id, createdAt: Timestamp.now() });
  return { published: true, id };
}

export async function latestIssue() {
  const snap = await issues().orderBy('publishedAt', 'desc').limit(1).get();
  if (snap.empty) return null;
  const { messageId, createdAt, ...issue } = snap.docs[0].data();
  return issue;
}
