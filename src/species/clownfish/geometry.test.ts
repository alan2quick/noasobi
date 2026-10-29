import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildClownfishGeometry } from './geometry';

describe('clownfish geometry', () => {
  const g = buildClownfishGeometry();
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const spine = g.getAttribute('aSpine');
  const nrm = g.getAttribute('normal');
  const tris = g.getIndex()!.count / 3;

  it('stays within the low-poly budget and carries the swim attributes', () => {
    expect(tris).toBeGreaterThanOrEqual(400);
    expect(tris).toBeLessThanOrEqual(900);
    for (const name of ['aSpine', 'aPec', 'aEye', 'uv', 'normal']) expect(g.getAttribute(name)).toBeTruthy();
  });

  it('is 1 unit long, nose +X, aSpine 0 at the nose → 1 at the tail', () => {
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    expect(bb.max.x).toBeCloseTo(0.5, 2);
    expect(bb.min.x).toBeCloseTo(-0.5, 2);
    for (let i = 0; i < pos.count; i++) {
      expect(spine.getX(i)).toBeGreaterThanOrEqual(0);
      expect(spine.getX(i)).toBeLessThanOrEqual(1);
      expect(spine.getX(i)).toBeCloseTo(Math.min(1, Math.max(0, 0.5 - pos.getX(i))), 5);
    }
  });

  it('follows the bilateral uv convention: left flank (z<0) u<0.5, mirror at (1-u, v)', () => {
    const half = pos.count / 2;
    for (let i = 0; i < half; i++) {
      const j = i + half;
      expect(pos.getZ(i)).toBeLessThanOrEqual(1e-6);
      expect(pos.getZ(j)).toBeCloseTo(-pos.getZ(i), 6);
      expect(uv.getX(i)).toBeLessThan(0.5);
      expect(uv.getX(j)).toBeCloseTo(1 - uv.getX(i), 6);
      expect(uv.getY(j)).toBeCloseTo(uv.getY(i), 6);
      expect(uv.getY(i)).toBeGreaterThan(0);
      expect(uv.getY(i)).toBeLessThan(1);
    }
  });

  it('has outward-facing triangles that agree with vertex normals', () => {
    const idx = g.getIndex()!;
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), vn = new Vector3();
    let bad = 0;
    for (let t = 0; t < idx.count; t += 3) {
      a.fromBufferAttribute(pos, idx.getX(t));
      b.fromBufferAttribute(pos, idx.getX(t + 1));
      c.fromBufferAttribute(pos, idx.getX(t + 2));
      n.subVectors(b, a).cross(c.clone().sub(a));
      if (n.lengthSq() < 1e-12) continue;
      vn.fromBufferAttribute(nrm, idx.getX(t));
      if (n.dot(vn) < 0) bad++;
    }
    expect(bad).toBe(0);
  });
});
