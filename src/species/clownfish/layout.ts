/**
 * Clownfish shape + UV layout, shared by the procedural mesh (geometry.ts) and the template
 * painter (template.ts) so the two can never drift apart. Pure data/maths, no DOM, no three.
 *
 * Fish space: forward +X, up +Y, left flank faces -Z. Nose tip at x = +0.5, caudal fin tip at
 * x = -0.5 (1 unit long), body centre line around y = 0.
 *
 * ── UV LAYOUT (bilateral, 1024 x 512 design canvas) ───────────────────────────────────────────
 *  Planar side projection, same scale on both axes (471.04 canvas px per fish unit):
 *
 *    left flank  (u < 0.5):  px = 256 - 471.04 * x      py = 256 - 471.04 * y
 *    right flank (u >= 0.5): px = 768 + 471.04 * x      py = 256 - 471.04 * y   (= 1024 - left px)
 *
 *  So the LEFT half of the canvas is the left flank seen from the fish's left (-Z), nose pointing
 *  LEFT (nose tip at px 20, tail tip at px 492), back up. The right half is its horizontal mirror:
 *  the right flank seen from the right, nose pointing right (nose px 1004, tail px 532).
 *  Fish centre (0, 0) sits at canvas (256, 256) / (768, 256). Body + fins occupy roughly
 *  py 100..400; the body itself spans py ~176..326 at its deepest.
 *
 *  - Body shell: each flank's half of the body uses the planar projection above.
 *  - Dorsal, anal and caudal fins (median fins, thin sheets): the face looking at -Z uses the
 *    left-half projection, the face looking at +Z the right-half one, so they paint exactly where
 *    they appear in the side view (dorsal above the back, caudal right of the peduncle, ...).
 *  - Paired fins sit ON the flank in the side view, so they get their own islands in the free strip
 *    below the fish (py ~410..470) instead of sharing body pixels. Both faces of each fin use the
 *    island of the flank it belongs to:
 *       pectoral island: base (hinge) at px ~185, py ~444, fin extends right (backward) to px ~252
 *       pelvic   island: base at px ~280, py ~444, extends right to px ~323
 *    (right flank: mirrored, px' = 1024 - px).
 *  - Eyes are separate, non-paintable geometry (see geometry.ts). The eye centre in the side view
 *    is at fish (EYE.x, EYE.y) → left canvas ~(70, 237), right ~(954, 237), radius ~16 px; studios
 *    can overlay a dot there as a guide.
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 */

export const TEX_W = 1024;
export const TEX_H = 512;
/** Canvas pixels per fish unit (both axes, so the side view is undistorted). */
export const PX_PER_UNIT = 471.04;
/** Canvas position of fish (0,0) in the left half. */
export const LEFT_ORIGIN_PX: [number, number] = [256, 256];

export const NOSE_X = 0.5;
export const TAIL_X = -0.5;
/** Body (shell) length from nose to peduncle end, fish units. */
export const BODY_LEN = 0.77;
export const PEDUNCLE_X = NOSE_X - BODY_LEN; // -0.27

/** Fish-space point → design-texture uv for the given flank (-1 = left, +1 = right). */
export function planarUV(x: number, y: number, side: number, out: [number, number]) {
  const pxLeft = LEFT_ORIGIN_PX[0] - PX_PER_UNIT * x;
  const py = LEFT_ORIGIN_PX[1] - PX_PER_UNIT * y;
  const uLeft = pxLeft / TEX_W;
  out[0] = side < 0 ? uLeft : 1 - uLeft;
  out[1] = 1 - py / TEX_H;
  return out;
}

/** Fish-space point → left-half canvas pixel (for studio guides). */
export function fishToCanvas(x: number, y: number): [number, number] {
  return [LEFT_ORIGIN_PX[0] - PX_PER_UNIT * x, LEFT_ORIGIN_PX[1] - PX_PER_UNIT * y];
}

// ── Body profile ────────────────────────────────────────────────────────────────────────────────
// Knots along t = (NOSE_X - x) / BODY_LEN. A. ocellaris: short deep oval (depth ≈ 0.41 SL), blunt
// rounded snout, deep caudal peduncle (~37% of max depth), laterally compressed (width ≈ half depth).
export const PROFILE_T = [0, 0.03, 0.08, 0.15, 0.24, 0.34, 0.45, 0.56, 0.67, 0.78, 0.88, 0.95, 1.0];
export const PROFILE_TOP = [0.0, 0.05, 0.088, 0.124, 0.153, 0.168, 0.17, 0.16, 0.138, 0.108, 0.08, 0.066, 0.06];
export const PROFILE_BOT = [-0.012, -0.05, -0.083, -0.11, -0.133, -0.146, -0.148, -0.138, -0.118, -0.092, -0.07, -0.06, -0.056];
export const PROFILE_HW = [0.0, 0.034, 0.052, 0.065, 0.074, 0.078, 0.077, 0.071, 0.061, 0.049, 0.037, 0.03, 0.026];

function sample(arr: number[], x: number): number {
  const t = Math.min(1, Math.max(0, (NOSE_X - x) / BODY_LEN));
  for (let i = 1; i < PROFILE_T.length; i++) {
    if (t <= PROFILE_T[i]) {
      const k = (t - PROFILE_T[i - 1]) / (PROFILE_T[i] - PROFILE_T[i - 1]);
      // smoothstep blend keeps the silhouette from looking polygonal in the template.
      const s = k * k * (3 - 2 * k) * 0.35 + k * 0.65;
      return arr[i - 1] + (arr[i] - arr[i - 1]) * s;
    }
  }
  return arr[arr.length - 1];
}

