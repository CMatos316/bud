// The TV's picture for Bumper Buds, Freeze and Island Grand Prix, in 3D: the same puffy buds as on the island and
// in Island Race (built by js/bud-core.js from each bud's outline and paint), on an island you can fall off, a
// beach with a crab at the end of it, and a kart track round a lagoon. It only draws: js/party-games.js decides what happens, js/party-tv.js runs the show.
// Needs THREE and Delaunator loaded as globals first (party.html does that on the TV only).
import { setExtents, buildMesh, drawEyeStyle, clamp } from '/js/bud-core.js';
import { BUMPER, FREEZE, KART, KART_ITEMS, kartTrack } from '/js/party-games.js';

const FACE_W = 256, FACE_H = 175, BUD_W = BUMPER.BUD * 2 * 1.08, SEA = -3.2;
const lerp = (a, b, k) => a + (b - a) * k;

export function make3d(canvas, { colorFor, nameOf, budData }) {
  const THREE = window.THREE;
  const toLinear = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const M = (hex, o = {}) => new THREE.MeshStandardMaterial({ color: toLinear(hex), roughness: 0.85, ...o });
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
  catch (e) { throw new Error('this browser can’t draw 3D here (WebGL is switched off). Try Chrome, or turn on hardware acceleration'); }
  renderer.outputEncoding = THREE.sRGBEncoding;   // no filmic tone mapping here: on a TV across the room the colors should stay bright
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 600);
  let W = 1, H = 1, skip = false;
  function resize() { W = innerWidth; H = innerHeight; renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); }
  // how far back the camera must be to fit something `half` wide and `halfTall` tall on screen
  const fitDist = (half, halfTall) => { const v = Math.tan(camera.fov * Math.PI / 360); return Math.max(half / (v * camera.aspect), halfTall / v); };
  const lens = (fov) => { if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); } };

  function sky(top, mid, bottom) {
    const c = document.createElement('canvas'); c.width = 4; c.height = 256; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, top); gr.addColorStop(0.6, mid); gr.addColorStop(1, bottom);
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  }
  function newScene(bg) {
    const s = new THREE.Scene(); s.background = bg;
    s.add(new THREE.HemisphereLight(0xffffff, 0xB9D6C0, 0.74));
    const sun = new THREE.DirectionalLight(0xffffff, 0.52); sun.position.set(-8, 16, 10); s.add(sun);
    return s;
  }
  const flat = (geo, mat, y = 0) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; return m; };
  function cloud(scene, x, y, z, s) { const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }); for (const [dx, dy, r] of [[0, 0, 1.2], [1.2, 0.1, 0.9], [-1.1, 0.05, 0.8], [0.3, 0.5, 0.9]]) { const p = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m); p.position.set(dx, dy, 0); p.scale.y = 0.6; g.add(p); } g.position.set(x, y, z); g.scale.setScalar(s); scene.add(g); return g; }

  /* ---------- buds ---------- */
  const pieces = new Map();
  const loadImage = (src) => new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  function eyeColorFor(img, b) {
    if (!img) return '#15161F';
    try {
      const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d', { willReadFrequently: true });
      const Wd = img.width, Hd = img.height, er = b.eyeR;
      const sx = (b.eyeRel.x - er * 1.2 - b.minX) / b.w * Wd, sy = (b.eyeRel.y - er * 0.7 - b.minY) / b.h * Hd;
      g.drawImage(img, clamp(sx, 0, Wd - 1), clamp(sy, 0, Hd - 1), Math.max(1, er * 2.4 / b.w * Wd), Math.max(1, er * 1.4 / b.h * Hd), 0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, bb = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; }
      return (0.2126 * r + 0.7152 * gg + 0.0722 * bb) / (d.length / 4) / 255 < 0.42 ? '#F3F4F8' : '#15161F';
    } catch (e) { return '#15161F'; }
  }
  const fallbackShape = () => ({ r: Array.from({ length: 36 }, (_, i) => { const a = i / 36 * Math.PI * 2; return [Math.cos(a) * 60, Math.sin(a) * 54]; }), eyeRel: { x: 0, y: -6 }, eyeR: 15, eyes: 'classic', paint: null });
  function nameSprite(text, color) {
    const c = document.createElement('canvas'), g = c.getContext('2d'), fs = 44; g.font = `600 ${fs}px Fredoka, Nunito, ui-rounded, system-ui, sans-serif`;
    const tw = Math.ceil(g.measureText(text).width) + fs * 1.1; c.width = tw; c.height = fs * 1.5;
    g.font = `600 ${fs}px Fredoka, Nunito, ui-rounded, system-ui, sans-serif`; g.fillStyle = color; g.beginPath(); g.roundRect(0, 0, tw, c.height, c.height / 2); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, tw / 2, c.height / 2 + 2);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); s.renderOrder = 10;
    const h = 0.52; s.scale.set(h * tw / c.height, h, 1); s.userData = { text, w: h * tw / c.height };
    return s;
  }
  // One bud: root (where it stands) > squash (bounces) > inner (the puffy body and its face).
  function makePiece(id) {
    const got = budData(id), data = got && got.r && got.r.length > 8 ? got : fallbackShape();
    const b = setExtents({ r: data.r.map(([x, y]) => ({ x, y })), eyeRel: data.eyeRel, eyeR: data.eyeR });
    const { geom, face } = buildMesh(b), s = BUD_W / Math.max(b.w, b.h), color = colorFor(id);
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: toLinear(color), roughness: 0.58, clearcoat: 0.3 });   // its own color until its paint has loaded
    const body = new THREE.Mesh(geom, bodyMat);
    const fc = document.createElement('canvas'); fc.width = FACE_W; fc.height = FACE_H;
    const faceTex = new THREE.CanvasTexture(fc); faceTex.encoding = THREE.sRGBEncoding;
    const faceMesh = new THREE.Mesh(face, new THREE.MeshStandardMaterial({ map: faceTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    faceMesh.renderOrder = 2;
    const inner = new THREE.Group(); inner.add(body, faceMesh); inner.scale.setScalar(s);
    geom.computeBoundingBox(); const bb = geom.boundingBox, c = bb.getCenter(new THREE.Vector3()), h = (bb.max.y - bb.min.y) * s;
    inner.position.set(-c.x * s, -c.y * s + h / 2 + 0.06, -c.z * s);
    const squash = new THREE.Group(), root = new THREE.Group(), stand = new THREE.Group(); squash.add(inner); root.add(squash);
    // on the ground under it: a soft shadow, a ring in its color, and a dot showing which way a dash would go
    const shadow = flat(new THREE.CircleGeometry(0.62, 24), new THREE.MeshBasicMaterial({ color: 0x1E193C, transparent: true, opacity: 0.2, depthWrite: false }), 0.02); shadow.scale.y = 0.6;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(BUMPER.BUD * 0.86, 0.07, 8, 32), new THREE.MeshBasicMaterial({ color: toLinear(color) })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.09;
    const dot = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 12), new THREE.MeshBasicMaterial({ color: toLinear(color), transparent: true })); dot.rotation.x = Math.PI / 2; dot.position.y = 0.12;
    const aim = new THREE.Group(); aim.add(dot); dot.position.z = BUMPER.BUD + 0.45;
    stand.add(shadow, ring, aim);
    const tag = nameSprite(nameOf(id), color);
    const p = { id, data, b, root, stand, squash, inner, body, faceTex, g: fc.getContext('2d'), eyeCol: '#15161F', ring, aim, dot, shadow, tag, height: h + 0.06, happy: false, sleepy: false, blinkAt: 0, key: '', splashed: false, scene: null };
    if (data.paint) loadImage(data.paint).then((img) => { if (!img) return; const map = new THREE.Texture(img); map.encoding = THREE.sRGBEncoding; map.needsUpdate = true; bodyMat.map = map; bodyMat.color.set(0xffffff); bodyMat.needsUpdate = true; p.eyeCol = eyeColorFor(img, b); p.key = ''; });
    pieces.set(id, p);
    return p;
  }
  function piece(id, scene) {
    let p = pieces.get(id);
    if (!p) p = makePiece(id);
    if (p.tag.userData.text !== nameOf(id)) { const old = p.tag; p.tag = nameSprite(nameOf(id), colorFor(id)); old.parent?.remove(old); if (p.scene) p.scene.add(p.tag); }
    if (p.scene !== scene) { p.scene = scene; scene.add(p.root, p.stand, p.tag); }
    return p;
  }
  function drop(id) { const p = pieces.get(id); if (!p) return; for (const o of [p.root, p.stand, p.tag]) o.parent?.remove(o); pieces.delete(id); }
  function drawFace(p, t) {
    const r = p.b.eyeR, sc = FACE_W / (r * 4.4), g = p.g;
    const blink = p.sleepy ? 1 : (t > p.blinkAt && t < p.blinkAt + 0.15) ? Math.sin((t - p.blinkAt) / 0.15 * Math.PI) : 0;
    if (t > p.blinkAt + 0.15) p.blinkAt = t + 2 + Math.random() * 4;
    const key = [blink.toFixed(1), p.happy, p.eyeCol].join();
    if (key === p.key) return; p.key = key;
    g.clearRect(0, 0, FACE_W, FACE_H);
    drawEyeStyle(g, p.data.eyes || 'classic', FACE_W / 2, FACE_H / 2, r * sc, blink, p.happy, p.eyeCol, { x: 0, y: 0.15 });
    p.faceTex.needsUpdate = true;
  }
  // buds are puffy but not round: they always turn their face to the camera
  const faceCamera = (p, x, z) => { p.root.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z); };
  function showOnly(scene, ids) { for (const [id, p] of pieces) if (!ids.has(id) && p.scene === scene) { p.root.visible = p.stand.visible = p.tag.visible = false; } }

  /* ---------- bits that fly and fade ---------- */
  const bits = [];
  const WHITE = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
  function bit(scene, mesh, { x, y, z, vx = 0, vy = 0, vz = 0, g = 0, life = 0.6, grow = 0, fade = true }) { mesh.position.set(x, y, z); scene.add(mesh); bits.push({ scene, mesh, vx, vy, vz, g, life, grow, fade, t: 0 }); }
  function bitsTick(dt) {
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i]; b.t += dt; const k = b.t / b.life;
      if (k >= 1) { b.scene.remove(b.mesh); b.mesh.geometry.dispose(); if (b.mesh.material !== WHITE) b.mesh.material.dispose(); bits.splice(i, 1); continue; }
      b.vy -= b.g * dt; b.mesh.position.x += b.vx * dt; b.mesh.position.y += b.vy * dt; b.mesh.position.z += b.vz * dt;
      if (b.grow) b.mesh.scale.setScalar(1 + b.grow * k);
      if (b.fade) b.mesh.material.opacity = 1 - k;
    }
  }
  const puffMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
  function splash(scene, x, z, y = SEA) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1, 28), puffMat()); ring.rotation.x = -Math.PI / 2; bit(scene, ring, { x, y: y + 0.05, z, life: 0.9, grow: 3.2 });
    for (let i = 0; i < 12; i++) { const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 2.5; bit(scene, new THREE.Mesh(new THREE.SphereGeometry(0.1 + Math.random() * 0.12, 6, 5), puffMat()), { x, y: y + 0.1, z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 4 + Math.random() * 4, g: 14, life: 0.8 }); }
  }
  function spark(x, z, power, scene = sB) {
    for (let i = 0; i < 5 + Math.round(power * 7); i++) { const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5 * (0.4 + power); bit(scene, new THREE.Mesh(new THREE.OctahedronGeometry(0.1 + Math.random() * 0.1), puffMat()), { x, y: 0.9, z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 1 + Math.random() * 3, g: 8, life: 0.4 }); }
  }
  function puff(x, z) { bit(sB, new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), puffMat()), { x, y: 0.4, z, vy: 0.6, life: 0.45, grow: 1.2 }); }

  /* ============================== Bumper Buds: an island in the sea ============================== */
  const sB = newScene(sky('#8EC5FF', '#CFE9FF', '#EAF6FF'));
  const isle = new THREE.Group(), grassMat = M('#86CF86'), sandMat = M('#EBD9A8');
  {
    const sea = flat(new THREE.CircleGeometry(220, 48), M('#7FC8EA', { roughness: 0.35 }), SEA); sB.add(sea);
    // built one unit across, then stretched to whatever size the island is right now
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.4, 64), sandMat); sand.position.y = -0.2;
    const cliff = new THREE.Mesh(new THREE.CylinderGeometry(0.985, 0.8, 3.4, 48, 1, true), M('#B98B5E', { flatShading: true })); cliff.position.y = -2.1;
    isle.add(sand, cliff); sB.add(isle);
    // a few rocks and a buoy out in the water
    const rock = M('#A9A7B8', { roughness: 1, flatShading: true });
    for (const [x, z, r] of [[-17, -6, 1.5], [-19.5, -4.6, 0.9], [18, 3, 1.3], [15.5, -11, 1], [-13, 10, 0.8]]) { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rock); m.position.set(x, SEA + r * 0.2, z); m.rotation.set(x, z, r); m.scale.y = 0.7; sB.add(m); }
    const buoy = new THREE.Group(), red = M('#E8394B', { roughness: 0.5 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), red); ball.scale.y = 0.8; buoy.add(ball);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.22, 16), M('#FFFFFF')); buoy.add(band);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 6), M('#FFFFFF')); mast.position.y = 0.9; buoy.add(mast);
    buoy.position.set(16.5, SEA + 0.25, 9); sB.add(buoy); isle.userData.buoy = buoy;
  }
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.12, 64), grassMat); grass.position.y = -0.02; sB.add(grass);
  const patch = flat(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.09, depthWrite: false }), 0.05); sB.add(patch);
  const ripples = [0, 1, 2].map(() => { const m = flat(new THREE.RingGeometry(0.985, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }), SEA + 0.04); sB.add(m); return m; });
  const viewB = { r0: 9 };
  const dashOn = new Map();

  function drawBumper(game, T, dt, aside) {
    // the camera frames the island as it is now: it closes in as the island shrinks (but never right up to it)
    viewB.r0 += (Math.max(game.R, game.R0 * 0.55) - viewB.r0) * Math.min(1, dt * 2.5);
    const R0 = viewB.r0, R = game.R, shrinking = game.phase === 'play' && game.t > BUMPER.HOLD && R > BUMPER.RMIN + 0.01;
    isle.scale.set(R, 1, R); grass.scale.set(Math.max(0.01, R - 1.05), 1, Math.max(0.01, R - 1.05)); patch.scale.setScalar(Math.max(0.01, R - 3.6)); patch.position.set(-R * 0.12, 0.05, -R * 0.1);
    sandMat.color.copy(toLinear(shrinking && Math.sin(T * 10) > 0 ? '#FFF1C4' : '#EBD9A8'));       // the edge flickers while it's crumbling
    ripples.forEach((m, i) => { const k = (T * 0.14 + i / 3) % 1; m.scale.setScalar(R + 0.6 + k * 7); m.material.opacity = 0.5 * (1 - k); });
    const buoy = isle.userData.buoy; buoy.position.y = SEA + 0.25 + Math.sin(T * 1.4) * 0.12; buoy.rotation.z = Math.sin(T * 1.1) * 0.12;
    // the camera: the whole island, from the front and a bit above; pulled back and slid over while the panel is up
    lens(30);
    const pitch = 0.66, d = fitDist(R0 + 1.3, R0 * Math.sin(pitch) + 1.7) * (1 + aside * 0.2);
    camera.position.set(0, Math.sin(pitch) * d, Math.cos(pitch) * d); camera.lookAt(0, 0, 0);
    camera.setViewOffset(W, H, -W * 0.17 * aside, H * 0.015, W, H);
    const seen = new Set();
    for (const b of game.buds.values()) {
      const p = piece(b.id, sB); seen.add(b.id);
      const show = !b.gone; p.root.visible = show; p.tag.visible = show; p.stand.visible = show && !b.fall;
      if (!show) continue;
      const speed = Math.hypot(b.vx, b.vy);
      let y = 0.05;
      if (b.fall) {
        y -= 9 * b.fall * b.fall;                        // over the edge and down
        if (y < SEA && !p.splashed) { p.splashed = true; splash(sB, b.x, b.y); }
        if (y < SEA - 0.4) p.root.visible = false;
        p.tag.visible = false;
        p.root.rotation.z = b.fall * 5;
      } else {
        p.splashed = false;
        y += Math.abs(Math.sin(T * 9 + b.x)) * Math.min(0.22, speed * 0.03);          // a little scurry when it moves
        p.root.rotation.z = clamp(-b.vx * 0.035, -0.4, 0.4);
        const sq = 1 - b.hit * 0.22; p.squash.scale.set(2 - sq, sq, 1);
        p.stand.position.set(b.x, 0.04, b.y); p.aim.rotation.y = Math.atan2(b.fx, b.fy); p.dot.material.opacity = b.cool > 0 ? 0.25 : 1;
        if (b.dashT > 0 && Math.random() < 0.6) puff(b.x - b.vx * 0.05, b.y - b.vy * 0.05);
      }
      p.root.position.set(b.x, y, b.y); faceCamera(p, b.x, b.y);
      p.tag.position.set(b.x, y + p.height + 0.5, b.y);
      p.happy = game.phase === 'done' && !!game.champs?.includes(b.id); p.sleepy = false;
      drawFace(p, T);
    }
    showOnly(sB, seen);
    return sB;
  }

  /* ============================== Freeze: a beach, and a crab that naps ============================== */
  const sF = newScene(sky('#8EC5FF', '#D9ECFF', '#FBE9C8'));
  const LEN = 30, X0 = -LEN / 2, lanes = [], laneMatA = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false }), laneMatB = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false });
  const lines = [], castles = [], crab = {}, zzz = [], viewF = { sp: 2.6, n: 1 }, shown = new Map(), waves = new Map();
  let bang = null, fire = null, foam = null, finish = null;
  {
    sF.add(flat(new THREE.PlaneGeometry(260, 200), M('#F2DFA8', { roughness: 1 }), 0));
    const sea = flat(new THREE.PlaneGeometry(260, 120), M('#5DBDE6', { roughness: 0.35 }), 0.02); sea.position.z = -78; sF.add(sea);
    foam = flat(new THREE.PlaneGeometry(260, 1.4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }), 0.03); sF.add(foam);
    // waves rolling in behind it
    foam.userData.rollers = [0, 1, 2, 3].map(() => { const m = flat(new THREE.PlaneGeometry(260, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }), 0.035); sF.add(m); return m; });
    for (let i = 0; i < 12; i++) { const m = flat(new THREE.PlaneGeometry(LEN + 3.4, 1), i % 2 ? laneMatA : laneMatB, 0.012); m.position.x = 0.2; sF.add(m); lanes.push(m); }
    // the start line, and a dashed line at each sandcastle
    const start = flat(new THREE.PlaneGeometry(0.22, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0.02); start.position.x = X0 - 0.9; sF.add(start); lines.push(start);
    for (const c of FREEZE.CASTLES.slice(1)) {
      const x = X0 + c * LEN, line = flat(new THREE.PlaneGeometry(0.16, 1), new THREE.MeshBasicMaterial({ color: toLinear('#B98B5E'), transparent: true, opacity: 0.5 }), 0.02); line.position.x = x; sF.add(line); lines.push(line);
      const g = new THREE.Group(), sand = M('#D9B56C', { roughness: 1 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 1.5), sand); base.position.y = 0.45; g.add(base);
      for (const [dx, dz] of [[-0.85, -0.65], [0.85, -0.65], [-0.85, 0.65], [0.85, 0.65]]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 1.35, 10), sand); t.position.set(dx, 0.68, dz); g.add(t); const top = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.45, 10), sand); top.position.set(dx, 1.55, dz); g.add(top); }
      const keep = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 1.7, 12), sand); keep.position.y = 0.85; g.add(keep);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), M('#8A5A3C')); pole.position.y = 2.2; g.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.36), new THREE.MeshBasicMaterial({ color: toLinear('#E8394B'), side: THREE.DoubleSide })); flag.position.set(0.3, 2.55, 0); g.add(flag);
      g.position.x = x; sF.add(g); castles.push(g);
    }
    // the finish: a checkered strip, and the campfire past it
    const fc = document.createElement('canvas'); fc.width = 16; fc.height = 256; const fg = fc.getContext('2d');
    for (let y = 0; y < 32; y++) for (let x = 0; x < 2; x++) { fg.fillStyle = (x + y) % 2 ? '#1D1C2B' : '#FFFFFF'; fg.fillRect(x * 8, y * 8, 8, 8); }
    const ft = new THREE.CanvasTexture(fc); ft.encoding = THREE.sRGBEncoding; ft.magFilter = THREE.NearestFilter; ft.wrapT = THREE.RepeatWrapping;
    finish = flat(new THREE.PlaneGeometry(1.3, 1), new THREE.MeshBasicMaterial({ map: ft }), 0.02); finish.position.x = X0 + LEN + 1.5; sF.add(finish);
    fire = new THREE.Group();
    for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.3, 7), M('#8A5A3C')); l.rotation.z = Math.PI / 2; l.rotation.y = i * Math.PI / 3; l.position.y = 0.14; fire.add(l); }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 8), new THREE.MeshBasicMaterial({ color: 0xFF9A3E, transparent: true, opacity: 0.92 })); flame.position.y = 0.72; fire.add(flame); fire.userData.flame = flame;
    fire.position.set(X0 + LEN + 3.4, 0, 0); fire.scale.setScalar(1.7); sF.add(fire);
    cloud(sF, -26, 12, -70, 4); cloud(sF, 22, 15, -84, 5);

    // the crab, on its rock past the finish. Built facing +z.
    const shell = M('#F2664B', { roughness: 0.5 }), dark = M('#D9482F', { roughness: 0.6 }), g = new THREE.Group(), turn = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(2.6, 1), M('#A9A7B8', { roughness: 1, flatShading: true })); rock.scale.set(1.25, 0.42, 1.1); rock.position.y = 0.35; g.add(rock);
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), shell); body.scale.set(1.55, 0.85, 1.12); body.position.y = 1.05; turn.add(body);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 })); shine.scale.set(1.2, 0.4, 0.7); shine.position.set(-0.45, 1.72, 0.3); turn.add(shine);
    crab.claws = []; crab.eyes = [];
    for (const sd of [-1, 1]) {
      for (let l = 0; l < 3; l++) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 1.5, 6), dark); leg.position.set(sd * 1.75, 0.55, -0.45 + l * 0.42); leg.rotation.z = sd * 0.95; leg.rotation.y = (l - 1) * 0.3 * sd; turn.add(leg); }
      const arm = new THREE.Group(); arm.position.set(sd * 1.25, 1.0, 0.65);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.0, 7), dark); upper.position.y = 0.5; arm.add(upper);
      const claw = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12, 0.55, Math.PI * 2 - 1.1), shell); claw.position.y = 1.25; claw.rotation.z = Math.PI / 2; claw.rotation.y = -Math.PI / 2 + 0.55; arm.add(claw);
      turn.add(arm); crab.claws.push({ arm, sd });
      const eye = new THREE.Group(); eye.position.set(sd * 0.48, 1.7, 0.7);
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.75, 6), dark); stalk.position.y = 0.35; eye.add(stalk);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })); ball.position.y = 0.85; eye.add(ball);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0x1D1C2B })); pupil.position.set(0, 0.85, 0.24); eye.add(pupil);
      // an eyelid: half a shell that swings down over the eye
      const lid = new THREE.Group(); lid.position.y = 0.85; const lidMesh = new THREE.Mesh(new THREE.SphereGeometry(0.325, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), shell); lid.add(lidMesh); eye.add(lid);
      turn.add(eye); crab.eyes.push({ eye, lid, sd });
    }
    turn.position.y = 0.55; g.add(turn); g.position.set(X0 + LEN + 8.4, 0, 0.5); g.scale.setScalar(1.75); sF.add(g);
    Object.assign(crab, { g, turn, body, yaw: 2.5, lid: 1.5, claw: 0 });
    const letter = (text, color, size) => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); x.font = `700 ${size}px Fredoka, Nunito, system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 12; x.strokeStyle = '#fff'; x.strokeText(text, 64, 68); x.fillStyle = color; x.fillText(text, 64, 68); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); s.renderOrder = 9; sF.add(s); return s; };
    for (let i = 0; i < 3; i++) zzz.push(letter('z', '#5E5D75', 96));
    bang = letter('!', '#E8394B', 120);
  }

  function drawFreeze(game, T, dt, aside, roster) {
    const playing = game.phase === 'play', looking = playing && game.light === 'red', stirring = playing && game.light === 'warn';
    const run = game.phase === 'lobby' ? roster.map((p) => ({ id: p.id, p: 0, lobby: true })) : [...game.runners.values()];
    const n = Math.max(1, run.length); viewF.n = n;
    viewF.sp += (clamp(26 / n, 2.15, 5) - viewF.sp) * Math.min(1, dt * 6);   // few runners: wide lanes and big buds
    const sp = viewF.sp, deep = n * sp, z0 = -deep / 2;
    lanes.forEach((m, i) => { m.visible = i < n; m.scale.y = sp; m.position.z = z0 + (i + 0.5) * sp; });
    for (const l of lines) l.scale.y = deep; finish.scale.y = deep; finish.material.map.repeat.set(1, deep / 20.8);
    castles.forEach((c) => { c.position.z = z0 - 1.9; }); fire.position.z = z0 - 1.2;
    fire.userData.flame.scale.set(1, 1 + Math.sin(T * 9) * 0.1, 1);
    foam.position.z = z0 - 5.2 + Math.sin(T * 1.3) * 0.8;
    foam.userData.rollers.forEach((m, i) => { const k = (T * 0.09 + i / 4) % 1; m.position.z = z0 - 30 + k * 24; m.material.opacity = 0.55 * Math.sin(k * Math.PI); });
    // the crab: back turned and eyes shut while it naps, a twitch when it stirs, then it spins round wide awake
    const yawTo = looking ? -0.75 : 2.45 + (stirring ? Math.sin(T * 26) * 0.18 : 0), lidTo = looking ? -0.9 : stirring ? 0.75 + Math.sin(T * 30) * 0.4 : 1.5, clawTo = looking ? 1 : 0;
    const snap = Math.min(1, dt * 14);
    crab.yaw += (yawTo - crab.yaw) * snap; crab.lid += (lidTo - crab.lid) * snap; crab.claw += (clawTo - crab.claw) * snap;
    crab.turn.rotation.y = crab.yaw; crab.turn.position.y = 0.55 + (looking ? 0.25 : Math.sin(T * 1.7) * 0.06);
    for (const e of crab.eyes) { e.lid.rotation.x = crab.lid; e.eye.rotation.z = stirring ? Math.sin(T * 28 + e.sd) * 0.14 : 0; }
    for (const c of crab.claws) { c.arm.rotation.z = -c.sd * lerp(1.15, 0.2, crab.claw); c.arm.rotation.x = lerp(0.5, -0.2, crab.claw); }
    const cx = crab.g.position.x, cz = crab.g.position.z;
    zzz.forEach((s, i) => { const k = (T * 0.45 + i / 3) % 1; s.visible = !looking && !stirring && game.phase !== 'done'; s.position.set(cx + 1.4 + k * 2, 5.6 + k * 3.2, cz); s.scale.setScalar(1.1 + k * 1.5); s.material.opacity = 1 - k; });
    bang.visible = looking; bang.position.set(cx, 8.6 + Math.abs(Math.sin(T * 12)) * 0.3, cz); bang.scale.setScalar(3.2);
    // the camera: the whole beach from the front; pulled back and lifted clear while the panel is up (the panel sits
    // bottom left, so the beach goes across the top)
    lens(24);
    const pitch = 0.62, mid = 5.6, d = fitDist(LEN / 2 + 12.6, (deep / 2 + 3.4) * Math.sin(pitch) + 2.2) * (1 + aside * 0.34);
    camera.position.set(mid, Math.sin(pitch) * d, Math.cos(pitch) * d - 1.6); camera.lookAt(mid, 0.6, -1.6);
    camera.setViewOffset(W, H, -W * 0.03 * aside, H * 0.25 * aside, W, H);
    const size = clamp(sp / 2.05, 0.95, 1.9), seen = new Set();
    run.forEach((r, i) => {
      const p = piece(r.id, sF); seen.add(r.id);
      const s = shown.get(r.id) || { p: r.p }; shown.set(r.id, s);
      const back = r.p < s.p - 0.004;                          // being washed back to its sandcastle
      s.p += (r.p - s.p) * Math.min(1, dt * (back ? 3.2 : 16));
      const x = X0 + s.p * LEN, z = z0 + (i + 0.5) * sp, mv = r.lobby ? (game.wiggle[r.id] || 0) : r.moving || 0;
      const hop = Math.abs(Math.sin(T * 15 + i * 1.7)) * 0.42 * mv;
      p.root.visible = p.tag.visible = true; p.stand.visible = true;
      p.root.scale.setScalar(size); p.root.position.set(x, 0.03 + hop + (back ? 0.5 : 0), z); faceCamera(p, x, z);
      const dizzy = !back && r.stun > 0;                       // washed up and seeing stars
      p.root.rotation.z = back ? T * 9 : dizzy ? Math.sin(T * 5 + i) * 0.35 : -0.2 * mv + Math.sin(T * 22 + i) * 0.07 * mv;
      const sq = 1 + Math.sin(T * 15 + i * 1.7) * 0.07 * mv; p.squash.scale.set(2 - sq, sq, 1);
      p.stand.position.set(x, 0.03, z); p.stand.scale.setScalar(size); p.ring.visible = false; p.aim.visible = false;
      const ts = lerp(1, 1.5, (size - 0.95) / 0.95); p.tag.scale.set(p.tag.userData.w * ts, 0.52 * ts, 1);
      p.tag.position.set(x - (BUD_W * 0.6 * size + p.tag.userData.w * ts / 2 + 0.3), 0.8 * size, z + 0.2);
      // the wave that carries it back
      let w = waves.get(r.id);
      if (back && !w) { w = new THREE.Group(); const blue = new THREE.Mesh(new THREE.SphereGeometry(1.25, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: toLinear('#6CC6EA'), transparent: true, opacity: 0.8, roughness: 0.2 })); blue.scale.set(1.3, 1.1, 0.9); const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); top.scale.set(1.8, 0.5, 1); top.position.set(-0.3, 1.25, 0); w.add(blue, top); sF.add(w); waves.set(r.id, w); splash(sF, x, z, 0); }
      if (w) { if (back) { w.position.set(x + 0.5, 0, z); w.scale.setScalar(size); } else { sF.remove(w); waves.delete(r.id); } }
      p.happy = game.phase === 'done' && game.winner === r.id; p.sleepy = dizzy;
      drawFace(p, T);
    });
    for (const id of [...shown.keys()]) if (!seen.has(id)) { shown.delete(id); const w = waves.get(id); if (w) { sF.remove(w); waves.delete(id); } }
    showOnly(sF, seen);
    return sF;
  }
  /* ============================== Island Grand Prix: a ring of land round a lagoon ============================== */
  const sK = newScene(sky('#8EC5FF', '#CFE9FF', '#EAF6FF'));
  const KT = kartTrack(), kartModels = new Map(), shotModels = new Map(), bubbleModels = [], padMats = [];
  const tbox = KT.pts.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), z0: Math.min(b.z0, p.z), z1: Math.max(b.z1, p.z) }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
  const viewK = { cx: 0, cz: 0, hw: 70, hd: 36, ready: false };
  const SPARK = ['#FFFFFF', '#FFD23F', '#FF7A1A', '#FF4FD8'];
  function canvasTex(w, h, draw, repeat = true) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }
  // a strip along the road from `a` to `b` metres right of the middle (negative: left), `every` metres per texture
  function ribbon(a, b, y, mat, every = 0) {
    const pos = [], uv = [], idx = [], N = KT.N;
    for (let i = 0; i <= N; i++) {
      const p = KT.pts[i % N], v = every ? (i * KT.step) / every : 0;
      pos.push(p.x + p.nx * a, y, p.z + p.nz * a, p.x + p.nx * b, y, p.z + p.nz * b); uv.push(0, v, 1, v);
      if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); sK.add(m); return m;
  }
  // something standing on the road s metres round and lat to the right, facing along it
  const onRoad = (obj, s, lat = 0, y = 0) => { const p = KT.at(s, lat); obj.position.set(p.x, y, p.z); obj.rotation.y = -Math.atan2(p.tz, p.tx); return obj; };
  function palm(x, z, s = 1) {
    const g = new THREE.Group(), trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 3.6, 7), M('#A47551')); trunk.position.y = 1.8; trunk.rotation.z = 0.12; g.add(trunk);
    for (let k = 0; k < 6; k++) { const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.4, 5), M('#5FB36A', { flatShading: true })); const a = k / 6 * Math.PI * 2; leaf.position.set(Math.cos(a) * 0.95 + 0.2, 3.7, Math.sin(a) * 0.95); leaf.rotation.set(Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25); g.add(leaf); }
    g.position.set(x, 0, z); g.scale.setScalar(s); sK.add(g); return g;
  }
  {
    sK.add(flat(new THREE.PlaneGeometry(600, 400), M('#5DBDE6', { roughness: 0.3 }), -0.7));
    const edge = KT.HW + KT.SAND;
    ribbon(-edge - 1.6, edge + 1.6, -0.45, M('#D9C08C', { roughness: 1 }));                 // the wet sand at the water's edge
    ribbon(-edge, edge, -0.04, M('#EBD9A8', { roughness: 1 }));                              // the sand
    ribbon(-KT.HW - 1.4, KT.HW + 1.4, -0.02, M('#86CF86', { roughness: 1 }));                // a strip of grass
    const road = canvasTex(128, 256, (g, w, h) => {
      g.fillStyle = '#8F8BA8'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '40,30,70'},${0.04 + Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      g.fillStyle = '#FFFFFF'; g.fillRect(5, 0, 5, h); g.fillRect(w - 10, 0, 5, h);
      g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(w / 2 - 2, 0, 4, h * 0.5);
    });
    ribbon(-KT.HW, KT.HW, 0, new THREE.MeshStandardMaterial({ map: road, roughness: 0.9 }), 7);
    const curb = canvasTex(8, 64, (g, w, h) => { g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h); g.fillStyle = '#E8394B'; g.fillRect(0, 0, w, h / 2); });
    const curbMat = new THREE.MeshStandardMaterial({ map: curb, roughness: 0.8 });
    ribbon(KT.HW, KT.HW + 0.7, 0.01, curbMat, 2.4); ribbon(-KT.HW - 0.7, -KT.HW, 0.01, curbMat, 2.4);
    // the start: a checkered line and an arch over the road
    const check = canvasTex(64, 16, (g, w, h) => { for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#1D1C2B' : '#FFFFFF'; g.fillRect(x * 8, y * 8, 8, 8); } }, false);
    check.magFilter = THREE.NearestFilter;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1.4, KT.HW * 2), new THREE.MeshBasicMaterial({ map: check })); line.rotation.x = -Math.PI / 2; line.rotation.z = Math.PI / 2;
    const lineG = new THREE.Group(); lineG.add(line); line.position.y = 0.02; onRoad(lineG, 0); sK.add(lineG);
    const arch = new THREE.Group(), post = M('#FFFFFF', { roughness: 0.6 });
    for (const sd of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 4.6, 10), post); p.position.set(0, 2.3, sd * (KT.HW + 1.1)); arch.add(p); }
    const sign = canvasTex(512, 96, (g, w, h) => { g.fillStyle = '#FF7A59'; g.fillRect(0, 0, w, h); g.fillStyle = '#FFFFFF'; g.font = '700 54px Fredoka, Nunito, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ISLAND GRAND PRIX', w / 2, h / 2 + 3); }, false);
    const signMat = new THREE.MeshBasicMaterial({ map: sign });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, KT.HW * 2 + 2.6), [signMat, signMat, post, post, post, post]);
    banner.position.y = 4.6; arch.add(banner); onRoad(arch, -0.6); sK.add(arch);
    // boost pads: arrows that glow and run forward
    for (const p of KT.pads) {
      const tex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#FFB22E'; g.fillRect(0, 0, w, h); g.strokeStyle = '#FFF4C2'; g.lineWidth = 9; g.lineJoin = 'round'; g.beginPath(); g.moveTo(10, 44); g.lineTo(32, 20); g.lineTo(54, 44); g.stroke(); });
      const mat = new THREE.MeshBasicMaterial({ map: tex }); tex.repeat.set(1, 2); padMats.push(tex);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.2), mat); m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.PI / 2; m.position.y = 0.03;
      const g = new THREE.Group(); g.add(m); onRoad(g, p.s, p.lat); sK.add(g);
    }
    // gift bubbles
    for (const b of KT.bubbles) {
      const g = new THREE.Group(), p = KT.at(b.s, b.lat);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1.05, 24, 16), new THREE.MeshStandardMaterial({ color: toLinear('#A8E4FF'), transparent: true, opacity: 0.38, roughness: 0.1, depthWrite: false }));
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })); shine.position.set(-0.4, 0.45, 0.55);
      const box = new THREE.Group(), gift = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.72, 0.85), M('#FF5FA2', { roughness: 0.5 }));
      const r1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.76, 0.18), M('#FFE08A')), r2 = r1.clone(); r2.rotation.y = Math.PI / 2;
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.07, 6, 12), M('#FFE08A')); bow.position.y = 0.44;
      box.add(gift, r1, r2, bow); g.add(ball, shine, box); g.position.set(p.x, 1.05, p.z); sK.add(g);
      bubbleModels.push({ g, box, seed: Math.random() * 6 });
    }
    // palms and umbrellas on the sand, rocks and lily pads in the water
    for (let s = 6, k = 0; s < KT.L; s += 17, k++) {
      const side = k % 2 ? 1 : -1, p = KT.at(s, side * (KT.HW + KT.SAND - 1.6));
      if (k % 3 === 2) {
        const u = new THREE.Group(), pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), M('#FFFFFF')); pole.position.y = 1.3; u.add(pole);
        const top = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.7, 10), M(['#FF7EB6', '#4FB3FF', '#FFE08A'][k % 3])); top.position.y = 2.6; u.add(top);
        u.position.set(p.x, 0, p.z); sK.add(u);
      } else palm(p.x, p.z, 0.9 + (k % 3) * 0.15);
    }
    const rock = M('#A9A7B8', { roughness: 1, flatShading: true });
    for (const [x, z, r] of [[-8, 4, 1.6], [-6, 7, 0.9], [30, 4, 1.2], [-40, -6, 1.4], [70, 10, 2], [-74, 20, 1.8], [8, -40, 1.5], [52, -36, 1.2]]) { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rock); m.position.set(x, -0.5, z); m.rotation.set(x, z, r); m.scale.y = 0.6; sK.add(m); }
    for (const [x, z] of [[-20, 6], [-17, 9], [-24, 2], [20, 8], [24, 4], [-30, -2]]) { const pad = flat(new THREE.CircleGeometry(0.9, 16, 0.3, Math.PI * 2 - 0.6), M('#5FB36A'), -0.66); pad.position.set(x, -0.66, z); sK.add(pad); }
    const isle = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 1, 24), M('#EBD9A8', { roughness: 1 })); isle.position.set(-12, -0.6, 5); sK.add(isle); palm(-12.5, 4.6, 1.2); palm(-10.4, 6, 0.9);
  }
  // A kart, built facing +x: a rounded tub in the driver's color, four fat wheels, a little spoiler.
  function makeKart(id) {
    const color = colorFor(id), paint = M(color, { roughness: 0.45, metalness: 0.05 }), dark = M('#2A2838', { roughness: 0.8 }), white = M('#FFFFFF', { roughness: 0.5 });
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const tub = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.42, 1.25), paint); tub.position.y = 0.48; body.add(tub);
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.42, 16, 1, false, 0, Math.PI), paint); nose.rotation.y = Math.PI / 2; nose.scale.set(1, 1, 0.75); nose.position.set(1.0, 0.48, 0); body.add(nose);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 1.35), white); bumper.position.set(1.42, 0.36, 0); body.add(bumper);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.65, 0.9), dark); seat.position.set(-0.62, 0.86, 0); body.add(seat);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 1.45), paint); fin.position.set(-1.05, 1.12, 0); body.add(fin);
    for (const sd of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.08), dark); st.position.set(-1.0, 0.9, sd * 0.5); body.add(st); }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.1, 0.3), white); stripe.position.set(0, 0.7, 0); body.add(stripe);
    const wheels = [];
    for (const [x, z] of [[0.72, 0.72], [0.72, -0.72], [-0.7, 0.74], [-0.7, -0.74]]) {
      const w = new THREE.Group(), tyre = new THREE.Mesh(new THREE.CylinderGeometry(x > 0 ? 0.3 : 0.36, x > 0 ? 0.3 : 0.36, 0.34, 14), dark); tyre.rotation.x = Math.PI / 2;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.36, 10), white); hub.rotation.x = Math.PI / 2; w.add(tyre, hub);
      w.position.set(x, x > 0 ? 0.3 : 0.36, z); body.add(w); wheels.push(w);
    }
    const shadow = flat(new THREE.PlaneGeometry(2.6, 1.7), new THREE.MeshBasicMaterial({ color: 0x1E193C, transparent: true, opacity: 0.22, depthWrite: false }), 0.03); g.add(shadow);
    const shield = new THREE.Mesh(new THREE.SphereGeometry(1.75, 24, 16), new THREE.MeshStandardMaterial({ color: toLinear('#BDEBFF'), transparent: true, opacity: 0.32, roughness: 0.1, depthWrite: false })); shield.position.y = 1; shield.visible = false;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.2, 10), new THREE.MeshBasicMaterial({ color: 0xFF9A3E, transparent: true, opacity: 0.85 })); flame.rotation.z = Math.PI / 2; flame.position.set(-1.65, 0.5, 0); flame.visible = false;
    const floatie = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.32, 10, 24), M('#FF7A59', { roughness: 0.5 })); floatie.rotation.x = Math.PI / 2; floatie.position.y = 0.55; floatie.visible = false;
    const balloon = new THREE.Group(), ball = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), M(color, { roughness: 0.3 })); ball.scale.y = 1.15; ball.position.y = 4.1;
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.6, 4), white); str.position.y = 2.6; balloon.add(ball, str); balloon.visible = false;
    body.add(shield, flame, floatie);
    g.add(balloon); sK.add(g);
    // the item it's holding (or rolling for), over its head
    const item = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false })); item.renderOrder = 11; item.visible = false; sK.add(item);
    const m = { g, body, wheels, shield, flame, floatie, balloon, item, itemKey: '', sparkT: 0, splashed: false };
    kartModels.set(id, m);
    return m;
  }
  const iconTex = new Map();
  function icon(ch) {
    if (!iconTex.has(ch)) iconTex.set(ch, canvasTex(96, 96, (g, w, h) => { g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.arc(w / 2, h / 2, 44, 0, 7); g.fill(); g.font = '56px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, w / 2, h / 2 + 3); }, false));
    return iconTex.get(ch);
  }
  function makeShot(sh) {
    let g;
    if (sh.kind === 'coconut') {
      g = new THREE.Group(); const nut = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), M('#7A4E2D', { roughness: 0.95 }));
      for (let i = 0; i < 3; i++) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), M('#3A2416')); const a = i * 2.1; eye.position.set(Math.cos(a) * 0.12, 0.42, Math.sin(a) * 0.12); nut.add(eye); }
      g.add(nut); g.userData.spin = nut;
    } else if (sh.kind === 'jelly') {
      g = new THREE.Group(); const blob = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: toLinear('#FF7EB6'), roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.88 }));
      blob.scale.y = 0.9; const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), M('#E8394B', { roughness: 0.3 })); cherry.position.y = 0.76;
      g.add(blob, cherry); g.userData.blob = blob;
    } else {
      g = new THREE.Group(); const white = M('#FFFFFF', { roughness: 0.6 }), grey = M('#A9A7B8');
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), white); body.scale.set(1.6, 0.8, 0.8); g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), white); head.position.set(0.6, 0.25, 0); g.add(head);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.36, 8), M('#FFB22E')); beak.rotation.z = -Math.PI / 2; beak.position.set(0.95, 0.22, 0); g.add(beak);
      const wings = [];
      for (const sd of [-1, 1]) { const w = new THREE.Group(), wing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 1.1), grey); wing.position.z = sd * 0.55; w.add(wing); g.add(w); wings.push({ w, sd }); }
      g.userData.wings = wings;
    }
    sK.add(g);
    return g;
  }
  function kartSparks(m, k, T) {
    // drift sparks from the back wheels, in the color of how charged the boost is
    const tier = KART.CHARGE.filter((c) => k.charge >= c).length;
    m.sparkT -= 1;
    if (m.sparkT > 0) return; m.sparkT = 2;
    const c = Math.cos(k.h), s = Math.sin(k.h);
    for (const sd of [-1, 1]) {
      const x = k.x - c * 0.9 - s * sd * 0.75, z = k.z - s * 0.9 + c * sd * 0.75;
      bit(sK, new THREE.Mesh(new THREE.OctahedronGeometry(tier ? 0.16 : 0.1), new THREE.MeshBasicMaterial({ color: toLinear(SPARK[tier]), transparent: true, depthWrite: false })), { x, y: 0.2, z, vx: -c * 3 + (Math.random() - 0.5) * 3, vz: -s * 3 + (Math.random() - 0.5) * 3, vy: 1.5 + Math.random() * 2, g: 9, life: 0.35 });
    }
  }
  // karts and their buds are drawn a bit bigger than they bump (so they read across a room); name tags grow
  // with how far back the camera is
  const KSCALE = 1.3;
  function drawKart(game, T, dt, aside) {
    const tagK = clamp(camera.position.distanceTo(new THREE.Vector3(viewK.cx, 0, viewK.cz)) / 38, 1.2, 3.4);
    const K = KART, live = new Set();
    padMats.forEach((t) => { t.offset.y = -T * 1.6; });
    bubbleModels.forEach((b, i) => {
      const st = game.bubbles[i], on = !st.wait, k = on ? 1 : Math.max(0, 1 - st.wait / 0.25) * 0;
      const target = on ? 1 : 0.001; b.g.scale.setScalar(lerp(b.g.scale.x, target, Math.min(1, dt * (on ? 6 : 30))));
      b.g.position.y = 1.05 + Math.sin(T * 2 + b.seed) * 0.15; b.box.rotation.y = T * 1.4 + b.seed; void k;
    });
    for (const k of game.racers()) {
      live.add(k.id);
      const m = kartModels.get(k.id) || makeKart(k.id), p = piece(k.id, sK);
      let y = 0, yaw = -k.h, roll = 0;
      if (k.hop > 0) y += Math.sin((k.hop / 0.22) * Math.PI) * 0.35;
      if (k.drift) { yaw -= k.drift * 0.38; roll = k.drift * 0.08; }
      if (k.spinT > 0) yaw += (1 - k.spinT / K.SPIN) * Math.PI * 4;
      if (k.sinkT > 0) { const f = 1 - k.sinkT / K.SINK; y = -f * 1.6; roll = f * 0.6; if (!m.splashed) { m.splashed = true; splash(sK, k.x, k.z, -0.65); } } else m.splashed = false;
      const falling = k.floatT > 0;
      if (falling) { const f = k.floatT / K.FLOAT; y = f * f * 5 + Math.sin(T * 6) * 0.05; }
      m.g.position.set(k.x, y, k.z); m.body.rotation.set(roll, 0, k.boostT > 0 ? 0.05 : 0); m.g.rotation.y = yaw; m.g.scale.setScalar(KSCALE);
      m.wheels.forEach((w) => { w.children[0].rotation.y += k.v * dt * 2.6; });
      m.shield.visible = k.shieldT > 0; if (m.shield.visible) m.shield.scale.setScalar(1 + Math.sin(T * 8) * 0.03);
      m.flame.visible = k.boostT > 0 && k.sinkT <= 0; if (m.flame.visible) m.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
      m.floatie.visible = falling; m.balloon.visible = falling; m.balloon.position.set(0, 0, 0);
      if (k.drift && k.sinkT <= 0) kartSparks(m, k, T);
      if (k.boostT > 0 && Math.random() < 0.5) puffK(k.x - Math.cos(k.h) * 1.5, k.z - Math.sin(k.h) * 1.5);
      // the bud in the seat, leaning into turns and facing the room
      p.root.visible = true; p.stand.visible = false; p.tag.visible = k.sinkT <= 0;
      p.root.scale.setScalar(1.05 * KSCALE);
      const sx = k.x - Math.cos(k.h) * 0.26, sz = k.z - Math.sin(k.h) * 0.26, seatY = y + 0.62 * KSCALE;
      p.root.position.set(sx, seatY, sz); faceCamera(p, sx, sz);
      p.root.rotation.z = clamp(-k.turn * 0.09, -0.3, 0.3) + (k.spinT > 0 ? Math.sin(T * 20) * 0.3 : 0);
      p.squash.scale.set(1, 1, 1);
      const tagY = seatY + p.height * 1.05 * KSCALE + 0.35 * tagK;
      p.tag.scale.set(p.tag.userData.w * tagK, 0.52 * tagK, 1); p.tag.position.set(sx, tagY, sz);
      p.happy = (game.phase === 'done' && game.champs?.includes(k.id)) || k.boostT > 0 || k.fin != null; p.sleepy = k.spinT > 0;
      drawFace(p, T);
      // the item over its head
      const show = k.roll ? 'roll' : k.item || '';
      m.item.visible = !!show && k.sinkT <= 0;
      if (show) {
        const ch = show === 'roll' ? ['☕', '🥥', '🍮', '🫧', '🐦'][Math.floor(T * 12) % 5] : KART_ITEMS[show]?.icon || '?';
        if (m.itemKey !== ch) { m.itemKey = ch; m.item.material.map = icon(ch); m.item.material.needsUpdate = true; }
        m.item.scale.setScalar(0.95 * tagK); m.item.position.set(sx + (p.tag.userData.w / 2 + 0.6) * tagK, tagY, sz);
      }
    }
    for (const [id, m] of kartModels) if (!live.has(id)) { sK.remove(m.g); sK.remove(m.item); kartModels.delete(id); }
    showOnly(sK, live);
    // things in flight
    const shots = new Set(game.shots);
    for (const sh of game.shots) {
      let g = shotModels.get(sh); if (!g) { g = makeShot(sh); shotModels.set(sh, g); }
      if (sh.kind === 'coconut') { g.position.set(sh.x, 0.45, sh.z); g.userData.spin.rotation.z -= dt * 14; const p = KT.at(sh.s); g.rotation.y = -Math.atan2(p.tz, p.tx); }
      else if (sh.kind === 'jelly') { g.position.set(sh.x, 0.02, sh.z); const w = 1 + Math.sin(T * 9 + sh.x) * 0.06; g.userData.blob.scale.set(w, 0.9 / w, w); }
      else { const f = sh.f || 0; g.position.set(sh.x, 3 + Math.sin(f * Math.PI) * 3 - f * 2, sh.z); g.userData.wings.forEach(({ w, sd }) => { w.rotation.x = sd * Math.sin(T * 18) * 0.6; }); const tk = game.karts.get(sh.target); if (tk) g.rotation.y = -Math.atan2(tk.z - sh.fz, tk.x - sh.fx); }
    }
    for (const [sh, g] of shotModels) if (!shots.has(sh)) { sK.remove(g); shotModels.delete(sh); }
    // the camera: the whole track while waiting; in a race it frames the pack and pulls back as it spreads out
    lens(32);
    const pitch = 1.0, all = game.racers().filter((k) => k.sinkT <= 0);
    let bx0 = tbox.x0, bx1 = tbox.x1, bz0 = tbox.z0, bz1 = tbox.z1;
    if (game.phase === 'play' && all.length) {
      bx0 = Math.min(...all.map((k) => k.x)) - 12; bx1 = Math.max(...all.map((k) => k.x)) + 12; bz0 = Math.min(...all.map((k) => k.z)) - 9; bz1 = Math.max(...all.map((k) => k.z)) + 9;
      const minW = 32, minD = 18, cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
      if (bx1 - bx0 < minW * 2) { bx0 = cx - minW; bx1 = cx + minW; }
      if (bz1 - bz0 < minD * 2) { bz0 = cz - minD; bz1 = cz + minD; }
    }
    const want = { cx: (bx0 + bx1) / 2, cz: (bz0 + bz1) / 2, hw: Math.min((bx1 - bx0) / 2, (tbox.x1 - tbox.x0) / 2 + 10), hd: Math.min((bz1 - bz0) / 2, (tbox.z1 - tbox.z0) / 2 + 9) };
    const ease = viewK.ready ? Math.min(1, dt * 1.4) : 1; viewK.ready = true;
    for (const key of ['cx', 'cz', 'hw', 'hd']) viewK[key] += (want[key] - viewK[key]) * ease;
    // (with the panel up on the left, the track fits in the right two thirds)
    const d = fitDist(viewK.hw + 2, viewK.hd * Math.sin(pitch) + 2) * (1 + aside * 0.85);
    camera.position.set(viewK.cx, Math.sin(pitch) * d, viewK.cz + Math.cos(pitch) * d); camera.lookAt(viewK.cx, 0, viewK.cz);
    camera.setViewOffset(W, H, -W * 0.18 * aside, H * 0.02 * aside, W, H);
    return sK;
  }
  function puffK(x, z) { bit(sK, new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), puffMat()), { x, y: 0.5, z, vy: 0.8, life: 0.4, grow: 1.4 }); }
  function popK(x, z, color = '#BDEBFF') { for (let i = 0; i < 10; i++) { const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 3; bit(sK, new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshBasicMaterial({ color: toLinear(color), transparent: true, depthWrite: false })), { x, y: 1, z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 2 + Math.random() * 3, g: 10, life: 0.5 }); } }

  // back on the island after a round on the beach: stand up straight, full size, ring and all
  function reset(p) { p.root.scale.setScalar(1); p.stand.scale.setScalar(1); p.ring.visible = true; p.aim.visible = true; p.root.rotation.z = 0; p.squash.scale.set(1, 1, 1); p.tag.scale.set(p.tag.userData.w, 0.52, 1); }

  let lastKind = null;
  function render(kind, game, T, dt, aside, roster) {
    if (kind !== lastKind) { lastKind = kind; for (const p of pieces.values()) reset(p); for (const [id, w] of waves) { sF.remove(w); waves.delete(id); } shown.clear(); }
    const scene = kind === 'freeze' ? drawFreeze(game, T, dt, aside, roster) : kind === 'kart' ? drawKart(game, T, dt, aside) : drawBumper(game, T, dt, aside);
    bitsTick(dt);
    if (!skip) renderer.render(scene, camera);
  }
  addEventListener('resize', resize); resize();
  return {
    render, resize, drop,
    spark: (x, z, power) => spark(x, z, power, lastKind === 'kart' ? sK : sB),
    // kart race effects: a popped bubble or shield, a jelly splat, a splash
    pop: (x, z, color) => popK(x, z, color), splashK: (x, z) => splash(sK, x, z, -0.65),
    forget(ids) { for (const id of [...pieces.keys()]) if (!ids.has(id)) drop(id); },     // people who've left
    refresh(id) { drop(id); },                                                            // their bud's drawing arrived: build it again
    set skip(v) { skip = !!v; },
    pieces, camera,
  };
}
