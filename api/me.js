// Who's signed in, and their saved bud if they have one.
import { readSession } from '../lib/session.js';
import { refs } from '../lib/firebase.js';
import { budForClient } from '../lib/bud.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request) {
  const session = readSession(request);
  if (!session) return json({ signedIn: false }, 401);
  const avatarUrl = session.avatar
    ? `https://cdn.discordapp.com/avatars/${session.id}/${session.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(session.id) >> 22n) % 6}.png`;
  try {
    const [snap, profile] = await Promise.all([refs.bud(session.id).get(), refs.profile(session.id).get()]);
    return json({
      signedIn: true,
      user: { id: session.id, name: session.name, avatarUrl },
      bud: snap.exists ? budForClient(snap.data()) : null,
      hasProfile: profile.exists,
    });
  } catch (err) {
    console.error('loading bud failed:', err);
    return json({ signedIn: true, user: { id: session.id, name: session.name, avatarUrl }, bud: null, error: 'load-failed' }, 500);
  }
}
