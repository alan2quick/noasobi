import { Vector3 } from 'three';
import type { PlacedEntity, SpeciesDef } from '../../core/types';
import { templateDesignId } from '../../core/types';
import { SURFACE_Y, terrainHeight } from '../../core/terrain';

/**
 * Generic placement rules (any species, any biome): where something sits relative to the ground
 * and how a new entity is rolled. Pure functions so they can be tested.
 */

/** True for things that move around (their anchor floats in their habitat band). */
export function isMobile(species: SpeciesDef): boolean {
  return species.kind === 'creature';
}

/** Height above the ground for an anchor; `t` in 0..1 picks a spot in the habitat band. */
export function habitatHeight(species: SpeciesDef, t = 0.5): number {
  if (!isMobile(species)) return 0;
  const { heightMin, heightMax } = species.habitat;
  return heightMin + (heightMax - heightMin) * Math.min(1, Math.max(0, t));
}

/** Anchor point for `species` above ground point (x, z). Writes into `out`. */
export function anchorAt(species: SpeciesDef, x: number, z: number, t: number, out: Vector3): Vector3 {
  const ground = terrainHeight(x, z);
  const y = Math.min(SURFACE_Y - 1, ground + habitatHeight(species, t));
  return out.set(x, y, z);
}

/** Model units to metres: swimmer meshes are 1 unit long and scaled to their body length. */
export function modelUnit(species: SpeciesDef): number {
  return species.swim?.bodyLength ?? 1;
}

export function midScale(species: SpeciesDef): number {
  return (species.scaleRange[0] + species.scaleRange[1]) / 2;
}

/** Rolls a new entity of `species` with `designId` at ground point (x, z). */
export function rollEntity(
  species: SpeciesDef,
  designId: string,
  name: string,
  x: number,
  z: number,
  rand: () => number = Math.random,
): Omit<PlacedEntity, 'id'> {
  const p = anchorAt(species, x, z, rand(), new Vector3());
  const [s0, s1] = species.scaleRange;
  return {
    speciesId: species.id,
    designId: designId || templateDesignId(species.id),
    name,
    position: [p.x, p.y, p.z],
    rotationY: rand() * Math.PI * 2,
    scale: s0 + (s1 - s0) * rand(),
  };
}
