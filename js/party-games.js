// The live party games, as the TV plays them: Bumper Buds, Tug of War, Freeze, Island Grand Prix and Acorn Heist.
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
  bumper: { name: 'Bumper Buds', how: 'Bump everyone else off the island. It shrinks! Three rounds: a point for every bud you outlast, and one more for winning.', pad: 'Hold it sideways. Steer with your left thumb, dash with your right.' },
  tug: { name: 'Tug of War', how: 'Two teams, one rope. Drag the other side into the mud. Best of three.', pad: 'Tap as fast as you can.' },
  kart: { name: 'Island Grand Prix', how: 'Three laps round the island in karts. Drift round corners for a boost, pop gift bubbles for something silly, and stay out of the lagoon.', pad: 'Hold it sideways. Point where you want to go, hold Drift on corners, tap the item to use it.' },
  heist: { name: 'Acorn Heist', how: 'One of you is the tree. Everyone else sneaks in, grabs acorns from under it and runs them to the baskets. The tree drops pinecones on their heads and shakes them loose. Everyone gets a turn as the tree.', pad: 'Hold it sideways. Collectors: steer and dash. The tree: steer your shadow, drop pinecones, shake.' },
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

/* ============================== Island Grand Prix ============================== */
// Kart racing round a ring of land with a lagoon in the middle. Three laps. Everyone drives at full speed by
// themselves: the phone's stick says which way to point (on the TV's screen, not "left and right" from the
// kart's seat, so it reads the same however the kart is facing), Drift slides round corners and charges up a
// boost, and gift bubbles on the track give out something silly to use. Off the road is slow sand; past the
// sand is the lagoon, and a bud that ends up in it bobs back to the road on a floatie.
// Buds from the island fill the grid (CPU drivers) when there aren't enough people, so one person can race.
export const KART = {
  LAPS: 3, HW: 4.4, SAND: 5, VMAX: 15.5, VSAND: 7, VBOOST: 23.5, ACC: 12, TURN: 2.7, DTURN: 3.6, R: 1.05,
  CHARGE: [0.55, 1.25, 2.1], BOOST: [0.55, 0.95, 1.4], COFFEE: 1.3, PAD: 0.9, SPIN: 1.05, SINK: 0.55, FLOAT: 1.3,
  ROLL: 1.1, RESPAWN: 2.5, NUT_V: 28, NUT_LIFE: 4.5, JELLY_LIFE: 30, SHIELD: 10, GULL: 1.5, WAIT: 15, FILL: 6, CAP: 360, END_S: 3,
};
export const KART_ITEMS = {
  coffee: { name: 'Coffee', icon: '☕', what: 'a burst of speed' },
  coffee3: { name: 'Triple coffee', icon: '☕', what: 'three bursts of speed' },
  coconut: { name: 'Coconut', icon: '🥥', what: 'rolls ahead down the road and knocks over whoever it hits' },
  jelly: { name: 'Jelly', icon: '🍮', what: 'dropped behind you; whoever drives into it spins out' },
  bubble: { name: 'Bubble', icon: '🫧', what: 'a shield that pops instead of you' },
  gull: { name: 'Seagull', icon: '🐦', what: 'flies to whoever is in front and pinches their item' },
};
// what a gift bubble gives, by where you are in the race: the front gets defensive things, the back gets help
const ODDS = {
  front: { jelly: 40, coconut: 30, bubble: 20, coffee: 10 },
  middle: { coconut: 30, coffee: 25, jelly: 18, bubble: 10, gull: 10, coffee3: 7 },
  back: { coffee3: 30, gull: 25, coffee: 20, coconut: 20, bubble: 5 },
};
// The road's middle line, round the island (x across the TV, z toward the viewer). The start is on the bottom
// straight, heading right.
const KART_PTS = [[-10, 23], [10, 23.5], [28, 21], [42, 12], [45, -3], [37, -14], [24, -12], [14, -2], [2, -1], [-6, -12], [-18, -22], [-36, -22], [-48, -11], [-48, 5], [-36, 18]];
const CPU_NAMES = ['Pebble', 'Kelp', 'Mochi', 'Taro', 'Biscuit', 'Sprout', 'Noodle', 'Puddle'];

// The road as evenly spaced points (every 0.8 or so), each with its direction (t) and its right-hand side (n).
export function kartTrack(pts = KART_PTS.map(([x, z]) => [x * 1.2, z * 1.2])) {
  const n = pts.length, dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < 40; k++) {
      const t = k / 40, t2 = t * t, t3 = t2 * t, cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      dense.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) { const a = dense[i - 1], b = dense[i % dense.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[dense.length], N = Math.round(L / 0.8), step = L / N, P = [];
  for (let i = 0, j = 0; i < N; i++) {
    const s = i * step;
    while (cum[j + 1] < s) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length], f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    P.push({ x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, s });
  }
  for (let i = 0; i < N; i++) {
    const a = P[(i - 1 + N) % N], b = P[(i + 1) % N], dx = b.x - a.x, dz = b.z - a.z, m = Math.hypot(dx, dz) || 1;
    Object.assign(P[i], { tx: dx / m, tz: dz / m, nx: -dz / m, nz: dx / m });
  }
  const T = { pts: P, N, L, step, HW: KART.HW, SAND: KART.SAND };
  // the nearest point of the road: which sample, how far round (s), and how far to its right (lat)
  T.locate = (x, z) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < N; i++) { const p = P[i], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } }
    const p = P[best], dx = x - p.x, dz = z - p.z;
    let s = p.s + dx * p.tx + dz * p.tz; s = ((s % L) + L) % L;
    return { i: best, s, lat: dx * p.nx + dz * p.nz };
  };
  // a spot on the road, s of the way round and lat to the right
  T.at = (s, lat = 0) => {
    s = ((s % L) + L) % L;
    const f = s / step, i = Math.floor(f) % N, k = f - Math.floor(f), a = P[i], b = P[(i + 1) % N];
    const nx = a.nx + (b.nx - a.nx) * k, nz = a.nz + (b.nz - a.nz) * k;
    return { x: a.x + (b.x - a.x) * k + nx * lat, z: a.z + (b.z - a.z) * k + nz * lat, tx: a.tx + (b.tx - a.tx) * k, tz: a.tz + (b.tz - a.tz) * k, nx, nz };
  };
  // how much the road turns over the next `ahead` metres (radians)
  T.bend = (s, ahead) => { const a = T.at(s), b = T.at(s + ahead); return Math.abs(wrapA(Math.atan2(b.tz, b.tx) - Math.atan2(a.tz, a.tx))); };
  // gift bubbles (two rows of four) and boost pads, as spots on the road
  T.bubbles = [0.27, 0.7].flatMap((f) => [-2.7, -0.9, 0.9, 2.7].map((lat) => ({ s: f * L, lat })));
  T.pads = [0.13, 0.5, 0.84].map((f) => ({ s: f * L, lat: 0 }));
  return T;
}
const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const wrapS = (d, L) => { while (d > L / 2) d -= L; while (d < -L / 2) d += L; return d; };

