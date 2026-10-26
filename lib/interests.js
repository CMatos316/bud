// What people are into, in a shape the island can use: each interest is tagged with a category and the
// specific thing ({ label: 'basketball', cat: 'sports', item: 'basketball' }). Tags drive the props buds can
// wear, "you have this in common" on other buds' cards, and the city's special buildings.
import { db, refs, FieldValue, Timestamp } from './firebase.js';
import { GUILD_ID } from './discord.js';
import { callClaude, tidy } from './ai.js';

export const CATS = ['music', 'movies', 'games', 'sports', 'reading', 'anime', 'art', 'photography', 'cooking', 'food',
  'tech', 'nature', 'fishing', 'pets', 'fitness', 'fashion', 'dance', 'travel', 'other'];

// Topics for the longer interview, in the order the bud gets to them (skipping ones already covered).
export const TOPICS = [
  { id: 'music', ask: 'music: what they listen to, or play' },
  { id: 'movies', ask: 'movies and shows: what they watch, favorite genre' },
  { id: 'games', ask: 'games: video games, board games, which ones' },
  { id: 'sports', ask: 'sports: which sport they play or watch, maybe a team' },
  { id: 'friend', ask: 'what they would love a friend for (playing together, watching stuff, chatting, going places)' },
  { id: 'reading', ask: 'books, anime or manga' },
  { id: 'food', ask: 'food: favorite food, cooking or baking' },
  { id: 'making', ask: 'making things: drawing, music, building, coding, crafts, photography' },
  { id: 'around', ask: 'when they are usually around and online (evenings, weekends, late night)' },
  { id: 'outdoors', ask: 'outdoors and nature: hiking, fishing, gardening, the beach' },
  { id: 'pets', ask: 'pets: if they have one, or what they would want' },
  { id: 'style', ask: 'style and fashion, or a fun random favorite thing' },
];
export const MAX_TOTAL = 10;   // questions in all (the first 3 at onboarding, then up to 7 more when they want)

export const TAG_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'Short lowercase label as they would say it, e.g. "basketball", "horror movies", "lofi", "valorant".' },
    cat: { type: 'string', enum: CATS, description: 'The category.' },
    item: { type: 'string', description: 'The specific thing in a single lowercase word or two, e.g. "basketball", "horror", "lofi", "valorant", "guitar", "cat", "baking". For music, say "guitar", "piano", "drums", "singing" or "dj" if they play or sing, otherwise the genre.' },
  },
  required: ['label', 'cat', 'item'],
};

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
export const tagKey = (t) => `${t.cat}:${slug(t.item)}`;

export function cleanTags(list, max = 30) {
  const seen = new Set(), out = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (!t || typeof t !== 'object') continue;
    const tag = { label: tidy(t.label, 32).toLowerCase(), cat: CATS.includes(t.cat) ? t.cat : 'other', item: tidy(t.item, 32).toLowerCase() };
    if (!tag.label) continue;
    if (!tag.item) tag.item = tag.label;
    const k = tagKey(tag);
    if (seen.has(k)) continue;
    seen.add(k); out.push(tag);
  }
  return out.slice(-max);
}

