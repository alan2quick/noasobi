import type { SpeciesDef } from '../../core/types';
import { buildKelpGeometry } from './model';
import { drawKelpColoringPage, drawKelpTemplate } from './template';

/** Giant kelp: tall swaying brown alga. Model in model.ts, UV layout documented in layout.ts. */
export const kelp: SpeciesDef = {
  id: 'kelp',
  name: 'Kelp',
  kind: 'plant',
  biomes: ['ocean'],
  icon: '🌿',
  symmetry: 'none',
  buildGeometry: buildKelpGeometry,
  drawTemplate: drawKelpTemplate,
  drawColoringPage: drawKelpColoringPage,
  // Front view: camera on +Z looking toward -Z, +X on the right (blades spread left and right).
  sideView: { direction: [0, 0, 1], up: [0, 1, 0] },
  locomotion: 'sway-plant',
  activity: 'always',
  habitat: { heightMin: 0, heightMax: 0, coverAffinity: 0 },
  scaleRange: [0.7, 1.4],
  diet: 'none',
};
