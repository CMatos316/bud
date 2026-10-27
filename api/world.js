// Everyone's buds in this server, for the floating island, with the sticky notes on them. Members only.
import { readSession } from '../lib/session.js';
import { db, refs, Timestamp } from '../lib/firebase.js';
import { GUILD_ID } from '../lib/discord.js';
import { budForWorld } from '../lib/bud.js';
import { RETRY_AFTER_MS } from '../lib/notes.js';
import { latestIssue } from '../lib/newsletter.js';
import { sameOrigin } from '../lib/session.js';
import { lifeDiary, hobbyOf, HOBBY_LABEL } from '../lib/life.js';
import { games as gamesRef } from '../lib/peekaboo.js';
import { myDoodles } from '../lib/doodle.js';
import { wearing, grantOnVisit, wardrobeView } from '../lib/wardrobe.js';
import { inCommon, cleanTags, ensureTags } from '../lib/interests.js';
import { waitUntil } from '@vercel/functions';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const MAX_BUDS = 200;
// Everything the world needs except the full-size paint, which is fetched only for buds without a small copy.
const FIELDS = ['trueName', 'nickname', 'outline', 'eye', 'eyeStyle', 'paintSmallJpeg', 'owner', 'updatedAt', 'createdAt'];
const DIARY_WINDOW_MS = 12 * 3600e3;   // the diary always covers at least the last 12 hours
const DIARY_MAX = 8;