/* ---------- props: what each interest lets a bud wear ---------- */
// slot 'head' (on the head or face) or 'hand' (held, or sitting beside the bud)
export const PROPS = {
  headphones: { slot: 'head', name: 'Headphones', icon: '🎧' },
  glasses3d: { slot: 'head', name: '3D glasses', icon: '🕶️' },
  readers: { slot: 'head', name: 'Reading glasses', icon: '👓' },
  beret: { slot: 'head', name: 'Beret', icon: '🎨' },
  chefhat: { slot: 'head', name: 'Chef hat', icon: '👨‍🍳' },
  flowercrown: { slot: 'head', name: 'Flower crown', icon: '🌼' },
  buckethat: { slot: 'head', name: 'Bucket hat', icon: '🎣' },
  headband: { slot: 'head', name: 'Headband', icon: '🎌' },
  sweatband: { slot: 'head', name: 'Sweatband', icon: '💪' },
  crown: { slot: 'head', name: 'Peekaboo crown', icon: '👑' },
  witch: { slot: 'head', name: 'Witch hat', icon: '🧙', season: 'halloween' },
  horns: { slot: 'head', name: 'Devil horns', icon: '😈', season: 'halloween' },
  ears: { slot: 'head', name: 'Cat ears', icon: '🐱', season: 'halloween' },
  pumpkin: { slot: 'head', name: 'Pumpkin hat', icon: '🎃', season: 'halloween' },
  controller: { slot: 'hand', name: 'Controller', icon: '🎮' },
  popcorn: { slot: 'hand', name: 'Popcorn', icon: '🍿' },
  guitar: { slot: 'hand', name: 'Guitar', icon: '🎸' },
  mic: { slot: 'hand', name: 'Microphone', icon: '🎤' },
  drums: { slot: 'hand', name: 'Drum', icon: '🥁' },
  basketball: { slot: 'hand', name: 'Basketball', icon: '🏀' },
  soccer: { slot: 'hand', name: 'Soccer ball', icon: '⚽' },
  football: { slot: 'hand', name: 'Football', icon: '🏈' },
  baseball: { slot: 'hand', name: 'Baseball bat', icon: '⚾' },
  tennis: { slot: 'hand', name: 'Tennis racket', icon: '🎾' },
  volleyball: { slot: 'hand', name: 'Volleyball', icon: '🏐' },
  hockey: { slot: 'hand', name: 'Hockey stick', icon: '🏒' },
  skateboard: { slot: 'hand', name: 'Skateboard', icon: '🛹' },
  dumbbell: { slot: 'hand', name: 'Dumbbell', icon: '🏋️' },
  books: { slot: 'hand', name: 'Stack of books', icon: '📚' },
  manga: { slot: 'hand', name: 'Manga', icon: '📖' },
  palette: { slot: 'hand', name: 'Paint palette', icon: '🎨' },
  camera: { slot: 'hand', name: 'Camera', icon: '📷' },
  pan: { slot: 'hand', name: 'Frying pan', icon: '🍳' },
  laptop: { slot: 'hand', name: 'Laptop', icon: '💻' },
  wateringcan: { slot: 'hand', name: 'Watering can', icon: '🪴' },
  rod: { slot: 'hand', name: 'Fishing rod', icon: '🎣' },
  petcat: { slot: 'hand', name: 'Pet cat', icon: '🐈' },
  petdog: { slot: 'hand', name: 'Pet dog', icon: '🐕' },
};
export const SEASONAL = { halloween: ['witch', 'horns', 'ears', 'pumpkin'] };

const has = (item, words) => words.some((w) => item.includes(w));
// The props one tag unlocks ([] if there's no prop for it yet).
export function propsForTag(t) {
  const i = t.item || '', l = t.label || '';
  const both = `${i} ${l}`;
  switch (t.cat) {
    case 'music':
      if (has(both, ['guitar', 'bass', 'ukulele'])) return ['guitar', 'headphones'];
      if (has(both, ['sing', 'karaoke', 'vocal', 'choir'])) return ['mic', 'headphones'];
      if (has(both, ['drum', 'percussion'])) return ['drums', 'headphones'];
      return ['headphones'];
    case 'movies': return ['glasses3d', 'popcorn'];
    case 'games': return ['controller'];
    case 'sports':
      if (has(both, ['basketball', 'nba'])) return ['basketball', 'sweatband'];
      if (has(both, ['soccer', 'futbol', 'fútbol'])) return ['soccer'];
      if (has(both, ['football', 'nfl'])) return ['football'];
      if (has(both, ['baseball', 'softball', 'mlb'])) return ['baseball'];
      if (has(both, ['tennis', 'pickleball', 'badminton'])) return ['tennis'];
      if (has(both, ['volleyball'])) return ['volleyball'];
      if (has(both, ['hockey', 'nhl'])) return ['hockey'];
      if (has(both, ['skate'])) return ['skateboard'];
      return [];
    case 'fitness': return has(both, ['skate']) ? ['skateboard'] : ['dumbbell', 'sweatband'];
    case 'reading': return ['books', 'readers'];
    case 'anime': return ['manga', 'headband'];
    case 'art': return ['palette', 'beret'];
    case 'photography': return ['camera'];
    case 'cooking': return ['pan', 'chefhat'];
    case 'food': return has(both, ['cook', 'bak', 'chef']) ? ['pan', 'chefhat'] : [];
    case 'tech': return ['laptop'];
    case 'nature': return has(both, ['fish']) ? ['rod', 'buckethat'] : ['wateringcan', 'flowercrown'];
    case 'fishing': return ['rod', 'buckethat'];
    case 'pets':
      if (has(both, ['cat', 'kitten'])) return ['petcat'];
      if (has(both, ['dog', 'puppy', 'pup'])) return ['petdog'];
      return [];
    default: return [];
  }
}
export function propsForTags(tags) {
  return [...new Set((tags || []).flatMap(propsForTag))].filter((p) => PROPS[p]);
}

