// Bud-a-pult physics, run on the server so both players see the same shot and nobody can fake one.
// A side view in meters: the catapult at x = 0, a friend's fortress on the ground to the right. A fortress is
// built on a grid (8 wide, 10 tall, half-meter squares) from wood blocks, stone blocks, beams and pillars,
// with the defending bud tucked in somewhere. A shot flings the attacking bud; we record every body's position
// 30 times a second so the page can replay it (and slow down the big moment).
// Knockout: the flying bud touches the tower's bud, something knocks it hard enough to send it moving
// (falling blocks count), or it falls from its spot.
import * as planck from 'planck';

// The builder's plot is 14 squares wide (7 m), starting 14 m from the catapult: room for walls out front.
export const CELL = 0.5, COLS = 14, ROWS = 10, FORT_X = 14;
export const MAX_PIECES = 28, MAX_STONE = 8, REPAIR_PIECES = 2;
export const PIECES = {
  wood: { w: 1, h: 1, density: 0.6, friction: 0.7 },
  stone: { w: 1, h: 1, density: 2.6, friction: 0.8 },
  beam: { w: 3, h: 1, density: 0.6, friction: 0.7 },
  pillar: { w: 1, h: 2, density: 0.6, friction: 0.7 },
};
export const BUD_R = 0.22, SHOT_R = 0.34;
const LAUNCH = { x: 0.6, y: 1.5 }, MIN_SPEED = 9, MAX_SPEED = 19;
const GROUND_END = FORT_X + COLS * CELL + 5;   // past this the island ends (things fall into the sea)
const HZ = 60, REC = 2;                        // physics steps per second; record every 2nd step (30 fps)
const KNOCK_SPEED = 2.2;
// Dizziness: every knock, shove and spin that isn't a knockout makes the tower's bud dizzier, and it carries
// over between launches. At 100 the bud is too dizzy to go on, which counts as a knockout. (Scaled from
// simulated shots: a light bump adds about 15, a hard near miss up to 40, so it takes three solid shakes.)
export const DIZZY_MAX = 100;
const DIZZY_PER_SHOT = 40;
const dizzyFrom = (j) => Math.min(DIZZY_PER_SHOT, Math.round(0.75 * (3 * j.hits + 20 * j.speed + 10 * Math.min(j.spin, 3) + 35 * j.moved)));                        // the tower's bud sent moving this fast (m/s) counts as knocked out
const err = (message, status = 400) => Object.assign(new Error(message), { status });
const r3 = (v) => Math.round(v * 1000) / 1000, r2 = (v) => Math.round(v * 100) / 100;

// where a grid piece's middle is, in meters
const cellCenter = (t, gx, gy) => ({ x: FORT_X + (gx + PIECES[t].w / 2) * CELL, y: (gy + PIECES[t].h / 2) * CELL });

// Check a fresh build: pieces [{ t, x, y }] on the grid (x, y = bottom-left square), bud { x, y } a square.
export function checkBuild(pieces, bud) {
  if (!Array.isArray(pieces) || pieces.length > MAX_PIECES) throw err(`up to ${MAX_PIECES} pieces`);
  if (pieces.filter((p) => p?.t === 'stone').length > MAX_STONE) throw err(`up to ${MAX_STONE} stone blocks`);
  const used = new Set(), out = [];
  const take = (gx, gy) => { const k = gx + ',' + gy; if (used.has(k)) throw err('two things in the same spot'); used.add(k); };
  for (const p of pieces) {
    const P = PIECES[p?.t], gx = Number(p?.x), gy = Number(p?.y);
    if (!P || !Number.isInteger(gx) || !Number.isInteger(gy) || gx < 0 || gy < 0 || gx + P.w > COLS || gy + P.h > ROWS) throw err('a piece is off the grid');
    for (let i = 0; i < P.w; i++) for (let j = 0; j < P.h; j++) take(gx + i, gy + j);
    out.push({ t: p.t, gx, gy });
  }
  const bx = Number(bud?.x), by = Number(bud?.y);
  if (!Number.isInteger(bx) || !Number.isInteger(by) || bx < 0 || by < 0 || bx >= COLS || by >= ROWS) throw err('where is your bud?');
  take(bx, by);
  return { pieces: out, bud: { gx: bx, gy: by } };
}
// grid build -> bodies in meters: [{ t, x, y, a }], bud { x, y, a }
export function placeBuild({ pieces, bud }) {
  return {
    bodies: pieces.map((p) => ({ t: p.t, ...cellCenter(p.t, p.gx, p.gy), a: 0 })),
    bud: { x: FORT_X + (bud.gx + 0.5) * CELL, y: (bud.gy + 0.5) * CELL, a: 0 },
  };
}

