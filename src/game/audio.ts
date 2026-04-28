/**
 * Procedural audio system.
 *
 * All SFX are synthesized via Web Audio (oscillators + noise buffers + filters +
 * envelopes), so no audio asset files are needed. The smooch.mp3 easter-egg stays
 * outside this system.
 *
 * Music is a layered drone — two detuned sawtooth oscillators through a low-pass
 * + slow LFO on cutoff. Each zone picks its own base pitch and filter sweep.
 *
 * Whispers use the Web Speech API with low pitch + rate, rate-limited so the
 * scene doesn't become cacophonous.
 */

import {getSettings, subscribeSettings} from './settings';

type MusicLayer = {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  lfo: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
};

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let activeMusic: MusicLayer | null = null;
let currentMusicId: string | null = null;
let lastWhisperAt = 0;
let lastHeartbeatAt = 0;

/** Lazy-init the audio graph on first user gesture (browsers require it). */
export function initAudio(): void {
  if (ctx) return;
  try {
    const AC = (window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext);
    ctx = new AC();
    masterGain = ctx.createGain();
    musicGain = ctx.createGain();
    sfxGain = ctx.createGain();
    musicGain.connect(masterGain);
    sfxGain.connect(masterGain);
    masterGain.connect(ctx.destination);
    applyVolumes();
    // Build a 2-second white-noise buffer for whooshes/shatters.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buf;
  } catch {
    ctx = null;
  }
  subscribeSettings(applyVolumes);
}

function applyVolumes(): void {
  if (!ctx || !masterGain || !musicGain || !sfxGain) return;
  const s = getSettings();
  const now = ctx.currentTime;
  masterGain.gain.setTargetAtTime(s.volumeMaster, now, 0.05);
  musicGain.gain.setTargetAtTime(s.volumeMusic, now, 0.3);
  sfxGain.gain.setTargetAtTime(s.volumeSfx, now, 0.05);
}

/** Force-resume if a browser suspended the context (some mobiles). */
export function resumeAudio(): void {
  if (!ctx) initAudio();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

// ─────────────────────────────────────────────────────────────
// Synth helpers
// ─────────────────────────────────────────────────────────────

function envGain(attack: number, decay: number, sustain: number, release: number, peak: number): GainNode {
  if (!ctx) throw new Error('audio not initialized');
  const g = ctx.createGain();
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(peak, now + attack);
  g.gain.linearRampToValueAtTime(peak * sustain, now + attack + decay);
  g.gain.linearRampToValueAtTime(0, now + attack + decay + release);
  return g;
}

function playNoise(duration: number, filterType: BiquadFilterType, freq: number, q: number, peak: number): void {
  if (!ctx || !noiseBuffer || !sfxGain) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = envGain(0.005, duration * 0.3, 0.2, duration * 0.7, peak);
  src.connect(filter).connect(g).connect(sfxGain);
  src.start();
  src.stop(ctx.currentTime + duration + 0.05);
}

function playTone(freq: number, duration: number, type: OscillatorType, peak: number, glideTo?: number): void {
  if (!ctx || !sfxGain) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (glideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(10, glideTo), ctx.currentTime + duration);
  }
  const g = envGain(0.005, duration * 0.2, 0.3, duration * 0.8, peak);
  osc.connect(g).connect(sfxGain);
  osc.start();
  osc.stop(ctx.currentTime + duration + 0.05);
}

// ─────────────────────────────────────────────────────────────
// SFX catalog
// ─────────────────────────────────────────────────────────────

/** Soft flame whoosh on a correct keystroke; pitch rises with combo. */
export function sfxCast(combo: number): void {
  if (!ctx) return;
  const base = 420 + Math.min(combo, 180) * 3;
  playNoise(0.08, 'bandpass', base, 4, 0.22);
}

/** Short glass-crack on a wrong keystroke. */
export function sfxMiss(): void {
  if (!ctx) return;
  playNoise(0.12, 'highpass', 2800, 1, 0.18);
  playTone(220, 0.06, 'triangle', 0.1, 120);
}

/** Fireball launch. */
export function sfxFireball(): void {
  playNoise(0.18, 'bandpass', 900, 2.5, 0.35);
}

/** Impact boom when fireball lands. */
export function sfxImpact(big: boolean): void {
  playTone(big ? 80 : 140, big ? 0.25 : 0.15, 'sine', big ? 0.7 : 0.45, big ? 40 : 80);
  playNoise(big ? 0.18 : 0.12, 'lowpass', big ? 350 : 600, 1, big ? 0.3 : 0.22);
}

/** Word destroyed (ethereal shatter). */
export function sfxShatter(): void {
  playNoise(0.25, 'highpass', 3200, 0.8, 0.25);
  playTone(880, 0.18, 'triangle', 0.18, 1760);
}

/** Combo rank-up bell. */
export function sfxRankUp(rankIdx: number): void {
  if (!ctx || !sfxGain) return;
  const base = 330 * Math.pow(1.122, rankIdx);
  for (const mul of [1, 2, 3]) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = base * mul;
    const g = envGain(0.003, 0.25, 0.4, 1.0, 0.22 / mul);
    osc.connect(g).connect(sfxGain);
    osc.start();
    osc.stop(ctx.currentTime + 1.3);
  }
}

/** Deep drum thud on combo break. */
export function sfxComboBreak(): void {
  playTone(120, 0.4, 'sine', 0.55, 40);
  playNoise(0.1, 'lowpass', 200, 1, 0.2);
}

/** Player hit — meaty thud. */
export function sfxPlayerHit(): void {
  playTone(70, 0.3, 'sine', 0.8, 35);
  playNoise(0.18, 'lowpass', 500, 1.5, 0.35);
}