export const bodyTop = (x: number) => sample(PROFILE_TOP, x);
export const bodyBot = (x: number) => sample(PROFILE_BOT, x);
export const bodyHalfWidth = (x: number) => sample(PROFILE_HW, x);

/** Cross-section exponents: flatter flanks than an ellipse (laterally compressed body). */
export const SECTION_Z_EXP = 0.7;
export const SECTION_Y_EXP = 0.9;

/** |z| of the body surface at (x, y) on the flank (0 outside the body). */
export function surfaceZ(x: number, y: number): number {
  const top = bodyTop(x);
  const bot = bodyBot(x);
  const mid = (top + bot) / 2;
  const half = (top - bot) / 2;
  if (half <= 0) return 0;
  const yn = Math.min(1, Math.abs((y - mid) / half));
  const c = Math.pow(yn, 1 / SECTION_Y_EXP);
  const s = Math.sqrt(Math.max(0, 1 - c * c));
  return bodyHalfWidth(x) * Math.pow(s, SECTION_Z_EXP);
}

// ── Median fins ─────────────────────────────────────────────────────────────────────────────────
/** Dorsal fin outer edge as [x, height above the back]. Spiny part, notch at x≈0.06, soft part. */
export const DORSAL_EDGE: [number, number][] = [
  [0.27, 0.0],
  [0.24, 0.05],
  [0.2, 0.074],
  [0.15, 0.072],
  [0.105, 0.06],
  [0.065, 0.036],
  [0.035, 0.062],
  [-0.005, 0.1],
  [-0.055, 0.118],
  [-0.105, 0.112],
  [-0.15, 0.092],
  [-0.188, 0.058],
  [-0.212, 0.0],
];

/** Anal fin outer edge as [x, depth below the belly]. */
export const ANAL_EDGE: [number, number][] = [
  [-0.01, 0.0],
  [-0.035, 0.058],
  [-0.07, 0.092],
  [-0.11, 0.1],
  [-0.15, 0.084],
  [-0.182, 0.046],
  [-0.2, 0.0],
];

/** Caudal fin: starts inside the peduncle, rounded trailing edge ending at TAIL_X. */
export const CAUDAL_START_X = -0.25;
export const CAUDAL_ROOT_HALF = 0.054;
export const CAUDAL_END_HALF = 0.152;
export const CAUDAL_COLS = [0, 0.3, 0.56, 0.8, 1];
export const CAUDAL_ROWS = 6; // rows of quads across the fin height

/** Caudal fin centre line height. */
export const caudalMidY = () => (bodyTop(PEDUNCLE_X) + bodyBot(PEDUNCLE_X)) / 2;

/** Caudal fin point for column fraction a (0 root .. 1 trailing edge) and yn in [-1, 1]. */
export function caudalPoint(a: number, yn: number, out: [number, number]) {
  const half = CAUDAL_ROOT_HALF + (CAUDAL_END_HALF - CAUDAL_ROOT_HALF) * Math.sin(a * Math.PI * 0.5) ** 0.9;
  // Rounded fan: the centre of the trailing edge is the most posterior point, corners pulled in.
  const yy = yn * yn;
  const endX = TAIL_X + 0.035 * yy + 0.05 * yy * yy;
  out[0] = CAUDAL_START_X + (endX - CAUDAL_START_X) * a;
  out[1] = caudalMidY() + yn * half * (1 - 0.12 * a * yy * yy);
  return out;
}

// ── Paired fins (own UV islands) ────────────────────────────────────────────────────────────────
/** Outline in fin-local units [along (0 = hinge), across (+ = towards the back/dorsal side)]. */
export const PECTORAL_OUTLINE: [number, number][] = [
  [0, 0.022],
  [0.04, 0.034],
  [0.08, 0.042],
  [0.115, 0.036],
  [0.138, 0.017],
  [0.143, 0.0],
  [0.138, -0.017],
  [0.115, -0.033],
  [0.08, -0.037],
  [0.04, -0.029],
  [0, -0.02],
];
export const PELVIC_OUTLINE: [number, number][] = [
  [0, 0.014],
  [0.04, 0.022],
  [0.075, 0.017],
  [0.092, 0.0],
  [0.072, -0.015],
  [0.035, -0.018],
  [0, -0.012],
];
export const PECTORAL_LEN = 0.143;
export const PELVIC_LEN = 0.092;

/** Island anchors in "virtual fish space" (they project below the fish via planarUV). */
export const PECTORAL_ISLAND = { x: 0.15, y: -0.4 };
export const PELVIC_ISLAND = { x: -0.05, y: -0.4 };

/** Fin-local (along, across) → virtual fish-space position inside its UV island. */
export function islandPoint(island: { x: number; y: number }, along: number, across: number): [number, number] {
  return [island.x - along, island.y + across];
}

/** Hinge positions on the body. */
export const PECTORAL_BASE = { x: 0.255, y: -0.035 };
export const PELVIC_BASE = { x: 0.2 };

// ── Eye ─────────────────────────────────────────────────────────────────────────────────────────
export const EYE = { x: 0.395, y: 0.04, r: 0.034 };
