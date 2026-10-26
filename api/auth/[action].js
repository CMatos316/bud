// Discord sign-in, all in one function (the free Vercel plan allows 12 functions per deployment).
// /api/auth/login → Discord · /api/auth/callback → back from Discord · /api/auth/logout
// POST /api/auth/activity → sign-in from inside Discord (the Activity in a voice call)
import { login } from '../../lib/auth/login.js';
import { callback } from '../../lib/auth/callback.js';
import { logout } from '../../lib/auth/logout.js';
import { activity } from '../../lib/auth/activity.js';

const ACTIONS = { login, callback, logout };

export async function GET(request) {
  const action = new URL(request.url).pathname.split('/').filter(Boolean).pop();
  const handler = ACTIONS[action];
  return handler ? handler(request) : new Response('Not found', { status: 404 });
}

export async function POST(request) {
  const action = new URL(request.url).pathname.split('/').filter(Boolean).pop();
  return action === 'activity' ? activity(request) : new Response('Not found', { status: 404 });
}
