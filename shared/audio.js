/**
 * Shared Audio Utilities
 * Synthesised sound effects via Web Audio API + MusicManager for file-based music.
 */

let audioCtx = null;

function getCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

/** Short pop sound — great for bubble pop, hit effects. */
export function playPop(freq = 600, duration = 0.08) {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, ctx.currentTime + duration);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + duration);
}

/** Rising success chime. */
export function playSuccess() {
    const ctx = getCtx();
    [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.1);
        gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + i * 0.1 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.1);
        osc.stop(ctx.currentTime + i * 0.1 + 0.25);
    });
}

/** Negative buzz — miss or fail. */
export function playMiss() {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 150;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.2);
}

/** Puck hit sound — for air hockey. */
export function playHit(freq = 800) {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.15);
}

/** Goal scored fanfare. */
export function playGoal() {
    const ctx = getCtx();
    [392, 494, 588, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.08);
        gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + i * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.08);
        osc.stop(ctx.currentTime + i * 0.08 + 0.35);
    });
}

/** Countdown tick. */
export function playTick() {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1000;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.06);
}

/** Slice / swipe sound. */
export function playSlice(freq = 1200) {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.3, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.15);
}

/** Bomb explosion sound. */
export function playBomb() {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(20, ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.4);

    // Noise-like crackle
    const noise = ctx.createOscillator();
    const nGain = ctx.createGain();
    noise.type = 'square';
    noise.frequency.setValueAtTime(200, ctx.currentTime);
    noise.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.25);
    nGain.gain.setValueAtTime(0.1, ctx.currentTime);
    nGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    noise.connect(nGain).connect(ctx.destination);
    noise.start(); noise.stop(ctx.currentTime + 0.3);
}

/** Resume audio context after user gesture. */
export function resumeAudio() {
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
}

/**
 * MusicManager — Loads and plays music from assets/music/ assets.
 * Uses <audio> element for streaming large files.
 */
export class MusicManager {
    constructor() {
        this._audio = new Audio();
        this._audio.preload = 'auto';
        this._loaded = false;
        this._onEnded = null;
    }

    /** Load a track URL. */
    loadTrack(url) {
        return new Promise((resolve, reject) => {
            this._audio.src = url;
            this._audio.oncanplaythrough = () => { this._loaded = true; resolve(); };
            this._audio.onerror = (e) => reject(new Error('Failed to load audio: ' + url));
            this._audio.load();
        });
    }

    play() {
        if (!this._loaded) return Promise.resolve();
        return this._audio.play().catch(() => { });
    }

    pause() { this._audio.pause(); }

    stop() { this._audio.pause(); this._audio.currentTime = 0; }

    get currentTime() { return this._audio.currentTime; }
    set currentTime(v) { this._audio.currentTime = v; }

    get duration() { return this._audio.duration || 0; }

    get volume() { return this._audio.volume; }
    set volume(v) { this._audio.volume = Math.max(0, Math.min(1, v)); }

    set onEnded(fn) {
        this._onEnded = fn;
        this._audio.onended = fn;
    }

    get element() { return this._audio; }
}
