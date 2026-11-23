// Bud Royal, the server's part: who's in the mix and what each bud's power is, and a fair deal of two stacks.
// The battle itself runs on the phones (js/royal-rules.js); this is here so nobody can deal themselves a stack.
// A bud's power comes from what its owner told it in the interview (their tagged interests, lib/interests.js):
// the category they talked about most. Someone who has switched off sharing what they're into, or hasn't done
// the interview, has a plain Islander.
import { db, refs, Timestamp, adminAuth, projectId } from './firebase.js';
import { GUILD_ID, SITE_URL, sendDmImage, row, linkButton } from './discord.js';
import { rtReady } from './party.js';
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

// every bud on the island with its looks and its power
async function island() {
  const guild = db().collection('guilds').doc(GUILD_ID);
  const [budSnap, profSnap] = await Promise.all([guild.collection('buds').select(...FIELDS).limit(MAX_BUDS).get(), guild.collection('profiles').select('tags', 'shareInterests', 'battleStyle').get()]);
  const prof = new Map(profSnap.docs.map((d) => [d.id, d.data()])), looks = {};
  for (const d of budSnap.docs) {
    const b = budForWorld(d.id, d.data(), null, false);
    if (!b.r || b.r.length !== 64) continue;
    const p = prof.get(d.id), kind = p && p.shareInterests !== false ? powerFor(p.tags, p.battleStyle) : 'islander';
    looks[d.id] = { id: d.id, name: b.nickname || b.trueName || 'a bud', r: b.r, eyeRel: b.eyeRel, eyeR: b.eyeR, eyes: b.eyes, paint: b.paint, voice: b.voice, kind };
  }
  return looks;
}
const seed32 = () => (Math.floor(Math.random() * 4294967296) >>> 0) || 1;
// two fair stacks from everyone but the people playing, and the looks of every bud that's in them
function dealFrom(looks, players) {
  const pool = Object.values(looks).filter((l) => !players.includes(l.id)).map((l) => ({ id: l.id, kind: l.kind }));
  const decks = deal(fillPool(pool), { seed: seed32() });
  if (!decks) return null;
  const buds = {}; for (const id of new Set([...players, ...decks.flat().map((c) => c.id)])) if (id && looks[id]) buds[id] = looks[id];
  return { decks, buds };
}

// A match against an island bud: your stack, theirs, whose home you're up against, and every bud's looks.
export async function dealMatch(me, myName) {
  const looks = await island();
  if (!looks[me]) return { error: 'make your bud first', status: 409 };
  const others = Object.keys(looks).filter((id) => id !== me), rival = others.length ? others[Math.floor(Math.random() * others.length)] : null;
  const d = dealFrom(looks, [me]); if (!d) return { error: 'couldn’t deal a fair match, try again', status: 503 };
  if (rival) d.buds[rival] = looks[rival];
  return { seed: seed32(), decks: d.decks, me: { id: me, name: myName }, rival: rival ? { id: rival, name: looks[rival].name } : { id: null, name: 'Mochi' }, buds: d.buds, live: rtReady() };
}

// Who's on the island, for the page's "challenge a friend" list, and your own bud for the challenge picture
export async function who(me) {
  const looks = await island(), strip = ({ kind, ...l }) => l;   // not their powers: those only show in a match
  return { me: looks[me] ? strip(looks[me]) : null, buds: Object.values(looks).filter((l) => l.id !== me).map(strip).sort((a, b) => a.name.localeCompare(b.name)), live: rtReady() };
}

