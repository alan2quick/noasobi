/**
 * Moon-jelly layout shared by the procedural mesh and the painted textures, so the canvas and the
 * UVs always agree.
 *
 * Local space (metres, instance scale 1): +Y is the bell axis (up), the origin is the centre of the
 * bell's rim plane. The dome rises to y = BELL_H, the oral arms and tentacles hang below it.
 * A jellyfish has no front or back: `symmetry` is 'none'.
 *
 * UV layout (1024 x 512 canvas, canvas pixel (x, y) <-> uv (x / W, 1 - y / H)):
 *
 *   x:   0 .......... 500 | 604 ..... 734 |  ........ 1000
 *        +--------------+ | +-----------+
 *        |   BELL DISC  | | | ARM STRIP |  y  16 .. 220   (all 4 oral arms share it)
 *        |  (top-down,  | | +-----------+
 *        |  azimuthal)  | |
 *        |              | | +---------------------------+
 *        |  centre      | | | TENTACLE LANE A (even)    |  y 296 .. 352
 *        |  (256, 256)  | | +---------------------------+
 *        |  radius 244  | | +---------------------------+
 *        +--------------+ | | TENTACLE LANE B (odd)     |  y 420 .. 476
 *                         | +---------------------------+
 *
 * - Bell disc: the bell seen from above, as an azimuthal equidistant map. A vertex at azimuth phi
 *   (x = r cos phi, z = r sin phi) and arc length s from the apex lands at the canvas point
 *   centre + rho (cos phi, sin phi) with rho = DISC_R * s / S_TOTAL. Top of the dome is the
 *   middle of the disc, the rim is the outer circle, so the four gonad rings sit near the centre
 *   and the scalloped margin is the outer band. There is no seam: the polar map wraps by itself.
 *   The bell's inside shares the outer surface's pixels. Texel density is about 540 px per metre
 *   along the profile (a little stretched around the rim).
 * - Arm strip: one ribbon lying flat: the three columns (left edge, centre fold, right edge) map
 *   to x = ARM.x0 .. ARM.x1, the rows map attachment (top) -> tip (bottom) to y = ARM.y0 .. ARM.y1.
 *   All four arms use the same pixels.
 * - Tentacle lanes: ribbons run along x (attachment at the left end x0, tip at the right end x1)
 *   and across y (one edge at y0, the other at y1). Even tentacles use lane A, odd ones lane B,
 *   so each lane's 8 tentacles share their pixels.
 * All islands are at least 64 px apart (the studio breaks a stroke across larger UV jumps).
 */

export const BELL_R = 0.35;
/** Height of the dome above the rim plane. */
export const BELL_H = 0.22;
/** Vertices around the bell and how many scallops (lappets) the margin has. */
export const SEGMENTS = 32;
export const LOBES = 8;
/** Rings from just below the apex down to the rim margin; ring RINGS is the rim itself. */
export const RINGS = 8;

export const ARM_COUNT = 4;
export const ARM_ROWS = 7;
export const ARM_LENGTH = 0.45;
/** Height where the oral arms join the bell (inside the dome, like the manubrium). */
export const ARM_TOP = 0.15;
export const TENTACLE_COUNT = 16;
export const TENTACLE_ROWS = 7;

export const DISC_CX = 256;
export const DISC_CY = 256;
export const DISC_R = 244;

export const ARM = { x0: 604, x1: 734, y0: 16, y1: 220 };
export const TENTACLE_LANES = [
  { x0: 604, x1: 1000, y0: 296, y1: 352 },
  { x0: 604, x1: 1000, y0: 420, y1: 476 },
];

/** Dome profile angle (from the apex) reached by ring RINGS - 1. */
const THETA_END = 1.22;

/** Profile point of a bell ring (lobe = 0), before the scalloping: radius and height. */
export function ringProfile(i: number): { r: number; y: number } {
  if (i <= 0) return { r: 0, y: BELL_H };
  if (i >= RINGS) return { r: BELL_R * 0.99, y: -0.035 };
  const th = (i / (RINGS - 1)) * THETA_END;
  return { r: BELL_R * Math.sin(th), y: BELL_H * Math.cos(th) };
}

/** Scallop wave for azimuth phi: +1 at a lappet tip, -1 in a notch. */
export function lobeWave(phi: number): number {
  return Math.cos(LOBES * phi);
}

/** Cumulative arc length of the bell profile up to each ring. */
export const RING_ARC: number[] = (() => {
  const out = [0];
  for (let i = 1; i <= RINGS; i++) {
    const a = ringProfile(i - 1);
    const b = ringProfile(i);
    out.push(out[i - 1] + Math.hypot(b.r - a.r, b.y - a.y));
  }
  return out;
})();

export const S_TOTAL = RING_ARC[RINGS];

/** Disc radius in canvas pixels of ring i. */
export function ringRho(i: number): number {
  return (DISC_R * RING_ARC[i]) / S_TOTAL;
}

/** Canvas point on the bell disc for azimuth phi and disc radius rho. */
export function discPoint(phi: number, rho: number): [number, number] {
  return [DISC_CX + rho * Math.cos(phi), DISC_CY + rho * Math.sin(phi)];
}

/** Azimuths of the four oral arms (between the gonad rings and the four arm bases). */
export function armAzimuth(k: number): number {
  return Math.PI / 4 + (k * Math.PI) / 2;
}

/** The four horseshoe-shaped gonad rings: azimuth, disc radius of their centre, and size in px. */
export const GONAD = { rho: 0.4 * DISC_R, radius: 36, thickness: 13, gap: 1.15 };
export function gonadAzimuth(k: number): number {
  return (k * Math.PI) / 2 + Math.PI / 4;
}

/** Per-row half width (m) of an oral arm, attachment -> tip. */
export const ARM_HALF_WIDTH = [0.035, 0.07, 0.09, 0.085, 0.07, 0.045, 0.015];

/** Tentacle length (m) for tentacle t: a little irregular. */
export function tentacleLength(t: number): number {
  return 0.62 + 0.17 * Math.sin(t * 1.7 + 1);
}
