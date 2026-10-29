/**
 * Procedural pattern tiles, drawn in the current colour on a transparent background and tiled in
 * texture space. Tiles are generated in a square design space and stretched by the mesh's texel
 * aspect so dots stay round on the model.
 */
import { hexToRgb, mulberry32 } from './paintMath';

export type PatternId = 'zigzag' | 'dots' | 'leopard' | 'stripes';
export const PATTERNS: PatternId[] = ['stripes', 'dots', 'zigzag', 'leopard'];

/** Tile size relative to the base tile (leopard needs room for several rosettes). */
const TILE_FACTOR: Record<PatternId, number> = { stripes: 1, dots: 1, zigzag: 1, leopard: 2.2 };

const S = 100; // design space units per tile

function lighten(hex: string, t: number, alpha: number) {
  const [r, g, b] = hexToRgb(hex);
  const m = (c: number) => Math.round(c + (255 - c) * t);
  return `rgba(${m(r)},${m(g)},${m(b)},${alpha})`;
}

function drawRosette(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, rnd: () => number) {
  // lighter centre
  ctx.fillStyle = lighten(color, 0.4, 0.55);
  ctx.beginPath();
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.62 + rnd() * 0.22);
    const x = cx + Math.cos(a) * rr * 1.1;
    const y = cy + Math.sin(a) * rr * 0.9;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  // broken, irregular dark ring: 3-5 blobby arcs
  ctx.fillStyle = color;
  const pieces = 3 + Math.floor(rnd() * 2);
  let a0 = rnd() * Math.PI * 2;
  for (let p = 0; p < pieces; p++) {
    const span = ((Math.PI * 2) / pieces) * (0.55 + rnd() * 0.3);
    const thick = r * (0.3 + rnd() * 0.25);
    const wob = rnd() * 6;
    const steps = 8;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (span * i) / steps;
      const rr = r * (0.85 + Math.sin(i * 1.3 + wob) * 0.1);
      ctx.lineTo(cx + Math.cos(a) * rr * 1.1, cy + Math.sin(a) * rr * 0.9);
    }
    for (let i = steps; i >= 0; i--) {
      const a = a0 + (span * i) / steps;
      const t = Math.sin((i / steps) * Math.PI); // fatter in the middle of each arc
      const rr = r * 0.85 + thick * (0.35 + 0.65 * t) * (0.85 + Math.sin(i * 2.1 + wob) * 0.15);
      ctx.lineTo(cx + Math.cos(a) * rr * 1.1, cy + Math.sin(a) * rr * 0.9);
    }
    ctx.closePath();
    ctx.fill();
    a0 += (Math.PI * 2) / pieces;
  }
}

/** Draws one tile of a pattern into a square S x S design space. */
function drawTile(ctx: CanvasRenderingContext2D, id: PatternId, color: string) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  switch (id) {
    case 'stripes':
      // bands across the body (constant u)
      ctx.fillRect(S * 0.05, -1, S * 0.42, S + 2);
      break;
    case 'dots':
      for (const [x, y] of [
        [0.25, 0.25],
        [0.75, 0.75],
      ]) {
        ctx.beginPath();
        ctx.arc(x * S, y * S, S * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'zigzag':
      ctx.lineWidth = S * 0.13;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.moveTo(-S * 0.5, S * 0.68);
      ctx.lineTo(0, S * 0.32);
      ctx.lineTo(S * 0.5, S * 0.68);
      ctx.lineTo(S, S * 0.32);
      ctx.lineTo(S * 1.5, S * 0.68);
      ctx.stroke();
      break;
    case 'leopard': {
      const rnd = mulberry32(9001);
      // jittered grid of rosettes, drawn with wrap copies so the tile is seamless
      const cells = 3;
      for (let j = 0; j < cells; j++) {
        for (let i = 0; i < cells; i++) {
          const cx = ((i + 0.5 + (rnd() - 0.5) * 0.5 + (j % 2) * 0.5) / cells) * S;
          const cy = ((j + 0.5 + (rnd() - 0.5) * 0.4) / cells) * S;
          const r = S * (0.085 + rnd() * 0.035);
          const seed = Math.floor(rnd() * 1e9);
          // a small solid spot between rosettes
          const sx = cx + S / cells / 2;
          const sy = cy + S / cells / 2;
          const sr = S * (0.02 + rnd() * 0.015);
          for (const ox of [-S, 0, S]) {
            for (const oy of [-S, 0, S]) {
              const x = cx + ox;
              const y = cy + oy;
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.ellipse(sx + ox, sy + oy, sr * 1.3, sr, 0.5, 0, Math.PI * 2);
              ctx.fill();
              if (x < -S * 0.3 || x > S * 1.3 || y < -S * 0.3 || y > S * 1.3) continue;
              drawRosette(ctx, x, y, r, color, mulberry32(seed));
            }
          }
        }
      }
      break;
    }
  }
}

const tileCache = new Map<string, HTMLCanvasElement>();

/**
 * Tile canvas for `id` in `color`. `tilePxX`/`tilePxY` is the base tile size in canvas pixels
 * (already corrected for texel aspect).
 */
export function getPatternTile(id: PatternId, color: string, tilePxX: number, tilePxY: number): HTMLCanvasElement {
  const f = TILE_FACTOR[id];
  const tw = Math.max(8, Math.min(1024, Math.round(tilePxX * f)));
  const th = Math.max(8, Math.min(512, Math.round(tilePxY * f)));
  const key = `${id}|${color}|${tw}|${th}`;
  let tile = tileCache.get(key);
  if (!tile) {
    if (tileCache.size > 24) tileCache.delete(tileCache.keys().next().value!);
    tile = document.createElement('canvas');
    tile.width = tw;
    tile.height = th;
    const ctx = tile.getContext('2d')!;
    ctx.scale(tw / S, th / S);
    drawTile(ctx, id, color);
    tileCache.set(key, tile);
  }
  return tile;
}

/** Small picture of a pattern for the icon-first buttons. */
export function patternPreview(id: PatternId, color: string, bg = '#fff7e6', size = 96): string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  const base = size / 2.2;
  const tile = getPatternTile(id, color, base, base);
  const pat = ctx.createPattern(tile, 'repeat')!;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, size, size);
  return c.toDataURL();
}
