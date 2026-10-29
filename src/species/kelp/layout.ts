/**
 * Giant kelp (Macrocystis-like) layout shared by the procedural mesh and the painted template,
 * so the canvas and the UVs always agree.
 *
 * Local space: grows along +Y from y = 0. The "front" is +Z: blades spread left (-X) and right (+X)
 * with their flat faces towards +Z, so the plant reads like a feather/fishbone from the front.
 *
 * UV layout (1024 x 512 canvas, canvas pixel (x, y) <-> uv (x / W, 1 - y / H)) is itself a
 * front view of the plant, seen from +Z with +X on the right:
 *
 *   u 0.00 ........ 0.41 | 0.415-0.455 | 0.462-0.538 | 0.545-0.585 | 0.59 ........ 1.00
 *     blades on -X side  |  bladders   |   stipe     |  bladders   |  blades on +X side
 *     (tip at left edge) |             |  strip      |             | (tip at right edge)
 *
 * - Stipe strip: v runs bottom (base) -> top (tip) of the plant. Across the strip the stalk wraps
 *   around, with its front (+Z) in the middle of the strip, -X side left of centre, +X right.
 *   The holdfast uses the bottom of the strip (v 0 .. HOLDFAST_V1).
 * - Each side has one row per blade on that side, stacked bottom (lowest blade) to top (highest).
 *   In its row a blade is drawn as its real silhouette lying horizontally: base (and its gas
 *   bladder) next to the stipe, tip towards the outer edge, upper edge of the blade up in the
 *   canvas. The front face and back face of a blade share the same pixels.
 */

export const KELP_HEIGHT = 7.2;
export const STIPE_TOP = 7.0;
export const STIPE_U0 = 0.462;
export const STIPE_U1 = 0.538;
export const HOLDFAST_V1 = 0.07;
/** Bladder region, measured outward from the stipe strip edge. */
export const BLADDER_U_GAP = 0.007;
export const BLADDER_U_LEN = 0.04;
/** Blade region, measured outward from the stipe strip edge. */
export const BLADE_U_START = 0.052;
export const BLADE_U_END = 0.533; // reaches u = 0.995 / 0.005
export const ROW_MARGIN = 0.08; // fraction of the row height kept empty above and below

/** Blade rows (fraction of blade length) and half-width profile (fraction of max half-width). */
export const BLADE_T = [0, 0.16, 0.4, 0.7, 1];
export const BLADE_HW = [0.22, 0.85, 1, 0.8, 0.14];

export interface BladeSpec {
  side: -1 | 1;
  /** Index of this blade's row on its side, 0 = lowest. */
  row: number;
  rowCount: number;
  y: number;
  yaw: number;
  /** Elevation above horizontal at the base and the tip, radians. */
  elev0: number;
  elev1: number;
  length: number;
  halfWidth: number;
  phase: number;
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BLADE_COUNT = 19;

export const BLADES: BladeSpec[] = (() => {
  const rand = rng(1234);
  const out: BladeSpec[] = [];
  const counts = { [-1]: 0, [1]: 0 } as Record<number, number>;
  for (let i = 0; i < BLADE_COUNT; i++) {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const f = i / (BLADE_COUNT - 1);
    const y = 0.85 + f * (6.8 - 0.85) + (rand() - 0.5) * 0.14;
    // Blades leave the stipe angled up, then arch over so the tip droops a little (upper blades
    // stay more upright, like the canopy reaching for the light).
    const elev0 = 0.5 + rand() * 0.25 + f * 0.35;
    out.push({
      side,
      row: counts[side]++,
      rowCount: 0,
      y,
      yaw: (rand() - 0.5) * 1.5,
      elev0,
      elev1: elev0 - 0.75 + f * 0.6 + rand() * 0.2,
      length: 1.15 - 0.35 * f + rand() * 0.15,
      halfWidth: 0.16 - 0.035 * f,
      phase: rand() * Math.PI * 2,
    });
  }
  for (const b of out) b.rowCount = counts[b.side];
  return out;
})();

/** UV rectangle of a blade's row. `uAt(d)` maps an outward distance (0 = stipe edge) to u. */
export function bladeRow(b: BladeSpec) {
  const h = 1 / b.rowCount;
  const v0 = b.row * h;
  const edge = b.side > 0 ? STIPE_U1 : STIPE_U0;
  return {
    v0,
    v1: v0 + h,
    vMid: v0 + h / 2,
    /** Max distance from the row centre an edge can reach, in v. */
    vHalf: (h / 2) * (1 - ROW_MARGIN * 2),
    uAt: (d: number) => edge + b.side * d,
  };
}

/** Centre line of the stipe (gentle S curve), metres. */
export function stipeCenter(y: number): [number, number] {
  const t = Math.max(0, y) / STIPE_TOP;
  return [0.3 * Math.sin(2.4 * t), 0.12 * (Math.sin(4.1 * t + 0.5) - Math.sin(0.5))];
}

export function stipeRadius(y: number): number {
  const t = Math.max(0, y) / STIPE_TOP;
  return t > 0.97 ? 0.012 : 0.055 - 0.022 * t;
}

/** Stipe v for a height in metres. */
export function stipeV(y: number): number {
  return HOLDFAST_V1 + (1 - HOLDFAST_V1) * Math.min(1, Math.max(0, y / STIPE_TOP));
}
