import { BufferGeometry, Float32BufferAttribute, Sphere, Vector3 } from 'three';
import {
  ANAL_EDGE,
  CAUDAL_COLS,
  CAUDAL_ROWS,
  DORSAL_EDGE,
  EYE,
  NOSE_X,
  PECTORAL_BASE,
  PECTORAL_ISLAND,
  PECTORAL_LEN,
  PECTORAL_OUTLINE,
  PELVIC_BASE,
  PELVIC_ISLAND,
  PELVIC_LEN,
  PELVIC_OUTLINE,
  PEDUNCLE_X,
  BODY_LEN,
  PROFILE_BOT,
  PROFILE_HW,
  PROFILE_T,
  PROFILE_TOP,
  SECTION_Y_EXP,
  SECTION_Z_EXP,
  bodyBot,
  bodyTop,
  caudalPoint,
  islandPoint,
  planarUV,
  surfaceZ,
} from './layout';

/**
 * Procedural low-poly clownfish (~670 triangles), built for the left half (z <= 0) and mirrored.
 *
 * Vertex attributes (besides position/normal/uv):
 *  - aSpine (float): 0 at the nose .. 1 at the caudal tip (= 0.5 - x), drives the body wave.
 *  - aPec   (float): paired-fin flutter weight. side * (distance from hinge / fin length);
 *                    side = -1 left fin, +1 right fin, 0 everywhere else.
 *  - aEye   (vec3) : (isEye, ex, ey). Eye-local disc coords in [-1, 1] (ex forward, ey up).
 *
 * Eyes are separate little domes coloured procedurally in the fragment shader from aEye rather
 * than painted into the design texture. That keeps them eyes whatever a child paints (a fish
 * without eyes stops reading as a fish), keeps them crisp at the half-resolution in-world texture,
 * costs no extra draw call, and lets them catch an emissive highlight so the fish looks alive.
 */

type Group = 0 | 1 | 2; // body, fin, eye

class MeshBuilder {
  pos: number[] = [];
  uv: number[] = [];
  spine: number[] = [];
  pec: number[] = [];
  eye: number[] = [];
  group: Group[] = [];
  idx: number[] = [];
  private tmpUv: [number, number] = [0, 0];

  /** Adds a left-side vertex; uv comes from the planar projection of (uvX, uvY). */
  v(x: number, y: number, z: number, group: Group, uvX = x, uvY = y, pec = 0, eye: [number, number, number] = [0, 0, 0]) {
    planarUV(uvX, uvY, -1, this.tmpUv);
    this.pos.push(x, y, z);
    this.uv.push(this.tmpUv[0], this.tmpUv[1]);
    this.spine.push(Math.min(1, Math.max(0, NOSE_X - x)));
    this.pec.push(pec);
    this.eye.push(eye[0], eye[1], eye[2]);
    this.group.push(group);
    return this.group.length - 1;
  }

