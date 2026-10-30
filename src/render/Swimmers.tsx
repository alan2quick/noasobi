import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh } from 'three';
import type { Material } from 'three';
import { useApp } from '../core/store';
import { SPECIES, getSpecies } from '../species';
import { designTextures } from './designTextures';
import { createSwimMaterial } from './swimShader';
import { FishSim, fallbackLayer } from '../sim/fishSim';
import type { FishBatch } from '../sim/fishSim';
import { stepFood } from '../sim/food';
import { Food } from './Food';

/** One sim for every swimming fish in the world (module scope so camera/picking code can reach it). */
export const fishSim = new FishSim(getSpecies, fallbackLayer((id) => designTextures.layerOf(id)));

const SWIM_SPECIES = SPECIES.filter((s) => s.locomotion === 'swim-fish' && s.swim);

/**
 * All 'swim-fish' creatures: one InstancedMesh (one draw call) per species, animated in the
 * vertex shader from per-instance swim state the sim writes each frame. Also hosts the food flakes.
 */
export function Swimmers() {
  const entities = useApp((s) => s.entities);

  useEffect(() => {
    fishSim.sync(entities);
  }, [entities]);

  useEffect(() => designTextures.subscribe(() => fishSim.refreshLayers()), []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    stepFood(dt);
    const c = state.camera.position;
    fishSim.step(dt, c.x, c.y, c.z);
  });

  return (
    <>
      {SWIM_SPECIES.map((s) => (
        <FishBatchMesh key={s.id} batch={fishSim.batchFor(s)} />
      ))}
      <Food />
    </>
  );
}

function bind(mesh: InstancedMesh, batch: FishBatch) {
  const g = mesh.geometry;
  mesh.instanceMatrix = new InstancedBufferAttribute(batch.matrices, 16).setUsage(DynamicDrawUsage);
  g.setAttribute('aSwim', new InstancedBufferAttribute(batch.swim, 4).setUsage(DynamicDrawUsage));
  g.setAttribute('aBend', new InstancedBufferAttribute(batch.bend, 1).setUsage(DynamicDrawUsage));
  g.setAttribute('aDesignLayer', new InstancedBufferAttribute(batch.layers, 1));
  batch.layersDirty = true;
}

function FishBatchMesh({ batch }: { batch: FishBatch }) {
  const mesh = useMemo(() => {
    const m = new InstancedMesh(batch.species.buildGeometry(), createSwimMaterial(batch.species.swim?.bodyWave), batch.capacity);
    // Fish roam the whole world, so a per-batch bounding sphere would almost never cull anything;
    // skipping the test also saves recomputing the sphere every frame.
    m.frustumCulled = false;
    m.name = `swimmers:${batch.species.id}`;
    bind(m, batch);
    (m.userData as { generation: number }).generation = batch.generation;
    return m;
  }, [batch]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as Material).dispose();
    },
    [mesh],
  );

  useFrame(() => {
    const ud = mesh.userData as { generation: number };
    if (ud.generation !== batch.generation) {
      bind(mesh, batch);
      ud.generation = batch.generation;
    }
    const n = batch.count;
    mesh.count = n;
    if (n === 0) return;
    // Upload only the live part of the buffers. The sim writes after this callback but before
    // the render, which is when the upload happens.
    const im = mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, n * 16);
    im.needsUpdate = true;
    const swim = mesh.geometry.getAttribute('aSwim') as InstancedBufferAttribute;
    swim.clearUpdateRanges();
    swim.addUpdateRange(0, n * 4);
    swim.needsUpdate = true;
    const bend = mesh.geometry.getAttribute('aBend') as InstancedBufferAttribute;
    bend.clearUpdateRanges();
    bend.addUpdateRange(0, n);
    bend.needsUpdate = true;
    if (batch.layersDirty) {
      batch.layersDirty = false;
      (mesh.geometry.getAttribute('aDesignLayer') as InstancedBufferAttribute).needsUpdate = true;
    }
  });

  return <primitive object={mesh} />;
}
