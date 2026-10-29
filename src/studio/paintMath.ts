/**
 * Pure helpers for the design studio: texture-space mapping, mirroring, stroke interpolation and
 * seam breaking, rectangles and texel density. No DOM or three.js runtime code here so it is unit
 * testable in node.
 */
import { DESIGN_TEX_HEIGHT, DESIGN_TEX_WIDTH } from '../core/types';

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const W = DESIGN_TEX_WIDTH;
export const H = DESIGN_TEX_HEIGHT;

/** uv (three.js convention, v = 1 at the top of the canvas) to canvas pixel coordinates. */
export function uvToCanvas(u: number, v: number, w = W, h = H): Pt {
  return { x: u * w, y: (1 - v) * h };
}

/** Canvas pixel coordinates to uv. Inverse of uvToCanvas. */
export function canvasToUv(x: number, y: number, w = W, h = H): { u: number; v: number } {
  return { u: x / w, v: 1 - y / h };
}

/** Bilateral mirror: the same body point on the opposite flank sits at u' = 1 - u, i.e. x' = W - x. */
export function mirrorX(x: number, w = W): number {
  return w - x;
}

/**
 * Screen-space interpolation between two pointer samples. Returns the points after `a` up to and
 * including `b`, spaced at most `step` apart, so fast strokes are raycast densely.
 */
export function interpolateScreen(a: Pt, b: Pt, step: number): Pt[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const n = Math.max(1, Math.ceil(dist / Math.max(step, 1e-6)));
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) out.push({ x: a.x + (dx * i) / n, y: a.y + (dy * i) / n });
  return out;
}

/**
 * Consecutive raycast hits that land far apart in texture space crossed a UV seam (or jumped to
 * another part of the body): the stroke must break there instead of smearing across the texture.
 */
export function isSeamJump(a: Pt, b: Pt, maxJump: number): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) > maxJump;
}

/**
 * Stamp positions along the canvas-space segment a -> b with fixed spacing.
 * `carry` is the distance already travelled since the last stamp (from the previous segment).
 * Returns the stamp points and the new carry.
 */
export function stampsAlong(a: Pt, b: Pt, spacing: number, carry: number): { points: Pt[]; carry: number } {
  const sp = Math.max(spacing, 0.5);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const points: Pt[] = [];
  if (len === 0) return { points, carry };
  let d = sp - carry; // distance along the segment to the next stamp
  while (d <= len) {
    const t = d / len;
    points.push({ x: a.x + dx * t, y: a.y + dy * t });
    d += sp;
  }
  // distance travelled since the last stamp at the end of the segment
  const newCarry = len - (d - sp);
  return { points, carry: newCarry };
}

/**
 * Turns a sequence of raycast results (canvas points, or null for a miss) into continuous
 * polylines, breaking at misses and seam jumps. Used by tests and as the reference for the
 * incremental stroke logic in the paint view.
 */
export function splitAtSeams(hits: (Pt | null)[], maxJump: number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let prev: Pt | null = null;
  for (const h of hits) {
    if (!h) {
      if (cur.length) out.push(cur);
      cur = [];
      prev = null;
      continue;
    }
    if (prev && isSeamJump(prev, h, maxJump)) {
      out.push(cur);
      cur = [];
    }
    cur.push(h);
    prev = h;
  }
  if (cur.length) out.push(cur);
  return out;
}

// ---------- rectangles ----------

export function emptyRect(): Rect {
  return { x: Infinity, y: Infinity, w: -Infinity, h: -Infinity };
}

export function isEmptyRect(r: Rect): boolean {
  return !(r.w > 0 && r.h > 0) || !Number.isFinite(r.x);
}

/** Grows `r` in place to include the box [x0, y0, x1, y1]. */
export function includeBox(r: Rect, x0: number, y0: number, x1: number, y1: number): Rect {
  if (isEmptyRect(r)) {
    r.x = x0;
    r.y = y0;
    r.w = x1 - x0;
    r.h = y1 - y0;
    return r;
  }
  const nx0 = Math.min(r.x, x0);
  const ny0 = Math.min(r.y, y0);
  const nx1 = Math.max(r.x + r.w, x1);
  const ny1 = Math.max(r.y + r.h, y1);
  r.x = nx0;
  r.y = ny0;
  r.w = nx1 - nx0;
  r.h = ny1 - ny0;
  return r;
}

