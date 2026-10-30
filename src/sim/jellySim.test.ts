import { beforeEach, describe, expect, it } from 'vitest';
import { BufferGeometry, Quaternion, Vector3 } from 'three';
import { JellySim, MAX_TILT, POWER, fallbackLayer, jellyQuat, pulseContraction, pulseImpulse, pulseRateFactor, thrustShare } from './jellySim';
import { runtime, envUniforms } from '../core/runtime';
import { SURFACE_Y, WORLD_HALF, terrainHeight } from '../core/terrain';
import type { PlacedEntity, SpeciesDef } from '../core/types';
import { jellyfish } from '../species/jellyfish';

const testJelly = (over: Partial<SpeciesDef> = {}): SpeciesDef => ({
  ...jellyfish,
  buildGeometry: () => new BufferGeometry(),
  ...over,
});

const getSpecies = (id: string) => {
  if (id === 'jellyfish') return jellyfish;
  if (id === 'nocturnal-jelly') return testJelly({ id, activity: 'nocturnal' });
  if (id === 'diurnal-jelly') return testJelly({ id, activity: 'diurnal' });
  throw new Error('unknown ' + id);
};

function entity(id: string, x: number, y: number, z: number, over: Partial<PlacedEntity> = {}): PlacedEntity {
  return { id, speciesId: 'jellyfish', designId: 'template:jellyfish', name: id, position: [x, y, z], rotationY: 0, scale: 1, ...over };
}

function run(sim: JellySim, seconds: number, dt = 1 / 30, cam: [number, number, number] = [0, 5, 0], each?: () => void) {
  const steps = Math.round(seconds / dt);
  for (let k = 0; k < steps; k++) {
    sim.step(dt, cam[0], cam[1], cam[2]);
    each?.();
  }
}

beforeEach(() => {
  runtime.transforms.clear();
  runtime.daylight = 1;
  envUniforms.uCurrent.value.set(0.6, 0.25);
});

