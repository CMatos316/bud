// Discord sign-in, all in one function (the free Vercel plan allows 12 functions per deployment).
// /api/auth/login → Discord · /api/auth/callback → back from Discord · /api/auth/logout
import { login } from '../../lib/auth/login.js';
import { callback } from '../../lib/auth/callback.js';
import { logout } from '../../lib/auth/logout.js';

const ACTIONS = { login, callback, logout };

export async function GET(request) {
  const action = new URL(request.url).pathname.split('/').filter(Boolean).pop();
  const handler = ACTIONS[action];
  return handler ? handler(request) : new Response('Not found', { status: 404 });
}
