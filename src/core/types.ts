import type { BufferGeometry } from 'three';

/**
 * Shared contracts. Every biome, species, renderer and UI module builds on these.
 * Keep this file free of runtime code so any module can import it.
 */

export type BiomeId = 'ocean' | 'terrarium' | 'zoo' | 'preserve';
export type SpeciesKind = 'creature' | 'plant' | 'rock';
export type Locomotion = 'swim-fish' | 'swim-jelly' | 'sway-plant' | 'static' | 'crawl' | 'hop' | 'walk';
export type Activity = 'diurnal' | 'nocturnal' | 'crepuscular' | 'always';

/**
 * 'bilateral': the texture's left half (u < 0.5) is the animal's left flank and the right half is
 * its right flank, laid out so the same body point on the opposite flank is at (1 - u, v).
 * Mirroring a stroke is therefore a horizontal flip of the canvas.
 * 'none': the whole texture is free (plants, rocks).
 */
export type Symmetry = 'bilateral' | 'none';

/**
 * Design texture size used by the studio canvas.
 * Canvas pixel (x, y) maps to uv (x / W, 1 - y / H): canvas top is v = 1.
 */
export const DESIGN_TEX_WIDTH = 1024;
export const DESIGN_TEX_HEIGHT = 512;

export interface HabitatPrefs {
  /** Preferred height above the seabed (or ground), metres. */
  heightMin: number;
  heightMax: number;
  /** 0..1, how strongly the creature stays near plants/rocks. */
  coverAffinity: number;
}

export interface SwimParams {
  cruiseSpeed: number; // m/s
  maxSpeed: number; // m/s
  turnRate: number; // rad/s
  /** 0..1, how strongly it schools with the same species. */
  schooling: number;
  neighbourRadius: number; // m
  bodyLength: number; // m, at scale 1
}

export interface SpeciesDef {
  id: string;
  name: string;
  kind: SpeciesKind;
  biomes: BiomeId[];
  /** Emoji used by the icon-first UI until real icons exist. */
  icon: string;
  symmetry: Symmetry;
  /**
   * Low-poly mesh in local space with a `uv` attribute following the symmetry convention.
   * Orientation: forward is +X, up is +Y, so the animal's left flank faces -Z.
   * Plants grow along +Y from y = 0.
   * Fish geometry should also carry a float attribute `aSpine` (0 at nose .. 1 at tail tip)
   * so the swim shader can bend the body.
   */
  buildGeometry(): BufferGeometry;
  /** Paints the natural default colouring into a DESIGN_TEX_WIDTH x DESIGN_TEX_HEIGHT canvas. */
  drawTemplate(ctx: CanvasRenderingContext2D): void;
  /** Camera for the Level 1 flat view, in local space. */
  sideView: { direction: [number, number, number]; up: [number, number, number] };
  locomotion: Locomotion;
  activity: Activity;
  habitat: HabitatPrefs;
  swim?: SwimParams;
  /** Random scale range applied when placed. */
  scaleRange: [number, number];
  diet: 'flakes' | 'none';
}

/** Saved paint job for one species. Reused as a template for any number of placements. */
export interface DesignMeta {
  id: string;
  speciesId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** data: URL, small PNG for galleries. */
  thumbnail: string;
}

/** Id used for a species' natural, unpainted look. */
export const templateDesignId = (speciesId: string) => `template:${speciesId}`;

export interface PlacedEntity {
  id: string;
  speciesId: string;
  designId: string;
  name: string;
  /** Spawn / anchor position in world space. Creatures roam from here; plants stay. */
  position: [number, number, number];
  rotationY: number;
  scale: number;
}

export interface WorldState {
  biome: BiomeId;
  entities: PlacedEntity[];
  timeOfDay: number;
  camera?: { position: [number, number, number]; target: [number, number, number] };
}

/** Storage boundary: IndexedDB in v1, a cloud adapter can implement the same interface later. */
export interface StorageAdapter {
  listDesigns(): Promise<DesignMeta[]>;
  loadDesignTexture(id: string): Promise<Blob | undefined>;
  saveDesign(meta: DesignMeta, texture: Blob): Promise<void>;
  deleteDesign(id: string): Promise<void>;
  loadWorld(biome: BiomeId): Promise<WorldState | undefined>;
  saveWorld(world: WorldState): Promise<void>;
  loadSettings<T>(key: string): Promise<T | undefined>;
  saveSettings<T>(key: string, value: T): Promise<void>;
}
