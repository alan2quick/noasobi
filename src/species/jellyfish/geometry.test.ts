import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildJellyfishGeometry } from './geometry';
import { ARM, BELL_R, DISC_R, RINGS, SEGMENTS, TENTACLE_LANES, ringRho } from './layout';
import { DESIGN_TEX_HEIGHT, DESIGN_TEX_WIDTH } from '../../core/types';

describe('jellyfish geometry', () => {
  const g = buildJellyfishGeometry();
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const aj = g.getAttribute('aJ');
  const idx = g.getIndex()!;

  it('is cheap: 400..900 triangles, 16-bit indices, matching attribute counts', () => {
    const tris = idx.count / 3;
    expect(tris).toBeGreaterThanOrEqual(400);
    expect(tris).toBeLessThanOrEqual(900);
    expect(pos.count).toBeLessThan(65536);
    expect(uv.count).toBe(pos.count);
    expect(aj.count).toBe(pos.count);
    expect(g.getAttribute('normal').count).toBe(pos.count);
    for (let i = 0; i < idx.count; i++) expect(idx.getX(i)).toBeLessThan(pos.count);
  });

  it('is a metres-sized jelly: bell radius ~0.35, hanging below the rim plane', () => {
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    expect(bb.max.x).toBeGreaterThan(BELL_R * 0.9);
    expect(bb.max.x).toBeLessThan(BELL_R * 1.2);
    expect(bb.max.y).toBeGreaterThan(0.15);
    expect(bb.min.y).toBeLessThan(-0.5);
    expect(bb.min.y).toBeGreaterThan(-1.1);
  });

  it('bell vertices form a closed dome with outward normals', () => {
    const n = g.getAttribute('normal');
    const bellCount = 1 + RINGS * SEGMENTS;
    let outward = 0;
    for (let i = 1; i < bellCount; i++) {
      const r = new Vector3(pos.getX(i), 0, pos.getZ(i));
      const nn = new Vector3(n.getX(i), n.getY(i), n.getZ(i));
      if (nn.dot(r.normalize()) > 0) outward++;
    }
    expect(outward).toBeGreaterThan((bellCount - 1) * 0.97);
    // Bell weight runs 0 at the apex to 1 at the rim; no trail on the bell.
    expect(aj.getX(0)).toBe(0);
    expect(aj.getX(bellCount - 1)).toBe(1);
    for (let i = 0; i < bellCount; i++) expect(aj.getY(i)).toBe(0);
  });

  it('trail runs 0..1 on the arms and tentacles', () => {
    const bellCount = 1 + RINGS * SEGMENTS;
    let min = 1;
    let max = 0;
    for (let i = bellCount; i < aj.count; i++) {
      min = Math.min(min, aj.getY(i));
      max = Math.max(max, aj.getY(i));
      expect(aj.getZ(i)).toBeGreaterThan(0.3);
    }
    expect(min).toBe(0);
    expect(max).toBe(1);
  });

  it('UVs stay inside the canvas, inside their islands, with islands >= 64 px apart', () => {
    const W = DESIGN_TEX_WIDTH;
    const H = DESIGN_TEX_HEIGHT;
    const bellCount = 1 + RINGS * SEGMENTS;
    for (let i = 0; i < pos.count; i++) {
      const x = uv.getX(i) * W;
      const y = (1 - uv.getY(i)) * H;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(H);
      if (i < bellCount) {
        expect(Math.hypot(x - 256, y - 256)).toBeLessThanOrEqual(DISC_R + 0.01);
      }
    }
    // Rim ring is at the disc edge.
    expect(ringRho(RINGS)).toBeCloseTo(DISC_R, 6);
    const islands = [
      { x0: 256 - DISC_R, x1: 256 + DISC_R, y0: 256 - DISC_R, y1: 256 + DISC_R },
      ARM,
      ...TENTACLE_LANES,
    ];
    for (let a = 0; a < islands.length; a++) {
      for (let b = a + 1; b < islands.length; b++) {
        const A = islands[a];
        const B = islands[b];
        const dx = Math.max(0, Math.max(A.x0 - B.x1, B.x0 - A.x1));
        const dy = Math.max(0, Math.max(A.y0 - B.y1, B.y0 - A.y1));
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(64);
      }
    }
  });

  it('texel density is roughly uniform between the bell and the arms', () => {
    // px per metre along the arm vs along the bell profile.
    const arm = (ARM.y1 - ARM.y0) / 0.45;
    const bell = DISC_R / (BELL_R * 1.4);
    expect(arm / bell).toBeGreaterThan(0.5);
    expect(arm / bell).toBeLessThan(2);
  });
});
