import type { BiomeId, SpeciesDef, SpeciesKind } from '../core/types';
import { SPECIES, getSpecies } from '../species';

/** Species lookups for the UI that never throw (saved worlds may contain unknown species). */
export function trySpecies(id: string): SpeciesDef | undefined {
  try {
    return getSpecies(id);
  } catch {
    return undefined;
  }
}

export function speciesFor(biome: BiomeId, kind: SpeciesKind): SpeciesDef[] {
  return SPECIES.filter((s) => s.kind === kind && s.biomes.includes(biome));
}

const heights = new Map<string, number>();

/** Model height in metres at scale 1 (for markers). Builds the geometry once per species. */
export function modelHeight(species: SpeciesDef): number {
  let h = heights.get(species.id);
  if (h === undefined) {
    const g = species.buildGeometry();
    g.computeBoundingBox();
    const unit = species.swim?.bodyLength ?? 1;
    h = Math.max(0.1, (g.boundingBox!.max.y - Math.min(0, g.boundingBox!.min.y)) * unit);
    g.dispose();
    heights.set(species.id, h);
  }
  return h;
}

export const ACTIVITY_ICON: Record<SpeciesDef['activity'], string> = {
  diurnal: '☀️',
  nocturnal: '🌙',
  crepuscular: '🌗',
  always: '🔁',
};

/** 0 = lives on the bottom .. 1 = high in the water (for the depth gauge icon). */
export function habitatLevel(species: SpeciesDef): number {
  if (species.kind !== 'creature') return 0;
  const mid = (species.habitat.heightMin + species.habitat.heightMax) / 2;
  return Math.min(1, mid / 12);
}