export async function GET(request) {
  const session = readSession(request);
  if (!session) return json({ error: 'sign in first' }, 401);
  try {
    const me = session.id;
    const buds = db().collection('guilds').doc(GUILD_ID).collection('buds');
    const [snap, pending, sent, friendships, meDoc, photos, profileDoc, news, gameSnap, profileSnap, allFriends] = await Promise.all([
      buds.select(...FIELDS).limit(MAX_BUDS).get(),
      // every unanswered note on the island: anyone can see that a bud has notes on it, not what they say
      refs.notes().where('status', '==', 'pending').select('from', 'to', 'color', 'text', 'createdAt').limit(2000).get(),
      refs.notes().where('from', '==', me).select('to', 'color', 'text', 'status', 'answeredAt').get(),
      refs.friends().where('members', 'array-contains', me).get(),
      refs.user(me).get(),
      // photos your bud was in (filtered by time below, so no extra index is needed)
      refs.photos().where('buds', 'array-contains', me).limit(30).get(),
      refs.profile(me).get(),
      latestIssue().catch(() => null),
      gamesRef().where('players', 'array-contains', me).get().catch(() => ({ docs: [] })),
      // everyone's tagged interests: for the props buds wear and what you have in common (never sent as-is)
      db().collection('guilds').doc(GUILD_ID).collection('profiles').select('tags', 'shareInterests').get(),
      // every friendship on the island: the friendship tree grows a heart for each
      refs.friends().select('members', 'since').limit(400).get().catch(() => ({ docs: [] })),
    ]);
    const tagsOf = new Map(profileSnap.docs.map((d) => [d.id, cleanTags(d.get('tags'))]));
    const sharing = new Set(profileSnap.docs.filter((d) => d.get('shareInterests') !== false).map((d) => d.id));
    // your own interests from before tagging existed get tagged in the background
    if (profileDoc.exists && (profileDoc.get('interests') || []).length > (profileDoc.get('tags') || []).length) {
      waitUntil(ensureTags(me).catch((err) => console.error('tagging failed:', err)));
    }
    // seasonal gear and the crown turn up in your wardrobe when you visit
    const granted = await grantOnVisit(me, meDoc.exists ? meDoc.data() : null).catch((err) => { console.error('wardrobe grant failed:', err); return null; });
    // When you were last here, so your bud can greet you to match ("oh hi again!" vs "it's been forever!").
    const lastVisit = meDoc.exists ? meDoc.get('lastIslandVisit')?.toMillis() ?? null : null;
    await refs.user(me).set({ lastIslandVisit: Timestamp.now() }, { merge: true });
    const stickies = new Map();   // bud owner -> colors of the notes stuck on it
    const inbox = [];             // notes stuck on my bud, which only I can read
    for (const n of pending.docs) {
      const { from, to, color, text, createdAt } = n.data();
      if (!stickies.has(to)) stickies.set(to, []);
      stickies.get(to).push(color);
      if (to === me) inbox.push({ from, color, text, at: createdAt?.toMillis() ?? 0 });
    }
    const mySent = new Map(sent.docs.map((n) => [n.get('to'), {
      text: n.get('text'), color: n.get('color'), status: n.get('status'),
      retryAt: n.get('status') === 'declined' ? (n.get('answeredAt')?.toMillis() ?? 0) + RETRY_AFTER_MS : null,
    }]));
    const friendIds = new Set(friendships.docs.flatMap((f) => f.get('members')).filter((id) => id !== me));

    // Older buds saved before the small copy existed: fall back to their full paint.
    const missing = snap.docs.filter((d) => !d.get('paintSmallJpeg'));
    const full = missing.length ? await db().getAll(...missing.map((d) => d.ref), { fieldMask: ['paintJpeg'] }) : [];
    const fullPaint = new Map(full.map((d) => [d.id, d.get('paintJpeg')]));

    // Owner display names, so a bud can say whose it is.
    const people = [...new Set([...snap.docs.map((d) => d.id), ...inbox.map((n) => n.from)])];
    const owners = people.length ? await db().getAll(...people.map((id) => refs.user(id)), { fieldMask: ['displayName', 'wardrobe'] }) : [];
    const names = new Map(owners.map((d) => [d.id, d.exists ? d.get('displayName') : null]));
    const wardrobes = new Map(owners.map((d) => [d.id, d.exists ? d.get('wardrobe') || null : null]));
    if (granted) wardrobes.set(me, { ...(wardrobes.get(me) || {}), items: granted.items });
    const myTags = tagsOf.get(me) || [], iShare = sharing.has(me);

    const list = snap.docs.map((d) => {
      const data = d.data();
      if (!data.paintSmallJpeg && fullPaint.has(d.id)) data.paintJpeg = fullPaint.get(d.id);
      return {
        ...budForWorld(d.id, data, names.get(d.id), d.id === me),
        stickies: (stickies.get(d.id) || []).slice(0, 8),
        myNote: mySent.get(d.id) || null,
        friend: friendIds.has(d.id),
        wear: wearing(tagsOf.get(d.id) || [], wardrobes.get(d.id)),
        // only the things you share, and only if you both said yes to showing them
        common: d.id !== me && iShare && sharing.has(d.id) ? inCommon(myTags, tagsOf.get(d.id) || []) : null,
        hobby: hobbyOf(d.id), hobbyLabel: HOBBY_LABEL[hobbyOf(d.id)],
      };
    }).filter((b) => b.r.length === 64);
    const budNames = new Map(list.map((b) => [b.id, b.nickname || b.trueName]));
    inbox.sort((a, b) => a.at - b.at);

    // Your bud's diary: what it got up to on its own, plus what other people did with it.
    const now = Date.now(), since = Math.min(lastVisit ?? now, now - DIARY_WINDOW_MS);
    let diary = [];
    if (budNames.has(me)) {
      const lives = snap.docs.map((d) => ({ id: d.id, name: budNames.get(d.id) || 'someone', createdAt: d.get('createdAt')?.toMillis() ?? 0 }));
      diary = lifeDiary(me, lives, since, now);
      for (const n of inbox) if (n.at > since) diary.push({ at: n.at, kind: 'note', text: `${names.get(n.from) || 'someone'} stuck a note on me!` });
      for (const f of friendships.docs) {
        const at = f.get('since')?.toMillis() ?? 0, other = f.get('members').find((id) => id !== me);
        if (at > since) diary.push({ at, kind: 'friend', with: other, text: `${budNames.get(other) || 'someone'} and I are friends now!` });
      }
      for (const p of photos.docs) {
        const at = p.get('createdAt')?.toMillis() ?? 0, by = p.get('by');
        if (at <= since || by === me) continue;
        const others = p.get('buds').filter((id) => id !== me).map((id) => budNames.get(id)).filter(Boolean);
        diary.push({ at, kind: 'photo', text: `${names.get(by) || 'someone'} took a photo of me${others.length ? ` with ${others.slice(0, 3).join(', ')}` : ''}!` });
      }
      for (const g of gameSnap.docs) {
        const at = g.get('finishedAt')?.toMillis() ?? 0, them = g.get('players').find((id) => id !== me);
        if (at <= since || !['done', 'resigned'].includes(g.get('status'))) continue;
        const theirBud = budNames.get(them) || 'someone';
        diary.push({ at, kind: 'game', with: them, text: g.get('winner') === me
          ? `we won Peekaboo against ${theirBud}! found every single hider 👑`
          : `${theirBud} won Peekaboo. i was hiding SO well though` });
      }
      diary = diary.sort((a, b) => b.at - a.at).slice(0, DIARY_MAX).map((e) => ({ ...e, fresh: !!lastVisit && e.at > lastVisit }));
    }

    const avatarUrl = session.avatar
      ? `https://cdn.discordapp.com/avatars/${session.id}/${session.avatar}.png?size=64`
      : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(session.id) >> 22n) % 6}.png`;
    return json({
      me: {
        id: me, name: session.name, avatarUrl, lastVisit, hasProfile: profileDoc.exists, dms: !meDoc.get?.('questionsOff'),
        // what your bud knows about you (only you see this), for your bud's card
        profile: profileDoc.exists ? {
          interests: profileDoc.get('interests') || [],
          answered: profileDoc.get('answered') ?? ((profileDoc.get('interests') || []).length ? 3 : 0),
          shareInterests: profileDoc.get('shareInterests') !== false,
        } : null,
        wardrobe: wardrobeView(myTags, wardrobes.get(me)),
        found: granted?.found || [],
      },
      buds: list,
      // the friendship tree: which buds are friends (as bud ids; the island shows bud names), newest last
      friendships: allFriends.docs.map((f) => ({ a: f.get('members')[0], b: f.get('members')[1], since: f.get('since')?.toMillis() ?? 0 }))
        .filter((f) => budNames.has(f.a) && budNames.has(f.b)).sort((x, y) => x.since - y.since),
      diary,
      // Doodle Duel games, whose turn it is
      doodles: await myDoodles(me).catch(() => []),
      games: gameSnap.docs.map((d) => d.data()).filter((g) => ['setup', 'playing'].includes(g.status)).map((g) => {
        const them = g.players.find((id) => id !== me);
        return { id: g.id, them, myTurn: g.status === 'playing' ? g.turn === me : !g.ready?.[me], status: g.status };
      }),
      news: news ? { ...news, seen: meDoc.exists && meDoc.get('newsSeen') === news.id } : null,
      inbox: inbox.map((n) => ({ from: n.from, fromName: names.get(n.from) || 'someone', fromBud: budNames.get(n.from) || null, text: n.text, color: n.color })),
    });
  } catch (err) {
    console.error('loading world failed:', err);
    return json({ error: 'could not load the world' }, 500);
  }
}

// The island remembers which Island Times issue you've read, so it only opens by itself once.
export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'wrong origin' }, 403);
  const session = readSession(request);
  if (!session) return json({ error: 'sign in first' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (typeof body?.newsSeen !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.newsSeen)) return json({ error: 'bad issue' }, 400);
  await refs.user(session.id).set({ newsSeen: body.newsSeen }, { merge: true });
  return json({ saved: true });
}