  /** Triangle wound so its normal faces along the hint direction. */
  tri(a: number, b: number, c: number, hx: number, hy: number, hz: number) {
    const p = this.pos;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
    const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    if (nx * hx + ny * hy + nz * hz >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  /** Body triangle oriented away from the fish's long axis. */
  bodyTri(a: number, b: number, c: number) {
    const p = this.pos;
    const cx = (p[a * 3] + p[b * 3] + p[c * 3]) / 3;
    const cy = (p[a * 3 + 1] + p[b * 3 + 1] + p[c * 3 + 1]) / 3;
    const cz = (p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2]) / 3;
    const ax = Math.min(0.3, Math.max(-0.2, cx));
    this.tri(a, b, c, cx - ax, cy, cz);
  }

  build(): BufferGeometry {
    const n = this.group.length;
    // Area-weighted vertex normals on the left half.
    const nrm = new Float32Array(n * 3);
    const p = this.pos;
    for (let t = 0; t < this.idx.length; t += 3) {
      const a = this.idx[t], b = this.idx[t + 1], c = this.idx[t + 2];
      const e1x = p[b * 3] - p[a * 3], e1y = p[b * 3 + 1] - p[a * 3 + 1], e1z = p[b * 3 + 2] - p[a * 3 + 2];
      const e2x = p[c * 3] - p[a * 3], e2y = p[c * 3 + 1] - p[a * 3 + 1], e2z = p[c * 3 + 2] - p[a * 3 + 2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      for (const v of [a, b, c]) {
        nrm[v * 3] += nx;
        nrm[v * 3 + 1] += ny;
        nrm[v * 3 + 2] += nz;
      }
    }
    for (let i = 0; i < n; i++) {
      // Body seam vertices lie on the mid-plane: the mirrored half contributes the opposite z, so
      // the smooth normal across the seam has z = 0.
      if (this.group[i] === 0 && Math.abs(p[i * 3 + 2]) < 1e-6) nrm[i * 3 + 2] = 0;
      const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
      nrm[i * 3] /= l;
      nrm[i * 3 + 1] /= l;
      nrm[i * 3 + 2] /= l;
    }

    // Mirror to the right half: z → -z, u → 1 - u, fin side flips, winding reverses.
    const position = new Float32Array(n * 6);
    const normal = new Float32Array(n * 6);
    const uv = new Float32Array(n * 4);
    const spine = new Float32Array(n * 2);
    const pec = new Float32Array(n * 2);
    const eye = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        position[i * 3 + k] = p[i * 3 + k];
        normal[i * 3 + k] = nrm[i * 3 + k];
        position[(n + i) * 3 + k] = k === 2 ? -p[i * 3 + k] : p[i * 3 + k];
        normal[(n + i) * 3 + k] = k === 2 ? -nrm[i * 3 + k] : nrm[i * 3 + k];
        eye[i * 3 + k] = this.eye[i * 3 + k];
        eye[(n + i) * 3 + k] = this.eye[i * 3 + k];
      }
      uv[i * 2] = this.uv[i * 2];
      uv[i * 2 + 1] = this.uv[i * 2 + 1];
      uv[(n + i) * 2] = 1 - this.uv[i * 2];
      uv[(n + i) * 2 + 1] = this.uv[i * 2 + 1];
      spine[i] = spine[n + i] = this.spine[i];
      pec[i] = this.pec[i];
      pec[n + i] = -this.pec[i];
    }
    const index: number[] = this.idx.slice();
    for (let t = 0; t < this.idx.length; t += 3) index.push(this.idx[t] + n, this.idx[t + 2] + n, this.idx[t + 1] + n);

    const g = new BufferGeometry();
    g.setIndex(index);
    g.setAttribute('position', new Float32BufferAttribute(position, 3));
    g.setAttribute('normal', new Float32BufferAttribute(normal, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setAttribute('aSpine', new Float32BufferAttribute(spine, 1));
    g.setAttribute('aPec', new Float32BufferAttribute(pec, 1));
    g.setAttribute('aEye', new Float32BufferAttribute(eye, 3));
    g.computeBoundingBox();
    // Generous sphere: covers the swim wave and fin flutter.
    g.boundingSphere = new Sphere(new Vector3(0, 0, 0), 0.62);
    return g;
  }
}

const SEGS = 8; // segments per half ring (top → bottom)

function sectionPoint(top: number, bot: number, hw: number, theta: number): [number, number] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const mid = (top + bot) / 2;
  const half = (top - bot) / 2;
  const y = mid + half * Math.sign(c) * Math.pow(Math.abs(c), SECTION_Y_EXP);
  const z = -hw * Math.pow(Math.abs(s), SECTION_Z_EXP);
  return [y, z];
}

function buildBody(m: MeshBuilder) {
  const rings: number[][] = [];
  for (let k = 1; k < PROFILE_T.length; k++) {
    const x = NOSE_X - PROFILE_T[k] * BODY_LEN;
    const ring: number[] = [];
    for (let j = 0; j <= SEGS; j++) {
      const [y, z] = sectionPoint(PROFILE_TOP[k], PROFILE_BOT[k], PROFILE_HW[k], (j / SEGS) * Math.PI);
      ring.push(m.v(x, y, z, 0));
    }
    rings.push(ring);
  }
  // Blunt rounded snout: fan to the nose tip.
  const nose = m.v(NOSE_X, PROFILE_BOT[0] * 0.5 + PROFILE_TOP[0] * 0.5, 0, 0);
  for (let j = 0; j < SEGS; j++) m.bodyTri(nose, rings[0][j], rings[0][j + 1]);
  for (let k = 0; k < rings.length - 1; k++) {
    const r0 = rings[k];
    const r1 = rings[k + 1];
    for (let j = 0; j < SEGS; j++) {
      m.bodyTri(r0[j], r1[j], r1[j + 1]);
      m.bodyTri(r0[j], r1[j + 1], r0[j + 1]);
    }
  }
  // Close the peduncle (hidden by the caudal fin root).
  const last = rings[rings.length - 1];
  const capX = PEDUNCLE_X - 0.006;
  const cap = m.v(capX, (bodyTop(PEDUNCLE_X) + bodyBot(PEDUNCLE_X)) / 2, 0, 0);
  for (let j = 0; j < SEGS; j++) m.bodyTri(cap, last[j + 1], last[j]);
}

/** Median fin strip: base along the body outline, edge offset vertically by the edge table. */
function buildMedianFin(m: MeshBuilder, edge: [number, number][], dir: 1 | -1) {
  const base: number[] = [];
  const tip: number[] = [];
  for (const [x, h] of edge) {
    const y0 = dir > 0 ? bodyTop(x) - 0.008 : bodyBot(x) + 0.008;
    const y1 = dir > 0 ? bodyTop(x) + h : bodyBot(x) - h;
    base.push(m.v(x, y0, 0, 1));
    tip.push(m.v(x, h < 1e-4 ? y0 : y1, 0, 1));
  }
  for (let i = 0; i < edge.length - 1; i++) {
    m.tri(base[i], base[i + 1], tip[i + 1], 0, 0, -1);
    m.tri(base[i], tip[i + 1], tip[i], 0, 0, -1);
  }
}

function buildCaudal(m: MeshBuilder) {
  const grid: number[][] = [];
  const pt: [number, number] = [0, 0];
  for (const a of CAUDAL_COLS) {
    const col: number[] = [];
    for (let r = 0; r <= CAUDAL_ROWS; r++) {
      caudalPoint(a, (r / CAUDAL_ROWS) * 2 - 1, pt);
      col.push(m.v(pt[0], pt[1], 0, 1));
    }
    grid.push(col);
  }
  for (let c = 0; c < grid.length - 1; c++) {
    for (let r = 0; r < CAUDAL_ROWS; r++) {
      m.tri(grid[c][r], grid[c + 1][r], grid[c + 1][r + 1], 0, 0, -1);
      m.tri(grid[c][r], grid[c + 1][r + 1], grid[c][r + 1], 0, 0, -1);
    }
  }
}

function norm3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: number[], b: number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Paired fin: two-faced fan around its hinge, uv from its island. */
function buildPairedFin(
  m: MeshBuilder,
  base: [number, number, number],
  along: [number, number, number],
  upHint: [number, number, number],
  outline: [number, number][],
  length: number,
  island: { x: number; y: number },
) {
  const A = norm3(along);
  // Across axis: perpendicular to A, as close to upHint as possible.
  const N = norm3(cross(A, upHint));
  const B = norm3(cross(N, A));
  // Fin normal facing away from the body (left side → -z).
  const out: [number, number, number] = N[2] < 0 ? N : [-N[0], -N[1], -N[2]];
  for (const face of [1, -1]) {
    const pt = (l: number, w: number) => {
      const [ux, uy] = islandPoint(island, l, w);
      return m.v(
        base[0] + A[0] * l + B[0] * w,
        base[1] + A[1] * l + B[1] * w,
        base[2] + A[2] * l + B[2] * w,
        1,
        ux,
        uy,
        -(l / length), // left fin: side -1
      );
    };
    const hub = pt(0, 0);
    const ring = outline.map(([l, w]) => pt(l, w));
    for (let i = 0; i < ring.length - 1; i++) m.tri(hub, ring[i], ring[i + 1], out[0] * face, out[1] * face, out[2] * face);
  }
}

function buildEye(m: MeshBuilder) {
  const zSurf = -surfaceZ(EYE.x, EYE.y);
  const n = norm3([0.22, 0.1, -1]);
  // ex: forward projected on the eye plane; ey: up on the eye plane.
  const ex = norm3([1 - n[0] * n[0], -n[0] * n[1], -n[0] * n[2]]);
  let ey = cross(n, ex);
  if (ey[1] < 0) ey = [-ey[0], -ey[1], -ey[2]];
  const r = EYE.r;
  const c0: [number, number, number] = [EYE.x, EYE.y, zSurf];
  const at = (lx: number, ly: number, lift: number) =>
    m.v(
      c0[0] + ex[0] * lx * r + ey[0] * ly * r + n[0] * lift,
      c0[1] + ex[1] * lx * r + ey[1] * ly * r + n[1] * lift,
      c0[2] + ex[2] * lx * r + ey[2] * ly * r + n[2] * lift,
      2,
      EYE.x,
      EYE.y,
      0,
      [1, lx, ly],
    );
  const SEG = 10;
  const center = at(0, 0, 0.014);
  const mid: number[] = [];
  const rim: number[] = [];
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    mid.push(at(Math.cos(a) * 0.65, Math.sin(a) * 0.65, 0.009));
    rim.push(at(Math.cos(a), Math.sin(a), -0.004));
  }
  for (let i = 0; i < SEG; i++) {
    const j = (i + 1) % SEG;
    m.tri(center, mid[i], mid[j], n[0], n[1], n[2]);
    m.tri(mid[i], rim[i], rim[j], n[0], n[1], n[2]);
    m.tri(mid[i], rim[j], mid[j], n[0], n[1], n[2]);
  }
}

export function buildClownfishGeometry(): BufferGeometry {
  const m = new MeshBuilder();
  buildBody(m);
  buildMedianFin(m, DORSAL_EDGE, 1);
  buildMedianFin(m, ANAL_EDGE, -1);
  buildCaudal(m);

  // Pectoral: hinged just behind the gill, angled back, down a touch and out from the flank.
  const px = PECTORAL_BASE.x;
  const py = PECTORAL_BASE.y;
  buildPairedFin(m, [px, py, -surfaceZ(px, py) + 0.004], [-1, -0.22, -0.42], [0, 1, 0], PECTORAL_OUTLINE, PECTORAL_LEN, PECTORAL_ISLAND);
  // Pelvic: under the throat, pointing back and down.
  const vx = PELVIC_BASE.x;
  const vy = bodyBot(vx) + 0.014;
  buildPairedFin(m, [vx, vy, -0.022], [-0.75, -0.62, -0.2], [0.6, 0.75, 0], PELVIC_OUTLINE, PELVIC_LEN * 2, PELVIC_ISLAND); // half flutter

  buildEye(m);
  return m.build();
}
