/** Tool state for the design studio, shared by the toolbars and the 3D paint view. */
import { create } from 'zustand';
import type { BrushId } from './brushes';
import type { PatternId } from './patterns';

export type StudioTool = 'brush' | 'eraser' | 'pattern' | 'eyedropper';

export const SWATCHES = [
  '#e53935', // red
  '#fb8c00', // orange
  '#fdd835', // yellow
  '#7cb342', // green
  '#26a69a', // teal
  '#1e88e5', // blue
  '#8e24aa', // purple
  '#f48fb1', // pink
  '#6d4c41', // brown
  '#ffffff', // white
  '#212121', // black
];

/** Level 1 brush sizes as a fraction of the model's size. */
export const L1_SIZES = [0.025, 0.05, 0.1];

interface StudioState {
  tool: StudioTool;
  /** Tool to go back to after the eyedropper picked a colour. */
  prevTool: Exclude<StudioTool, 'eyedropper'>;
  brush: BrushId;
  pattern: PatternId;
  color: string;
  recent: string[];
  sizeIndex: number; // Level 1
  size: number; // Level 2, 0..1
  opacity: number; // Level 2
  hardness: number; // Level 2
  mirror: boolean; // Level 2 toggle; Level 1 always mirrors
  rotateMode: boolean; // Level 2: one finger rotates
  flipped: boolean; // look at the other side
  name: string;
  set(patch: Partial<StudioState>): void;
  setTool(tool: StudioTool): void;
  pushRecent(color: string): void;
}

export const useStudio = create<StudioState>((set, get) => ({
  tool: 'brush',
  prevTool: 'brush',
  brush: 'crayon',
  pattern: 'dots',
  color: '#fdd835',
  recent: [],
  sizeIndex: 1,
  size: 0.3,
  opacity: 1,
  hardness: 0.8,
  mirror: true,
  rotateMode: false,
  flipped: false,
  name: '',
  set: (patch) => set(patch),
  setTool: (tool) => {
    const cur = get().tool;
    set({ tool, prevTool: cur !== 'eyedropper' ? cur : get().prevTool, rotateMode: false });
  },
  pushRecent: (color) => {
    const recent = [color, ...get().recent.filter((c) => c !== color)].slice(0, 8);
    set({ recent });
  },
}));

/** Continuous Level 2 size (0..1) to a fraction of the model size. */
export const l2SizeFraction = (s: number) => 0.008 + s * s * 0.22;