export class Kart extends Game {
  // stick x, stick y (as on the phone held sideways: right and down), drift held (0 or 1), items used so far
  static parse(s) { const [x, y, d, u] = String(s || '').split(','); return { x: clamp(num(x) / 100, -1, 1), y: clamp(num(y) / 100, -1, 1), d: num(d) ? 1 : 0, u: num(u) }; }
  constructor(rand) {
    super('kart', rand);
    this.track = kartTrack(); this.karts = new Map(); this.cpus = []; this.pool = []; this.shots = []; this.order = [];
    this.bubbles = this.track.bubbles.map((b) => ({ ...b, ...this.track.at(b.s, b.lat), wait: 0 }));
    this.pads = this.track.pads;
    this.firstDone = null; this.finalSaid = false; this.champs = null; this.raceT = 0; this.endAt = null;
  }
  // buds from the island who can drive when there aren't enough people: [{ id, name }]
  setPool(list) { this.pool = list.slice(); }
  canStart() { return (this.phase === 'lobby' || this.phase === 'done') && this.roster.length >= 1; }
  racers() { return [...this.karts.values()]; }
  grid(i) {
    // two by two behind the line, staggered
    const row = Math.floor(i / 2), col = i % 2, s = -3 - row * 3.4 - col * 1.6, lat = col ? 1.7 : -1.7, p = this.track.at(s, lat);
    return { x: p.x, z: p.z, h: Math.atan2(p.tz, p.tx), dist: s };
  }
  newKart(id, i, cpu = null) {
    const g = this.grid(i), old = this.karts.get(id);
    const k = {
      id, cpu: !!cpu, name: cpu ? cpu.name : null, c: cpu ? cpu.c : null, skill: cpu ? cpu.skill : 1, lane: cpu ? (this.rand() - 0.5) * 3 : 0,
      x: g.x, z: g.z, h: g.h, v: 0, slide: 0, turn: 0, dist: g.dist, s: ((g.dist % this.track.L) + this.track.L) % this.track.L, lap: 0, fin: null, place: i + 1,
      drift: 0, charge: 0, boostT: 0, spinT: 0, sinkT: 0, floatT: 0, shieldT: 0, hop: 0, padT: 0, wrongT: 0, hits: 0,
      item: null, uses: 0, roll: 0, next: null, usedSeen: old ? old.usedSeen : null, prevD: 0, road: 0, surface: 'road', think: 0, want: 0, away: false,
    };
    this.karts.set(id, k);
    return k;
  }
  onRoster() {
    if (this.phase === 'lobby' || this.phase === 'done') {
      // everyone here drives about while waiting
      const ids = this.roster.map((p) => p.id);
      for (const id of [...this.karts.keys()]) if (!ids.includes(id) && (this.phase === 'lobby' || !this.karts.get(id).cpu)) this.karts.delete(id);
      ids.forEach((id, i) => { if (!this.karts.has(id)) this.newKart(id, i); });
    } else {
      // someone left mid-race: their bud drives itself home
      for (const k of this.karts.values()) if (!k.cpu) k.away = !this.here(k.id);
    }
  }
  begin() {
    const humans = this.roster.map((p) => p.id), used = new Set(this.roster.map((p) => p.c));
    const need = Math.max(0, KART.FILL - humans.length), pool = this.pool.filter((p) => !humans.includes(p.id.replace(/^cpu_/, '')));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    let names = CPU_NAMES.slice();
    this.cpus = [];
    for (let i = 0; i < need; i++) {
      const from = pool[i] || { id: `cpu_${i}`, name: names.splice(Math.floor(this.rand() * names.length), 1)[0] };
      let c = 0; while (used.has(c) && c < 11) c++; used.add(c);
      this.cpus.push({ id: from.id.startsWith('cpu_') ? from.id : `cpu_${from.id}`, name: from.name, c, skill: 0.9 + this.rand() * 0.07 });
    }
    // the island's buds start at the front; the people come from behind
    this.karts = new Map();
    const order = [...this.cpus.map((c) => c.id), ...humans.sort(() => this.rand() - 0.5)];
    order.forEach((id, i) => this.newKart(id, i, this.cpus.find((c) => c.id === id)));
    this.shots = []; this.bubbles.forEach((b) => { b.wait = 0; });
    this.firstDone = null; this.finalSaid = false; this.champs = null; this.raceT = 0; this.endAt = null; this.round = 1;
    this.go('count');
  }