describe('pulse helpers', () => {
  it('contraction is periodic, starts and ends at rest, squeezes then flares', () => {
    expect(pulseContraction(0)).toBeCloseTo(0, 6);
    expect(pulseContraction(1)).toBeCloseTo(0, 6);
    expect(pulseContraction(0.37)).toBeCloseTo(pulseContraction(3.37), 6);
    expect(pulseContraction(POWER)).toBeCloseTo(1, 3);
    let min = 1;
    let max = -1;
    for (let x = 0; x < 1; x += 0.01) {
      const c = pulseContraction(x);
      min = Math.min(min, c);
      max = Math.max(max, c);
    }
    expect(max).toBeLessThanOrEqual(1.0001);
    expect(min).toBeLessThan(0); // slight flare during relaxation
    expect(min).toBeGreaterThan(-0.3);
    // The squeeze is quicker than the relaxation.
    expect(pulseContraction(POWER / 2)).toBeGreaterThan(0.3);
    expect(pulseContraction(0.45)).toBeGreaterThan(0);
  });

  it('thrust share rises monotonically 0..1 over the power stroke and is exact in total', () => {
    expect(thrustShare(0)).toBe(0);
    expect(thrustShare(POWER)).toBeCloseTo(1, 9);
    expect(thrustShare(0.9)).toBe(1);
    let prev = 0;
    for (let x = 0; x <= POWER; x += 0.01) {
      const v = thrustShare(x);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
    // Stepping through three full cycles in odd-sized steps delivers exactly 3 pulses.
    let p = 0.13;
    let total = 0;
    const start = p;
    for (let k = 0; k < 300; k++) {
      const dph = 0.01;
      total += pulseImpulse(p, dph);
      p = (p + dph) % 1;
    }
    // 300 steps * 0.01 = 3 cycles from phase 0.13.
    expect(total).toBeGreaterThan(2.5);
    expect(total).toBeLessThan(3.5);
    expect(start).toBeCloseTo(0.13);
    // A step across the cycle wrap counts only what lies in the power stroke.
    expect(pulseImpulse(0.95, 0.1)).toBeCloseTo(thrustShare(0.05), 9);
  });

  it('pulse rate factor is calmer at low activity', () => {
    expect(pulseRateFactor(1)).toBe(1);
    expect(pulseRateFactor(0)).toBeLessThan(0.6);
  });

  it('jellyQuat tips the +Y axis towards the lean direction, up to the lean angle', () => {
    const q = new Quaternion();
    const out = [0, 0, 0, 1];
    const up = new Vector3();
    jellyQuat(0, 0, 0, out);
    q.set(out[0], out[1], out[2], out[3]);
    up.set(0, 1, 0).applyQuaternion(q);
    expect(up.y).toBeCloseTo(1, 6);

    jellyQuat(0.3, 0, 1.2, out); // lean towards +x; yaw about the axis must not change the axis
    q.set(out[0], out[1], out[2], out[3]);
    up.set(0, 1, 0).applyQuaternion(q);
    expect(up.x).toBeCloseTo(Math.sin(0.3), 5);
    expect(up.y).toBeCloseTo(Math.cos(0.3), 5);
    expect(up.z).toBeCloseTo(0, 5);

    jellyQuat(-0.1, 0.2, 0.4, out);
    q.set(out[0], out[1], out[2], out[3]);
    up.set(0, 1, 0).applyQuaternion(q);
    const a = Math.hypot(0.1, 0.2);
    expect(up.angleTo(new Vector3(0, 1, 0))).toBeCloseTo(a, 5);
    expect(up.x).toBeLessThan(0);
    expect(up.z).toBeGreaterThan(0);
    expect(q.length()).toBeCloseTo(1, 6);
  });
});

describe('JellySim entities', () => {
  it('adds, updates and removes jellies, keeping runtime.transforms in sync', () => {
    const sim = new JellySim(getSpecies);
    const batch = sim.batchFor(jellyfish);
    sim.sync([entity('a', 0, 8, 0), entity('b', 5, 8, 5, { scale: 1.2 }), entity('c', -5, 8, 5)]);
    expect(sim.n).toBe(3);
    expect(batch.count).toBe(3);
    expect(runtime.transforms.size).toBe(3);
    expect(runtime.transforms.get('b')!.radius).toBeCloseTo(jellyfish.drift!.bellRadius * 1.2, 6);

    run(sim, 2);
    const pb = runtime.transforms.get('b')!.position.clone();
    sim.sync([entity('a', 0, 8, 0), entity('b', 5, 8, 5, { scale: 0.8 }), entity('c', -5, 8, 5)]);
    expect(runtime.transforms.get('b')!.radius).toBeCloseTo(jellyfish.drift!.bellRadius * 0.8, 6);
    expect(runtime.transforms.get('b')!.position.distanceTo(pb)).toBeLessThan(1e-6); // not teleported

    // Remove the first: the last takes its slot, everything stays consistent.
    sim.sync([entity('b', 5, 8, 5, { scale: 0.8 }), entity('c', -5, 8, 5)]);
    expect(sim.n).toBe(2);
    expect(batch.count).toBe(2);
    expect(runtime.transforms.has('a')).toBe(false);
    run(sim, 1);
    for (const id of ['b', 'c']) {
      const i = sim.indexOf(id);
      expect(i).toBeGreaterThanOrEqual(0);
      const t = runtime.transforms.get(id)!;
      // The instance matrix of its slot carries the same position.
      const slot = batch.slotToJelly.indexOf(i);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(batch.matrices[slot * 16 + 12]).toBeCloseTo(t.position.x, 4);
      expect(batch.matrices[slot * 16 + 13]).toBeCloseTo(t.position.y, 4);
      expect(batch.matrices[slot * 16 + 14]).toBeCloseTo(t.position.z, 4);
    }
    sim.sync([]);
    expect(sim.n).toBe(0);
    expect(batch.count).toBe(0);
    expect(runtime.transforms.size).toBe(0);
  });

  it('teleports when the anchor is moved and ignores other species', () => {
    const sim = new JellySim(getSpecies);
    sim.sync([entity('a', 0, 8, 0), { ...entity('x', 0, 0, 0), speciesId: 'nope' }]);
    expect(sim.n).toBe(1);
    run(sim, 1);
    sim.sync([entity('a', 20, 9, -10)]);
    const p = runtime.transforms.get('a')!.position;
    expect(p.x).toBeCloseTo(20, 4);
    expect(p.z).toBeCloseTo(-10, 4);
  });

  it('grows the render batch past its initial capacity', () => {
    const sim = new JellySim(getSpecies);
    const list: PlacedEntity[] = [];
    for (let i = 0; i < 75; i++) list.push(entity('j' + i, (i % 10) * 3 - 15, 8, Math.floor(i / 10) * 3 - 10));
    sim.sync(list);
    const b = sim.batchFor(jellyfish);
    expect(b.count).toBe(75);
    expect(b.capacity).toBeGreaterThanOrEqual(75);
    expect(b.matrices.length).toBe(b.capacity * 16);
    expect(b.generation).toBeGreaterThan(0);
    run(sim, 1);
    expect(runtime.transforms.size).toBe(75);
  });

  it('resolves design layers with a template fallback and refreshes them', () => {
    const layers = new Map<string, number>([['template:jellyfish', 3]]);
    const sim = new JellySim(getSpecies, fallbackLayer((id) => layers.get(id) ?? -1));
    sim.sync([entity('a', 0, 8, 0, { designId: 'custom1' })]);
    const b = sim.batchFor(jellyfish);
    expect(b.layers[0]).toBe(3);
    layers.set('custom1', 5);
    sim.refreshLayers();
    expect(b.layers[0]).toBe(5);
    sim.sync([entity('a', 0, 8, 0, { designId: 'template:jellyfish' })]);
    expect(b.layers[0]).toBe(3);
  });
});

describe('JellySim motion', () => {
  it('stays in its habitat band, tilts at most ~25 degrees and loosely near its anchor', () => {
    const sim = new JellySim(getSpecies);
    const list: PlacedEntity[] = [];
    for (let i = 0; i < 12; i++) {
      const x = (i % 4) * 6 - 9;
      const z = Math.floor(i / 4) * 6 - 6;
      list.push(entity('j' + i, x, terrainHeight(x, z) + 4 + (i % 5) * 2, z));
    }
    sim.sync(list);
    const hab = jellyfish.habitat;
    let maxHome = 0;
    let maxTilt = 0;
    const p = new Vector3();
    run(sim, 240, 1 / 20, [0, 5, 0], () => {
      for (let i = 0; i < sim.n; i++) {
        sim.position(i, p);
        const ground = terrainHeight(p.x, p.z);
        expect(p.y).toBeLessThanOrEqual(SURFACE_Y - 2 + 1e-4);
        expect(p.y - ground).toBeGreaterThan(0.9);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(WORLD_HALF);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(WORLD_HALF);
        maxTilt = Math.max(maxTilt, sim.tilt(i));
      }
    });
    expect(maxTilt).toBeLessThanOrEqual(MAX_TILT + 1e-5);
    expect(MAX_TILT).toBeLessThan((26 * Math.PI) / 180);
    for (const e of list) {
      const t = runtime.transforms.get(e.id)!;
      const d = Math.hypot(t.position.x - e.position[0], t.position.z - e.position[2]);
      maxHome = Math.max(maxHome, d);
      const above = t.position.y - terrainHeight(t.position.x, t.position.z);
      expect(above).toBeGreaterThanOrEqual(hab.heightMin - 3);
      expect(above).toBeLessThanOrEqual(hab.heightMax + 1);
    }
    expect(maxHome).toBeLessThan(10);
  });

  it('keeps pulsing: about pulseRate pulses per second, with upward bursts and a slow sink between', () => {
    const sim = new JellySim(getSpecies);
    envUniforms.uCurrent.value.set(0, 0);
    sim.sync([entity('a', 0, 10, 0)]);
    const drift = jellyfish.drift!;
    let wraps = 0;
    let prev = sim.phase(0);
    let maxUp = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    const p = new Vector3();
    let lastY = 10;
    let maxDrop = 0;
    run(sim, 60, 1 / 60, [0, 5, 0], () => {
      const ph = sim.phase(0);
      if (ph < prev) wraps++;
      prev = ph;
      sim.position(0, p);
      maxUp = Math.max(maxUp, p.y - lastY);
      maxDrop = Math.min(maxDrop, p.y - lastY);
      lastY = p.y;
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });
    const perSecond = wraps / 60;
    expect(perSecond).toBeGreaterThan(drift.pulseRate * 0.8 * 0.85);
    expect(perSecond).toBeLessThan(drift.pulseRate * 1.15 * 1.15);
    // Pulses move it up faster than it ever sinks.
    expect(maxUp * 60).toBeGreaterThan(drift.sinkSpeed * 1.5);
    expect(Math.abs(maxDrop) * 60).toBeLessThan(drift.pulseThrust + drift.sinkSpeed);
    // ...but it does not run away vertically.
    expect(maxY - minY).toBeLessThan(6);
  });

  it('is carried along by the current', () => {
    const sim = new JellySim(getSpecies);
    envUniforms.uCurrent.value.set(1.2, 0);
    sim.sync([entity('a', 0, 10, 0)]);
    // With a gentle (+x) current its x ends up positive after a short while.
    run(sim, 6, 1 / 30);
    expect(runtime.transforms.get('a')!.position.x).toBeGreaterThan(0.5);
  });

  it('pulls back towards the anchor when blown far away', () => {
    const sim = new JellySim(getSpecies);
    envUniforms.uCurrent.value.set(0.9, 0);
    sim.sync([entity('a', 0, 10, 0)]);
    let far = 0;
    run(sim, 300, 1 / 20, [0, 5, 0], () => {
      far = Math.max(far, runtime.transforms.get('a')!.position.x);
    });
    expect(far).toBeLessThan(9);
    expect(runtime.transforms.get('a')!.position.x).toBeLessThan(9);
  });

  it('separates jellies placed on top of each other', () => {
    const sim = new JellySim(getSpecies);
    envUniforms.uCurrent.value.set(0, 0);
    sim.sync([entity('a', 0, 10, 0), entity('b', 0.1, 10, 0.05), entity('c', -0.05, 10, 0.1)]);
    run(sim, 20, 1 / 30);
    const ids = ['a', 'b', 'c'];
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const d = runtime.transforms.get(ids[i])!.position.distanceTo(runtime.transforms.get(ids[j])!.position);
        expect(d).toBeGreaterThan(jellyfish.drift!.bellRadius * 1.5);
      }
    }
  });

  it('pulses more at night when nocturnal, more by day when diurnal, constantly when always', () => {
    const count = (speciesId: string, daylight: number) => {
      runtime.daylight = daylight;
      const sim = new JellySim(getSpecies);
      sim.sync([entity('a', 0, 10, 0, { speciesId })]);
      let wraps = 0;
      let prev = sim.phase(0);
      run(sim, 90, 1 / 30, [0, 5, 0], () => {
        const ph = sim.phase(0);
        if (ph < prev) wraps++;
        prev = ph;
      });
      return wraps;
    };
    const nightNoc = count('nocturnal-jelly', 0);
    const dayNoc = count('nocturnal-jelly', 1);
    expect(nightNoc).toBeGreaterThan(dayNoc * 1.4);
    const nightDi = count('diurnal-jelly', 0);
    const dayDi = count('diurnal-jelly', 1);
    expect(dayDi).toBeGreaterThan(nightDi * 1.4);
    const nightAl = count('jellyfish', 0);
    const dayAl = count('jellyfish', 1);
    expect(Math.abs(nightAl - dayAl)).toBeLessThanOrEqual(1);
  });

  it('LOD: far jellies still move', () => {
    const sim = new JellySim(getSpecies);
    sim.sync([entity('a', 0, 10, 0)]);
    const p0 = runtime.transforms.get('a')!.position.clone();
    run(sim, 10, 1 / 30, [200, 10, 200]);
    expect(runtime.transforms.get('a')!.position.distanceTo(p0)).toBeGreaterThan(0.2);
  });

  it('writes render buffers: phase in [0,1), amplitude and finite velocities', () => {
    const sim = new JellySim(getSpecies);
    sim.sync([entity('a', 0, 10, 0), entity('b', 4, 10, 0)]);
    run(sim, 5);
    const b = sim.batchFor(jellyfish);
    for (let s = 0; s < b.count; s++) {
      expect(b.pulse[s * 4]).toBeGreaterThanOrEqual(0);
      expect(b.pulse[s * 4]).toBeLessThan(1);
      expect(b.pulse[s * 4 + 1]).toBeGreaterThan(0.5);
      for (let k = 0; k < 3; k++) expect(Number.isFinite(b.vel[s * 3 + k])).toBe(true);
    }
  });
});
