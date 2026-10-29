/**
 * Ocean world dimensions and the seabed height function.
 * Shared by the terrain mesh, plant placement and creature steering, so it must stay
 * deterministic and cheap.
 */

export const WORLD_SIZE = 240;
export const WORLD_HALF = WORLD_SIZE / 2;
/** Water surface height. The seabed sits roughly between y = -3 and y = 3. */
export const SURFACE_Y = 26;

function hash2(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}

export function terrainHeight(x: number, z: number): number {
  const dunes = valueNoise(x / 55, z / 55) * 2.4;
  const mounds = valueNoise(x / 17 + 31.7, z / 17 - 12.3) * 0.7;
  const bumps = valueNoise(x / 6 - 7.1, z / 6 + 4.4) * 0.15;
  return dunes + mounds + bumps;
}

/** Surface normal of the seabed, written into `out` as [x, y, z]. */
export function terrainNormal(x: number, z: number, out: [number, number, number] = [0, 1, 0]) {
  const e = 0.5;
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  const nx = -hx;
  const ny = 2 * e;
  const nz = -hz;
  const len = Math.hypot(nx, ny, nz);
  out[0] = nx / len;
  out[1] = ny / len;
  out[2] = nz / len;
  return out;
}
