import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import {
  BLADES,
  BLADE_HW,
  BLADE_T,
  BLADE_U_END,
  BLADE_U_START,
  BLADDER_U_GAP,
  BLADDER_U_LEN,
  HOLDFAST_V1,
  STIPE_TOP,
  STIPE_U0,
  STIPE_U1,
  bladeRow,
  stipeCenter,
  stipeRadius,
  stipeV,
} from './layout';

/**
 * Procedural low-poly giant kelp (~580 triangles, ~490 vertices).
 * Parts: lobed holdfast, 4-sided curved stipe, 19 ruffled blades alternating up the stipe, each
 * with a spindle-shaped gas bladder at its base. See layout.ts for the UV layout.
 *
 * Extra attribute `aSway` (vec3) for the plant sway shader:
 *   x = height along the plant, 0 at the seabed .. 1 at the top
 *   y = flutter weight, 0 on rigid parts (holdfast, stipe, bladders) .. 1 at blade tips
 *   z = per-blade phase in radians
 */
export function buildKelpGeometry(): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const flutter: number[] = [];
  const phase: number[] = [];
  const idx: number[] = [];

  const vert = (p: Vector3 | [number, number, number], u: number, v: number, fl = 0, ph = 0) => {
    if (Array.isArray(p)) pos.push(p[0], p[1], p[2]);
    else pos.push(p.x, p.y, p.z);
    uv.push(u, v);
    flutter.push(fl);
    phase.push(ph);
    return pos.length / 3 - 1;
  };
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);

  // Ring angle for strip coordinate phi in [0, 1]: back (-Z) at the strip edges, -X at 0.25,
  // front (+Z) in the middle, +X at 0.75. Matches the front-view UV layout.
  const ringDir = (phi: number): [number, number] => {
    const th = -Math.PI / 2 - phi * Math.PI * 2;
    return [Math.cos(th), Math.sin(th)];
  };
  const stripU = (phi: number) => STIPE_U0 + (STIPE_U1 - STIPE_U0) * phi;

  // --- Holdfast: 8 lobes, 3 rings, slightly below y = 0 so it sits into sloped sand.
  {
    const sides = 8;
    const rings: [number, number, number, number][] = [
      // y, lobe radius, gap radius, v
      [-0.12, 0.42, 0.2, 0],
      [0.12, 0.2, 0.13, HOLDFAST_V1 * 0.5],
      [0.32, 0.065, 0.065, HOLDFAST_V1],
    ];
    const start = pos.length / 3;
    for (const [y, rl, rg, v] of rings) {
      for (let j = 0; j <= sides; j++) {
        const phi = j / sides;
        const [dx, dz] = ringDir(phi);
        const r = j % 2 === 0 ? rl : rg;
        const [cx, cz] = stipeCenter(y);
        vert([cx + dx * r, y, cz + dz * r], stripU(phi), v);
      }
    }
    for (let r = 0; r < rings.length - 1; r++) {
      for (let j = 0; j < sides; j++) {
        const a = start + r * (sides + 1) + j;
        const b = a + sides + 1;
        quad(a, a + 1, b + 1, b);
      }
    }
  }

  // --- Stipe: 4-sided tube, 12 segments, tapering, following stipeCenter.
  {
    const sides = 4;
    const segs = 12;
    const y0 = 0.12;
    const start = pos.length / 3;
    for (let k = 0; k <= segs; k++) {
      const y = y0 + (STIPE_TOP - y0) * (k / segs);
      const [cx, cz] = stipeCenter(y);
      const r = stipeRadius(y);
      for (let j = 0; j <= sides; j++) {
        const phi = j / sides;
        const [dx, dz] = ringDir(phi);
        vert([cx + dx * r, y, cz + dz * r], stripU(phi), stipeV(y));
      }
    }
    for (let k = 0; k < segs; k++) {
      for (let j = 0; j < sides; j++) {
        const a = start + k * (sides + 1) + j;
        const b = a + sides + 1;
        quad(a, a + 1, b + 1, b);
      }
    }
  }

  // --- Blades + bladders.
  const up = new Vector3(0, 1, 0);
  const horiz = new Vector3();
  const face = new Vector3();
  const dir = new Vector3();
  const width = new Vector3();
  const p = new Vector3();
  const c = new Vector3();
  const tmp = new Vector3();
  for (const b of BLADES) {
    const row = bladeRow(b);
    const yaw = b.yaw + (b.side > 0 ? 0 : Math.PI);
    horiz.set(Math.cos(yaw), 0, -Math.sin(yaw));
    // Face normal: horizontal, perpendicular to the blade's outward direction, towards +Z.
    face.crossVectors(horiz, up).multiplyScalar(-1);
    if (face.z < 0) face.negate();
    const dirAt = (elev: number, out: Vector3) =>
      out.copy(horiz).multiplyScalar(Math.cos(elev)).addScaledVector(up, Math.sin(elev));
    const widthAt = (d: Vector3, out: Vector3) => {
      out.crossVectors(face, d).normalize();
      if (out.y < 0) out.negate(); // +width = upper edge
      return out;
    };

    // Attachment point on the stipe surface.
    const [sx, sz] = stipeCenter(b.y);
    const sr = stipeRadius(b.y);
    const attach = new Vector3(sx, b.y, sz).addScaledVector(horiz, sr * 0.8);

    // Bladder: spindle (bipyramid with a 4-vertex ring) along the base direction.
    dirAt(b.elev0, dir);
    widthAt(dir, width);
    const bl = 0.2;
    const br = 0.065;
    const u0 = row.uAt(BLADDER_U_GAP);
    const u1 = row.uAt(BLADDER_U_GAP + BLADDER_U_LEN);
    const bladderVHalf = row.vHalf * 0.85;
    const a0 = vert(attach, u0, row.vMid);
    c.copy(attach).addScaledVector(dir, bl * 0.5);
    const ring: number[] = [];
    for (let j = 0; j < 4; j++) {
      const ang = (j / 4) * Math.PI * 2;
      p.copy(c)
        .addScaledVector(width, Math.cos(ang) * br)
        .addScaledVector(face, Math.sin(ang) * br);
      ring.push(vert(p, (u0 + u1) / 2, row.vMid + Math.cos(ang) * bladderVHalf));
    }
    p.copy(attach).addScaledVector(dir, bl);
    const a1 = vert(p, u1, row.vMid);
    for (let j = 0; j < 4; j++) {
      const r0 = ring[j];
      const r1 = ring[(j + 1) % 4];
      idx.push(a0, r0, r1, r1, r0, a1);
    }

    // Blade: 5 rows x 3 vertices (upper edge, midrib, lower edge), ruffled edges.
    const base = pos.length / 3;
    p.copy(attach).addScaledVector(dir, bl * 0.85);
    const segLen = (i: number) => (BLADE_T[i] - BLADE_T[i - 1]) * b.length;
    for (let i = 0; i < BLADE_T.length; i++) {
      const t = BLADE_T[i];
      dirAt(b.elev0 + (b.elev1 - b.elev0) * t, dir);
      if (i > 0) {
        // Integrate the curving centre line (mid-segment direction).
        dirAt(b.elev0 + (b.elev1 - b.elev0) * (t + BLADE_T[i - 1]) * 0.5, tmp);
        p.addScaledVector(tmp, segLen(i));
      }
      widthAt(dir, width);
      const hw = b.halfWidth * BLADE_HW[i];
      const ruffle = (i % 2 === 0 ? 1 : -1) * 0.075 * BLADE_HW[i];
      const fl = Math.pow(t, 1.2);
      const u = row.uAt(BLADE_U_START + (BLADE_U_END - BLADE_U_START) * t);
      const vh = row.vHalf * BLADE_HW[i];
      // Upper edge, midrib (slightly cupped), lower edge.
      c.copy(p).addScaledVector(width, hw).addScaledVector(face, ruffle);
      vert(c, u, row.vMid + vh, fl, b.phase);
      c.copy(p).addScaledVector(face, -0.012);
      vert(c, u, row.vMid, fl, b.phase);
      c.copy(p).addScaledVector(width, -hw).addScaledVector(face, -ruffle);
      vert(c, u, row.vMid - vh, fl, b.phase);
    }
    for (let i = 0; i < BLADE_T.length - 1; i++) {
      const r0 = base + i * 3;
      const r1 = r0 + 3;
      quad(r0, r0 + 1, r1 + 1, r1);
      quad(r0 + 1, r0 + 2, r1 + 2, r1 + 1);
    }
  }

  // Normalised height for the sway shader.
  let maxY = 0;
  for (let i = 1; i < pos.length; i += 3) maxY = Math.max(maxY, pos[i]);
  const sway = new Float32Array((pos.length / 3) * 3);
  for (let i = 0; i < pos.length / 3; i++) {
    sway[i * 3] = Math.max(0, pos[i * 3 + 1]) / maxY;
    sway[i * 3 + 1] = flutter[i];
    sway[i * 3 + 2] = phase[i];
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('aSway', new Float32BufferAttribute(sway, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
