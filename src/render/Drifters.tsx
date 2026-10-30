import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh } from 'three';
import type { Material } from 'three';
import { useApp } from '../core/store';
import { SPECIES, getSpecies } from '../species';
import { designTextures } from './designTextures';
import { createJellyMaterial } from './jellyShader';
import { JellySim, fallbackLayer } from '../sim/jellySim';
import type { JellyBatch } from '../sim/jellySim';

/** One sim for every drifting jelly in the world (module scope so camera/picking code can reach it). */
export const jellySim = new JellySim(getSpecies, fallbackLayer((id) => designTextures.layerOf(id)));

const JELLY_SPECIES = SPECIES.filter((s) => s.locomotion === 'swim-jelly' && s.drift);

/**
 * All 'swim-jelly' creatures: one InstancedMesh per species, animated in the vertex shader from
 * per-instance pulse state the sim writes each frame. Translucent (no depth writes), drawn after
 * the opaque world; three splits a transparent double-sided mesh into a back-face and a
 * front-face pass, so a species costs 2 draw calls however many jellies there are.
 */
export function Drifters() {
  const entities = useApp((s) => s.entities);

  const meshes = useMemo(
    () =>
      JELLY_SPECIES.map((def) => {
        const batch = jellySim.batchFor(def);
        const material = createJellyMaterial({ glow: def.drift!.nightGlow });
        const mesh = new InstancedMesh(def.buildGeometry(), material, batch.capacity);
        // Jellies roam the whole world, so a per-batch bounding sphere would never cull anything.
        mesh.frustumCulled = false;
        mesh.renderOrder = 4;
        mesh.name = `drifters:${def.id}`;
        mesh.count = 0;
        bind(mesh, batch);
        (mesh.userData as { generation: number }).generation = batch.generation;
        return { batch, mesh };
      }),
    [],
  );

  useEffect(
    () => () => {
      for (const { mesh } of meshes) {
        mesh.geometry.dispose();
        (mesh.material as Material).dispose();
        mesh.dispose();
      }
    },
    [meshes],
  );

  // Dev handle for poking at the sim from the console.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __noasobi?: Record<string, unknown> };
    if (w.__noasobi) w.__noasobi.jellySim = jellySim;
  }, []);

  useEffect(() => {
    jellySim.sync(entities);
  }, [entities]);

  useEffect(() => designTextures.subscribe(() => jellySim.refreshLayers()), []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const c = state.camera.position;
    jellySim.step(dt, c.x, c.y, c.z);
    for (const { batch, mesh } of meshes) upload(mesh, batch);
  });

  return (
    <>
      {meshes.map(({ mesh }) => (
        <primitive key={mesh.name} object={mesh} />
      ))}
    </>
  );
}

function bind(mesh: InstancedMesh, batch: JellyBatch) {
  const g = mesh.geometry;
  mesh.instanceMatrix = new InstancedBufferAttribute(batch.matrices, 16).setUsage(DynamicDrawUsage);
  g.setAttribute('aPulse', new InstancedBufferAttribute(batch.pulse, 4).setUsage(DynamicDrawUsage));
  g.setAttribute('aVel', new InstancedBufferAttribute(batch.vel, 3).setUsage(DynamicDrawUsage));
  g.setAttribute('aDesignLayer', new InstancedBufferAttribute(batch.layers, 1));
  batch.layersDirty = true;
}

function upload(mesh: InstancedMesh, batch: JellyBatch) {
  const ud = mesh.userData as { generation: number };
  if (ud.generation !== batch.generation) {
    bind(mesh, batch);
    ud.generation = batch.generation;
  }
  const n = batch.count;
  mesh.count = n;
  if (n === 0) return;
  // Upload only the live part of the buffers; the sim has just written them.
  const im = mesh.instanceMatrix;
  im.clearUpdateRanges();
  im.addUpdateRange(0, n * 16);
  im.needsUpdate = true;
  const pulse = mesh.geometry.getAttribute('aPulse') as InstancedBufferAttribute;
  pulse.clearUpdateRanges();
  pulse.addUpdateRange(0, n * 4);
  pulse.needsUpdate = true;
  const vel = mesh.geometry.getAttribute('aVel') as InstancedBufferAttribute;
  vel.clearUpdateRanges();
  vel.addUpdateRange(0, n * 3);
  vel.needsUpdate = true;
  if (batch.layersDirty) {
    batch.layersDirty = false;
    (mesh.geometry.getAttribute('aDesignLayer') as InstancedBufferAttribute).needsUpdate = true;
  }
}
