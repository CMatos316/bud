// Signed-in sessions for bud.oqw.one.
// The session is a small signed cookie: who you are, and when it expires. It's HttpOnly (page scripts
// can't read it), Secure, and SameSite=Lax (other sites can't send it with their requests).
import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { SITE_URL, APP_ID } from './discord.js';

export const SESSION_COOKIE = 'bud_session';
export const STATE_COOKIE = 'bud_oauth_state';
const SESSION_DAYS = 30;

// The signing key is derived from the Discord client secret, so there's no extra secret to manage.
function signingKey() {
  const secret = (process.env.DISCORD_CLIENT_SECRET || '').trim();
  if (!secret) throw new Error('DISCORD_CLIENT_SECRET is not set');
  return createHash('sha256').update('bud-session-v1:' + secret).digest();
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sig = (payload) => b64(createHmac('sha256', signingKey()).update(payload).digest());

export function makeSession(user) {
  const payload = b64(JSON.stringify({ ...user, exp: Date.now() + SESSION_DAYS * 864e5 }));
  return `${payload}.${sig(payload)}`;
}

// Inside Discord (the Activity), the page runs in a frame where cookies don't work, so it sends the same
// signed session in a header instead.
export const SESSION_HEADER = 'x-bud-session';
export function readSession(request) {
  const raw = request.headers.get(SESSION_HEADER) || readCookie(request, SESSION_COOKIE);
  if (!raw || !raw.includes('.')) return null;
  const [payload, mac] = raw.split('.');
  try {
    const expected = Buffer.from(sig(payload)), got = Buffer.from(mac);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now() || !data.id) return null;
    return data;
  } catch {
    return null;
  }
}

export function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function cookie(name, value, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}
export const sessionCookie = (value) => cookie(SESSION_COOKIE, value, SESSION_DAYS * 86400);
export const clearCookie = (name) => cookie(name, '', 0);

export const newState = () => randomBytes(18).toString('base64url');

// Writes must come from bud's own pages: our site, or the Activity inside Discord (served from
// {app id}.discordsays.com). A request carrying the session header also qualifies: other sites can't add
// custom headers to requests here without our permission, and they don't know the session anyway.
const ALLOWED_ORIGINS = new Set([SITE_URL, 'https://bud.vercel.app', `https://${APP_ID}.discordsays.com`]);
export const sameOrigin = (request) => ALLOWED_ORIGINS.has(request.headers.get('origin') || '') || request.headers.has(SESSION_HEADER);

export const redirect = (location, cookies = []) => {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
};
