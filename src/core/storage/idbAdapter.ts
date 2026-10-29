import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval';
import type { BiomeId, DesignMeta, StorageAdapter, WorldState } from '../types';
import { parseDesignMeta, parseWorld, serializeWorld } from './serialize';

/**
 * IndexedDB StorageAdapter on idb-keyval. One small database per kind (idb-keyval's createStore
 * owns a single object store per database):
 *   noasobi-designs   design id -> DesignMeta
 *   noasobi-textures  design id -> PNG Blob (DESIGN_TEX_WIDTH x DESIGN_TEX_HEIGHT)
 *   noasobi-worlds    biome id  -> StoredWorld
 *   noasobi-settings  key       -> value
 */
export class IdbAdapter implements StorageAdapter {
  readonly persistent = true;
  private metas: UseStore;
  private textures: UseStore;
  private worlds: UseStore;
  private settings: UseStore;

  constructor(prefix = 'noasobi') {
    this.metas = createStore(`${prefix}-designs`, 'kv');
    this.textures = createStore(`${prefix}-textures`, 'kv');
    this.worlds = createStore(`${prefix}-worlds`, 'kv');
    this.settings = createStore(`${prefix}-settings`, 'kv');
  }

  async listDesigns(): Promise<DesignMeta[]> {
    const all = await entries(this.metas);
    const out: DesignMeta[] = [];
    for (const [, v] of all) {
      const m = parseDesignMeta(v);
      if (m) out.push(m);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  async loadDesignTexture(id: string): Promise<Blob | undefined> {
    const v = await get(id, this.textures);
    return v instanceof Blob ? v : undefined;
  }

  async saveDesign(meta: DesignMeta, texture: Blob): Promise<void> {
    // Texture first so a meta never points at a missing image.
    await set(meta.id, texture, this.textures);
    await set(meta.id, { ...meta }, this.metas);
  }

  async deleteDesign(id: string): Promise<void> {
    await del(id, this.metas);
    await del(id, this.textures);
  }

  async loadWorld(biome: BiomeId): Promise<WorldState | undefined> {
    return parseWorld(await get(biome, this.worlds), biome);
  }

  async saveWorld(world: WorldState): Promise<void> {
    await set(world.biome, serializeWorld(world), this.worlds);
  }

  async loadSettings<T>(key: string): Promise<T | undefined> {
    return (await get(key, this.settings)) as T | undefined;
  }

  async saveSettings<T>(key: string, value: T): Promise<void> {
    await set(key, value, this.settings);
  }
}

/** True when IndexedDB opens and round-trips a value within `timeoutMs`. */
export async function idbWorks(timeoutMs = 2500): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  try {
    const probe = createStore('noasobi-settings', 'kv');
    const ok = (async () => {
      await set('__probe', 1, probe);
      const back = await get('__probe', probe);
      await del('__probe', probe);
      return back === 1;
    })();
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
    return await Promise.race([ok, timeout]);
  } catch {
    return false;
  }
}
