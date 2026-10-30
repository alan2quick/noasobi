import { BufferAttribute, BufferGeometry } from 'three';
import { DESIGN_TEX_HEIGHT, DESIGN_TEX_WIDTH } from '../../core/types';
import {
  ARM,
  ARM_COUNT,
  ARM_HALF_WIDTH,
  ARM_LENGTH,
  ARM_TOP,
  ARM_ROWS,
  RINGS,
  SEGMENTS,
  TENTACLE_COUNT,
  TENTACLE_LANES,
  TENTACLE_ROWS,
  armAzimuth,
  discPoint,
  lobeWave,
  ringProfile,
  ringRho,
  tentacleLength,
  BELL_R,
} from './layout';

/**
 * Moon jelly: a scalloped dome, 4 frilly oral arms and a ring of 16 ribbon tentacles in ONE
 * indexed mesh (about 770 triangles), so a whole swarm is a single instanced draw.
 *
 * Animation attribute `aJ` (vec4), read by jellyShader.ts:
 *   x = bell weight 0 (apex) .. 1 (rim): how far the vertex follows the pulse. Arms use a small
 *       value, tentacles 1 (they hang from the rim).
 *   y = trail 0 (attachment) .. 1 (tip) for arms and tentacles, 0 for the bell.
 *   z = hanging length of the part in metres (0 for the bell).
 *   w = per-part phase (radians) so tentacles don't sway in step.
 */

