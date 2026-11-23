// Bud Royal, the server's part: who's in the mix and what each bud's power is, and a fair deal of two stacks.
// The battle itself runs on the phones (js/royal-rules.js); this is here so nobody can deal themselves a stack.
// A bud's power comes from what its owner told it in the interview (their tagged interests, lib/interests.js):
// the category they talked about most. Someone who has switched off sharing what they're into, or hasn't done
// the interview, has a plain Islander.
import { db, refs } from './firebase.js';
import { GUILD_ID } from './discord.js';
import { budForWorld } from './bud.js';
import { cleanTags } from './interests.js';
import { CARDS, POWER_FOR, deal, fillPool } from '../js/royal-rules.js';

const FIELDS = ['trueName', 'nickname', 'outline', 'eye', 'eyeStyle', 'paintSmallJpeg', 'owner', 'voice'];
const MAX_BUDS = 200;

// the power for a set of interest tags: the category with the most tags (the earliest one if it's a tie)
export function powerFor(tags, style) {
  if (style && CARDS.includes(style)) { if (cleanTags(tags).some((t) => POWER_FOR[t.cat] === style)) return style; }
  const n = {}, order = [];
  for (const t of cleanTags(tags)) { const k = POWER_FOR[t.cat]; if (!k || k === 'islander') continue; if (!(k in n)) { n[k] = 0; order.push(k); } n[k]++; }
  let best = 'islander', most = 0;
  for (const k of order) if (n[k] > most) { most = n[k]; best = k; }
  return best;
}

// A match against an island bud: your stack, theirs, whose home you're up against, and every bud's looks.
export async function dealMatch(me, myName) {
  const guild = db().collection('guilds').doc(GUILD_ID);
  const [budSnap, profSnap] = await Promise.all([guild.collection('buds').select(...FIELDS).limit(MAX_BUDS).get(), guild.collection('profiles').select('tags', 'shareInterests', 'battleStyle').get()]);
  const prof = new Map(profSnap.docs.map((d) => [d.id, d.data()]));
  const looks = {}, pool = [], others = [];
  let mine = null;
  for (const d of budSnap.docs) {
    const b = budForWorld(d.id, d.data(), null, d.id === me);
    if (!b.r || b.r.length !== 64) continue;
    const p = prof.get(d.id), kind = p && p.shareInterests !== false ? powerFor(p.tags, p.battleStyle) : 'islander';
    const look = { id: d.id, name: b.nickname || b.trueName || 'a bud', r: b.r, eyeRel: b.eyeRel, eyeR: b.eyeR, eyes: b.eyes, paint: b.paint, voice: b.voice, kind };
    looks[d.id] = look;
    if (d.id === me) mine = look; else { pool.push({ id: d.id, kind }); others.push(d.id); }
  }
  if (!mine) return { error: 'make your bud first', status: 409 };
  const dice = { seed: (Math.floor(Math.random() * 4294967296) >>> 0) || 1 };
  const decks = deal(fillPool(pool), dice);
  if (!decks) return { error: 'couldn’t deal a fair match, try again', status: 503 };
  const rival = others.length ? others[Math.floor(Math.random() * others.length)] : null;
  const used = new Set([me, rival, ...decks.flat().map((c) => c.id)]), buds = {};
  for (const id of used) if (id && looks[id]) buds[id] = looks[id];
  return { seed: (Math.floor(Math.random() * 4294967296) >>> 0) || 1, decks, me: { id: me, name: myName }, rival: rival ? { id: rival, name: looks[rival].name } : { id: null, name: 'Mochi' }, buds };
}