  step(dt, inputs = {}) {
    this.t += dt;
    const racing = this.phase === 'play';
    if (racing) this.raceT += dt;
    if (this.phase === 'count') { for (const k of this.karts.values()) this.seeUses(k, inputs[k.id]); if (this.t >= COUNT_S) this.go('play'); return; }
    for (const b of this.bubbles) b.wait = Math.max(0, b.wait - dt);
    for (const k of this.karts.values()) {
      const human = !k.cpu && !k.away && !(k.fin != null && racing);
      const inp = human ? inputs[k.id] || { x: 0, y: 0, d: 0, u: k.usedSeen ?? 0 } : kartBot(this, k);
      this.drive(k, inp, dt);
    }
    this.collide();
    this.moveShots(dt);
    this.rank();
    if (racing) this.checkEnd();
  }
  seeUses(k, inp) { if (inp && k.usedSeen == null) k.usedSeen = inp.u; }
  drive(k, inp, dt) {
    const T = this.track, K = KART;
    // timers
    k.boostT = Math.max(0, k.boostT - dt); k.shieldT = Math.max(0, k.shieldT - dt); k.hop = Math.max(0, k.hop - dt); k.padT = Math.max(0, k.padT - dt);
    if (k.roll > 0) { k.roll -= dt; if (k.roll <= 0) { k.roll = 0; k.item = k.next; k.uses = k.next === 'coffee3' ? 3 : 1; this.emit('item', { id: k.id, item: k.item }); } }
    // using an item: the phone counts presses, so a lost message loses nothing
    if (k.usedSeen == null) k.usedSeen = inp.u;
    else if (inp.u > k.usedSeen && !(k.sinkT > 0 || k.floatT > 0)) { k.usedSeen = inp.u; if (this.phase !== 'count') this.useItem(k); }   // (pressed while in the lagoon: it goes off once you're back)
    // in the lagoon: sink, then float back to the road
    if (k.sinkT > 0) {
      k.sinkT -= dt;
      if (k.sinkT <= 0) {
        const p = T.pts[k.road], back = T.at(p.s, clamp(T.locate(k.x, k.z).lat * 0.3, -2, 2));
        Object.assign(k, { x: back.x, z: back.z, h: Math.atan2(p.tz, p.tx), v: 0, slide: 0, floatT: K.FLOAT, drift: 0, charge: 0 });
        this.emit('back', { id: k.id });
      }
      return;
    }
    if (k.floatT > 0) { k.floatT -= dt; this.track3(k); return; }
    const spun = k.spinT > 0;
    if (spun) k.spinT = Math.max(0, k.spinT - dt);
    // steering: turn toward where the stick points
    const mag = Math.hypot(inp.x, inp.y), want = Math.atan2(inp.y, inp.x), delta = mag > 0.25 ? wrapA(want - k.h) : 0;
    k.want = delta;
    const grip = clamp(0.35 + k.v / K.VMAX * 0.65, 0.35, 1);
    let rate = mag > 0.25 ? clamp(delta * 6, -K.TURN, K.TURN) * grip * Math.min(1, mag / 0.6) : 0;
    // drifting: press Drift while turning to slide; hold it round the corner to charge a boost; let go to use it
    const pressed = inp.d && !k.prevD; k.prevD = inp.d;
    if (pressed && !spun) { k.hop = 0.22; this.emit('hop', { id: k.id }); }
    if (inp.d && !k.drift && !spun && k.v > 7 && Math.abs(delta) > 0.3 && k.hop > 0) { k.drift = Math.sign(delta); k.charge = 0; }
    if (k.drift) {
      if (!inp.d || spun || k.v < 4) {
        const tier = K.CHARGE.filter((c) => k.charge >= c).length;
        if (tier && !spun) { k.boostT = Math.max(k.boostT, K.BOOST[tier - 1]); this.emit('boost', { id: k.id, tier }); }
        k.drift = 0; k.charge = 0;
      } else {
        const same = Math.sign(delta) === k.drift || Math.abs(delta) < 0.15;
        rate = k.drift * (same ? clamp(Math.abs(delta) * 6, 1.5, K.DTURN) : 0.8) * grip;
        k.charge += dt * (same ? 1 : 0.4);
        k.slide += -k.drift * k.v * 0.5 * dt;          // the back swings out
      }
    }
    if (spun) rate = 0;
    k.turn = rate;
    k.h = wrapA(k.h + rate * dt);
    // where am I: road, sand or lagoon
    const here = T.locate(k.x, k.z), off = Math.abs(here.lat);
    k.surface = off <= T.HW ? 'road' : off <= T.HW + T.SAND ? 'sand' : 'water';
    if (k.surface === 'road') k.road = here.i;
    // speed: full on the road, slow on sand, more with a boost; people at the back get a tiny bit more
    const behind = this.karts.size > 1 ? (k.place - 1) / (this.karts.size - 1) : 0;
    let top = (k.surface === 'sand' ? K.VSAND : K.VMAX * (1 + 0.05 * behind)) * k.skill;
    if (k.boostT > 0) top = K.VBOOST;
    if (k.drift) top *= 0.97;
    if (spun) top = 2;
    // in a race the pedal is always down; waiting for one, you only go when you push the stick
    if (this.phase !== 'play' && !k.cpu && !k.away && mag <= 0.25) top = 0;
    if (k.v < top) k.v = Math.min(top, k.v + K.ACC * dt * (k.boostT > 0 ? 2.5 : 1));
    else k.v += (top - k.v) * (1 - Math.exp(-(k.surface === 'sand' ? 3.5 : 2) * dt));
    k.slide *= Math.exp(-(k.drift ? 2.2 : 6) * dt);
    const fx = Math.cos(k.h), fz = Math.sin(k.h);
    k.x += (fx * k.v - fz * k.slide) * dt; k.z += (fz * k.v + fx * k.slide) * dt;
    if (k.surface === 'water') { k.sinkT = K.SINK; k.drift = 0; k.charge = 0; k.v *= 0.3; this.emit('fall', { id: k.id }); return; }
    this.track3(k);
    // boost pads
    for (const p of this.pads) if (Math.abs(wrapS(k.s - p.s, T.L)) < 1.6 && Math.abs(here.lat - p.lat) < 1.9 && k.padT <= 0) { k.boostT = Math.max(k.boostT, K.PAD); k.padT = 1.2; this.emit('boost', { id: k.id, tier: 'pad' }); }
    // gift bubbles
    for (const b of this.bubbles) if (!b.wait && (b.x - k.x) ** 2 + (b.z - k.z) ** 2 < 1.7 ** 2) {
      b.wait = K.RESPAWN; this.emit('bubble', { id: k.id, x: b.x, z: b.z });
      if (!k.item && !k.roll) { k.roll = K.ROLL; k.next = this.pick(k); }
    }
    // going the wrong way
    const p = T.pts[here.i];
    k.wrongT = fx * p.tx + fz * p.tz < -0.35 && k.v > 3 && !spun ? k.wrongT + dt : 0;
  }
  // how far round the track, and laps
  track3(k) {
    const T = this.track, here = T.locate(k.x, k.z), ds = wrapS(here.s - k.s, T.L);
    k.s = here.s;
    if (Math.abs(ds) < 12) k.dist += ds;
    if (this.phase !== 'play' || k.fin != null) return;
    const lap = Math.floor(k.dist / T.L) + 1;
    if (lap > k.lap) {
      k.lap = lap;
      if (lap > KART.LAPS) {
        k.fin = this.raceT; k.lap = KART.LAPS; const place = this.racers().filter((o) => o.fin != null).length;
        k.finPlace = place; this.emit('finish', { id: k.id, place });
        if (place === 1) this.firstDone = this.raceT;
      } else if (lap > 1) {
        this.emit('lap', { id: k.id, lap });
        if (lap === KART.LAPS && !this.finalSaid) { this.finalSaid = true; this.emit('final', { id: k.id }); }
      }
    }
  }
  pick(k) {
    const n = this.karts.size, f = n > 1 ? (k.place - 1) / (n - 1) : 0;
    const odds = k.place === 1 ? ODDS.front : f > 0.66 ? ODDS.back : f > 0.33 ? ODDS.middle : ODDS.front;
    const total = Object.values(odds).reduce((a, b) => a + b, 0);
    let r = this.rand() * total;
    for (const [item, w] of Object.entries(odds)) { r -= w; if (r <= 0) return item; }
    return 'coffee';
  }
  useItem(k) {
    if (!k.item || k.roll || k.sinkT > 0 || k.floatT > 0) return false;
    const T = this.track, item = k.item, K = KART;
    if (item === 'coffee' || item === 'coffee3') { k.boostT = Math.max(k.boostT, K.COFFEE); this.emit('boost', { id: k.id, tier: 'coffee' }); }
    else if (item === 'coconut') { const here = T.locate(k.x, k.z); this.shots.push({ kind: 'coconut', by: k.id, s: here.s + 2, lat: clamp(here.lat, -T.HW + 0.6, T.HW - 0.6), t: 0, x: k.x, z: k.z }); }
    else if (item === 'jelly') this.shots.push({ kind: 'jelly', by: k.id, x: k.x - Math.cos(k.h) * 2.1, z: k.z - Math.sin(k.h) * 2.1, t: 0 });
    else if (item === 'bubble') k.shieldT = K.SHIELD;
    else if (item === 'gull') {
      const ahead = this.order.filter((id) => id !== k.id && this.karts.get(id)?.fin == null);
      const target = ahead[0] === k.id ? ahead[1] : ahead[0];
      if (target) this.shots.push({ kind: 'gull', by: k.id, target, t: 0, x: k.x, z: k.z, fx: k.x, fz: k.z });
    }
    this.emit('use', { id: k.id, item });
    k.uses -= 1; if (k.uses <= 0) { k.item = null; k.uses = 0; }
    return true;
  }
  hit(k, why) {
    if (k.sinkT > 0 || k.floatT > 0) return false;
    if (k.shieldT > 0) { k.shieldT = 0; this.emit('pop', { id: k.id, why }); return false; }
    k.spinT = KART.SPIN; k.v *= 0.3; k.drift = 0; k.charge = 0; k.slide = 0; k.hits++;
    if (why === 'gull') { k.item = null; k.uses = 0; k.roll = 0; }
    this.emit('spin', { id: k.id, why });
    return true;
  }
  moveShots(dt) {
    const T = this.track, K = KART;
    for (const sh of this.shots) {
      sh.t += dt;
      if (sh.kind === 'coconut') {
        sh.s += K.NUT_V * dt; const p = T.at(sh.s, sh.lat); sh.x = p.x; sh.z = p.z;
        if (sh.t > K.NUT_LIFE) sh.gone = true;
      } else if (sh.kind === 'jelly') { if (sh.t > K.JELLY_LIFE) sh.gone = true; }
      else if (sh.kind === 'gull') {
        const tk = this.karts.get(sh.target);
        if (!tk) { sh.gone = true; continue; }
        const f = Math.min(1, sh.t / K.GULL); sh.x = sh.fx + (tk.x - sh.fx) * f; sh.z = sh.fz + (tk.z - sh.fz) * f; sh.f = f;
        if (f >= 1) { this.hit(tk, 'gull'); sh.gone = true; }
        continue;
      }
      if (sh.gone) continue;
      for (const k of this.karts.values()) {
        if (k.id === sh.by && sh.t < 0.7) continue;
        if ((k.x - sh.x) ** 2 + (k.z - sh.z) ** 2 < (sh.kind === 'coconut' ? 1.4 : 1.25) ** 2 && !(k.sinkT > 0 || k.floatT > 0)) { this.hit(k, sh.kind); sh.gone = true; break; }
      }
    }
    // a coconut that rolls into a jelly: both gone, with a splat
    for (const a of this.shots) if (a.kind === 'coconut' && !a.gone) for (const b of this.shots) if (b.kind === 'jelly' && !b.gone && (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < 1.4) { a.gone = b.gone = true; this.emit('splat', { x: b.x, z: b.z }); }
    this.shots = this.shots.filter((s) => !s.gone);
  }
  collide() {
    const ks = this.racers().filter((k) => !(k.sinkT > 0) && !(k.floatT > 0)), R = KART.R;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i], b = ks[j]; let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d >= R * 2) continue;
      if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
      const nx = dx / d, nz = dz / d, ma = a.boostT > 0 ? 2.5 : 1, mb = b.boostT > 0 ? 2.5 : 1, push = R * 2 - d;
      a.x -= nx * push * mb / (ma + mb); a.z -= nz * push * mb / (ma + mb); b.x += nx * push * ma / (ma + mb); b.z += nz * push * ma / (ma + mb);
      // a shove sideways, the heavier (boosting) kart shoving harder
      const va = Math.cos(a.h) * a.v * nx + Math.sin(a.h) * a.v * nz, vb = Math.cos(b.h) * b.v * nx + Math.sin(b.h) * b.v * nz, closing = va - vb;
      if (closing <= 0) continue;
      b.slide += closing * 0.5 * ma / (ma + mb) * Math.sign(-Math.sin(b.h) * nx + Math.cos(b.h) * nz || 1);
      a.slide -= closing * 0.5 * mb / (ma + mb) * Math.sign(-Math.sin(a.h) * nx + Math.cos(a.h) * nz || 1);
      a.v *= 0.92; b.v *= 0.96;
      if (closing > 2.5) this.emit('bump', { a: a.id, b: b.id, power: clamp(closing / 10, 0.15, 1), x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    }
  }
  rank() {
    const was = this.order.join();
    this.order = this.racers().sort((a, b) => (a.fin != null || b.fin != null ? (a.fin ?? Infinity) - (b.fin ?? Infinity) : b.dist - a.dist)).map((k) => k.id);
    this.order.forEach((id, i) => { this.karts.get(id).place = i + 1; });
    if (this.order.join() !== was && this.phase === 'play') this.emit('order', {});
  }
  checkEnd() {
    const all = this.racers(), people = all.filter((k) => !k.cpu && !k.away);
    if (this.firstDone != null && this.endAt == null) {
      // after the first one home, everyone else has a little while; once every person is home it wraps up
      if (all.every((k) => k.fin != null) || people.every((k) => k.fin != null)) this.endAt = this.raceT + KART.END_S;
      else if (this.raceT - this.firstDone > KART.WAIT) this.endAt = this.raceT;
    }
    if (this.raceT > KART.CAP && this.endAt == null) this.endAt = this.raceT;
    if (this.endAt != null && this.raceT >= this.endAt) {
      this.rank();
      this.champs = [this.order[0]];
      this.emit('matchEnd', { champs: this.champs, order: this.order.slice() });
      this.go('done');
    }
  }
  state() {
    const who = {}, place = {}, lap = {}, item = {}, fin = {}, wrong = {}, hits = {};
    const all = this.racers();
    for (const p of this.roster) who[p.id] = { c: p.c, n: p.name, in: this.karts.has(p.id) };
    for (const c of this.cpus) if (this.karts.has(c.id)) who[c.id] = { c: c.c, n: c.name, in: true, cpu: 1 };
    for (const k of all) {
      place[k.id] = k.place; lap[k.id] = clamp(k.lap, 1, KART.LAPS);
      if (k.roll) item[k.id] = 'roll'; else if (k.item) item[k.id] = k.item + (k.uses > 1 ? `:${k.uses}` : '');
      if (k.fin != null) fin[k.id] = k.finPlace;
      if (k.wrongT > 1.2) wrong[k.id] = 1;
      if (k.hits) hits[k.id] = k.hits;
    }
    return { g: 'kart', phase: this.phase, laps: KART.LAPS, who, place, lap, item, fin, wrong, hits, order: this.phase === 'done' ? this.order : null, champs: this.champs };
  }
}

