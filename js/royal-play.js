// Bud Royal, the part you see and touch: the meadow in 3D, your hand of buds, and a match against an island bud.
// The battle itself is js/royal-rules.js; this file only shows it and sends placements into it.
// World: x across (-9 to 9), z down the meadow (your home near the camera at z = +13, theirs at z = -13).
import { ROYAL, KINDS, newBattle, step, canPlace, botMove, fingerprint, tree as treeOf, home as homeOf, statOf, timeLeft, doubled } from '/js/royal-rules.js';
import { setExtents, buildMesh, drawEyeStyle, clamp } from '/js/bud-core.js';
import { drawBud } from '/js/bud-flat.js';

const S = window.BudSound || { play() {}, babble() {}, bindToggle() {} };
const T = ROYAL.TICK;
let ME = 0, THEM = 1;   // which side is yours: 0 against an island bud; whichever the server gave you against a friend
const col = (side) => (side === ME ? '#3D8BFD' : '#F0607A');
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
// what each power does, in a line, and its little picture
export const ABOUT = {
  bookworm: ['📚', 'Throws books from far away.'], glitch: ['👾', 'Flickers forward. Splits into little ones when hurt.'], loud: ['🔊', 'Has to get close. Then blasts everything around it.'],
  lifter: ['🏋️', 'Big and slow. Soaks up the hits.'], striker: ['⚽', 'Runs straight for trees and ignores buds.'], masher: ['🎮', 'Quick and cheap. Lots of little hits.'],
  lobber: ['🍿', 'Lobs popcorn that bursts over a crowd.'], pets: ['🐾', 'Three little pets that swarm.'], chef: ['🍳', 'Feeds hurt friends nearby.'],
  gardener: ['🌱', 'Plants a sprout that spits seeds for 30 seconds.'], islander: ['👊', 'A plain, friendly bonk.'], squirrel: ['🐿️', 'Fast and fragile. Pinches 1 Glow if it reaches a tree.'],
  gloam: ['🏮', 'A slow lighthouse beam through everything in its line.'],
};

