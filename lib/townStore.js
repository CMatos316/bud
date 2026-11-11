// Where the island town is kept, so homes never move: guilds/{guild}/town/plan.
//
// The first time this runs, everyone on the island gets a home and counts as a founder. After that only
// newcomers are placed (lib/town.js works out where), and the plan is saved again. A bud that leaves keeps its
// lot: the lane stays, the house doesn't, and if they come back it's still theirs.
import { db } from './firebase.js';
import { GUILD_ID } from './discord.js';
import { growTown, townForWorld } from './town.js';

const ref = () => db().collection('guilds').doc(GUILD_ID).collection('town').doc('plan');

// Firestore can't hold lists of lists, so a lane's points are stored flat: [x, z, x, z, ...]
const pack = (h) => ({
  id: h.id, x: h.x, z: h.z, rot: h.rot, kind: h.kind, by: h.by || null, at: h.at || 0, up: h.up, lim: h.lim, ring: !!h.ring,
  lane: { x0: h.lane.x0, z0: h.lane.z0, p: h.lane.pts.flat() },
});
const unpack = (h) => {
  const pts = [];
  for (let i = 0; i + 1 < h.lane.p.length; i += 2) pts.push([h.lane.p[i], h.lane.p[i + 1]]);
  return { ...h, lane: { x0: h.lane.x0, z0: h.lane.z0, pts } };
};

// buds: [{ id, at (ms they arrived) }] for everyone on the island now. Returns the town for the island page.
export async function townFor(buds) {
  const snap = await ref().get();
  const saved = snap.exists ? { ...snap.data(), homes: (snap.get('homes') || []).map(unpack) } : null;
  const here = new Set(buds.map((b) => b.id)), known = new Set((saved?.homes || []).map((h) => h.id));
  // everyone with a home keeps their place in line, even if their bud has left
  const people = (saved?.homes || []).map((h) => ({ id: h.id, at: h.at, by: h.by, founder: h.kind === 'founder', gone: !here.has(h.id) }));
  const fresh = buds.filter((b) => !known.has(b.id)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  // No saved town yet: this is the day it begins, and everyone here is a founder. Later arrivals are newcomers.
  // (Who brought them will come with invites; until then they all settle by the dock road.)
  for (const b of fresh) people.push({ id: b.id, at: b.at, by: null, founder: !saved });
  const town = growTown(people, saved);
  if (!saved || fresh.length) {
    const now = Date.now();
    await ref().set({ v: town.v, startedAt: saved?.startedAt ?? now, updatedAt: now, homes: town.homes.map(pack) });
  }
  return townForWorld(town);
}
