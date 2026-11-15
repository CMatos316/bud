// The phone's side of Bumper Buds, Tug of War and Freeze: a controller, held sideways. It sends what your thumbs
// (or your shaking) are doing, and shows what the TV says about you. The TV runs the game (js/party-tv.js).
// What gets sent is one short string, the newest replacing the last. Dashes, taps and steps go as running counts,
// so a message that never arrives loses nothing.
import { GAME_INFO, COLORS, MIN_PLAYERS, BUMPER } from '/js/party-games.js';
import { drawBud } from '/js/bud-flat.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TEAMS = [{ name: 'Sunrise', color: '#FF7A59', side: 'left' }, { name: 'Tide', color: '#4FB3FF', side: 'right' }];
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
const listOf = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch (e) {} };

export async function runPad(room, { onAway } = {}) {
  const me = room.uid;
  let meta = null, st = null, sid = null, go = 0, away = null;
  // the controls: these only ever count up, whatever game is on
  const ctl = { x: 0, y: 0, dash: 0, taps: 0, steps: 0 };

  /* ---------- held sideways ---------- */
  // A controller wants two thumbs, so it's laid out wide. A phone standing upright (and most are locked that way)
  // gets the whole thing drawn turned a quarter: turn the phone and it reads right. Nothing can tell which way
  // someone turned a locked phone, so there's a Flip button for the other way (remembered on that phone).
  // turn: 0 the page is already wide, 1 drawn for a phone with its top to the left, 2 top to the right.
  const pad = $('pad'), isPhone = matchMedia('(pointer: coarse)').matches;
  let turn = 0, other = false;
  try { other = localStorage.getItem('bud_pad_flip') === '1'; } catch (e) {}
  function layout() {
    const w = innerWidth, h = innerHeight;
    turn = isPhone && h > w ? (other ? 2 : 1) : 0;
    pad.style.setProperty('--pw', `${w}px`); pad.style.setProperty('--ph', `${h}px`);
    pad.classList.toggle('turned', turn > 0); pad.classList.toggle('other', turn === 2);
    $('padTurn').hidden = turn === 0;
  }
  addEventListener('resize', layout); layout();
  $('padTurn').addEventListener('click', () => { other = !other; try { localStorage.setItem('bud_pad_flip', other ? '1' : '0'); } catch (e) {} layout(); });
  // a spot on the glass, in the controller's own frame (the way the player sees it)
  const local = (x, y) => (turn === 1 ? [y, innerWidth - x] : turn === 2 ? [innerHeight - y, x] : [x, y]);
  const localBox = (elm) => { const r = elm.getBoundingClientRect(), a = local(r.left, r.top), b = local(r.right, r.bottom); return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), right: Math.max(a[0], b[0]), bottom: Math.max(a[1], b[1]) }; };

  /* ---------- being here ---------- */
  const announce = () => room.set(`players/${me}`, { n: room.name, at: room.stamp(), go });
  room.clearWhenGone(`players/${me}`); room.clearWhenGone(`in/${me}`);
  announce(); setInterval(() => { if (!document.hidden) announce(); }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) announce(); });
  room.onOnline((on) => { $('padOffline').hidden = on; if (on) announce(); });

  /* ---------- sending the controls ---------- */
  let lastSent = '', lastAt = 0, timer = null;
  const wire = () => { const k = meta?.game; return k === 'tug' ? String(ctl.taps) : k === 'freeze' ? String(Math.floor(ctl.steps)) : `${Math.round(ctl.x * 100)},${Math.round(ctl.y * 100)},${ctl.dash}`; };
  function send(now = false) {
    const due = 70 - (performance.now() - lastAt);
    if (!now && due > 0) { if (!timer) timer = setTimeout(() => { timer = null; send(true); }, due); return; }
    const s = wire(); if (s === lastSent) return;
    lastSent = s; lastAt = performance.now(); room.set(`in/${me}`, s);
  }

  /* ---------- what the TV says ---------- */
  room.watch('meta', (m) => {
    const fresh = m && m.sid !== sid;
    meta = m; if (m) sid = m.sid;
    if (fresh) { announce(); lastSent = ''; }       // a new TV session wiped the room: say hello again
    if (m && m.away && m.away !== away) { away = m.away; if (onAway) onAway(); }   // the TV is off to another game
    render();
  });
  let hits = 0, wasOut = false;
  room.watch('state', (s) => {
    st = s;
    if (s && s.g === 'freeze') { const h = s.hit?.[me] || 0; if (h > hits) buzz([60, 40, 120]); hits = h; } else hits = 0;
    if (s && s.g === 'bumper') { const out = !!s.out?.[me]; if (out && !wasOut) buzz(200); wasOut = out; }
    render();
  });

  const mine = () => st?.who?.[me] || null;
  const nameOf = (id) => (id === me ? 'You' : st?.who?.[id]?.n || 'someone');
  function flash(text, ms = 1800) { const f = $('padFlash'); f.textContent = text; f.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => f.classList.remove('on'), ms); }

  // the line of words at the top, and whether the controller is live or covered
  function words() {
    const k = meta?.game, ph = st?.phase, w = mine();
    if (!meta || !st || st.sid !== meta.sid || st.g !== k) return { line: 'Waiting for the TV…', veil: 'Waiting for the TV…' };
    const n = Object.keys(st.who || {}).length;
    if (!w) return { line: 'Getting you in…', veil: n >= 12 ? 'This game is full. Watch the TV!' : 'Getting you in…' };
    if (ph === 'lobby') return { line: k === 'bumper' ? 'You’re on the TV. Drive around!' : k === 'tug' ? 'You’re on the TV. Tap to hop!' : 'You’re on the TV. Shake to wiggle!' };
    if (!w.in) return { line: 'You’re in the next one.', veil: 'A game’s on. You’re in the next one. Watch the TV!' };
    if (k === 'bumper') {
      if (ph === 'count') return { line: `Round ${st.round} of ${st.rounds}. Get ready…` };
      if (ph === 'play') return st.out?.[me] ? { line: `Round ${st.round} of ${st.rounds}`, veil: 'Splash! You’re out this round.' } : { line: `Round ${st.round} of ${st.rounds}. Stay on the island!` };
      if (ph === 'round') return { line: '', veil: (st.last === me ? 'You took the round!' : st.last ? `${nameOf(st.last)} took the round.` : 'Nobody’s left!') + ` You have ${st.score?.[me] || 0} ${st.score?.[me] === 1 ? 'point' : 'points'}.` };
      if (ph === 'done') { const c = st.champs || []; return { line: c.includes(me) ? 'You won! 🏆' : `${listOf(c.map(nameOf))} won.`, note: `You scored ${st.score?.[me] || 0}. Drive around while you wait.` }; }
    }
    if (k === 'tug') {
      const t = TEAMS[w.team] || TEAMS[0];
      if (ph === 'count') return { line: `You’re on ${t.name}, the ${t.side} side. Get ready…` };
      if (ph === 'play') return { line: `${t.name}: pull to the ${t.side}!` };
      if (ph === 'round') return { line: '', veil: st.last === w.team ? 'Your team took the round!' : 'Into the mud! Shake it off…' };
      if (ph === 'done') return { line: st.champ === w.team ? 'Your team won! 🏆' : `${TEAMS[st.champ]?.name || 'They'} won.`, veil: st.champ === w.team ? 'Your team won! 🏆' : `${TEAMS[st.champ]?.name || 'They'} won. Rematch?` };
    }
    if (k === 'freeze') {
      if (ph === 'count') return { line: 'Get ready…' };
      if (ph === 'play' && st.dizzy?.[me] && !st.winner) return { line: 'A wave got you!', veil: 'A wave got you! Back to the last sandcastle. You’re too dizzy to run for a moment…' };
      if (ph === 'play') return { line: st.winner ? `${nameOf(st.winner)} made it!` : st.light === 'red' ? 'It’s looking. Don’t move!' : 'It’s napping. Go go go!' };
      if (ph === 'done') { const at = (st.place || []).indexOf(me); const t = st.winner === me ? 'You won! 🏆' : `${nameOf(st.winner)} won.${at > 0 ? ` You came ${ORD[at]}.` : ''}`; return { line: t, veil: t }; }
    }
    return { line: '' };
  }

  /* ---------- the screen ---------- */
  let built = null;
  function render() {
    const k = meta?.game || 'bumper', w = mine(), say = words();
    $('padGame').textContent = GAME_INFO[k]?.name || '';
    const color = w ? COLORS[w.c] : '#9A98B5';
    document.documentElement.style.setProperty('--me', k === 'tug' && w && w.team != null && st?.phase !== 'lobby' ? TEAMS[w.team].color : color);
    $('meDot').style.background = color;
    $('padLine').textContent = say.line && say.line !== say.veil ? say.line : '';
    $('padNote').textContent = say.note || (st?.phase === 'lobby' && meta ? GAME_INFO[k].pad : '');
    const veil = $('padVeil'); veil.hidden = !say.veil; veil.textContent = say.veil || '';
    // the host's phone can start the game, so nobody has to get up
    const hostBtn = $('padStart'), idle = st && (st.phase === 'lobby' || st.phase === 'done') && st.sid === meta?.sid;
    hostBtn.hidden = !(meta && meta.host === me && idle);
    if (!hostBtn.hidden) { const n = Object.keys(st.who || {}).length; hostBtn.disabled = n < MIN_PLAYERS; hostBtn.textContent = n < MIN_PLAYERS ? 'Waiting for one more…' : st.phase === 'done' ? `Play again (${n})` : `Start the game (${n})`; }
    if (built !== k) { built = k; build(k); }
    if (k === 'freeze') {
      const red = st?.phase === 'play' && st.light === 'red', on = st?.phase === 'play' && !st.winner;
      const f = $('frz'); f.classList.toggle('red', red); f.classList.toggle('green', on && !red);
      $('frzWord').textContent = on ? (red ? 'FREEZE!' : 'RUN!') : 'Shake!';
    }
  }
  $('padStart').addEventListener('click', () => { go++; announce(); buzz(30); });

  function build(k) {
    const main = $('padMain'); main.textContent = '';
    if (k === 'tug') {
      const b = el('button', 'ctl tugbtn'); b.type = 'button'; b.id = 'pull'; b.append(el('b', null, 'PULL!'), el('small', null, 'tap as fast as you can'));
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); pull(b); });
      main.append(b);
    } else if (k === 'freeze') {
      const f = el('div', 'ctl freeze'); f.id = 'frz';
      const word = el('b', null, 'Shake!'); word.id = 'frzWord';
      const hint = el('small', null, ''); hint.id = 'frzHint';
      const turnOn = el('button', 'btn', 'Turn on shaking'); turnOn.type = 'button'; turnOn.id = 'frzMotion'; turnOn.hidden = true;
      const tap = el('button', 'btn ghost', 'Tap here to run instead'); tap.type = 'button'; tap.id = 'frzTap';
      tap.addEventListener('pointerdown', (e) => { e.preventDefault(); ctl.steps += 1.5; send(); tap.classList.add('hit'); setTimeout(() => tap.classList.remove('hit'), 80); });
      turnOn.addEventListener('click', askMotion);
      const row = el('div', 'row'); row.append(turnOn, tap);
      f.append(word, hint, row); main.append(f);
      startMotion();
    } else {
      const wrap = el('div', 'ctl bumper'), stick = el('div', 'stick'), base = el('div', 'base'), knob = el('div', 'knob'), dash = el('button', 'dash', 'DASH');
      stick.id = 'stick'; dash.id = 'dash'; dash.type = 'button'; base.append(knob); stick.append(base, el('span', null, 'steer'));
      wrap.append(stick, dash); main.append(wrap);
      let pid = null, ox = 0, oy = 0; const R = 58;
      const place = (x, y) => { knob.style.transform = `translate(${x * R}px, ${y * R}px)`; };
      // (everything here is in the controller's own frame, so it works the same when it's drawn turned)
      stick.addEventListener('pointerdown', (e) => {
        if (pid != null) return; pid = e.pointerId; stick.setPointerCapture(pid); e.preventDefault();
        const r = localBox(stick), [px, py] = local(e.clientX, e.clientY); ox = clamp(px, r.left + R + 8, r.right - R - 8); oy = clamp(py, r.top + R + 8, r.bottom - R - 8);
        base.style.left = `${ox - r.left}px`; base.style.top = `${oy - r.top}px`; base.classList.add('on'); move(e);
      });
      const move = (e) => { if (e.pointerId !== pid) return; const [px, py] = local(e.clientX, e.clientY); let x = (px - ox) / R, y = (py - oy) / R; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } ctl.x = x; ctl.y = y; place(x, y); send(); };
      const up = (e) => { if (e.pointerId !== pid) return; pid = null; ctl.x = 0; ctl.y = 0; place(0, 0); base.classList.remove('on'); send(true); };
      stick.addEventListener('pointermove', move); stick.addEventListener('pointerup', up); stick.addEventListener('pointercancel', up);
      dash.addEventListener('pointerdown', (e) => { e.preventDefault(); doDash(dash); });
    }
  }
  let dashReady = 0;
  function doDash(btn) {
    ctl.dash++; send(true);
    if (performance.now() < dashReady) return;        // still catching its breath (the TV decides; this is just the look)
    dashReady = performance.now() + BUMPER.DASH_COOL * 1000; buzz(25);
    btn.classList.remove('cool'); void btn.offsetWidth; btn.classList.add('cool');
  }
  function pull(btn) { ctl.taps++; send(); btn.classList.add('hit'); clearTimeout(pull.t); pull.t = setTimeout(() => btn.classList.remove('hit'), 70); }

  /* ---------- shaking (Freeze) ---------- */
  // Every bit of shaking above a still hand adds up to steps. iPhones ask before a page may feel the phone move,
  // and only from a tap, hence the button. No sensor (or no permission): the tap button does the same job.
  let motionOn = false, lastMotion = 0, energy = 0, sawMotion = false;
  function onMotion(e) {
    const a = e.acceleration, ag = e.accelerationIncludingGravity;
    let mag = null;
    if (a && a.x != null) mag = Math.hypot(a.x, a.y, a.z);
    else if (ag && ag.x != null) mag = Math.abs(Math.hypot(ag.x, ag.y, ag.z) - 9.81);
    if (mag == null) return;
    sawMotion = true;
    const now = performance.now(), dt = Math.min(0.1, (now - (lastMotion || now)) / 1000); lastMotion = now;
    if (meta?.game !== 'freeze') return;
    energy += Math.max(0, mag - 3) * dt;              // m/s² over a still hand, times seconds
    if (energy >= 1) { const n = Math.floor(energy); energy -= n; ctl.steps += Math.min(n, 3); send(); }
  }
  function listen() { if (motionOn) return; motionOn = true; addEventListener('devicemotion', onMotion); }
  function startMotion() {
    const hint = $('frzHint'), btn = $('frzMotion');
    if (typeof DeviceMotionEvent === 'undefined') { hint.textContent = 'This phone can’t feel shaking. Tap to run.'; return; }
    if (typeof DeviceMotionEvent.requestPermission === 'function' && !motionOn) { btn.hidden = false; hint.textContent = 'Shaking needs your OK first.'; return; }
    listen(); hint.textContent = 'shake your phone to run, hold still to freeze';
    setTimeout(() => { if (!sawMotion && $('frzHint')) $('frzHint').textContent = 'No shaking felt here. Tap to run.'; }, 2500);
  }
  async function askMotion() {
    const hint = $('frzHint'), btn = $('frzMotion');
    try { const r = await DeviceMotionEvent.requestPermission(); if (r === 'granted') { listen(); btn.hidden = true; hint.textContent = 'shake your phone to run, hold still to freeze'; } else hint.textContent = 'No shaking allowed. Tap to run.'; }
    catch (e) { hint.textContent = 'Couldn’t turn on shaking. Tap to run.'; }
  }

  /* ---------- a keyboard works too (handy on a laptop) ---------- */
  const keys = new Set();
  const steer = () => { ctl.x = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0); ctl.y = (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0); send(true); };
  addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey) return;
    if (e.key === ' ') { e.preventDefault(); const k = meta?.game; if (k === 'tug') pull($('pull')); else if (k === 'freeze') { ctl.steps += 1.5; send(); } else if ($('dash')) doDash($('dash')); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's'].includes(e.key)) { keys.add(e.key); if (meta?.game === 'bumper') steer(); }
  });
  addEventListener('keyup', (e) => { if (keys.delete(e.key) && meta?.game === 'bumper') steer(); });
  addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------- you ---------- */
  $('meName').textContent = room.name;
  drawBud($('meBud'), null, { size: 44 });
  fetch(`/api/game?room=${encodeURIComponent(room.room)}&buds=${me}`, { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json()).then((d) => { if (d.buds?.[me]) drawBud($('meBud'), d.buds[me], { size: 44 }); }).catch(() => {});
  render();
  // the first time on this phone, say so (after that it's obvious)
  let told = false;
  try { told = localStorage.getItem('bud_pad_told') === '1'; localStorage.setItem('bud_pad_told', '1'); } catch (e) {}
  if (turn && !told) flash('Turn your phone sideways, like a game controller.', 4500);
  return { ctl, send, get st() { return st; }, get meta() { return meta; }, get turn() { return turn; } };
}
