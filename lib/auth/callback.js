// Discord sends people back here after they approve. We swap the code for their Discord identity,
// make sure they're in the server, remember them, and set the session cookie.
import { APP_ID, SITE_URL, GUILD_ID, discordApi } from '../discord.js';
import { STATE_COOKIE, readCookie, clearCookie, makeSession, sessionCookie, redirect } from '../session.js';
import { refs, FieldValue, Timestamp } from '../firebase.js';

const back = (reason, extra = []) => redirect(`${SITE_URL}/?signin=${reason}`, [clearCookie(STATE_COOKIE), ...extra]);

export async function callback(request) {
  const params = new URL(request.url).searchParams;
  const code = params.get('code'), state = params.get('state');
  if (params.get('error')) return back('cancelled');
  if (!code || !state || state !== readCookie(request, STATE_COOKIE)) return back('error');

  try {
    // 1. Code -> access token
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${SITE_URL}/api/auth/callback`,
        client_id: APP_ID,
        client_secret: (process.env.DISCORD_CLIENT_SECRET || '').trim(),
      }),
    });
    if (!tokenRes.ok) throw new Error('token exchange failed: ' + tokenRes.status + ' ' + (await tokenRes.text()).slice(0, 200));
    const { access_token } = await tokenRes.json();

    // 2. Who is this?
    const meRes = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
    if (!meRes.ok) throw new Error('users/@me failed: ' + meRes.status);
    const me = await meRes.json();

    // 3. Only members of the server can have a bud.
    try {
      await discordApi(`/guilds/${GUILD_ID}/members/${me.id}`);
    } catch (err) {
      if (/\((404|403)\)/.test(err.message)) return back('not-member');
      throw err;
    }

    // 4. Remember them.
    const user = { id: me.id, name: me.global_name || me.username, avatar: me.avatar || null };
    const now = Timestamp.now();
    await Promise.all([
      refs.user(me.id).set({ username: me.username, displayName: user.name, avatar: user.avatar, guilds: FieldValue.arrayUnion(GUILD_ID), lastSignIn: now }, { merge: true }),
      refs.member(me.id).set({ active: true, lastSeen: now }, { merge: true }),
    ]);

    return redirect(`${SITE_URL}/`, [clearCookie(STATE_COOKIE), sessionCookie(makeSession(user))]);
  } catch (err) {
    console.error('sign-in failed:', err);
    return back('error');
  }
}
