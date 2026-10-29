import { Vector3 } from 'three';
import { envUniforms, runtime } from '../core/runtime';
import type { FoodFlake } from '../core/runtime';
import { terrainHeight } from '../core/terrain';
import { SpatialHash } from './spatialHash';

/**
 * Food flakes: sink slowly with a wobble, drift with the current, rest on the seabed for a while,
 * then dissolve. Lives in `runtime.food` (FoodFlake objects from a fixed pool, no per-frame
 * allocations). Fish find flakes through `nearestFood`.
 */

export const MAX_FLAKES = 240;
/** Seconds a flake lies on the seabed before it dissolves. */
export const FLAKE_REST_TIME = 25;
const SINK_SPEED = 0.13;

export interface Flake extends FoodFlake {
  /** Seconds since spawn. */
  age: number;
  /** Seconds resting on the seabed, -1 while sinking. */
  rest: number;
  phase: number;
  sink: number;
}

const pool: Flake[] = [];
for (let i = 0; i < MAX_FLAKES; i++) {
  pool.push({ id: 0, position: new Vector3(), alive: false, age: 0, rest: -1, phase: 0, sink: SINK_SPEED });
}
let nextId = 1;

const xs = new Float32Array(MAX_FLAKES);
const ys = new Float32Array(MAX_FLAKES);
const zs = new Float32Array(MAX_FLAKES);
const hash = new SpatialHash(2.5, false, MAX_FLAKES, 9);
const candidates = new Int32Array(MAX_FLAKES);

function flakes(): Flake[] {
  return runtime.food as Flake[];
}

/** Scatters `count` flakes in a small cloud around `point`. Returns how many were added. */
export function spawnFood(point: Vector3, count = 12): number {
  const list = flakes();
  let added = 0;
  for (let i = 0; i < count && list.length < MAX_FLAKES; i++) {
    const f = pool.find((p) => !list.includes(p));
    if (!f) break;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 0.35;
    f.id = nextId++;
    f.position.set(point.x + Math.cos(a) * r, point.y + (Math.random() - 0.5) * 0.3, point.z + Math.sin(a) * r);
    const ground = terrainHeight(f.position.x, f.position.z) + 0.02;
    if (f.position.y < ground) f.position.y = ground;
    f.alive = true;
    f.age = 0;
    f.rest = -1;
    f.phase = Math.random() * Math.PI * 2;
    f.sink = SINK_SPEED * (0.75 + Math.random() * 0.5);
    list.push(f);
    added++;
  }
  return added;
}

/** Removes every flake. */
export function clearFood() {
  const list = flakes();
  for (const f of list) f.alive = false;
  list.length = 0;
  hash.build(xs, ys, zs, 0);
}

/** Advances all flakes and rebuilds the lookup hash. */
export function stepFood(dt: number) {
  const list = flakes();
  const cur = envUniforms.uCurrent.value;
  let n = list.length;
  for (let i = 0; i < n; ) {
    const f = list[i];
    if (!f.alive || (f.rest >= 0 && f.rest > FLAKE_REST_TIME)) {
      f.alive = false;
      list[i] = list[n - 1];
      n--;
      continue;
    }
    f.age += dt;
    const p = f.position;
    if (f.rest < 0) {
      const w = f.age * 2.1 + f.phase;
      p.x += (cur.x * 0.18 + Math.sin(w) * 0.06) * dt;
      p.z += (cur.y * 0.18 + Math.cos(w * 0.8) * 0.06) * dt;
      p.y -= f.sink * (0.75 + 0.25 * Math.sin(w * 1.3)) * dt;
      const ground = terrainHeight(p.x, p.z) + 0.015;
      if (p.y <= ground) {
        p.y = ground;
        f.rest = 0;
      }
    } else {
      f.rest += dt;
    }
    xs[i] = p.x;
    ys[i] = p.y;
    zs[i] = p.z;
    i++;
  }
  list.length = n;
  hash.build(xs, ys, zs, n);
}

/** Index into runtime.food of the nearest live flake within r, or -1. */
export function nearestFood(x: number, y: number, z: number, r: number): number {
  const list = flakes();
  if (list.length === 0) return -1;
  const m = hash.query(x, y, z, r, candidates);
  let best = -1;
  let bestD = r * r;
  for (let k = 0; k < m; k++) {
    const i = candidates[k];
    const f = list[i];
    if (!f || !f.alive) continue;
    const dx = f.position.x - x, dy = f.position.y - y, dz = f.position.z - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** 0..1 visual scale for a flake (shrinks as it dissolves). */
export function flakeFade(f: Flake) {
  if (f.rest < 0) return 1;
  return Math.max(0, Math.min(1, (FLAKE_REST_TIME - f.rest) / 2));
}
