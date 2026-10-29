import { create } from 'zustand';
import type { DesignMeta, PlacedEntity } from './types';
import { DESIGN_TEX_HEIGHT, DESIGN_TEX_WIDTH, templateDesignId } from './types';
import { designTextures } from '../render/designTextures';
import { SPECIES, getSpecies } from '../species';

export type Mode = 'world' | 'catalog' | 'studio' | 'place' | 'edit';
export type Quality = 'low' | 'medium' | 'high';

/** Full-resolution paint canvases, kept outside React state. Keyed by design id. */
const designSources = new Map<string, HTMLCanvasElement>();

export function getDesignSource(designId: string): HTMLCanvasElement | undefined {
  return designSources.get(designId);
}

let idCounter = 0;
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export interface SaveDesignInput {
  speciesId: string;
  /** Omit to create a new design. */
  designId?: string;
  name?: string;
  /** DESIGN_TEX_WIDTH x DESIGN_TEX_HEIGHT paint canvas, template already composited in. */
  canvas: HTMLCanvasElement;
  thumbnail: string;
}

interface AppState {
  mode: Mode;
  setMode(mode: Mode): void;

  designLevel: 1 | 2;
  setDesignLevel(level: 1 | 2): void;
  studio: { speciesId: string; designId?: string } | null;
  openStudio(speciesId: string, designId?: string): void;
  closeStudio(): void;

  designs: Record<string, DesignMeta>;
  saveDesign(input: SaveDesignInput): DesignMeta;
  deleteDesign(designId: string): void;

  entities: PlacedEntity[];
  addEntity(entity: Omit<PlacedEntity, 'id'> & { id?: string }): PlacedEntity;
  updateEntity(id: string, patch: Partial<PlacedEntity>): void;
  removeEntity(id: string): void;

  selectedId: string | null;
  followId: string | null;
  select(id: string | null): void;
  follow(id: string | null): void;

  quality: Quality;
  setQuality(q: Quality): void;
  muted: boolean;
  setMuted(m: boolean): void;
}

export const useApp = create<AppState>((set, get) => ({
  mode: 'world',
  setMode: (mode) => set({ mode }),

  designLevel: 1,
  setDesignLevel: (designLevel) => set({ designLevel }),
  studio: null,
  openStudio: (speciesId, designId) => set({ studio: { speciesId, designId }, mode: 'studio' }),
  closeStudio: () => set({ studio: null, mode: 'world' }),

  designs: {},
  saveDesign: ({ speciesId, designId, name, canvas, thumbnail }) => {
    const now = Date.now();
    const prev = designId ? get().designs[designId] : undefined;
    const meta: DesignMeta = {
      id: designId ?? newId('design'),
      speciesId,
      name: name ?? prev?.name ?? getSpecies(speciesId).name,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      thumbnail,
    };
    const copy = document.createElement('canvas');
    copy.width = DESIGN_TEX_WIDTH;
    copy.height = DESIGN_TEX_HEIGHT;
    copy.getContext('2d')!.drawImage(canvas, 0, 0, DESIGN_TEX_WIDTH, DESIGN_TEX_HEIGHT);
    designSources.set(meta.id, copy);
    designTextures.setDesign(meta.id, copy);
    set({ designs: { ...get().designs, [meta.id]: meta } });
    return meta;
  },
  deleteDesign: (designId) => {
    const { [designId]: _removed, ...rest } = get().designs;
    designSources.delete(designId);
    designTextures.removeDesign(designId);
    // Creatures using it fall back to the species template.
    const entities = get().entities.map((e) =>
      e.designId === designId ? { ...e, designId: templateDesignId(e.speciesId) } : e,
    );
    set({ designs: rest, entities });
  },

  entities: [],
  addEntity: (input) => {
    const entity: PlacedEntity = { ...input, id: input.id ?? newId('ent') };
    set({ entities: [...get().entities, entity] });
    return entity;
  },
  updateEntity: (id, patch) =>
    set({ entities: get().entities.map((e) => (e.id === id ? { ...e, ...patch } : e)) }),
  removeEntity: (id) =>
    set({
      entities: get().entities.filter((e) => e.id !== id),
      selectedId: get().selectedId === id ? null : get().selectedId,
      followId: get().followId === id ? null : get().followId,
    }),

  selectedId: null,
  followId: null,
  select: (selectedId) => set({ selectedId }),
  follow: (followId) => set({ followId }),

  quality: 'high',
  setQuality: (quality) => set({ quality }),
  muted: false,
  setMuted: (muted) => set({ muted }),
}));

/** Uploads every species' natural look into the design array. Call once at startup. */
export function initTemplates() {
  for (const species of SPECIES) {
    const id = templateDesignId(species.id);
    const canvas = document.createElement('canvas');
    canvas.width = DESIGN_TEX_WIDTH;
    canvas.height = DESIGN_TEX_HEIGHT;
    species.drawTemplate(canvas.getContext('2d')!);
    designSources.set(id, canvas);
    designTextures.setDesign(id, canvas);
  }
}

/** Refreshes a species template after hot reload or a template change. */
export function getTemplateSource(speciesId: string) {
  return designSources.get(templateDesignId(speciesId));
}
