// Sign-in for the Activity (bud's games running inside a Discord voice call). Discord hands the page a
// one-time code; we swap it for the person's identity, check they're in the server, and return a signed
// session the page sends back in a header (cookies don't work inside Discord's frame).
import { APP_ID, GUILD_ID, discordApi } from '../discord.js';
import { makeSession } from '../session.js';
import { refs, FieldValue, Timestamp } from '../firebase.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function activity(request) {
  let code;
  try { ({ code } = await request.json()); } catch { return json({ error: 'bad json' }, 400); }
  if (typeof code !== 'string' || !code || code.length > 200) return json({ error: 'no code' }, 400);
  try {
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: APP_ID, client_secret: (process.env.DISCORD_CLIENT_SECRET || '').trim() }),
    });
    if (!tokenRes.ok) { console.error('activity token exchange failed:', tokenRes.status, (await tokenRes.text()).slice(0, 200)); return json({ error: 'sign-in failed' }, 401); }
    const { access_token } = await tokenRes.json();
    const meRes = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
    if (!meRes.ok) return json({ error: 'sign-in failed' }, 401);
    const me = await meRes.json();
    try { await discordApi(`/guilds/${GUILD_ID}/members/${me.id}`); }
    catch (err) { if (/\((404|403)\)/.test(err.message)) return json({ error: 'not a member of the server' }, 403); throw err; }
    const user = { id: me.id, name: me.global_name || me.username, avatar: me.avatar || null };
    const now = Timestamp.now();
    await Promise.all([
      refs.user(me.id).set({ username: me.username, displayName: user.name, avatar: user.avatar, guilds: FieldValue.arrayUnion(GUILD_ID), lastSignIn: now }, { merge: true }),
      refs.member(me.id).set({ active: true, lastSeen: now }, { merge: true }),
    ]);
    // access_token goes back too, so the page can finish signing in with Discord's SDK; we don't keep it
    return json({ session: makeSession(user), access_token, user });
  } catch (err) {
    console.error('activity sign-in failed:', err);
    return json({ error: 'sign-in failed' }, 500);
  }
}
