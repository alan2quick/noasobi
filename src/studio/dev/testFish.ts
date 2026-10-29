/**
 * Dev-only test species for the studio (enabled with the `?studioTest` URL flag): a flattened fish
 * whose UVs follow the bilateral convention exactly, so painting and mirroring can be verified
 * before the real species models land.
 *
 * UV layout: left flank in u 0.03..0.47 (nose at the small u end), right flank its mirror image,
 * v runs belly (bottom) to back (top).
 */
import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { SpeciesDef } from '../../core/types';
import { DESIGN_TEX_HEIGHT, DESIGN_TEX_WIDTH } from '../../core/types';

const S = [0, 0.08, 0.2, 0.35, 0.5, 0.65, 0.76, 0.8, 1.0];
const HP = [0.03, 0.15, 0.22, 0.24, 0.21, 0.13, 0.06, 0.07, 0.24];
const WP = [0.0, 0.07, 0.1, 0.105, 0.09, 0.055, 0.025, 0.008, 0.004];

function profile(table: number[], s: number) {
  for (let i = 0; i < S.length - 1; i++) {
    if (s <= S[i + 1]) {
      const t = (s - S[i]) / (S[i + 1] - S[i]);
      const k = t * t * (3 - 2 * t);
      return table[i] + (table[i + 1] - table[i]) * k;
    }
  }
  return table[table.length - 1];
}

const U0 = 0.03;
const U1 = 0.47;
const V_HALF = 0.46;

export function buildTestFishGeometry(ns = 40, nt = 16): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const spine: number[] = [];
  const index: number[] = [];
  for (const side of [-1, 1]) {
    const start = pos.length / 3;
    for (let j = 0; j <= nt; j++) {
      const phi = -Math.PI / 2 + (j / nt) * Math.PI;
      for (let i = 0; i <= ns; i++) {
        const s = i / ns;
        const h = profile(HP, s);
        const w = profile(WP, s);
        pos.push(0.5 - s, h * Math.sin(phi), side * w * Math.cos(phi));
        const uLeft = U0 + s * (U1 - U0);
        uv.push(side < 0 ? uLeft : 1 - uLeft, 0.5 + (V_HALF * phi) / (Math.PI / 2));
        spine.push(s);
      }
    }
    for (let j = 0; j < nt; j++) {
      for (let i = 0; i < ns; i++) {
        const a = start + j * (ns + 1) + i;
        const b = a + 1;
        const c = a + ns + 2;
        const d = a + ns + 1;
        if (side < 0) index.push(a, b, c, a, c, d);
        else index.push(a, c, b, a, d, c);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('aSpine', new Float32BufferAttribute(spine, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function drawLeftFlank(ctx: CanvasRenderingContext2D) {
  const W = DESIGN_TEX_WIDTH;
  const H = DESIGN_TEX_HEIGHT;
  const xAt = (s: number) => (U0 + s * (U1 - U0)) * W;
  const yAt = (t: number) => (1 - (0.5 + V_HALF * t)) * H;
  // white bands with dark edges
  for (const [s0, s1] of [
    [0.16, 0.24],
    [0.45, 0.53],
  ]) {
    ctx.fillStyle = '#222';
    ctx.fillRect(xAt(s0) - 6, 0, xAt(s1) - xAt(s0) + 12, H);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(xAt(s0), 0, xAt(s1) - xAt(s0), H);
  }
  // tail tip
  ctx.fillStyle = '#222';
  ctx.fillRect(xAt(0.95), 0, xAt(1) - xAt(0.95) + 4, H);
  // eye
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(xAt(0.07), yAt(0.25), 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(xAt(0.07), yAt(0.25), 9, 0, Math.PI * 2);
  ctx.fill();
}

export const testFish: SpeciesDef = {
  id: 'clownfish',
  name: 'Test fish',
  kind: 'creature',
  biomes: ['ocean'],
  icon: '🐟',
  symmetry: 'bilateral',
  buildGeometry: () => buildTestFishGeometry(),
  drawTemplate(ctx) {
    const W = ctx.canvas.width;
    ctx.fillStyle = '#f57c00';
    ctx.fillRect(0, 0, W, ctx.canvas.height);
    drawLeftFlank(ctx);
    ctx.save();
    ctx.setTransform(-1, 0, 0, 1, W, 0);
    drawLeftFlank(ctx);
    ctx.restore();
  },
  // Camera sits on the -Z side and sees the left flank, nose pointing left.
  sideView: { direction: [0, 0, -1], up: [0, 1, 0] },
  locomotion: 'swim-fish',
  activity: 'diurnal',
  habitat: { heightMin: 0.5, heightMax: 4, coverAffinity: 0.7 },
  scaleRange: [1, 1],
  diet: 'flakes',
};
