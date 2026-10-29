import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
} from 'three';
import { applyCaustics } from './caustics';
import { oceanLayout } from './layout';
import { mulberry } from './layout';

/** Low-poly rock clusters: two instanced geometries (boulders, pebbles) sharing one material. */

const STONE_A = new Color('#8d8a85');
const STONE_B = new Color('#a39177');
const MOSS = new Color('#6f8f4c');

function rockGeometry(detail: number, seed: number): BufferGeometry {
  const g = new IcosahedronGeometry(1, detail);
  const pos = g.getAttribute('position');
  const rand = mulberry(seed);
  // Same displacement for vertices that share a position (the geometry is non-indexed).
  const disp = new Map<string, number>();
  const col: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let d = disp.get(key);
    if (d === undefined) {
      d = 0.78 + rand() * 0.38;
      disp.set(key, d);
    }
    // Flatter underside so rocks sit on the sand.
    const yy = y < 0 ? y * 0.55 : y;
    pos.setXYZ(i, x * d, yy * d, z * d);
  }
  pos.needsUpdate = true;
  // Per-face colours: moss on top-facing faces.
  const c = new Color();
  for (let f = 0; f < pos.count; f += 3) {
    const cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
    c.lerpColors(STONE_A, STONE_B, rand());
    if (cy > 0.45) c.lerp(MOSS, Math.min(0.75, (cy - 0.45) * 1.6));
    const k = 0.9 + rand() * 0.15;
    for (let v = 0; v < 3; v++) col.push(c.r * k, c.g * k, c.b * k);
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return g;
}

export function Rocks() {
  const boulders = useRef<InstancedMesh>(null);
  const pebbles = useRef<InstancedMesh>(null);

  const { boulderGeo, pebbleGeo, material, counts } = useMemo(() => {
    const counts = [0, 0];
    for (const r of oceanLayout.rocks) counts[r.variant]++;
    return {
      boulderGeo: rockGeometry(1, 11),
      pebbleGeo: rockGeometry(0, 23),
      material: applyCaustics(new MeshLambertMaterial({ vertexColors: true, flatShading: true }), {
        strength: 0.85,
      }),
      counts,
    };
  }, []);

  useLayoutEffect(() => {
    const dummy = new Object3D();
    const tint = new Color();
    const idx = [0, 0];
    const meshes = [boulders.current, pebbles.current];
    for (const r of oceanLayout.rocks) {
      const mesh = meshes[r.variant];
      if (!mesh) continue;
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(r.rx, r.ry, r.rz);
      dummy.scale.set(r.sx, r.sy, r.sz);
      dummy.updateMatrix();
      const i = idx[r.variant]++;
      mesh.setMatrixAt(i, dummy.matrix);
      tint.setRGB(0.85 + r.tint * 0.25, 0.85 + r.tint * 0.2, 0.85 + (1 - r.tint) * 0.2);
      mesh.setColorAt(i, tint);
    }
    for (const m of meshes) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, []);

  useEffect(
    () => () => {
      boulderGeo.dispose();
      pebbleGeo.dispose();
      material.dispose();
    },
    [boulderGeo, pebbleGeo, material],
  );

  return (
    <>
      <instancedMesh ref={boulders} args={[boulderGeo, material, counts[0]]} matrixAutoUpdate={false} />
      <instancedMesh ref={pebbles} args={[pebbleGeo, material, counts[1]]} matrixAutoUpdate={false} />
    </>
  );
}
