// Party night bits shared by the TV picker (/tv), the join page (/join) and every game that can run on a TV
// (see lib/party.js): the code and where each game lives, the "join on your phone" card, phones following the
// TV from game to game, and keeping screens awake.
import qrcode from '/js/vendor/qrcode-generator-2.0.4.js';

export const params = new URLSearchParams(location.search);
const okCode = (c) => /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(c);
export const partyCode = () => { const c = (params.get('code') || params.get('c') || '').toUpperCase(); return okCode(c) ? c : null; };
export const cleanCode = (text) => String(text || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
export { okCode };

// where the party is: the page for a game, for the TV or for a phone
export function pageFor(p, tv) {
  const c = p.code;
  if (p.game === 'race') return `/race?room=${p.room}&code=${c}${tv ? '&tv=1' : ''}`;
  if (p.game === 'prank') return `/prankster?room=${p.room}&code=${c}${tv ? '&tv=1' : ''}`;
  if (p.game === 'party') return `/party?code=${c}${tv ? `&tv=1&g=${p.pick || 'bumper'}` : ''}`;
  return tv ? `/tv?code=${c}` : `/join?c=${c}`;
}
// two pages are the same place if they'd show the same thing
export const placeOf = (p) => (p.game === 'party' || p.game === 'lobby' ? p.game : `${p.game}:${p.room}`);

async function get(path, session) {
  const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: session ? { 'x-bud-session': session } : {} });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw Object.assign(new Error(data.error || 'something went wrong'), { status: res.status });
  return data;
}
export const lookUp = (code, tv) => get(`/api/game?party=${code}${tv ? '&tv=1' : ''}`);

// Phones: ask where the party is every few seconds, and go there when the TV moves on.
// `here` is placeOf() for the page you're on. onParty gets each answer (who's here, and so on).
// Returns { check, stop }: check() asks right now (the live games call it the moment the TV says it's leaving,
// so they can ask far less often the rest of the time).
export function follow(code, here, onParty, every = 4000) {
  let stopped = false, misses = 0, timer = null, asking = false;
  const ask = async () => {
    if (stopped || asking) return;
    asking = true;
    try {
      const p = await lookUp(code, false);
      misses = 0;
      if (onParty) onParty(p);
      if (placeOf(p) !== here) { stopped = true; location.replace(pageFor(p, false)); return; }
    } catch (e) {
      // the party's over (or the code went stale): stay where you are
      if (e.status === 404 && ++misses >= 2) { stopped = true; if (onParty) onParty(null); return; }
    } finally { asking = false; }
  };
  const tick = async () => { if (stopped) return; if (!document.hidden) await ask(); if (!stopped) timer = setTimeout(tick, every); };
  timer = setTimeout(tick, 1500);
  return { check: ask, stop: () => { stopped = true; clearTimeout(timer); } };
}

// The TV: back to the picker, taking every phone along.
export async function backToPicker(code) {
  try {
    await fetch('/api/game', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'party-set', code, game: 'lobby' }) });
  } catch (e) {}
  location.href = `/tv?code=${code}`;
}

/* ---------- the "join on your phone" card ---------- */
const CSS = `
.joincard { display: flex; align-items: center; gap: 16px; background: #fff; color: #1D1C2B; border-radius: 22px; padding: 14px 18px 14px 14px; box-shadow: 0 18px 40px -22px rgba(46,40,90,.5); font-family: "Fredoka", "Nunito", ui-rounded, "SF Pro Rounded", system-ui, sans-serif; text-align: left; }
.joincard svg { width: 132px; height: 132px; flex: none; display: block; border-radius: 8px; }
.joincard .jc-how { margin: 0; font-size: 15px; font-weight: 600; color: #5E5D75; line-height: 1.3; }
.joincard .jc-url { margin: 2px 0 6px; font-size: 21px; font-weight: 700; line-height: 1.15; word-break: break-all; }
.joincard .jc-code { display: flex; gap: 6px; }
.joincard .jc-code span { display: grid; place-items: center; width: 44px; height: 52px; border-radius: 12px; background: #1D1C2B; color: #fff; font-size: 30px; font-weight: 700; }
.joincard.small svg { width: 84px; height: 84px; }
.joincard.small .jc-url { font-size: 16px; }
.joincard.small .jc-code span { width: 30px; height: 36px; font-size: 21px; border-radius: 9px; }
.joinchip { display: inline-flex; align-items: center; gap: 8px; background: rgba(255,255,255,.88); color: #1D1C2B; border-radius: 999px; padding: 5px 12px; font: 600 14px "Fredoka", "Nunito", ui-rounded, system-ui, sans-serif; white-space: nowrap; }
.joinchip b { letter-spacing: .12em; font-size: 16px; }
`;
let styled = false;
function style() {
  if (styled) return; styled = true;
  const s = document.createElement('style'); s.textContent = CSS; document.head.append(s);
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
export const joinUrl = (code) => `${location.origin}/join?c=${code}`;

// a QR code as one SVG path (dark on white, with the quiet edge it needs to scan)
export function qrSvg(text) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), pad = 3, size = n + pad * 2;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + pad} ${y + pad}h1v1h-1z`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('shape-rendering', 'crispEdges'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'A code to scan with your phone’s camera');
  const bg = document.createElementNS(svg.namespaceURI, 'rect'); bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#fff');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); path.setAttribute('fill', '#1D1C2B');
  svg.append(bg, path);
  return svg;
}
export function joinCard(code, { small = false } = {}) {
  style();
  const card = el('div', 'joincard' + (small ? ' small' : '')), words = el('div');
  const letters = el('div', 'jc-code'); letters.setAttribute('aria-label', `The code is ${code.split('').join(' ')}`);
  for (const ch of code) letters.append(el('span', null, ch));
  words.append(el('p', 'jc-how', 'On your phone, scan this or go to'), el('p', 'jc-url', `${location.host}/join`), letters);
  card.append(qrSvg(joinUrl(code)), words);
  return card;
}
// one line for the top of the TV while a game is on, for whoever walks in late
export function joinChip(code) {
  style();
  const chip = el('span', 'joinchip');
  chip.append(`Join: ${location.host}/join`, el('b', null, code));
  return chip;
}

/* ---------- screens that stay on ---------- */
// A phone that dozes off misses its turn, and a TV that dims is no TV. Asks the browser to keep the screen
// awake while the page is showing (it lets go by itself when you leave).
export function keepAwake() {
  if (!('wakeLock' in navigator)) return;
  let lock = null;
  const ask = async () => { if (lock || document.hidden) return; try { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } catch (e) {} };
  document.addEventListener('visibilitychange', ask);
  addEventListener('pointerdown', ask, { passive: true });
  ask();
}