// deal: the match from the server. net: the live connection when it's against a friend (js/royal-net.js, plus
// which side you are, the match's id and when it starts); without it the other side is an island bud.
export async function runRoyal(deal, net = null) {
  ME = net ? net.side : 0; THEM = 1 - ME;
  const THREE = window.THREE;
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const M = (hex, o = {}) => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: 0.85, ...o });
  const B = (hex, o = {}) => new THREE.MeshBasicMaterial({ color: lin(hex), ...o });
  // your home is always at the bottom of your screen, so side 1 sees the meadow turned round
  const flip = ME === 1, wx = (x) => (flip ? ROYAL.W / 2 - x : x - ROYAL.W / 2), wz = (y) => (flip ? y - ROYAL.L / 2 : ROYAL.L / 2 - y);
  const looks = deal.buds || {};
  const nameOfBud = (id) => looks[id]?.name || (id === 'gloam' ? 'Gloam' : id === 'squirrel' ? 'The squirrel' : null);

  // sounds, kept from piling up: the same sound won't play again within `gap` seconds
  const heard = {};
  function snd(name, o = {}, gap = 0.07) { const t = performance.now() / 1000; if (heard[name] && t - heard[name] < gap) return; heard[name] = t; S.play(name, o); }
  const HELLO = { bookworm: ['flap', 0.9], glitch: ['glitchy', 0.9], loud: ['wub', 0.5], lifter: ['oof', 1], striker: ['kick', 0.7], masher: ['mash', 1], lobber: ['crunch', 0.7], pet: ['yip', 0.9], chef: ['yum', 0.9], sprout: ['sprout', 1], islander: ['boop', 1], squirrel: ['squeak', 1], gloam: ['grumble', 1], bit: ['glitchy', 0.6] };
  const SMACK = { masher: ['mash', 0.9, 0.05], lifter: ['bonk', 0.55, 0.1], striker: ['kick', 0.9, 0.1], pet: ['yip', 0.5, 0.16], squirrel: ['squeak', 0.7, 0.1], glitch: ['glitchy', 0.45, 0.12], bit: ['pip', 0.6, 0.08], islander: ['bonk', 0.8, 0.09] };
  const voiceFor = (id) => ({ voice: looks[id]?.voice });

  /* ---------- the stage ---------- */
  const wrap = $('stage'), renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); wrap.append(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1, 0.5, 200);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9FB98A, 0.7));
  const sun = new THREE.DirectionalLight(0xFFF1D6, 0.85); sun.position.set(-9, 12, 12); scene.add(sun);
  let PITCH = 0.98, shake = 0;
  function fit() {
    const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    const pts = []; for (const x of [-9.8, 9.8]) for (const z of [-16.6, 16.8]) pts.push(new THREE.Vector3(x, 0, z)); pts.push(new THREE.Vector3(0, 6.2, -13), new THREE.Vector3(-6, 5, -9.5), new THREE.Vector3(6, 5, -9.5));
    // tilt it as far towards a map as it takes for the meadow to fill a tall screen, and no further
    let d = 16;
    for (PITCH = 0.92; PITCH <= 1.3; PITCH += 0.03) {
      d = 14;
      for (let i = 0; i < 110; i++, d *= 1.03) {
        camera.position.set(0, Math.sin(PITCH) * d, Math.cos(PITCH) * d + 1.2); camera.lookAt(0, 0, 1.2); camera.updateMatrixWorld();
        if (pts.every((p) => { const q = p.clone().project(camera); return Math.abs(q.x) < 0.985 && q.y < 0.93 && q.y > -0.97; })) break;
      }
      const top = pts[0].clone().project(camera).y, bot = pts[1].clone().project(camera).y;
      if (Math.abs(top - bot) > 1.62) break;
    }
    camera.userData.d = d;
  }
  new ResizeObserver(fit).observe(wrap);
  const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t; };
  const flat = (geo, mat, y = 0.02) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; return m; };

  // the meadow: grass, a path up each lane, the river and its two bridges
  {
    const PX = 40, tw = ROYAL.W * PX, th = ROYAL.L * PX;
    const tex = canvasTex(tw, th, (g) => {
      const Y = (y) => (ROYAL.L - y) * PX, X = (x) => x * PX;
      for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#A9D98A' : '#9FD27F'; g.fillRect(0, i * th / 16, tw, th / 16 + 1); }
      const tint = g.createLinearGradient(0, 0, 0, th); tint.addColorStop(0, 'rgba(240,96,122,.13)'); tint.addColorStop(0.45, 'rgba(255,255,255,0)'); tint.addColorStop(0.55, 'rgba(255,255,255,0)'); tint.addColorStop(1, 'rgba(61,139,253,.13)'); g.fillStyle = tint; g.fillRect(0, 0, tw, th);
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const [wd, c] of [[58, 'rgba(160,120,80,.35)'], [42, '#E8D2A0']]) {
        g.strokeStyle = c; g.lineWidth = wd;
        for (const bx of ROYAL.BRIDGES) { g.beginPath(); g.moveTo(X(9), Y(4.5)); g.quadraticCurveTo(X(bx), Y(4.5), X(bx), Y(8)); g.lineTo(X(bx), Y(24)); g.quadraticCurveTo(X(bx), Y(27.5), X(9), Y(27.5)); g.stroke(); }
      }
      g.fillStyle = '#6EC3EE'; g.fillRect(0, Y(ROYAL.RIVER1), tw, (ROYAL.RIVER1 - ROYAL.RIVER0) * PX);
      g.fillStyle = 'rgba(255,255,255,.5)'; let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 46; i++) { const x = r() * tw, y = Y(ROYAL.RIVER1) + 8 + r() * ((ROYAL.RIVER1 - ROYAL.RIVER0) * PX - 16); g.beginPath(); g.roundRect(x, y, 14 + r() * 26, 3, 2); g.fill(); }
      g.fillStyle = 'rgba(60,110,60,.18)'; g.fillRect(0, Y(ROYAL.RIVER1) - 5, tw, 5); g.fillRect(0, Y(ROYAL.RIVER0), tw, 5);
      for (let i = 0; i < 240; i++) { const x = r() * tw, y = r() * th; if (Math.abs(y - th / 2) < PX * 1.4) continue; g.fillStyle = ['#FFFFFF', '#FFE27A', '#FFB3D1', '#C9B6FF'][i % 4]; g.beginPath(); g.arc(x, y, 2.2 + r() * 1.8, 0, Math.PI * 2); g.fill(); }
    });
    scene.add(flat(new THREE.PlaneGeometry(ROYAL.W, ROYAL.L), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }), 0));
    const edge = new THREE.Mesh(new THREE.BoxGeometry(ROYAL.W + 1.2, 1.2, ROYAL.L + 1.2), M('#8FC473')); edge.position.y = -0.62; scene.add(edge);
    const dirt = new THREE.Mesh(new THREE.BoxGeometry(ROYAL.W + 0.8, 2.6, ROYAL.L + 0.8), M('#A8825E')); dirt.position.y = -2.4; scene.add(dirt);
    const wood = M('#B98A56'), dark = M('#8A623A');
    for (const bx of ROYAL.BRIDGES) {
      for (let i = 0; i < 7; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(ROYAL.BRIDGE_HALF * 2 + 0.3, 0.14, 0.34), i % 2 ? wood : dark); p.position.set(wx(bx), 0.08, -1.2 + i * 0.4); scene.add(p); }
      for (const s of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.36, 2.9), dark); rail.position.set(wx(bx) + s * (ROYAL.BRIDGE_HALF + 0.12), 0.3, 0); scene.add(rail); }
    }
    let s = 11; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647), bush = [M('#6FB86A'), M('#5DA85F'), M('#86C873')];
    for (let i = 0; i < 44; i++) { const side = i % 2 ? 1 : -1, z = -15.5 + r() * 31; if (Math.abs(z) < 1.6) continue; const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45 + r() * 0.3, 1), bush[i % 3]); b.position.set(side * (9.2 + r() * 0.3), 0.3, z); b.scale.y = 0.8; scene.add(b); }
  }

  /* ---------- little things that fly and fade ---------- */
  const bits = [];
  function bit(mesh, o) { mesh.position.set(o.x, o.y, o.z); scene.add(mesh); bits.push({ m: mesh, t: 0, life: o.life || 0.6, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, g: o.g || 0, grow: o.grow || 0, s0: mesh.scale.x, spin: o.spin || 0, keep: o.keep }); return mesh; }
  const puffGeo = new THREE.SphereGeometry(0.18, 8, 6);
  function puff(x, z, n = 8, color = '#FFFFFF', y = 0.3, sp = 2.2) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283; bit(new THREE.Mesh(puffGeo, B(color, { transparent: true, depthWrite: false })), { x, y, z, vx: Math.cos(a) * sp * Math.random(), vz: Math.sin(a) * sp * Math.random(), vy: 1 + Math.random() * 2, g: 5, life: 0.5, grow: 1 }); } }
  function ring(x, z, r, color, life = 0.45, y = 0.1) { const m = flat(new THREE.RingGeometry(0.82, 1, 40), B(color, { transparent: true, depthWrite: false, side: THREE.DoubleSide }), y); m.scale.setScalar(0.2); bit(m, { x, y, z, life, grow: r / 0.2 - 1 }); }
  function leaves(x, z, n = 26, colors = ['#6FB86A', '#9AD67A', '#F2C84B']) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.17), B(colors[i % colors.length], { transparent: true, side: THREE.DoubleSide, depthWrite: false })); m.rotation.set(Math.random() * 3, Math.random() * 3, 0); bit(m, { x: x + Math.cos(a) * 0.8, y: 2 + Math.random() * 2.5, z: z + Math.sin(a) * 0.8, vx: Math.cos(a) * 3 * Math.random(), vz: Math.sin(a) * 3 * Math.random(), vy: 2 + Math.random() * 3, g: 6, life: 1.3, spin: 8 }); } }
  function words(text, x, y, z, color = '#FFFFFF', size = 1) {
    const c = document.createElement('canvas'), g = c.getContext('2d'), fs = 72, font = `700 ${fs}px Fredoka, Nunito, ui-rounded, system-ui, sans-serif`;
    g.font = font; const w = Math.ceil(g.measureText(text).width) + 36; c.width = w; c.height = fs * 1.4;
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = '#1D1C2B'; g.strokeText(text, w / 2, c.height / 2); g.fillStyle = color; g.fillText(text, w / 2, c.height / 2);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); s.renderOrder = 20; const h = 1.25 * size; s.scale.set(h * w / c.height, h, 1);
    bit(s, { x, y, z, vy: 1.3, life: 1.1, keep: true });
  }
  // a speech bubble over a home: what the bud who lives there thinks of all this
  function bubble(side, text) {
    const H = homes[side]; if (!H) return; if (H.bubble) { scene.remove(H.bubble); H.bubble.material.map.dispose(); }
    const c = document.createElement('canvas'), g = c.getContext('2d'), fs = 54, font = `600 ${fs}px Fredoka, Nunito, ui-rounded, system-ui, sans-serif`;
    g.font = font; const w = Math.ceil(g.measureText(text).width) + 56; c.width = w; c.height = fs * 2.1;
    g.fillStyle = '#FFFFFF'; g.strokeStyle = '#1D1C2B'; g.lineWidth = 5; g.beginPath(); g.roundRect(3, 3, w - 6, fs * 1.55, 30); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(w / 2 - 16, fs * 1.55); g.lineTo(w / 2, fs * 2); g.lineTo(w / 2 + 16, fs * 1.55); g.closePath(); g.fill(); g.stroke(); g.fillRect(w / 2 - 13, fs * 1.55 - 5, 26, 8);
    g.font = font; g.fillStyle = '#1D1C2B'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, fs * 0.82);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); s.renderOrder = 19; const h = 1.9; s.scale.set(h * w / c.height, h, 1);
    s.position.set(clamp(H.g.position.x, -5.5, 5.5), 7.6, H.g.position.z); scene.add(s); H.bubble = s; H.bubbleT = 2.6;
    if (!fast) S.babble(text, H.name || 'bud', { gain: 1, ...voiceFor(H.owner) });   // and says it, in its own voice
  }

  /* ---------- buds ---------- */
  const FACE_W = 256, FACE_H = 175, templates = new Map();
  const blob = (sx = 60, sy = 54) => ({ r: Array.from({ length: 36 }, (_, i) => { const a = i / 36 * Math.PI * 2; return [Math.cos(a) * sx, Math.sin(a) * sy * (Math.sin(a) < 0 ? 1 : 0.92)]; }), eyeRel: { x: 0, y: -6 }, eyeR: 15, eyes: 'classic', paint: null });
  const STANDIN = { bookworm: '#8FB8FF', glitch: '#7BE0D2', loud: '#FF9F6B', lifter: '#C9A27A', striker: '#8ED081', masher: '#C6A7FF', lobber: '#FFD86B', pets: '#FFB3C7', chef: '#FFFFFF', gardener: '#9AD67A', islander: '#D8D6E6' };
  const loadImage = (src) => new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  // everything about one bud's looks that its copies can share (shape, paint, face)
  function template(key, look, color) {
    let t = templates.get(key); if (t) return t;
    const data = look && look.r && look.r.length > 8 ? look : blob();
    const b = setExtents({ r: data.r.map(([x, y]) => ({ x, y })), eyeRel: data.eyeRel, eyeR: data.eyeR }), { geom, face } = buildMesh(b);
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: lin(color || '#D8D6E6'), roughness: 0.58, clearcoat: 0.3 });
    const fc = document.createElement('canvas'); fc.width = FACE_W; fc.height = FACE_H; const faceTex = new THREE.CanvasTexture(fc); faceTex.encoding = THREE.sRGBEncoding;
    const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    geom.computeBoundingBox(); const bb = geom.boundingBox;
    t = { data, b, geom, face, bodyMat, faceMat, faceTex, g: fc.getContext('2d'), eyeCol: color === '#3B4260' ? '#F3F4F8' : '#15161F', bb, key: '', mood: null, happy: false, sleepy: false, blinkAt: 0 };
    if (data.paint) loadImage(data.paint).then((img) => { if (!img) return; const map = new THREE.Texture(img); map.encoding = THREE.sRGBEncoding; map.needsUpdate = true; bodyMat.map = map; bodyMat.color.set(0xffffff); bodyMat.needsUpdate = true; t.key = ''; });
    templates.set(key, t); return t;
  }
  function face(t, now) {
    const blink = t.sleepy ? 1 : (now > t.blinkAt && now < t.blinkAt + 0.15) ? Math.sin((now - t.blinkAt) / 0.15 * Math.PI) : 0;
    if (now > t.blinkAt + 0.15) t.blinkAt = now + 2 + Math.random() * 4;
    const key = [blink.toFixed(1), t.happy, t.mood, t.eyeCol].join(); if (key === t.key) return; t.key = key;
    t.g.clearRect(0, 0, FACE_W, FACE_H);
    drawEyeStyle(t.g, t.data.eyes || 'classic', FACE_W / 2, FACE_H / 2, t.b.eyeR * (FACE_W / (t.b.eyeR * 4.4)), blink, t.happy, t.eyeCol, { x: 0, y: 0.15 }, t.mood);
    t.faceTex.needsUpdate = true;
  }
  // a copy of a bud, `width` across, standing on y = 0: root > squash > inner
  function budCopy(t, width) {
    const s = width / Math.max(t.b.w, t.b.h), c = t.bb.getCenter(new THREE.Vector3()), h = (t.bb.max.y - t.bb.min.y) * s;
    const inner = new THREE.Group(); const fm = new THREE.Mesh(t.face, t.faceMat); fm.renderOrder = 2; inner.add(new THREE.Mesh(t.geom, t.bodyMat), fm); inner.scale.setScalar(s); inner.position.set(-c.x * s, -c.y * s + h / 2 + 0.04, -c.z * s);
    const squash = new THREE.Group(), root = new THREE.Group(); squash.add(inner); root.add(squash);
    return { root, squash, h: h + 0.04, t };
  }
  const tmplFor = (budId, kind, role = '') => {
    if (budId === 'gloam' || kind === 'gloam') return template('gloam' + role, blob(56, 62), '#3B4260');
    const look = looks[budId]; return template((look ? budId : 'standin:' + kind) + role, look, look ? '#D8D6E6' : STANDIN[kind] || '#D8D6E6');
  };

  /* ---------- props: what shows a bud's power ---------- */
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), ball = (r, mat) => new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), mat);
  const cyl = (r0, r1, h, mat, n = 12) => new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, n), mat);
  function bookMesh(s = 1) { const g = new THREE.Group(), cover = M(['#E4572E', '#3D8BFD', '#2F9E6B', '#8A5CF6'][Math.floor(Math.random() * 4)]); const a = box(0.34, 0.1, 0.44, cover), p = box(0.3, 0.07, 0.4, M('#FFF8E7')); p.position.set(0.02, 0, 0); g.add(a, p); g.scale.setScalar(s); return g; }
  function propFor(kind, v) {
    const g = new THREE.Group(), w = v.w, h = v.h;
    if (kind === 'bookworm') { for (let i = 0; i < 3; i++) { const b = bookMesh(0.9); b.position.set(w * 0.62, 0.08 + i * 0.11, 0.1); b.rotation.y = i * 0.5; g.add(b); } }
    else if (kind === 'loud') { const sp = box(0.62, 0.8, 0.4, M('#2B2F3F')); sp.position.set(w * 0.72, 0.42, 0); const c1 = cyl(0.2, 0.2, 0.06, M('#C9CEDA')), c2 = cyl(0.11, 0.11, 0.06, M('#C9CEDA')); c1.rotation.x = c2.rotation.x = Math.PI / 2; c1.position.set(w * 0.72, 0.3, 0.21); c2.position.set(w * 0.72, 0.62, 0.21); g.add(sp, c1, c2); v.speaker = sp; }
    else if (kind === 'lifter') { const bar = cyl(0.04, 0.04, w * 1.5, M('#9AA1B4')); bar.rotation.z = Math.PI / 2; bar.position.y = h + 0.2; g.add(bar); for (const s of [-1, 1]) { const wt = cyl(0.24, 0.24, 0.16, M('#2B2F3F'), 14); wt.rotation.z = Math.PI / 2; wt.position.set(s * w * 0.72, h + 0.2, 0); g.add(wt); } v.lift = g; }
    else if (kind === 'striker') { const b = ball(0.22, M('#FFFFFF', { roughness: 0.4 })); b.position.set(0.1, 0.22, w * 0.6); const p = ball(0.08, M('#1D1C2B')); p.position.set(0.1, 0.32, w * 0.6 + 0.16); g.add(b, p); v.ball = b; }
    else if (kind === 'masher') { const pad = box(0.42, 0.14, 0.24, M('#5B6076')); pad.position.set(w * 0.55, h * 0.45, 0.2); const a = ball(0.05, M('#F0607A')), b = ball(0.05, M('#3D8BFD')); a.position.set(w * 0.55 + 0.1, h * 0.45 + 0.09, 0.24); b.position.set(w * 0.55 - 0.1, h * 0.45 + 0.09, 0.24); g.add(pad, a, b); }
    else if (kind === 'lobber') { const bk = cyl(0.26, 0.18, 0.4, M('#E8394B')); bk.position.set(w * 0.62, 0.2, 0.1); g.add(bk); for (let i = 0; i < 6; i++) { const p = ball(0.09, M('#FFF6D8')); p.position.set(w * 0.62 + (i % 3 - 1) * 0.1, 0.44 + (i > 2 ? 0.08 : 0), 0.1 + (i % 2) * 0.08); g.add(p); } }
    else if (kind === 'chef') { const base = cyl(0.26, 0.26, 0.16, M('#FFFFFF')), top = ball(0.3, M('#FFFFFF')); base.position.y = h + 0.02; top.position.y = h + 0.24; top.scale.y = 0.75; g.add(base, top); }
    else if (kind === 'glitch') { for (const [c, dx] of [['#35E0E0', -0.09], ['#FF4FD8', 0.09]]) { const ghost = new THREE.Mesh(v.t.geom, B(c, { transparent: true, opacity: 0.35, depthWrite: false })); ghost.scale.copy(v.inner.scale); ghost.position.copy(v.inner.position); ghost.position.x += dx; ghost.position.z -= 0.05; v.squash.add(ghost); (v.ghosts = v.ghosts || []).push(ghost); } }
    else if (kind === 'islander') { /* just itself */ }
    return g;
  }
  function gloamExtras(v) {
    const cap = new THREE.Group(), dome = ball(v.w * 0.42, M('#1E2540')), brim = cyl(v.w * 0.5, v.w * 0.5, 0.05, M('#1E2540'), 16); dome.scale.y = 0.6; brim.position.y = -0.02; cap.add(dome, brim); cap.position.y = v.h * 0.93; v.squash.add(cap);
    const lamp = new THREE.Group(), glow = ball(0.2, new THREE.MeshStandardMaterial({ color: lin('#FFE9A8'), emissive: lin('#FFB94A'), emissiveIntensity: 1.3 })), frame = cyl(0.24, 0.26, 0.06, M('#2B2F3F'), 8), topc = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 8), M('#2B2F3F'));
    frame.position.y = -0.2; topc.position.y = 0.26; lamp.add(glow, frame, topc); lamp.position.set(v.w * 0.7, v.h * 0.55, 0.15); v.turn.add(lamp); v.lamp = lamp;
  }
  function squirrelMesh() {
    const g = new THREE.Group(), fur = M('#B5652B'), pale = M('#F2D2A8'), dark = B('#1D1C2B');
    const body = ball(0.3, fur); body.scale.set(0.85, 0.9, 1.15); body.position.y = 0.32; const belly = ball(0.21, pale); belly.position.set(0, 0.29, 0.17); const head = ball(0.22, fur); head.position.set(0, 0.6, 0.28); g.add(body, belly, head);
    for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.15, 6), fur); ear.position.set(s * 0.12, 0.82, 0.26); const eye = ball(0.04, dark); eye.position.set(s * 0.1, 0.65, 0.47); g.add(ear, eye); }
    const tail = new THREE.Group(); for (const [y, z, r] of [[0.25, -0.35, 0.19], [0.52, -0.5, 0.24], [0.82, -0.46, 0.25], [1.03, -0.3, 0.2]]) { const t = ball(r, fur); t.position.set(0, y, z); tail.add(t); } g.add(tail); g.userData.tail = tail; return g;
  }
  function petMesh(i) {
    const g = new THREE.Group(), c = M(['#F2B880', '#C9CEDA', '#8A6B52'][i % 3]), dark = B('#1D1C2B');
    const body = ball(0.24, c); body.scale.set(0.9, 0.85, 1.15); body.position.y = 0.26; const head = ball(0.19, c); head.position.set(0, 0.5, 0.2); g.add(body, head);
    for (const s of [-1, 1]) { const ear = i % 3 === 1 ? ball(0.08, c) : new THREE.Mesh(new THREE.ConeGeometry(0.07, i % 3 === 2 ? 0.26 : 0.14, 5), c); ear.position.set(s * 0.12, 0.7, 0.18); const eye = ball(0.035, dark); eye.position.set(s * 0.08, 0.54, 0.37); g.add(ear, eye); }
    const tail = ball(0.07, c); tail.position.set(0, 0.34, -0.28); g.add(tail); return g;
  }
  function sproutMesh() {
    const g = new THREE.Group(), stem = cyl(0.1, 0.16, 0.9, M('#4E9A57')); stem.position.y = 0.45; const pot = cyl(0.42, 0.32, 0.36, M('#C8762B')); pot.position.y = 0.18; const head = ball(0.36, M('#F0607A')); head.position.y = 1.08; head.scale.set(1, 0.9, 1);
    const mouth = ball(0.16, B('#1D1C2B')); mouth.position.set(0, 1.06, 0.26); g.add(pot, stem, head, mouth);
    for (const s of [-1, 1]) { const leaf = ball(0.24, M('#5DB868')); leaf.scale.set(1.2, 0.25, 0.7); leaf.position.set(s * 0.32, 0.58, 0); leaf.rotation.z = s * 0.5; g.add(leaf); }
    g.userData.head = head; return g;
  }

  /* ---------- health bars ---------- */
  const barGeo = new THREE.PlaneGeometry(1, 1);
  function makeBar(w, side, big) {
    const g = new THREE.Group(), bg = new THREE.Mesh(barGeo, B('#1D1C2B', { transparent: true, opacity: 0.75, depthTest: false })), fill = new THREE.Mesh(barGeo, B(side === ME ? '#6FB0FF' : '#FF8296', { depthTest: false, transparent: true }));
    bg.scale.set(w + 0.14, big ? 0.42 : 0.26, 1); fill.scale.set(w, big ? 0.28 : 0.14, 1); fill.position.z = 0.01; bg.renderOrder = 15; fill.renderOrder = 16; g.add(bg, fill); g.userData = { fill, w }; scene.add(g); return g;
  }
  const setBar = (bar, k) => { const f = bar.userData.fill, w = bar.userData.w; f.scale.x = Math.max(0.001, w * k); f.position.x = -w * (1 - k) / 2; };

  /* ---------- guardian trees and homes ---------- */
  const trees = new Map(), homes = [null, null];
  function makeTree(e) {
    const g = new THREE.Group(), bark = M('#8A5C3A'), trunk = cyl(0.5, 0.78, 2.6, bark, 14); trunk.position.y = 1.3; g.add(trunk);
    const fc = document.createElement('canvas'); fc.width = 256; fc.height = 200; const tex = new THREE.CanvasTexture(fc); tex.encoding = THREE.sRGBEncoding;
    const faceM = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.74, 1.5, 16, 1, true, -1.05, 2.1), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); faceM.position.y = 1.15; g.add(faceM);
    const crown = new THREE.Group(), lm = [M('#58B368'), M('#6CC47A'), M('#4BA35C')];
    for (const [x, y, z, r, k] of [[0, 0.3, 0, 1.45, 0], [1.0, 0, 0.3, 1.05, 1], [-1.0, 0.05, 0.2, 1.1, 2], [0.2, 0.1, 0.95, 1.0, 1], [-0.2, 0.2, -0.95, 1.05, 0], [0, 1.0, 0, 0.95, 2]]) { const p = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), lm[k]); p.position.set(x, y, z); p.scale.y = 0.85; crown.add(p); }
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.09, 8, 24), M(col(e.side))); sash.rotation.x = Math.PI / 2; sash.position.y = 2.15; g.add(sash);
    crown.position.y = 3.5; g.add(crown); g.position.set(wx(e.x), 0, wz(e.y)); scene.add(g);
    const v = { e, g, crown, tex, fg: fc.getContext('2d'), key: '', hitT: 0, alertT: 0, bar: makeBar(1.9, e.side, true), down: 0 };
    trees.set(e.id, v); return v;
  }
  function treeFace(v, now) {
    const e = v.e, k = e.hp / e.max, mood = e.hp <= 0 ? 'out' : v.hitT > 0 ? 'ouch' : k < 0.35 ? 'weak' : v.alertT > 0 ? 'angry' : 'sleep';
    const blink = now % 3.7 < 0.14, key = mood + blink; if (key === v.key) return; v.key = key;
    const g = v.fg, cx = 128, cy = 78, ink = '#2B1A10'; g.clearRect(0, 0, 256, 200); g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 10; g.lineCap = 'round';
    for (const s of [-1, 1]) {
      const x = cx + s * 44;
      if (mood === 'sleep' || blink) { g.beginPath(); g.arc(x, cy, 15, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
      else if (mood === 'ouch' || mood === 'out') { g.beginPath(); g.moveTo(x - 14, cy - 12); g.lineTo(x + 10 * s * -1, cy); g.lineTo(x - 14, cy + 12); g.moveTo(x + 14, cy - 12); g.lineTo(x + 14, cy - 12); g.stroke(); g.beginPath(); g.moveTo(x - 13, cy - 13); g.lineTo(x + 13, cy + 13); g.moveTo(x + 13, cy - 13); g.lineTo(x - 13, cy + 13); g.stroke(); }
      else { g.beginPath(); g.ellipse(x, cy, 13, 17, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 4, cy - 6, 5, 0, Math.PI * 2); g.fill(); g.fillStyle = ink; if (mood === 'angry') { g.beginPath(); g.moveTo(x - s * 26, cy - 34); g.lineTo(x + s * 14, cy - 20); g.stroke(); } if (mood === 'weak') { g.beginPath(); g.moveTo(x - s * 22, cy - 22); g.lineTo(x + s * 16, cy - 32); g.stroke(); } }
    }
    g.beginPath();
    if (mood === 'sleep') { g.ellipse(cx, 142, 10, 8, 0, 0, Math.PI * 2); g.fill(); }
    else if (mood === 'angry') { g.moveTo(cx - 30, 150); g.quadraticCurveTo(cx, 132, cx + 30, 150); g.stroke(); }
    else if (mood === 'weak') { g.moveTo(cx - 26, 152); g.quadraticCurveTo(cx - 10, 138, cx, 150); g.quadraticCurveTo(cx + 10, 160, cx + 26, 146); g.stroke(); }
    else { g.ellipse(cx, 146, 18, 24, 0, 0, Math.PI * 2); g.fill(); }
    v.tex.needsUpdate = true;
  }
  function makeHome(e) {
    const side = e.side, g = new THREE.Group(), owner = side === ME ? deal.me.id : deal.rival.id, wall = M(side === ME ? '#F4E9D8' : '#F6E3E3'), roofM = M(col(side), { roughness: 0.7 });
    const house = new THREE.Group(), walls = box(3.4, 2.0, 2.6, wall); walls.position.y = 1.0; house.add(walls);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.75, 1.3, 4, 1), M(col(side), { roughness: 0.7, flatShading: true })); roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.82); roof.position.y = 2.62; house.add(roof);
    const eave = box(3.9, 0.16, 3.0, M('#FFFFFF')); eave.position.y = 2.02; house.add(eave);
    const deck = box(1.9, 0.14, 1.6, M('#B98A56')); deck.position.y = 3.3; house.add(deck); for (const [x, z] of [[-0.9, 0.75], [0.9, 0.75], [-0.9, -0.75], [0.9, -0.75]]) { const p = cyl(0.05, 0.05, 0.45, M('#FFFFFF'), 6); p.position.set(x, 3.55, z); house.add(p); }
    const door = box(0.7, 1.15, 0.08, M('#8A5C3A')); door.position.set(-0.75, 0.58, 1.33); const knob = ball(0.06, M('#FFD23F')); knob.position.set(-0.52, 0.58, 1.39); house.add(door, knob);
    const win = cyl(0.42, 0.42, 0.08, new THREE.MeshStandardMaterial({ color: lin('#FFE9A8'), emissive: lin('#FFC864'), emissiveIntensity: 0.5 }), 20); win.rotation.x = Math.PI / 2; win.position.set(0.75, 1.2, 1.33); const frame = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.06, 6, 20), M('#FFFFFF')); frame.position.set(0.75, 1.2, 1.36); house.add(win, frame);
    const boards = new THREE.Group(); for (const r of [0.5, -0.5]) { const b = box(1.15, 0.16, 0.06, M('#A8825E')); b.rotation.z = r; b.position.set(0.75, 1.2, 1.42); boards.add(b); } boards.visible = false; house.add(boards);
    // its pile of pebbles, up on the deck beside it
    for (const [x, y, z, r] of [[0.62, 3.47, 0.5, 0.17], [0.82, 3.45, 0.38, 0.14], [0.68, 3.44, 0.24, 0.13], [0.74, 3.6, 0.4, 0.13], [-0.7, 3.45, 0.5, 0.14], [-0.82, 3.44, 0.34, 0.12]]) { const p = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), M(r > 0.135 ? '#9AA1B4' : '#B4B9C8', { flatShading: true, roughness: 0.6 })); p.position.set(x, y, z); p.scale.y = 0.75; house.add(p); }
    const chim = box(0.4, 0.9, 0.4, M('#C97B63')); chim.position.set(1.15, 2.7, -0.5); house.add(chim);
    const post = cyl(0.04, 0.04, 0.7, M('#8A5C3A'), 6), mail = box(0.36, 0.22, 0.24, M(col(side))); post.position.set(-2.1, 0.35, 1.2); mail.position.set(-2.1, 0.78, 1.2); const mailbox = new THREE.Group(); mailbox.add(post, mail); g.add(mailbox);
    for (let i = 0; i < 7; i++) { const f = ball(0.11, M(['#FFB3D1', '#FFE27A', '#FFFFFF'][i % 3])); f.position.set(0.2 + i * 0.3, 0.12, 1.7 + (i % 2) * 0.16); g.add(f); }
    // when it's all over for a home: a little tent where the cottage was
    const tent = new THREE.Group(), cone = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.7, 4), M('#E8D2A0')); cone.rotation.y = Math.PI / 4; cone.position.y = 0.85; const flap = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 3), M('#8A5C3A')); flap.position.set(0, 0.55, 0.85); tent.add(cone, flap); tent.visible = false; g.add(tent);
    g.add(house); g.position.set(wx(e.x), 0, wz(e.y)); scene.add(g);
    const t = tmplFor(owner, 'islander', ':home'), bud = budCopy(t, 1.9); bud.root.position.set(0, 3.38, 0); g.add(bud.root); g.scale.setScalar(1.12);
    const H = { e, side, g, house, tent, boards, mailbox, bud, t, owner, shakeT: 0, mood: 'calm', bubble: null, bubbleT: 0, bar: makeBar(2.8, side, true), said: {}, fallen: 0, cheer: 0, name: nameOfBud(owner) || (side === ME ? deal.me.name : deal.rival.name) };
    homes[side] = H; return H;
  }
  const say = (side, key, text, once = true) => { const H = homes[side]; if (!H || (once && H.said[key]) || H.fallen) return; H.said[key] = true; bubble(side, text); };

  /* ---------- buds on the meadow ---------- */
  const views = new Map(), ringGeo = new THREE.RingGeometry(0.78, 1, 28);
  // a little badge over each bud saying what its power is: the power's picture on a disc in its side's color
  const ICON = { pet: '🐾', bit: '👾', sprout: '🌱' }, badges = new Map();
  function badgeFor(kind, side) {
    const key = kind + (side === ME ? ':me' : ':them'); let m = badges.get(key); if (m) return m;
    const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d');
    g.fillStyle = '#FFFFFF'; g.strokeStyle = col(side); g.lineWidth = 9; g.beginPath(); g.arc(48, 48, 40, 0, Math.PI * 2); g.fill(); g.stroke();
    g.font = '50px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#000'; g.fillText(ICON[kind] || ABOUT[kind]?.[0] || '•', 48, 52);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    m = new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }); badges.set(key, m); return m;
  }
  function makeView(e) {
    const K = KINDS[e.kind], v = { e, kind: e.kind, x: e.x, y: e.y, px: e.x, py: e.y, lunge: 0, hurtT: 0, bob: Math.random() * 6, born: now };
    v.root = new THREE.Group(); v.turn = new THREE.Group(); v.squash = new THREE.Group(); v.turn.add(v.squash); v.root.add(v.turn); v.yaw = e.side === ME ? Math.PI : 0; v.turn.rotation.y = v.yaw;   // it starts out facing the other side
    v.w = K.r * 2 * 1.55; v.h = v.w;
    if (e.kind === 'squirrel') { const m = squirrelMesh(); m.scale.setScalar(1.7); v.squash.add(m); v.tail = m.userData.tail; v.h = 1.2; }
    else if (e.kind === 'pet') { const m = petMesh(e.id); m.scale.setScalar(1.6); v.squash.add(m); v.h = 1.1; }
    else if (e.kind === 'sprout') { const m = sproutMesh(); m.scale.setScalar(1.35); v.squash.add(m); v.head = m.userData.head; v.h = 2; }
    else {
      const base = e.kind === 'bit' ? 'glitch' : e.kind, t = tmplFor(e.bud, base), c = budCopy(t, v.w * (e.kind === 'lifter' ? 1.1 : 1));
      v.squash.add(c.squash.children[0]); v.inner = v.squash.children[0]; v.t = t; v.h = c.h;
      if (base === 'gloam') gloamExtras(v); else v.turn.add(propFor(base, v));
    }
    const rg = flat(ringGeo, B(col(e.side), { transparent: true, opacity: 0.9, depthWrite: false }), 0.05); rg.scale.setScalar(K.r * 1.6); v.root.add(rg); v.ring = rg;
    v.bar = makeBar(Math.max(0.9, K.r * 2.4), e.side, false); v.bar.visible = false;
    v.badge = new THREE.Sprite(badgeFor(e.kind, e.side)); v.badge.renderOrder = 14; v.badge.scale.setScalar(K.mini ? 0.55 : 0.8); scene.add(v.badge);
    v.root.position.set(wx(e.x), 0, wz(e.y)); scene.add(v.root); views.set(e.id, v);
    return v;
  }
  function dropView(v) { scene.remove(v.root); scene.remove(v.bar); scene.remove(v.badge); views.delete(v.e.id); }

  /* ---------- things in the air ---------- */
  const shots = [];
  const acornM = M('#C98B45', { roughness: 0.4 }), capM = M('#6B4A2E');
  function missile(kind) {
    if (kind === 'bookworm') return bookMesh(1.2);
    if (kind === 'lobber') { const g = new THREE.Group(); for (let i = 0; i < 5; i++) { const p = ball(0.13, M('#FFF6D8')); p.position.set((i % 3 - 1) * 0.16, (i % 2) * 0.14, (i > 2 ? 0.14 : 0)); g.add(p); } return g; }
    if (kind === 'chef') { const g = new THREE.Group(), bun = ball(0.2, M('#E8B46A')); bun.scale.y = 0.7; g.add(bun); return g; }
    if (kind === 'sprout') return ball(0.13, M('#2B1A10'));
    if (kind === 'pebble') { const g = new THREE.Group(), p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), M(['#9AA1B4', '#8C93A3', '#B4B9C8'][Math.floor(Math.random() * 3)], { flatShading: true, roughness: 0.6 })); p.scale.set(1.15, 0.7, 0.95); g.add(p); return g; }
    const g = new THREE.Group(), nut = ball(0.17, acornM), cap = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), capM); nut.scale.y = 1.2; cap.position.y = 0.08; g.add(nut, cap); return g;
  }
  const topOf = (e) => (e.kind === 'tree' ? 3.6 : e.kind === 'home' ? 4.8 : (views.get(e.id)?.h || 1) * 0.7);
  // what the bud at home throws once it's in the fight: pebbles, from the pile it keeps up on the deck
  const homeThrows = () => 'pebble';
  function fire(from, to, kind, fly, arc = 1.6, size = 1) {
    const m = missile(kind); m.scale.multiplyScalar(size); scene.add(m);
    shots.push({ m, x0: wx(from.x), y0: topOf(from), z0: wz(from.y), to, x1: wx(to.x), y1: 0.5, z1: wz(to.y), t: 0, dur: fly / T, arc, kind });
  }

  /* ---------- the battle ---------- */
  const battle = newBattle(deal.seed, deal.decks), bot = { seed: (deal.seed ^ 0x9e3779b9) >>> 0, think: 2.6, idle: 0.5, skill: 0.7 }, pending = [];
  let now = 0, phase = 'intro', acc = 0, countT = 0, fast = false, lastLeft = null, auto = null;
  const stats = { placed: 0 };
  for (const e of battle.ents) if (e.kind === 'tree') makeTree(e); else if (e.kind === 'home') makeHome(e);
  const entById = (id) => battle.ents.find((e) => e.id === id);

  function onEvent(ev) {
    if (fast) { if (ev.k === 'over' && !net) finish(); return; }
    const src = ev.id ? entById(ev.id) : null, sv = src ? views.get(src.id) : null;
    if (ev.k === 'spawn') { const e = entById(ev.id); if (e) { makeView(e); ring(wx(e.x), wz(e.y), 1.2, col(e.side)); snd('whee', { gain: 0.7 }, 0.12); const h = HELLO[e.kind]; if (h) setTimeout(() => snd(h[0], { gain: h[1] }, 0.1), 850); if (looks[e.bud] && e.kind !== 'bit') setTimeout(() => S.babble('hey', looks[e.bud].name, { gain: 0.7, ...voiceFor(e.bud) }), 950); } }
    else if (ev.k === 'place') { if (ev.side === ME && KINDS[ev.kind].cost >= 5) say(ME, 'big' + battle.tick, 'Go get ’em!', false); }
    else if (ev.k === 'throw') {
      const to = entById(ev.to) || { x: ev.x, y: ev.y, kind: 'spot', id: 0 };
      if (src) { fire(src, to, src.kind === 'home' ? homeThrows(src.side) : src.kind, ev.fly, src.kind === 'lobber' ? 3.2 : src.kind === 'home' ? 2.4 : 1.4, src.kind === 'home' ? 1.9 : 1); if (sv) sv.lunge = 1; if (src.kind === 'tree') { const tv = trees.get(src.id); if (tv) tv.alertT = 2.5; } if (src.kind === 'home') { const H = homes[src.side]; H.cheer = 0.5; H.throwT = 0.3; H.aimX = to.x - src.x; } }
      if (src) { if (src.kind === 'bookworm') snd('flap', { gain: 0.8 }, 0.1); else if (src.kind === 'lobber') snd('thwip', { gain: 0.9 }, 0.1); else if (src.kind === 'home') snd('thwip', { gain: 0.7, rate: 0.75 }, 0.12); else snd('pip', { gain: src.build ? 0.9 : 0.7 }, 0.09); }
    }
    else if (ev.k === 'hit') { const to = entById(ev.to); if (sv) sv.lunge = 1; if (to) { puff(wx(to.x), wz(to.y), 3, '#FFFFFF', topOf(to), 1.5); const k = SMACK[ev.kind] || ['bonk', 0.7, 0.09]; snd(k[0], { gain: k[1], rate: ev.kind === 'lifter' ? 0.6 : ev.kind === 'pet' ? 1.3 : undefined }, k[2]); if (ev.kind === 'lifter') snd('oof', { gain: 0.5 }, 0.6); } if (ev.kind === 'striker' && sv) sv.kick = 1; }
    else if (ev.k === 'boom') { for (let i = 0; i < 3; i++) setTimeout(() => ring(wx(ev.x), wz(ev.y), ev.r, '#FF9F6B', 0.5, 0.5 + i * 0.3), i * 70); if (sv) sv.boom = 1; snd('wub', { gain: 1 }, 0.2); shake = Math.max(shake, 0.12); }
    else if (ev.k === 'pop') { puff(wx(ev.x), wz(ev.y), 14, '#FFF6D8', 0.4, 3); ring(wx(ev.x), wz(ev.y), ev.r, '#FFF6D8', 0.35); snd('crunch', { gain: 1 }, 0.12); }
    else if (ev.k === 'beam') {
      const dx = wx(ev.x1) - wx(ev.x), dz = wz(ev.y1) - wz(ev.y), len = Math.hypot(dx, dz), m = flat(new THREE.PlaneGeometry(len, 1.5), B('#FFE27A', { transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }), 0.6);
      m.rotation.z = -Math.atan2(dz, dx); bit(m, { x: (wx(ev.x) + wx(ev.x1)) / 2, y: 0.6, z: (wz(ev.y) + wz(ev.y1)) / 2, life: 0.45 });
      const core = flat(new THREE.PlaneGeometry(len, 0.5), B('#FFFFFF', { transparent: true, depthWrite: false, side: THREE.DoubleSide }), 0.62); core.rotation.z = m.rotation.z; bit(core, { x: m.position.x, y: 0.62, z: m.position.z, life: 0.3 });
      snd('zap', { gain: 1 }, 0.3); shake = Math.max(shake, 0.2);
    }
    else if (ev.k === 'blink') { for (const [c, k] of [['#35E0E0', 0.33], ['#FF4FD8', 0.66]]) { const m = box(0.5, 0.7, 0.1, B(c, { transparent: true, opacity: 0.6, depthWrite: false })); bit(m, { x: wx(ev.x0 + (ev.x - ev.x0) * k), y: 0.5, z: wz(ev.y0 + (ev.y - ev.y0) * k), life: 0.3 }); } if (sv) { sv.px = ev.x; sv.py = ev.y; sv.x = ev.x; sv.y = ev.y; } snd('glitchy', { gain: 0.7, rate: 1.5 }, 0.15); }
    else if (ev.k === 'split') { for (let i = 0; i < 12; i++) { const m = box(0.16, 0.16, 0.16, B(i % 2 ? '#35E0E0' : '#FF4FD8', { transparent: true })); const a = Math.random() * 6.283; bit(m, { x: wx(ev.x), y: 0.6, z: wz(ev.y), vx: Math.cos(a) * 3, vz: Math.sin(a) * 3, vy: 3, g: 9, life: 0.5 }); } words('GLITCH!', wx(ev.x), 2, wz(ev.y), '#7BE0D2', 0.8); S.play('glitchy', { gain: 1, rate: 0.7 }); setTimeout(() => S.play('glitchy', { gain: 0.9, rate: 1.6 }), 160); }
    else if (ev.k === 'heal') { const to = entById(ev.to); if (src && to) { fire(src, to, 'chef', 6, 1.2); setTimeout(() => words('+', wx(to.x), topOf(to) + 0.8, wz(to.y), '#7BE08A', 0.9), 300); } snd('yum', { gain: 0.8 }, 0.25); }
    else if (ev.k === 'steal') { if (src) words(ev.n ? '−1 Glow!' : 'nibble!', wx(src.x), 2.2, wz(src.y), '#F4B400', 0.9); S.play('squeak', { gain: 1 }); if (ev.n) setTimeout(() => S.play('coin', { gain: 1 }), 120); if (ev.side === THEM) say(ME, 'steal' + battle.tick, 'My Glow!', false); }
    else if (ev.k === 'wake') { const H = homes[ev.side]; if (H) { say(ev.side, 'wake', ev.why === 'tree' ? 'That’s IT!' : 'Not the house!'); ring(H.g.position.x, H.g.position.z, ROYAL.HOME.range, col(ev.side), 1.1); S.play('gasp', { gain: 1 }); setTimeout(() => S.play('alert', { gain: 0.6 }), 220); banner(ev.side === ME ? 'Your bud starts throwing pebbles!' : `${H.name} starts throwing pebbles!`, 1.8); } }
    else if (ev.k === 'down') {
      if (ev.kind === 'tree') {
        const tv = [...trees.values()].find((t) => t.e.id === ev.id); if (tv) tv.down = 0.001;
        leaves(wx(ev.x), wz(ev.y), 40); shake = 0.6; S.play('timber', { gain: 1 }); setTimeout(() => S.play(ev.side === ME ? 'womp' : 'fanfare', { gain: 0.45 }), 900);
        banner(ev.side === ME ? 'Your tree fell!' : 'Their tree is down!', 1.8); say(1 - ev.side, 'felled' + ev.id, 'YES!', false); say(ev.side, 'lost' + ev.id, 'NOOO!', false);
      } else if (ev.kind === 'home') { const H = homes[ev.side]; H.fallen = 0.001; puff(H.g.position.x, H.g.position.z, 30, '#FFFFFF', 1.5, 5); shake = 0.9; S.play('crumble', { gain: 1.1 }); }
      else { const v = views.get(ev.id); if (v) { puff(wx(ev.x), wz(ev.y), ev.kind === 'sprout' ? 5 : 8, ev.kind === 'bit' ? '#7BE0D2' : '#FFFFFF'); v.dead = 0.001; } snd(ev.kind === 'pet' ? 'yip' : ev.kind === 'squirrel' ? 'squeak' : ev.kind === 'bit' || ev.kind === 'glitch' ? 'glitchy' : 'plop', { gain: 0.6, rate: 0.7 }, 0.08); }
    }
    else if (ev.k === 'gift') { if (ev.n > 0) gift(ev); }
    else if (ev.k === 'sudden') { banner('Sudden death! First tree to fall wins', 2.4); S.play('drumroll', { gain: 1 }); }
    else if (ev.k === 'over') { if (!net) finish(); }   // against a friend it waits a moment first (see netFrame)
  }
  function tick() {
    const cmds = []; for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= battle.tick) cmds.push(pending.splice(i, 1)[0].c);
    for (const v of views.values()) { v.px = v.x; v.py = v.y; }
    const hp = new Map(); for (const e of battle.ents) hp.set(e.id, e.hp);
    step(battle, cmds);
    for (const ev of battle.ev) onEvent(ev); battle.ev.length = 0;
    for (const e of battle.ents) {
      const v = views.get(e.id); if (v) { v.x = e.x; v.y = e.y; if (e.hp < (hp.get(e.id) ?? e.hp) - 0.5) v.hurtT = 0.25; }
      if (e.build && e.hp < (hp.get(e.id) ?? e.hp)) {
        if (e.kind === 'tree') { const tv = trees.get(e.id); tv.hitT = 0.35; tv.alertT = 3; if (!fast) snd('bonk', { gain: 0.5, rate: 0.5 }, 0.25); say(e.side, 'tree' + e.id, e.side === ME ? 'Hey! My tree!' : 'Leave my tree alone!'); if (e.hp < e.max * 0.4) say(e.side, 'treelow' + e.id, 'Hang in there, tree!'); }
        else { const H = homes[e.side]; H.shakeT = 0.3; if (!fast) snd('kick', { gain: 0.8, rate: 0.7 }, 0.25); if (e.hp < e.max * 0.35) { say(e.side, 'low', 'Help!!'); H.boards.visible = true; } else if (e.hp < e.max * 0.7) say(e.side, 'mid', 'My poor house!'); }
      }
    }
    if (net) netTick(); else { const c = botMove(battle, THEM, bot); if (c) pending.push({ at: battle.tick + ROYAL.LAND_TICKS, c }); }
    if (auto && !fast) { const m = botMove(battle, ME, auto); if (m && !busy(m.slot)) issue(m.slot, m.x, m.y); }
    if (!fast) hud();
  }

  /* ---------- against a friend: two phones, one battle ---------- */
  // Each phone runs the whole battle itself and only tells the other where it put its buds, stamped with the tick
  // they land on (half a second ahead). If one arrives after that tick has already been played here, the battle
  // is wound back to a copy kept from just before and played forward again with it in, so both phones end up
  // with the same battle. Every 5 seconds they compare a fingerprint to make sure.
  const log = [], mine = [], snaps = new Map(), prints = new Map(), peerPrints = new Map();
  let got = 0, outOfSync = false, overAt = 0, lastCount = 0, goneFor = 0;
  const b36 = (n, w) => Math.max(0, Math.round(n)).toString(36).padStart(w, '0').slice(-w);
  // what's sent: how many placements so far (2 characters) and the last four, 8 characters each: tick, slot, x, y
  const encode = () => b36(mine.length, 2) + mine.slice(-4).map((m) => b36(m.at, 3) + m.c.slot + b36(m.c.x * 10, 2) + b36(m.c.y * 10, 2)).join('');
  function decode(str) {
    const count = parseInt(str.slice(0, 2), 36) || 0, cmds = [];
    for (let i = 2; i + 8 <= str.length; i += 8) cmds.push({ at: parseInt(str.slice(i, i + 3), 36), c: { side: THEM, slot: +str[i + 3], x: parseInt(str.slice(i + 4, i + 6), 36) / 10, y: parseInt(str.slice(i + 6, i + 8), 36) / 10 } });
    return { count, cmds };
  }
  function issue(slot, x, y) {
    const c = { side: ME, slot, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }, m = { at: battle.tick + ROYAL.LAND_TICKS, c };
    pending.push(m); if (net) { log.push(m); mine.push(m); net.send(encode()); }
  }
  function outOfStep(why) { if (outOfSync) return; outOfSync = true; console.warn('bud royal out of step:', why); hint.textContent = 'The two phones disagree about this match. The result may not count.'; }
  function onPeer(str) {
    if (phase === 'over') return;
    const { count, cmds } = decode(String(str || '')), fresh = count - got; if (fresh <= 0) return;
    if (fresh > cmds.length) outOfStep('missed a placement');
    got = count; let back = Infinity;
    for (const m of cmds.slice(-Math.min(fresh, cmds.length))) { log.push(m); if (m.at >= battle.tick) pending.push(m); else back = Math.min(back, m.at); }
    if (back < Infinity) rewind(back);
  }
  // put the views back in touch with the battle after it's been swapped for a copy or played forward unseen
  function resync() {
    S0 = battle.sides[ME];
    for (const H of homes) H.e = homeOf(battle, H.side);
    for (const v of trees.values()) { v.e = entById(v.e.id); if (v.e.hp <= 0 && !v.down) v.down = 1; if (v.e.hp > 0 && v.down) { v.down = 0; v.g.rotation.z = 0; v.g.position.y = 0; v.bar.visible = true; } }
    for (const v of [...views.values()]) { const e = entById(v.e.id); if (!e || e.hp <= 0) dropView(v); else { v.e = e; v.x = v.px = e.x; v.y = v.py = e.y; v.dead = 0; } }
    for (const e of battle.ents) if (e.hp > 0 && !e.build && !views.has(e.id)) makeView(e);
    hud();
  }
  function rewind(at) {
    const k = Math.floor(at / 20) * 20, snap = snaps.get(k), target = battle.tick; if (!snap) return outOfStep('no copy to go back to');
    for (const key of Object.keys(battle)) delete battle[key]; Object.assign(battle, structuredClone(snap));
    for (const key of [...snaps.keys()]) if (key > k) snaps.delete(key);
    pending.length = 0; for (const m of log) if (m.at >= k) pending.push(m);
    fast = true; while (battle.tick < target && !battle.over) tick(); fast = false; resync();
  }
  function netTick() {
    const t = battle.tick;
    if (t % 20 === 0) snaps.set(t, structuredClone(battle));
    if (t % 100 === 0) prints.set(t, fingerprint(battle));
    if (t % 100 === 60 && !fast) { const t0 = t - 60, mineIs = prints.get(t0); net.print(t0 * 4294967296 + mineIs); const theirs = peerPrints.get(t0); if (theirs != null && theirs !== mineIs) outOfStep(`fingerprints differ at tick ${t0}`); }
  }
  if (net) {
    snaps.set(0, structuredClone(battle));
    net.onPeer(onPeer);
    net.onPeerPrint((num) => { const t0 = Math.floor(num / 4294967296), h = num - t0 * 4294967296; peerPrints.set(t0, h); if (battle.tick >= t0 + 60 && prints.has(t0) && prints.get(t0) !== h) outOfStep(`fingerprints differ at tick ${t0}`); });
  }
  // the clock both phones share decides which tick it is
  function netFrame(dt) {
    if (phase === 'over') return;
    const startAt = net.startAt();
    if (!startAt) { phase = 'wait'; if (bannerT <= 0.2) banner(`Waiting for ${homes[THEM].name}…`, 1.2); return; }
    const since = (net.now() - startAt) / 1000;
    if (since < 0) { phase = 'count'; const n = Math.ceil(-since); if (n !== lastCount && n <= 3) { lastCount = n; banner(String(n), 0.8); S.play('bkick', { gain: 1 }); S.play('boop', { gain: 0.6, rate: 0.8 }); } return; }
    if (phase !== 'play') { phase = 'play'; banner('Go!', 0.9); S.play('drumroll', { gain: 0.8 }); beatT = 0; beatN = 0; }
    beat(dt);
    const want = since * T, target = Math.floor(want), behind = target - battle.tick;
    if (behind > 40) { fast = true; let n = 0; while (battle.tick < target && n++ < 600 && !battle.over) tick(); fast = false; resync(); }
    else { let n = 0; while (battle.tick < target && n++ < 8 && !battle.over) tick(); }
    acc = clamp(want - battle.tick, 0, 1);
    // the other phone has gone quiet
    const age = net.peerAge();
    if (age > 6000 && !battle.over) { goneFor = age; if (bannerT <= 0.2) banner(`Waiting for ${homes[THEM].name} to come back… ${Math.max(0, Math.ceil((15000 - age) / 1000))}`, 1.2); if (age > 15000) { battle.over = true; battle.winner = ME; battle.why = 'left'; overAt = 0; } }
    // it's over once it's stayed over for a moment (a late placement could still change the last second)
    if (battle.over) { if (!overAt) overAt = now + (battle.why === 'left' ? 0 : 1.3); if (now >= overAt) finish(); } else overAt = 0;
  }

  /* ---------- your hand ---------- */
  const handEl = $('hand'), cardEls = []; let S0 = battle.sides[ME];
  // Glow you can still spend: what you have, less what's already on its way down
  const spare = () => S0.glow - pending.reduce((a, p) => a + (p.c.side === ME ? KINDS[S0.deck[S0.hand[p.c.slot]].kind].cost : 0), 0);
  const busy = (slot) => pending.some((p) => p.c.side === ME && p.c.slot === slot);
  function cardFace(c, card) {
    const K = KINDS[card.kind], about = ABOUT[card.kind]; c.dataset.card = card.id + ':' + card.kind; c.textContent = '';
    const pic = el('canvas', 'pic'), cost = el('span', 'cost', String(K.cost)), short = K.name.replace(' Lobber', '').replace('Button ', ''), nm = el('b', null, nameOfBud(card.id) || short), pw = el('small', null, short), badge = el('span', 'badge', about[0]);
    c.append(cost, badge, pic, nm, pw);
    if (card.kind === 'squirrel' || card.kind === 'gloam' || !looks[card.id]) { const g = pic.getContext('2d'); pic.width = pic.height = 120; g.font = '76px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(about[0], 60, 66); }
    else drawBud(pic, looks[card.id], { size: 60 });
  }
  for (let i = 0; i < ROYAL.HAND; i++) { const c = el('button', 'card'); c.type = 'button'; c.dataset.slot = i; handEl.append(c); cardEls.push(c); }
  const nextEl = $('next'), glowFill = $('glowFill'), glowNum = $('glowNum'), hint = $('hint'), clockEl = $('clock');
  let shown = [], shownNext = null, selected = null;
  function hud() {
    S0.hand.forEach((idx, i) => { const card = S0.deck[idx], key = card.id + ':' + card.kind, c = cardEls[i]; if (shown[i] !== key) { shown[i] = key; cardFace(c, card); c.classList.remove('in'); void c.offsetWidth; c.classList.add('in'); } c.classList.toggle('poor', KINDS[card.kind].cost > spare() || busy(i)); c.classList.toggle('sel', selected === i); });
    const nx = S0.deck[S0.queue[0]], nk = nx.id + ':' + nx.kind; if (shownNext !== nk) { shownNext = nk; nextEl.textContent = `${ABOUT[nx.kind][0]}`; nextEl.title = `Next: ${KINDS[nx.kind].name}`; }
    const per = Math.round(ROYAL.GLOW_S * T / (doubled(battle) ? 2 : 1)), g = S0.glow + (S0.glow < ROYAL.GLOW_MAX ? S0.part / per : 0);
    glowFill.style.width = `${g / ROYAL.GLOW_MAX * 100}%`; glowNum.textContent = String(S0.glow);
    const left = Math.ceil(timeLeft(battle)); if (left !== lastLeft) { lastLeft = left; clockEl.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; clockEl.classList.toggle('hot', doubled(battle)); if (left === ROYAL.DOUBLE_S && !battle.sudden && phase === 'play') { banner('Double Glow! ✨', 1.8); S.play('drumroll', { gain: 0.9 }); setTimeout(() => S.play('sparkle', { gain: 0.8 }), 600); } if (left <= 10 && left > 0 && phase === 'play') S.play('tick', { gain: 0.4 }); }
    $('x2').hidden = !doubled(battle);
  }
  let bannerT = 0; const bannerEl = $('banner');
  function banner(text, secs = 1.6) { bannerEl.textContent = text; bannerEl.hidden = false; bannerEl.classList.remove('pop'); void bannerEl.offsetWidth; bannerEl.classList.add('pop'); bannerT = secs; }

  // dragging a card onto the meadow
  const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ghost = new THREE.Group();
  const gRing = flat(new THREE.RingGeometry(0.86, 1, 40), B('#FFFFFF', { transparent: true, depthWrite: false }), 0.08), gReach = flat(new THREE.RingGeometry(0.97, 1, 64), B('#FFFFFF', { transparent: true, opacity: 0.7, depthWrite: false }), 0.07), gDisc = flat(new THREE.CircleGeometry(1, 40), B('#FFFFFF', { transparent: true, opacity: 0.25, depthWrite: false }), 0.06);
  ghost.add(gRing, gReach, gDisc); ghost.visible = false; scene.add(ghost);
  const noGo = []; for (let i = 0; i < 4; i++) { const m = flat(new THREE.PlaneGeometry(1, 1), B('#F0607A', { transparent: true, opacity: 0.22, depthWrite: false }), 0.04); m.visible = false; scene.add(m); noGo.push(m); }
  function showNoGo(on) {
    noGo.forEach((m) => { m.visible = false; }); if (!on) return;
    [0, 1].forEach((lane) => {
      const t = treeOf(battle, THEM, lane), open = !t || t.hp <= 0, x0 = lane ? ROYAL.W / 2 : 0, rects = (open ? [[ROYAL.RIVER0 - 0.3, ROYAL.RIVER1 + 0.3], [ROYAL.DEEP, ROYAL.L]] : [[ROYAL.RIVER0 - 0.3, ROYAL.L]]).map(([a, b]) => (flip ? [ROYAL.L - b, ROYAL.L - a] : [a, b]));
      rects.forEach(([y0, y1], i) => { const m = noGo[lane * 2 + i]; m.visible = true; m.scale.set(ROYAL.W / 2, y1 - y0, 1); m.position.set(wx(x0 + ROYAL.W / 4), 0.04, wz((y0 + y1) / 2)); });
    });
  }
  let drag = null;
  function spot(ev) {
    const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector2((ev.clientX - r.left) / r.width * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    if (ev.clientY > r.bottom || ev.clientY < r.top) return null;
    ray.setFromCamera(v, camera); const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(ground, p)) return null;
    return { x: clamp(flip ? ROYAL.W / 2 - p.x : p.x + ROYAL.W / 2, 0.6, ROYAL.W - 0.6), y: clamp(flip ? p.z + ROYAL.L / 2 : ROYAL.L / 2 - p.z, 0.6, ROYAL.L - 0.6) };
  }
  function aim(ev) {
    if (drag == null) return; const p = spot(ev), card = S0.deck[S0.hand[drag.slot]], K = KINDS[card.kind], U = KINDS[K.brings || card.kind];
    drag.at = p; ghost.visible = !!p; if (drag.chip) { drag.chip.style.left = ev.clientX + 'px'; drag.chip.style.top = ev.clientY + 'px'; drag.chip.hidden = !!p; }
    if (!p) return;
    const ok = canPlace(battle, ME, p.x, p.y) && K.cost <= spare(); drag.ok = ok;
    ghost.position.set(wx(p.x), 0, wz(p.y)); const c = lin(ok ? '#FFFFFF' : '#F0607A'); gRing.material.color.copy(c); gDisc.material.color.copy(c); gReach.material.color.copy(c);
    gRing.scale.setScalar(U.r * 1.4); gDisc.scale.setScalar(U.r * 1.4); const reach = U.aura || (U.range > 1.2 ? U.range : 0); gReach.visible = reach > 0; gReach.scale.setScalar(reach || 1);
  }
  function pick(slot, ev) {
    if (phase !== 'play' || busy(slot)) return; selected = slot; const card = S0.deck[S0.hand[slot]], K = KINDS[card.kind];
    hint.textContent = `${ABOUT[card.kind][0]} ${K.name}: ${ABOUT[card.kind][1]}`; showNoGo(true); S.play('boop', { gain: 0.7, rate: 0.9 + slot * 0.12 });
    drag = { slot, at: null, ok: false, chip: $('chip') }; drag.chip.textContent = ABOUT[card.kind][0]; if (ev) aim(ev); hud();
  }
  function drop(ev) {
    if (drag == null) return; if (ev) aim(ev);
    const d = drag;
    if (d.at && d.ok) { issue(d.slot, d.at.x, d.at.y); stats.placed++; S.play('thwip', { gain: 0.8 }); selected = null; hint.textContent = ''; endDrag(); }
    else if (d.at && !d.ok) { S.play('boing', { gain: 0.3, rate: 0.7 }); hint.textContent = KINDS[S0.deck[S0.hand[d.slot]].kind].cost > spare() ? 'Not enough Glow yet.' : 'You can only place buds on your own side.'; ghost.visible = false; d.chip.hidden = true; d.at = null; }
    else { ghost.visible = false; d.chip.hidden = true; }   // let go over the cards: it stays picked, tap the meadow to place it
    hud();
  }
  function endDrag() { drag = null; ghost.visible = false; $('chip').hidden = true; showNoGo(false); }
  cardEls.forEach((c, i) => c.addEventListener('pointerdown', (ev) => { ev.preventDefault(); pick(i, ev); }));
  addEventListener('pointermove', (ev) => { if (drag) aim(ev); });
  addEventListener('pointerup', (ev) => { if (drag && ev.target.closest && !ev.target.closest('.card')) drop(ev); else if (drag) { ghost.visible = false; drag.chip.hidden = true; } });
  renderer.domElement.addEventListener('pointerdown', (ev) => { if (selected != null && phase === 'play') { if (!drag) pick(selected, ev); else aim(ev); } });
  addEventListener('keydown', (ev) => { if (ev.key >= '1' && ev.key <= '4') pick(+ev.key - 1); if (ev.key === 'Escape') { selected = null; endDrag(); hud(); } });

  /* ---------- start and finish ---------- */
  function finish() {
    phase = 'over'; endDrag(); const won = battle.winner === ME, draw = battle.winner == null;
    if (net) { fetch('/api/game', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'royal-result', id: net.id, winner: battle.winner, why: battle.why, tick: battle.tick, print: fingerprint(battle) }) }).catch(() => {}); setTimeout(() => net.leave(), 4000); }
    for (const H of homes) { const mine = H.side === battle.winner; H.t.happy = mine; H.t.mood = mine || draw ? null : 'dizzy'; H.said = {}; }
    if (!draw) { say(battle.winner, 'end', 'WE DID IT!', false); if (!homes[1 - battle.winner].fallen) say(1 - battle.winner, 'end', 'Good game…', false); }
    setTimeout(() => S.play(draw ? 'chime' : won ? 'fanfare' : 'womp', { gain: 1 }), battle.why === 'home' ? 700 : 100); if (won) setTimeout(() => S.play('sparkle', { gain: 0.9 }), 1500);
    const why = { home: won ? 'You reached their home!' : 'They reached your home.', trees: won ? 'You felled more trees.' : 'They felled more trees.', sudden: won ? 'First tree in sudden death!' : 'They got the first tree in sudden death.', health: won ? 'Your side was in better shape.' : draw ? 'Dead level.' : 'Their side was in better shape.', left: `${homes[THEM].name} left the match.` }[battle.why];
    setTimeout(() => {
      $('endTitle').textContent = draw ? 'A draw!' : won ? 'You won! 🎉' : `${homes[THEM].name} won`;
      $('endWhy').textContent = `${why} Trees felled: you ${battle.sides[ME].felled}, them ${battle.sides[THEM].felled}.`;
      $('end').hidden = false;
    }, fast ? 0 : 2600);
  }
  function start() { $('intro').hidden = true; phase = 'count'; countT = 3; S.play('click'); try { S.unlock && S.unlock(); } catch (e) {} }
  $('go').addEventListener('click', start);
  $('again').addEventListener('click', () => { if (net) location.href = '/royal'; else location.reload(); });
  $('introVs').textContent = `Your home against ${homes[THEM].name}’s`;
  hud(); fit();

  // A fallen tree's last gift: drops of Glow fly out of it, into your Glow bar (or up to the other side's home)
  function gift(ev) {
    const r = renderer.domElement.getBoundingClientRect(), at = (x, y, z) => { const p = new THREE.Vector3(x, y, z).project(camera); return [r.left + (p.x + 1) / 2 * r.width, r.top + (1 - p.y) / 2 * r.height]; };
    const [x0, y0] = at(wx(ev.x), 2.5, wz(ev.y)), mine = ev.side === ME, bar = glowNum.getBoundingClientRect(), H = homes[ev.side];
    const [x1, y1] = mine ? [bar.left + bar.width / 2, bar.top + bar.height / 2] : at(H.g.position.x, 5, H.g.position.z);
    words(`+${ev.n} Glow`, wx(ev.x), 4.6, wz(ev.y), '#FFD23F', 1.1);
    for (let i = 0; i < ev.n; i++) {
      const d = el('i', 'drop'); d.style.left = `${x0}px`; d.style.top = `${y0}px`; document.body.append(d);
      const sx = (Math.random() - 0.5) * 90, sy = -40 - Math.random() * 50, wait = 350 + i * 170;
      d.animate([{ transform: 'translate(-50%, -50%) scale(.3)', opacity: 0 }, { transform: `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px)) scale(1.15)`, opacity: 1, offset: 0.3 }, { transform: `translate(calc(-50% + ${x1 - x0}px), calc(-50% + ${y1 - y0}px)) scale(.75)`, opacity: 1 }], { duration: 850, delay: wait, easing: 'cubic-bezier(.5, 0, .3, 1)', fill: 'both' })
        .finished.then(() => { d.remove(); S.play('coin', { gain: 0.7, rate: 1 + i * 0.12 }); if (mine) { glowNum.classList.remove('bump'); void glowNum.offsetWidth; glowNum.classList.add('bump'); } }).catch(() => d.remove());
    }
    if (mine) setTimeout(() => say(ME, 'gift' + battle.tick, 'Thank you, tree!', false), 1500);
  }

  /* ---------- the battle's little band ---------- */
  // A loop in A minor that the frame clock steps through: kick, hat, a bass line, and a plucked tune that joins
  // once buds are on the meadow. It speeds up when Glow doubles and again in sudden death.
  let beatT = 0, beatN = 0;
  const semi = (n) => Math.pow(2, n / 12), BARS = [[0, [0, 3, 7, 12]], [-4, [-4, 0, 3, 8]], [3, [3, 7, 10, 15]], [-2, [-2, 2, 5, 10]]];
  const BASS = { 0: 0, 3: 0, 6: 12, 8: 0, 11: 7, 14: 12 }, TUNE = { 0: 0, 3: 2, 6: 1, 8: 3, 11: 2, 14: 1 };
  function beat(dt) {
    const hot = doubled(battle), bpm = battle.sudden ? 150 : hot ? 136 : 112, stepS = 60 / bpm / 4;
    beatT += dt; if (beatT > 0.5) beatT = stepS;
    while (beatT >= stepS) {
      beatT -= stepS; const i = beatN % 16, [root, chord] = BARS[Math.floor(beatN / 16) % 4]; beatN++;
      const busy = views.size >= 2;
      if (i % 8 === 0 || (hot && i === 10)) S.play('bkick', { gain: 0.55, rate: 1 });
      if (i % 4 === 2 || (hot && i % 2 === 0)) S.play('bhat', { gain: i % 4 === 2 ? 0.8 : 0.4, rate: 1 });
      if (i in BASS) S.play('bbass', { gain: 0.6, rate: semi(root + BASS[i]) });
      if (busy && i in TUNE) S.play('bpluck', { gain: 0.6, rate: semi(chord[TUNE[i]]) });
    }
  }

  /* ---------- every frame ---------- */
  let last = performance.now();
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.12, (t - last) / 1000); last = t; now += dt;
    if (net) netFrame(dt);
    else if (phase === 'count') { const before = Math.ceil(countT); countT -= dt; const n = Math.ceil(countT); if (n !== before && n > 0) { banner(String(n), 0.8); S.play('bkick', { gain: 1 }); S.play('boop', { gain: 0.6, rate: 0.8 }); } if (before === 3 && bannerT <= 0) banner('3', 0.8); if (countT <= 0) { phase = 'play'; banner('Go!', 0.9); S.play('drumroll', { gain: 0.8 }); beatT = 0; beatN = 0; } }
    if (phase === 'play' && !net) { beat(dt); acc += dt * T; let n = 0; while (acc >= 1 && n++ < 6 && !battle.over) { acc -= 1; tick(); } if (acc > 4) acc = 0; }
    const a = phase === 'play' ? clamp(acc, 0, 1) : 1;
    if (bannerT > 0 && (bannerT -= dt) <= 0) bannerEl.hidden = true;
    // buds
    for (const v of [...views.values()]) {
      const e = v.e, K = KINDS[e.kind];
      if (v.dead) { v.badge.visible = false; v.dead += dt; v.squash.scale.set(1 + v.dead * 2, Math.max(0.01, 1 - v.dead * 5), 1 + v.dead * 2); v.bar.visible = false; if (v.dead > 0.2) dropView(v); continue; }
      if (e.hp <= 0 || !battle.ents.includes(e)) { dropView(v); continue; }
      const x = v.px + (v.x - v.px) * a, y = v.py + (v.y - v.py) * a, moving = Math.hypot(v.x - v.px, v.y - v.py) > 0.004, arriving = e.wait > 0;
      v.lunge = Math.max(0, v.lunge - dt * 5); v.hurtT = Math.max(0, v.hurtT - dt); v.boom = Math.max(0, (v.boom || 0) - dt * 3); v.kick = Math.max(0, (v.kick || 0) - dt * 4);
      const hop = arriving ? 0 : moving ? Math.abs(Math.sin(now * (K.speed > 2.2 ? 16 : 10) + v.bob)) * 0.16 * Math.min(1.5, K.speed) : 0, f = e.side === ME ? -1 : 1;
      const arrive = arriving ? clamp(1 - e.wait / (ROYAL.ARRIVE_S * T), 0, 1) : 1, drop = arriving ? (1 - arrive) * (1 - arrive) * 5 : 0;
      v.root.position.set(wx(x), hop + drop, wz(y));
      // it faces the way it's going, and whoever it's fighting when it stops
      { let want = v.yaw; const mx = v.x - v.px, my = v.y - v.py, tg = !moving && e.tgt ? entById(e.tgt) : null;
        const fs = flip ? -1 : 1; if (moving) want = Math.atan2(mx * fs, -my * fs); else if (tg) want = Math.atan2((tg.x - e.x) * fs, -(tg.y - e.y) * fs);
        let turn = want - v.yaw; while (turn > Math.PI) turn -= Math.PI * 2; while (turn < -Math.PI) turn += Math.PI * 2;
        v.yaw += turn * Math.min(1, dt * 9); v.turn.rotation.y = v.yaw; v.squash.position.z = v.lunge * 0.4; }
      const sq = 1 - v.hurtT * 1.2 + v.boom * 0.25 + (arriving && arrive > 0.9 ? -0.25 : 0);
      v.squash.scale.set((2 - sq) * (arriving ? 0.5 + arrive * 0.5 : 1), sq * (arriving ? 0.5 + arrive * 0.5 : 1), arriving ? 0.5 + arrive * 0.5 : 1);
      v.squash.rotation.x = (moving && !arriving ? 0.13 : 0) + v.lunge * 0.3;
      v.ring.material.opacity = arriving ? 0.35 : 0.9; v.ring.position.y = 0.05 - hop - drop;
      if (v.t) face(v.t, now);
      if (v.ghosts) v.ghosts.forEach((g, i) => { g.visible = Math.sin(now * 23 + i * 2 + v.bob) > 0.2; g.position.x = v.inner.position.x + (i ? 0.09 : -0.09) * (1 + Math.sin(now * 31 + i)); });
      if (v.tail) v.tail.rotation.x = Math.sin(now * 14) * 0.3;
      if (v.head) v.head.scale.setScalar(1 + v.lunge * 0.25 + Math.sin(now * 3 + v.bob) * 0.03);
      if (v.lift) v.lift.position.y = Math.sin(now * 4 + v.bob) * 0.06 + v.lunge * -0.3;
      if (v.ball) v.ball.position.z = v.w * 0.6 + v.kick * 0.8;
      if (v.lamp) v.lamp.rotation.z = Math.sin(now * 2 + v.bob) * 0.2;
      if (v.speaker) v.speaker.scale.setScalar(1 + v.boom * 0.4);
      v.badge.position.set(wx(x), v.h + 0.62 + hop + drop, wz(y)); v.badge.visible = !arriving || arrive > 0.5;
      const hurt = e.hp < e.max - 1; v.bar.visible = hurt && !arriving; if (hurt) { setBar(v.bar, clamp(e.hp / e.max, 0, 1)); v.bar.position.set(wx(x), v.h + 1.3 + hop, wz(y)); v.bar.quaternion.copy(camera.quaternion); }
    }
    // things in the air
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i]; s.t += dt; const k = Math.min(1, s.t / s.dur), to = s.to && s.to.id ? entById(s.to.id) : null;
      if (to && to.hp > 0) { s.x1 = wx(to.x); s.z1 = wz(to.y); s.y1 = topOf(to) * 0.8; }
      s.m.position.set(s.x0 + (s.x1 - s.x0) * k, s.y0 + (s.y1 - s.y0) * k + Math.sin(k * Math.PI) * s.arc, s.z0 + (s.z1 - s.z0) * k); s.m.rotation.x += dt * 12; s.m.rotation.z += dt * 7;
      if (k >= 1) { scene.remove(s.m); shots.splice(i, 1); if (s.kind === 'pebble') { puff(s.x1, s.z1, 4, '#C9CEDA', s.y1, 1.8); snd('bonk', { gain: 0.6, rate: 1.5 }, 0.1); } else if (s.kind !== 'lobber' && s.kind !== 'chef') puff(s.x1, s.z1, 3, '#FFFFFF', s.y1, 1.4); }
    }
    // trees
    for (const v of trees.values()) {
      const e = v.e; v.hitT = Math.max(0, v.hitT - dt); v.alertT = Math.max(0, v.alertT - dt); treeFace(v, now);
      if (v.down) { v.down = Math.min(1, v.down + dt * 1.6); const k = v.down * v.down; v.g.rotation.z = (wx(e.x) < 0 ? 1 : -1) * k * 1.45; v.g.position.y = -k * 0.3; v.bar.visible = false; }
      else { v.crown.rotation.z = Math.sin(now * 1.1 + e.id) * 0.03 + v.hitT * Math.sin(now * 50) * 0.25; v.crown.scale.setScalar(1 + v.hitT * 0.15); setBar(v.bar, clamp(e.hp / e.max, 0, 1)); v.bar.position.set(v.g.position.x, 0.4, v.g.position.z + 1.5); v.bar.quaternion.copy(camera.quaternion); }
    }
    // homes: the bud who lives there is watching all this
    for (const H of homes) {
      const e = H.e, Sd = battle.sides[H.side], k = e.hp / e.max, over = phase === 'over';
      H.shakeT = Math.max(0, H.shakeT - dt); H.cheer = Math.max(0, H.cheer - dt);
      const mood = over ? (battle.winner === H.side ? 'win' : battle.winner == null ? 'calm' : 'lose') : k < 0.35 ? 'panic' : Sd.awake ? 'fight' : [...trees.values()].some((t) => t.e.side === H.side && t.alertT > 0 && !t.down) ? 'worry' : 'calm';
      H.mood = mood;
      if (!over) { H.t.happy = false; H.t.mood = mood === 'fight' ? 'angry' : mood === 'panic' ? 'dizzy' : null; H.t.sleepy = false; }
      face(H.t, now);
      const b = H.bud.root, jump = mood === 'win' ? Math.abs(Math.sin(now * 7)) * 0.7 : mood === 'fight' ? Math.abs(Math.sin(now * 9)) * 0.22 + H.cheer * 0.5 : mood === 'panic' ? Math.abs(Math.sin(now * 16)) * 0.12 : mood === 'worry' ? Math.abs(Math.sin(now * 5)) * 0.08 : Math.sin(now * 1.6) * 0.03 + 0.03;
      if (H.fallen) { H.fallen = Math.min(1, H.fallen + dt * 1.4); const f = H.fallen; H.house.scale.set(1 + f * 0.3, Math.max(0.01, 1 - f * 1.2), 1 + f * 0.3); H.house.visible = f < 0.8; H.tent.visible = f > 0.5; H.tent.scale.setScalar(clamp((f - 0.5) * 2, 0.01, 1)); b.position.set(1.9, Math.max(0, 3.38 * (1 - f * 1.4)), 1.2); b.rotation.z = Math.sin(now * 2) * 0.05; H.bar.visible = false; H.mailbox.rotation.z = 1.2 * f; }
      else {
        b.position.set(mood === 'panic' ? Math.sin(now * 9) * 0.35 : mood === 'worry' ? Math.sin(now * 2.2) * 0.25 : 0, 3.38 + jump, 0); H.throwT = Math.max(0, (H.throwT || 0) - dt); b.rotation.z = mood === 'win' ? Math.sin(now * 7) * 0.25 : mood === 'fight' ? Math.sin(now * 9) * 0.1 - clamp((H.aimX || 0) * 0.12, -0.5, 0.5) * (H.throwT / 0.3) : 0;
        H.bud.squash.scale.set(1, 1 + (mood === 'win' || mood === 'fight' ? Math.sin(now * 14) * 0.06 : 0), 1);
        H.house.position.x = H.shakeT * Math.sin(now * 70) * 0.25; H.house.rotation.z = H.shakeT * Math.sin(now * 55) * 0.06; H.mailbox.rotation.z = k < 0.35 ? 0.9 : 0;
        setBar(H.bar, clamp(k, 0, 1)); if (H.side === ME) H.bar.position.set(H.g.position.x, 0.5, H.g.position.z + 2.9); else H.bar.position.set(H.g.position.x, 7, H.g.position.z); H.bar.quaternion.copy(camera.quaternion);
        if (mood === 'panic' && Math.random() < dt * 5) { const d = ball(0.07, B('#8FD3FF', { transparent: true })); bit(d, { x: H.g.position.x + (Math.random() - 0.5), y: 5, z: H.g.position.z, vx: (Math.random() - 0.5) * 2, vy: 2, g: 9, life: 0.5 }); }
      }
      if (H.bubble) { H.bubbleT -= dt; H.bubble.material.opacity = clamp(H.bubbleT * 3, 0, 1); H.bubble.position.y = 7.6 + Math.sin(now * 3) * 0.08; if (H.bubbleT <= 0) { scene.remove(H.bubble); H.bubble.material.map.dispose(); H.bubble = null; } }
    }
    if (phase === 'over' && battle.winner != null && Math.random() < dt * 14) { const H = homes[battle.winner], m = box(0.16, 0.16, 0.02, B(['#FFD23F', '#F0607A', '#3D8BFD', '#7BE08A'][Math.floor(Math.random() * 4)], { transparent: true, side: THREE.DoubleSide })); bit(m, { x: H.g.position.x + (Math.random() - 0.5) * 5, y: 8, z: H.g.position.z + (Math.random() - 0.5) * 3, vx: Math.random() - 0.5, vy: -1, g: 2, life: 1.6, spin: 9 }); }
    // little bits
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i]; b.t += dt; const k = b.t / b.life;
      if (k >= 1) { scene.remove(b.m); if (b.m.material && b.m.material.map && b.keep) b.m.material.map.dispose(); bits.splice(i, 1); continue; }
      b.vy -= b.g * dt; b.m.position.x += b.vx * dt; b.m.position.y += b.vy * dt; b.m.position.z += b.vz * dt;
      if (b.grow) b.m.scale.setScalar(b.s0 * (1 + b.grow * k)); if (b.spin) { b.m.rotation.x += b.spin * dt; b.m.rotation.y += b.spin * 0.7 * dt; }
      if (b.m.material) b.m.material.opacity = (b.m.material.userData.o0 ??= b.m.material.opacity) * (k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1);
    }
    if (drag && drag.at) { gRing.rotation.z += dt * 2; }
    // the camera shudders when something big comes down
    shake = Math.max(0, shake - dt * 2.5); const d = camera.userData.d || 30;
    camera.position.set((Math.random() - 0.5) * shake, Math.sin(PITCH) * d + (Math.random() - 0.5) * shake, Math.cos(PITCH) * d + 1.2); camera.lookAt(0, 0, 1.2);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
  // for the checks: a way in
  return { battle, get phase() { return phase; }, start, views, homes, trees, pending, place: (slot, x, y) => issue(slot, x, y), get outOfSync() { return outOfSync; }, get side() { return ME; }, print: () => fingerprint(battle),
    skip(ticks) { fast = true; for (let i = 0; i < ticks && !battle.over; i++) tick(); fast = false; resync(); if (battle.over && phase !== 'over') finish(); },
    setPhase(p) { phase = p; }, autoplay(on) { auto = on ? { seed: 5 } : null; } };
}
