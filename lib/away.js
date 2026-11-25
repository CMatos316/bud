// Lighthouse Rock, the server's side: what you've found there and how the keeper feels about you.
// It all lives on your own user doc, under `away`:
//   { fond, hiDay, stayDay, day, taken: [index...], finds: { kind: count }, recent: [kind...], gifts: [kind...], trips }
import { db, refs } from './firebase.js';
import { GUILD_ID } from './discord.js';
import { FINDS, PER_DAY, GIFT_AT, PAGES, LETTER, dailyFinds, dayKey, fondLevel } from '../js/away.js';

const PORCH = 3;   // how many finds sit out on your porch back home

export function awayView(a, day = dayKey()) {
  a = a || {};
  return {
    fond: a.fond || 0, level: fondLevel(a.fond), met: !!a.hiDay,
    saidHi: a.hiDay === day, stayed: a.stayDay === day,
    taken: a.day === day ? (a.taken || []) : [],
    finds: a.finds || {}, recent: (a.recent || []).slice(0, PORCH), gifts: a.gifts || [], trips: a.trips || 0,
    given: a.given || 0, gaveToday: a.shelfDay === day,
    known: [...new Set([...(a.known || []), ...Object.keys(a.finds || {})])].filter((k) => FINDS[k]),   // every kind you've ever found, even ones you've since given away
    pages: a.pages || [], letter: !!a.letter,   // Wick's journal pages found at the Far Tree, and whether Gloam has its letter
  };
}
// what a home shows on its porch: the last few kinds its bud brought back
export const porchOf = (a) => (a && Array.isArray(a.recent) ? a.recent.filter((k) => FINDS[k]).slice(0, PORCH) : []);

function keep(a, kind) {
  a.finds = { ...(a.finds || {}), [kind]: ((a.finds || {})[kind] || 0) + 1 };
  a.recent = [kind, ...(a.recent || []).filter((k) => k !== kind)].slice(0, PORCH);
}

// The keeper's shelf: finds that visitors have left it, the newest first. One doc for the whole island, so
// everyone sees what everyone left: guilds/{G}/meta/gloamShelf = { items: [{ kind, by, bud, day }] }.
export const SHELF_MAX = 18;
const shelfRef = () => db().collection('guilds').doc(GUILD_ID).collection('meta').doc('gloamShelf');
export async function gloamShelf() { const s = await shelfRef().get(); return ((s.exists && s.get('items')) || []).filter((i) => FINDS[i.kind]).slice(0, SHELF_MAX); }

// One thing done on the Rock: { do: 'arrive' | 'take' | 'hi' | 'stay' | 'page' | 'letter' | 'shelf', i?, n?, kind? }
export async function awayAct(uid, body) {
  const what = body?.do, day = dayKey();
  if (!['arrive', 'take', 'hi', 'stay', 'page', 'letter', 'shelf'].includes(what)) return { error: 'bad request', status: 400 };
  if (what === 'shelf' && !FINDS[body.kind]) return { error: 'bad find', status: 400 };
  if (what === 'page' && !(Number.isInteger(body.n) && body.n >= 1 && body.n < PAGES.length)) return { error: 'bad page', status: 400 };
  return db().runTransaction(async (tx) => {
    const ref = refs.user(uid), snap = await tx.get(ref), a = { ...((snap.exists && snap.get('away')) || {}) };
    const out = {};
    // A find of yours for the keeper's shelf: it leaves your pile and stays on the shelf for everyone to see. One
    // a day warms the keeper to you; more are welcome, it just won't say so.
    if (what === 'shelf') {
      const kind = body.kind, n = (a.finds || {})[kind] || 0;
      if (n < 1) return { error: 'you don’t have one of those', status: 409, away: awayView(a, day) };
      const sref = shelfRef(), sdoc = await tx.get(sref), budDoc = await tx.get(refs.bud(uid));
      a.known = [...new Set([...(a.known || []), ...Object.keys(a.finds || {})])];
      a.finds = { ...a.finds, [kind]: n - 1 }; if (!a.finds[kind]) { delete a.finds[kind]; a.recent = (a.recent || []).filter((k) => k !== kind); }
      a.given = (a.given || 0) + 1;
      if (a.shelfDay !== day) { a.shelfDay = day; a.fond = (a.fond || 0) + 1; out.warmed = true; }
      const items = [{ kind, by: uid, bud: String((budDoc.exists && (budDoc.get('nickname') || budDoc.get('trueName'))) || 'a bud').slice(0, 20), day }, ...((sdoc.exists && sdoc.get('items')) || [])].slice(0, SHELF_MAX);
      tx.set(sref, { items }); out.shelf = items;
    }
    if (what === 'arrive') a.trips = (a.trips || 0) + 1;
    if (what === 'take') {
      const i = body.i;
      if (!Number.isInteger(i) || i < 0 || i >= PER_DAY) return { error: 'bad find', status: 400 };
      if (a.day !== day) { a.day = day; a.taken = []; }
      if (a.taken.includes(i)) return { error: 'already picked up', status: 409, away: awayView(a, day) };
      a.taken = [...a.taken, i];
      out.kind = dailyFinds(day)[i].kind;
      keep(a, out.kind);
    }
    if (what === 'page' && !(a.pages || []).includes(body.n)) a.pages = [...(a.pages || []), body.n].sort((x, y) => x - y);
    // Wick's letter, handed to Gloam: once, and only if you found it
    if (what === 'letter') {
      if (!(a.pages || []).includes(LETTER)) return { error: 'no letter', status: 409 };
      if (!a.letter) { a.letter = day; a.fond = (a.fond || 0) + 2; }
    }
    if (what === 'hi' && a.hiDay !== day) { a.hiDay = day; a.fond = (a.fond || 0) + 1; }
    if (what === 'stay' && a.stayDay !== day) { a.stayDay = day; a.fond = (a.fond || 0) + 1; }
    // once it has warmed to you, the keeper parts with its old lantern
    if ((what === 'hi' || what === 'stay' || what === 'letter' || what === 'shelf') && (a.fond || 0) >= GIFT_AT && !(a.gifts || []).includes('lantern')) {
      a.gifts = [...(a.gifts || []), 'lantern']; keep(a, 'lantern'); out.gift = 'lantern';
    }
    tx.set(ref, { away: a }, { merge: true });
    return { ...out, away: awayView(a, day) };
  });
}
