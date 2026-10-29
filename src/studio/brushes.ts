/**
 * Brush stamps: white alpha masks drawn into the stroke layer. Colour (or a pattern) is applied
 * once when the stroke layer is composited, so stamps never need re-tinting.
 */
import { mulberry32 } from './paintMath';

export type BrushId = 'pencil' | 'soft' | 'crayon';

/** Stamp spacing as a fraction of the stamp radius. */
export const BRUSH_SPACING: Record<BrushId | 'eraser', number> = {
  pencil: 0.18,
  soft: 0.14,
  crayon: 0.22,
  eraser: 0.18,
};

/** Default hardness per brush when the player has no slider (Level 1). */
export const BRUSH_HARDNESS: Record<BrushId, number> = { pencil: 0.92, soft: 0.15, crayon: 0.85 };

const cache = new Map<string, HTMLCanvasElement[]>();

function makeCanvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Radial falloff stamp. hardness 1 = crisp disc, 0 = smooth airbrush. */
function radialStamp(size: number, hardness: number): HTMLCanvasElement {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d')!;
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  const h = Math.min(0.98, Math.max(0, hardness));
  const aa = Math.max(1.5 / r, 0.02); // keep a hair of anti-aliasing on hard edges
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(Math.min(h, 1 - aa), 'rgba(255,255,255,1)');
  if (h < 0.9) {
    // smooth ease-out for soft brushes
    const steps = 6;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const pos = h + (1 - h) * t;
      const a = Math.pow(1 - t, 2) * (1 - 0.15 * t);
      g.addColorStop(Math.min(pos, 0.999), `rgba(255,255,255,${a.toFixed(3)})`);
    }
  }
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** Waxy crayon tip: a disc with a ragged, slightly lumpy outline. Paper grain is added later in texture space. */
function crayonStamp(size: number, seed: number, hardness: number): HTMLCanvasElement {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d')!;
  const rnd = mulberry32(seed);
  const r = size / 2;
  const n = 28;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.8 + rnd() * 0.18);
    const x = r + Math.cos(a) * rr;
    const y = r + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'white';
  ctx.globalAlpha = 0.55 + 0.45 * hardness;
  ctx.fill();
  // a few waxy speckles that skip the paper
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 1;
  for (let i = 0; i < size / 6; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * r * 0.95;
    ctx.beginPath();
    ctx.arc(r + Math.cos(a) * d, r + Math.sin(a) * d, Math.max(0.6, size / 64) * (0.5 + rnd()), 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/**
 * Returns stamp variants for a brush. Picks a source resolution near the on-canvas size so small
 * stamps stay crisp and big ones stay sharp.
 */
export function getStamps(brush: BrushId | 'eraser', hardness: number, radiusPx: number): HTMLCanvasElement[] {
  const res = radiusPx <= 12 ? 32 : radiusPx <= 48 ? 96 : 256;
  const hq = Math.round(hardness * 10) / 10;
  const key = `${brush}|${hq}|${res}`;
  let stamps = cache.get(key);
  if (!stamps) {
    if (brush === 'crayon') stamps = [0, 1, 2, 3].map((s) => crayonStamp(res, 17 + s * 101, hq));
    else stamps = [radialStamp(res, brush === 'pencil' ? Math.max(hq, 0.85) : hq)];
    cache.set(key, stamps);
  }
  return stamps;
}

let grain: HTMLCanvasElement | null = null;

/**
 * Paper grain mask (white = wax sticks, transparent = paper shows through). Mostly binary so it
 * can be applied once per composite without darkening on repeat.
 */
export function getGrainTile(): HTMLCanvasElement {
  if (grain) return grain;
  const size = 128;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const rnd = mulberry32(4242);
  // tileable value noise at two octaves
  const octave = (cells: number) => {
    const g = Array.from({ length: cells * cells }, () => rnd());
    return (x: number, y: number) => {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const at = (i: number, j: number) => g[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const n1 = octave(32);
  const n2 = octave(64);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = n1(x, y) * 0.6 + n2(x, y) * 0.4 + (rnd() - 0.5) * 0.12;
      // threshold with a soft knee: ~22% of the paper shows through
      const a = Math.max(0, Math.min(1, (n - 0.3) / 0.08));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  grain = c;
  return c;
}
