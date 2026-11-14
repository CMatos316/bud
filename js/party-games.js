// The three live party games, as the TV plays them: Bumper Buds, Tug of War and Freeze.
// Nothing in here draws or talks to the network. Each game is handed the latest thing every phone said, moves
// time forward a step, and notes what happened (events). js/party-tv.js draws it, makes the noises and passes
// the score on to the phones; js/party-pad.js is the phone's side. Because it's only numbers, it can be tested
// without a screen.
//
// A game goes: lobby → count (3, 2, 1) → play → round (who won it) → count … → done (who won it all).
// What a phone sends is one short string, the newest replacing the last (parse() below reads it). Anything that
// mustn't be missed is a running count (dashes, taps, steps), so a dropped message loses nothing.

export const COLORS = ['#FF7A59', '#4FB3FF', '#7C6CFF', '#3BB273', '#FF7EB6', '#F2B300', '#00B8A9', '#B86BFF', '#FF5964', '#8BC34A', '#5C7CFA', '#FF9F1C'];
export const MIN_PLAYERS = 2, MAX_PLAYERS = 12;
export const COUNT_S = 3.2, ROUND_S = 4;
export const GAME_INFO = {
  bumper: { name: 'Bumper Buds', how: 'Bump everyone else off the island. It shrinks! Three rounds: a point for every bud you outlast, and one more for winning.', pad: 'Steer with your thumb. Dash to hit hard.' },
  tug: { name: 'Tug of War', how: 'Two teams, one rope. Drag the other side into the mud. Best of three.', pad: 'Tap as fast as you can.' },
  freeze: { name: 'Freeze', how: 'Run while the crab naps. Freeze when it looks, or a wave washes you back to the last sandcastle and leaves you dizzy. First to the campfire wins.', pad: 'Shake your phone to run. Hold still to freeze.' },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

class Game {
  constructor(kind, rand = Math.random) { this.kind = kind; this.rand = rand; this.phase = 'lobby'; this.t = 0; this.round = 0; this.events = []; this.roster = []; }
  // who's here right now: [{ id, name, c }] (c is their color)
  setRoster(list) { this.roster = list.slice(0, MAX_PLAYERS); this.onRoster(); }
  onRoster() {}
  here(id) { return this.roster.some((p) => p.id === id); }
  emit(k, data = {}) { this.events.push({ k, ...data }); }
  drain() { const e = this.events; this.events = []; return e; }
  go(phase) { this.phase = phase; this.t = 0; this.emit('phase', { phase }); }
  canStart() { return (this.phase === 'lobby' || this.phase === 'done') && this.roster.length >= MIN_PLAYERS; }
  start() { if (!this.canStart()) return false; this.begin(); return true; }
  who(extra = () => ({})) { return Object.fromEntries(this.roster.map((p) => [p.id, { c: p.c, n: p.name, ...extra(p.id) }])); }
}

/* ============================== Bumper Buds ============================== */
// An island you can fall off. Everyone is a circle; a thumbstick pushes you around and a dash throws you forward.
// Hit someone and you both bounce (a dashing bud hits like three). The island holds still for a while, then
// shrinks. Each round you score one point for every bud you outlast, and one more if you're the last one standing.
// The island is sized to the crowd: cosy for two, roomy for twelve.
export const arena = (n) => clamp(4 + 2 * Math.sqrt(Math.max(2, n)), 6.5, 11);
export const BUMPER = { RMIN: 2.6, BUD: 0.85, ACC: 27, DRAG: 3.1, DASH: 9.5, DASH_COOL: 1.7, DASH_T: 0.26, HOLD: 10, SHRINK: 38, CAP: 75, ROUNDS: 3, FALL_S: 0.9, BOUNCE: 1.25 };

export class Bumper extends Game {
  static parse(s) { const [x, y, d] = String(s || '').split(','); return { x: clamp(num(x) / 100, -1, 1), y: clamp(num(y) / 100, -1, 1), d: num(d) }; }
  constructor(rand) { super('bumper', rand); this.buds = new Map(); this.R0 = arena(2); this.R = this.R0; this.score = {}; this.out = []; this.inRound = []; this.last = null; this.champs = null; }
  spawn(id, x, y) { const old = this.buds.get(id); const b = { id, x, y, vx: 0, vy: 0, fx: 0, fy: 1, cool: 0, dashT: 0, dashSeen: old ? old.dashSeen : null, fall: 0, gone: false, hit: 0 }; this.buds.set(id, b); return b; }
  onRoster() {
    // in the lobby (and after a match) everyone can drive around; mid-match, newcomers wait for the next round
    if (this.phase === 'lobby' || this.phase === 'done') {
      this.R0 = this.R = arena(this.roster.length);
      for (const p of this.roster) if (!this.buds.has(p.id)) { const a = this.rand() * Math.PI * 2, r = (0.25 + this.rand() * 0.45) * this.R0; this.spawn(p.id, Math.cos(a) * r, Math.sin(a) * r); }
      for (const id of [...this.buds.keys()]) if (!this.here(id)) this.buds.delete(id);
    }
  }
  begin() { this.score = {}; this.round = 0; this.champs = null; this.nextRound(); }
  nextRound() {
    this.round++; this.out = []; this.last = null;
    this.inRound = this.roster.map((p) => p.id);
    this.R0 = this.R = arena(this.inRound.length);
    for (const id of [...this.buds.keys()]) if (!this.inRound.includes(id)) this.buds.delete(id);
    const turn = this.rand() * Math.PI * 2, n = this.inRound.length;
    this.inRound.forEach((id, i) => { const a = turn + i / n * Math.PI * 2, b = this.spawn(id, Math.cos(a) * this.R0 * 0.62, Math.sin(a) * this.R0 * 0.62); b.fx = -Math.cos(a); b.fy = -Math.sin(a); if (!(id in this.score)) this.score[id] = 0; });
    this.go('count');
  }
  alive() { return [...this.buds.values()].filter((b) => !b.fall && !b.gone); }
  step(dt, inputs = {}) {
    this.t += dt;
    if (this.phase === 'lobby' || this.phase === 'done') this.move(dt, inputs, true);
    else if (this.phase === 'count') { this.move(dt, {}, false); if (this.t >= COUNT_S) this.go('play'); }
    else if (this.phase === 'play') {
      const B = BUMPER;
      this.R = this.t < B.HOLD ? this.R0 : Math.max(B.RMIN, this.R0 - (this.t - B.HOLD) * (this.R0 - B.RMIN) / B.SHRINK);
      this.move(dt, inputs, false);
      let alive = this.alive();
      if (alive.length > 1 && this.t >= B.CAP) {
        // out of time: whoever's nearest the middle takes it
        alive.sort((a, b) => Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y));
        for (const b of alive.slice(0, -1)) { b.fall = 1e-6; this.out.push(b.id); this.emit('fall', { id: b.id }); }
        alive = alive.slice(-1);
      }
      if (alive.length <= 1) this.endRound(alive[0]?.id ?? this.out[this.out.length - 1] ?? null);
    } else if (this.phase === 'round') {
      this.move(dt, {}, false);
      if (this.t >= ROUND_S) { if (this.round >= BUMPER.ROUNDS) this.finish(); else if (this.roster.length >= MIN_PLAYERS) this.nextRound(); else this.finish(); }
    }
  }
  endRound(winner) {
    const order = [...this.out.filter((id) => id !== winner), ...(winner ? [winner] : [])];   // first out … last standing
    order.forEach((id, i) => { this.score[id] = (this.score[id] || 0) + i + (id === winner ? 1 : 0); });   // one for each bud you outlast, and one more for winning
    this.last = winner; this.emit('roundEnd', { winner, order });
    this.go('round');
  }
  finish() {
    const top = Math.max(0, ...Object.values(this.score));
    this.champs = Object.keys(this.score).filter((id) => this.score[id] === top);
    this.emit('matchEnd', { champs: this.champs });
    this.go('done');
    this.onRoster();
    for (const b of this.buds.values()) { b.fall = 0; b.gone = false; if (Math.hypot(b.x, b.y) > this.R0 - 1.5) { const a = this.rand() * Math.PI * 2; b.x = Math.cos(a) * 2; b.y = Math.sin(a) * 2; } b.vx = b.vy = 0; }
  }
  move(dt, inputs, free) {
    const B = BUMPER, steps = dt > 0.02 ? 2 : 1, h = dt / steps;
    for (let s = 0; s < steps; s++) {
      const buds = [...this.buds.values()];
      for (const b of buds) {
        b.hit = Math.max(0, b.hit - h * 3);
        if (b.gone) continue;
        if (b.fall) {
          b.fall += h; b.x += b.vx * h; b.y += b.vy * h; b.vx *= Math.exp(-7 * h); b.vy *= Math.exp(-7 * h);
          if (b.fall > B.FALL_S) { if (free) { const a = this.rand() * Math.PI * 2; Object.assign(b, { x: Math.cos(a) * 2, y: Math.sin(a) * 2, vx: 0, vy: 0, fall: 0 }); this.emit('back', { id: b.id }); } else b.gone = true; }
          continue;
        }
        const inp = inputs[b.id] || { x: 0, y: 0, d: b.dashSeen ?? 0 };
        let sx = inp.x, sy = inp.y; const mag = Math.hypot(sx, sy);
        if (mag > 1) { sx /= mag; sy /= mag; }
        if (mag > 0.2) { b.fx = sx / Math.min(1, mag); b.fy = sy / Math.min(1, mag); }
        b.cool = Math.max(0, b.cool - h); b.dashT = Math.max(0, b.dashT - h);
        if (b.dashSeen == null) b.dashSeen = inp.d;                       // the count so far isn't a dash
        else if (inp.d !== b.dashSeen) {
          b.dashSeen = inp.d;
          if (b.cool <= 0) { b.vx += b.fx * B.DASH; b.vy += b.fy * B.DASH; b.cool = B.DASH_COOL; b.dashT = B.DASH_T; this.emit('dash', { id: b.id }); }
        }
        b.vx += sx * B.ACC * h; b.vy += sy * B.ACC * h;
        const drag = Math.exp(-(b.dashT > 0 ? B.DRAG * 0.4 : B.DRAG) * h);
        b.vx *= drag; b.vy *= drag;
        b.x += b.vx * h; b.y += b.vy * h;
      }
      // buds bounce off each other
      const up = buds.filter((b) => !b.fall && !b.gone);
      for (let i = 0; i < up.length; i++) for (let j = i + 1; j < up.length; j++) {
        const a = up[i], c = up[j]; let dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy);
        if (d >= B.BUD * 2) continue;
        if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
        const nx = dx / d, ny = dy / d, ma = a.dashT > 0 ? 3 : 1, mc = c.dashT > 0 ? 3 : 1;
        const push = (B.BUD * 2 - d), wa = mc / (ma + mc), wc = ma / (ma + mc);
        a.x -= nx * push * wa; a.y -= ny * push * wa; c.x += nx * push * wc; c.y += ny * push * wc;
        const closing = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
        if (closing <= 0) continue;
        const J = Math.max((1 + B.BOUNCE) * closing, 5) / (1 / ma + 1 / mc);
        a.vx -= J / ma * nx; a.vy -= J / ma * ny; c.vx += J / mc * nx; c.vy += J / mc * ny;
        a.hit = c.hit = 1; this.emit('bump', { a: a.id, b: c.id, power: clamp(closing / 12, 0.15, 1) });
      }
      // over the edge
      for (const b of up) if (Math.hypot(b.x, b.y) > this.R + 0.15) {
        b.fall = 1e-6; this.emit('fall', { id: b.id });
        if (!free && this.phase === 'play') this.out.push(b.id);
      }
    }
  }
  state() {
    const out = Object.fromEntries(this.out.map((id) => [id, 1]));
    return { g: 'bumper', phase: this.phase, round: this.round, rounds: BUMPER.ROUNDS, who: this.who((id) => ({ in: this.phase === 'lobby' || this.phase === 'done' || this.inRound.includes(id) })), out, score: this.score, last: this.last, champs: this.champs };
  }
}