// A CPU driver (and the bots in the tests): aim a little way down the road in its own lane, drift on the bends,
// and use items when it makes sense.
export function kartBot(game, k) {
  const T = game.track, here = T.locate(k.x, k.z), ahead = 7 + k.v * 0.45;
  if (game.rand() < 0.004) k.lane = clamp(k.lane + (game.rand() - 0.5) * 3, -2.4, 2.4);
  const lane = Math.abs(here.lat) > T.HW ? 0 : k.lane, aim = T.at(here.s + ahead, lane);
  const bend = T.bend(here.s + 2, 14), x = aim.x - k.x, z = aim.z - k.z, m = Math.hypot(x, z) || 1;
  k.think = (k.think || 0) + 1 / 60;
  const d = bend > 0.75 && k.v > 9 && k.surface === 'road' ? 1 : k.drift && bend > 0.3 ? 1 : 0;
  let u = k.usedSeen ?? 0;
  if (k.item && !k.roll && k.think > 0.8) {
    const me = game.order.indexOf(k.id), front = game.order[me - 1] && game.karts.get(game.order[me - 1]), back = game.order[me + 1] && game.karts.get(game.order[me + 1]);
    const gapF = front ? front.dist - k.dist : 99, gapB = back ? k.dist - back.dist : 99;
    const go = k.item.startsWith('coffee') ? bend < 0.35 : k.item === 'coconut' ? (gapF > 2 && gapF < 22) || k.think > 7 : k.item === 'jelly' ? gapB < 9 || k.think > 9 : true;
    if (go) { u += 1; k.think = 0; }
  }
  return { x: x / m, y: z / m, d, u };
}