function makeWorld(state) {
  const world = new planck.World({ gravity: planck.Vec2(0, -9.8) });
  const ground = world.createBody();
  ground.createFixture(planck.Edge(planck.Vec2(-12, 0), planck.Vec2(GROUND_END, 0)), { friction: 0.9 });
  // a little cliff face at the end of the island
  ground.createFixture(planck.Edge(planck.Vec2(GROUND_END, 0), planck.Vec2(GROUND_END, -6)), { friction: 0.5 });
  const bodies = state.bodies.map((b) => {
    const P = PIECES[b.t];
    const body = world.createDynamicBody({ position: planck.Vec2(b.x, b.y), angle: b.a || 0, angularDamping: 0.05 });
    const hw = P.w * CELL / 2 - 0.006, hh = P.h * CELL / 2 - 0.006;
    body.createFixture(planck.Box(hw, hh), { density: P.density, friction: P.friction, restitution: 0.05 });
    body.setUserData({ kind: 'piece', t: b.t });
    return body;
  });
  const bud = world.createDynamicBody({ position: planck.Vec2(state.bud.x, state.bud.y), angle: state.bud.a || 0 });
  // a blob with a flat-ish bottom, so it sits still instead of rolling around its tower
  const blob = Array.from({ length: 10 }, (_, i) => { const t = (i / 10) * Math.PI * 2; return planck.Vec2(Math.cos(t) * BUD_R, Math.sin(t) * BUD_R * (Math.sin(t) < 0 ? 0.8 : 1.05)); });
  bud.createFixture(planck.Polygon(blob), { density: 1.2, friction: 0.95, restitution: 0.05 });
  bud.setUserData({ kind: 'bud' });
  return { world, bodies, bud };
}

// How far the tower's bud moved from where it sat: falling counts as a knockout.
const fell = (start, p) => start.y - p.y > 0.7 || Math.abs(p.x - start.x) > 1.1 || (p.y < BUD_R + 0.05 && start.y > CELL);

// Let a fortress settle (new builds and repairs): unsupported pieces fall. Returns the resting state, or
// an error if the bud doesn't stay put.
export function settle(state, seconds = 3) {
  const { world, bodies, bud } = makeWorld(state);
  const start = { ...state.bud };
  for (let i = 0; i < seconds * HZ; i++) world.step(1 / HZ, 8, 3);
  const p = bud.getPosition();
  if (fell(start, p)) throw err('your bud wouldn’t stay put! give it something solid to sit on', 409);
  return snapshot(bodies, bud).state;
}
function snapshot(bodies, bud) {
  const keep = bodies.map((b) => ({ b, p: b.getPosition() })).filter((x) => x.p.y > -2);   // gone into the sea
  return {
    state: {
      bodies: keep.map(({ b, p }) => ({ t: b.getUserData().t, x: r3(p.x), y: r3(p.y), a: r3(b.getAngle()) })),
      bud: { x: r3(bud.getPosition().x), y: r3(bud.getPosition().y), a: r3(bud.getAngle()) },
    },
  };
}