/** Bonfire lit — classic chime. */
export function sfxBonfire(): void {
  if (!ctx || !sfxGain) return;
  const freqs = [523.25, 659.25, 783.99];  // C5 E5 G5
  freqs.forEach((f, i) => {
    window.setTimeout(() => {
      const osc = ctx!.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = envGain(0.02, 0.4, 0.4, 1.2, 0.2);
      osc.connect(g).connect(sfxGain!);
      osc.start();
      osc.stop(ctx!.currentTime + 1.7);
    }, i * 120);
  });
}

/** Estus glug — 3 quick low bubbles. */
export function sfxEstus(): void {
  if (!ctx) return;
  for (let i = 0; i < 3; i++) {
    window.setTimeout(() => playTone(180 + i * 30, 0.14, 'sine', 0.4, 120 + i * 40), i * 180);
  }
}

/** Dodge whoosh. */
export function sfxDodge(): void {
  playNoise(0.22, 'bandpass', 1600, 3, 0.25);
}

/** Boss appears — horn blast. */
export function sfxBossAppear(): void {
  if (!ctx || !sfxGain) return;
  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc.type = 'sawtooth'; osc2.type = 'sawtooth';
  osc.frequency.value = 110; osc2.frequency.value = 110 * 1.007;
  const g = envGain(0.1, 0.4, 0.6, 1.5, 0.45);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  osc.connect(filter); osc2.connect(filter);
  filter.connect(g).connect(sfxGain);
  osc.start(); osc2.start();
  osc.stop(ctx.currentTime + 2); osc2.stop(ctx.currentTime + 2);
}

/** Boss defeated — orchestral stinger. */
export function sfxBossDefeated(): void {
  if (!ctx) return;
  const notes = [196, 246.94, 293.66, 392];  // G3 B3 D4 G4
  notes.forEach((f, i) => {
    window.setTimeout(() => playTone(f, 0.8, 'triangle', 0.35, f), i * 110);
  });
}

/** Death stinger. */
export function sfxDeath(): void {
  playTone(440, 1.8, 'triangle', 0.5, 55);
  playNoise(1.2, 'lowpass', 300, 1, 0.25);
}

/** Heartbeat — played every 0.9s when low HP. Call each frame; self-throttles. */
export function sfxHeartbeat(now: number): void {
  if (!ctx) return;
  if (now - lastHeartbeatAt < 900) return;
  lastHeartbeatAt = now;
  playTone(55, 0.14, 'sine', 0.55, 40);
  window.setTimeout(() => playTone(55, 0.14, 'sine', 0.45, 38), 180);
}

// ─────────────────────────────────────────────────────────────
// Music drone — one layer per zone, cross-fade on switch.
// ─────────────────────────────────────────────────────────────

type DroneConfig = {root: number; cutoff: number; lfoRate: number; detune: number};
const DRONES: Record<string, DroneConfig> = {
  firelink:  {root: 55,  cutoff: 520, lfoRate: 0.08, detune: 7},
  burg:      {root: 65,  cutoff: 680, lfoRate: 0.11, detune: 12},
  anorlondo: {root: 82,  cutoff: 900, lfoRate: 0.06, detune: 4},
  kiln:      {root: 49,  cutoff: 420, lfoRate: 0.14, detune: 18},
  boss:      {root: 41,  cutoff: 520, lfoRate: 0.25, detune: 22},
  victory:   {root: 98,  cutoff: 1200, lfoRate: 0.05, detune: 2},
  menu:      {root: 61,  cutoff: 600, lfoRate: 0.05, detune: 5},
};

export function playMusic(id: keyof typeof DRONES): void {
  if (!ctx || !musicGain) { initAudio(); if (!ctx || !musicGain) return; }
  if (currentMusicId === id) return;
  stopMusic(1.2);
  const cfg = DRONES[id];
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = 'sawtooth'; osc2.type = 'sawtooth';
  osc1.frequency.value = cfg.root;
  osc2.frequency.value = cfg.root;
  osc2.detune.value = cfg.detune;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cfg.cutoff;
  filter.Q.value = 3;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = cfg.lfoRate;
  lfoGain.gain.value = cfg.cutoff * 0.35;
  lfo.connect(lfoGain).connect(filter.frequency);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 2.0);
  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain).connect(musicGain);
  osc1.start(); osc2.start(); lfo.start();
  activeMusic = {osc1, osc2, lfo, filter, gain};
  currentMusicId = id;
}

export function stopMusic(fade: number = 0.8): void {
  if (!ctx || !activeMusic) return;
  const m = activeMusic;
  const now = ctx.currentTime;
  m.gain.gain.cancelScheduledValues(now);
  m.gain.gain.setValueAtTime(m.gain.gain.value, now);
  m.gain.gain.linearRampToValueAtTime(0, now + fade);
  const stopAt = now + fade + 0.05;
  m.osc1.stop(stopAt); m.osc2.stop(stopAt); m.lfo.stop(stopAt);
  activeMusic = null;
  currentMusicId = null;
}

// ─────────────────────────────────────────────────────────────
// Whispers — Web Speech API. Rate-limited.
// ─────────────────────────────────────────────────────────────

export function whisperWord(text: string, now: number): void {
  const s = getSettings();
  if (!s.whispers || s.volumeVoice <= 0.01) return;
  if (now - lastWhisperAt < 700) return;
  lastWhisperAt = now;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.75;
    u.pitch = 0.3;
    u.volume = s.volumeVoice * s.volumeMaster * 0.9;
    // Prefer a deep voice if available.
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => /male|david|daniel/i.test(v.name)) ?? voices[0];
    if (preferred) u.voice = preferred;
    window.speechSynthesis.speak(u);
  } catch {
    /* speech synthesis unavailable */
  }
}

export function cancelWhispers(): void {
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
}
