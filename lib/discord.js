// Shared Discord helpers for bud's Vercel functions.
import { createPublicKey, verify } from 'node:crypto';

export const SITE_URL = 'https://bud.oqw.one';

// IDs, not secrets.
export const APP_ID = '1563361979316445264';
export const GUILD_ID = '1503574884117123134';          // OQW Testing Server
export const WELCOME_CHANNEL_ID = '1563363218842198036'; // #welcome
export const PHOTO_CHANNEL_ID = '1563458632337858720'; // #photo-booth

const API = 'https://discord.com/api/v10';

export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 };
export const ResponseType = { PONG: 1, CHANNEL_MESSAGE: 4, DEFERRED_CHANNEL_MESSAGE: 5 };
export const EPHEMERAL = 64;

// Every request Discord sends is signed. Reject anything whose signature doesn't check out.
// Ed25519 public key from the Developer Portal is 32 bytes of hex; wrap it in the standard SPKI header for node:crypto.
let cachedKey = null;
function publicKey() {
  const hex = (process.env.DISCORD_PUBLIC_KEY || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('DISCORD_PUBLIC_KEY is missing or not a 64-character hex string');
  if (!cachedKey || cachedKey.hex !== hex) {
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hex, 'hex')]);
    cachedKey = { hex, key: createPublicKey({ key: der, format: 'der', type: 'spki' }) };
  }
  return cachedKey.key;
}

export function isValidRequest(rawBody, signature, timestamp) {
  if (!signature || !timestamp || !/^[0-9a-f]+$/i.test(signature)) return false;
  try {
    return verify(null, Buffer.from(timestamp + rawBody), publicKey(), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

export async function discordApi(path, { method = 'GET', body } = {}) {
  const token = (process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!token) throw new Error('DISCORD_BOT_TOKEN is not set');
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Discord API ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  return data;
}

/* ---------- message building ---------- */

export const linkButton = (label, url) => ({ type: 2, style: 5, label, url });
export const button = (label, customId, style = 1) => ({ type: 2, style, label, custom_id: customId });
export const row = (...components) => ({ type: 1, components });

/* ---------- slash commands ---------- */

const MANAGE_GUILD = String(1 << 5);

export const COMMANDS = [
  {
    name: 'bud',
    description: 'Say hi to bud and get your link to make one',
    type: 1,
  },
  {
    name: 'bud-setup',
    description: 'Post the "Make your bud" button in #welcome',
    type: 1,
    default_member_permissions: MANAGE_GUILD, // server managers only
  },
  {
    name: 'bud-nudge',
    description: 'DM people who made a bud but haven’t answered its questions yet',
    type: 1,
    default_member_permissions: MANAGE_GUILD, // server managers only
  },
];

/* ---------- direct messages ---------- */

// Best effort: people can turn off DMs from server members, so a failed DM never fails the request.
export async function sendDm(userId, payload) {
  try {
    const channel = await discordApi('/users/@me/channels', { method: 'POST', body: { recipient_id: userId } });
    await discordApi(`/channels/${channel.id}/messages`, {
      method: 'POST',
      body: { allowed_mentions: { parse: [] }, ...payload },
    });
    return true;
  } catch (err) {
    console.warn(`DM to ${userId} failed:`, err.message);
    return false;
  }
}

/* ---------- photos ---------- */

// Post a message with one image attached (multipart). Used by the island's photo booth.
export async function postImage(channelId, { content, components, filename, bytes, alt }) {
  const token = (process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!token) throw new Error('DISCORD_BOT_TOKEN is not set');
  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    content, components, allowed_mentions: { parse: [] },
    attachments: [{ id: 0, filename, description: alt }],
  }));
  form.append('files[0]', new Blob([bytes], { type: 'image/jpeg' }), filename);
  const res = await fetch(`${API}/channels/${channelId}/messages`, { method: 'POST', headers: { Authorization: `Bot ${token}` }, body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`Discord photo post failed (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
