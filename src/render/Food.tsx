import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { DynamicDrawUsage, IcosahedronGeometry, InstancedMesh, MeshLambertMaterial, Object3D, Vector3 } from 'three';
import { runtime } from '../core/runtime';
import { MAX_FLAKES, flakeFade, spawnFood } from '../sim/food';
import type { Flake } from '../sim/food';

const FLAKE_SIZE = 0.035;

/**
 * Food flakes, one instanced draw. Stepping happens in Swimmers (before the fish sim) so fish see
 * this frame's flakes; this component only renders them.
 */
export function Food() {
  const camera = useThree((s) => s.camera);
  const mesh = useMemo(() => {
    const geo = new IcosahedronGeometry(1, 0);
    geo.scale(1, 0.35, 0.8); // a flat flake
    const mat = new MeshLambertMaterial({ color: '#d9893a', emissive: '#4a2208' });
    const m = new InstancedMesh(geo, mat, MAX_FLAKES);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.name = 'food';
    return m;
  }, []);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as MeshLambertMaterial).dispose();
    },
    [mesh],
  );

  // Dev hook: window.__spawnFood() drops food in front of the camera; or pass a point and count.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __spawnFood?: (p?: { x: number; y: number; z: number } | number[], count?: number) => number };
    w.__spawnFood = (p, count = 12) => {
      const v = new Vector3();
      if (Array.isArray(p)) v.set(p[0], p[1], p[2]);
      else if (p) v.set(p.x, p.y, p.z);
      else camera.getWorldDirection(v).multiplyScalar(5).add(camera.position);
      return spawnFood(v, count);
    };
    return () => {
      delete w.__spawnFood;
    };
  }, [camera]);

  const dummy = useMemo(() => new Object3D(), []);
  useFrame((state) => {
    const list = runtime.food as Flake[];
    const t = state.clock.elapsedTime;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (!f.alive) continue;
      const s = FLAKE_SIZE * flakeFade(f);
      dummy.position.copy(f.position);
      if (f.rest < 0) dummy.rotation.set(t * 1.3 + f.phase, f.phase * 3 + t * 0.7, Math.sin(t * 2 + f.phase) * 0.6);
      else dummy.rotation.set(0, f.phase * 3, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(n++, dummy.matrix);
    }
    mesh.count = n;
    if (n > 0) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return <primitive object={mesh} />;
}
