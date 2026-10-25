// Daily question signs. Every day at 9am Eastern the island gets one light question with a few answers.
// Your bud holds a sign with your answer until 9pm, when every bud carries its sign to the campfire and tosses
// it in, all together. You can get rid of yours early by folding it into a paper airplane and throwing it off the island. If you don't answer, your bud holds up its
// own opinion in crayon, so the island always has signs. Yesterday's tally goes on a board by the campfire.
// Stored as one doc per day: guilds/{guild}/signs/{date} with answers.{uid} = { a, at, tossed }.
import { db } from './firebase.js';
import { GUILD_ID, BUDS_CHANNEL_ID, SITE_URL, discordApi, linkButton, row } from './discord.js';
import { rng, hobbyOf } from './life.js';

export const OPEN_HOUR = 9, LAUNCH_HOUR = 21;
const LAUNCH_SHOW_MS = 10 * 60e3;    // the ritual still plays if you arrive in the first 10 minutes after 9pm
const TZ = 'America/New_York';
export const signDays = () => db().collection('guilds').doc(GUILD_ID).collection('signs');

// Answers can name the hobbies that would pick them, for buds answering on their own.
// Keep answers short: they're painted on a little sign.
const Q = (text, ...choices) => ({ text, choices: choices.map((c) => (Array.isArray(c) ? { t: c[0], h: c.slice(1) } : { t: c, h: [] })) });
export const QUESTIONS = [
  Q('pineapple on pizza?', '🍍 yes!!', '🙅 never', '🤷 sometimes'),
  Q('morning or night?', ['☀️ morning', 'hopping', 'races'], ['🌙 night', 'stargazing'], ['😴 neither', 'naps']),
  Q('cats or dogs?', '🐱 cats', '🐶 dogs', '🐸 frogs'),
  Q('is cereal a soup?', '🥣 yes', '❌ no', '🤔 thinking'),
  Q('best snack at 2am?', 'chips', 'cereal', 'leftovers', ['nothing, asleep', 'naps']),
  Q('mountains or beach?', ['⛰️ mountains', 'explore'], '🏖️ beach', ['☁️ the sky', 'clouds']),
  Q('hot or iced drinks?', '🔥 hot', '🧊 iced', '🌀 both'),
  Q('would you rather fly or be invisible?', ['🕊️ fly', 'clouds', 'hopping'], '👻 invisible'),
  Q('how do you eat cereal?', 'milk first', 'cereal first', 'dry'),
  Q('rainy days are…', ['☔ cozy', 'naps'], '😩 the worst', ['💦 for puddles', 'hopping']),
  Q('best season?', '🌸 spring', '☀️ summer', ['🍂 fall', 'flowers'], '❄️ winter'),
  Q('texting style?', 'lowercase', 'Proper Caps', 'ALL CAPS', 'voice notes'),
  Q('the floor is…', ['🌋 lava', 'hopping'], '🛏️ a bed', ['🪨 for pebbles', 'pebbles']),
  Q('sweet or salty?', '🍬 sweet', '🧂 salty', '🍿 both'),
  Q('how many tabs open rn?', '1–5', '6–20', '20+', 'what’s a tab'),
  Q('best way to travel?', '🚲 bike', '🚆 train', ['✈️ plane', 'clouds'], ['🦶 walking', 'explore']),
  Q('dream pet?', '🐉 dragon', '🦦 otter', '🐧 penguin', ['🪨 a pet rock', 'pebbles']),
  Q('socks in bed?', '🧦 yes', '🦶 no way'),
  Q('game night pick?', 'board games', 'video games', 'card games', 'charades'),
  Q('music while working?', '🎧 always', '🤫 silence', '🌧️ rain sounds'),
  Q('what’s the moon made of?', ['🧀 cheese', 'stargazing'], ['🪨 rocks', 'pebbles'], '🍪 cookie'),
  Q('superpower for one day?', ['⏸️ pause time', 'naps'], '🧠 read minds', ['💨 super speed', 'races']),
  Q('breakfast for dinner?', '🥞 yes!', '🍝 no', '🌮 dinner for breakfast'),
  Q('how do you pick a game to play?', 'friends play it', 'reviews', 'it looks pretty', 'vibes'),
  Q('best sound?', ['🌧️ rain', 'naps'], '🔥 crackling fire', ['🐦 birds', 'flowers'], '🌊 waves'),
  Q('karaoke?', '🎤 hand me the mic', '👏 i’ll cheer', '🏃 i’m leaving'),
  Q('gifts: make or buy?', '🎨 make', '🛍️ buy'),
  Q('favorite shape?', '⭐ star', '🔺 triangle', ['⚪ circle', 'pebbles'], '💛 heart'),
  Q('stay in or go out?', '🛋️ stay in', ['🚪 go out', 'explore']),
  Q('which would you rather be?', ['☁️ a cloud', 'clouds'], ['🌻 a flower', 'flowers'], ['🪨 a pebble', 'pebbles'], ['⭐ a star', 'stargazing']),
  Q('how do you eat pizza crust?', 'eat it', 'leave it', 'crust first'),
  Q('spicy food?', '🌶️ bring it', '🥛 mild please'),
  Q('best time for a nap?', ['after lunch', 'naps'], 'never', 'anytime'),
  Q('how loud is your laugh?', '🤭 quiet', '😂 normal', '📢 the whole room knows'),
  Q('do you name your stuff?', '🏷️ everything', '🙂 some things', '🚫 no'),
  Q('sunrise or sunset?', ['🌅 sunrise', 'hopping'], ['🌇 sunset', 'clouds']),
  Q('if you had a boat, what would you name it?', 'Boaty', 'Sea Bean', 'Floaty McFloat', 'The Snack'),
  Q('best cookie?', '🍪 chocolate chip', '🥜 peanut butter', '🌀 snickerdoodle', '🥣 oatmeal raisin'),
  Q('your phone battery right now?', '🔋 full', '🪫 dying', '❓ don’t look'),
  Q('race you to the big tree?', ['🏃 GO', 'races'], ['🐢 i’ll walk', 'explore'], ['😴 no', 'naps']),
];

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
// one fixed shuffle of the questions, then one a day in that order, so none repeats until they've all run
const ORDER = (() => { const r = rng('sign-questions'), o = QUESTIONS.map((_, i) => i); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; })();
export function questionFor(date) {
  const day = Math.floor(Date.parse(date + 'T12:00:00Z') / 864e5);
  const i = ORDER[((day % ORDER.length) + ORDER.length) % ORDER.length];
  return { id: i, text: QUESTIONS[i].text, choices: QUESTIONS[i].choices.map((c) => c.t) };
}
// what a bud says when its person hasn't answered: something that suits its hobby, otherwise a coin flip
export function budOpinion(budId, date) {
  const q = QUESTIONS[questionFor(date).id], hobby = hobbyOf(budId);
  const liked = q.choices.findIndex((c) => c.h.includes(hobby));
  return liked >= 0 ? liked : hash(budId + ':' + date) % q.choices.length;
}