/** Integer rect clamped to the canvas; null if nothing is left. */
export function clampRect(r: Rect, w = W, h = H): Rect | null {
  if (isEmptyRect(r)) return null;
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w));
  const y1 = Math.min(h, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function mirrorRect(r: Rect, w = W): Rect {
  return { x: w - r.x - r.w, y: r.y, w: r.w, h: r.h };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
}

/** Merges overlapping rects so undo patches never store the same pixels twice. */
export function mergeRects(rects: Rect[]): Rect[] {
  const out = rects.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (rectsOverlap(out[i], out[j])) {
          out[i] = unionRect(out[i], out[j]);
          out.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return out;
}

// ---------- geometry measurements ----------

/**
 * Average world units per canvas pixel along x and y over the mesh, weighted by triangle area.
 * Used to size brush stamps and pattern tiles in on-model terms (dots stay round on a stretched UV
 * layout). `positions` is xyz per vertex, `uvs` uv per vertex, `index` optional.
 */
export function texelScale(
  positions: ArrayLike<number>,
  uvs: ArrayLike<number>,
  index?: ArrayLike<number> | null,
  w = W,
  h = H,
): { unitsPerPxX: number; unitsPerPxY: number } {
  const triCount = index ? index.length / 3 : positions.length / 9;
  let sumX = 0;
  let sumY = 0;
  let sumA = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index[t * 3] : t * 3;
    const i1 = index ? index[t * 3 + 1] : t * 3 + 1;
    const i2 = index ? index[t * 3 + 2] : t * 3 + 2;
    // world edges
    const e1 = [0, 1, 2].map((k) => positions[i1 * 3 + k] - positions[i0 * 3 + k]);
    const e2 = [0, 1, 2].map((k) => positions[i2 * 3 + k] - positions[i0 * 3 + k]);
    // canvas-pixel edges (y down; sign does not matter for lengths)
    const d1x = (uvs[i1 * 2] - uvs[i0 * 2]) * w;
    const d1y = (uvs[i1 * 2 + 1] - uvs[i0 * 2 + 1]) * h;
    const d2x = (uvs[i2 * 2] - uvs[i0 * 2]) * w;
    const d2y = (uvs[i2 * 2 + 1] - uvs[i0 * 2 + 1]) * h;
    const det = d1x * d2y - d2x * d1y;
    if (Math.abs(det) < 1e-9) continue;
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    const area = 0.5 * Math.hypot(cx, cy, cz);
    if (area < 1e-12) continue;
    // J = E * D^-1, columns are dP/dx and dP/dy
    const inv00 = d2y / det;
    const inv01 = -d2x / det;
    const inv10 = -d1y / det;
    const inv11 = d1x / det;
    let jx = 0;
    let jy = 0;
    for (let k = 0; k < 3; k++) {
      const a = e1[k] * inv00 + e2[k] * inv10;
      const b = e1[k] * inv01 + e2[k] * inv11;
      jx += a * a;
      jy += b * b;
    }
    sumX += Math.sqrt(jx) * area;
    sumY += Math.sqrt(jy) * area;
    sumA += area;
  }
  if (sumA === 0) return { unitsPerPxX: 1 / w, unitsPerPxY: 1 / h };
  return { unitsPerPxX: sumX / sumA, unitsPerPxY: sumY / sumA };
}

/**
 * Extents of points projected onto a camera basis (right, up), used to frame orthographic views.
 */
export function projectedExtents(
  positions: ArrayLike<number>,
  right: [number, number, number],
  up: [number, number, number],
): { minR: number; maxR: number; minU: number; maxU: number } {
  let minR = Infinity;
  let maxR = -Infinity;
  let minU = Infinity;
  let maxU = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const r = x * right[0] + y * right[1] + z * right[2];
    const u = x * up[0] + y * up[1] + z * up[2];
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
  }
  return { minR, maxR, minU, maxU };
}

/** Frustum half sizes that fit a box of size (bw, bh) into a viewport aspect with margin. */
export function fitOrtho(bw: number, bh: number, aspect: number, margin = 1.15): { halfW: number; halfH: number } {
  let halfW = (bw / 2) * margin;
  let halfH = (bh / 2) * margin;
  if (halfW / halfH > aspect) halfH = halfW / aspect;
  else halfW = halfH * aspect;
  return { halfW, halfH };
}

// ---------- colour ----------

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** sRGB byte from a linear 0..1 value. */
export function linearToSrgbByte(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** Small deterministic PRNG for procedural patterns. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
