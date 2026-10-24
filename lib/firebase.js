// Firestore access for bud's server code. Uses a Firebase service account stored in the
// FIREBASE_SERVICE_ACCOUNT environment variable (the whole JSON key file, pasted as-is).
// Only this server code touches the database; the browser never talks to Firestore directly.
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { GUILD_ID } from './discord.js';

function app() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  return initializeApp({ credential: cert(JSON.parse(raw)) });
}

export const db = () => getFirestore(app());
export { FieldValue, Timestamp };

export const refs = {
  user: (uid) => db().collection('users').doc(uid),
  member: (uid) => db().collection('guilds').doc(GUILD_ID).collection('members').doc(uid),
  bud: (uid) => db().collection('guilds').doc(GUILD_ID).collection('buds').doc(uid),
};
