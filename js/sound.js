// bud's sounds, made on the fly with Web Audio: no audio files to download.
// Every bud has its own babble voice (pitched from its name), plus little pops, boings and squishes.
// Browsers only allow sound after you tap or press something, so nothing plays before that.
// window.BudSound.play(name, opts) · .babble(text, seed, opts) · .ambient(on) · .muted / .setMuted(bool)
(function () {
  const KEY = 'bud-sound';
  let ctx = null, master = null, unlocked = false, muted = false, noiseBuf = null, amb = null, babbling = 0;
  try { muted = localStorage.getItem(KEY) === 'off'; } catch (e) {}
  const listeners = new Set();

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (!unlocked) { unlocked = true; listeners.forEach((f) => f()); }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((t) => addEventListener(t, unlock, { capture: true, passive: true }));

  const ready = () => ctx && unlocked && !muted && ctx.state === 'running';
  const now = () => ctx.currentTime;

  // one shaped tone: type, start/end pitch, length, volume
  function tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.12, gain = 0.3, at = 0, attack = 0.005, filter = 0, vib = 0, dest = master }) {
    const t = now() + at, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    if (vib) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = vib; lg.gain.value = f0 * 0.06; lfo.connect(lg); lg.connect(o.frequency);
      lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); node = f; }
    node.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // a burst of filtered noise: swishes, slaps, shutters, wind
  function noise({ dur = 0.15, gain = 0.2, at = 0, type = 'bandpass', f0 = 1200, f1 = f0, q = 1, attack = 0.004, dest = master }) {
    const t = now() + at, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  const SOUNDS = {
    pop: (v) => tone({ f0: 520 * v.rate, f1: 980 * v.rate, dur: 0.09, gain: 0.22 * v.gain }),
    click: (v) => tone({ type: 'triangle', f0: 1400 * v.rate, f1: 900 * v.rate, dur: 0.04, gain: 0.12 * v.gain }),
    squish: (v) => { tone({ f0: 320 * v.rate, f1: 120 * v.rate, dur: 0.16, gain: 0.32 * v.gain, filter: 900 }); noise({ dur: 0.1, gain: 0.08 * v.gain, f0: 600, q: 2 }); },
    boing: (v) => tone({ type: 'triangle', f0: 180 * v.rate, f1: 520 * v.rate, dur: 0.22, gain: 0.2 * v.gain, vib: 22, filter: 2400 }),
    thump: (v) => { tone({ f0: 110, f1: 42, dur: 0.28, gain: 0.5 * v.gain }); noise({ dur: 0.18, gain: 0.12 * v.gain, type: 'lowpass', f0: 900, f1: 200 }); },
    whoosh: (v) => noise({ dur: 0.55, gain: 0.16 * v.gain, f0: 300, f1: 2600, q: 0.8, attack: 0.12 }),
    slap: (v) => { noise({ dur: 0.07, gain: 0.32 * v.gain, f0: 2200, q: 1.4 }); tone({ f0: 240, f1: 140, dur: 0.06, gain: 0.12 * v.gain }); },
    shutter: (v) => { noise({ dur: 0.05, gain: 0.35 * v.gain, f0: 4200, q: 2 }); noise({ dur: 0.06, gain: 0.3 * v.gain, f0: 3000, q: 2, at: 0.09 }); },
    tick: (v) => tone({ f0: 880 * v.rate, dur: 0.08, gain: 0.18 * v.gain }),
    chime: (v) => [0, 0.09, 0.18].forEach((at, i) => tone({ type: 'triangle', f0: [659, 784, 1047][i] * v.rate, dur: 0.35, gain: 0.14 * v.gain, at })),
    ding: (v) => { tone({ f0: 1175 * v.rate, dur: 0.5, gain: 0.14 * v.gain }); tone({ f0: 1568 * v.rate, dur: 0.4, gain: 0.08 * v.gain, at: 0.05 }); },
    giggle: (v) => [0, 0.07, 0.14, 0.21].forEach((at, i) => tone({ type: 'triangle', f0: (620 + i * 90) * v.rate, f1: (700 + i * 90) * v.rate, dur: 0.06, gain: 0.12 * v.gain, at })),
    snore: (v) => tone({ f0: 140 * v.rate, f1: 110 * v.rate, dur: 0.7, gain: 0.08 * v.gain, attack: 0.25, vib: 6, filter: 500 }),
    paint: (v) => noise({ dur: 0.12, gain: 0.05 * v.gain, f0: 2600, f1: 1800, q: 0.7, attack: 0.03 }),
    splash: (v) => { noise({ dur: 0.4, gain: 0.22 * v.gain, f0: 1800, f1: 500, q: 0.9 }); tone({ f0: 300, f1: 90, dur: 0.25, gain: 0.18 * v.gain }); },
    sparkle: (v) => [0, 0.06, 0.12, 0.2].forEach((at, i) => tone({ f0: [1319, 1568, 1976, 2637][i] * v.rate, dur: 0.18, gain: 0.07 * v.gain, at })),
    alert: (v) => { tone({ f0: 700 * v.rate, f1: 1200 * v.rate, dur: 0.08, gain: 0.16 * v.gain }); tone({ f0: 900 * v.rate, f1: 1500 * v.rate, dur: 0.1, gain: 0.14 * v.gain, at: 0.09 }); },
  };

  function play(name, opts = {}) {
    if (!ready() || !SOUNDS[name]) return;
    const v = { gain: opts.gain ?? 1, rate: opts.rate ?? (0.94 + Math.random() * 0.12) };
    if (v.gain < 0.03) return;
    try { SOUNDS[name](v); } catch (e) {}
  }

  // A bud's voice: little syllables, one per couple of letters, pitched around a base set by its name.
  function voiceOf(seed) {
    let h = 2166136261;
    for (const ch of String(seed || 'bud')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    h >>>= 0;
    return { base: 300 + (h % 260), wave: ['triangle', 'sine', 'square'][(h >> 9) % 3], tilt: ((h >> 13) % 3) - 1 };
  }
  function babble(text, seed, opts = {}) {
    if (!ready() || !text) return;
    const gain = opts.gain ?? 1;
    if (gain < 0.05 || babbling >= 3) return;   // a crowd of buds talking at once just becomes noise
    const voice = voiceOf(seed), letters = String(text).replace(/[^a-z0-9]/gi, '');
    const syll = Math.min(14, Math.max(2, Math.round(letters.length / 2.4)));
    const question = /\?\s*$/.test(text), excited = /!\s*$/.test(text);
    const step = excited ? 0.075 : 0.088;
    babbling++;
    setTimeout(() => { babbling--; }, syll * step * 1000 + 200);
    for (let i = 0; i < syll; i++) {
      const c = letters.charCodeAt(Math.floor(i * letters.length / syll)) || 97;
      let f = voice.base * (0.85 + ((c * 7) % 13) / 30) * (excited ? 1.12 : 1);
      if (question && i >= syll - 2) f *= 1.25 + (i - syll + 2) * 0.12;   // up at the end of a question
      f *= 1 + voice.tilt * 0.04 * (i / syll);
      tone({ type: voice.wave, f0: f, f1: f * (0.92 + Math.random() * 0.14), dur: 0.06, gain: (voice.wave === 'square' ? 0.05 : 0.11) * gain, at: i * step + Math.random() * 0.012, attack: 0.008, filter: voice.wave === 'square' ? 1800 : 3200 });
    }
  }

  // Island background: soft wind and the odd bird.
  function ambient(on) {
    if (!on) {
      if (amb) { try { amb.g.gain.setTargetAtTime(0.0001, now(), 0.4); setTimeout(() => { try { amb.src.stop(); } catch (e) {} }, 1500); clearTimeout(amb.bird); } catch (e) {} amb = null; }
      return;
    }
    if (amb || !ready()) return;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.6;
    lfo.frequency.value = 0.07; lg.gain.value = 180; lfo.connect(lg); lg.connect(f.frequency);
    g.gain.value = 0.0001; g.gain.setTargetAtTime(0.035, now(), 2);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(); lfo.start();
    amb = { src, g };
    const bird = () => {
      if (!amb) return;
      if (ready()) {
        const base = 2200 + Math.random() * 1400, n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) tone({ f0: base, f1: base * (1.15 + Math.random() * 0.3), dur: 0.07, gain: 0.025, at: i * 0.11 });
      }
      amb.bird = setTimeout(bird, 7000 + Math.random() * 12000);
    };
    amb.bird = setTimeout(bird, 4000);
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(KEY, muted ? 'off' : 'on'); } catch (e) {}
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.55, now(), 0.05);
    listeners.forEach((f) => f());
  }

  // a speaker button: <button class="... sound-toggle"> gets its icon and state kept in sync
  const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m17 9 5 5M22 9l-5 5"/></svg>';
  function bindToggle(btn) {
    const sync = () => {
      btn.innerHTML = muted ? ICON_OFF : ICON_ON;
      btn.setAttribute('aria-pressed', String(!muted));
      btn.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
      btn.title = muted ? 'Sound off' : 'Sound on';
    };
    btn.addEventListener('click', () => { unlock(); setMuted(!muted); if (!muted) play('pop'); });
    listeners.add(sync); sync();
  }

  window.BudSound = {
    play, babble, ambient, setMuted, bindToggle, onChange: (f) => listeners.add(f),
    get muted() { return muted; }, get ready() { return ready(); },
  };
})();