// Eastern wall-clock helpers (handles daylight saving)
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function etParts(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}
// the moment it's `hour`:00 Eastern on `date`
function etTime(date, hour) {
  const [y, m, d] = date.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, hour) + 5 * 3600e3;
  for (let i = 0; i < 3; i++) {
    const p = etParts(guess), [py, pm, pd] = p.date.split('-').map(Number);
    const diff = (Date.UTC(py, pm - 1, pd, p.hour, p.minute) - Date.UTC(y, m - 1, d, hour)) / 60e3;
    if (!diff) break;
    guess -= diff * 60e3;
  }
  return guess;
}
const shiftDate = (date, days) => new Date(Date.parse(date + 'T12:00:00Z') + days * 864e5).toISOString().slice(0, 10);

// Where the day is: 'open' (9am–9pm: signs up), 'launch' (the first minutes after 9pm: the ritual plays),
// or 'night' (no signs until 9am). `date` is the question day the signs belong to; `resultsDate` is the
// last day whose signs have flown.
export function signClock(now = Date.now()) {
  const p = etParts(now);
  let date = p.date;
  if (p.hour < OPEN_HOUR) date = shiftDate(p.date, -1);   // before 9am: last night's day
  const opensAt = etTime(date, OPEN_HOUR), launchAt = etTime(date, LAUNCH_HOUR);
  const phase = now >= opensAt && now < launchAt ? 'open' : now < launchAt + LAUNCH_SHOW_MS && now >= launchAt ? 'launch' : 'night';
  const nextOpen = phase === 'open' ? opensAt : etTime(shiftDate(date, 1), OPEN_HOUR);
  return { date, phase, opensAt, launchAt, nextOpen, resultsDate: phase === 'open' ? shiftDate(date, -1) : date };
}

// Only real people's answers count. Buds' own crayon answers are just for show on the island.
export function tally(date, answers = {}) {
  const q = questionFor(date), people = q.choices.map(() => 0);
  let total = 0;
  for (const a of Object.values(answers)) if (Number.isInteger(a?.a) && a.a >= 0 && a.a < q.choices.length) { people[a.a]++; total++; }
  return { date, question: q.text, choices: q.choices, people, total };
}

