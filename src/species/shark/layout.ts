/**
 * Blacktip reef shark shape + UV layout, shared by the procedural mesh (geometry.ts) and the
 * template painters (template.ts) so the two can never drift apart. Pure data/maths, no DOM,
 * no three. Follows the clownfish layout conventions.
 *
 * Shark space: forward +X, up +Y, left flank faces -Z. Snout tip at x = +0.5, upper caudal lobe
 * tip at x = -0.5 (1 unit long), body centre line around y = 0.
 *
 * ── UV LAYOUT (bilateral, 1024 x 512 design canvas) ───────────────────────────────────────────
 *  Planar side projection, same scale on both axes (471.04 canvas px per unit):
 *
 *    left flank  (u < 0.5):  px = 256 - 471.04 * x      py = 256 - 471.04 * y
 *    right flank (u >= 0.5): px = 768 + 471.04 * x      py = 256 - 471.04 * y   (= 1024 - left px)
 *
 *  So the LEFT half of the canvas is the left flank seen from the shark's left (-Z), snout pointing
 *  LEFT (snout tip at px 20, upper tail tip at px 492), back up. The right half is its horizontal
 *  mirror (snout px 1004, tail px 532). Shark centre (0, 0) sits at canvas (256, 256) / (768, 256).
 *  The first dorsal fin tops out around py 150, the body spans py ~215..300 at its deepest and the
 *  caudal fin reaches py ~200..296.
 *
 *  - Body shell: each flank's half of the body uses the planar projection above.
 *  - Median fins (first/second dorsal, anal, caudal; thin sheets): the face looking at -Z uses the
 *    left-half projection, the face looking at +Z the right-half one, so they paint exactly where
 *    they appear in the side view (dorsal above the back, tail right of the peduncle, ...).
 *  - Paired fins sit ON the flank in the side view, so they get their own islands in the free strip
 *    below the shark (py ~410..470) instead of sharing body pixels. Both faces of each fin use the
 *    island of the flank it belongs to. Fin-local coordinates (along the span from the hinge, across
 *    the chord) map 1:1 to canvas pixels, so texel density matches the body:
 *       pectoral island: hinge at px ~138, py ~444, extends right to px ~246
 *       pelvic   island: hinge at px ~315, py ~444, extends right to px ~353
 *    (right flank: mirrored, px' = 1024 - px). Islands are > 64 px from the body and each other, so
 *    a stroke never joins two of them.
 *  - The eye is separate, non-paintable geometry (see geometry.ts), flagged aEye.x = 2 so the shader
 *    colours it dark. Its centre in the side view is canvas ~(65, 250) left / (959, 250) right,
 *    radius ~9 px.
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 */

export const TEX_W = 1024;
export const TEX_H = 512;
/** Canvas pixels per unit (both axes, so the side view is undistorted). */
export const PX_PER_UNIT = 471.04;
/** Canvas position of the shark's (0,0) in the left half. */
export const LEFT_ORIGIN_PX: [number, number] = [256, 256];

export const NOSE_X = 0.5;
export const TAIL_X = -0.5;
/** Body (shell) length from snout to the end of the caudal peduncle, units. */
export const BODY_LEN = 0.81;
export const PEDUNCLE_X = NOSE_X - BODY_LEN; // -0.31

/** Point (x, y) → design-texture uv for the given flank (-1 = left, +1 = right). */
export function planarUV(x: number, y: number, side: number, out: [number, number]) {
  const pxLeft = LEFT_ORIGIN_PX[0] - PX_PER_UNIT * x;
  const py = LEFT_ORIGIN_PX[1] - PX_PER_UNIT * y;
  const uLeft = pxLeft / TEX_W;
  out[0] = side < 0 ? uLeft : 1 - uLeft;
  out[1] = 1 - py / TEX_H;
  return out;
}

/** Shark-space point → left-half canvas pixel (for studio guides). */
export function fishToCanvas(x: number, y: number): [number, number] {
  return [LEFT_ORIGIN_PX[0] - PX_PER_UNIT * x, LEFT_ORIGIN_PX[1] - PX_PER_UNIT * y];
}

