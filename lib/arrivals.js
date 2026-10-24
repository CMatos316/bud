// "Ronn just moved onto the island with @oqw! population: 12". Posted in #buds when a new bud is saved.
import { db } from './firebase.js';
import { GUILD_ID, BUDS_CHANNEL_ID, SITE_URL, discordApi, linkButton, row } from './discord.js';

const plain = (s) => String(s).replace(/([\\*_~`|>#\[\]()<@:-])/g, '\\$1');   // no markdown tricks or pings in bud names
const MILESTONES = [5, 10, 25, 50, 75, 100, 150, 200];
const LINES = [
  (b, p, n) => `🏝️ **${b}** just moved onto the island with ${p}! population: **${n}**`,
  (b, p, n) => `a new bud has landed! say hi to **${b}** (${p}’s bud). the island is now home to **${n}** buds`,
  (b, p, n) => `🌤️ **${b}** dropped in from the sky. welcome, ${p}! population: **${n}**`,
  (b, p, n) => `knock knock, it’s **${b}**! ${p}’s bud just joined the island. that makes **${n}**`,
  (b, p, n) => `🎒 **${b}** unpacked its things on the island. hi ${p}! population: **${n}**`,
];
const AGAIN = [
  (b, p, n) => `✨ ${p} made a brand new bud: **${b}**! population: **${n}**`,
  (b, p, n) => `**${b}** is the newest face on the island (${p} started fresh). population: **${n}**`,
];

// uid: the owner (shown as a mention that doesn't ping), budName, again: they had a bud before
export async function announceArrival(uid, budName, again = false) {
  const agg = await db().collection('guilds').doc(GUILD_ID).collection('buds').count().get();
  const n = agg.data().count;
  const list = again ? AGAIN : LINES;
  let content = list[Math.floor(Math.random() * list.length)](plain(budName), `<@${uid}>`, n);
  if (n === 1) content = `🏝️ **${plain(budName)}** is the very first bud on the island! welcome, <@${uid}>. population: **1**`;
  else if (MILESTONES.includes(n) && !again) content += `\n🎉 that’s **${n}** buds! the island is getting lively`;
  await discordApi(`/channels/${BUDS_CHANNEL_ID}/messages`, {
    method: 'POST',
    body: { content, allowed_mentions: { parse: [] }, components: [row(linkButton('Visit the island', `${SITE_URL}/world`))] },
  });
}
