// "Sign in with Discord": sends the person to Discord to approve, with a one-time state value
// that the callback checks, so nobody can trick a browser into finishing someone else's sign-in.
import { APP_ID, SITE_URL } from '../discord.js';
import { STATE_COOKIE, cookie, newState, redirect } from '../session.js';

// ?next=/showdown?room=… brings you back to that page afterwards (only paths on this site)
export const NEXT_COOKIE = 'bud_next';
const safeNext = (v) => (typeof v === 'string' && /^\/(?!\/)[\w\-/?=&.%]*$/.test(v) && v.length < 200 ? v : null);

export function login(request) {
  const state = newState();
  const next = safeNext(new URL(request.url).searchParams.get('next'));
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: APP_ID,
    response_type: 'code',
    redirect_uri: `${SITE_URL}/api/auth/callback`,
    scope: 'identify',
    state,
    prompt: 'none',
  }).toString();
  return redirect(url.toString(), [cookie(STATE_COOKIE, state, 600), ...(next ? [cookie(NEXT_COOKIE, next, 600)] : [])]);
}
export function nextPath(request, readCookie) {
  return safeNext(readCookie(request, NEXT_COOKIE));
}