/* ============================== Acorn Heist ============================== */
// One player is the tree; everyone else sneaks in to steal its acorns. Acorns lie under the tree's crown. A
// collector grabs one by running over it and carries it to any of three baskets round the edge. The tree can't
// move, but it aims a shadow round the meadow and drops pinecones (a bonk stuns whoever's under it and knocks
// their acorn loose), and now and then it shakes its whole crown, flinging everyone underneath outwards and
// shaking the acorns out of their arms. Dropped acorns roll back home to the tree after a few seconds.
// Collectors win the round by banking enough acorns before time's up; otherwise the tree wins.
// Everyone takes a turn as the tree. Points: a collector gets one per acorn banked and two more each if they win
// the round; the tree gets one per bonk and three if it holds on. Buds from the island fill in as collectors
// when there are fewer than three, and play the tree when someone's playing alone.
export const HEIST = {
  R: 13.5, CANOPY: 4.6, TRUNK: 1.25, BUD: 0.6, SPEED: 5.2, CARRY: 0.64, GRAB: 0.45, ACC: 30, DRAG: 7.5, DASH: 11, DASH_T: 0.22, DASH_COOL: 2.4,
  STUN: 2.4, AIM: 13, REACH: 12, FALL: 0.62, BONK_R: 1.45, DROP_COOL: 0.6, MAX_AIR: 3, SHAKE_COOL: 7, SHAKE_R: 6, SHAKE_PUSH: 15,
  PLAY_S: 60, PLAY_S_BIG: 45, PICKERS: 3, BASKET_R: 1.3, BASKET_AT: 11.6, ROLL_AFTER: 3.2, ROLL_SPEED: 3.2, RATE: 0.15, CROWDED: 0.008, CROWD_K: 0.3, AIR_STEP: 3, SPARE: 1.4, END_S: 4.2,
};
export const heistBaskets = () => [0, 1, 2].map((i) => { const a = Math.PI / 2 + i * Math.PI * 2 / 3; return { x: Math.cos(a) * HEIST.BASKET_AT, y: Math.sin(a) * HEIST.BASKET_AT, n: 0 }; });
const HEIST_NAMES = ['Pebble', 'Kelp', 'Mochi', 'Taro', 'Biscuit', 'Sprout', 'Noodle', 'Puddle'];

