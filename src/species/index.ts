import type { SpeciesDef } from '../core/types';
import { clownfish } from './clownfish';
import { kelp } from './kelp';

/** Every species the game ships. Add new animals/plants here. */
export const SPECIES: SpeciesDef[] = [clownfish, kelp];

const byId = new Map(SPECIES.map((s) => [s.id, s]));

export function getSpecies(id: string): SpeciesDef {
  const s = byId.get(id);
  if (!s) throw new Error(`Unknown species: ${id}`);
  return s;
}
