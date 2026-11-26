// Inside a bud's home (/house): a room shaped like the home is from outside, drawn with its front wall away so you
// can see in. Six frames for doodles and six shelf spots for finds. Anyone can walk in and look; the bud who lives
// there taps a frame or a shelf spot to change what's on it. The server (lib/house.js) decides what may go where.
import { setExtents, buildMesh, drawEyeStyle, clamp } from '/js/bud-core.js';
import { makeFind } from '/js/finds3d.js';
import { FINDS } from '/js/away.js';

const S = window.BudSound || { play() {}, babble() {}, bindToggle() {} };
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
export const KINDS = ['cottage', 'hut', 'tall', 'aframe', 'burrow', 'stilt', 'tent'];
const BLURB = { cottage: 'a cottage', hut: 'a round hut', tall: 'a tall house', aframe: 'an A-frame', burrow: 'a burrow', stilt: 'a house on stilts', tent: 'a tent, for now' };

export async function runHouse(data, kind, save) {
  const THREE = window.THREE;
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c.isColor ? c : lin(c), roughness: 0.9, ...o });
  const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
  const loadImage = (src) => new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });

  /* ---------- the home's colors, taken from its bud's paint the same way the outside is ---------- */
  const paint = await loadImage(data.owner.paint);
  let wallC = lin('#F4EBDD'), trimC = lin('#C96A5A');
  if (paint) {
    const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(paint, 0, 0, 16, 16);
    try {
      const d = g.getImageData(0, 0, 16, 16).data; let r = 0, gg = 0, b = 0, n = 0, best = null, bestSat = -1;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]), sat = mx ? (mx - mn) / mx : 0; if (sat * (mx / 255) > bestSat) { bestSat = sat * (mx / 255); best = [d[i], d[i + 1], d[i + 2]]; } }
      wallC = new THREE.Color(r / n / 255, gg / n / 255, b / n / 255).lerp(new THREE.Color(1, 1, 1), 0.38).convertSRGBToLinear();
      trimC = new THREE.Color(best[0] / 255, best[1] / 255, best[2] / 255).lerp(new THREE.Color(1, 1, 0.92), 0.2).convertSRGBToLinear();
    } catch (e) { /* a picture we can't read: the plain colors will do */ }
  }
  const WOOD = '#8A5A3C', FLOOR = '#C9A77A';
  const wallM = M(wallC, { side: THREE.DoubleSide }), trimM = M(trimC), woodM = M(WOOD), floorM = M(FLOOR), darkM = M('#5C3D2A');

  /* ---------- the stage ---------- */
  const wrap = $('stage'), renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); wrap.append(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, 0.3, 120);
  // the hour outside: it sets the sky behind the room, the light coming in, and how much the lantern matters
  const hr = new Date().getHours(), asked = new URLSearchParams(location.search).get('tod'), tod = ['day', 'golden', 'night'].includes(asked) ? asked : hr >= 7 && hr < 17 ? 'day' : hr >= 17 && hr < 20 ? 'golden' : 'night';
  const SKY = { day: { hemi: [0xFFF6E8, 0xB79A80, 0.84], sun: [0xFFE9C8, 0.5], lamp: 0.45, pane: 0xCFEBFF, grass: '#8CC47E', dirt: '#B58A62' },
    golden: { hemi: [0xFFE2C0, 0xB08A70, 0.78], sun: [0xFFB877, 0.55], lamp: 0.7, pane: 0xFFD3A0, grass: '#A3B86C', dirt: '#B07F58' },
    night: { hemi: [0xAEB6E8, 0x4A4466, 0.5], sun: [0x8FA0FF, 0.14], lamp: 1.25, pane: 0x2A3160, grass: '#4E7466', dirt: '#6B5A5A' } }[tod];
  document.body.dataset.tod = tod;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', { day: '#A9D8F3', golden: '#F4B183', night: '#1B2040' }[tod]);
  scene.add(new THREE.HemisphereLight(...SKY.hemi));
  const sun = new THREE.DirectionalLight(...SKY.sun); sun.position.set(3, 8, 9); scene.add(sun);
  const lamp = new THREE.PointLight(0xFFC98A, SKY.lamp, 14, 2); scene.add(lamp);
  const room = new THREE.Group(); scene.add(room);
  const frames = [], spots = [];          // where the six doodles and the six finds go: { x, y, z, ry }
  let walk, SPAN = 8, TALL = 3, DEEP = 5;  // walk(x, z) -> the nearest spot a bud can stand; and the room's size, for the camera

  // a wall made from an outline (a gable end, an A-frame's triangle)
  const shapeWall = (pts, mat) => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return new THREE.Mesh(new THREE.ShapeGeometry(s), mat); };
  const planks = (w, d, y = 0) => { const g = new THREE.Group(); const n = Math.round(w / 0.7); for (let i = 0; i < n; i++) g.add(box(w / n - 0.04, 0.08, d, i % 2 ? floorM : M('#BF9C6E'), -w / 2 + (i + 0.5) * w / n, y - 0.04, 0)); return g; };
  const rug = (r, x = 0, z = 0.4) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 36), trimM); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z); const i = new THREE.Mesh(new THREE.CircleGeometry(r * 0.72, 36), M(wallC.clone().lerp(new THREE.Color(1, 1, 1), 0.4))); i.rotation.x = -Math.PI / 2; i.position.set(x, 0.03, z); room.add(m, i); };
  const windowAt = (x, y, z, r = 0.5, ry = 0) => { const g = new THREE.Group(), pane = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ color: SKY.pane })), fr = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 6, 24), woodM); g.add(pane, fr, box(r * 2, 0.05, 0.04, woodM), box(0.05, r * 2, 0.04, woodM)); g.position.set(x, y, z); g.rotation.y = ry; room.add(g); };
  // a straight shelf with n spots along it
  function shelf(x, y, z, w, n) { room.add(box(w, 0.08, 0.5, woodM, x, y, z + 0.25)); for (const s of [-1, 1]) room.add(box(0.07, 0.3, 0.4, darkM, x + s * (w / 2 - 0.12), y - 0.18, z + 0.2)); for (let i = 0; i < n; i++) spots.push({ x: x - w / 2 + (i + 0.5) * w / n, y: y + 0.04, z: z + 0.27, ry: 0 }); }
  const rectWalk = (W, D) => (x, z) => [clamp(x, -W / 2 + 0.75, W / 2 - 0.75), clamp(z, -D / 2 + 1.05, D / 2 - 0.2)];
  const roundWalk = (R) => (x, z) => { z = Math.min(z, R * 0.72); const d = Math.hypot(x, z), m = R - 1.15; return d > m ? [x / d * m, z / d * m] : [x, z]; };
  // the three plain walls of a boxy room (the fourth is away, so you can see in)
  function boxRoom(W, D, H) { room.add(planks(W, D)); const back = box(W, H, 0.12, wallM, 0, H / 2, -D / 2); room.add(back); for (const s of [-1, 1]) room.add(box(0.12, H, D, wallM, s * W / 2, H / 2, 0)); room.add(box(W, 0.16, 0.1, trimM, 0, 0.08, -D / 2 + 0.08)); SPAN = W; TALL = H; DEEP = D; walk = rectWalk(W, D); }
  // a round room: the back of a drum, open towards you
  function roundRoom(R, H, mat) {
    const fl = new THREE.Mesh(new THREE.CircleGeometry(R, 48), floorM); fl.rotation.x = -Math.PI / 2; room.add(fl);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 48, 1, true, Math.PI - 2.1, 4.2), mat); w.position.y = H / 2; room.add(w);
    SPAN = R * 2; TALL = H; DEEP = R * 1.7; walk = roundWalk(R);
  }
  // six frames round a curved wall, and a ledge of six spots running under them
  function ring(R, fy, sy) {
    for (let i = 0; i < 6; i++) { const a = (i - 2.5) * 0.42; frames.push({ x: Math.sin(a) * (R - 0.1), y: fy, z: -Math.cos(a) * (R - 0.1), ry: -a }); }
    const wm = M(WOOD, { side: THREE.DoubleSide }), ledge = new THREE.Mesh(new THREE.RingGeometry(R - 0.55, R - 0.02, 40, 1, Math.PI / 2 - 1.2, 2.4), wm), lip = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.55, R - 0.55, 0.09, 40, 1, true, Math.PI - 1.2, 2.4), wm);
    ledge.rotation.x = -Math.PI / 2; ledge.position.y = sy; lip.position.y = sy - 0.045; room.add(ledge, lip);
    for (let i = 0; i < 6; i++) { const a = (i - 2.5) * 0.36; spots.push({ x: Math.sin(a) * (R - 0.3), y: sy + 0.05, z: -Math.cos(a) * (R - 0.3), ry: -a }); }
  }
  const BUILD = {
    // a cottage: wide, with a gable end and the roof's beams showing
    cottage() {
      const W = 8.4, D = 5.4, H = 2.7, rise = 1.7; boxRoom(W, D, H);
      const g = shapeWall([[-W / 2, 0], [W / 2, 0], [0, rise]], wallM); g.position.set(0, H, -D / 2 + 0.07); room.add(g);
      for (const s of [-1, 1]) { const b = box(Math.hypot(W / 2, rise) + 0.3, 0.18, 0.22, trimM, s * W / 4, H + rise / 2 + 0.05, -D / 2 + 0.3); b.rotation.z = -s * Math.atan2(rise, W / 2); room.add(b); }
      windowAt(0, H + 0.62, -D / 2 + 0.15, 0.42);
      shelf(-2.75, 1.0, -D / 2 + 0.07, 2.5, 3); shelf(-2.75, 1.95, -D / 2 + 0.07, 2.5, 3);
      for (let i = 0; i < 6; i++) frames.push({ x: 0.2 + (i % 3) * 1.45, y: i < 3 ? 1.95 : 0.85, z: -D / 2 + 0.09, ry: 0 });
      rug(1.5, 0.6, 0.7); TALL = H + rise;
    },
    // a hut: round, under a cone of rafters
    hut() {
      const R = 3.9, H = 2.5; roundRoom(R, H, wallM); ring(R, 1.72, 0.78);
      for (let i = 0; i < 7; i++) { const a = Math.PI - 1.9 + i * 3.8 / 6, r = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, Math.hypot(R, 1.9), 6), trimM); r.position.set(Math.sin(a) * R / 2, H + 0.95, Math.cos(a) * R / 2); r.lookAt(0, H + 1.9, 0); r.rotateX(Math.PI / 2); room.add(r); }
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, H + 1.9, 8), woodM); post.position.set(0, (H + 1.9) / 2, -0.2); post.visible = false; room.add(post);
      rug(1.7, 0, 0.5); TALL = H + 1.9;
    },
    // a tall house: narrow, with the frames climbing the wall and a loft
    tall() {
      const W = 5.6, D = 4.8, H = 5.3; boxRoom(W, D, H);
      room.add(box(W, 0.14, 1.5, woodM, 0, 3.55, -D / 2 + 0.8)); room.add(box(W, 0.5, 0.08, trimM, 0, 3.87, -D / 2 + 1.53));
      for (let i = 0; i < 9; i++) room.add(box(0.5, 0.06, 0.1, darkM, W / 2 - 0.45, 0.35 + i * 0.4, -D / 2 + 1.62)); for (const s of [-0.25, 0.25]) room.add(box(0.06, 3.6, 0.06, darkM, W / 2 - 0.45 + s, 1.8, -D / 2 + 1.62));
      windowAt(0, 4.5, -D / 2 + 0.1, 0.45);
      for (let r = 0; r < 3; r++) shelf(-1.7, 0.75 + r * 0.92, -D / 2 + 0.07, 1.7, 2);
      for (let i = 0; i < 6; i++) frames.push({ x: 0.15 + (i % 2) * 1.3, y: 2.75 - Math.floor(i / 2) * 1.02, z: -D / 2 + 0.09, ry: 0 });
      rug(1.2, 0, 0.8);
    },
    // an A-frame: the walls are the roof, meeting overhead
    aframe(canvas) {
      const W = 8.6, D = 5.2, top = 5.2, mat = canvas ? M('#EFE3C8', { side: THREE.DoubleSide }) : wallM;
      room.add(planks(W, D)); const back = shapeWall([[-W / 2, 0], [W / 2, 0], [0, top]], mat); back.position.z = -D / 2; room.add(back);
      for (const s of [-1, 1]) { const len = Math.hypot(W / 2, top), p = box(len, 0.06, D, canvas ? mat : trimM, s * W / 4, top / 2, 0); p.rotation.z = -s * Math.atan2(top, W / 2); room.add(p);
        const beam = box(Math.hypot(W / 2, top), 0.16, 0.2, canvas ? woodM : darkM, s * W / 4, top / 2, D / 2 - 0.1); beam.rotation.z = -s * Math.atan2(top, W / 2); room.add(beam); }
      shelf(0, 0.72, -D / 2 + 0.05, 5.4, 6);
      for (const [x, y] of [[-1.45, 1.85], [0, 1.85], [1.45, 1.85], [-0.72, 2.95], [0.72, 2.95], [0, 4.0]]) frames.push({ x, y, z: -D / 2 + 0.07, ry: 0, small: y > 3.5 });
      rug(1.4, 0, 0.9); SPAN = W; TALL = top; DEEP = D; walk = (x, z) => { z = clamp(z, -D / 2 + 1.05, D / 2 - 0.2); return [clamp(x, -W / 2 + 1.5, W / 2 - 1.5), z]; };
    },
    tent() { BUILD.aframe(true); },
    // a burrow: dug out of the hill, round and low, with roots through the ceiling
    burrow() {
      const R = 3.8, H = 2.3, earth = M('#B58A62', { side: THREE.BackSide }); roundRoom(R, H, M(wallC.clone().lerp(lin('#B58A62'), 0.45), { side: THREE.DoubleSide }));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 14, Math.PI - 2.1 + Math.PI / 2, 4.2, 0, Math.PI / 2), earth); dome.scale.y = 0.42; dome.position.y = H; room.add(dome);
      ring(R, 1.6, 0.72);
      for (const [x, z, l] of [[-1.6, -1.4, 0.9], [0.4, -2.2, 0.6], [1.9, -0.8, 1.1], [-0.3, -0.4, 0.5]]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.07, l, 5), darkM); r.position.set(x, H + 1.1 - l / 2, z); r.rotation.z = x * 0.08; room.add(r); }
      rug(1.6, 0, 0.5); TALL = H + 1.6;
    },
    // a house on stilts: planks, sea air, and windows either side
    stilt() {
      const W = 7.6, D = 5, H = 2.9; boxRoom(W, D, H);
      for (let i = 1; i < 6; i++) room.add(box(W, 0.03, 0.02, darkM, 0, i * H / 6, -D / 2 + 0.07));
      for (const s of [-1, 1]) { const w = box(0.06, 1.1, 1.6, new THREE.MeshBasicMaterial({ color: SKY.pane }), s * (W / 2 - 0.05), 1.7, -0.3); room.add(w, box(0.1, 0.08, 1.8, woodM, s * (W / 2 - 0.08), 1.12, -0.3), box(0.1, 0.08, 1.8, woodM, s * (W / 2 - 0.08), 2.28, -0.3)); }
      room.add(box(1.1, 0.06, 1.1, darkM, W / 2 - 1.2, 0.03, D / 2 - 0.8));   // the hatch you climbed up through
      shelf(0, 0.8, -D / 2 + 0.07, 6.2, 6);
      for (let i = 0; i < 6; i++) frames.push({ x: -2.75 + i * 1.1, y: 1.95, z: -D / 2 + 0.09, ry: 0 });
      rug(1.3, -0.4, 0.8);
    },
  };
  (BUILD[kind] || BUILD.cottage)();
  lamp.position.set(0, TALL - 0.75, 0.6);
  // a lantern on a cord, and a mat where the door is
  { const cord = box(0.02, 0.5, 0.02, darkM, 0, lamp.position.y + 0.45, 0.6), glow = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 9), new THREE.MeshStandardMaterial({ color: lin('#FFE9A8'), emissive: lin('#FFB94A'), emissiveIntensity: 1.1 })); glow.position.copy(lamp.position); room.add(cord, glow, box(0.3, 0.06, 0.3, darkM, 0, lamp.position.y + 0.2, 0.6));
    const mat = box(1.3, 0.04, 0.7, darkM, 0, 0.02, walk(0, 99)[1] + 0.1); room.add(mat); }

  // the plot it stands on: a round of grass on a clod of earth, stepping stones up to the door, a bush and some flowers
  { const R = Math.max(SPAN * 0.66, DEEP * 0.95), cz = -0.1, grassM = M(SKY.grass), top = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.97, 0.22, 56), grassM), clod = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.97, R * 0.72, 0.9, 56), M(SKY.dirt));
    top.scale.z = clod.scale.z = Math.min(1, DEEP * 1.05 / R); top.position.set(0, -0.2, cz); clod.position.set(0, -0.76, cz); room.add(top, clod);
    const dz = walk(0, 99)[1]; for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.3 - i * 0.03, 0.3 - i * 0.03, 0.06, 12), M('#C9C2B8')); st.position.set((i % 2 ? 0.16 : -0.12), -0.07, DEEP / 2 + 0.45 + i * 0.62); st.scale.z = 0.8; if (st.position.z < cz + R * top.scale.z - 0.4) room.add(st); }
    const petals = ['#FF8FA3', '#FFD36E', '#FFFFFF', '#C9A8FF'];
    for (const [fx, k] of [[-SPAN / 2 + 0.5, 0], [-SPAN / 2 + 1.2, 1], [SPAN / 2 - 0.6, 2], [SPAN / 2 - 1.4, 3], [-1.5, 2], [1.7, 0]]) { const fz = DEEP / 2 + 0.35 + (k % 2) * 0.3; room.add(box(0.03, 0.26, 0.03, M('#5E9E58'), fx, 0.04, fz)); const fl = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), M(petals[k])); fl.position.set(fx, 0.2, fz); room.add(fl); }
    for (const sx of [-1, 1]) { const bush = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 9), M(tod === 'night' ? '#3F6657' : '#6BBF7A')); bush.scale.y = 0.75; bush.position.set(sx * (SPAN / 2 + 0.35), 0.12, DEEP / 2 - 0.2); room.add(bush); } }

  /* ---------- what's on the walls and shelves ---------- */
  const taps = [], frameViews = [], spotViews = [];
  const emptyTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#FFFDF6'; g.fillRect(0, 0, 128, 128); if (data.mine) { g.strokeStyle = '#C9B99A'; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(64, 40); g.lineTo(64, 88); g.moveTo(40, 64); g.lineTo(88, 64); g.stroke(); } const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t; })();
  frames.forEach((f, i) => {
    const g = new THREE.Group(), s = f.small ? 0.78 : 1, fr = box(1.02 * s, 1.02 * s, 0.06, woodM), pic = new THREE.Mesh(new THREE.PlaneGeometry(0.86 * s, 0.86 * s), new THREE.MeshBasicMaterial({ map: emptyTex }));
    pic.position.z = 0.04; g.add(fr, pic); g.position.set(f.x, f.y, f.z); g.rotation.y = f.ry; g.userData = { type: 'wall', i }; room.add(g); taps.push(g); frameViews.push({ g, pic, id: undefined });
  });
  spots.forEach((p, i) => {
    const g = new THREE.Group(), hitbox = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.5), new THREE.MeshBasicMaterial({ visible: false })); hitbox.position.y = 0.4;
    const mark = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.17, 20), new THREE.MeshBasicMaterial({ color: lin('#C9B99A'), transparent: true, opacity: data.mine ? 0.9 : 0 })); mark.rotation.x = -Math.PI / 2; mark.position.y = 0.01;
    g.add(hitbox, mark); g.position.set(p.x, p.y, p.z); g.rotation.y = p.ry; g.userData = { type: 'shelf', i }; room.add(g); taps.push(g); spotViews.push({ g, mark, item: null, kind: undefined });
  });
  function show() {
    data.walls.forEach((w, i) => { const v = frameViews[i]; if (!v || v.id === (w ? w.id : null)) return; v.id = w ? w.id : null; v.pic.material.map = emptyTex; v.pic.material.needsUpdate = true;
      if (w && w.thumb) loadImage(w.thumb).then((img) => { if (!img || v.id !== w.id) return; const t = new THREE.Texture(img); t.encoding = THREE.sRGBEncoding; t.needsUpdate = true; v.pic.material.map = t; v.pic.material.needsUpdate = true; }); });
    data.shelves.forEach((k, i) => { const v = spotViews[i]; if (!v || v.kind === k) return; v.kind = k; if (v.item) v.g.remove(v.item); v.item = null; v.mark.visible = !k;
      if (k) { v.item = makeFind(THREE, k); v.item.scale.setScalar(1.25); v.g.add(v.item); v.pop = 1; } });
  }
  show();

  /* ---------- buds ---------- */
  const FACE_W = 256, FACE_H = 175;
  function makeBud(look, width) {
    const b = setExtents({ r: look.r.map(([x, y]) => ({ x, y })), eyeRel: look.eyeRel, eyeR: look.eyeR }), { geom, face } = buildMesh(b);
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: lin('#D8D6E6'), roughness: 0.58, clearcoat: 0.3 });
    const fc = document.createElement('canvas'); fc.width = FACE_W; fc.height = FACE_H; const tex = new THREE.CanvasTexture(fc); tex.encoding = THREE.sRGBEncoding;
    const faceMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    geom.computeBoundingBox(); const bb = geom.boundingBox, s = width / Math.max(b.w, b.h), c = bb.getCenter(new THREE.Vector3()), h = (bb.max.y - bb.min.y) * s;
    const inner = new THREE.Group(), fm = new THREE.Mesh(face, faceMat); fm.renderOrder = 2; inner.add(new THREE.Mesh(geom, bodyMat), fm); inner.scale.setScalar(s); inner.position.set(-c.x * s, -c.y * s + h / 2 + 0.03, -c.z * s);
    const squash = new THREE.Group(), turn = new THREE.Group(), root = new THREE.Group(); squash.add(inner); turn.add(squash); root.add(turn);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(width * 0.42, 24), new THREE.MeshBasicMaterial({ color: 0x3A2A1E, transparent: true, opacity: 0.22, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.035; root.add(shadow);
    loadImage(look.paint).then((img) => { if (!img) return; const map = new THREE.Texture(img); map.encoding = THREE.sRGBEncoding; map.needsUpdate = true; bodyMat.map = map; bodyMat.color.set(0xffffff); bodyMat.needsUpdate = true; });
    scene.add(root);
    return { look, root, turn, squash, b, tex, g: fc.getContext('2d'), key: '', blinkAt: 2, happy: false, x: 0, z: 0, tx: 0, tz: 0, yaw: 0, bob: Math.random() * 6, moving: false, h };
  }
  function face(v, now) {
    const blink = now > v.blinkAt && now < v.blinkAt + 0.15 ? Math.sin((now - v.blinkAt) / 0.15 * Math.PI) : 0; if (now > v.blinkAt + 0.15) v.blinkAt = now + 2 + Math.random() * 4;
    const key = blink.toFixed(1) + v.happy; if (key === v.key) return; v.key = key;
    v.g.clearRect(0, 0, FACE_W, FACE_H); drawEyeStyle(v.g, v.look.eyes || 'classic', FACE_W / 2, FACE_H / 2, v.b.eyeR * (FACE_W / (v.b.eyeR * 4.4)), blink, v.happy, '#15161F', { x: 0, y: 0.15 }, null); v.tex.needsUpdate = true;
  }
  const door = walk(0, 99);
  const me = data.you ? makeBud(data.you, 1.5) : null, host = !data.mine ? makeBud(data.owner, 1.5) : null;
  if (me) { me.x = me.tx = door[0]; me.z = me.tz = door[1]; me.yaw = Math.PI; }
  if (host) { const p = walk(-1.6, -0.6); host.x = host.tx = p[0]; host.z = host.tz = p[1]; host.wait = 2; }
  function moveBud(v, dt, speed) {
    const dx = v.tx - v.x, dz = v.tz - v.z, d = Math.hypot(dx, dz); v.moving = d > 0.06;
    if (v.moving) { const st = Math.min(d, speed * dt); v.x += dx / d * st; v.z += dz / d * st; }
    let want = v.moving ? Math.atan2(dx, dz) : (v.faceTo ?? 0), turn = want - v.yaw; while (turn > Math.PI) turn -= Math.PI * 2; while (turn < -Math.PI) turn += Math.PI * 2; v.yaw += turn * Math.min(1, dt * 9);
    const hop = v.moving ? Math.abs(Math.sin(now * 11 + v.bob)) * 0.2 : 0; v.pop = Math.max(0, (v.pop || 0) - dt * 3);
    v.root.position.set(v.x, hop + v.pop * 0.3, v.z); v.turn.rotation.y = v.yaw; v.squash.rotation.x = v.moving ? 0.12 : 0; v.squash.scale.y = 1 + (v.moving ? 0 : Math.sin(now * 2 + v.bob) * 0.02);
    face(v, now);
  }

  /* ---------- tapping: the floor to walk, a frame or a shelf spot to use it ---------- */
  const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hint = $('hint');
  let hintT = 0; const tell = (text, ms = 6000) => { hint.textContent = text; hint.classList.add('show'); clearTimeout(hintT); hintT = setTimeout(() => hint.classList.remove('show'), ms); };
  let going = null;   // the frame or shelf spot your bud is walking up to
  function tapAt(cx, cy) {
    const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(v, camera);
    const hit = ray.intersectObjects(taps, true)[0];
    if (hit) { let o = hit.object; while (o && !o.userData.type) o = o.parent; if (o) return use(o.userData); }
    const p = new THREE.Vector3(); if (!me || !ray.ray.intersectPlane(ground, p)) return;
    going = null; [me.tx, me.tz] = walk(p.x, p.z); me.faceTo = 0; S.play('pop', { gain: 0.2, rate: 1.4 });
  }
  function use(u) {
    const at = u.type === 'wall' ? frames[u.i] : spots[u.i];
    if (!me) return open(u);
    [me.tx, me.tz] = walk(at.x + Math.sin(at.ry) * 0.2, at.z + 1.25); me.faceTo = Math.PI; going = { u, t: 0 }; S.play('click', { gain: 0.3 });
  }
  renderer.domElement.addEventListener('pointerdown', (e) => { e.preventDefault(); tapAt(e.clientX, e.clientY); });
  const keys = new Set(); addEventListener('keydown', (e) => keys.add(e.key)); addEventListener('keyup', (e) => keys.delete(e.key));

  /* ---------- the sheets: look at a doodle, or (in your own home) choose what goes where ---------- */
  const sheet = $('sheet'), sTitle = $('sTitle'), sBody = $('sBody'), sNote = $('sNote');
  const close = () => { sheet.hidden = true; }; $('sClose').addEventListener('click', close); sheet.addEventListener('pointerdown', (e) => { if (e.target === sheet) close(); });
  async function put(change) {
    const walls = data.walls.map((w) => (w ? w.id : null)), shelves = data.shelves.slice(); change(walls, shelves); close();
    try { const next = await save({ walls, shelves }); Object.assign(data, { walls: next.walls, shelves: next.shelves, have: next.have || data.have }); show(); S.play('chime', { gain: 0.4 }); if (me) { me.pop = 1; me.happy = true; setTimeout(() => { me.happy = false; }, 1200); } }
    catch (e) { tell(`That didn’t save: ${e.message}.`); S.play('boing', { gain: 0.3 }); }
  }
  function open(u) {
    sBody.textContent = ''; sNote.textContent = '';
    if (u.type === 'wall') {
      const w = data.walls[u.i];
      if (!data.mine) { if (!w) { tell('An empty frame.'); return; } sTitle.textContent = w.caption || 'A doodle'; const img = el('img', 'big'); img.src = w.thumb; img.alt = w.caption || 'a doodle'; sBody.append(img); sNote.textContent = `drawn by ${w.from}`; sheet.hidden = false; return; }
      sTitle.textContent = w ? 'This frame' : 'Hang a doodle';
      if (w) { const img = el('img', 'big'); img.src = w.thumb; img.alt = w.caption || 'a doodle'; sBody.append(img); sNote.textContent = `${w.caption ? `“${w.caption}” ` : ''}drawn by ${w.from}`; const off = el('button', 'btn quiet', 'Take it down'); off.type = 'button'; off.addEventListener('click', () => put((walls) => { walls[u.i] = null; })); sBody.append(off); }
      const hungIds = new Set(data.walls.filter(Boolean).map((x) => x.id)), free = (data.have?.doodles || []).filter((d) => !hungIds.has(d.id));
      if (!free.length && !w) sNote.textContent = (data.have?.doodles || []).length ? 'Every doodle you have is already up.' : 'Nobody has sent you a doodle yet. Friends can draw you one from your bud’s card on the island.';
      if (free.length) { const grid = el('div', 'grid'); for (const d of free) { const b = el('button', 'pick'); b.type = 'button'; const img = el('img'); img.src = d.thumb; img.alt = d.caption || 'a doodle'; b.append(img, el('small', null, d.from)); b.addEventListener('click', () => put((walls) => { walls[u.i] = d.id; })); grid.append(b); } sBody.append(grid); }
      sheet.hidden = false; return;
    }
    const k = data.shelves[u.i];
    if (!data.mine) { tell(k ? `A ${FINDS[k].name}, from Lighthouse Rock.` : 'An empty spot on the shelf.'); return; }
    sTitle.textContent = k ? `A ${FINDS[k].name}` : 'Set something out';
    if (k) { const off = el('button', 'btn quiet', 'Take it off the shelf'); off.type = 'button'; off.addEventListener('click', () => put((_, shelves) => { shelves[u.i] = null; })); sBody.append(off); }
    const used = {}; for (const x of data.shelves) if (x) used[x] = (used[x] || 0) + 1;
    const free = Object.entries(data.have?.finds || {}).map(([kind, n]) => [kind, n - (used[kind] || 0)]).filter(([, n]) => n > 0);
    if (!free.length && !k) sNote.textContent = Object.keys(data.have?.finds || {}).length ? 'Everything you’ve found is already out.' : 'Nothing to set out yet. Take the balloon ferry to Lighthouse Rock and bring something back.';
    if (free.length) { const grid = el('div', 'grid'); for (const [kind, n] of free) { const b = el('button', 'pick find'); b.type = 'button'; b.append(el('span', 'ico', FINDS[kind].icon), el('small', null, `${FINDS[kind].name}${n > 1 ? ` ×${n}` : ''}`)); b.addEventListener('click', () => put((_, shelves) => { shelves[u.i] = kind; })); grid.append(b); } sBody.append(grid); }
    sheet.hidden = false;
  }

  /* ---------- the camera: square on to the open side, back far enough to see the whole room ---------- */
  function fit() {
    const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    const look = new THREE.Vector3(0, TALL * (w / h < 0.8 ? 0.34 : 0.44), -DEEP * 0.2), pts = []; for (const x of [-SPAN / 2 - 0.3, SPAN / 2 + 0.3]) pts.push(new THREE.Vector3(x, 0, -DEEP / 2), new THREE.Vector3(x, TALL * 0.92, -DEEP / 2), new THREE.Vector3(x, 0, DEEP / 2));
    const tallScreen = w / h < 0.8, Z = tallScreen && me ? Math.min(1, 5.3 / SPAN) : 1; pan = SPAN / 2 * (1 - Z); for (const p of pts) p.x *= Z;
    let d = 6; for (let i = 0; i < 80; i++, d *= 1.04) { camera.position.set(0, TALL * 0.5 + d * 0.3, d); camera.lookAt(look); camera.updateMatrixWorld(); if (pts.every((p) => { const q = p.clone().project(camera); return Math.abs(q.x) < 0.97 && q.y < (tallScreen ? 0.72 : 0.8) && q.y > -0.8; })) break; }
    camY = camera.position.y; camD = d; lookAt = look; aim();
  }
  let pan = 0, camX = 0, camY = 0, camD = 6, lookAt = null;
  function aim() { camera.position.set(camX, camY, camD); camera.lookAt(lookAt.x + camX, lookAt.y, lookAt.z); }
  new ResizeObserver(fit).observe(wrap); fit();
  $('title').textContent = data.mine ? 'Your home' : `${data.owner.name}’s home`;
  $('sub').textContent = BLURB[kind] ? BLURB[kind][0].toUpperCase() + BLURB[kind].slice(1) : '';
  tell(data.mine ? 'Tap a frame to hang a doodle, or a shelf to set out a find.' : 'Tap a doodle or a find for a closer look.', 9000);

  let now = 0, last = performance.now();
  function frame(t) {
    requestAnimationFrame(frame); const dt = Math.min(0.1, (t - last) / 1000); last = t; now += dt;
    if (me) {
      const kx = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0), kz = (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0);
      if (kx || kz) { going = null; [me.tx, me.tz] = walk(me.x + kx * 0.6, me.z + kz * 0.6); me.faceTo = 0; }
      moveBud(me, dt, 3.4);
      if (going) { going.t += dt; if (!me.moving || going.t > 4) { const u = going.u; going = null; open(u); } }
    }
    if (host) {   // the bud who lives here potters about, and turns to look at you when you're close
      host.wait -= dt; if (host.wait <= 0 && !host.moving) { host.wait = 3 + Math.random() * 4; [host.tx, host.tz] = walk((Math.random() - 0.5) * SPAN * 0.7, (Math.random() - 0.6) * DEEP * 0.6); }
      host.faceTo = me && Math.hypot(me.x - host.x, me.z - host.z) < 2.6 ? Math.atan2(me.x - host.x, me.z - host.z) : 0; host.happy = me && Math.hypot(me.x - host.x, me.z - host.z) < 2.2; moveBud(host, dt, 1.5);
    }
    const wantX = me ? clamp(me.x, -pan, pan) : 0; if (Math.abs(wantX - camX) > 0.001) { camX += (wantX - camX) * Math.min(1, dt * 4); aim(); }
    for (const v of spotViews) if (v.item) { v.pop = Math.max(0, (v.pop || 0) - dt * 2.5); v.item.position.y = Math.sin(v.pop * Math.PI) * 0.35; v.item.rotation.y += dt * 0.35; }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
  return { data, frames, spots, me, host, use, open, tapAt, kind, screenOf: (p) => { const q = new THREE.Vector3(p.x, p.y, p.z).project(camera), r = renderer.domElement.getBoundingClientRect(); return [r.left + (q.x + 1) / 2 * r.width, r.top + (1 - q.y) / 2 * r.height]; } };
}
