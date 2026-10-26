// Small daily chores, run by the daily cron (api/cron/nudge.js).
import { db, FieldValue } from './firebase.js';

// The hang-out chat was removed on Oct 26, 2026, and what it kept goes with it: the session state, the
// daily message count, and the small facts the bud remembered from hanging out.
const HANGOUT_FIELDS = ['hangout', 'hangoutUsage', 'budRemembers'];
export async function removeHangoutData() {
  const users = db().collection('users');
  const found = new Map();
  for (const f of HANGOUT_FIELDS) {
    // ordering by a field only returns documents that have it
    const snap = await users.orderBy(f).limit(500).get();
    snap.docs.forEach((d) => found.set(d.id, d.ref));
  }
  const del = Object.fromEntries(HANGOUT_FIELDS.map((f) => [f, FieldValue.delete()]));
  await Promise.all([...found.values()].map((ref) => ref.update(del)));
  return found.size;
}