export class Heist extends Game {
  // stick x, stick y, then two running counts: a (dash for a collector, drop for the tree) and b (the tree's shake)
  static parse(s) { const [x, y, a, b] = String(s || '').split(','); return { x: clamp(num(x) / 100, -1, 1), y: clamp(num(y) / 100, -1, 1), a: num(a), b: num(b) }; }
  constructor(rand) {
    super('heist', rand);
    this.pool = []; this.cpus = []; this.pickers = new Map(); this.acorns = []; this.cones = []; this.baskets = heistBaskets();
    this.tree = null; this.trees = []; this.aim = { x: 0, y: 6, seenA: null, seenB: null, cool: 0, shakeCool: 0, shakeT: 0, think: 0 };
    this.score = {}; this.banked = 0; this.goal = 0; this.last = null; this.champs = null; this.playS = HEIST.PLAY_S; this.streak = 0;
    this.scatter(14);
  }
  setPool(list) { this.pool = list.slice(); }
  canStart() { return (this.phase === 'lobby' || this.phase === 'done') && this.roster.length >= 1; }
  // acorns under the crown, in a loose ring round the trunk
  scatter(n) {
    this.acorns = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand() * 0.5, r = HEIST.TRUNK + 0.7 + this.rand() * (HEIST.CANOPY - HEIST.TRUNK - 1);
      this.acorns.push({ i, x: Math.cos(a) * r, y: Math.sin(a) * r, by: null, home: true, loose: 0, banked: -1, roll: false });
    }
    this.baskets.forEach((b) => { b.n = 0; });
  }
  newPicker(id, cpu = null) {
    const old = this.pickers.get(id), k = this.pickers.size, b = this.baskets[k % 3], a = this.rand() * Math.PI * 2;
    const p = { id, cpu: !!cpu, name: cpu?.name || null, c: cpu?.c ?? null, x: b.x * 0.92 + Math.cos(a) * 1.4, y: b.y * 0.92 + Math.sin(a) * 1.4, vx: 0, vy: 0, fx: 0, fy: -1,
      carry: null, grab: null, grabT: 0, stun: 0, cool: 0, dashT: 0, seen: old ? old.seen : null, got: 0, bonked: 0, hit: 0, want: null, think: this.rand() };
    this.pickers.set(id, p); return p;
  }
  onRoster() {
    if (this.phase === 'lobby' || this.phase === 'done') {
      // waiting about: everyone runs round collecting for fun, nobody is the tree
      const ids = this.roster.map((p) => p.id);
      for (const id of [...this.pickers.keys()]) if (!ids.includes(id)) this.pickers.delete(id);
      for (const id of ids) if (!this.pickers.has(id)) this.newPicker(id);
    } else for (const p of this.pickers.values()) if (!p.cpu) p.away = !this.here(p.id);
  }
  begin() {
    const humans = this.roster.map((p) => p.id);
    for (let i = humans.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [humans[i], humans[j]] = [humans[j], humans[i]]; }
    // island buds who can help out: as collectors when there are too few, and as the tree for someone alone
    const used = new Set(this.roster.map((p) => p.c)), pool = this.pool.filter((p) => !humans.includes(p.id));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const names = HEIST_NAMES.slice(), need = Math.max(0, HEIST.PICKERS + 1 - humans.length);
    this.cpus = [];
    for (let i = 0; i < need; i++) {
      const from = pool[i] || { id: `cpu_${i}`, name: names.splice(Math.floor(this.rand() * names.length), 1)[0] };
      let c = 0; while (used.has(c) && c < 11) c++; used.add(c);
      this.cpus.push({ id: from.id.startsWith('cpu_') ? from.id : `cpu_${from.id}`, name: from.name, c });
    }
    this.trees = humans.length === 1 ? [humans[0], this.cpus[0].id] : humans.slice();
    this.playS = humans.length > 6 ? HEIST.PLAY_S_BIG : HEIST.PLAY_S;
    this.score = {}; for (const id of [...humans, ...this.cpus.map((c) => c.id)]) this.score[id] = 0;
    this.round = 0; this.champs = null; this.nextRound();
  }
  everyone() { return [...this.roster.map((p) => p.id), ...this.cpus.map((c) => c.id)]; }
  nextRound() {
    this.round++; this.last = null; this.banked = 0; this.streak = 0; this.cones = [];
    this.tree = this.trees[this.round - 1];
    // the collectors: everyone but the tree, topped up with island buds to at least three (more for a big crowd is fine)
    const people = this.roster.map((p) => p.id).filter((id) => id !== this.tree);
    const help = this.cpus.filter((c) => c.id !== this.tree).slice(0, Math.max(0, HEIST.PICKERS - people.length));
    this.pickers = new Map();
    for (const id of people) this.newPicker(id);
    for (const c of help) this.newPicker(c.id, c);
    // how many acorns the collectors must bank grows with how many of them there are; a few spare under the tree
    // (set from bots playing both sides with no goal: about 0.15 acorns a collector a second, a little less in a
    // crowd; at that goal the tree and the collectors each won about half the time)
    const n = this.pickers.size, goal = Math.round(HEIST.RATE * n * this.playS * (1 - HEIST.CROWDED * (n - 3)));
    this.goal = goal; this.scatter(Math.min(80, Math.ceil(goal * HEIST.SPARE)));
    // a bigger crowd: the tree drops faster and keeps more pinecones in the air
    this.dropCool = HEIST.DROP_COOL * Math.pow(3 / Math.max(3, n), HEIST.CROWD_K); this.maxAir = HEIST.MAX_AIR + Math.floor((n - 3) / HEIST.AIR_STEP);
    Object.assign(this.aim, { x: 0, y: 6.5, cool: 0, shakeCool: 2.5, shakeT: 0, cpu: this.cpus.some((c) => c.id === this.tree) });
    this.go('count');
  }
  left() { return Math.max(0, this.playS - this.t); }

  step(dt, inputs = {}) {
    this.t += dt;
    const H = HEIST, playing = this.phase === 'play';
    if (this.phase === 'count') { for (const p of this.pickers.values()) this.seen(p, inputs[p.id]); this.seenTree(inputs[this.tree]); if (this.t >= COUNT_S) this.go('play'); return; }
    // the tree aims and drops (only in a round)
    if (playing && this.tree) {
      const inp = this.aim.cpu || !this.here(this.tree) ? heistTreeBot(this, dt) : inputs[this.tree] || { x: 0, y: 0, a: this.aim.seenA ?? 0, b: this.aim.seenB ?? 0 };
      this.treeAct(inp, dt);
    }
    this.aim.shakeT = Math.max(0, this.aim.shakeT - dt);
    // the collectors
    for (const p of this.pickers.values()) {
      const inp = p.cpu || p.away ? heistBot(this, p, dt) : inputs[p.id] || { x: 0, y: 0, a: p.seen ?? 0, b: 0 };
      this.run(p, inp, dt);
    }
    this.bump();
    this.cones = this.cones.filter((c) => { c.t += dt; if (c.t < H.FALL) return true; this.land(c); return false; });
    this.acornsTick(dt);
    if (playing && this.left() <= 0) this.endRound('tree');
    if (this.phase === 'round' && this.t >= H.END_S) { if (this.round >= this.trees.length) this.finish(); else this.nextRound(); }
  }
  seen(p, inp) { if (inp && p.seen == null) p.seen = inp.a; }
  seenTree(inp) { if (inp && this.aim.seenA == null) { this.aim.seenA = inp.a; this.aim.seenB = inp.b; } }
  treeAct(inp, dt) {
    const H = HEIST, A = this.aim;
    let sx = inp.x, sy = inp.y; const m = Math.hypot(sx, sy); if (m > 1) { sx /= m; sy /= m; }
    A.x += sx * H.AIM * dt; A.y += sy * H.AIM * dt;
    const r = Math.hypot(A.x, A.y); if (r > H.REACH) { A.x *= H.REACH / r; A.y *= H.REACH / r; }
    A.cool = Math.max(0, A.cool - dt); A.shakeCool = Math.max(0, A.shakeCool - dt);
    if (A.seenA == null) { A.seenA = inp.a; A.seenB = inp.b; return; }
    if (inp.a !== A.seenA) {
      A.seenA = inp.a;
      if (A.cool <= 0 && this.cones.length < (this.maxAir || H.MAX_AIR)) { this.cones.push({ x: A.x, y: A.y, t: 0 }); A.cool = this.dropCool || H.DROP_COOL; this.emit('drop', { x: A.x, y: A.y }); }
    }
    if (inp.b !== A.seenB) {
      A.seenB = inp.b;
      if (A.shakeCool <= 0) {
        A.shakeCool = H.SHAKE_COOL; A.shakeT = 1;
        const flung = [];
        for (const p of this.pickers.values()) {
          const d = Math.hypot(p.x, p.y);
          if (d > H.SHAKE_R) continue;
          const nx = d > 0.01 ? p.x / d : 1, ny = d > 0.01 ? p.y / d : 0, k = 1 - d / H.SHAKE_R * 0.4;
          p.vx += nx * H.SHAKE_PUSH * k; p.vy += ny * H.SHAKE_PUSH * k; p.dashT = 0.25; p.hit = 1; this.letGo(p);
          if (p.carry != null) this.loose(p, 'shake');
          flung.push(p.id);
        }
        this.emit('shake', { flung });
      }
    }
  }
  run(p, inp, dt) {
    const H = HEIST;
    p.hit = Math.max(0, p.hit - dt * 3); p.cool = Math.max(0, p.cool - dt); p.dashT = Math.max(0, p.dashT - dt);
    if (p.stun > 0) { p.stun = Math.max(0, p.stun - dt); inp = { x: 0, y: 0, a: inp.a, b: 0 }; }
    let sx = inp.x, sy = inp.y; const m = Math.hypot(sx, sy); if (m > 1) { sx /= m; sy /= m; }
    if (m > 0.2) { p.fx = sx / Math.min(1, m); p.fy = sy / Math.min(1, m); }
    if (p.seen == null) p.seen = inp.a;
    else if (inp.a !== p.seen) {
      p.seen = inp.a;
      if (p.cool <= 0 && p.stun <= 0) { const k = p.carry != null ? 0.8 : 1; p.vx += p.fx * H.DASH * k; p.vy += p.fy * H.DASH * k; p.cool = H.DASH_COOL; p.dashT = H.DASH_T; this.emit('dash', { id: p.id }); }
    }
    const top = H.SPEED * (p.carry != null ? H.CARRY : 1) * (p.grab != null ? 0.2 : 1);
    p.vx += (sx * top - p.vx) * Math.min(1, H.ACC / top * dt) * (p.stun > 0 ? 0 : 1);
    p.vy += (sy * top - p.vy) * Math.min(1, H.ACC / top * dt) * (p.stun > 0 ? 0 : 1);
    if (p.dashT <= 0 || p.stun > 0) { const sp = Math.hypot(p.vx, p.vy); if (sp > top) { const k = Math.exp(-H.DRAG * dt); p.vx = p.vx * k + p.vx / sp * top * (1 - k); p.vy = p.vy * k + p.vy / sp * top * (1 - k); } }
    if (p.stun > 0) { const k = Math.exp(-6 * dt); p.vx *= k; p.vy *= k; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    // the trunk is solid, and the meadow has an edge (a fence of flowers you can't cross)
    const d = Math.hypot(p.x, p.y);
    if (d < H.TRUNK + H.BUD) { const k = (H.TRUNK + H.BUD) / Math.max(d, 0.01); p.x *= k; p.y *= k; }
    if (d > H.R - H.BUD) { const k = (H.R - H.BUD) / d; p.x *= k; p.y *= k; const vr = (p.vx * p.x + p.vy * p.y) / (H.R - H.BUD); if (vr > 0) { p.vx -= vr * p.x / (H.R - H.BUD); p.vy -= vr * p.y / (H.R - H.BUD); } }
    if (p.stun > 0) return;
    // grab an acorn by running over it: a little tug (slowed right down) and it's yours
    if (p.grab != null) {
      const a = this.acorns[p.grab];
      if (a.by !== p.id + ':tug' || Math.hypot(a.x - p.x, a.y - p.y) > H.BUD + 0.7) { if (a.by === p.id + ':tug') a.by = null; p.grab = null; }
      else if ((p.grabT += dt) >= H.GRAB) { a.by = p.id; p.carry = a.i; p.grab = null; this.emit('pick', { id: p.id, x: a.x, y: a.y }); }
    } else if (p.carry == null) {
      for (const a of this.acorns) if (a.by == null && a.banked < 0 && Math.hypot(a.x - p.x, a.y - p.y) < H.BUD + 0.35) { a.by = p.id + ':tug'; a.roll = false; p.grab = a.i; p.grabT = 0; this.emit('tug', { id: p.id }); break; }
    } else {
      // and bank it in any basket
      for (let i = 0; i < 3; i++) {
        const b = this.baskets[i];
        if (Math.hypot(b.x - p.x, b.y - p.y) > H.BASKET_R + H.BUD) continue;
        const a = this.acorns[p.carry]; a.by = null; a.banked = i; a.home = false; b.n++; p.carry = null;
        if (this.phase === 'play') {
          this.banked++; p.got++; this.score[p.id] = (this.score[p.id] || 0) + 1; this.streak++;
          this.emit('bank', { id: p.id, basket: i, banked: this.banked, goal: this.goal, streak: this.streak });
          if (this.banked >= this.goal) this.endRound('pickers');
        } else { this.emit('bank', { id: p.id, basket: i, banked: 0, goal: 0 }); if (this.acorns.every((x) => x.banked >= 0)) this.scatter(this.acorns.length); }
        break;
      }
    }
  }
  // the collectors jostle (no bouncing off: just keep apart)
  bump() {
    const ps = [...this.pickers.values()], R = HEIST.BUD * 2;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j]; let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= R) continue; if (d < 1e-4) { dx = 1; dy = 0; d = 1; }
      const push = (R - d) / 2, nx = dx / d, ny = dy / d; a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
    }
  }
  land(c) {
    const H = HEIST, hit = [];
    for (const p of this.pickers.values()) {
      if (p.stun > 0 || Math.hypot(p.x - c.x, p.y - c.y) > H.BONK_R + H.BUD * 0.5) continue;
      p.stun = H.STUN; p.hit = 1; p.bonked++; hit.push(p.id); this.letGo(p);
      if (p.carry != null) this.loose(p, 'bonk');
    }
    if (hit.length && this.phase === 'play') { this.score[this.tree] = (this.score[this.tree] || 0) + hit.length; this.streak = 0; }
    this.emit(hit.length ? 'bonk' : 'miss', { x: c.x, y: c.y, hit });
  }
  letGo(p) { if (p.grab != null) { const a = this.acorns[p.grab]; if (a.by === p.id + ':tug') a.by = null; p.grab = null; } }
  // an acorn knocked out of someone's arms lands nearby, and after a while rolls back home to the tree
  loose(p, why) {
    const a = this.acorns[p.carry], ang = this.rand() * Math.PI * 2;
    a.by = null; a.x = p.x + Math.cos(ang) * 0.9; a.y = p.y + Math.sin(ang) * 0.9; a.home = false; a.loose = 0; a.roll = false;
    if (why === 'shake') { const d = Math.hypot(p.x, p.y) || 1, r = HEIST.TRUNK + 0.8 + this.rand() * 2; a.x = p.x / d * r; a.y = p.y / d * r; a.home = true; }
    p.carry = null; this.emit('lose', { id: p.id, why, x: a.x, y: a.y });
  }
  acornsTick(dt) {
    const H = HEIST;
    for (const a of this.acorns) {
      if (a.by != null || a.banked >= 0 || a.home) continue;
      a.loose += dt;
      if (a.loose < H.ROLL_AFTER) continue;
      if (!a.roll) { a.roll = true; const ang = Math.atan2(a.y, a.x) + (this.rand() - 0.5) * 0.6, r = H.TRUNK + 0.8 + this.rand() * (H.CANOPY - H.TRUNK - 1.2); a.tx = Math.cos(ang) * r; a.ty = Math.sin(ang) * r; this.emit('roll', { x: a.x, y: a.y }); }
      const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy), s = Math.min(d, H.ROLL_SPEED * dt);
      if (d < 0.05) { a.home = true; a.roll = false; } else { a.x += dx / d * s; a.y += dy / d * s; }
    }
  }
  endRound(winner) {
    if (this.phase !== 'play') return;
    this.last = winner;
    if (winner === 'tree') this.score[this.tree] = (this.score[this.tree] || 0) + 3;
    else for (const p of this.pickers.values()) this.score[p.id] = (this.score[p.id] || 0) + 2;
    this.emit('roundEnd', { winner, tree: this.tree, banked: this.banked, goal: this.goal });
    this.cones = [];
    this.go('round');
  }
  finish() {
    const people = this.roster.map((p) => p.id), cpu = new Set(this.cpus.map((c) => c.id));
    const ids = Object.keys(this.score).filter((id) => people.includes(id) || cpu.has(id)), top = Math.max(0, ...ids.map((id) => this.score[id]));
    this.champs = ids.filter((id) => this.score[id] === top);
    this.tree = null; this.emit('matchEnd', { champs: this.champs });
    this.go('done');
    this.pickers = new Map(); this.onRoster(); this.scatter(14);
  }
  state() {
    const who = {}, carry = {}, stun = {}, got = {};
    for (const p of this.roster) who[p.id] = { c: p.c, n: p.name, in: this.phase === 'lobby' || this.phase === 'done' || this.pickers.has(p.id) || this.tree === p.id };
    for (const c of this.cpus) if (this.pickers.has(c.id) || this.tree === c.id) who[c.id] = { c: c.c, n: c.name, in: true, cpu: 1 };
    for (const p of this.pickers.values()) { if (p.carry != null) carry[p.id] = 1; if (p.stun > 0) stun[p.id] = 1; if (p.got) got[p.id] = p.got; }
    return {
      g: 'heist', phase: this.phase, round: this.round, rounds: this.trees.length, tree: this.tree, who, carry, stun, got, score: this.score,
      banked: this.banked, goal: this.goal, left: this.phase === 'play' ? Math.ceil(this.left()) : null, shake: this.aim.shakeCool > 0 ? 1 : 0, last: this.last, champs: this.champs,
    };
  }
}

