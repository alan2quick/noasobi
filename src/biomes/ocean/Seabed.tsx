import { useEffect, useMemo } from 'react';
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, MeshLambertMaterial } from 'three';
import { terrainHeight } from '../../core/terrain';
import { applyCaustics } from './caustics';
import { useQualityPreset } from '../../render/quality';

/**
 * Low-poly sand seabed from terrainHeight. 5 x 5 chunks of 96 m cover +-240 m (the world is
 * +-120 m) so the edge is always lost in fog. Inner chunks are 3 m cells, outer ones 8 m.
 * Each chunk has a skirt so resolution seams never show gaps. One shared material.
 */

const CHUNK = 96;
const GRID = 5;
const SKIRT = 2.5;

const SAND_LIGHT = new Color('#f1dfb0');
const SAND_MID = new Color('#e0c893');
const SAND_DARK = new Color('#b9a881');
const SAND_GREEN = new Color('#a9a77f');

function hash(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x: number, z: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

const _c = new Color();

function sandColor(x: number, z: number, h: number, out: number[], i: number) {
  const patch = smoothNoise(x / 13, z / 13);
  const fine = hash(Math.round(x * 2), Math.round(z * 2));
  _c.lerpColors(SAND_MID, SAND_LIGHT, Math.min(1, Math.max(0, (h + 1.5) / 4.5)));
  if (patch > 0.62) _c.lerp(SAND_GREEN, (patch - 0.62) * 1.1);
  if (h < -1.2) _c.lerp(SAND_DARK, Math.min(0.5, (-1.2 - h) * 0.4));
  const k = 0.96 + fine * 0.08;
  out[i] = _c.r * k;
  out[i + 1] = _c.g * k;
  out[i + 2] = _c.b * k;
}

function buildChunk(x0: number, z0: number, segs: number): BufferGeometry {
  const n = segs + 1;
  const step = CHUNK / segs;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      const h = terrainHeight(x, z);
      pos.push(x, h, z);
      sandColor(x, z, h, col, col.length);
    }
  }
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Alternate the diagonal for a less regular low-poly look.
      if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  }

  // Skirts: duplicate each border vertex lower down and stitch.
  const addSkirt = (border: number[], flip: boolean) => {
    const start = pos.length / 3;
    for (const v of border) {
      pos.push(pos[v * 3], pos[v * 3 + 1] - SKIRT, pos[v * 3 + 2]);
      col.push(col[v * 3] * 0.8, col[v * 3 + 1] * 0.8, col[v * 3 + 2] * 0.8);
    }
    for (let k = 0; k < border.length - 1; k++) {
      const a = border[k];
      const b = border[k + 1];
      const a2 = start + k;
      const b2 = start + k + 1;
      if (flip) idx.push(a, b, a2, b, b2, a2);
      else idx.push(a, a2, b, b, a2, b2);
    }
  };
  const north: number[] = [];
  const south: number[] = [];
  const west: number[] = [];
  const east: number[] = [];
  for (let i = 0; i < n; i++) {
    north.push(i);
    south.push(segs * n + i);
    west.push(i * n);
    east.push(i * n + segs);
  }
  addSkirt(north, false);
  addSkirt(south, true);
  addSkirt(west, true);
  addSkirt(east, false);

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function Seabed() {
  const { ripples } = useQualityPreset();

  const chunks = useMemo(() => {
    const list: BufferGeometry[] = [];
    const half = (GRID * CHUNK) / 2;
    for (let cz = 0; cz < GRID; cz++) {
      for (let cx = 0; cx < GRID; cx++) {
        const inner = cx > 0 && cx < GRID - 1 && cz > 0 && cz < GRID - 1;
        list.push(buildChunk(-half + cx * CHUNK, -half + cz * CHUNK, inner ? 32 : 12));
      }
    }
    return list;
  }, []);

  const material = useMemo(
    () =>
      applyCaustics(new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide }), {
        ripples,
      }),
    [ripples],
  );

  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => chunks.forEach((g) => g.dispose()), [chunks]);

  return (
    <group>
      {chunks.map((g, i) => (
        <mesh key={i} geometry={g} material={material} matrixAutoUpdate={false} />
      ))}
    </group>
  );
}
