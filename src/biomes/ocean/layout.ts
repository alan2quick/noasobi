import { WORLD_HALF, terrainHeight } from '../../core/terrain';

/** Deterministic placement of decorative rocks and bubble vents. */

export function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RockPlacement {
  x: number;
  y: number;
  z: number;
  /** Non-uniform scale. */
  sx: number;
  sy: number;
  sz: number;
  rx: number;
  ry: number;
  rz: number;
  /** 0..1 colour variation. */
  tint: number;
  /** Which geometry variant (0 = boulder, 1 = pebble). */
  variant: 0 | 1;
}

export interface Cluster {
  x: number;
  z: number;
  radius: number;
}

// Hand-picked clusters near the seeded kelp groves (which sit around x,z in [-30, 30]),
// so the starting view has rocks in it; plus random ones across the world.
const NEAR: [number, number][] = [
  [-7, -12],
  [9, -2],
  [-20, -8],
  [22, -14],
  [-6, -28],
  [14, -34],
  [-32, -14],
  [30, 14],
];

function buildLayout() {
  const rand = mulberry(4242);
  const clusters: Cluster[] = NEAR.map(([x, z]) => ({ x, z, radius: 2 + rand() * 2.5 }));
  while (clusters.length < 26) {
    const x = (rand() * 2 - 1) * (WORLD_HALF - 8);
    const z = (rand() * 2 - 1) * (WORLD_HALF - 8);
    if (Math.abs(x) < 36 && Math.abs(z) < 42) continue;
    clusters.push({ x, z, radius: 2 + rand() * 4 });
  }

  const rocks: RockPlacement[] = [];
  for (const c of clusters) {
    const boulders = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < boulders; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * c.radius * (i === 0 ? 0.2 : 1);
      const base = i === 0 ? 1.3 + rand() * 1.5 : 0.45 + rand() * 1.0;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      const sy = base * (0.55 + rand() * 0.45);
      rocks.push({
        x,
        z,
        y: terrainHeight(x, z) - sy * 0.25,
        sx: base * (0.85 + rand() * 0.4),
        sy,
        sz: base * (0.85 + rand() * 0.4),
        rx: (rand() - 0.5) * 0.4,
        ry: rand() * Math.PI * 2,
        rz: (rand() - 0.5) * 0.4,
        tint: rand(),
        variant: 0,
      });
    }
    const pebbles = 3 + Math.floor(rand() * 6);
    for (let i = 0; i < pebbles; i++) {
      const a = rand() * Math.PI * 2;
      const r = c.radius * (0.6 + rand() * 1.1);
      const s = 0.12 + rand() * 0.22;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      rocks.push({
        x,
        z,
        y: terrainHeight(x, z) - s * 0.2,
        sx: s * (0.9 + rand() * 0.5),
        sy: s * (0.5 + rand() * 0.3),
        sz: s * (0.9 + rand() * 0.5),
        rx: 0,
        ry: rand() * Math.PI * 2,
        rz: 0,
        tint: rand(),
        variant: 1,
      });
    }
  }
  return { clusters, rocks };
}

export const oceanLayout = buildLayout();

/** Bubble vents: at rock clusters, nearest to the start view first. */
export const bubbleVents: [number, number, number][] = oceanLayout.clusters.slice(0, 8).map((c, i) => {
  const x = c.x + (i % 2 ? 0.9 : -0.8);
  const z = c.z + (i % 3 ? 0.6 : -0.7);
  return [x, terrainHeight(x, z), z];
});
