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

// The Far Tree: the little rock with one great tree, seen from the top of the lighthouse. The humming stones on
// Lighthouse Rock take you there. Wick, who kept the lamp before Gloam, went through them long ago and never came
// back; his journal pages are tucked around the tree. Page 5 is a sealed letter for Gloam: once you've given it
// to Gloam, you can read it too.
export const FAR_TREE = 'The Far Tree';
export const PAGES = [
  null,
  'day one. the old stones on the rock hummed louder than ever this morning, so i stepped inside to see why. one blink and i was here: a scrap of rock, one enormous tree, and nothing else. gloam will be cross. i said i’d be back by supper.',
  'i know where the fallen stars come from now. they drift down slow as feathers, and this tree catches them. the ones it misses tumble off and land on the rock’s stony side. that’s all they are: the ones that got away.',
  'this tree is older than the lamp. older than the stones, i think. its seeds ride the wind to every island in the sky. every tree on that loud island to the south started right here.',
  'a tree full of stars needs someone to hang the fallen ones back up, the same way a lamp needs someone to light it. the stones would take me home. i keep meaning to go. there’s always one more star.',
  'gloam, if this ever finds you: i’m sorry about supper. i found where the stars go, and they needed a keeper more than you needed me. you never did need me as much as you think. keep the lamp lit. on clear nights i can see it from the top branches, and i wave. — wick',
];
export const LETTER = 5;
