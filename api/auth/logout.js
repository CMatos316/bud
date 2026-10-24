import { SITE_URL } from '../../lib/discord.js';
import { SESSION_COOKIE, clearCookie, redirect } from '../../lib/session.js';

export function GET() {
  return redirect(`${SITE_URL}/`, [clearCookie(SESSION_COOKIE)]);
}
