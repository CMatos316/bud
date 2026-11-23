// Bud Royal's live connection between two phones: a thin layer over Firebase's Realtime Database, in a room of the
// same shape party night uses (database.rules.json), so nothing new has to be set up.
//   party/royal_{match}/players/{you}   your name, a heartbeat, and `go`: a fingerprint of your battle now and then
//   party/royal_{match}/in/{you}        where you've put your buds: one short string, the newest replacing the last
// Each phone may write only its own two spots. The grant (a sign-in token for this one room) comes from the server
// with the match (lib/royal.js).
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

export async function joinRoom(grant, peer) {
  let appMod, authMod, db;
  try { [appMod, authMod, db] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-database.js`)]); }
  catch (e) { throw new Error('couldn’t load the live connection. check the internet and try again'); }
  const app = appMod.initializeApp(grant.config, 'royal'), auth = authMod.initializeAuth(app, { persistence: authMod.inMemoryPersistence });
  try { await authMod.signInWithCustomToken(auth, grant.token); } catch (e) { throw new Error(`the live database turned the sign-in down (${e.code || e.message})`); }
  const base = db.getDatabase(app), at = (path) => db.ref(base, `party/${grant.room}/${path}`);
  let offset = 0, seen = 0, problem = null; const peerCbs = [], printCbs = [];
  const failed = (e) => { problem = e.code || e.message; };
  db.onValue(db.ref(base, '.info/serverTimeOffset'), (s) => { offset = s.val() || 0; });
  const me = at(`players/${grant.uid}`);
  const beat = () => db.update(me, { n: grant.name, at: db.serverTimestamp() }).catch(failed);
  try { db.onDisconnect(me).remove().catch(() => {}); } catch (e) {}
  await db.set(me, { n: grant.name, at: db.serverTimestamp() }).catch(failed);
  const timer = setInterval(beat, 3000);
  db.onValue(at(`players/${peer}`), (s) => { const v = s.val(); if (!v) return; seen = Date.now(); if (typeof v.go === 'number') for (const f of printCbs) f(v.go); }, failed);
  db.onValue(at(`in/${peer}`), (s) => { const v = s.val(); if (typeof v === 'string') { seen = Date.now(); for (const f of peerCbs) f(v); } }, failed);
  return {
    now: () => Date.now() + offset,
    send: (str) => db.set(at(`in/${grant.uid}`), str).catch(failed),
    print: (num) => db.update(me, { go: num }).catch(failed),
    onPeer: (f) => peerCbs.push(f), onPeerPrint: (f) => printCbs.push(f),
    peerAge: () => (seen ? Date.now() - seen : Infinity), get problem() { return problem; },
    leave: () => { clearInterval(timer); db.remove(me).catch(() => {}); },
  };
}
