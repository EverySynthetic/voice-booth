/* voice-booth runtime. A recorded take plays when its line shows. No take, or
   words that changed since the take, and the line stays text: the app never
   waits on a voice.

   A line is found by its words (script.js, made by tools/build_script.js from
   your lines.json). A take comes from, in order:
     1. this browser: booth.html keeps takes in IndexedDB, so a take kept there
        plays in your app at once (same address);
     2. your repo: takes.js maps an id to a file, which is what ships.
   ?guide=1 has the browser read lines that have no take, so the timing can be
   heard. It is never on by default, and it is not the final voice.
   Mute: set VOICE.isMuted = () => yourFlag (default: never muted). */

var VOICE = { audio: null, queue: [], gen: 0, guide: false, mime: "" };
try { VOICE.guide = /[?&]guide=1\b/.test(location.search); } catch (e) { /* no location: no guide */ }

VOICE.norm = (s) => String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

VOICE.lineFor = (text) => {
  if (typeof VOICE_SCRIPT === "undefined") return null;
  const t = VOICE.norm(text);
  return VOICE_SCRIPT.find((l) => !l.retired && l.text === t) || null;
};

/* --- the store: one IndexedDB, shared with the booth ---------------------- */
VOICE.db = () => {
  if (VOICE._db) return VOICE._db;
  VOICE._db = new Promise((res, rej) => {
    try {
      const r = indexedDB.open("voice_booth", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("takes");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  VOICE._db.catch(() => {});
  return VOICE._db;
};
// Resolve when the transaction commits, not when the request lands: a page
// that reloads right after Keep must not lose the take.
VOICE.tx = (mode, fn) => VOICE.db().then((db) => new Promise((res, rej) => {
  const tx = db.transaction("takes", mode);
  const r = fn(tx.objectStore("takes"));
  tx.oncomplete = () => res(r.result);
  tx.onerror = tx.onabort = () => rej(tx.error);
}));
// A take is { blob, mime, text, ms }. The text it was recorded on rides with it.
VOICE.put = (id, take) => VOICE.tx("readwrite", (s) => s.put(take, id));
VOICE.get = (id) => VOICE.tx("readonly", (s) => s.get(id));
VOICE.del = (id) => VOICE.tx("readwrite", (s) => s.delete(id));
VOICE.keys = () => VOICE.tx("readonly", (s) => s.getAllKeys());

/* --- finding a take for a line -------------------------------------------- */
// Resolves to { url, revoke } or null. A take made on other words is not used.
VOICE.within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
VOICE.take = async (line) => {
  try {
    // A store that never answers (blocked storage, file://) must not hold the voice up.
    const t = await VOICE.within(VOICE.get(line.id), 1500);
    if (t && t.blob && t.text === line.text) return { url: URL.createObjectURL(t.blob), revoke: true };
  } catch (e) { /* no store here: try the files */ }
  const f = typeof VOICE_FILES !== "undefined" && VOICE_FILES[line.id];
  if (f && f.file && f.text === line.text) return { url: f.file, revoke: false };
  return null;
};

/* --- treatment: a voice can be run through a filter when it plays -------------
   The take is stored plain. The filter lives here, so it can be tuned without
   re-recording. Speakers not listed play as recorded. Add your own by speaker id.
   rate < 1 drops the pitch (and slows it a touch); ring is a ring-modulator
   pitch in Hz, ringMix how much of it; band is the telephone speaker window;
   drive is how hard the last stage clips. */
// How loud a speaker plays, 1 = as recorded. Example: VOICE.LEVEL = { robot: 0.9 }.
VOICE.LEVEL = {};

VOICE.FX = {
  // Examples. Key by the speaker id used in lines.json.
  robot: { rate: 0.88, ring: 48, ringMix: 0.45, low: 7, band: [240, 3600], drive: 3 },   // deeper, buzzy, telephone-speaker
  machine: { rate: 0.94, ring: 30, ringMix: 0.18, low: 5, band: [90, 7500], drive: 1.6 }, // a generated voice with a little machine edge
};

// Wire a source node through the treatment to a destination. Split out so the
// graph can be rendered offline and measured (tests) as well as played.
VOICE.graph = (c, src, fx, dest, level) => {
  const sum = c.createGain();
  const dry = c.createGain(); dry.gain.value = 1 - fx.ringMix;
  src.connect(dry); dry.connect(sum);
  const ring = c.createGain(); ring.gain.value = 0;          // the oscillator is the gain
  const osc = c.createOscillator(); osc.frequency.value = fx.ring; osc.connect(ring.gain);
  const wet = c.createGain(); wet.gain.value = fx.ringMix * 1.4;
  src.connect(ring); ring.connect(wet); wet.connect(sum);
  const low = c.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = 220; low.gain.value = fx.low;
  const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = fx.band[0];
  const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = fx.band[1];
  const shape = c.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(fx.drive * x) / Math.tanh(fx.drive); }
  shape.curve = curve;
  const out = c.createGain(); out.gain.value = 0.8 * (level == null ? 1 : level);
  sum.connect(low); low.connect(hp); hp.connect(lp); lp.connect(shape); shape.connect(out); out.connect(dest);
  osc.start();
  return () => { try { osc.stop(); out.disconnect(); } catch (e) { /* already stopped */ } };
};

VOICE.chain = (audio, fx, level) => {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return () => {};
  const c = VOICE.ctx || (VOICE.ctx = new AC());
  if (c.state === "suspended") c.resume();
  audio.preservesPitch = false;
  audio.playbackRate = fx.rate;
  return VOICE.graph(c, c.createMediaElementSource(audio), fx, c.destination, level);
};

// Every element made here is remembered until it ends, so stop() can silence
// all of them, not just the last: one voice at a time, always.
VOICE.live = new Set();
VOICE.element = (url, speaker) => {
  const a = new Audio(url);
  const fx = VOICE.FX[speaker], level = VOICE.LEVEL[speaker];
  const off = fx ? VOICE.chain(a, fx, level) : null;
  if (!fx && level != null) a.volume = level;
  // Attached to the page, hidden: a loose element can have its play() promise
  // rejected with AbortError ("removed from the document") while it goes on
  // playing, which the queue used to read as "this line failed, start the next".
  try { a.hidden = true; (document.body || document.documentElement).appendChild(a); } catch (e) { /* not a real element (tests) */ }
  VOICE.live.add(a);
  a.addEventListener("ended", () => { VOICE.live.delete(a); if (a.remove) a.remove(); if (off) off(); }, { once: true });
  return a;
};

/* --- playing --------------------------------------------------------------- */
VOICE.isMuted = () => false;
VOICE.muted = () => !!VOICE.isMuted();

VOICE.stop = () => {
  VOICE.gen += 1;
  VOICE.queue = [];
  for (const a of VOICE.live) { try { a.pause(); if (a.remove) a.remove(); } catch (e) { /* already gone */ } }
  VOICE.live.clear();
  VOICE.audio = null;
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* no synth */ }
};

// Say these texts one after another. A new call cuts the last one off. With
// keep, a call that finds nothing to say leaves what is playing alone (a
// line with no take must not cut a playing voice off).
VOICE.say = (texts, keep) => {
  const lines = texts.map(VOICE.lineFor).filter(Boolean);
  if (keep && !lines.length) return;
  VOICE.stop();
  const gen = VOICE.gen;
  const next = async () => {
    if (gen !== VOICE.gen || VOICE.muted() || !lines.length) return;
    const line = lines.shift();
    const take = await VOICE.take(line);
    if (gen !== VOICE.gen) { if (take && take.revoke) URL.revokeObjectURL(take.url); return; }
    if (take) {
      const a = VOICE.element(take.url, line.speaker);
      VOICE.audio = a;
      // ended, an error and a refused play() can all arrive for one take; only the first moves on.
      let moved = false;
      const done = () => {
        if (moved) return;
        moved = true;
        VOICE.live.delete(a);
        if (take.revoke) URL.revokeObjectURL(take.url);
        if (gen === VOICE.gen) next();
      };
      a.onended = done;
      a.onerror = done;
      // Only a refusal ends the line early (the browser holds sound until the
      // first click). An AbortError is not a refusal: stop() causes it, and
      // Chrome can raise it for a take that then plays anyway. ended decides.
      a.play().catch((e) => { if (e && (e.name === "NotAllowedError" || e.name === "NotSupportedError")) done(); });
      // A take that never starts must not hold the queue.
      setTimeout(() => { if (!moved && gen === VOICE.gen && a.paused && !a.ended) done(); }, 3000);
    } else if (VOICE.guide && window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(line.spoken || line.text);
      u.onend = () => { if (gen === VOICE.gen) next(); };
      speechSynthesis.speak(u);
    } else {
      next();
    }
  };
  next();
};

// The lines on screen, top to bottom: every element under root matching the
// selector (default: paragraphs and elements marked data-voice).
VOICE.scan = (root, keep, selector) => {
  if (!root) return;
  VOICE.say([...root.querySelectorAll(selector || "p, [data-voice]")].map((p) => p.textContent), keep);
};

document.addEventListener("click", (e) => {
  // If your page has a mute button (#mute), muting cuts the voice off at once.
  const m = e.target && e.target.closest && e.target.closest("#mute");
  if (m) setTimeout(() => { if (VOICE.muted()) VOICE.stop(); }, 0);
}, true);