// The launch: angle in degrees (15..75), power 0..1. Returns the frames to replay, the result, and the
// fortress afterwards.
export function shoot(state, angleIn, powerIn) {
  const angle = Math.max(15, Math.min(75, Number(angleIn) || 45)) * Math.PI / 180;
  const power = Math.max(0, Math.min(1, Number(powerIn) || 0));
  const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * power;
  const { world, bodies, bud } = makeWorld(state);
  const shot = world.createDynamicBody({ position: planck.Vec2(LAUNCH.x, LAUNCH.y), bullet: true, angularDamping: 0.1 });
  shot.createFixture(planck.Circle(SHOT_R), { density: 2.2, friction: 0.6, restitution: 0.25 });
  shot.setUserData({ kind: 'shot' });
  shot.setLinearVelocity(planck.Vec2(Math.cos(angle) * speed, Math.sin(angle) * speed));
  shot.setAngularVelocity(-4 - power * 6);   // a tumble

  const start = { ...state.bud };
  let ko = null, firstHit = null, step = 0;
  const jolt = { hits: 0, speed: 0 };   // what shook the tower's bud (for its dizziness)
  const hits = [];   // big impacts, for puffs and sounds: [frame, x, y, strength]
  world.on('post-solve', (contact, impulse) => {
    const a = contact.getFixtureA().getBody(), b = contact.getFixtureB().getBody();
    const ka = a.getUserData()?.kind, kb = b.getUserData()?.kind;
    const total = impulse.normalImpulses.reduce((s, v) => s + v, 0);
    if ((ka === 'shot' || kb === 'shot') && firstHit == null) firstHit = step;
    if (total > 1.5 && hits.length < 60) {
      const wm = contact.getWorldManifold(); const pt = wm?.points?.[0];
      if (pt && (!hits.length || step - hits[hits.length - 1][0] * REC > 6)) hits.push([Math.floor(step / REC), r3(pt.x), r3(pt.y), Math.round(Math.min(10, total))]);
    }
    // only once the shot has landed somewhere: a rebuilt fortress jiggles for a moment when it's set back up
    if (ko || firstHit == null) return;
    if ((ka === 'bud' || kb === 'bud') && (ka === 'shot' || kb === 'shot')) ko = { step, how: 'direct' };
    // knocks on the tower's bud, for its dizziness (resting on its floor pushes back far less than this)
    if ((ka === 'bud' || kb === 'bud') && total > 0.06) jolt.hits += total;
  });

  const frames = [], all = [...bodies, bud, shot];
  let quiet = 0;
  for (step = 0; step < HZ * 8; step++) {
    world.step(1 / HZ, 8, 3);
    if (!ko && firstHit != null) {
      jolt.speed = Math.max(jolt.speed, bud.getLinearVelocity().length());
      if (bud.getLinearVelocity().length() > KNOCK_SPEED) ko = { step, how: 'knocked' };
      else if (fell(start, bud.getPosition())) ko = { step, how: 'fell' };
    }
    // once it lands, the flying bud thuds and slows down instead of rolling across the island
    if (firstHit != null && !shot.landed) { shot.landed = true; shot.setLinearDamping(0.9); shot.setAngularDamping(2.5); }
    if (step % REC === 0) frames.push(all.map((b) => { const p = b.getPosition(); return [r2(p.x), r2(p.y), r2(b.getAngle())]; }));
    // done once everything has calmed down (after the shot has landed somewhere)
    const moving = all.some((b) => b.isAwake() && b.getPosition().y > -2 && (b.getLinearVelocity().length() > 0.05 || Math.abs(b.getAngularVelocity()) > 0.05));
    quiet = moving ? 0 : quiet + 1;
    const sp = shot.getPosition();
    if ((firstHit != null || sp.y < -2 || sp.x > GROUND_END + 8) && quiet > 20 && step > HZ) break;
    if (sp.x < -14) break;
  }
  const after = snapshot(bodies, bud).state;
  const end = bud.getPosition();
  jolt.spin = Math.abs(bud.getAngle() - (start.a || 0)); jolt.moved = Math.hypot(end.x - start.x, end.y - start.y);
  const before = Math.max(0, Math.min(DIZZY_MAX, state.dizzy || 0));
  const gain = ko ? 0 : dizzyFrom(jolt);
  after.dizzy = Math.min(DIZZY_MAX, before + gain);
  if (!ko && after.dizzy >= DIZZY_MAX) ko = { step: Math.max(0, (frames.length - 12) * REC), how: 'dizzy' };
  return {
    jolt, dizzy: { before, gain, after: after.dizzy },
    frames, hz: HZ / REC,
    kinds: [...bodies.map((b) => b.getUserData().t), 'bud', 'shot'],
    ko: ko ? { frame: Math.floor(ko.step / REC), how: ko.how } : null,
    hits, firstHit: firstHit == null ? null : Math.floor(firstHit / REC),
    after,
    shot: { angle: Math.round(angle * 180 / Math.PI), power: r3(power) },
  };
}

