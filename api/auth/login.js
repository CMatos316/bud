// "Sign in with Discord": sends the person to Discord to approve, with a one-time state value
// that the callback checks, so nobody can trick a browser into finishing someone else's sign-in.
import { APP_ID, SITE_URL } from '../../lib/discord.js';
import { STATE_COOKIE, cookie, newState, redirect } from '../../lib/session.js';

export function GET() {
  const state = newState();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: APP_ID,
    response_type: 'code',
    redirect_uri: `${SITE_URL}/api/auth/callback`,
    scope: 'identify',
    state,
    prompt: 'none',
  }).toString();
  return redirect(url.toString(), [cookie(STATE_COOKIE, state, 600)]);
}