// An island bud collecting acorns (and the bots in the tests): go for the nearest acorn nobody else is after,
// carry it to the nearest basket, step out from under a falling pinecone's shadow, and dash when it helps.
export function heistBot(game, p, dt = 1 / 60) {
  const H = HEIST;
  p.think = (p.think || 0) + dt;
  let tx, ty;
  if (p.carry != null) { let best = null, bd = 1e9; for (const b of game.baskets) { const d = Math.hypot(b.x - p.x, b.y - p.y); if (d < bd) { bd = d; best = b; } } tx = best.x; ty = best.y; }
  else {
    if (p.grab == null && (p.want == null || game.acorns[p.want].by != null || game.acorns[p.want].banked >= 0 || p.think > 2.5)) {
      p.think = 0; let bd = 1e9; p.want = null;
      const taken = new Set([...game.pickers.values()].filter((o) => o !== p && o.want != null).map((o) => o.want));
      for (const a of game.acorns) { if (a.by != null || a.banked >= 0) continue; const d = Math.hypot(a.x - p.x, a.y - p.y) + (taken.has(a.i) ? 4 : 0) + game.rand() * 1.5; if (d < bd) { bd = d; p.want = a.i; } }
    }
    const a = p.want != null ? game.acorns[p.want] : { x: 0, y: 0 }; tx = a.x; ty = a.y;
  }
  let x = tx - p.x, y = ty - p.y; const m = Math.hypot(x, y) || 1; x /= m; y /= m;
  // a shadow on the way: step aside
  let dash = false;
  for (const c of game.cones) {
    const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy);
    if (d < H.BONK_R + 1.1 && c.t > 0.28 / (p.skill ?? 1)) { const k = 2.2 / Math.max(d, 0.2); x += dx / (d || 1) * k; y += dy / (d || 1) * k; if (d < H.BONK_R && game.rand() < 0.4 * (p.skill ?? 1)) dash = true; }
  }
  // round the trunk rather than into it
  const dT = Math.hypot(p.x, p.y);
  if (dT < H.TRUNK + 1.3) { x += -p.y / dT * 0.8; y += p.x / dT * 0.8; }
  const mm = Math.hypot(x, y) || 1;
  if (dash) p.fx = x / mm, p.fy = y / mm;
  return { x: x / mm, y: y / mm, a: (p.seen ?? 0) + (dash && p.cool <= 0 ? 1 : 0), b: 0 };
}
// An island bud playing the tree: follow whoever's carrying an acorn (or about to grab one), lead them a little,
// and drop when the shadow's on them; shake when a crowd gathers underneath.
export function heistTreeBot(game, dt = 1 / 60) {
  const H = HEIST, A = game.aim;
  A.think = (A.think || 0) + dt;
  const ps = [...game.pickers.values()].filter((p) => p.stun <= 0);
  let best = null, bs = -1e9;
  for (const p of ps) { const s = (p.carry != null ? 5 : 0) - Math.hypot(p.x - A.x, p.y - A.y) * 0.5 - Math.hypot(p.x, p.y) * 0.25; if (s > bs) { bs = s; best = p; } }
  let x = 0, y = 0, a = A.seenA ?? 0, b = A.seenB ?? 0;
  if (best) {
    const lead = H.FALL * (A.lead ?? 0.85), px = best.x + best.vx * lead, py = best.y + best.vy * lead, dx = px - A.x, dy = py - A.y, d = Math.hypot(dx, dy);
    if (d > 0.15) { x = dx / d * Math.min(1, d / 1.2); y = dy / d * Math.min(1, d / 1.2); }
    if (d < 1 && A.cool <= 0 && A.think > (A.wait ?? 0.2)) { a += 1; A.think = 0; }
  }
  const under = ps.filter((p) => Math.hypot(p.x, p.y) < H.SHAKE_R - 0.8).length;
  if (under >= 2 && A.shakeCool <= 0) b += 1;
  return { x, y, a, b };
}

export const makeGame = (kind, rand) => (kind === 'tug' ? new Tug(rand) : kind === 'freeze' ? new Freeze(rand) : kind === 'kart' ? new Kart(rand) : kind === 'heist' ? new Heist(rand) : new Bumper(rand));
export const parseInput = (kind, s) => (kind === 'tug' ? Tug : kind === 'freeze' ? Freeze : kind === 'kart' ? Kart : kind === 'heist' ? Heist : Bumper).parse(s);