// ── Body profile ────────────────────────────────────────────────────────────────────────────────
// Knots along t = (NOSE_X - x) / BODY_LEN. Slender torpedo, a pointed-but-rounded snout, deepest
// just ahead of the first dorsal, tapering to a slim peduncle. Round-ish cross-section.
export const PROFILE_T = [0, 0.02, 0.05, 0.1, 0.17, 0.26, 0.36, 0.47, 0.58, 0.69, 0.79, 0.88, 0.95, 1.0];
export const PROFILE_TOP = [0.0, 0.02, 0.037, 0.055, 0.071, 0.082, 0.086, 0.084, 0.075, 0.062, 0.049, 0.039, 0.032, 0.028];
export const PROFILE_BOT = [-0.011, -0.027, -0.043, -0.058, -0.07, -0.077, -0.078, -0.074, -0.065, -0.052, -0.04, -0.03, -0.024, -0.021];
export const PROFILE_HW = [0.0, 0.016, 0.03, 0.042, 0.053, 0.06, 0.063, 0.061, 0.054, 0.045, 0.035, 0.027, 0.022, 0.019];

function sample(arr: number[], x: number): number {
  const t = Math.min(1, Math.max(0, (NOSE_X - x) / BODY_LEN));
  for (let i = 1; i < PROFILE_T.length; i++) {
    if (t <= PROFILE_T[i]) {
      const k = (t - PROFILE_T[i - 1]) / (PROFILE_T[i] - PROFILE_T[i - 1]);
      const s = k * k * (3 - 2 * k) * 0.4 + k * 0.6;
      return arr[i - 1] + (arr[i] - arr[i - 1]) * s;
    }
  }
  return arr[arr.length - 1];
}

export const bodyTop = (x: number) => sample(PROFILE_TOP, x);
export const bodyBot = (x: number) => sample(PROFILE_BOT, x);
export const bodyHalfWidth = (x: number) => sample(PROFILE_HW, x);

/** Cross-section exponents (1 = ellipse). */
export const SECTION_Z_EXP = 0.9;
export const SECTION_Y_EXP = 1;

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
/** How far a fin base is sunk into the body so no gap shows. */
export const FIN_EMBED = 0.012;

/**
 * Median fin free edge as [x, height]: height is measured from the sunk base line
 * (bodyTop(x) - FIN_EMBED for dorsal fins, bodyBot(x) + FIN_EMBED for the anal fin), first and last
 * heights are 0 (the base ends). x runs front to back.
 */
export const DORSAL1_EDGE: [number, number][] = [
  [0.175, 0.0],
  [0.15, 0.046],
  [0.115, 0.102],
  [0.075, 0.148],
  [0.04, 0.178],
  [0.027, 0.18], // apex, swept back
  [0.016, 0.125],
  [0.0, 0.074],
  [-0.025, 0.036],
  [-0.058, 0.0], // free rear tip
];
export const DORSAL2_EDGE: [number, number][] = [
  [-0.145, 0.0],
  [-0.165, 0.028],
  [-0.183, 0.05],
  [-0.2, 0.052],
  [-0.2, 0.028],
  [-0.225, 0.0],
];
export const ANAL_EDGE: [number, number][] = [
  [-0.12, 0.0],
  [-0.14, 0.022],
  [-0.168, 0.052],
  [-0.19, 0.056],
  [-0.188, 0.03],
  [-0.215, 0.0],
];

/** Base sample positions for a median fin polygon (x spacing). */
export const FIN_BASE_STEP = 0.03;

/** Closed fin polygon (shark space): free edge front → back, then the base back → front. */
export function medianFinPolygon(edge: [number, number][], dir: 1 | -1): [number, number][] {
  const base = (x: number) => (dir > 0 ? bodyTop(x) - FIN_EMBED : bodyBot(x) + FIN_EMBED);
  const poly: [number, number][] = edge.map(([x, h]) => [x, base(x) + dir * h]);
  const xf = edge[0][0];
  const xb = edge[edge.length - 1][0];
  const n = Math.floor((xf - xb) / FIN_BASE_STEP);
  for (let k = 1; k <= n; k++) {
    const x = xb + k * FIN_BASE_STEP;
    if (x < xf - 0.008) poly.push([x, base(x)]);
  }
  return poly;
}

