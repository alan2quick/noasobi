import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Quaternion, Vector3, BufferGeometry } from 'three';
import { SpatialHash } from './spatialHash';
import {
  activityLevel,
  angleDelta,
  approach,
  boundsSteer,
  composeMatrix,
  damp,
  heightBandSteer,
  quatYawPitchRoll,
  wrapAngle,
  yawOf,
} from './steering';
import { FishSim } from './fishSim';
import { runtime } from '../core/runtime';
import { terrainHeight } from '../core/terrain';
import type { PlacedEntity, SpeciesDef } from '../core/types';
import { clearFood, nearestFood, spawnFood, stepFood } from './food';

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

describe('SpatialHash', () => {
  it('finds exactly the brute-force neighbours (3D)', () => {
    const r = rng(1);
    const n = 500;
    const xs = new Float32Array(n), ys = new Float32Array(n), zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = (r() - 0.5) * 40;
      ys[i] = (r() - 0.5) * 10;
      zs[i] = (r() - 0.5) * 40;
    }
    const h = new SpatialHash(2, false, 64, 6); // small table → many collisions
    h.build(xs, ys, zs, n);
    const out = new Int32Array(n);
    for (let q = 0; q < 50; q++) {
      const qx = (r() - 0.5) * 40, qy = (r() - 0.5) * 10, qz = (r() - 0.5) * 40;
      const rad = 0.5 + r() * 4;
      const m = h.query(qx, qy, qz, rad, out);
      const found = new Set<number>();
      for (let k = 0; k < m; k++) {
        expect(found.has(out[k])).toBe(false); // no duplicates
        found.add(out[k]);
      }
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(xs[i] - qx, ys[i] - qy, zs[i] - qz);
        if (d <= rad) expect(found.has(i)).toBe(true);
      }
    }
  });

  it('flat mode ignores y and handles empty builds / capacity growth', () => {
    const h = new SpatialHash(4, true, 2);
    const out = new Int32Array(16);
    h.build([], [], [], 0);
    expect(h.query(0, 0, 0, 5, out)).toBe(0);
    h.build([0, 1, 50], [100, -100, 0], [0, 1, 50], 3);
    const m = h.query(0, 0, 0, 3, out);
    const got = Array.from(out.subarray(0, m));
    expect(got).toContain(0);
    expect(got).toContain(1);
    expect(got).not.toContain(2);
  });

  it('never writes past the output buffer', () => {
    const h = new SpatialHash(10);
    const n = 100;
    const z = new Float32Array(n);
    h.build(z, z, z, n);
    const out = new Int32Array(8);
    expect(h.query(0, 0, 0, 1, out)).toBe(8);
  });
});

describe('steering helpers', () => {
  it('wraps angles and finds the short way round', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI);
  });

  it('approach and damp converge without overshoot', () => {
    expect(approach(0, 1, 0.3)).toBeCloseTo(0.3);
    expect(approach(0.9, 1, 0.3)).toBe(1);
    expect(approach(0, -1, 0.3)).toBeCloseTo(-0.3);
    let v = 0;
    for (let i = 0; i < 100; i++) v = damp(v, 1, 5, 1 / 60);
    expect(v).toBeGreaterThan(0.99);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('yaw convention: +X is 0, -Z (left) is +90°', () => {
    expect(yawOf(1, 0)).toBeCloseTo(0);
    expect(yawOf(0, -1)).toBeCloseTo(Math.PI / 2);
  });

  it('quatYawPitchRoll matches three Euler YZX and composeMatrix matches Matrix4.compose', () => {
    const q = new Float32Array(4);
    const m = new Float32Array(16);
    for (const [yaw, pitch, roll] of [[0.3, 0.2, -0.4], [2.5, -0.5, 0.1], [-1.2, 0, 0.5]]) {
      quatYawPitchRoll(yaw, pitch, roll, q);
      const ref = new Quaternion().setFromEuler(new Euler(roll, yaw, pitch, 'YZX'));
      expect(Math.abs(q[0] * ref.x + q[1] * ref.y + q[2] * ref.z + q[3] * ref.w)).toBeCloseTo(1, 5);
      // Forward stays +X rotated by yaw then pitched.
      const fwd = new Vector3(1, 0, 0).applyQuaternion(ref);
      expect(Math.atan2(-fwd.z, fwd.x)).toBeCloseTo(yaw, 5);
      expect(Math.asin(fwd.y)).toBeCloseTo(pitch, 5);
      composeMatrix(m, 0, 1, 2, 3, q[0], q[1], q[2], q[3], 0.5);
      const refM = new Matrix4().compose(new Vector3(1, 2, 3), new Quaternion(q[0], q[1], q[2], q[3]), new Vector3(0.5, 0.5, 0.5));
      for (let k = 0; k < 16; k++) expect(m[k]).toBeCloseTo(refM.elements[k], 5);
    }
  });

  it('activity levels follow the day', () => {
    expect(activityLevel('diurnal', 1)).toBe(1);
    expect(activityLevel('diurnal', 0)).toBe(0);
    expect(activityLevel('nocturnal', 0)).toBe(1);
    expect(activityLevel('nocturnal', 1)).toBe(0);
    expect(activityLevel('crepuscular', 0.5)).toBe(1);
    expect(activityLevel('always', 0)).toBe(1);
  });

  it('height band pushes up when low, down when high, nothing inside', () => {
    expect(heightBandSteer(0.1, 0.5, 3, 20)).toBeGreaterThan(0);
    expect(heightBandSteer(5, 0.5, 3, 20)).toBeLessThan(0);
    expect(heightBandSteer(1.5, 0.5, 3, 20)).toBe(0);
    expect(heightBandSteer(1.5, 0.5, 3, 0.5)).toBeLessThan(0); // near the surface
    expect(boundsSteer(120, 100)).toBeLessThan(0);
    expect(boundsSteer(-120, 100)).toBeGreaterThan(0);
    expect(boundsSteer(0, 100)).toBe(0);
  });
});

