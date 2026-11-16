// The TV's side of Bumper Buds, Tug of War, Freeze and Island Grand Prix. This page runs the game (js/party-games.js), draws it,
// makes the noises, and tells the phones the score. Phones only send their controls (js/party-pad.js).
// One room for all of them: switching games here doesn't move anyone to another page.
// Bumper Buds, Freeze and the kart race are drawn in 3D (js/party-3d.js); Tug of War is a flat picture drawn here.
import { makeGame, parseInput, GAME_INFO, COLORS, MIN_PLAYERS, MAX_PLAYERS, BUMPER, TUG, COUNT_S, KART, KART_ITEMS } from '/js/party-games.js';
import { drawBud } from '/js/bud-flat.js';
import { joinCard, joinChip, backToPicker, keepAwake } from '/js/party-kit.js';
import { make3d } from '/js/party-3d.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const S = window.BudSound || { play() {}, bindToggle() {} };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const listOf = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
const HERE_MS = 11000;                 // no heartbeat for this long: they've left
const TEAMS = [{ name: 'Sunrise', color: '#FF7A59', side: 'left' }, { name: 'Tide', color: '#4FB3FF', side: 'right' }];
const KINDS = ['kart', 'bumper', 'tug', 'freeze'];
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

export async function runTv(room, code, firstKind) {
  let kind = KINDS.includes(firstKind) ? firstKind : 'bumper', game = makeGame(kind);
  // The kart race fills empty spots with buds from the island, driven by the TV. Their drawings come from the
  // island (/api/world), once.
  let pool = null;
  async function loadPool() {
    if (pool) return;
    pool = [];
    try {
      const w = await (await fetch('/api/world', { credentials: 'same-origin', cache: 'no-store' })).json();
      for (const b of w.buds || []) { const name = b.nickname || b.trueName; if (!name) continue; buds[`cpu_${b.id}`] = b; pool.push({ id: b.id, name }); }
    } catch (e) {}
    if (game.setPool) game.setPool(pool);
  }
  const cpuOf = (id) => game.cpus?.find((c) => c.id === id);
  const sid = Math.random().toString(36).slice(2, 10);
  const players = new Map(), raw = new Map(), colorOf = new Map(), order = new Map(), goSeen = new Map(), buds = {}, asking = new Set();
  let roster = [], dirty = true, urgent = true, lastPub = 0, seq = 0, joined = 0;

  /* ---------- the room ---------- */
  await room.set('', { meta: { sid, host: room.host, hostName: room.hostName, code, game: kind, at: room.stamp() }, state: { ...game.state(), sid, n: 0 } });
  room.watchEach('players', (uid, p) => {
    if (!p) { players.delete(uid); return; }
    players.set(uid, p);
    if (!order.has(uid)) order.set(uid, ++joined);
    // the host's own phone can press Start too (a running count, so one that got lost doesn't matter)
    if (uid === room.host) { const was = goSeen.get(uid); goSeen.set(uid, p.go || 0); if (was != null && (p.go || 0) > was) primary(); }
  });
  room.watchEach('in', (uid, v) => { if (v == null) raw.delete(uid); else raw.set(uid, v); });
  room.onOnline((on) => { $('offline').hidden = on; });

  function refreshRoster() {
    const now = room.now();
    const here = [...players.entries()].filter(([, p]) => now - (p.at || 0) < HERE_MS).sort((a, b) => order.get(a[0]) - order.get(b[0])).slice(0, MAX_PLAYERS);
    for (const [uid] of here) if (!colorOf.has(uid)) { const used = new Set(here.map(([u]) => colorOf.get(u))); let c = 0; while (used.has(c) && c < COLORS.length - 1) c++; colorOf.set(uid, c); }
    const next = here.map(([uid, p]) => ({ id: uid, name: p.n || 'someone', c: colorOf.get(uid) }));
    if (JSON.stringify(next) !== JSON.stringify(roster)) {
      if (next.length > roster.length) S.play('pop', { rate: 1 + next.length * 0.06 });
      roster = next; game.setRoster(roster); dirty = true; renderPanel(); renderScore();
      three.forget(new Set([...roster.map((p) => p.id), ...(game.buds?.keys() || []), ...(game.runners?.keys() || []), ...(game.karts?.keys() || [])]));
      const want = roster.map((p) => p.id).filter((id) => !(id in buds) && !asking.has(id));
      if (want.length) fetchBuds(want);
    }
  }
  async function fetchBuds(ids) {
    ids.forEach((id) => asking.add(id));
    try {
      const res = await fetch(`/api/game?room=${encodeURIComponent(room.room)}&buds=${ids.join(',')}`, { credentials: 'same-origin', cache: 'no-store' });
      const got = (await res.json()).buds || {};
      for (const id of ids) { buds[id] = got[id] || null; for (const k of [...sprites.keys()]) if (k.startsWith(id + '|')) sprites.delete(k); three.refresh(id); }
    } catch (e) { ids.forEach((id) => asking.delete(id)); }
  }
  setInterval(refreshRoster, 400);

  function publish(now) { dirty = false; urgent = false; lastPub = now; room.set('state', { ...game.state(), sid, n: ++seq }); }
  function primary() { if (game.start()) { S.play('whoosh'); dirty = urgent = true; renderPanel(); } }
  function setKind(k) {
    if (k === kind || !KINDS.includes(k)) return;
    kind = k; game = makeGame(kind); game.setRoster(roster); fx.length = 0; bannerOff();
    if (kind === 'kart') { if (pool) game.setPool(pool); else loadPool(); }
    room.update('meta', { game: kind }); dirty = urgent = true;
    $('gameName').textContent = GAME_INFO[kind].name; document.title = `${GAME_INFO[kind].name} · the buddie system`;
    history.replaceState(null, '', `/party?code=${code}&tv=1&g=${kind}`);
    S.play('click'); renderPanel(); renderScore();
  }
  const nameOf = (id) => roster.find((p) => p.id === id)?.name || cpuOf(id)?.name || players.get(id)?.n || 'someone';
  const colorFor = (id) => (cpuOf(id) ? COLORS[cpuOf(id).c] : COLORS[colorOf.get(id) ?? 0]);

  /* ---------- words over the picture ---------- */
  let bannerTimer = null;
  function banner(text, sub = '', secs = 2.2, cls = '') {
    const b = $('banner'); b.className = 'banner on ' + cls; b.textContent = '';
    b.append(el('div', 'big', text)); if (sub) b.append(el('div', 'sub', sub));
    clearTimeout(bannerTimer); if (secs) bannerTimer = setTimeout(bannerOff, secs * 1000);
  }
  function bannerOff() { clearTimeout(bannerTimer); $('banner').className = 'banner'; }

  let panelKey = '';
  function renderPanel() {
    const idle = game.phase === 'lobby' || game.phase === 'done', st = game.state();
    const key = JSON.stringify([kind, game.phase, roster.map((p) => [p.id, p.name]), idle ? st : 0]);
    if (key === panelKey) return; panelKey = key;
    const p = $('tvPanel'); p.hidden = !idle; p.textContent = '';
    document.body.classList.toggle('idle', idle);
    if (!idle) return;
    const info = GAME_INFO[kind];
    if (game.phase === 'done') {
      p.append(el('h2', null, kind === 'kart' ? `${nameOf(game.champs[0])} wins! 🏆` : kind === 'tug' ? `${TEAMS[game.champ].name} wins!` : kind === 'freeze' ? `${nameOf(game.winner)} wins!` : `${listOf(game.champs.map(nameOf))} ${game.champs.length > 1 ? 'win' : 'wins'}!`));
      const ol = el('ol', 'places');
      if (kind === 'kart') (game.order || []).slice(0, 8).forEach((id) => { const k = game.karts.get(id); ol.append(el('li', null, `${nameOf(id)}${k?.cpu ? ' (island bud)' : ''}${k?.fin != null ? ` · ${k.fin.toFixed(1)}s` : ''}`)); });
      else if (kind === 'bumper') Object.entries(game.score).sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([id, n]) => ol.append(el('li', null, `${nameOf(id)} · ${n} ${n === 1 ? 'point' : 'points'}`)));
      else if (kind === 'freeze') (game.place || []).slice(0, 6).forEach((id) => { const r = game.runners.get(id); ol.append(el('li', null, `${nameOf(id)}${r && r.caught ? ` · caught ${r.caught}×` : ''}`)); });
      else for (const t of [game.champ, 1 - game.champ]) ol.append(el('li', null, `${TEAMS[t].name} (${game.score[t]}): ${listOf(roster.filter((x) => game.team[x.id] === t).map((x) => x.name)) || 'nobody'}`));
      p.append(ol);
    } else {
      p.append(el('h2', null, info.name), el('p', null, info.how), el('p', 'phones', `On your phone: ${info.pad}`));
      if (kind === 'kart') p.append(el('p', null, `Buds from the island fill the grid up to ${KART.FILL}.`));
      p.append(joinCard(code, { small: true }));
    }
    const n = roster.length, row = el('div', 'row'), least = kind === 'kart' ? 1 : MIN_PLAYERS;
    const go = el('button', 'btn primary', n < least ? (n ? 'Waiting for one more…' : 'Waiting for players…') : game.phase === 'done' ? `Play again (${n})` : `Start (${n})`); go.type = 'button'; go.id = 'startBtn';
    go.disabled = !game.canStart(); go.addEventListener('click', primary);
    row.append(go);
    const tabs = el('div', 'tabs');
    KINDS.forEach((k, i) => { const b = el('button', 'tab' + (k === kind ? ' on' : ''), GAME_INFO[k].name); b.type = 'button'; b.dataset.kind = k; b.title = `Key ${i + 1}`; b.addEventListener('click', () => setKind(k)); tabs.append(b); });
    p.append(row, tabs);
  }
  let scoreKey = '';
  function renderScore() {
    const st = game.state(), box = $('score');
    const key = JSON.stringify([kind, game.phase, roster, st.score, st.out, st.hit, st.place, st.who, st.lap, st.item, st.fin]);
    if (key === scoreKey) return; scoreKey = key;
    if (kind === 'kart') return kartScore(st, box);
    box.textContent = ''; box.hidden = kind === 'freeze';   // Freeze has everyone's name in their lane
    const chip = (color, text, small, cls = '') => { const c = el('div', 'chip ' + cls), d = el('i'); d.style.background = color; c.append(d, el('b', null, text)); if (small != null) c.append(el('small', null, small)); return c; };
    if (kind === 'tug' && game.phase !== 'lobby') {
      for (const t of [0, 1]) box.append(chip(TEAMS[t].color, `${TEAMS[t].name} · ${game.score[t]}`, listOf(roster.filter((p) => game.team[p.id] === t).map((p) => p.name)), 'team'));
    } else {
      const list = [...roster];
      if (kind === 'bumper') list.sort((a, b) => (game.score[b.id] || 0) - (game.score[a.id] || 0));
      for (const p of list) {
        const out = kind === 'bumper' && game.phase !== 'lobby' && game.phase !== 'done' && (st.out[p.id] || !st.who[p.id]?.in);
        const small = kind === 'bumper' && game.phase !== 'lobby' ? String(game.score[p.id] || 0) : null;
        box.append(chip(COLORS[p.c], p.name, small, out ? 'out' : ''));
      }
    }
    $('round').textContent = game.phase === 'lobby' || game.phase === 'done' ? '' : kind === 'bumper' ? `Round ${game.round} of ${BUMPER.ROUNDS}` : kind === 'tug' ? `Round ${game.round} · first to ${TUG.WINS}` : '';
  }

  // the kart race: everyone in race order, with their lap and what they're holding
  function kartScore(st, box) {
    box.textContent = ''; box.hidden = false;
    const ids = game.phase === 'lobby' ? roster.map((p) => p.id) : [...game.order];
    for (const id of ids) {
      const c = el('div', 'chip kart'), d = el('i'), pl = st.place[id];
      d.style.background = colorFor(id);
      if (game.phase !== 'lobby') c.append(el('span', 'pos', String(pl || '')));
      c.append(d, el('b', null, nameOf(id)));
      const it = st.item[id], icon = it === 'roll' ? '🎁' : it ? KART_ITEMS[it.split(':')[0]]?.icon + (it.includes(':') ? `×${it.split(':')[1]}` : '') : '';
      const small = st.fin[id] ? `🏁 ${ORD[st.fin[id] - 1]}` : game.phase === 'play' || game.phase === 'count' ? `Lap ${st.lap[id] || 1}/${KART.LAPS}` : '';
      if (small) c.append(el('small', null, small));
      if (icon) c.append(el('span', 'it', icon));
      box.append(c);
    }
    const lead = game.order[0] && game.karts.get(game.order[0]);
    $('round').textContent = game.phase === 'play' && lead ? (lead.fin != null ? 'Finished!' : `Lap ${Math.max(1, lead.lap)} of ${KART.LAPS}`) : '';
  }
  function onKart(e) {
    const k = e.id && game.karts.get(e.id);
    if (e.k === 'boost') S.play('whoosh', { gain: e.tier === 3 || e.tier === 'coffee' ? 0.55 : 0.35, rate: e.tier === 'pad' ? 1.5 : 1.2 });
    else if (e.k === 'bubble') { three.pop(e.x, e.z, '#A8E4FF'); S.play('pop', { gain: 0.5, rate: 1.3 }); }
    else if (e.k === 'item') { S.play('ding', { gain: 0.35, rate: 1.4 }); dirty = true; renderScore(); }
    else if (e.k === 'use') { S.play('click'); dirty = true; renderScore(); }
    else if (e.k === 'spin') { S.play('thump', { gain: 0.7 }); dirty = true; if (k) three.spark(k.x, k.z, 0.8); }
    else if (e.k === 'pop') { S.play('pop'); if (k) three.pop(k.x, k.z); }
    else if (e.k === 'fall') { S.play('splash', { gain: 0.6 }); dirty = true; }
    else if (e.k === 'splat') { three.pop(e.x, e.z, '#FF7EB6'); S.play('pop', { rate: 0.7 }); }
    else if (e.k === 'bump') { if (performance.now() - (onKart.lastBump || 0) > 90) { onKart.lastBump = performance.now(); S.play('pop', { gain: 0.2 + e.power * 0.5, rate: 0.8 + Math.random() * 0.3 }); } three.spark(e.x, e.z, e.power); }
    else if (e.k === 'lap') { if (game.order[0] === e.id) S.play('chime', { gain: 0.5 }); dirty = true; renderScore(); }
    else if (e.k === 'final') { banner('Final lap!', `${nameOf(e.id)} is out in front`, 2.4); S.play('alert'); }
    else if (e.k === 'finish') { dirty = urgent = true; renderScore(); if (e.place === 1) { banner(`${nameOf(e.id)} wins!`, 'Everyone else: bring it home!', 3); S.play('sparkle'); } else S.play('chime', { gain: 0.6, rate: 1 + e.place * 0.05 }); }
    else if (e.k === 'order') { dirty = true; renderScore(); }
    else return false;
    return true;
  }
  function onEvent(e, t) {
    if (kind === 'kart' && e.k !== 'phase' && e.k !== 'matchEnd' && onKart(e)) return;
    if (e.k === 'phase') {
      dirty = urgent = true; renderPanel(); renderScore();
      if (e.phase === 'play') { banner(kind === 'freeze' ? 'RUN!' : kind === 'tug' ? 'PULL!' : 'GO!', '', 0.9, 'go'); S.play('ding'); }
      if (e.phase === 'done' && kind === 'kart') bannerOff();
      if (e.phase === 'count') mud = null;
    } else if (e.k === 'bump') { if (t - (onEvent.lastBump || 0) > 0.06) { onEvent.lastBump = t; S.play(e.power > 0.6 ? 'thump' : 'pop', { gain: 0.3 + e.power * 0.6, rate: 0.9 + Math.random() * 0.3 }); } const a = game.buds.get(e.a), b = game.buds.get(e.b); if (a && b) three.spark((a.x + b.x) / 2, (a.y + b.y) / 2, e.power); }
    else if (e.k === 'dash') S.play('whoosh', { gain: 0.25, rate: 1.5 });
    else if (e.k === 'fall') { S.play('splash', { gain: 0.6 }); dirty = true; renderScore(); }
    else if (e.k === 'roundEnd') {
      dirty = urgent = true; S.play('chime'); renderScore();
      if (kind === 'bumper') banner(e.winner ? `${nameOf(e.winner)} takes round ${game.round}!` : 'Nobody left!', game.round < BUMPER.ROUNDS ? 'Next round coming up…' : '', 3.6);
      else if (kind === 'tug') { banner(`${TEAMS[e.winner].name} takes it${e.timeUp ? ' on time' : ''}!`, `${TEAMS[1 - e.winner].name} goes in the mud`, 3.6); S.play('splash', { gain: 0.8 }); mud = { team: 1 - e.winner, t: 0 }; }
    } else if (e.k === 'matchEnd') { dirty = urgent = true; S.play('sparkle', { gain: 1 }); confetti(); bannerOff(); renderPanel(); renderScore(); }
    else if (e.k === 'light') { dirty = urgent = true; if (e.light === 'red') S.play('alert'); else if (e.light === 'green') S.play('ding', { gain: 0.5 }); }
    else if (e.k === 'caught') { dirty = urgent = true; S.play('splash', { gain: 0.7 }); renderScore(); }
    else if (e.k === 'castle') { dirty = true; S.play('tick', { gain: 0.5, rate: 1.4 }); }
    else if (e.k === 'up') dirty = true;
    else if (e.k === 'finish') { S.play('sparkle'); banner(`${nameOf(e.id)} made it!`, '', 2.4); }
  }

  /* ---------- drawing ---------- */
  const canvas = $('scene'), g = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  function resize() { DPR = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR); }
  addEventListener('resize', resize); resize();
  const sprites = new Map();
  function sprite(id, mood = '') {
    const key = `${id}|${mood}`;
    let c = sprites.get(key);
    if (!c) { c = document.createElement('canvas'); sprites.set(key, c); drawBud(c, buds[id], { size: 150, dpr: 1.5, tint: colorFor(id), happy: mood === 'happy', sleepy: mood === 'sleepy' }); }
    return c;
  }
  const ellipse = (x, y, rx, ry, fill, stroke, lw = 1) => { g.beginPath(); g.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); } };
  // a bud standing with its feet at (x, y)
  function budAt(id, x, y, w, { squashY = 1, rot = 0, alpha = 1, mood = '', ring = true, shadow = true, name = true, lift = 0 } = {}) {
    if (shadow) ellipse(x, y, w * 0.4 * (1 - lift * 0.3), w * 0.11 * (1 - lift * 0.3), `rgba(30,25,60,${0.2 * alpha})`);
    if (ring) ellipse(x, y, w * 0.5, w * 0.16, null, colorFor(id), Math.max(3, w * 0.05));
    g.save(); g.globalAlpha = alpha; g.translate(x, y - lift * w); g.rotate(rot); g.scale(2 - squashY, squashY);
    g.drawImage(sprite(id, mood), -w / 2, -w, w, w); g.restore();
    if (name) tag(nameOf(id), x, y - lift * w - w * squashY - 8, colorFor(id), alpha);
  }
  function tag(text, x, y, color, alpha = 1) {
    const fs = clamp(H * 0.021, 13, 24); g.font = `600 ${fs}px Fredoka, Nunito, ui-rounded, system-ui, sans-serif`;
    const tw = g.measureText(text).width + fs * 1.1, th = fs * 1.5;
    g.globalAlpha = alpha; g.fillStyle = color; g.beginPath(); g.roundRect(x - tw / 2, y - th, tw, th, th / 2); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y - th / 2 + 1); g.globalAlpha = 1;
  }
  // little things that fly and fade: { draw(k) } with k from 0 to 1
  const fx = [];
  const addFx = (life, draw) => fx.push({ t: 0, life, draw });
  function confetti() { for (let i = 0; i < 90; i++) { const x = Math.random() * W, c = COLORS[i % COLORS.length], vx = (Math.random() - 0.5) * 120, sp = 220 + Math.random() * 260, r = Math.random() * 6; addFx(2.2 + Math.random(), (k, t) => { g.save(); g.translate(x + vx * t, -20 + sp * t); g.rotate(r + t * 6); g.fillStyle = c; g.globalAlpha = 1 - k * k; g.fillRect(-7, -4, 14, 8); g.restore(); }); } }
  let mud = null;
  // While the panel is up (lobby, results) the picture slides over to make room for it. 0 in play, 1 aside.
  const view = { k: 1 };
  function easeView() { const idle = game.phase === 'lobby' || game.phase === 'done', wide = W > H * 1.2; view.k += ((idle && wide ? 1 : 0) - view.k) * 0.08; return view.k; }
  const three = make3d($('scene3d'), { colorFor, nameOf, budData: (id) => buds[id] });

  function drawTug(T) {
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#BFD9FF'); sky.addColorStop(0.7, '#FBE3EF'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const a = easeView(), mid = W * lerp(0.5, 0.66, a), gy = H * 0.8, D = W * lerp(0.15, 0.1, a), bw = clamp(H * lerp(0.2, 0.15, a), 70, 200);
    g.fillStyle = '#86CF86'; g.fillRect(0, gy - 10, W, H - gy + 10); g.fillStyle = '#6DB774'; g.fillRect(0, gy + H * 0.08, W, H);
    for (let i = 0; i < 4; i++) { const x = ((i * 0.31 + T * 0.006) % 1.2 - 0.1) * W, y = H * (0.3 + (i % 2) * 0.09), s = H * 0.035 * (1 + (i % 3) * 0.3); ellipse(x, y, s * 2.2, s * 0.8, 'rgba(255,255,255,.7)'); ellipse(x - s, y - s * 0.4, s, s * 0.7, 'rgba(255,255,255,.7)'); ellipse(x + s * 0.6, y - s * 0.5, s * 1.2, s * 0.8, 'rgba(255,255,255,.7)'); }
    ellipse(mid, gy + 14, D * 0.62, 26, '#8A5A3C'); ellipse(mid - D * 0.15, gy + 9, D * 0.25, 8, 'rgba(255,255,255,.14)');
    const playing = game.phase !== 'lobby';
    if (!playing) {
      // the lobby: everyone in a row, hopping when they tap
      const n = roster.length, sp = Math.min(bw * 1.15, W * 0.58 / Math.max(1, n));
      roster.forEach((p, i) => { const pu = game.pulse[p.id] || 0; budAt(p.id, mid + (i - (n - 1) / 2) * sp, gy - 30, bw, { lift: pu * 0.25, squashY: 1 + pu * 0.1 }); });
      return;
    }
    const knot = mid + game.x * D, ropeY = gy - bw * 0.42;
    const ends = [knot, knot];
    const spots = [];
    for (const t of [0, 1]) {
      const m = roster.filter((p) => game.team[p.id] === t), dir = t ? 1 : -1, sp = Math.min(bw * 0.95, W * lerp(0.3, 0.17, a) / Math.max(1, m.length));
      m.forEach((p, i) => { const x = knot + dir * (D * 0.72 + bw / 2 + i * sp); spots.push({ p, x, t, i }); ends[t] = x + dir * bw * 0.3; });
    }
    g.strokeStyle = '#8A5A3C'; g.lineWidth = Math.max(6, bw * 0.07); g.lineCap = 'round'; g.beginPath(); g.moveTo(ends[0], ropeY); g.lineTo(ends[1], ropeY); g.stroke();
    g.strokeStyle = '#C9A27A'; g.lineWidth = 2; g.setLineDash([10, 14]); g.beginPath(); g.moveTo(ends[0], ropeY - 2); g.lineTo(ends[1], ropeY - 2); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#E8394B'; g.beginPath(); g.moveTo(knot - 9, ropeY - 12); g.lineTo(knot + 9, ropeY - 12); g.lineTo(knot + 5, ropeY + 44); g.lineTo(knot, ropeY + 34); g.lineTo(knot - 5, ropeY + 44); g.closePath(); g.fill();
    // the lines: get the knot past yours to win
    for (const t of [0, 1]) { const x = mid + (t ? 1 : -1) * D; g.strokeStyle = TEAMS[t].color; g.lineWidth = 5; g.setLineDash([4, 10]); g.beginPath(); g.moveTo(x, gy - bw * 1.1); g.lineTo(x, gy + 30); g.stroke(); g.setLineDash([]); }
    if (mud) mud.t += 1 / 60;
    const over = game.phase === 'round' || game.phase === 'done' ? game.last ?? game.champ : null;
    for (const s of spots.sort((a, b) => b.i - a.i)) {
      const pu = game.pulse[s.p.id] || 0, dir = s.t ? 1 : -1, won = over === s.t, lost = over != null && !won;
      const sunk = lost && s.i === 0 ? clamp((mud?.t || 1) * 1.6, 0, 1) : 0;
      const x = lost && s.i === 0 ? lerp(s.x, mid - dir * D * 0.1, sunk) : s.x;
      budAt(s.p.id, x, gy - 30 + sunk * 34, bw, { rot: lost ? -dir * 0.3 * (s.i === 0 ? 1 : 0.4) : dir * (0.16 + pu * 0.14), lift: won ? Math.abs(Math.sin(T * 7 + s.i)) * 0.25 : 0, mood: won ? 'happy' : '', squashY: 1 - pu * 0.06 });
      if (sunk > 0.3) ellipse(x, gy + 6, bw * 0.5, bw * 0.16, '#8A5A3C');
    }
    // how hard each side is pulling
    const bar = W * 0.2, by = H * 0.22, bh = clamp(H * 0.024, 14, 30);
    for (const t of [0, 1]) { const dir = t ? 1 : -1, len = bar * clamp(game.power[t] / TUG.MAX_RATE, 0, 1); g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.roundRect(mid + dir * 14 + (t ? 0 : -bar), by, bar, bh, bh / 2); g.fill(); g.fillStyle = TEAMS[t].color; g.beginPath(); g.roundRect(mid + dir * 14 + (t ? 0 : -len), by, len, bh, bh / 2); g.fill(); }
    g.font = `700 ${clamp(H * 0.08, 34, 96)}px Fredoka, Nunito, ui-rounded, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = TEAMS[0].color; g.fillText(String(game.score[0]), mid - bar * 0.5, by - 14); g.fillStyle = TEAMS[1].color; g.fillText(String(game.score[1]), mid + bar * 0.5, by - 14);
    if (game.phase === 'play') { const left = Math.max(0, Math.ceil(TUG.CAP - game.t)); if (left <= 10) { g.fillStyle = '#1D1C2B'; g.font = `700 ${clamp(H * 0.05, 24, 54)}px Fredoka, system-ui, sans-serif`; g.fillText(String(left), mid, by + bh); } }
  }

  // Freeze: the big RUN! / FREEZE! sign, for anyone not watching the crab
  function freezeSign() {
    const looking = kind === 'freeze' && game.phase === 'play' && game.light === 'red', lit = $('light');
    lit.hidden = !(kind === 'freeze' && game.phase === 'play' && !game.winner);
    if (!lit.hidden) { lit.textContent = looking ? 'FREEZE!' : 'RUN!'; lit.className = 'light ' + (looking ? 'red' : 'green'); }
    document.body.classList.toggle('looking', looking);
  }

  /* ---------- the loop ---------- */
  let last = performance.now(), T = 0, lastCount = 0, lastKartState = '';
  function frame(now) {
    // The game keeps real time even when the picture is slow: it moves on in small steps to catch up
    // (up to a quarter of a second a frame; past that, a struggling TV slows the game down rather than skipping it).
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    const inputs = {};
    for (const p of roster) inputs[p.id] = parseInput(kind, raw.get(p.id));
    for (let left = dt; left > 1e-6;) { const h = Math.min(1 / 60, left); left -= h; T += h; game.step(h, inputs, T); }
    for (const e of game.drain()) onEvent(e, T);
    if (game.phase === 'count') { const n = Math.max(1, Math.min(3, Math.ceil(COUNT_S - game.t))); if (n !== lastCount) { lastCount = n; banner(String(n), n === 3 ? (kind === 'kart' ? 'Three laps. Drift on the corners!' : kind === 'bumper' ? `Round ${game.round}` : kind === 'tug' ? `Round ${game.round}: ${TEAMS[0].name} against ${TEAMS[1].name}` : 'Run while it naps. Freeze when it looks!') : '', 1.05, 'count'); S.play('tick'); } } else lastCount = 0;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    const flat = kind === 'tug';
    if ($('scene3d').hidden !== flat) $('scene3d').hidden = flat;
    if (flat) drawTug(T); else { g.clearRect(0, 0, W, H); three.render(kind, game, T, dt, easeView(), roster); }
    freezeSign();
    for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; f.t += dt; if (f.t >= f.life) { fx.splice(i, 1); continue; } f.draw(f.t / f.life, f.t); }
    // the race changes all the time (places, items): tell the phones a few times a second, only when it changed
    if (kind === 'kart' && !dirty && now - lastPub > 250) { const sk = JSON.stringify(game.state()); if (sk !== lastKartState) { lastKartState = sk; dirty = true; } }
    if (dirty && (urgent || now - lastPub > (kind === 'kart' ? 200 : 120))) publish(now);
    requestAnimationFrame(frame);
  }

  /* ---------- the TV's own buttons ---------- */
  $('gameName').textContent = GAME_INFO[kind].name; document.title = `${GAME_INFO[kind].name} · the buddie system`;
  // leaving: tell the phones over the live room first, so they follow at once
  $('otherBtn').addEventListener('click', async () => { await Promise.race([room.update('meta', { away: room.stamp() }), new Promise((r) => setTimeout(r, 800))]); backToPicker(code); });
  $('otherBtn').before(joinChip(code));
  S.bindToggle($('soundBtn')); if (!window.BudSound) $('soundBtn').hidden = true;
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.key === ' ' || e.key === 'Enter') { if (document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); primary(); } }
    else if (['1', '2', '3', '4'].includes(e.key) && (game.phase === 'lobby' || game.phase === 'done')) setKind(KINDS[Number(e.key) - 1]);
  });
  keepAwake();
  if (kind === 'kart') loadPool();
  refreshRoster(); renderPanel(); renderScore();
  requestAnimationFrame(frame);
  // for the tests: a look inside
  return { get game() { return game; }, get kind() { return kind; }, get roster() { return roster; }, setKind, primary, raw, players, three, fast(on) { three.skip = on; } };
}