// Repairs between launches: clear away any pieces (rubble included), move the bud to an empty square, and
// add up to 2 new pieces on empty squares. Then it all settles again (and the bud has to stay put).
// changes: { add: [{ t, x, y }], remove: [index into state.bodies], bud: { x, y } (a grid square) }
export function repair(state, changes) {
  const ch = Array.isArray(changes) ? { add: changes } : (changes || {});
  const add = Array.isArray(ch.add) ? ch.add : [], removeList = Array.isArray(ch.remove) ? ch.remove.map(Number) : [];
  if (add.length > REPAIR_PIECES) throw err(`add up to ${REPAIR_PIECES} pieces`);
  if (removeList.some((i) => !Number.isInteger(i) || i < 0 || i >= state.bodies.length)) throw err('that piece isn’t there');
  const remove = new Set(removeList);
  const base = { bodies: state.bodies.filter((_, i) => !remove.has(i)), bud: state.bud };
  if (base.bodies.filter((b) => b.t === 'stone').length + add.filter((p) => p?.t === 'stone').length > MAX_STONE) throw err(`up to ${MAX_STONE} stone blocks`);
  if (base.bodies.length + add.length > MAX_PIECES + 3 * REPAIR_PIECES) throw err('that’s too many pieces');
  if (ch.bud != null) {
    const gx = Number(ch.bud.x), gy = Number(ch.bud.y);
    if (!Number.isInteger(gx) || !Number.isInteger(gy) || gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) throw err('where is your bud?');
    base.bud = { x: FORT_X + (gx + 0.5) * CELL, y: (gy + 0.5) * CELL, a: 0 };
  }
  const { world } = makeWorld(base);
  const busy = (x0, y0, x1, y1, ignoreBud) => {
    let hit = false;
    world.queryAABB(planck.AABB(planck.Vec2(x0, y0), planck.Vec2(x1, y1)), (f) => {
      const b = f.getBody();
      if (b.isStatic() || (ignoreBud && b.getUserData()?.kind === 'bud')) return true;
      // the search uses padded boxes, so check the piece's own box: touching neighbors aren't in the way
      const box = f.getAABB(0);
      if (box.upperBound.x <= x0 + 0.01 || box.lowerBound.x >= x1 - 0.01 || box.upperBound.y <= y0 + 0.01 || box.lowerBound.y >= y1 - 0.01) return true;
      hit = true; return false;
    });
    return hit;
  };
  if (ch.bud != null && busy(base.bud.x - BUD_R, base.bud.y - BUD_R, base.bud.x + BUD_R, base.bud.y + BUD_R, true)) throw err('your bud doesn’t fit there', 409);
  const placed = [];
  for (const p of add) {
    const P = PIECES[p?.t], gx = Number(p?.x), gy = Number(p?.y);
    if (!P || !Number.isInteger(gx) || !Number.isInteger(gy) || gx < 0 || gy < 0 || gx + P.w > COLS || gy + P.h > ROWS) throw err('a piece is off the grid');
    const c = cellCenter(p.t, gx, gy), hw = P.w * CELL / 2 - 0.02, hh = P.h * CELL / 2 - 0.02;
    if (busy(c.x - hw, c.y - hh, c.x + hw, c.y + hh, false) || placed.some((b) => Math.abs(b.x - c.x) < b.hw + hw && Math.abs(b.y - c.y) < b.hh + hh)) throw err('something’s in the way there', 409);
    placed.push({ x: c.x, y: c.y, hw, hh });
    base.bodies.push({ t: p.t, x: c.x, y: c.y, a: 0 });
  }
  return { ...settle(base, 2), dizzy: state.dizzy || 0 };
}

// A fortress sent back from the page (the test range keeps it there between shots): check its shape.
export function cleanState(s) {
  const num = (v, lo, hi) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw err('that fortress didn’t come through'); return n; };
  if (!s || !Array.isArray(s.bodies) || s.bodies.length > MAX_PIECES + 3 * REPAIR_PIECES) throw err('that fortress didn’t come through');
  return {
    bodies: s.bodies.map((b) => {
      if (!PIECES[b?.t]) throw err('that fortress didn’t come through');
      return { t: b.t, x: num(b.x, -20, 60), y: num(b.y, -3, 20), a: num(b.a, -1e4, 1e4) };
    }),
    bud: { x: num(s.bud?.x, -20, 60), y: num(s.bud?.y, -3, 20), a: num(s.bud?.a, -1e4, 1e4) },
    dizzy: num(s.dizzy ?? 0, 0, DIZZY_MAX),
  };
}