const fishDef: SpeciesDef = {
  id: 'testfish',
  name: 'Test fish',
  kind: 'creature',
  biomes: ['ocean'],
  icon: '',
  symmetry: 'bilateral',
  buildGeometry: () => new BufferGeometry(),
  drawTemplate: () => {},
  sideView: { direction: [0, 0, -1], up: [0, 1, 0] },
  locomotion: 'swim-fish',
  activity: 'diurnal',
  habitat: { heightMin: 0.5, heightMax: 3, coverAffinity: 0.7 },
  swim: { cruiseSpeed: 0.5, maxSpeed: 1.8, turnRate: 2.5, schooling: 0.5, neighbourRadius: 2, bodyLength: 0.25 },
  scaleRange: [1, 1],
  diet: 'flakes',
};
const plantDef: SpeciesDef = { ...fishDef, id: 'testplant', kind: 'plant', locomotion: 'sway-plant', swim: undefined, diet: 'none' };
const defs: Record<string, SpeciesDef> = { testfish: fishDef, testplant: plantDef };
const getDef = (id: string) => {
  const d = defs[id];
  if (!d) throw new Error(id);
  return d;
};

function fish(id: string, x: number, z: number): PlacedEntity {
  return { id, speciesId: 'testfish', designId: 'template:testfish', name: id, position: [x, terrainHeight(x, z) + 1.5, z], rotationY: 0, scale: 1 };
}

describe('FishSim', () => {
  it('adds, updates and removes fish by id and keeps transforms in sync', () => {
    runtime.transforms.clear();
    const sim = new FishSim(getDef);
    const batch = sim.batchFor(fishDef);
    const ents = Array.from({ length: 50 }, (_, k) => fish(`f${k}`, (k % 10) * 2, Math.floor(k / 10) * 2));
    ents.push({ ...fish('p0', 5, 5), speciesId: 'testplant' });
    sim.sync(ents);
    expect(sim.n).toBe(50);
    expect(batch.count).toBe(50);
    expect(batch.capacity).toBeGreaterThanOrEqual(50);
    expect(runtime.transforms.size).toBe(50);

    const remaining = ents.filter((_, k) => k % 3 !== 0);
    sim.sync(remaining);
    expect(sim.n).toBe(remaining.length - 1); // minus the plant
    expect(batch.count).toBe(sim.n);
    expect(runtime.transforms.has('f0')).toBe(false);
    expect(runtime.transforms.has('f1')).toBe(true);
    // Every live slot points to a fish that points back at it.
    for (const e of remaining) {
      if (e.speciesId !== 'testfish') continue;
      expect(sim.indexOf(e.id)).toBeGreaterThanOrEqual(0);
    }

    for (let f = 0; f < 600; f++) sim.step(1 / 60, 0, 5, 20);
    for (const e of remaining) {
      if (e.speciesId !== 'testfish') continue;
      const t = runtime.transforms.get(e.id)!;
      expect(Number.isFinite(t.position.x)).toBe(true);
      // Above the seabed, below the surface, and roughly near home.
      expect(t.position.y).toBeGreaterThan(terrainHeight(t.position.x, t.position.z));
      expect(Math.hypot(t.position.x - e.position[0], t.position.z - e.position[2])).toBeLessThan(15);
      expect(Math.abs(t.quaternion.length() - 1)).toBeLessThan(1e-3);
    }
    // Matrices are written for each live slot (non-zero scale on the diagonal).
    for (let s = 0; s < batch.count; s++) expect(Math.abs(batch.matrices[s * 16 + 15] - 1)).toBeLessThan(1e-6);

    sim.sync([]);
    expect(sim.n).toBe(0);
    expect(batch.count).toBe(0);
    expect(runtime.transforms.size).toBe(0);
  });

  it('fish find and eat nearby food', () => {
    runtime.transforms.clear();
    clearFood();
    const sim = new FishSim(getDef);
    sim.sync([fish('a', 0, 0), fish('b', 1, 0)]);
    const y = terrainHeight(0.5, 1) + 1.5;
    spawnFood(new Vector3(0.5, y, 1), 6);
    expect(runtime.food.length).toBe(6);
    stepFood(0);
    expect(nearestFood(0.5, y, 1, 2)).toBeGreaterThanOrEqual(0);
    for (let f = 0; f < 60 * 20 && runtime.food.length > 0; f++) {
      stepFood(1 / 60);
      sim.step(1 / 60, 0, 2, 5);
    }
    expect(runtime.food.length).toBe(0);
  });
});
