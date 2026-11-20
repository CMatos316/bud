// Lighthouse Rock, the server's side: what you've found there and how the keeper feels about you.
// It all lives on your own user doc, under `away`:
//   { fond, hiDay, stayDay, day, taken: [index...], finds: { kind: count }, recent: [kind...], gifts: [kind...], trips }
import { db, refs } from './firebase.js';
import { FINDS, PER_DAY, GIFT_AT, dailyFinds, dayKey, fondLevel } from '../js/away.js';

const PORCH = 3;   // how many finds sit out on your porch back home

export function awayView(a, day = dayKey()) {
  a = a || {};
  return {
    fond: a.fond || 0, level: fondLevel(a.fond), met: !!a.hiDay,
    saidHi: a.hiDay === day, stayed: a.stayDay === day,
    taken: a.day === day ? (a.taken || []) : [],
    finds: a.finds || {}, recent: (a.recent || []).slice(0, PORCH), gifts: a.gifts || [], trips: a.trips || 0,
  };
}
// what a home shows on its porch: the last few kinds its bud brought back
export const porchOf = (a) => (a && Array.isArray(a.recent) ? a.recent.filter((k) => FINDS[k]).slice(0, PORCH) : []);

function keep(a, kind) {
  a.finds = { ...(a.finds || {}), [kind]: ((a.finds || {})[kind] || 0) + 1 };
  a.recent = [kind, ...(a.recent || []).filter((k) => k !== kind)].slice(0, PORCH);
}

// One thing done on the Rock: { do: 'arrive' | 'take' | 'hi' | 'stay', i? }
export async function awayAct(uid, body) {
  const what = body?.do, day = dayKey();
  if (!['arrive', 'take', 'hi', 'stay'].includes(what)) return { error: 'bad request', status: 400 };
  return db().runTransaction(async (tx) => {
    const ref = refs.user(uid), snap = await tx.get(ref), a = { ...((snap.exists && snap.get('away')) || {}) };
    const out = {};
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
    if (what === 'hi' && a.hiDay !== day) { a.hiDay = day; a.fond = (a.fond || 0) + 1; }
    if (what === 'stay' && a.stayDay !== day) { a.stayDay = day; a.fond = (a.fond || 0) + 1; }
    // once it has warmed to you, the keeper parts with its old lantern
    if ((what === 'hi' || what === 'stay') && (a.fond || 0) >= GIFT_AT && !(a.gifts || []).includes('lantern')) {
      a.gifts = [...(a.gifts || []), 'lantern']; keep(a, 'lantern'); out.gift = 'lantern';
    }
    tx.set(ref, { away: a }, { merge: true });
    return { ...out, away: awayView(a, day) };
  });
}