/** Heterocercal tail: the upper lobe is clearly longer than the lower. Outline, root top → back. */
export const CAUDAL_OUTLINE: [number, number][] = [
  [-0.296, 0.03],
  [-0.34, 0.05],
  [-0.39, 0.075],
  [-0.445, 0.105],
  [-0.5, 0.13], // upper lobe tip
  [-0.468, 0.075],
  [-0.438, 0.03],
  [-0.41, -0.01], // notch between the lobes
  [-0.428, -0.047],
  [-0.44, -0.09], // lower lobe tip
  [-0.39, -0.078],
  [-0.34, -0.052],
  [-0.296, -0.022],
];
/** Lower lobe region (for the black tip), indices into CAUDAL_OUTLINE. */
export const CAUDAL_LOWER_TIP_FROM_X = -0.405;

// ── Paired fins (own UV islands) ────────────────────────────────────────────────────────────────
/**
 * Outline in fin-local units [along the span (0 = hinge), across the chord (+ = leading edge,
 * towards the back/dorsal side)]. Swept, sickle-shaped pectoral: convex leading edge, concave
 * trailing edge, pointed tip.
 */
export const PECTORAL_OUTLINE: [number, number][] = [
  [0, 0.056],
  [0.045, 0.053],
  [0.098, 0.044],
  [0.15, 0.029],
  [0.196, 0.011],
  [0.23, -0.009], // tip
  [0.172, -0.007],
  [0.115, -0.008],
  [0.058, -0.016],
  [0, -0.032],
];
export const PELVIC_OUTLINE: [number, number][] = [
  [0, 0.024],
  [0.03, 0.021],
  [0.06, 0.012],
  [0.08, -0.003], // tip
  [0.05, -0.006],
  [0.02, -0.012],
  [0, -0.016],
];
export const PECTORAL_LEN = 0.23;
export const PELVIC_LEN = 0.08;

/** Island anchors in "virtual shark space" (they project below the shark via planarUV). */
export const PECTORAL_ISLAND = { x: 0.25, y: -0.4 };
export const PELVIC_ISLAND = { x: -0.125, y: -0.4 };

/** Fin-local (along, across) → virtual shark-space position inside its UV island. */
export function islandPoint(island: { x: number; y: number }, along: number, across: number): [number, number] {
  return [island.x - along, island.y + across];
}

/** Hinge positions on the body. */
export const PECTORAL_BASE = { x: 0.185, y: -0.045 };
export const PELVIC_BASE = { x: -0.045 };

// ── Face details (texture only) ─────────────────────────────────────────────────────────────────
/** Five gill slits, front to back: x of the slit and its relative length. */
export const GILL_X = [0.292, 0.268, 0.244, 0.22, 0.197];
export const GILL_LEN = [0.72, 0.9, 1, 0.95, 0.8];

/** Countershading boundary height (white belly below) along the flank. */
export function shadeBoundaryY(x: number): number {
  const t = Math.min(1, Math.max(0, (0.5 - x) / 0.8));
  return -0.03 + 0.04 * t;
}

// ── Eye ─────────────────────────────────────────────────────────────────────────────────────────
export const EYE = { x: 0.395, y: 0.013, r: 0.02 };

// ── Triangulation ───────────────────────────────────────────────────────────────────────────────
/** Ear-clipping triangulation of a simple polygon → index triples into `poly`. */
export function triangulate(poly: [number, number][]): [number, number, number][] {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    area += x0 * y1 - x1 * y0;
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(area >= 0 ? i : n - 1 - i);
  const cross = (a: number, b: number, c: number) =>
    (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0]);
  const inside = (p: number, a: number, b: number, c: number) =>
    cross(a, b, p) > 1e-12 && cross(b, c, p) > 1e-12 && cross(c, a, p) > 1e-12;
  const tris: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 500) {
    let clipped = false;
    for (let i = 0; i < idx.length && !clipped; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= 1e-9) continue;
      let ok = true;
      for (const k of idx) {
        if (k === a || k === b || k === c) continue;
        if (inside(k, a, b, c)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
    }
    if (!clipped) {
      // Collinear points: drop the flattest vertex without emitting a triangle.
      let best = 0;
      let bestV = Infinity;
      for (let i = 0; i < idx.length; i++) {
        const v = Math.abs(cross(idx[(i + idx.length - 1) % idx.length], idx[i], idx[(i + 1) % idx.length]));
        if (v < bestV) {
          bestV = v;
          best = i;
        }
      }
      idx.splice(best, 1);
    }
  }
  if (idx.length === 3 && cross(idx[0], idx[1], idx[2]) > 1e-9) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}