/* ============================== Tug of War ============================== */
// Two teams and a rope. Every tap is a pull. A team pulls as hard as its average member taps, so three against
// four is still fair. Drag the knot to your side (or be ahead when time's up) to win the round. Best of three.
export const TUG = { K: 0.055, WINDOW: 0.7, MAX_RATE: 14, CAP: 30, WINS: 2 };

export class Tug extends Game {
  static parse(s) { return { n: num(s) }; }
  constructor(rand) { super('tug', rand); this.team = {}; this.x = 0; this.v = 0; this.taps = {}; this.seen = {}; this.pulse = {}; this.power = [0, 0]; this.score = [0, 0]; this.last = null; this.champ = null; }
  onRoster() {
    if (this.phase === 'lobby' || this.phase === 'done') return;
    for (const p of this.roster) if (!(p.id in this.team)) this.team[p.id] = this.size(0) <= this.size(1) ? 0 : 1;   // a latecomer joins the smaller side
  }
  size(t) { return this.roster.filter((p) => this.team[p.id] === t).length; }
  begin() {
    const ids = this.roster.map((p) => p.id);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    this.team = Object.fromEntries(ids.map((id, i) => [id, i % 2]));
    this.score = [0, 0]; this.round = 0; this.champ = null; this.nextRound();
  }
  nextRound() { this.round++; this.x = 0; this.v = 0; this.taps = {}; this.power = [0, 0]; this.last = null; this.go('count'); }
  step(dt, inputs = {}, now = 0) {
    this.t += dt;
    // new taps since last time, for everyone here (in any phase, so buds can hop in the lobby)
    for (const p of this.roster) {
      const n = inputs[p.id]?.n ?? 0, was = this.seen[p.id];
      this.seen[p.id] = n;
      this.pulse[p.id] = Math.max(0, (this.pulse[p.id] || 0) - dt * 4);
      if (was == null || n <= was) continue;
      this.pulse[p.id] = 1;
      if (this.phase !== 'play') continue;
      const list = this.taps[p.id] || (this.taps[p.id] = []);
      for (let k = 0; k < Math.min(n - was, 4); k++) list.push(now);
    }
    if (this.phase === 'count') { if (this.t >= COUNT_S) this.go('play'); }
    else if (this.phase === 'play') {
      const rate = (id) => { const list = this.taps[id] || []; while (list.length && now - list[0] > TUG.WINDOW) list.shift(); return Math.min(TUG.MAX_RATE, list.length / TUG.WINDOW); };
      for (const t of [0, 1]) { const m = this.roster.filter((p) => this.team[p.id] === t); this.power[t] = m.length ? m.reduce((s, p) => s + rate(p.id), 0) / m.length : 0; }
      const target = TUG.K * (this.power[1] - this.power[0]);
      this.v += (target - this.v) * (1 - Math.exp(-dt / 0.2));
      this.x = clamp(this.x + this.v * dt, -1, 1);
      const timeUp = this.t >= TUG.CAP;
      if (Math.abs(this.x) >= 1 || (timeUp && this.x !== 0) || this.t >= TUG.CAP + 10) {
        const w = this.x > 0 ? 1 : this.x < 0 ? 0 : this.rand() < 0.5 ? 0 : 1;
        this.score[w]++; this.last = w; this.emit('roundEnd', { winner: w, timeUp: Math.abs(this.x) < 1 });
        this.go('round');
      }
    } else if (this.phase === 'round') {
      if (this.t >= ROUND_S) {
        if (this.score[this.last] >= TUG.WINS || this.roster.length < MIN_PLAYERS) { this.champ = this.score[0] === this.score[1] ? this.last : this.score[0] > this.score[1] ? 0 : 1; this.emit('matchEnd', { champ: this.champ }); this.go('done'); }
        else this.nextRound();
      }
    }
  }
  state() {
    const teams = this.phase === 'lobby' ? {} : this.team;
    return { g: 'tug', phase: this.phase, round: this.round, who: this.who((id) => (id in teams ? { team: teams[id], in: true } : { in: this.phase === 'lobby' })), score: this.score, last: this.last, champ: this.champ };
  }
}