/* ---------- playing a friend, live ---------- */
// A match between two people is one doc, guilds/{G}/royal/{id}: who's playing (a is side 0, b is side 1), the seed
// and both stacks (dealt here, so nobody deals their own), and when it starts. The battle runs on both phones
// (js/royal-rules.js), which only tell each other where they put their buds, through the live database: a room
// like party night's, party/royal_{id}, where each phone may write only its own two spots.
const matches = () => db().collection('guilds').doc(GUILD_ID).collection('royal');
const err = (error, status = 400) => Object.assign(new Error(error), { status, expose: true });
const OPEN_FRESH_MS = 20000, START_IN_MS = 4500, CHALLENGE_GAP_MS = 60000, MAX_PING_BYTES = 600000;
const isId = (s) => typeof s === 'string' && /^\d{5,25}$/.test(s);
const plain = (s) => String(s || '').replace(/[*_`~|>\\@#]/g, '').slice(0, 60);

function view(id, m, me, grant) {
  const side = m.a === me ? 0 : 1, them = side === 0 ? m.b : m.a;
  return {
    id, side, state: m.state, seed: m.seed || null, decks: m.decks || null, buds: m.buds ? JSON.parse(m.buds) : null,
    me: { id: me, name: side === 0 ? m.aName : m.bName }, rival: them ? { id: them, name: (m.buds && JSON.parse(m.buds)[them]?.name) || (side === 0 ? m.bName : m.aName) } : null,
    open: !!m.open, startAt: m.startAt || null, now: Date.now(), result: m.result || null, live: grant || null,
  };
}
async function grantFor(id, me, name) {
  if (!rtReady()) return null;
  const nm = String(name || 'someone').slice(0, 40), room = `royal_${id}`;
  const token = await (await adminAuth()).createCustomToken(me, { room, host: false, nm });
  return { token, uid: me, room, name: nm, config: { apiKey: process.env.FIREBASE_WEB_API_KEY.trim(), databaseURL: process.env.FIREBASE_DATABASE_URL.trim(), projectId: projectId() } };
}
function dealInto(m, looks) {
  const d = dealFrom(looks, [m.a, m.b]); if (!d) throw err('couldn’t deal a fair match, try again', 503);
  m.seed = seed32(); m.decks = d.decks; m.buds = JSON.stringify(d.buds); m.state = 'dealt';
}

// Challenge a friend: makes the match and sends them a Discord message with the picture your page drew of your
// bud looking for a fight. Only ever sent because you tapped Challenge on that person.
export async function challenge(me, myName, to, image) {
  if (!rtReady()) throw err('live matches aren’t switched on yet', 503);
  if (!isId(to) || to === me) throw err('pick someone to challenge');
  let bytes = null;
  if (typeof image === 'string' && image.startsWith('data:image/jpeg;base64,')) { bytes = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'); if (bytes.length < 1000 || bytes.length > MAX_PING_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) bytes = null; }
  const looks = await island();
  if (!looks[me]) throw err('make your bud first', 409);
  if (!looks[to]) throw err('they don’t have a bud on the island', 404);
  // one challenge a minute, so nobody's DMs get flooded
  const user = refs.user(me), wait = await db().runTransaction(async (tx) => {
    const snap = await tx.get(user), last = snap.exists ? snap.get('lastRoyalPingAt')?.toMillis() ?? 0 : 0;
    if (Date.now() - last < CHALLENGE_GAP_MS) return CHALLENGE_GAP_MS - (Date.now() - last);
    tx.set(user, { lastRoyalPingAt: Timestamp.now() }, { merge: true }); return 0;
  });
  if (wait) throw err(`give it a moment: you can challenge again in ${Math.ceil(wait / 1000)}s`, 429);
  const ref = matches().doc(), m = { a: me, aName: String(myName || 'someone').slice(0, 40), b: to, bName: looks[to].name, open: false, ready: {}, createdAt: Timestamp.now(), seenAt: Date.now() };
  dealInto(m, looks);
  await ref.set(m);
  const url = `${SITE_URL}/royal?m=${ref.id}`, mine = looks[me].name;
  let dm = false;
  if (bytes) {
    const sent = await sendDmImage(to, {
      content: `⚔️ **${plain(mine)}** (${plain(m.aName)}’s bud) is looking for a fun fight! You’ve been challenged to **Bud Royal**.\n-# Three minutes, your bud’s home against theirs.`,
      components: [row(linkButton('Accept the challenge', url))], filename: 'bud-royal-challenge.jpg', bytes, alt: `${mine} looking for a fun fight`,
    });
    dm = !!sent;
  }
  await ref.update({ dm });
  return { id: ref.id, url, dm, to: { id: to, name: looks[to].name } };
}
// The open table: sit down with whoever's waiting, or wait for whoever comes next.
export async function openTable(me, myName) {
  if (!rtReady()) throw err('live matches aren’t switched on yet', 503);
  const looks = await island();
  if (!looks[me]) throw err('make your bud first', 409);
  const waiting = await matches().where('open', '==', true).where('state', '==', 'waiting').limit(10).get();
  for (const d of waiting.docs) {
    if (d.get('a') === me || Date.now() - (d.get('seenAt') || 0) > OPEN_FRESH_MS) continue;
    const joined = await db().runTransaction(async (tx) => {
      const snap = await tx.get(d.ref), m = snap.data();
      if (!m || m.state !== 'waiting' || m.b) return false;
      m.b = me; m.bName = String(myName || 'someone').slice(0, 40); dealInto(m, looks);
      tx.set(d.ref, m); return true;
    });
    if (joined) return { id: d.id };
  }
  const ref = matches().doc();
  await ref.set({ a: me, aName: String(myName || 'someone').slice(0, 40), b: null, bName: null, open: true, state: 'waiting', ready: {}, createdAt: Timestamp.now(), seenAt: Date.now() });
  return { id: ref.id };
}
// Look at a match you're in: the deal, the way into its live room, and when it starts. Looking also says "I'm
// still here" for someone waiting at the open table.
export async function look(id, me, myName) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{10,30}$/.test(id)) throw err('no such match', 404);
  const ref = matches().doc(id), snap = await ref.get();
  if (!snap.exists) throw err('no such match', 404);
  const m = snap.data();
  if (m.a !== me && m.b !== me) throw err('that match is between two other people', 403);
  if (m.state === 'waiting' && m.a === me) await ref.update({ seenAt: Date.now() });
  return view(id, m, me, m.state === 'waiting' ? null : await grantFor(id, me, myName));
}
// "I'm loaded and connected." When both have said so, the server names the moment it starts.
export async function ready(id, me) {
  const ref = matches().doc(String(id || ''));
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref), m = snap.data();
    if (!m || (m.a !== me && m.b !== me)) throw err('no such match', 404);
    if (!m.decks) throw err('nobody’s sat down yet', 409);
    if (m.startAt) return { startAt: m.startAt, now: Date.now() };
    const rdy = { ...(m.ready || {}), [me]: true }, both = rdy[m.a] && rdy[m.b];
    tx.update(ref, both ? { ready: rdy, startAt: Date.now() + START_IN_MS, state: 'live' } : { ready: rdy });
    return { startAt: both ? Date.now() + START_IN_MS : null, now: Date.now() };
  });
}
// How it ended, as each phone saw it. It's settled when both say the same (or one of them left).
export async function report(id, me, body) {
  const ref = matches().doc(String(id || '')), winner = body?.winner === 0 || body?.winner === 1 ? body.winner : null;
  const why = ['home', 'trees', 'sudden', 'health', 'left'].includes(body?.why) ? body.why : null;
  if (!why) throw err('bad result');
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref), m = snap.data();
    if (!m || (m.a !== me && m.b !== me)) throw err('no such match', 404);
    if (m.result) return { result: m.result };
    const reports = { ...(m.reports || {}), [me]: { winner, why, tick: Math.floor(Number(body.tick) || 0), print: Math.floor(Number(body.print) || 0) } };
    const ra = reports[m.a], rb = reports[m.b], agree = ra && rb && ra.winner === rb.winner;
    const result = agree || why === 'left' ? { winner, why: agree ? ra.why : 'left', at: Date.now(), agreed: !!agree } : null;
    tx.update(ref, result ? { reports, result, state: 'done' } : { reports });
    return { result };
  });
}
