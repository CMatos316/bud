// bud's sounds, made on the fly with Web Audio: no audio files to download.
// Every bud has its own babble voice (pitched from its name), plus little pops, boings and squishes.
// Browsers only allow sound after you tap or press something, so nothing plays before that.
// window.BudSound.play(name, opts) · .babble(text, seed, opts) · .ambient(on) · .weather({ rain, wind, snow }) · .muted / .setMuted(bool)
// .music(on, { mood }) · .bindPanel(button): island music that comes and goes by itself, and a panel of sound settings.
// Sounds go through three mixers so they can be turned down separately: nature (wind, rain, birds, thunder),
// voices (bud babble) and music. While a piece of music plays, nature and voices dip so it can be heard.
(function () {
  const KEY = 'bud-sound';
  let ctx = null, master = null, unlocked = false, muted = false, noiseBuf = null, amb = null, babbling = 0, night = false, wxNow = { rain: 0, wind: 0, snow: 0 };
  let natureBus = null, voiceBus = null, musicBus = null, route = null, ducked = false;
  try { muted = localStorage.getItem(KEY) === 'off'; } catch (e) {}
  // each person's own settings, kept in this browser: music 'off' | 'some' | 'always', nature 0..1, voices 0..1
  const PREFS = 'bud-sound-prefs';
  const prefs = { music: 'some', nature: 1, voices: 1 };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS) || '{}')); } catch (e) {}
  const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) {} };
  const listeners = new Set();

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    natureBus = ctx.createGain(); voiceBus = ctx.createGain(); musicBus = ctx.createGain();
    natureBus.connect(master); voiceBus.connect(master); musicBus.connect(master);
    mixLevels(true);
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
  // the three mixers' levels: your settings, and a dip in nature and voices while music plays
  function mixLevels(now_ = false) {
    if (!ctx) return;
    const set = (g, v) => (now_ ? (g.gain.value = v) : g.gain.setTargetAtTime(v, ctx.currentTime, 0.8));
    set(natureBus, prefs.nature * (ducked ? 0.4 : 1));
    set(voiceBus, prefs.voices * (ducked ? 0.6 : 1));
    set(musicBus, 0.9);
  }
  const now = () => ctx.currentTime;

  // one shaped tone: type, start/end pitch, length, volume
  function tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.12, gain = 0.3, at = 0, attack = 0.005, filter = 0, vib = 0, dest = route || master }) {
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
  function noise({ dur = 0.15, gain = 0.2, at = 0, type = 'bandpass', f0 = 1200, f1 = f0, q = 1, attack = 0.004, dest = route || master }) {
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
    scribble: (v) => [0, 0.07, 0.15, 0.24, 0.31, 0.4].forEach((at, i) => noise({ dur: 0.05, gain: 0.05 * v.gain, f0: 2800 + (i % 3) * 500, q: 3, at })),
    alert: (v) => { tone({ f0: 700 * v.rate, f1: 1200 * v.rate, dur: 0.08, gain: 0.16 * v.gain }); tone({ f0: 900 * v.rate, f1: 1500 * v.rate, dur: 0.1, gain: 0.14 * v.gain, at: 0.09 }); },
    // something falling from high up: a whistle sliding down
    whistle: (v) => { tone({ type: 'triangle', f0: 1500 * v.rate, f1: 520 * v.rate, dur: 0.6, gain: 0.07 * v.gain, attack: 0.05, filter: 3000 }); tone({ f0: 1520 * v.rate, f1: 540 * v.rate, dur: 0.6, gain: 0.04 * v.gain, attack: 0.05 }); },
    // a far-off rumble: low noise that rolls in and dies away
    thunder: (v) => { noise({ dur: 3.2, gain: 0.3 * v.gain, type: 'lowpass', f0: 320, f1: 70, attack: 0.15 }); noise({ dur: 1.4, gain: 0.18 * v.gain, type: 'lowpass', f0: 600, f1: 120, attack: 0.05, at: 0.25 }); tone({ f0: 55, f1: 38, dur: 2.2, gain: 0.12 * v.gain, attack: 0.3 }); },
  };

  function play(name, opts = {}) {
    if (!ready() || !SOUNDS[name]) return;
    const v = { gain: opts.gain ?? 1, rate: opts.rate ?? (0.94 + Math.random() * 0.12) };
    if (v.gain < 0.03) return;
    route = NATURE.has(name) ? natureBus : null;
    try { SOUNDS[name](v); } catch (e) {}
    route = null;
  }
  const NATURE = new Set(['thunder', 'splash']);

  // A bud's voice: little syllables, one per couple of letters, pitched around a base set by its name.
  function voiceOf(seed) {
    let h = 2166136261;
    for (const ch of String(seed || 'bud')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    h >>>= 0;
    return { base: 300 + (h % 260), wave: ['triangle', 'sine', 'square'][(h >> 9) % 3], tilt: ((h >> 13) % 3) - 1 };
  }
  const VOICE_PITCH = [0.66, 0.81, 1, 1.22, 1.48];
  const clampVoice = (v) => (Number.isInteger(v) ? Math.max(-2, Math.min(2, v)) : 0);
  function babble(text, seed, opts = {}) {
    if (!ready() || !text) return;
    const gain = opts.gain ?? 1;
    if (gain < 0.05 || babbling >= 3) return;   // a crowd of buds talking at once just becomes noise
    const voice = voiceOf(seed), letters = String(text).replace(/[^a-z0-9]/gi, '');
    const syll = Math.min(14, Math.max(2, Math.round(letters.length / 2.4)));
    const question = /\?\s*$/.test(text), excited = /!\s*$/.test(text);
    // the pitch its person picked for it: -2 deep, 0 its own, +2 squeaky
    const pitch = VOICE_PITCH[clampVoice(opts.voice) + 2];
    const step = (excited ? 0.075 : 0.088) * (pitch < 1 ? 1.12 : 1);
    babbling++; route = voiceBus;
    setTimeout(() => { babbling--; }, syll * step * 1000 + 200);
    for (let i = 0; i < syll; i++) {
      const c = letters.charCodeAt(Math.floor(i * letters.length / syll)) || 97;
      let f = voice.base * (0.85 + ((c * 7) % 13) / 30) * (excited ? 1.12 : 1) * pitch;
      if (question && i >= syll - 2) f *= 1.25 + (i - syll + 2) * 0.12;   // up at the end of a question
      f *= 1 + voice.tilt * 0.04 * (i / syll);
      tone({ type: voice.wave, f0: f, f1: f * (0.92 + Math.random() * 0.14), dur: 0.06, gain: (voice.wave === 'square' ? 0.05 : 0.11) * gain, at: i * step + Math.random() * 0.012, attack: 0.008, filter: voice.wave === 'square' ? 1800 : 3200 });
    }
    route = null;
  }

  // Island background: soft wind and the odd bird.
  function ambient(on) {
    if (!on) {
      if (amb) { try { amb.g.gain.setTargetAtTime(0.0001, now(), 0.4); if (amb.rain) amb.rain.g.gain.setTargetAtTime(0.0001, now(), 0.4); const a = amb; setTimeout(() => { try { a.src.stop(); if (a.rain) a.rain.src.stop(); } catch (e) {} }, 1500); clearTimeout(amb.bird); } catch (e) {} amb = null; }
      return;
    }
    if (amb || !ready()) return;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.6;
    lfo.frequency.value = 0.07; lg.gain.value = 180; lfo.connect(lg); lg.connect(f.frequency);
    g.gain.value = 0.0001; g.gain.setTargetAtTime(0.035, now(), 2);
    src.connect(f); f.connect(g); g.connect(natureBus);
    src.start(); lfo.start();
    amb = { src, g, f };
    weather(wxNow);
    // birds by day; crickets (and the odd owl) by night
    const bird = () => {
      if (!amb) return;
      route = natureBus;
      if (ready() && wxNow.rain < 0.3 && wxNow.snow < 0.5) {   // birds keep quiet in the rain and snow
        if (night) {
          if (Math.random() < 0.08) {
            tone({ f0: 420, f1: 390, dur: 0.35, gain: 0.03, attack: 0.08 }); tone({ f0: 400, f1: 360, dur: 0.5, gain: 0.03, attack: 0.08, at: 0.45 });
          } else {
            const base = 4200 + Math.random() * 500;
            for (let i = 0; i < 3; i++) tone({ f0: base, dur: 0.03, gain: 0.012, at: i * 0.06, attack: 0.004 });
          }
        } else {
          const base = 2200 + Math.random() * 1400, n = 2 + Math.floor(Math.random() * 3);
          for (let i = 0; i < n; i++) tone({ f0: base, f1: base * (1.15 + Math.random() * 0.3), dur: 0.07, gain: 0.025, at: i * 0.11 });
        }
      }
      route = null;
      amb.bird = setTimeout(bird, night ? 700 + Math.random() * 900 : 7000 + Math.random() * 12000);
    };
    amb.bird = setTimeout(bird, 4000);
  }

  // The island's weather: rain patters on top of the wind, and the wind picks up. Amounts are 0..1.
  function weather(w) {
    wxNow = { rain: w.rain || 0, wind: w.wind || 0, snow: w.snow || 0 };
    if (!amb || !ctx) return;
    if (!amb.rain && wxNow.rain > 0.02) {
      const src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noiseBuf; src.loop = true;
      hp.type = 'highpass'; hp.frequency.value = 800; lp.type = 'lowpass'; lp.frequency.value = 5200;
      g.gain.value = 0.0001; src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(natureBus); src.start();
      amb.rain = { src, g };
    }
    if (amb.rain) amb.rain.g.gain.setTargetAtTime(0.0001 + wxNow.rain * 0.075, now(), 2);
    amb.g.gain.setTargetAtTime(0.035 + wxNow.wind * 0.05 + wxNow.snow * 0.01, now(), 2.5);
    amb.f.frequency.setTargetAtTime(420 + wxNow.wind * 520, now(), 2.5);
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(KEY, muted ? 'off' : 'on'); } catch (e) {}
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.55, now(), 0.05);
    if (muted) stopPiece();
    listeners.forEach((f) => f());
  }
  /* ---------------- music ----------------
     Three gentle pieces for the island, played by little synth instruments (no audio files). Like Minecraft's
     music, they aren't on a loop: a piece starts by itself a while after you arrive, plays once, and then it goes
     quiet for a few minutes before the next. (Minecraft waits 10 to 20 minutes between pieces; a visit to the
     island is a few minutes, so here the first one comes after 20 to 60 seconds and the gaps are 2 to 4 minutes.
     "Always" in the settings closes the gaps, like Minecraft's "Constant".) Which piece depends on the hour. */
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = (n) => { const m = /^([A-G])([#b]?)(-?\d)$/.exec(n); return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // a chord name to its notes, voiced around the middle of the keyboard
  const QUAL = { maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], '': [0, 4, 7], m: [0, 3, 7], sus4: [0, 5, 7], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], 7: [0, 4, 7, 10], '7sus4': [0, 5, 7, 10], 6: [0, 4, 7, 9] };
  function chord(name) {
    const m = /^([A-G][#b]?)([a-z0-9]*)(?:\/([A-G][#b]?))?$/.exec(name), root = midi(m[1] + '3'), q = QUAL[m[2]] || QUAL[''];
    return { bass: (m[3] ? midi(m[3] + '2') : root - 12), tones: q.map((i) => root + i) };
  }
  const PIECES = {
    // daytime: C major, an easy walk
    morning: { title: 'Morning Dew', bpm: 76, inst: 'keys', pad: 0.5,
      bars: [
        ['Fmaj7', 'A4:1.5 G4:.5 E4:2'], ['Fmaj7', '-:2 C5:1 D5:1'], ['C/E', 'E5:3 D5:1'], ['C/E', 'C5:2 -:2'],
        ['Am7', 'A4:1 C5:1 E5:1.5 D5:.5'], ['Am7', 'C5:2 B4:1 A4:1'], ['Gsus4', 'G4:2 C5:1 B4:1'], ['G', 'D5:4'],
        ['Fmaj7', 'E5:1 F5:1 A5:2'], ['Em7', 'G5:2 E5:2'], ['Dm7', 'F5:1.5 E5:.5 D5:2'], ['G', 'B4:2 D5:2'],
        ['Fmaj7', 'C5:1 E5:1 G5:1 A5:1'], ['Em7', 'G5:3 E5:1'], ['Dm7', 'F5:2 A5:1 F5:1'], ['Gsus4', 'D5:4'],
        ['Fmaj7', 'A4:1.5 G4:.5 E4:2'], ['Fmaj7', '-:2 C5:1 D5:1'], ['C/E', 'E5:2 G5:2'], ['C/E', 'E5:2 -:2'],
        ['Am7', 'A4:1 C5:1 E5:1.5 D5:.5'], ['Am7', 'C5:2 E5:1 D5:1'], ['Gsus4', 'C5:2 D5:2'], ['G', 'B4:4'],
        ['Fmaj7', 'A4:2 C5:2'], ['Fmaj7', 'E5:4'], ['C', 'G4:2 E4:2'], ['C', 'C5:4'],
      ] },
    // golden hour and dusk: D major, slower and warmer
    golden: { title: 'Golden Hour', bpm: 66, inst: 'keys', pad: 0.9,
      bars: [
        ['Dmaj7', 'F#5:2 E5:1 D5:1'], ['Dmaj7', 'C#5:3 -:1'], ['Gmaj7', 'B4:1 D5:1 F#5:2'], ['Gmaj7', 'E5:2 D5:2'],
        ['Em7', 'G5:1.5 F#5:.5 E5:2'], ['A7sus4', 'D5:2 E5:2'], ['Dmaj7', 'F#5:4'], ['Bm7', 'D5:2 -:1 A4:1'],
        ['Gmaj7', 'B4:1 D5:1 G5:1 F#5:1'], ['F#m7', 'E5:2 C#5:2'], ['Em7', 'B4:1 E5:1 G5:2'], ['A', 'A5:2 E5:2'],
        ['Gmaj7', 'F#5:1.5 G5:.5 B5:2'], ['F#m7', 'A5:2 F#5:2'], ['Em7', 'G5:1 F#5:1 E5:1 D5:1'], ['Asus4', 'E5:4'],
        ['Dmaj7', 'F#5:2 E5:1 D5:1'], ['Dmaj7', 'C#5:2 A4:2'], ['Gmaj7', 'B4:1 D5:1 F#5:2'], ['Gmaj7', 'A5:2 G5:2'],
        ['Em7', 'G5:1.5 F#5:.5 E5:2'], ['A7sus4', 'D5:2 E5:2'], ['Gmaj7', 'F#5:4'], ['Dmaj7', 'D5:4'],
      ] },
    // night: A minor, a music box by the campfire
    night: { title: 'Lamp Light', bpm: 60, inst: 'bell', pad: 1,
      bars: [
        ['Am', 'E5:2 A5:2'], ['Fmaj7', 'G5:1 F5:1 E5:2'], ['C', 'E5:2 G5:2'], ['G', 'D5:3 -:1'],
        ['Am', 'C5:1 E5:1 A5:2'], ['Fmaj7', 'C6:2 A5:2'], ['Dm7', 'F5:2 E5:1 D5:1'], ['Em7', 'B4:4'],
        ['F', 'A5:2 C6:2'], ['G', 'B5:2 D6:1 B5:1'], ['Em7', 'G5:2 E5:2'], ['Am', 'A5:4'],
        ['F', 'C5:1 F5:1 A5:2'], ['G', 'B5:1 A5:1 G5:2'], ['Esus4', 'A5:2 B5:2'], ['Em', 'E5:4'],
        ['Am', 'E5:2 A5:2'], ['Fmaj7', 'G5:1 F5:1 E5:2'], ['C', 'E5:2 G5:2'], ['G', 'D5:2 B4:2'],
        ['Am', 'C5:1 E5:1 A5:2'], ['Fmaj7', 'A5:2 G5:2'], ['Em7', 'E5:4'], ['Am', 'A4:4'],
      ] },
  };
  // a piece turned into notes: [time in seconds, midi, velocity, length in seconds, instrument]
  function score(p) {
    const beat = 60 / p.bpm, out = [];
    let seed = p.title.length * 977;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    p.bars.forEach(([ch, mel], i) => {
      const t0 = i * 4 * beat, c = chord(ch), last = i === p.bars.length - 1;
      out.push([t0, c.bass, 0.22, 3 * beat, 'keys']);
      if (p.pad) out.push([t0, c.tones, 0.16 * p.pad, 4 * beat, 'pad']);
      // a soft broken chord under the tune (not in the last bar, which just rings)
      if (!last) for (const [b, k] of [[1, 0], [1.5, 1], [2.5, 2], [3, 1]]) if (r() < 0.8) out.push([t0 + b * beat + r() * 0.02, c.tones[k % c.tones.length] + (c.tones[k] < 55 ? 12 : 0), 0.2 + r() * 0.05, 1.5 * beat, 'keys']);
      let at = 0;
      for (const tok of mel.split(/\s+/)) {
        const [n, d] = tok.split(':'), len = Number(d) * beat;
        if (n !== '-') out.push([t0 + at + r() * 0.015, midi(n), 0.7 + r() * 0.1, Math.max(len, beat) * 1.6, p.inst]);
        at += len;
      }
    });
    return { notes: out.sort((a, b) => a[0] - b[0]), length: p.bars.length * 4 * beat };
  }
  let verb = null, dry = null;
  function musicChain() {
    if (verb) return;
    // a little room around the notes: a reverb made from fading noise
    const len = Math.floor(ctx.sampleRate * 2.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    verb = ctx.createConvolver(); verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.42; verb.connect(wet); wet.connect(musicBus);
    dry = ctx.createGain(); dry.gain.value = 0.75; dry.connect(musicBus); dry.connect(verb);
  }
  // instruments: a soft piano-ish key, a music-box bell, and a slow pad
  function key(t, m, vel, len) {
    const f = hz(m), g = ctx.createGain(), lp = ctx.createBiquadFilter(), decay = Math.min(len, 3.2) * (m < 50 ? 0.8 : 1);
    lp.type = 'lowpass'; lp.frequency.value = 1400 + vel * 2400;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3 * vel, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    for (const [mul, a, type] of [[1, 1, 'triangle'], [2, 0.28, 'sine'], [3.01, 0.08, 'sine']]) {
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = f * mul; og.gain.value = a;
      if (mul > 1) { og.gain.setValueAtTime(a, t); og.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.45); }
      o.connect(og); og.connect(lp); o.start(t); o.stop(t + decay + 0.05);
    }
    lp.connect(g); g.connect(dry);
  }
  function bell(t, m, vel, len) {
    const f = hz(m), g = ctx.createGain(), decay = Math.min(len, 2.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.26 * vel, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    for (const [mul, a] of [[1, 1], [2.76, 0.18], [5.4, 0.06]]) {
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = f * mul; og.gain.value = a;
      if (mul > 1) { og.gain.setValueAtTime(a, t); og.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.3); }
      o.connect(og); og.connect(g); o.start(t); o.stop(t + decay + 0.05);
    }
    g.connect(dry);
  }
  function pad(t, ms, vel, len) {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * vel, t + len * 0.35); g.gain.setValueAtTime(0.05 * vel, t + len * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.8);
    for (const m of ms) for (const det of [-4, 4]) { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(m); o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + len + 0.9); }
    lp.connect(g); g.connect(dry);
  }
  const INST = { keys: key, bell, pad };
  let piece = null, nextAt = 0, director = 0, moodOf = () => 'morning', musicOn = false;
  function startPiece(name) {
    if (!ready() || piece) return false;
    musicChain();
    const id = name || moodOf() || 'morning', p = PIECES[id] || PIECES.morning, sc = score(p);
    piece = { id, title: p.title, t0: now() + 0.3, notes: sc.notes, i: 0, end: now() + 0.3 + sc.length + 3.5 };
    ducked = true; mixLevels();
    listeners.forEach((f) => f());
    return true;
  }
  function stopPiece() {
    if (!piece) return;
    piece = null; ducked = false; if (ctx) mixLevels();
    if (musicBus) { musicBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4); setTimeout(() => { if (!piece && musicBus) musicBus.gain.setTargetAtTime(0.9, ctx.currentTime, 0.1); }, 2500); }
    listeners.forEach((f) => f());
  }
  const gap = () => (prefs.music === 'always' ? 6 + Math.random() * 8 : 120 + Math.random() * 120);
  function tick() {
    if (!musicOn || !ctx) return;
    const t = now();
    if (piece) {
      // keep about a second of notes scheduled ahead
      while (piece.i < piece.notes.length && piece.t0 + piece.notes[piece.i][0] < t + 1.2) {
        const [at, m, vel, len, inst] = piece.notes[piece.i++], when = piece.t0 + at;
        if (when > t - 0.05) try { INST[inst](Math.max(when, t), m, vel, len); } catch (e) {}
      }
      if (t > piece.end) { piece = null; ducked = false; mixLevels(); nextAt = performance.now() / 1000 + gap(); listeners.forEach((f) => f()); }
    } else if (prefs.music !== 'off' && ready() && performance.now() / 1000 > nextAt) startPiece();
  }
  // the page turns the music on: mood() says which piece fits right now ('morning', 'golden' or 'night')
  function music(on, opts = {}) {
    if (opts.mood) moodOf = opts.mood;
    musicOn = !!on;
    clearInterval(director);
    if (!musicOn) { stopPiece(); return; }
    if (!nextAt) nextAt = performance.now() / 1000 + (prefs.music === 'always' ? 4 : 20 + Math.random() * 40);
    director = setInterval(tick, 250);
  }

  /* ---------------- the sound settings panel ----------------
     The speaker button opens a small panel: sound on or off, how often music plays, how loud nature and the
     weather are, and how loud buds' voices are. Kept in this browser. */
  let panel = null, panelBtn = null;
  const OPTS = {
    music: [['off', 'Off'], ['some', 'Sometimes'], ['always', 'Always']],
    nature: [[0, 'Off'], [0.35, 'Quiet'], [1, 'Full']],
    voices: [[0.4, 'Quiet'], [1, 'Full']],
  };
  function buildPanel() {
    const st = document.createElement('style');
    st.textContent = `.snd-panel{position:fixed;z-index:80;width:min(290px,calc(100vw - 24px));background:var(--card,#fff);color:var(--ink,#1D1C2B);border-radius:18px;padding:14px;box-shadow:0 16px 44px rgba(20,16,50,.28);font:inherit;font-size:14px;display:flex;flex-direction:column;gap:10px}
.snd-panel[hidden]{display:none}.snd-panel h3{margin:0;font-size:15px;font-weight:600}.snd-row{display:flex;flex-direction:column;gap:5px}.snd-row>span{font-size:13px;color:var(--muted,#5E5D75)}
.snd-seg{display:flex;gap:4px;background:rgba(127,127,150,.13);border-radius:999px;padding:3px}.snd-seg button{flex:1;font:inherit;font-size:13px;border:0;border-radius:999px;padding:7px 6px;min-height:34px;background:none;color:inherit;cursor:pointer}
.snd-seg button[aria-checked=true]{background:var(--me,#1D1C2B);color:var(--me-ink,#fff)}.snd-seg button:focus-visible{outline:3px solid #7B6CF6;outline-offset:1px}
.snd-now{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;color:var(--muted,#5E5D75);border-top:1px solid rgba(127,127,150,.2);padding-top:9px}
.snd-now button{font:inherit;font-size:13px;border:1px solid rgba(127,127,150,.3);border-radius:999px;padding:6px 12px;min-height:32px;background:none;color:var(--ink,#1D1C2B);cursor:pointer}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .snd-panel{background:var(--card,#1E2034);color:var(--ink,#EDECF6)}}`;
    document.head.appendChild(st);
    panel = document.createElement('div'); panel.className = 'snd-panel'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Sound settings');
    const seg = (label, opts, get, set) => {
      const row = document.createElement('div'); row.className = 'snd-row';
      const l = document.createElement('span'); l.textContent = label; row.appendChild(l);
      const g = document.createElement('div'); g.className = 'snd-seg'; g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', label);
      for (const [v, text] of opts) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.setAttribute('role', 'radio'); b.dataset.v = String(v);
        b.addEventListener('click', () => { set(v); syncPanel(); play('click', { gain: 0.6 }); });
        g.appendChild(b);
      }
      g.sync = () => { for (const b of g.children) b.setAttribute('aria-checked', String(b.dataset.v === String(get()))); };
      row.appendChild(g); panel.appendChild(row); return g;
    };
    const h = document.createElement('h3'); h.textContent = 'Sound settings'; panel.appendChild(h);
    panel.segs = [
      seg('Sound', [[true, 'On'], [false, 'Off']], () => !muted, (v) => { unlock(); setMuted(!v); }),
      seg('Music', OPTS.music, () => prefs.music, (v) => { prefs.music = v; savePrefs(); if (v === 'off') stopPiece(); else if (!piece) nextAt = performance.now() / 1000 + (v === 'always' ? 1 : Math.min(gap(), Math.max(0, nextAt - performance.now() / 1000))); }),
      seg('Nature and weather', OPTS.nature, () => prefs.nature, (v) => { prefs.nature = v; savePrefs(); mixLevels(); }),
      seg('Bud voices', OPTS.voices, () => prefs.voices, (v) => { prefs.voices = v; savePrefs(); mixLevels(); }),
    ];
    const nowRow = document.createElement('div'); nowRow.className = 'snd-now';
    const nowText = document.createElement('span'), nowBtn = document.createElement('button'); nowBtn.type = 'button';
    nowBtn.addEventListener('click', () => { unlock(); if (piece) stopPiece(); else { if (muted) setMuted(false); startPiece(); } nextAt = performance.now() / 1000 + gap(); syncPanel(); });
    nowRow.append(nowText, nowBtn); panel.appendChild(nowRow); panel.nowText = nowText; panel.nowBtn = nowBtn;
    document.body.appendChild(panel);
    document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !panel.contains(e.target) && !panelBtn.contains(e.target)) closePanel(); }, true);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { closePanel(); panelBtn.focus(); } });
    addEventListener('resize', () => { if (!panel.hidden) placePanel(); });
    listeners.add(syncPanel);
  }
  function syncPanel() {
    if (!panel) return;
    for (const g of panel.segs) g.sync();
    panel.nowText.textContent = piece ? `♪ ${piece.title}` : musicOn ? 'No music playing' : '';
    panel.nowBtn.textContent = piece ? 'Stop' : 'Play music';
    panel.nowBtn.parentElement.hidden = !musicOn;
  }
  function placePanel() {
    const r = panelBtn.getBoundingClientRect(), w = panel.offsetWidth;
    panel.style.top = `${r.bottom + 8}px`; panel.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, r.right - w))}px`;
  }
  function closePanel() { panel.hidden = true; panelBtn.setAttribute('aria-expanded', 'false'); }
  function bindPanel(btn) {
    panelBtn = btn; if (!panel) buildPanel();
    let drawn = null;
    const sync = () => {
      // only redraw the icon when it changes: replacing it mid-tap would swallow the tap
      if (drawn !== muted) { drawn = muted; btn.innerHTML = muted ? ICON_OFF : ICON_ON; }
      btn.setAttribute('aria-label', 'Sound settings'); btn.title = muted ? 'Sound off' : 'Sound';
      btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', String(!panel.hidden));
      btn.classList.toggle('playing', !!piece);
    };
    btn.addEventListener('click', () => {
      unlock();
      if (panel.hidden) { panel.hidden = false; syncPanel(); placePanel(); btn.setAttribute('aria-expanded', 'true'); }
      else closePanel();
    });
    listeners.add(sync); sync();
  }


  // a speaker button: <button class="... sound-toggle"> gets its icon and state kept in sync
  const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m17 9 5 5M22 9l-5 5"/></svg>';
  function bindToggle(btn) {
    let drawn = null;
    const sync = () => {
      if (drawn !== muted) { drawn = muted; btn.innerHTML = muted ? ICON_OFF : ICON_ON; }
      btn.setAttribute('aria-pressed', String(!muted));
      btn.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
      btn.title = muted ? 'Sound off' : 'Sound on';
    };
    btn.addEventListener('click', () => { unlock(); setMuted(!muted); if (!muted) play('pop'); });
    listeners.add(sync); sync();
  }

  window.BudSound = {
    play, babble, ambient, weather, setMuted, bindToggle, bindPanel, music, onChange: (f) => listeners.add(f),
    get prefs() { return { ...prefs }; }, get levels() { return natureBus ? { nature: natureBus.gain.value, voices: voiceBus.gain.value, music: musicBus.gain.value, ducked } : null; }, get playing() { return piece ? piece.title : null; }, playNow: () => startPiece(),
    setNight: (n) => { night = !!n; },
    get muted() { return muted; }, get ready() { return ready(); },
  };
})();