export function buildJellyfishGeometry(): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const aj: number[] = [];
  const idx: number[] = [];

  const W = DESIGN_TEX_WIDTH;
  const H = DESIGN_TEX_HEIGHT;
  const vert = (x: number, y: number, z: number, cx: number, cy: number, a: number, b: number, c: number, d: number) => {
    pos.push(x, y, z);
    uv.push(cx / W, 1 - cy / H);
    aj.push(a, b, c, d);
    return pos.length / 3 - 1;
  };

  // ── Bell ─────────────────────────────────────────────────────────────────────────────────────
  const apex = ringProfile(0);
  const apexUv = discPoint(0, 0);
  const apexIdx = vert(0, apex.y, 0, apexUv[0], apexUv[1], 0, 0, 0, 0);
  const ringStart: number[] = [];
  for (let i = 1; i <= RINGS; i++) {
    ringStart[i] = pos.length / 3;
    const p = ringProfile(i);
    const rho = ringRho(i);
    for (let s = 0; s < SEGMENTS; s++) {
      const phi = (s / SEGMENTS) * Math.PI * 2;
      let r = p.r;
      let y = p.y;
      if (i === RINGS) {
        // Scalloped margin: lappet tips hang lower and reach a little further than the notches.
        const lw = lobeWave(phi);
        y -= 0.022 * (0.5 + 0.5 * lw);
        r += 0.012 * lw;
      } else if (i === RINGS - 1) {
        y -= 0.006 * (0.5 + 0.5 * lobeWave(phi));
      }
      const [cx, cy] = discPoint(phi, rho);
      vert(r * Math.cos(phi), y, r * Math.sin(phi), cx, cy, i / RINGS, 0, 0, 0);
    }
  }
  for (let s = 0; s < SEGMENTS; s++) {
    const s1 = (s + 1) % SEGMENTS;
    idx.push(apexIdx, ringStart[1] + s1, ringStart[1] + s);
  }
  for (let i = 1; i < RINGS; i++) {
    for (let s = 0; s < SEGMENTS; s++) {
      const s1 = (s + 1) % SEGMENTS;
      const a = ringStart[i] + s;
      const b = ringStart[i] + s1;
      const c = ringStart[i + 1] + s;
      const d = ringStart[i + 1] + s1;
      idx.push(a, b, c, b, d, c);
    }
  }

  // ── Oral arms: frilly folded ribbons hanging from the underside of the dome ──────────────────
  const rows = ARM_ROWS;
  for (let k = 0; k < ARM_COUNT; k++) {
    const phi = armAzimuth(k);
    const er = [Math.cos(phi), Math.sin(phi)];
    const et = [-Math.sin(phi), Math.cos(phi)];
    const base = pos.length / 3;
    for (let j = 0; j < rows; j++) {
      const t = j / (rows - 1);
      const r = 0.03 + 0.07 * t;
      const y = ARM_TOP - ARM_LENGTH * t;
      const frill = 1 + 0.38 * (j % 2 === 0 ? 1 : -1) * (j === 0 || j === rows - 1 ? 0.3 : 1);
      for (let c = 0; c < 3; c++) {
        const side = c - 1; // -1 left edge, 0 centre fold, +1 right edge
        const hw = ARM_HALF_WIDTH[j] * (c === 1 ? 0 : frill);
        // The centre line is pushed inwards: the ribbon is a shallow V, so it has body from all sides.
        const fold = c === 1 ? -0.03 * Math.sin(Math.PI * Math.min(1, t * 1.15)) : 0;
        const rr = r + fold;
        const x = er[0] * rr + et[0] * side * hw;
        const z = er[1] * rr + et[1] * side * hw;
        const cx = ARM.x0 + (c / 2) * (ARM.x1 - ARM.x0);
        const cy = ARM.y0 + t * (ARM.y1 - ARM.y0);
        vert(x, y, z, cx, cy, 0.2, t, ARM_LENGTH, k * 1.3);
      }
    }
    for (let j = 0; j < rows - 1; j++) {
      for (let c = 0; c < 2; c++) {
        const a = base + j * 3 + c;
        const b = a + 1;
        const cc = a + 3;
        const d = cc + 1;
        idx.push(a, b, cc, b, d, cc);
      }
    }
  }

  // ── Tentacles: thin ribbons from the margin, every other margin vertex ───────────────────────
  const trows = TENTACLE_ROWS;
  const step = SEGMENTS / TENTACLE_COUNT;
  for (let t = 0; t < TENTACLE_COUNT; t++) {
    const s = t * step;
    const phi = (s / SEGMENTS) * Math.PI * 2;
    const rim = ringProfile(RINGS);
    const lw = lobeWave(phi);
    const r0 = rim.r + 0.012 * lw;
    const y0 = rim.y - 0.022 * (0.5 + 0.5 * lw);
    // Even tentacles face outwards (broad side to the viewer), odd ones are turned a quarter.
    const wAng = phi + Math.PI / 2 + (t % 2) * (Math.PI / 2) + 0.35 * Math.sin(t * 2.3);
    const wd = [Math.cos(wAng), Math.sin(wAng)];
    const er = [Math.cos(phi), Math.sin(phi)];
    const et = [-Math.sin(phi), Math.cos(phi)];
    const len = tentacleLength(t);
    const lane = TENTACLE_LANES[t % 2];
    const base = pos.length / 3;
    for (let j = 0; j < trows; j++) {
      const tt = j / (trows - 1);
      const flare = 0.03 * Math.sin(Math.PI * Math.min(1, tt * 1.3));
      const wave = 0.012 * Math.sin(tt * 5.5 + t * 1.3) * tt;
      const cxr = r0 + flare;
      const px = er[0] * cxr + et[0] * wave;
      const pz = er[1] * cxr + et[1] * wave;
      const py = y0 - len * tt;
      const hw = 0.013 * (1 - 0.65 * tt);
      for (let c = 0; c < 2; c++) {
        const sd = c === 0 ? -1 : 1;
        const cx = lane.x0 + tt * (lane.x1 - lane.x0);
        const cy = c === 0 ? lane.y0 : lane.y1;
        vert(px + wd[0] * hw * sd, py, pz + wd[1] * hw * sd, cx, cy, 1, tt, len, t * 0.9);
      }
    }
    for (let j = 0; j < trows - 1; j++) {
      const a = base + j * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aJ', new BufferAttribute(new Float32Array(aj), 4));
  g.setIndex(new BufferAttribute(new Uint16Array(idx), 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export const JELLY_BELL_RADIUS = BELL_R;
