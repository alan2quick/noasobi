import { create } from 'zustand';
import type { SpeciesKind } from '../core/types';

/** UI-only state that is not part of the app contract (never persisted). */
interface UiState {
  /** Feed mode: taps in the world drop food. Only meaningful in 'world' mode. */
  feeding: boolean;
  setFeeding(on: boolean): void;
  catalogTab: SpeciesKind;
  setCatalogTab(tab: SpeciesKind): void;
  /** Ids placed during the current place-mode session (for undo). */
  placed: string[];
  setPlaced(ids: string[]): void;
}

export const useUi = create<UiState>((set) => ({
  feeding: false,
  setFeeding: (feeding) => set({ feeding }),
  catalogTab: 'creature',
  setCatalogTab: (catalogTab) => set({ catalogTab }),
  placed: [],
  setPlaced: (placed) => set({ placed }),
}));
