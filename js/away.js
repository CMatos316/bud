// Lighthouse Rock: the island the balloon ferry sails to. The parts the page (far.html, world.html) and the
// server (lib/away.js) share: what can be found there, which finds are out on a given day (the same for
// everyone, each person picks up their own), and how fond the keeper has grown of you.
import { etParts } from './seasons.js';

export const ROCK = 'Lighthouse Rock';
export const KEEPER = 'Gloam';

// kind -> name, icon, where it turns up, how common it is
export const FINDS = {
  feather: { name: 'gull feather', icon: '🪶', zone: 'meadow', w: 10 },
  clover: { name: 'four-leaf clover', icon: '🍀', zone: 'meadow', w: 4 },
  pinecone: { name: 'pinecone', icon: '🌲', zone: 'wood', w: 10 },
  mushroom: { name: 'red mushroom', icon: '🍄', zone: 'wood', w: 7 },
  acorn: { name: 'acorn', icon: '🌰', zone: 'wood', w: 8 },
  shell: { name: 'snail shell', icon: '🐚', zone: 'shore', w: 8 },
  glass: { name: 'cloud glass', icon: '💎', zone: 'shore', w: 5 },
  driftwood: { name: 'driftwood', icon: '🪵', zone: 'shore', w: 7 },
  pebble: { name: 'striped pebble', icon: '🪨', zone: 'rocks', w: 8 },
  fossil: { name: 'fossil', icon: '🦴', zone: 'rocks', w: 2.5, dig: true },
  float: { name: 'glass float', icon: '🔮', zone: 'shore', w: 1.5 },
  star: { name: 'fallen star', icon: '⭐', zone: 'rocks', w: 1.2 },
  // not found lying about: the keeper hands it over once it's warmed to you
  lantern: { name: 'the keeper’s old lantern', icon: '🏮', gift: true },
};
export const FIND_KINDS = Object.keys(FINDS).filter((k) => !FINDS[k].gift);
export const PER_DAY = 6;

// the Eastern-time day, as the key everything daily hangs off
export function dayKey(ms = Date.now()) {
  const { y, m, d } = etParts(ms);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function rng(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const seededRng = rng;

// Today's finds: [{ kind, s }], six different kinds, the rarer ones turning up less often. s is a number the page
// uses to pick the spot within the kind's part of the island.
export function dailyFinds(day) {
  const r = rng('finds:' + day), left = [...FIND_KINDS], out = [];
  for (let i = 0; i < PER_DAY; i++) {
    let t = r() * left.reduce((a, k) => a + FINDS[k].w, 0), at = 0;
    for (let j = 0; j < left.length; j++) { t -= FINDS[left[j]].w; if (t <= 0) { at = j; break; } }
    out.push({ kind: left.splice(at, 1)[0], s: r() });
  }
  return out;
}

// How the keeper feels about you. Fondness goes up by one the first time you say hello on a day, and by one more
// for keeping it company a while that day. Nothing ever takes it down.
export const FOND_STEPS = [0, 3, 8, 16];   // cold, grudging, warming, fond
export const fondLevel = (fond) => { let l = 0; for (let i = 0; i < FOND_STEPS.length; i++) if ((fond || 0) >= FOND_STEPS[i]) l = i; return l; };
export const GIFT_AT = 8;                  // the lantern
