import { describe, expect, it } from 'vitest';
import type { DesignMeta, PlacedEntity, WorldState } from '../types';
import { cleanName, diffDesigns, parseDesignMeta, parseEntity, parseWorld, serializeWorld, WORLD_VERSION } from './serialize';
import { MemoryAdapter } from './memoryAdapter';

const ent = (id: string, extra: Partial<PlacedEntity> = {}): PlacedEntity => ({
  id,
  speciesId: 'clownfish',
  designId: 'template:clownfish',
  name: 'Nemo',
  position: [1, 2, 3],
  rotationY: 0.5,
  scale: 1.1,
  ...extra,
});

const meta = (id: string, updatedAt = 1): DesignMeta => ({
  id,
  speciesId: 'clownfish',
  name: 'Stripy',
  createdAt: 1,
  updatedAt,
  thumbnail: 'data:image/png;base64,AAAA',
});

describe('world serialization', () => {
  it('round-trips through JSON', () => {
    const world: WorldState = {
      biome: 'ocean',
      entities: [ent('a'), ent('b', { name: 'Dory', designId: 'design_1' })],
      timeOfDay: 0.6,
      camera: { position: [0, 6, 18], target: [0, 3, -12] },
    };
    const stored = serializeWorld(world, 123);
    expect(stored.version).toBe(WORLD_VERSION);
    expect(stored.savedAt).toBe(123);
    const back = parseWorld(JSON.parse(JSON.stringify(stored)), 'ocean');
    expect(back).toEqual(world);
  });

  it('does not alias the live entity arrays', () => {
    const e = ent('a');
    const stored = serializeWorld({ biome: 'ocean', entities: [e], timeOfDay: 0 });
    expect(stored.entities[0]).not.toBe(e);
    expect(stored.entities[0].position).not.toBe(e.position);
  });

  it('drops malformed and duplicate entities but keeps unknown species', () => {
    const back = parseWorld(
      {
        biome: 'ocean',
        timeOfDay: 1.25,
        entities: [ent('a'), ent('a'), { id: 'x' }, null, ent('c', { speciesId: 'future-squid' }), ent('d', { position: [1, NaN, 2] })],
      },
      'ocean',
    )!;
    expect(back.entities.map((e) => e.id)).toEqual(['a', 'c']);
    expect(back.timeOfDay).toBeCloseTo(0.25, 6);
    expect(back.camera).toBeUndefined();
  });

  it('fills defaults for missing optional fields', () => {
    const e = parseEntity({ id: 'q', speciesId: 'kelp', position: [0, 0, 0] })!;
    expect(e.designId).toBe('template:kelp');
    expect(e.name).toBe('kelp');
    expect(e.scale).toBe(1);
    expect(e.rotationY).toBe(0);
  });

  it('rejects other biomes and garbage', () => {
    expect(parseWorld({ biome: 'zoo', entities: [] }, 'ocean')).toBeUndefined();
    expect(parseWorld('nope', 'ocean')).toBeUndefined();
    expect(parseWorld(undefined, 'ocean')).toBeUndefined();
  });

  it('cleans names', () => {
    expect(cleanName('  Big   Blue  ', 'x')).toBe('Big Blue');
    expect(cleanName('', 'Fallback')).toBe('Fallback');
    expect(cleanName(42, 'Fallback')).toBe('Fallback');
    expect(cleanName('a'.repeat(100), 'x').length).toBe(40);
  });
});

describe('design meta', () => {
  it('validates stored metas', () => {
    expect(parseDesignMeta(meta('d'))).toEqual(meta('d'));
    expect(parseDesignMeta({ id: 'd' })).toBeNull();
    const m = parseDesignMeta({ id: 'd', speciesId: 'kelp', createdAt: 5 })!;
    expect(m.updatedAt).toBe(5);
    expect(m.thumbnail).toBe('');
  });

  it('diffs new, changed and deleted designs', () => {
    const persisted = new Map([
      ['same', 1],
      ['changed', 1],
      ['gone', 1],
    ]);
    const { save, remove } = diffDesigns({ same: meta('same', 1), changed: meta('changed', 2), fresh: meta('fresh') }, persisted);
    expect(save.map((m) => m.id).sort()).toEqual(['changed', 'fresh']);
    expect(remove).toEqual(['gone']);
  });
});

describe('MemoryAdapter', () => {
  it('implements the StorageAdapter round trip', async () => {
    const a = new MemoryAdapter();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await a.saveDesign(meta('d1'), blob);
    expect((await a.listDesigns()).map((m) => m.id)).toEqual(['d1']);
    expect(await a.loadDesignTexture('d1')).toBe(blob);
    await a.deleteDesign('d1');
    expect(await a.listDesigns()).toEqual([]);
    expect(await a.loadDesignTexture('d1')).toBeUndefined();

    const world: WorldState = { biome: 'ocean', entities: [ent('a')], timeOfDay: 0.4 };
    await a.saveWorld(world);
    world.entities[0].name = 'mutated';
    expect((await a.loadWorld('ocean'))!.entities[0].name).toBe('Nemo');
    expect(await a.loadWorld('zoo')).toBeUndefined();

    await a.saveSettings('muted', true);
    expect(await a.loadSettings<boolean>('muted')).toBe(true);
    expect(await a.loadSettings('nope')).toBeUndefined();
  });
});