/* ============================== Freeze ============================== */
// Red light, green light. A crab naps at the far end of the beach. While it naps, run (every shake of the phone is
// a few steps). It stirs, then it looks: move while it's looking and a wave carries you back to the last
// sandcastle you passed, and leaves you too dizzy to run until a little after the crab nods off again (so running
// straight through never pays). Sometimes it only stirs. First to the campfire wins.
export const FREEZE = { STEPS: 200, RATE: 12, GRACE: 0.7, WARN: 0.6, GREEN: [2.2, 5], RED: [2, 3.4], FAKE: 0.2, STUN: 1.2, DIZZY: 1.6, CASTLES: [0, 1 / 3, 2 / 3], CAP: 150, END_S: 2 };

export class Freeze extends Game {
  static parse(s) { return { m: num(s) }; }
  constructor(rand) { super('freeze', rand); this.runners = new Map(); this.light = 'green'; this.left = 0; this.redT = 0; this.winner = null; this.endAt = null; this.place = null; this.seen = {}; this.wiggle = {}; }
  begin() {
    this.runners = new Map(this.roster.map((p) => [p.id, { id: p.id, p: 0, castle: 0, bucket: 3, caught: 0, stun: 0, hitThisLook: false, done: null, moving: 0 }]));
    this.round = 1; this.winner = null; this.endAt = null; this.place = null; this.light = 'green';
    this.go('count');
  }
  between([a, b]) { return a + this.rand() * (b - a); }
  setLight(light) {
    this.light = light;
    this.left = light === 'green' ? this.between(FREEZE.GREEN) : light === 'warn' ? FREEZE.WARN : this.between(FREEZE.RED);
    if (light === 'red') { this.redT = 0; for (const r of this.runners.values()) r.hitThisLook = false; }
    this.emit('light', { light });
  }
  step(dt, inputs = {}) {
    this.t += dt;
    // how far every phone has "run" since last time (in any phase, so buds can wiggle in the lobby)
    const moved = {};
    for (const p of this.roster) {
      const m = inputs[p.id]?.m ?? 0, was = this.seen[p.id];
      this.seen[p.id] = m; moved[p.id] = was == null || m < was ? 0 : m - was;
      this.wiggle[p.id] = moved[p.id] > 0 ? 1 : Math.max(0, (this.wiggle[p.id] || 0) - dt * 3);
    }
    if (this.phase === 'count') { if (this.t >= COUNT_S) { this.go('play'); this.setLight('green'); } }
    else if (this.phase === 'play') {
      const F = FREEZE;
      this.left -= dt;
      if (this.light === 'red') this.redT += dt;
      if (this.left <= 0 && !this.winner) this.setLight(this.light === 'green' ? 'warn' : this.light === 'warn' ? (this.rand() < F.FAKE ? 'green' : 'red') : 'green');
      for (const r of this.runners.values()) {
        const d = moved[r.id] || 0;
        if (r.stun > 0) { r.stun = Math.max(0, r.stun - dt); if (!r.stun) this.emit('up', { id: r.id }); }
        r.bucket = Math.min(r.bucket + F.RATE * dt, 5);
        r.moving = d > 0 ? 1 : Math.max(0, r.moving - dt * 4);
        if (r.done != null || r.stun > 0 || d <= 0 || this.winner) continue;
        if (this.light === 'red' && this.redT > F.GRACE) {
          if (!r.hitThisLook) { r.hitThisLook = true; r.caught++; r.from = r.p; r.p = r.castle; r.stun = Math.max(F.STUN, this.left + F.DIZZY); this.emit('caught', { id: r.id }); }
          continue;
        }
        const take = Math.min(d, r.bucket); r.bucket -= take;
        r.p = Math.min(1, r.p + take / F.STEPS);
        const c = F.CASTLES.filter((x) => x <= r.p).pop();
        if (c > r.castle) { r.castle = c; this.emit('castle', { id: r.id }); }
        if (r.p >= 1) { r.done = this.t; this.winner = r.id; this.endAt = this.t + F.END_S; this.emit('finish', { id: r.id }); }
      }
      if ((this.winner && this.t >= this.endAt) || this.t >= F.CAP) {
        this.place = [...this.runners.values()].sort((a, b) => b.p - a.p || a.caught - b.caught).map((r) => r.id);
        this.winner = this.winner || this.place[0];
        this.emit('matchEnd', { winner: this.winner, place: this.place });
        this.go('done');
      }
    }
  }
  state() {
    const run = [...this.runners.values()];
    return {
      g: 'freeze', phase: this.phase, round: this.round, light: this.light === 'red' ? 'red' : 'green',
      who: this.who((id) => ({ in: this.phase === 'lobby' || this.runners.has(id) })),
      hit: Object.fromEntries(run.filter((r) => r.caught).map((r) => [r.id, r.caught])),
      dizzy: Object.fromEntries(run.filter((r) => r.stun > 0).map((r) => [r.id, 1])),
      castle: Object.fromEntries(run.map((r) => [r.id, FREEZE.CASTLES.indexOf(r.castle)])),
      winner: this.winner, place: this.place,
    };
  }
}

export const makeGame = (kind, rand) => (kind === 'tug' ? new Tug(rand) : kind === 'freeze' ? new Freeze(rand) : new Bumper(rand));
export const parseInput = (kind, s) => (kind === 'tug' ? Tug : kind === 'freeze' ? Freeze : Bumper).parse(s);