// Everything the island needs about signs for one visitor.
export async function signsForWorld(me, budIds, now = Date.now(), since = now) {
  const clock = signClock(now);
  const [today, past] = await Promise.all([
    clock.phase === 'night' ? null : signDays().doc(clock.date).get(),
    signDays().doc(clock.resultsDate).get(),
  ]);
  const out = { ...clock, now, question: questionFor(clock.date), signs: {}, mine: null, results: tally(clock.resultsDate, past.exists ? past.get('answers') : {}), diary: [] };
  // diary: tossing your own sign early, and everyone's 9pm launch
  const pastMine = past.exists ? past.get(`answers.${me}`) : null, pastLaunch = etTime(clock.resultsDate, LAUNCH_HOUR);
  if (budIds.includes(me) && pastLaunch > since && pastLaunch <= now && !pastMine?.tossed) out.diary.push({ at: pastLaunch, kind: 'sign', text: 'tossed my sign into the campfire with everyone at 9! 🔥' });
  if (today) {
    const answers = today.exists ? today.get('answers') || {} : {};
    for (const id of budIds) {
      const a = answers[id];
      if (a?.tossed) continue;
      out.signs[id] = Number.isInteger(a?.a) ? { a: a.a } : { a: budOpinion(id, clock.date), own: true };
    }
    const mine = answers[me];
    out.mine = mine ? { a: Number.isInteger(mine.a) ? mine.a : null, tossed: !!mine.tossed } : null;
    if (mine?.tossed > since) out.diary.push({ at: mine.tossed, kind: 'sign', text: 'folded our sign into a paper airplane and threw it off the island ✈' });
  }
  return out;
}

export async function answerSign(me, choice) {
  const clock = signClock();
  if (clock.phase !== 'open') throw Object.assign(new Error('signs are down for the night. new question at 9am!'), { status: 409 });
  const q = questionFor(clock.date);
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.choices.length) throw Object.assign(new Error('pick one of the answers'), { status: 400 });
  const ref = signDays().doc(clock.date);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref), mine = snap.exists ? snap.get(`answers.${me}`) : null;
    if (mine?.tossed) throw Object.assign(new Error('you already tossed today’s sign'), { status: 409 });
    tx.set(ref, { date: clock.date, answers: { [me]: { a: choice, at: Date.now(), tossed: null } } }, { merge: true });
    return { date: clock.date, a: choice };
  });
}

// Fold it into a paper airplane and throw it off the island. Your answer still counts in the tally.
export async function tossSign(me) {
  const clock = signClock();
  if (clock.phase !== 'open') throw Object.assign(new Error('the signs already went into the campfire tonight'), { status: 409 });
  const ref = signDays().doc(clock.date);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref), mine = snap.exists ? snap.get(`answers.${me}`) : null;
    tx.set(ref, { date: clock.date, answers: { [me]: { a: Number.isInteger(mine?.a) ? mine.a : null, at: mine?.at ?? Date.now(), tossed: Date.now() } } }, { merge: true });
  });
  return { tossed: true };
}

// 9am: today's question in #buds, with how yesterday went. Once a day.
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
export function resultLine(t) {
  if (!t.total) return null;
  const best = t.people.indexOf(Math.max(...t.people));
  return `${pct(t.people[best], t.total)}% said **${t.choices[best]}** to “${t.question}” (${t.total} ${t.total === 1 ? 'answer' : 'answers'})`;
}
export async function postDailyQuestion(now = Date.now()) {
  const clock = signClock(now);
  if (clock.phase !== 'open') return { posted: false, why: 'not open yet' };
  const ref = signDays().doc(clock.date), snap = await ref.get();
  if (snap.exists && snap.get('postedId')) return { posted: false, why: 'already posted' };
  const prev = await signDays().doc(clock.resultsDate).get();
  const yesterday = resultLine(tally(clock.resultsDate, prev.exists ? prev.get('answers') : {}));
  const q = questionFor(clock.date);
  const msg = await discordApi(`/channels/${BUDS_CHANNEL_ID}/messages`, {
    method: 'POST',
    body: {
      embeds: [{
        title: `🪧 ${q.text}`,
        description: `${q.choices.join('  ·  ')}\n\nAnswer and your bud holds up your sign on the island until 9pm Eastern, when every bud tosses theirs into the campfire.` + (yesterday ? `\n\n*Yesterday:* ${yesterday}` : ''),
        color: 0xFFE08A,
        footer: { text: 'today’s question · the buddie system' },
      }],
      allowed_mentions: { parse: [] },
      components: [row(linkButton('Answer on the island', `${SITE_URL}/world?sign=1`))],
    },
  });
  await ref.set({ date: clock.date, postedId: msg.id }, { merge: true });
  return { posted: true, date: clock.date };
}

// for the newsletter: the past week's questions and how they went
export async function weekOfSigns(now = Date.now()) {
  const last = signClock(now).resultsDate;
  const dates = Array.from({ length: 7 }, (_, i) => shiftDate(last, -i));
  const snaps = await db().getAll(...dates.map((d) => signDays().doc(d)));
  return snaps.filter((s) => s.exists).map((s) => tally(s.id, s.get('answers') || {})).filter((t) => t.total);
}
