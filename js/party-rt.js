// The live room behind Bumper Buds, Tug of War and Freeze: a thin layer over Firebase's Realtime Database.
// It's the one place a page of ours talks to Firebase itself. Everything else goes through /api.
//
// How a page gets in: it asks our server for a sign-in token (POST party-token, lib/party.js). The token is good
// for one room, and says whether this page is the TV (it runs the game) or a phone (it may only write its own
// controls). database.rules.json holds the database to that.
//
//   party/{room}/meta           the TV: which game is on, who's hosting
//   party/{room}/state          the TV: the score and what phase the game is in (small, written when it changes)
//   party/{room}/players/{you}  each phone: your name, and a heartbeat so the TV knows you're still here
//   party/{room}/in/{you}       each phone: your controls, one short string, the newest replacing the last
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

export async function connect(code, tv) {
  const res = await fetch('/api/game', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'party-token', code, tv: !!tv }) });
  let grant = {};
  try { grant = await res.json(); } catch (e) {}
  if (!res.ok) throw Object.assign(new Error(grant.error || 'something went wrong'), { status: res.status });

  let appMod, authMod, db;
  try { [appMod, authMod, db] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-database.js`)]); }
  catch (e) { throw Object.assign(new Error('couldn’t load the live connection. check the internet and try again'), { cause: e, step: 'load' }); }
  const app = appMod.initializeApp(grant.config);
  // signed in for this page only: nothing is kept on the device
  const auth = authMod.initializeAuth(app, { persistence: authMod.inMemoryPersistence });
  try { await authMod.signInWithCustomToken(auth, grant.token); }
  catch (e) { throw Object.assign(new Error(`the live database turned the sign-in down (${e.code || e.message})`), { cause: e, step: 'sign-in' }); }

  const base = db.getDatabase(app), root = `party/${grant.room}`;
  const at = (path) => db.ref(base, path ? `${root}/${path}` : root);
  let offset = 0, online = false;
  const onlineWatchers = new Set(), errorWatchers = new Set();
  const failed = (e) => { for (const f of errorWatchers) f(e); };
  db.onValue(db.ref(base, '.info/serverTimeOffset'), (s) => { offset = s.val() || 0; });
  db.onValue(db.ref(base, '.info/connected'), (s) => { online = !!s.val(); for (const f of onlineWatchers) f(online); });

  return {
    uid: grant.uid, room: grant.room, host: grant.host, hostName: grant.hostName, name: grant.name, code: grant.code, tv: !!tv,
    now: () => Date.now() + offset,                 // the database's clock, near enough
    stamp: () => db.serverTimestamp(),
    set: (path, value) => db.set(at(path), value).catch(failed),
    update: (path, value) => db.update(at(path), value).catch(failed),
    // cb(value) now and on every change
    watch: (path, cb) => db.onValue(at(path), (s) => cb(s.val()), failed),
    // cb(key, value) for each child now and whenever one changes; cb(key, null) when one goes
    watchEach: (path, cb) => {
      const r = at(path), stops = [
        db.onChildAdded(r, (s) => cb(s.key, s.val()), failed), db.onChildChanged(r, (s) => cb(s.key, s.val()), failed), db.onChildRemoved(r, (s) => cb(s.key, null), failed),
      ];
      return () => stops.forEach((f) => f());
    },
    // take this away if the page drops off (a closed tab, a dead battery)
    clearWhenGone: (path) => { try { db.onDisconnect(at(path)).remove().catch(() => {}); } catch (e) {} },
    onOnline: (cb) => { onlineWatchers.add(cb); cb(online); },
    onError: (cb) => { errorWatchers.add(cb); },
  };
}