// Interests with no prop yet go on a wishlist, so the most wanted props get made first (/bud-props).
const wishlist = () => db().collection('guilds').doc(GUILD_ID).collection('propWishlist');
export async function noteWishes(uid, tags) {
  const wants = (tags || []).filter((t) => !propsForTag(t).length);
  await Promise.all(wants.map((t) => wishlist().doc(slug(`${t.cat}-${t.item}`) || 'unknown').set({
    label: t.label, cat: t.cat, item: t.item, people: FieldValue.arrayUnion(uid), lastAt: Timestamp.now(),
  }, { merge: true })));
}
export async function topWishes(n = 10) {
  const snap = await wishlist().get();
  return snap.docs.map((d) => ({ ...d.data(), count: (d.get('people') || []).length }))
    .sort((a, b) => b.count - a.count).slice(0, n);
}

/* ---------- what two people have in common (words only, never a number) ---------- */
export function inCommon(a, b) {
  const A = cleanTags(a), B = cleanTags(b);
  const bKeys = new Set(B.map(tagKey)), bCats = new Map();
  B.forEach((t) => { if (!bCats.has(t.cat)) bCats.set(t.cat, t); });
  const exact = A.filter((t) => bKeys.has(tagKey(t)));
  const exactCats = new Set(exact.map((t) => t.cat));
  const sameCat = [];
  for (const t of A) if (!exactCats.has(t.cat) && t.cat !== 'other' && bCats.has(t.cat) && !sameCat.some((s) => s.cat === t.cat)) sameCat.push(t);
  const score = exact.length * 2 + sameCat.length;
  const level = score >= 6 ? 'lots' : score >= 3 ? 'some' : score >= 1 ? 'little' : 'none';
  const CAT_WORD = { music: 'music', movies: 'movies and shows', games: 'games', sports: 'sports', reading: 'books', anime: 'anime', art: 'art', photography: 'photography', cooking: 'cooking', food: 'food', tech: 'tech', nature: 'the outdoors', fishing: 'fishing', pets: 'pets', fitness: 'working out', fashion: 'fashion', dance: 'dancing', travel: 'travel' };
  const things = [...exact.map((t) => t.label), ...sameCat.map((t) => CAT_WORD[t.cat] || t.cat)];
  return { level, things: [...new Set(things)].slice(0, 5), top: exact[0]?.label || null };
}

/* ---------- tagging plain interest labels (older profiles, and answers to question DMs) ---------- */
const TAGS_TOOL = {
  name: 'tag_interests',
  description: 'Tag each interest with a category and the specific thing.',
  input_schema: { type: 'object', properties: { tags: { type: 'array', items: TAG_SCHEMA } }, required: ['tags'] },
};
export async function tagLabels(labels) {
  const list = [...new Set((labels || []).map((l) => tidy(l, 40).toLowerCase()).filter(Boolean))].slice(0, 30);
  if (!list.length) return [];
  const out = await callClaude({
    system: `You sort people's interests for a friendly Discord community app. For each interest label, give back the same label with its category and the specific thing. Keep labels as given. Categories: ${CATS.join(', ')}. Always answer by calling the tag_interests tool.`,
    messages: [{ role: 'user', content: `interests:\n- ${list.join('\n- ')}` }],
    tool: TAGS_TOOL, maxTokens: 900,
  });
  const byLabel = new Map(cleanTags(out.tags, 40).map((t) => [t.label, t]));
  return list.map((l) => byLabel.get(l) || { label: l, cat: 'other', item: l });
}

// Make sure every interest on a profile has a tag (tags for removed interests go too).
export async function ensureTags(uid) {
  const ref = refs.profile(uid), snap = await ref.get();
  if (!snap.exists) return null;
  const p = snap.data(), interests = (p.interests || []).map((l) => String(l).toLowerCase());
  const tags = cleanTags(p.tags).filter((t) => interests.includes(t.label));
  const missing = interests.filter((l) => !tags.some((t) => t.label === l));
  if (!missing.length && tags.length === (p.tags || []).length) return tags;
  const added = missing.length ? await tagLabels(missing) : [];
  const all = cleanTags([...tags, ...added], 40);
  await ref.set({ tags: all, updatedAt: Timestamp.now() }, { merge: true });
  await noteWishes(uid, added).catch(() => {});
  return all;
}

// Daily: tag profiles that have untagged interests (older interviews, question DM answers).
export async function retagProfiles(limit = 25) {
  const snap = await db().collection('guilds').doc(GUILD_ID).collection('profiles').get();
  let done = 0;
  for (const d of snap.docs) {
    if (done >= limit) break;
    const p = d.data(), interests = (p.interests || []).map((l) => String(l).toLowerCase());
    const tagged = new Set(cleanTags(p.tags).map((t) => t.label));
    if (!interests.some((l) => !tagged.has(l)) && (p.tags || []).length <= interests.length) continue;
    try { await ensureTags(d.id); done++; } catch (err) { console.error('retag failed for', d.id, err); }
  }
  return done;
}
