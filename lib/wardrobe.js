// What each bud owns and wears. Props come from three places:
// - interests (lib/interests.js): unlocked by what your bud learned about you, gone if you remove the interest
// - winning Peekaboo: the crown, kept for good
// - seasons: Halloween gear handed out at random (one or two pieces each, not everything), kept after
// users/{id}.wardrobe = { items: { [propId]: { from, at } }, head, hand } (head/hand: a prop id, 'none',
// or missing until they first choose, in which case the bud wears something it owns by default).
import { refs, Timestamp } from './firebase.js';
import { PROPS, SEASONAL, propsForTags } from './interests.js';

// Halloween runs Oct 17 to Nov 1, the same as the island's decorations.
export function seasonNow(d = new Date()) {
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const m = et.getMonth(), day = et.getDate();
  if ((m === 9 && day >= 17) || (m === 10 && day <= 1)) return { id: 'halloween', year: et.getFullYear(), start: new Date(et.getFullYear(), 9, 17), dayOf: m === 9 ? day - 17 : 14 + day };
  return null;
}

// the same picks for the same person every time, so nobody can reroll
function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
// Which seasonal pieces this person gets, and on which day of the season each one turns up.
export function seasonalPlan(uid, season) {
  const pool = SEASONAL[season.id] || [], r = seeded(`${uid}:${season.id}:${season.year}`);
  const order = [...pool].sort(() => r() - 0.5);
  const count = r() < 0.5 ? 1 : 2;
  return order.slice(0, count).map((id, i) => ({ id, day: i === 0 ? 0 : 2 + Math.floor(r() * 9) }));
}

const itemsOf = (w) => (w && w.items && typeof w.items === 'object' ? w.items : {});

// Everything someone can wear right now.
export function owned(tags, wardrobe) {
  return [...new Set([...propsForTags(tags), ...Object.keys(itemsOf(wardrobe))])].filter((id) => PROPS[id]);
}

// What they're wearing: their choice if they still own it, otherwise something they own.
export function wearing(tags, wardrobe, season = seasonNow()) {
  const have = owned(tags, wardrobe), w = wardrobe || {};
  const pick = (slot) => {
    const chosen = w[slot];
    if (chosen === 'none') return null;
    if (chosen && have.includes(chosen) && PROPS[chosen].slot === slot) return chosen;
    const mine = have.filter((id) => PROPS[id].slot === slot);
    if (!mine.length) return null;
    // default: seasonal gear in season, then the crown, then the first interest prop
    return (season && mine.find((id) => PROPS[id].season === season.id)) || mine.find((id) => id === 'crown') || mine.find((id) => !PROPS[id].season && id !== 'crown') || null;
  };
  return { head: pick('head'), hand: pick('hand') };
}

// On a visit: hand out any seasonal pieces that are due, and the crown to past Peekaboo winners.
// Returns the new items (so the island can say "a witch hat washed up on the shore!").
export async function grantOnVisit(uid, userDoc) {
  const w = (userDoc && userDoc.wardrobe) || {}, items = itemsOf(w), found = [], patch = {};
  const season = seasonNow();
  if (season) {
    for (const p of seasonalPlan(uid, season)) {
      if (items[p.id] || season.dayOf < p.day) continue;
      patch[p.id] = { from: `${season.id} ${season.year}`, at: Date.now() };
      found.push(p.id);
    }
  }
  if (!items.crown && userDoc?.crownUntil) patch.crown = { from: 'peekaboo', at: Date.now() };
  if (Object.keys(patch).length) await refs.user(uid).set({ wardrobe: { items: patch } }, { merge: true });
  return { items: { ...items, ...patch }, found };
}

// A Peekaboo win: the crown goes into the wardrobe for good, and on the head right away.
export const crownPatch = () => ({ wardrobe: { items: { crown: { from: 'peekaboo', at: Date.now() } }, head: 'crown' }, crownUntil: Timestamp.fromMillis(Date.now() + 24 * 3600e3) });

// For your own card: everything you own, by slot.
export function wardrobeView(tags, wardrobe) {
  const items = itemsOf(wardrobe), have = owned(tags, wardrobe), wear = wearing(tags, wardrobe);
  return {
    head: wear.head, hand: wear.hand,
    owned: have.map((id) => ({ id, slot: PROPS[id].slot, name: PROPS[id].name, icon: PROPS[id].icon, from: items[id]?.from || 'interest' })),
  };
}

// Choose what to wear ('none' takes it off). Only things you own.
export async function wear(uid, tags, wardrobe, choice) {
  const have = owned(tags, wardrobe), patch = {};
  for (const slot of ['head', 'hand']) {
    const v = choice?.[slot];
    if (v === undefined) continue;
    if (v === 'none' || (have.includes(v) && PROPS[v].slot === slot)) patch[slot] = v;
    else throw Object.assign(new Error('you don’t have that yet'), { status: 400 });
  }
  if (Object.keys(patch).length) await refs.user(uid).set({ wardrobe: patch }, { merge: true });
  return wearing(tags, { ...(wardrobe || {}), ...patch });
}
