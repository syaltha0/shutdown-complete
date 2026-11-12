// Background sound for focusing, made in the browser (Web Audio), so nothing is downloaded and nothing loops audibly:
// rain, waves, a fire and brown noise, each from shaped noise. The choice and the volume are kept per device.
// The sound fades in and out; a focus session that ends fades it out by itself (FocusRunner calls stopAmbient).

export type Ambient = 'rain' | 'waves' | 'fire' | 'brown';
export const AMBIENTS: Ambient[] = ['rain', 'waves', 'fire', 'brown'];

const KEY = 'sc-ambient';
export function ambientPref(): { sound: Ambient | null; volume: number } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { sound: AMBIENTS.includes(v.sound) ? v.sound : null, volume: typeof v.volume === 'number' ? Math.min(1, Math.max(0, v.volume)) : 0.5 };
  } catch { return { sound: null, volume: 0.5 }; }
}
function savePref(p: { sound: Ambient | null; volume: number }) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let stopCurrent: (() => void) | null = null;
let playing: Ambient | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
export const onAmbient = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const ambientPlaying = () => playing;

function noiseBuffer(c: AudioContext, kind: 'white' | 'brown', seconds = 6) {
  const n = c.sampleRate * seconds;
  const buf = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    // a short cross-fade of the ends, so the loop has no seam
    const f = Math.floor(c.sampleRate * 0.05);
    for (let i = 0; i < f; i++) { const k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; }
  }
  return buf;
}

function loop(c: AudioContext, buf: AudioBuffer) {
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.loopStart = 0.05;
  s.loopEnd = buf.duration - 0.05;
  return s;
}

/** Builds one sound into `out`; returns how to stop it. */
function build(c: AudioContext, kind: Ambient, out: AudioNode): () => void {
  const stops: (() => void)[] = [];
  const timers: number[] = [];
  if (kind === 'brown') {
    const s = loop(c, noiseBuffer(c, 'brown'));
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    s.connect(lp).connect(out); s.start(); stops.push(() => s.stop());
  }
  if (kind === 'rain') {
    // a steady hiss with a soft high end, and a ripple in its loudness like drops on a window
    const s = loop(c, noiseBuffer(c, 'white'));
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
    const g = c.createGain(); g.gain.value = 0.32;
    s.connect(hp).connect(lp).connect(g).connect(out); s.start(); stops.push(() => s.stop());
    const ripple = () => { g.gain.setTargetAtTime(0.26 + Math.random() * 0.12, c.currentTime, 0.08); timers.push(window.setTimeout(ripple, 90 + Math.random() * 160)); };
    ripple();
  }
  if (kind === 'waves') {
    // deep noise that swells and falls about every eight seconds
    const s = loop(c, noiseBuffer(c, 'brown'));
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    const g = c.createGain(); g.gain.value = 0.25;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.12;
    const depth = c.createGain(); depth.gain.value = 0.55;
    lfo.connect(depth).connect(g.gain);
    s.connect(lp).connect(g).connect(out); s.start(); lfo.start();
    stops.push(() => { s.stop(); lfo.stop(); });
  }
  if (kind === 'fire') {
    // a low rumble and crackles at random moments
    const s = loop(c, noiseBuffer(c, 'brown'));
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = c.createGain(); g.gain.value = 0.9;
    s.connect(lp).connect(g).connect(out); s.start(); stops.push(() => s.stop());
    const white = noiseBuffer(c, 'white', 1);
    const crackle = () => {
      const b = c.createBufferSource(); b.buffer = white;
      const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1800 + Math.random() * 2500; hp.Q.value = 1.2;
      const e = c.createGain(); const t = c.currentTime, len = 0.008 + Math.random() * 0.03;
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.25 + Math.random() * 0.5, t + 0.002); e.gain.exponentialRampToValueAtTime(0.001, t + len);
      b.connect(hp).connect(e).connect(out); b.start(t, Math.random() * 0.9, len + 0.02);
      timers.push(window.setTimeout(crackle, 40 + Math.random() * (Math.random() < 0.2 ? 900 : 260)));
    };
    crackle();
  }
  return () => { timers.forEach((t) => window.clearTimeout(t)); stops.forEach((f) => { try { f(); } catch { /* already stopped */ } }); };
}

/** Plays a sound (fading in), replacing the one playing; null stops. Must follow a click (browsers ask for one). */
export function playAmbient(kind: Ambient | null, volume = ambientPref().volume) {
  savePref({ sound: kind, volume });
  if (!kind) { stopAmbient(); return; }
  try {
    ctx = ctx || new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const c = ctx;
    const prev = stopCurrent;
    const prevGain = master;
    if (prev && prevGain) { prevGain.gain.setTargetAtTime(0, c.currentTime, 0.4); window.setTimeout(prev, 1600); }
    const g = c.createGain();
    g.gain.value = 0;
    g.connect(c.destination);
    g.gain.setTargetAtTime(volume * 0.6, c.currentTime, 0.6);
    master = g;
    stopCurrent = build(c, kind, g);
    playing = kind;
    emit();
  } catch { /* no audio on this device */ }
}

export function setAmbientVolume(volume: number) {
  savePref({ sound: playing ?? ambientPref().sound, volume });
  if (ctx && master) master.gain.setTargetAtTime(volume * 0.6, ctx.currentTime, 0.15);
}

/** Fades the sound out over about two seconds. */
export function stopAmbient() {
  if (!ctx || !master || !stopCurrent) { playing = null; emit(); return; }
  const stop = stopCurrent, g = master;
  g.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
  window.setTimeout(stop, 2500);
  stopCurrent = null; master = null; playing = null;
  emit();
}
