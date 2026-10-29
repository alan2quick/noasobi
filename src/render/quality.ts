import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useApp, type Quality } from '../core/store';

/**
 * Quality tiers.
 * - `detectQuality()` picks a starting tier from the device (or `?quality=low|medium|high`).
 * - `<QualityManager/>` (mounted by OceanBiome) sets it, caps the DPR, and adapts at runtime:
 *   when frames stay slow it first lowers the DPR, then the tier; it raises them back carefully.
 * - Effects read the tier with `useQuality()` / `useQualityPreset()`.
 */

export interface QualityPreset {
  /** Highest DPR this tier will use (also capped by the device). */
  maxDpr: number;
  /** Marine-snow particle count. */
  snow: number;
  /** God-ray shafts (0 disables the effect). */
  godRays: number;
  /** Bubble streams. */
  bubbleStreams: number;
  /** Sand ripples in the seabed shader. */
  ripples: boolean;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: { maxDpr: 1, snow: 220, godRays: 0, bubbleStreams: 3, ripples: false },
  medium: { maxDpr: 1.25, snow: 480, godRays: 10, bubbleStreams: 5, ripples: true },
  high: { maxDpr: 1.5, snow: 900, godRays: 16, bubbleStreams: 7, ripples: true },
};

export const useQuality = () => useApp((s) => s.quality);
export const useQualityPreset = () => QUALITY_PRESETS[useApp((s) => s.quality)];

const TIERS: Quality[] = ['low', 'medium', 'high'];

function forcedQuality(): Quality | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search).get('quality');
  return q && (TIERS as string[]).includes(q) ? (q as Quality) : null;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPadOS || coarse;
}

/** Sensible starting tier for this device. */
export function detectQuality(): Quality {
  const forced = forcedQuality();
  if (forced) return forced;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency || 8;
  if (mem <= 2 || cores <= 2) return 'low';
  if (isMobileDevice()) return mem <= 3 ? 'low' : 'medium';
  return 'high';
}

/** Adaptive ladder, best first. The effective DPR is also capped by the device's own DPR. */
const LADDER: { tier: Quality; dpr: number }[] = [
  { tier: 'high', dpr: 1.5 },
  { tier: 'high', dpr: 1.25 },
  { tier: 'medium', dpr: 1.25 },
  { tier: 'medium', dpr: 1 },
  { tier: 'low', dpr: 1 },
  { tier: 'low', dpr: 0.85 },
];

const SLOW_MS = 1000 / 48; // sustained frame time above this is "too slow"
const FAST_MS = 1000 / 57; // sustained frame time below this is "comfortable"
const DOWN_AFTER = 2.5; // seconds of slow frames before stepping down
const UP_AFTER = 10; // seconds of fast frames before stepping up
const COOLDOWN = 2; // seconds ignored after any change (shader compiles, resize)
const PROBE_SECONDS = 3; // seconds measured after a step down before judging it
const PROBE_GAIN = 0.9; // a step down must cut frame time by at least 10% to count
const CAPPED_SLOW_MS = 1000 / 24; // once capped, only step down if it gets worse than this

/** Mounted once inside the Canvas. */
export function QualityManager() {
  const setDpr = useThree((s) => s.setDpr);
  const st = useRef({
    index: 0,
    start: 0,
    ema: 16.7,
    slow: 0,
    fast: 0,
    cooldown: COOLDOWN,
    failures: new Array(LADDER.length).fill(0) as number[],
    adaptive: true,
    // After a step down, check that it actually helped. Phones in Low Power Mode cap at 30fps no
    // matter what we draw; without this check they would fall all the way to the lowest step.
    probe: null as { from: number; emaBefore: number; t: number } | null,
    capped: false,
  });

  const deviceDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const effDpr = (i: number) => Math.min(LADDER[i].dpr, deviceDpr);

  const apply = (i: number) => {
    const s = st.current;
    s.index = i;
    s.cooldown = COOLDOWN;
    s.slow = 0;
    s.fast = 0;
    setDpr(effDpr(i));
    if (useApp.getState().quality !== LADDER[i].tier) useApp.getState().setQuality(LADDER[i].tier);
  };

  useEffect(() => {
    const tier = detectQuality();
    const s = st.current;
    s.adaptive = forcedQuality() === null;
    s.start = LADDER.findIndex((l) => l.tier === tier);
    apply(s.start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    const s = st.current;
    if (!s.adaptive || document.hidden) return;
    const ms = delta * 1000;
    if (ms > 250) return; // tab switch or hitch, not a trend
    if (s.cooldown > 0) {
      s.cooldown -= delta;
      s.ema = 16.7;
      return;
    }
    s.ema += (ms - s.ema) * 0.05;

    if (s.ema > SLOW_MS) {
      s.slow += delta;
      s.fast = 0;
    } else if (s.ema < FAST_MS) {
      s.fast += delta;
      s.slow = 0;
    } else {
      s.slow = Math.max(0, s.slow - delta);
    }

    if (s.probe) {
      s.probe.t += delta;
      if (s.probe.t < PROBE_SECONDS) return;
      if (s.ema > s.probe.emaBefore * PROBE_GAIN) {
        // No real gain: frame rate is capped by the display or power mode, not by our rendering.
        const from = s.probe.from;
        s.probe = null;
        s.capped = true;
        apply(from);
        return;
      }
      s.probe = null;
    }

    const mayStepDown = !s.capped || s.ema > CAPPED_SLOW_MS;
    if (s.slow > DOWN_AFTER && mayStepDown && s.index < LADDER.length - 1) {
      s.failures[s.index]++;
      s.probe = { from: s.index, emaBefore: s.ema, t: 0 };
      let next = s.index + 1;
      // Skip steps that change nothing on this device (e.g. DPR steps on a DPR-1 screen).
      while (
        next < LADDER.length - 1 &&
        LADDER[next].tier === LADDER[s.index].tier &&
        effDpr(next) === effDpr(s.index)
      ) next++;
      apply(next);
    } else if (s.fast > UP_AFTER && s.index > s.start) {
      let prev = s.index - 1;
      while (prev > s.start && LADDER[prev].tier === LADDER[s.index].tier && effDpr(prev) === effDpr(s.index)) prev--;
      // Never climb back into a step that has already failed twice.
      if (s.failures[prev] < 2) apply(prev);
      else s.fast = 0;
    }
  });

  return null;
}
