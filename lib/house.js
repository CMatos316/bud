// Inside a bud's home: doodles hung on the walls and finds set out on the shelves.
// Anyone on the island may step into any home and look; only the bud who lives there arranges it.
// It lives on the owner's user doc: users/{id}.house = { walls: [doodle id | null, ...], shelves: [find kind | null, ...] }.
// A wall only takes a doodle that was sent to the owner and that they've kept; a shelf only takes finds the owner
// has (and no more of a kind than they have). What's hung is the owner's choice: visitors see it, with who drew it.
import { db, refs } from './firebase.js';
import { budForWorld } from './bud.js';
import { mail } from './doodlemail.js';
import { FINDS } from '../js/away.js';

export const WALLS = 6, SHELVES = 6;
const err = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });
const isId = (s) => typeof s === 'string' && /^\d{5,25}$/.test(s);
const look = (id, d, mine) => { const b = budForWorld(id, d, null, mine); return b.r && b.r.length === 64 ? { id, name: b.nickname || b.trueName || 'a bud', r: b.r, eyeRel: b.eyeRel, eyeR: b.eyeR, eyes: b.eyes, paint: b.paint, voice: b.voice } : null; };
const fit = (list, n) => Array.from({ length: n }, (_, i) => (Array.isArray(list) ? list[i] ?? null : null));
// what the owner has to put out: every find they hold, and the keeper's lantern if they were given it
export function holdings(away) {
  const have = {};
  for (const [k, n] of Object.entries(away?.finds || {})) if (FINDS[k] && n > 0) have[k] = Math.floor(n);
  return have;
}
const hung = (d) => ({ id: d.id, thumb: d.thumb ? (String(d.thumb).startsWith('data:') ? d.thumb : `data:image/png;base64,${d.thumb}`) : null,   // stored as bare base64; the room wants a picture address
  caption: d.caption || '', from: d.fromBud || d.fromName || 'a friend', fromId: d.from, at: d.createdAt?.toMillis?.() ?? 0 });

// Look inside someone's home. Yours comes with everything you could hang or set out.
export async function houseView(owner, me) {
  if (!isId(owner)) throw err('no such home', 404);
  const mine = owner === me;
  const [budDoc, userDoc, myBud, got] = await Promise.all([
    refs.bud(owner).get(), refs.user(owner).get(), mine ? null : refs.bud(me).get(),
    mine ? mail().where('to', '==', me).select('id', 'from', 'to', 'fromName', 'fromBud', 'caption', 'thumb', 'createdAt', 'toKept', 'fav').get() : null,
  ]);
  if (!budDoc.exists) throw err('nobody lives there', 404);
  const ownerLook = look(owner, budDoc.data(), mine);
  if (!ownerLook) throw err('nobody lives there', 404);
  const house = (userDoc.exists && userDoc.get('house')) || {}, have = holdings(userDoc.exists ? userDoc.get('away') : null);
  // the shelves: only what they still have (a find given away to the keeper comes off the shelf by itself)
  const left = { ...have }, shelves = fit(house.shelves, SHELVES).map((k) => (k && left[k] > 0 ? (left[k]--, k) : null));
  // the walls: read each doodle that's hung, and leave the frame empty if it's gone or isn't theirs any more
  const ids = fit(house.walls, WALLS);
  let cards = new Map();
  if (mine) for (const d of got.docs) { const x = d.data(); if (x.toKept) cards.set(x.id || d.id, { ...x, id: x.id || d.id }); }
  else { const docs = await Promise.all(ids.filter(Boolean).map((id) => mail().doc(id).get())); for (const d of docs) if (d.exists && d.get('to') === owner && d.get('toKept')) cards.set(d.id, { ...d.data(), id: d.id }); }
  const walls = ids.map((id) => (id && cards.has(id) ? hung(cards.get(id)) : null));
  const out = { owner: ownerLook, mine, walls, shelves, you: mine ? ownerLook : myBud && myBud.exists ? look(me, myBud.data(), true) : null };
  if (mine) out.have = { doodles: [...cards.values()].map(hung).sort((a, b) => b.at - a.at), finds: have };
  return out;
}

// Rearrange your own home: { walls: [...], shelves: [...] }, each the whole row.
export async function houseSet(me, body) {
  const walls = fit(body?.walls, WALLS), shelves = fit(body?.shelves, SHELVES);
  if (walls.some((id) => id != null && (typeof id !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(id)))) throw err('bad doodle');
  if (new Set(walls.filter(Boolean)).size !== walls.filter(Boolean).length) throw err('that doodle is already hung');
  if (shelves.some((k) => k != null && !FINDS[k])) throw err('bad find');
  const [userDoc, docs] = await Promise.all([refs.user(me).get(), Promise.all(walls.filter(Boolean).map((id) => mail().doc(id).get()))]);
  for (const d of docs) if (!d.exists || d.get('to') !== me || !d.get('toKept')) throw err('you can only hang doodles you were sent and kept', 403);
  const have = holdings(userDoc.exists ? userDoc.get('away') : null), used = {};
  for (const k of shelves) if (k) { used[k] = (used[k] || 0) + 1; if (used[k] > (have[k] || 0)) throw err(`you don’t have ${used[k] > 1 ? 'another' : 'a'} ${FINDS[k].name}`, 403); }
  await refs.user(me).set({ house: { walls, shelves } }, { merge: true });
  return houseView(me, me);
}
