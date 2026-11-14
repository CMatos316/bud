// The TV's picture for Bumper Buds and Freeze, in 3D: the same puffy buds as on the island and in Island Race
// (built by js/bud-core.js from each bud's outline and paint), on an island you can fall off and a beach with a
// crab at the end of it. It only draws: js/party-games.js decides what happens, js/party-tv.js runs the show.
// Needs THREE and Delaunator loaded as globals first (party.html does that on the TV only).
import { setExtents, buildMesh, drawEyeStyle, clamp } from '/js/bud-core.js';
import { BUMPER, FREEZE } from '/js/party-games.js';

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
  function spark(x, z, power) {
    for (let i = 0; i < 5 + Math.round(power * 7); i++) { const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5 * (0.4 + power); bit(sB, new THREE.Mesh(new THREE.OctahedronGeometry(0.1 + Math.random() * 0.1), puffMat()), { x, y: 0.9, z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 1 + Math.random() * 3, g: 8, life: 0.4 }); }
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
  // back on the island after a round on the beach: stand up straight, full size, ring and all
  function reset(p) { p.root.scale.setScalar(1); p.stand.scale.setScalar(1); p.ring.visible = true; p.aim.visible = true; p.root.rotation.z = 0; p.squash.scale.set(1, 1, 1); p.tag.scale.set(p.tag.userData.w, 0.52, 1); }

  let lastKind = null;
  function render(kind, game, T, dt, aside, roster) {
    if (kind !== lastKind) { lastKind = kind; for (const p of pieces.values()) reset(p); for (const [id, w] of waves) { sF.remove(w); waves.delete(id); } shown.clear(); }
    const scene = kind === 'freeze' ? drawFreeze(game, T, dt, aside, roster) : drawBumper(game, T, dt, aside);
    bitsTick(dt);
    if (!skip) renderer.render(scene, camera);
  }
  addEventListener('resize', resize); resize();
  return {
    render, resize, spark, drop,
    forget(ids) { for (const id of [...pieces.keys()]) if (!ids.has(id)) drop(id); },     // people who've left
    refresh(id) { drop(id); },                                                            // their bud's drawing arrived: build it again
    set skip(v) { skip = !!v; },
    pieces, camera,
  };
}
