// Buds have lives of their own, even when nobody is watching.
// There's no server running all the time, so a bud's life is worked out from the clock: time is cut into
// 3-hour stretches, and in each one every bud is paired up with another bud (or goes off on its own) using
// a shuffle seeded by that stretch. So when Bean played tag with Mochi at 3pm, Mochi's diary says so too,
// and nothing needs to be stored.

export const SLOT_MS = 3 * 3600e3;
const MAX_SLOTS = 16;            // look back at most two days
export const HOBBIES = ['clouds', 'explore', 'flowers', 'pebbles', 'hopping', 'naps', 'races', 'stargazing'];
export const HOBBY_LABEL = {
  clouds: 'cloud watching', explore: 'exploring', flowers: 'smelling flowers', pebbles: 'collecting pebbles',
  hopping: 'hopping', naps: 'naps', races: 'racing', stargazing: 'stargazing',
};

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed) {
  let a = hash(String(seed));
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

export const hobbyOf = (id) => HOBBIES[hash('hobby:' + id) % HOBBIES.length];

// Things two buds do together. Each returns what *this* bud would write; `first` is whether it's the
// first of the pair, so both diaries tell the same story from opposite sides.
const TOGETHER = [
  (o, r, first) => (first === r() < 0.5 ? `played tag with ${o}. I was "it" for ages` : `played tag with ${o} and never got caught`),
  (o, r, first) => (first === r() < 0.5 ? `raced ${o} to the big tree and won!` : `raced ${o} to the big tree. so close!`),
  (o) => `watched clouds with ${o}. one looked like a sandwich`,
  (o, r, first) => (first === r() < 0.5 ? `played hide and seek with ${o}. I hid behind a rock` : `played hide and seek. ${o} hid behind a rock (I saw)`),
  (o) => `shared a snack with ${o}`,
  (o) => `went exploring with ${o} all the way to the edge`,
  (o) => `practiced big hops with ${o}`,
  (o) => `counted flowers with ${o}. we lost count twice`,
];
const ALONE = {
  clouds: ['watched the clouds go by', 'found a cloud shaped like you'],
  explore: ['explored the edge of the island. sooo high up', 'found a secret spot behind the trees'],
  flowers: ['smelled every flower on the hill', 'found a new kind of flower!'],
  pebbles: ['found a really shiny pebble', 'added a pebble to my collection'],
  hopping: ['practiced hopping. I can do three in a row now', 'hopped all the way around the big tree'],
  naps: ['took a nap under a tree', 'had a dream about a giant snack'],
  races: ['raced my own shadow. it was a tie', 'ran laps around the island'],
  stargazing: ['stayed up to look at the stars', 'saw a shooting star and made a wish'],
  any: ['counted flowers. got to 37 then forgot', 'rolled down the hill', 'sat and listened to the wind'],
};

// buds: [{ id, name, createdAt (ms) }]. Returns diary entries for `me` between `since` and `now`, newest first.
export function lifeDiary(me, buds, since, now) {
  if (!since || now - since < 20 * 60e3) return [];
  const names = new Map(buds.map((b) => [b.id, b.name]));
  const first = Math.max(Math.floor(since / SLOT_MS) + 1, Math.floor(now / SLOT_MS) - MAX_SLOTS);
  const last = Math.floor(now / SLOT_MS) - 1;   // only stretches that are over
  const out = [];
  for (let k = first; k <= last; k++) {
    const start = k * SLOT_MS;
    const here = buds.filter((b) => (b.createdAt ?? 0) <= start).map((b) => b.id).sort();
    if (!here.includes(me)) continue;
    // shuffle everyone on the island for this stretch, then pair them off
    const r = rng('slot:' + k);
    for (let i = here.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [here[i], here[j]] = [here[j], here[i]]; }
    const idx = here.indexOf(me), mate = idx ^ 1;
    const pairKey = mate < here.length ? [here[idx], here[mate]].sort().join('+') : null;
    const pr = rng(`act:${k}:${pairKey || me}`);
    const at = start + Math.floor(pr() * SLOT_MS * 0.9);
    if (at <= since || at >= now) continue;
    if (pairKey && pr() < 0.7) {
      const other = here[mate], meFirst = pairKey.startsWith(me + '+');
      const make = pick(pr, TOGETHER);
      out.push({ at, kind: 'play', with: other, text: make(names.get(other) || 'a friend', pr, meFirst) });
    } else {
      const own = rng(`solo:${k}:${me}`);
      const list = own() < 0.65 ? ALONE[hobbyOf(me)] : ALONE.any;
      out.push({ at, kind: 'solo', text: pick(own, list) });
    }
  }
  // newest first, and no saying the exact same thing twice
  const seen = new Set();
  return out.reverse().filter((e) => !seen.has(e.text) && seen.add(e.text));
}
