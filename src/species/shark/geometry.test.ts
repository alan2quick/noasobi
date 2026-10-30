import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildSharkGeometry } from './geometry';
import { CAUDAL_OUTLINE, PECTORAL_ISLAND, PECTORAL_LEN, PELVIC_ISLAND, triangulate } from './layout';

describe('shark geometry', () => {
  const g = buildSharkGeometry();
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const spine = g.getAttribute('aSpine');
  const pec = g.getAttribute('aPec');
  const eye = g.getAttribute('aEye');
  const nrm = g.getAttribute('normal');
  const tris = g.getIndex()!.count / 3;

  it('stays within the low-poly budget and carries the swim attributes', () => {
    expect(tris).toBeGreaterThanOrEqual(700);
    expect(tris).toBeLessThanOrEqual(1200);
    for (const name of ['aSpine', 'aPec', 'aEye', 'uv', 'normal']) expect(g.getAttribute(name)).toBeTruthy();
  });

  it('is 1 unit long, snout +X, aSpine 0 at the snout → 1 at the tail tip', () => {
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

  it('has rigid pectorals: aPec is zero everywhere', () => {
    for (let i = 0; i < pec.count; i++) expect(pec.getX(i)).toBe(0);
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

  it('flags a single dark eye per flank with aEye.x = 2', () => {
    let eyeVerts = 0;
    for (let i = 0; i < eye.count; i++) if (eye.getX(i) > 0.5) {
      eyeVerts++;
      expect(eye.getX(i)).toBe(2);
    }
    expect(eyeVerts).toBe(2 * 21);
  });

  it('has a heterocercal tail: the upper lobe is clearly longer than the lower', () => {
    const upper = CAUDAL_OUTLINE.reduce((a, p) => (p[1] > a[1] ? p : a));
    const lower = CAUDAL_OUTLINE.reduce((a, p) => (p[1] < a[1] ? p : a));
    expect(Math.abs(upper[0])).toBeGreaterThan(Math.abs(lower[0]) + 0.04);
    expect(upper[1]).toBeGreaterThan(Math.abs(lower[1]));
  });

  it('keeps the paired-fin uv islands apart from the body and each other (>= 64 px)', () => {
    // Body + median fins + tail occupy canvas py <= ~315; islands live at py ~410..470.
    const maxBodyPy = 330;
    const islandPx = (i: { x: number; y: number }) => [256 - 471.04 * i.x, 256 - 471.04 * i.y];
    const [pxA, pyA] = islandPx(PECTORAL_ISLAND);
    const [pxB, pyB] = islandPx(PELVIC_ISLAND);
    expect(pyA - 40).toBeGreaterThan(maxBodyPy + 64);
    expect(pyB - 40).toBeGreaterThan(maxBodyPy + 64);
    expect(pxB - (pxA + PECTORAL_LEN * 471.04)).toBeGreaterThanOrEqual(64);
    // Every vertex that is not body/median-fin sits in the island strip, everything else above it.
    let islandVerts = 0;
    for (let i = 0; i < pos.count / 2; i++) {
      const py = (1 - uv.getY(i)) * 512;
      if (py > 380) islandVerts++;
      else expect(py).toBeLessThan(maxBodyPy);
    }
    expect(islandVerts).toBeGreaterThan(20);
  });
});

describe('triangulate', () => {
  it('covers a concave polygon exactly (area preserved)', () => {
    const poly: [number, number][] = [[0, 0], [4, 0], [4, 3], [2, 1], [0, 3]];
    const area = (a: number[], b: number[], c: number[]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    const sum = triangulate(poly).reduce((s, [a, b, c]) => s + area(poly[a], poly[b], poly[c]), 0);
    expect(sum).toBeCloseTo(8, 6); // 12 (rectangle 4x3) - 4 (notch)
  });
});
