import { SITE_URL } from '../discord.js';
import { SESSION_COOKIE, clearCookie, redirect } from '../session.js';

export function logout() {
  return redirect(`${SITE_URL}/`, [clearCookie(SESSION_COOKIE)]);
}
