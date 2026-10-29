import type { BiomeId, DesignMeta, PlacedEntity, WorldState } from '../types';

/**
 * Pure (DOM-free) validation for everything read back from storage. Stored data may come from an
 * older or newer app version, or be partly corrupt, so every reader goes through these and
 * drops what it cannot trust instead of crashing.
 */

export const WORLD_VERSION = 1;

/** What is actually written for a world (WorldState plus a format version). */
export interface StoredWorld extends WorldState {
  version: number;
  savedAt: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum);

const BIOMES: BiomeId[] = ['ocean', 'terrarium', 'zoo', 'preserve'];
const MAX_NAME = 40;

export function cleanName(name: unknown, fallback: string): string {
  if (typeof name !== 'string') return fallback;
  const t = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return t || fallback;
}

/** Returns a clean copy of an entity, or null if it is unusable. Unknown species are kept. */
export function parseEntity(raw: unknown): PlacedEntity | null {
  if (!isObj(raw)) return null;
  const { id, speciesId, designId, name, position, rotationY, scale } = raw;
  if (!isStr(id) || !isStr(speciesId) || !isVec3(position)) return null;
  return {
    id,
    speciesId,
    designId: isStr(designId) ? designId : `template:${speciesId}`,
    name: cleanName(name, speciesId),
    position: [position[0], position[1], position[2]],
    rotationY: isNum(rotationY) ? rotationY : 0,
    scale: isNum(scale) && scale > 0 ? scale : 1,
  };
}

export function parseDesignMeta(raw: unknown): DesignMeta | null {
  if (!isObj(raw)) return null;
  const { id, speciesId, name, createdAt, updatedAt, thumbnail } = raw;
  if (!isStr(id) || !isStr(speciesId)) return null;
  const now = Date.now();
  return {
    id,
    speciesId,
    name: cleanName(name, speciesId),
    createdAt: isNum(createdAt) ? createdAt : now,
    updatedAt: isNum(updatedAt) ? updatedAt : isNum(createdAt) ? createdAt : now,
    thumbnail: typeof thumbnail === 'string' ? thumbnail : '',
  };
}

/** Builds the record written for a world. */
export function serializeWorld(world: WorldState, savedAt = Date.now()): StoredWorld {
  return {
    version: WORLD_VERSION,
    savedAt,
    biome: world.biome,
    entities: world.entities.map((e) => ({
      id: e.id,
      speciesId: e.speciesId,
      designId: e.designId,
      name: e.name,
      position: [e.position[0], e.position[1], e.position[2]],
      rotationY: e.rotationY,
      scale: e.scale,
    })),
    timeOfDay: world.timeOfDay,
    ...(world.camera
      ? { camera: { position: [...world.camera.position], target: [...world.camera.target] } as WorldState['camera'] }
      : {}),
  };
}

/** Validates a stored world. Returns undefined when nothing usable is there. */
export function parseWorld(raw: unknown, biome: BiomeId): WorldState | undefined {
  if (!isObj(raw)) return undefined;
  const b = BIOMES.includes(raw.biome as BiomeId) ? (raw.biome as BiomeId) : biome;
  if (b !== biome) return undefined;
  const list = Array.isArray(raw.entities) ? raw.entities : [];
  const seen = new Set<string>();
  const entities: PlacedEntity[] = [];
  for (const r of list) {
    const e = parseEntity(r);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    entities.push(e);
  }
  const t = !isNum(raw.timeOfDay) ? 0.35 : raw.timeOfDay >= 0 && raw.timeOfDay < 1 ? raw.timeOfDay : ((raw.timeOfDay % 1) + 1) % 1;
  const cam = isObj(raw.camera) && isVec3(raw.camera.position) && isVec3(raw.camera.target) ? raw.camera : undefined;
  return {
    biome,
    entities,
    timeOfDay: t,
    ...(cam
      ? {
          camera: {
            position: [...(cam.position as number[])] as [number, number, number],
            target: [...(cam.target as number[])] as [number, number, number],
          },
        }
      : {}),
  };
}

/** Diff helper for design sync: which designs need writing and which need deleting. */
export function diffDesigns(
  current: Record<string, DesignMeta>,
  persisted: Map<string, number>,
): { save: DesignMeta[]; remove: string[] } {
  const save: DesignMeta[] = [];
  const remove: string[] = [];
  for (const id in current) {
    const m = current[id];
    if (persisted.get(id) !== m.updatedAt) save.push(m);
  }
  for (const id of persisted.keys()) if (!(id in current)) remove.push(id);
  return { save, remove };
}
