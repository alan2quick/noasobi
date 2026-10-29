import { describe, expect, it } from 'vitest';
import {
  canvasToUv,
  clampRect,
  emptyRect,
  fitOrtho,
  hexToRgb,
  hsvToRgb,
  includeBox,
  interpolateScreen,
  isSeamJump,
  mergeRects,
  mirrorRect,
  mirrorX,
  rgbToHex,
  rgbToHsv,
  splitAtSeams,
  stampsAlong,
  texelScale,
  uvToCanvas,
} from './paintMath';

describe('uv <-> canvas', () => {
  it('maps canvas top to v = 1', () => {
    expect(uvToCanvas(0, 1)).toEqual({ x: 0, y: 0 });
    expect(uvToCanvas(1, 0)).toEqual({ x: 1024, y: 512 });
    expect(uvToCanvas(0.25, 0.75)).toEqual({ x: 256, y: 128 });
  });
  it('round trips', () => {
    const p = uvToCanvas(0.3, 0.6);
    const uv = canvasToUv(p.x, p.y);
    expect(uv.u).toBeCloseTo(0.3);
    expect(uv.v).toBeCloseTo(0.6);
  });
});

describe('mirroring', () => {
  it('mirrors a left-flank point to the right flank at 1 - u', () => {
    const p = uvToCanvas(0.2, 0.5);
    const m = mirrorX(p.x);
    expect(canvasToUv(m, p.y).u).toBeCloseTo(0.8);
  });
  it('mirrors rects', () => {
    expect(mirrorRect({ x: 100, y: 10, w: 50, h: 20 })).toEqual({ x: 874, y: 10, w: 50, h: 20 });
  });
});

describe('stroke interpolation', () => {
  it('fills gaps between distant samples', () => {
    const pts = interpolateScreen({ x: 0, y: 0 }, { x: 10, y: 0 }, 3);
    expect(pts.length).toBe(4);
    expect(pts[pts.length - 1]).toEqual({ x: 10, y: 0 });
    for (let i = 1; i < pts.length; i++) expect(pts[i].x - pts[i - 1].x).toBeLessThanOrEqual(3);
  });
  it('returns the end point for tiny moves', () => {
    expect(interpolateScreen({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 3)).toEqual([{ x: 0.5, y: 0 }]);
  });
  it('spaces stamps evenly across segments with carry', () => {
    const a = stampsAlong({ x: 0, y: 0 }, { x: 5, y: 0 }, 2, 0);
    expect(a.points.map((p) => p.x)).toEqual([2, 4]);
    expect(a.carry).toBeCloseTo(1);
    const b = stampsAlong({ x: 5, y: 0 }, { x: 10, y: 0 }, 2, a.carry);
    expect(b.points.map((p) => p.x)).toEqual([6, 8, 10]);
    expect(b.carry).toBeCloseTo(0);
  });
  it('does not stamp on a zero-length segment', () => {
    expect(stampsAlong({ x: 1, y: 1 }, { x: 1, y: 1 }, 2, 0.5)).toEqual({ points: [], carry: 0.5 });
  });
});

describe('seam breaking', () => {
  it('detects jumps', () => {
    expect(isSeamJump({ x: 10, y: 10 }, { x: 14, y: 10 }, 64)).toBe(false);
    expect(isSeamJump({ x: 500, y: 10 }, { x: 900, y: 10 }, 64)).toBe(true);
  });
  it('splits polylines at misses and seam jumps', () => {
    const hits = [{ x: 0, y: 0 }, { x: 4, y: 0 }, null, { x: 8, y: 0 }, { x: 600, y: 0 }, { x: 604, y: 0 }];
    const lines = splitAtSeams(hits, 64);
    expect(lines.length).toBe(3);
    expect(lines[0].length).toBe(2);
    expect(lines[1]).toEqual([{ x: 8, y: 0 }]);
    expect(lines[2].length).toBe(2);
  });
});

describe('rects', () => {
  it('accumulates and clamps', () => {
    const r = emptyRect();
    includeBox(r, -5, 10, 20, 30);
    includeBox(r, 100, 20, 110, 40);
    expect(clampRect(r)).toEqual({ x: 0, y: 10, w: 110, h: 30 });
    expect(clampRect(emptyRect())).toBeNull();
  });
  it('merges overlapping mirrored rects but keeps separate ones', () => {
    expect(mergeRects([{ x: 480, y: 0, w: 60, h: 10 }, mirrorRect({ x: 480, y: 0, w: 60, h: 10 })])).toEqual([{ x: 480, y: 0, w: 64, h: 10 }]);
    expect(mergeRects([{ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 0, w: 10, h: 10 }]).length).toBe(2);
  });
});

describe('texel scale', () => {
  it('measures world units per canvas pixel on a stretched quad', () => {
    // 2 x 1 world quad mapped to the whole 1024 x 512 canvas
    const pos = [0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0];
    const uv = [0, 0, 1, 0, 1, 1, 0, 1];
    const idx = [0, 1, 2, 0, 2, 3];
    const t = texelScale(pos, uv, idx);
    expect(t.unitsPerPxX).toBeCloseTo(2 / 1024);
    expect(t.unitsPerPxY).toBeCloseTo(1 / 512);
  });
});

describe('framing and colour', () => {
  it('fits a box into a viewport aspect', () => {
    const wide = fitOrtho(4, 1, 1, 1);
    expect(wide.halfW).toBeCloseTo(2);
    expect(wide.halfH).toBeCloseTo(2);
    const tall = fitOrtho(1, 4, 2, 1);
    expect(tall.halfH).toBeCloseTo(2);
    expect(tall.halfW).toBeCloseTo(4);
  });
  it('round trips hsv and hex', () => {
    expect(rgbToHex(...hsvToRgb(0, 1, 1))).toBe('#ff0000');
    const hsv = rgbToHsv(...hexToRgb('#1e88e5'));
    expect(rgbToHex(...hsvToRgb(hsv.h, hsv.s, hsv.v))).toBe('#1e88e5');
  });
});
