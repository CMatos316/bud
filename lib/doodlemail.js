// Doodle mail: draw something for a friend with Doodle Duel's brushes. The bot paints it into a picture
// (lib/raster.js) and sends it to their Discord DMs, and it's kept in their bud's inventory on the island,
// where it can replay stroke by stroke. Friends only, like every other DM bud sends between people.
// Doodles: guilds/{guild}/doodleMail/{id}. Each side can throw away their copy; the doc goes when both have.
import { db, refs, Timestamp } from './firebase.js';
import { GUILD_ID, SITE_URL, sendDmImage, linkButton, row } from './discord.js';
import { cleanStrokes } from './doodle.js';
import { paint } from './raster.js';

export const mail = () => db().collection('guilds').doc(GUILD_ID).collection('doodleMail');
const err = (message, status) => Object.assign(new Error(message), { status });
const plain = (s) => String(s ?? '').replace(/([\\*_~`|>#\[\]()<@:-])/g, '\\$1');
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const CAPTION_MAX = 80;
const KEEP_MAX = 60;            // doodles kept per person (received, and sent); the oldest unstarred go first
const GAP_MS = 20_000;          // between doodles you send
const PER_DAY = 25, PER_FRIEND_DAY = 8;
const IMAGE_PX = 640, THUMB_PX = 160;
const day = () => new Date().toISOString().slice(0, 10);

// who you're drawing for (for the page's "for Sam" label), friends only
export async function target(me, to) {
  if (me === to) throw err('draw one for a friend!', 400);
  const [friendship, user, bud] = await Promise.all([refs.friend(me, to).get(), refs.user(to).get(), refs.bud(to).get()]);
  if (!friendship.exists) throw err('you can send doodles to friends', 403);
  if (!bud.exists) throw err('that bud isn’t here anymore', 404);
  return { id: to, name: (user.exists && user.get('displayName')) || 'your friend', bud: bud.get('nickname') || bud.get('trueName') };
}

export async function send(me, myName, to, strokesIn, captionIn) {
  const strokes = cleanStrokes(strokesIn);
  const caption = clean(captionIn, CAPTION_MAX);
  const who = await target(me, to);
  const mine = await refs.bud(me).get();
  if (!mine.exists) throw err('make your bud first', 409);

  // a few limits, so nobody's DMs fill up with doodles
  const meRef = refs.user(me);
  const wait = await db().runTransaction(async (tx) => {
    const snap = await tx.get(meRef), today = day();
    const s = (snap.exists && snap.get('doodleMail')) || {};
    const fresh = s.day === today ? s : { day: today, n: 0, per: {} };
    if (Date.now() - (s.last || 0) < GAP_MS) return `one sec! you can send another in ${Math.ceil((GAP_MS - (Date.now() - s.last)) / 1000)}s`;
    if (fresh.n >= PER_DAY) return 'that’s a lot of doodles for one day! send more tomorrow';
    if ((fresh.per?.[to] || 0) >= PER_FRIEND_DAY) return `${who.name} has plenty of doodles from you today. more tomorrow!`;
    tx.set(meRef, { doodleMail: { day: today, n: fresh.n + 1, per: { ...(fresh.per || {}), [to]: (fresh.per?.[to] || 0) + 1 }, last: Date.now() } }, { merge: true });
    return '';
  });
  if (wait) throw err(wait, 429);

  const ref = mail().doc();
  const fromBud = mine.get('nickname') || mine.get('trueName');
  const doc = {
    id: ref.id, from: me, to, fromName: myName || 'someone', fromBud, toName: who.name, toBud: who.bud, caption: caption || null,
    strokes, drawMs: Math.max(...strokes.map((s) => s.p[s.p.length - 1]), 0),
    thumb: paint(strokes, THUMB_PX).toString('base64'),
    seen: false, fav: false, toKept: true, fromKept: true, dm: false, createdAt: Timestamp.now(),
  };
  await ref.set(doc);

  // the picture goes to their DMs (if Discord lets the bot reach them; it's in their inventory either way)
  const content = `🎨 **${plain(doc.fromName)}** drew you a doodle!` + (caption ? `\n> ${plain(caption)}` : '')
    + `\n-# It’s saved in ${plain(who.bud)}’s inventory on the island.`;
  const sent = await sendDmImage(to, {
    content,
    components: [row(linkButton('Watch it get drawn', `${SITE_URL}/doodle?mail=${ref.id}`), linkButton('Doodle back', `${SITE_URL}/doodle?to=${me}`))],
    filename: `doodle-from-${fromBud.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'a-friend'}.png`,
    bytes: paint(strokes, IMAGE_PX), type: 'image/png',
    alt: caption ? `A doodle: ${caption}` : `A doodle from ${doc.fromName}`,
  });
  if (sent) await ref.update({ dm: true });
  await Promise.all([trim('to', to), trim('from', me)]).catch((e) => console.warn('doodle trim failed:', e.message));
  return { id: ref.id, dm: !!sent, to: who };
}

// keep the newest KEEP_MAX on each side (starred ones stay)
async function trim(side, uid) {
  const kept = side === 'to' ? 'toKept' : 'fromKept', otherKept = side === 'to' ? 'fromKept' : 'toKept';
  const snap = await mail().where(side, '==', uid).select('createdAt', 'fav', kept, otherKept).get();
  const mineDocs = snap.docs.filter((d) => d.get(kept)).sort((a, b) => (b.get('createdAt')?.toMillis() ?? 0) - (a.get('createdAt')?.toMillis() ?? 0));
  if (mineDocs.length <= KEEP_MAX) return;
  const extra = mineDocs.slice(KEEP_MAX).filter((d) => !(side === 'to' && d.get('fav')));
  await Promise.all(extra.map((d) => (d.get(otherKept) ? d.ref.update({ [kept]: false }) : d.ref.delete())));
}

const card = (d, me) => ({
  id: d.id, mine: d.from === me, from: d.from, to: d.to, fromName: d.fromName, fromBud: d.fromBud, toName: d.toName, toBud: d.toBud,
  caption: d.caption || '', thumb: d.thumb, at: d.createdAt?.toMillis?.() ?? 0, fav: !!d.fav, seen: !!d.seen,
});

// your bud's doodle inventory: what friends sent you (starred first) and what you sent
export async function inventory(me) {
  // everything but the strokes: the thumbnails are enough for the list
  const fields = ['id', 'from', 'to', 'fromName', 'fromBud', 'toName', 'toBud', 'caption', 'thumb', 'createdAt', 'fav', 'seen', 'toKept', 'fromKept'];
  const [got, sent] = await Promise.all([
    mail().where('to', '==', me).select(...fields).get(), mail().where('from', '==', me).select(...fields).get(),
  ]);
  const byNew = (a, b) => b.at - a.at;
  return {
    got: got.docs.map((d) => d.data()).filter((d) => d.toKept).map((d) => card(d, me)).sort((a, b) => (b.fav - a.fav) || byNew(a, b)),
    sent: sent.docs.map((d) => d.data()).filter((d) => d.fromKept && d.to !== me).map((d) => card(d, me)).sort(byNew),
  };
}
// for the island: how many you have and how many are new (no pictures, so it stays light)
export async function counts(me) {
  const snap = await mail().where('to', '==', me).select('toKept', 'seen', 'createdAt', 'from', 'fromBud').get();
  const kept = snap.docs.filter((d) => d.get('toKept'));
  return {
    count: kept.length, fresh: kept.filter((d) => !d.get('seen')).length,
    recent: kept.map((d) => ({ from: d.get('from'), fromBud: d.get('fromBud'), at: d.get('createdAt')?.toMillis() ?? 0 })),
  };
}

// one doodle, with its strokes so it can replay. Opening one you got marks it seen.
export async function open(me, id) {
  const ref = mail().doc(id), snap = await ref.get();
  const d = snap.exists ? snap.data() : null;
  if (!d || !((d.to === me && d.toKept) || (d.from === me && d.fromKept))) throw err('that doodle isn’t here anymore', 404);
  if (d.to === me && !d.seen) await ref.update({ seen: true });
  return { ...card(d, me), received: d.to === me, strokes: d.strokes, drawMs: d.drawMs || 0, dm: !!d.dm };
}

export async function star(me, id, fav) {
  const ref = mail().doc(id);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get('to') !== me || !snap.get('toKept')) throw err('that doodle isn’t here anymore', 404);
    tx.update(ref, { fav: !!fav });
    return { id, fav: !!fav };
  });
}

// throw away your copy
export async function toss(me, id) {
  const ref = mail().doc(id);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw err('that doodle isn’t here anymore', 404);
    const d = snap.data(), side = d.to === me && d.toKept ? 'toKept' : d.from === me && d.fromKept ? 'fromKept' : null;
    if (!side) throw err('that doodle isn’t here anymore', 404);
    const other = side === 'toKept' ? 'fromKept' : 'toKept';
    if (d[other] && d.from !== d.to) tx.update(ref, { [side]: false }); else tx.delete(ref);
    return { id, gone: true };
  });
}
