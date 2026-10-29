import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { LiveTransform } from '../../core/runtime';
import { pickCreature, pickScore, projectToScreen, projectedRadiusPx, TOUCH_RADIUS_PX } from './picking';
import { anchorAt, habitatHeight, rollEntity } from './placement';
import { terrainHeight, SURFACE_Y } from '../../core/terrain';
import type { SpeciesDef } from '../../core/types';

const W = 400;
const H = 800;

function cam() {
  const c = new PerspectiveCamera(55, W / H, 0.1, 140);
  c.position.set(0, 0, 0);
  c.lookAt(0, 0, -1);
  c.updateMatrixWorld();
  return c;
}

const lt = (x: number, y: number, z: number, radius = 0.2): LiveTransform => ({
  position: new Vector3(x, y, z),
  quaternion: new Quaternion(),
  radius,
});

describe('projectToScreen', () => {
  it('maps the view axis to the viewport centre and reports depth', () => {
    const out = { x: 0, y: 0, depth: 0 };
    expect(projectToScreen(new Vector3(0, 0, -10), cam(), W, H, out)).toBe(true);
    expect(out.x).toBeCloseTo(W / 2, 5);
    expect(out.y).toBeCloseTo(H / 2, 5);
    expect(out.depth).toBeCloseTo(10, 5);
  });

  it('puts points above the axis higher on screen (smaller y)', () => {
    const out = { x: 0, y: 0, depth: 0 };
    projectToScreen(new Vector3(1, 1, -10), cam(), W, H, out);
    expect(out.x).toBeGreaterThan(W / 2);
    expect(out.y).toBeLessThan(H / 2);
  });

  it('rejects points behind the camera', () => {
    const out = { x: 0, y: 0, depth: 0 };
    expect(projectToScreen(new Vector3(0, 0, 5), cam(), W, H, out)).toBe(false);
  });
});

describe('projectedRadiusPx', () => {
  it('matches the perspective formula and shrinks with distance', () => {
    const f = H / 2 / Math.tan((55 * Math.PI) / 360);
    expect(projectedRadiusPx(1, 10, 55, H)).toBeCloseTo(f / 10, 5);
    expect(projectedRadiusPx(1, 20, 55, H)).toBeCloseTo(projectedRadiusPx(1, 10, 55, H) / 2, 5);
    expect(projectedRadiusPx(1, 0, 55, H)).toBe(0);
  });

  it('agrees with projecting an offset point', () => {
    const c = cam();
    const a = { x: 0, y: 0, depth: 0 };
    const b = { x: 0, y: 0, depth: 0 };
    projectToScreen(new Vector3(0, 0, -8), c, W, H, a);
    projectToScreen(new Vector3(0, 0.5, -8), c, W, H, b);
    expect(a.y - b.y).toBeCloseTo(projectedRadiusPx(0.5, 8, 55, H), 3);
  });
});

describe('pickScore', () => {
  it('accepts inside touch + radius and rejects outside', () => {
    expect(pickScore(100, 100, 100, 100, 5)).toBe(0);
    expect(pickScore(100, 100, 100 + TOUCH_RADIUS_PX + 4, 100, 5)).toBeLessThan(1);
    expect(pickScore(100, 100, 100 + TOUCH_RADIUS_PX + 6, 100, 5)).toBe(Infinity);
  });
});

describe('pickCreature', () => {
  it('picks the creature nearest the tap within the touch radius', () => {
    const t = new Map<string, LiveTransform>([
      ['a', lt(0, 0, -10)],
      ['b', lt(1.2, 0, -10)],
    ]);
    const c = cam();
    const b = { x: 0, y: 0, depth: 0 };
    projectToScreen(t.get('b')!.position, c, W, H, b);
    expect(pickCreature(t, c, W, H, b.x - 3, b.y + 2)).toBe('b');
    expect(pickCreature(t, c, W, H, W / 2 + 1, H / 2)).toBe('a');
  });

  it('returns null when nothing is close enough', () => {
    const t = new Map([['a', lt(0, 0, -10)]]);
    expect(pickCreature(t, cam(), W, H, 20, 20)).toBeNull();
  });

  it('ignores creatures behind the camera', () => {
    const t = new Map([['back', lt(0, 0, 10)]]);
    expect(pickCreature(t, cam(), W, H, W / 2, H / 2)).toBeNull();
  });

  it('gives near, big creatures a larger hit area', () => {
    const t = new Map([['near', lt(0, 0, -2, 0.5)]]);
    const r = projectedRadiusPx(0.5, 2, 55, H);
    expect(pickCreature(t, cam(), W, H, W / 2 + TOUCH_RADIUS_PX + r - 2, H / 2)).toBe('near');
  });

  it('breaks near-ties toward the camera', () => {
    const t = new Map([
      ['far', lt(0, 0, -30)],
      ['near', lt(0, 0, -5)],
    ]);
    expect(pickCreature(t, cam(), W, H, W / 2, H / 2)).toBe('near');
  });
});

const fish = {
  id: 'f',
  name: 'F',
  kind: 'creature',
  habitat: { heightMin: 1, heightMax: 3, coverAffinity: 0 },
  scaleRange: [0.8, 1.2],
} as unknown as SpeciesDef;
const plant = { id: 'p', name: 'P', kind: 'plant', habitat: { heightMin: 0, heightMax: 0, coverAffinity: 0 }, scaleRange: [1, 2] } as unknown as SpeciesDef;

describe('placement', () => {
  it('floats creatures in their habitat band and roots plants on the ground', () => {
    expect(habitatHeight(fish, 0)).toBe(1);
    expect(habitatHeight(fish, 1)).toBe(3);
    expect(habitatHeight(plant, 1)).toBe(0);
    const out = new Vector3();
    anchorAt(fish, 5, -4, 0.5, out);
    expect(out.y).toBeCloseTo(terrainHeight(5, -4) + 2, 6);
    anchorAt(plant, 5, -4, 0.5, out);
    expect(out.y).toBeCloseTo(terrainHeight(5, -4), 6);
    expect(anchorAt({ ...fish, habitat: { heightMin: 100, heightMax: 100, coverAffinity: 0 } } as SpeciesDef, 0, 0, 0, out).y).toBe(SURFACE_Y - 1);
  });

  it('rolls rotation and scale inside the species range', () => {
    let i = 0;
    const seq = [0.5, 0.25, 1];
    const e = rollEntity(fish, 'd1', 'Nemo', 2, 3, () => seq[i++ % seq.length]);
    expect(e.position[0]).toBe(2);
    expect(e.position[2]).toBe(3);
    expect(e.rotationY).toBeCloseTo(Math.PI / 2, 6);
    expect(e.scale).toBeCloseTo(1.2, 6);
    expect(e.designId).toBe('d1');
    expect(rollEntity(plant, '', 'x', 0, 0).designId).toBe('template:p');
  });
});
