// The bud city: what's built on the island, worked out fresh from real data on every visit, so it's the
// same for everyone and can't be faked. Phase 1: a house for every bud, paths and lamps as the island
// grows, special buildings when enough people share an interest, and a friendship tree.
import { cleanTags } from './interests.js';

export const SHARE_TO_BUILD = 3;          // this many people into something → its building appears
export const MILESTONES = [               // population → what appears
  { at: 5, id: 'paths' }, { at: 10, id: 'lamps' }, { at: 20, id: 'benches' },
];
// interest category → building (phase 1 has these three; more come later)
export const INTEREST_BUILDINGS = { games: 'arcade', music: 'stage', sports: 'court' };

export function cityPlan({ homes, tagLists, friendships }) {
  const people = new Map(), sportFans = new Map();
  for (const tags of tagLists) {
    const cats = new Set(cleanTags(tags).map((t) => t.cat));
    for (const c of cats) people.set(c, (people.get(c) || 0) + 1);
    for (const t of cleanTags(tags)) if (t.cat === 'sports') sportFans.set(t.item, (sportFans.get(t.item) || 0) + 1);
  }
  const buildings = [];
  for (const [cat, id] of Object.entries(INTEREST_BUILDINGS)) {
    const n = people.get(cat) || 0;
    if (n < SHARE_TO_BUILD) continue;
    const b = { id, fans: n };
    if (id === 'court') b.sport = [...sportFans.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] || 'basketball';
    buildings.push(b);
  }
  if (friendships > 0) buildings.push({ id: 'friendtree', hearts: Math.min(friendships, 40) });
  const pop = homes.length;
  return { homes, buildings, extras: MILESTONES.filter((m) => pop >= m.at).map((m) => m.id), pop };
}
