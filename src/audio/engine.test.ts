import { describe, expect, it } from 'vitest';
import { brownNoise } from './engine';

describe('brownNoise', () => {
  it('is normalised, finite and mostly low-frequency', () => {
    const n = brownNoise(48000);
    let peak = 0;
    let diff = 0;
    let energy = 0;
    for (let i = 0; i < n.length; i++) {
      expect(Number.isFinite(n[i])).toBe(true);
      peak = Math.max(peak, Math.abs(n[i]));
      energy += n[i] * n[i];
      if (i > 0) diff += (n[i] - n[i - 1]) ** 2;
    }
    expect(peak).toBeCloseTo(0.9, 5);
    // Brown noise: sample-to-sample changes are tiny compared with the signal itself.
    expect(diff / energy).toBeLessThan(0.05);
  });
});
