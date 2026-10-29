import type { BiomeId, DesignMeta, StorageAdapter, WorldState } from '../types';

/**
 * In-memory StorageAdapter: used when IndexedDB is unavailable (private mode, blocked storage)
 * and by tests. Data lives until the page closes.
 */
export class MemoryAdapter implements StorageAdapter {
  readonly persistent = false;
  private designs = new Map<string, { meta: DesignMeta; texture: Blob }>();
  private worlds = new Map<BiomeId, WorldState>();
  private settings = new Map<string, unknown>();

  async listDesigns() {
    return [...this.designs.values()].map((d) => d.meta);
  }
  async loadDesignTexture(id: string) {
    return this.designs.get(id)?.texture;
  }
  async saveDesign(meta: DesignMeta, texture: Blob) {
    this.designs.set(meta.id, { meta: { ...meta }, texture });
  }
  async deleteDesign(id: string) {
    this.designs.delete(id);
  }
  async loadWorld(biome: BiomeId) {
    const w = this.worlds.get(biome);
    return w ? structuredCloneSafe(w) : undefined;
  }
  async saveWorld(world: WorldState) {
    this.worlds.set(world.biome, structuredCloneSafe(world));
  }
  async loadSettings<T>(key: string) {
    return this.settings.get(key) as T | undefined;
  }
  async saveSettings<T>(key: string, value: T) {
    this.settings.set(key, value);
  }
}

function structuredCloneSafe<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
}
