/**
 * Synthesised sound, Web Audio only (no files).
 *
 * Graph (built once, after the first user gesture):
 *   brown-noise loop -> lowpass (LFO on cutoff) -> swell gain (LFO on gain) -┐
 *   two low oscillators -> lowpass -> drone gain ---------------------------├-> master -> out
 *   bubble blips / UI sounds (short-lived nodes) -> sfx gain ---------------┘
 *
 * CPU: one looping buffer source, three oscillators, two filters and a handful of gains run
 * continuously; one-shots create two or three nodes that stop themselves. When muted or hidden
 * the AudioContext is suspended, which stops all processing.
 */

type Ctx = AudioContext;

const AMBIENCE_LEVEL = 0.55;
const DRONE_LEVEL = 0.07;
const SFX_LEVEL = 0.5;

class SoundEngine {
  private ctx: Ctx | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ambFilter!: BiquadFilterNode;
  private droneGain!: GainNode;
  private muted = false;
  private hidden = false;
  private daylight = 1;
  private blipTimer: ReturnType<typeof setTimeout> | null = null;

  /** True once the context exists (after the first gesture). */
  get started() {
    return this.ctx !== null;
  }

  /** Call from a user-gesture handler. Creates and/or resumes the context. */
  unlock() {
    if (!this.ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC({ latencyHint: 'playback' });
      } catch {
        return;
      }
      this.build(this.ctx);
      this.scheduleBlip();
    }
    this.applyRunning();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyRunning();
  }

  setHidden(h: boolean) {
    this.hidden = h;
    this.applyRunning();
  }

  /** 0 = night .. 1 = day. Night makes the ambience a little darker and the drone a little louder. */
  setDaylight(d: number) {
    this.daylight = d;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.ambFilter.frequency.setTargetAtTime(240 + 200 * d, t, 1.5);
    this.droneGain.gain.setTargetAtTime(DRONE_LEVEL * (1.25 - 0.25 * d), t, 1.5);
  }

  private get audible() {
    return this.ctx !== null && !this.muted && !this.hidden && this.ctx.state === 'running';
  }

  private applyRunning() {
    const ctx = this.ctx;
    if (!ctx) return;
    const want = !this.muted && !this.hidden;
    const t = ctx.currentTime;
    if (want) {
      if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(1, t, 0.4);
    } else {
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(0, t, 0.08);
      // Suspend after the fade so nothing is processed while silent.
      setTimeout(() => {
        if ((this.muted || this.hidden) && ctx.state === 'running') void ctx.suspend().catch(() => undefined);
      }, 400);
    }
  }

  private build(ctx: Ctx) {
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // ── Ambience: looping brown noise, low-passed, with slow swells ──────────────────────────
    const seconds = 6;
    const len = Math.floor(ctx.sampleRate * seconds);
    const fade = Math.floor(ctx.sampleRate * 0.5);
    const raw = brownNoise(len + fade);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Crossfade the tail into the head so the loop has no click.
    for (let i = 0; i < len; i++) data[i] = raw[i];
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[i] = raw[i] * k + raw[len + i] * (1 - k);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    this.ambFilter = ctx.createBiquadFilter();
    this.ambFilter.type = 'lowpass';
    this.ambFilter.frequency.value = 440;
    this.ambFilter.Q.value = 0.6;

    const swell = ctx.createGain();
    swell.gain.value = AMBIENCE_LEVEL;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = AMBIENCE_LEVEL * 0.45;
    lfo.connect(lfoDepth).connect(swell.gain);

    const cutLfo = ctx.createOscillator();
    cutLfo.frequency.value = 0.043;
    const cutDepth = ctx.createGain();
    cutDepth.gain.value = 120;
    cutLfo.connect(cutDepth).connect(this.ambFilter.frequency);

    noise.connect(this.ambFilter).connect(swell).connect(this.master);

    // ── Drone: low, muffled ──────────────────────────────────────────────────────────────────
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 180;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = DRONE_LEVEL;
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = 55;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = 82.6; // a slightly detuned fifth for a slow beat
    o1.connect(droneFilter);
    o2.connect(droneFilter);
    droneFilter.connect(this.droneGain).connect(this.master);

    // ── One-shots ────────────────────────────────────────────────────────────────────────────
    this.sfx = ctx.createGain();
    this.sfx.gain.value = SFX_LEVEL;
    this.sfx.connect(this.master);

    const t = ctx.currentTime;
    noise.start(t);
    lfo.start(t);
    cutLfo.start(t);
    o1.start(t);
    o2.start(t);
    this.setDaylight(this.daylight);
  }

  // ── Bubble blips ───────────────────────────────────────────────────────────────────────────
  private scheduleBlip() {
    const wait = 2200 + Math.random() * 6000;
    this.blipTimer = setTimeout(() => {
      if (this.audible) {
        const n = Math.random() < 0.35 ? 2 + Math.floor(Math.random() * 3) : 1;
        for (let i = 0; i < n; i++) this.blip(i * (0.07 + Math.random() * 0.09), 0.05 + Math.random() * 0.05);
      }
      this.scheduleBlip();
    }, wait);
  }

  /** A sine chirp sweeping upward, like a small bubble. */
  private blip(delay: number, level: number) {
    const ctx = this.ctx!;
    const f0 = 280 + Math.random() * 380;
    this.tone(ctx.currentTime + delay, f0, f0 * (2.2 + Math.random()), 0.09 + Math.random() * 0.05, level, 'sine');
  }

  /** One oscillator with an exponential pitch sweep and a quick attack/decay envelope. */
  private tone(at: number, f0: number, f1: number, dur: number, level: number, type: OscillatorType) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.sfx);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  // ── UI sounds ──────────────────────────────────────────────────────────────────────────────
  /** Soft pop for buttons. */
  pop() {
    if (!this.audible) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 520, 240, 0.08, 0.22, 'sine');
  }

  /** Bloop for placing something. */
  bloop() {
    if (!this.audible) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 180, 520, 0.14, 0.32, 'sine');
    this.tone(t + 0.11, 420, 300, 0.12, 0.14, 'sine');
  }

  /** Sprinkle for feeding: a few tiny high ticks. */
  sprinkle() {
    if (!this.audible) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 6; i++) {
      const f = 1800 + Math.random() * 1600;
      this.tone(t + i * 0.045 + Math.random() * 0.02, f, f * 0.85, 0.06, 0.06, 'triangle');
    }
  }

  /** Little chime for saving a design. */
  chime() {
    if (!this.audible) return;
    const t = this.ctx!.currentTime;
    const notes = [659.25, 830.61, 987.77, 1318.5]; // E5 G#5 B5 E6
    notes.forEach((f, i) => {
      this.tone(t + i * 0.09, f, f, 0.7, 0.12, 'sine');
      this.tone(t + i * 0.09, f * 2, f * 2, 0.35, 0.03, 'sine');
    });
  }

  /** For tests/debugging: stops timers. */
  dispose() {
    if (this.blipTimer) clearTimeout(this.blipTimer);
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** Integrated white noise with a leak, normalised to about ±1. */
export function brownNoise(n: number): Float32Array {
  const out = new Float32Array(n);
  let last = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    out[i] = last;
    const a = Math.abs(last);
    if (a > peak) peak = a;
  }
  const k = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

export const sound = new SoundEngine();
