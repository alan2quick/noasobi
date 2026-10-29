import type { SpeciesDef } from '../../core/types';
import { buildClownfishGeometry } from './geometry';
import { drawClownfishTemplate } from './template';

/**
 * Ocellaris clownfish. Geometry is 1 unit long (nose +X); the renderer scales it to
 * swim.bodyLength * entity.scale. Stylised a little larger than life (real: ~0.08–0.11 m) so
 * children can spot them among the kelp. See layout.ts for the UV layout used by the studio.
 */
export const clownfish: SpeciesDef = {
  id: 'clownfish',
  name: 'Clownfish',
  kind: 'creature',
  biomes: ['ocean'],
  icon: '🐠',
  symmetry: 'bilateral',
  buildGeometry: buildClownfishGeometry,
  drawTemplate: drawClownfishTemplate,
  // Left flank faces -Z: the flat view looks at the left flank, nose pointing left on screen.
  sideView: { direction: [0, 0, -1], up: [0, 1, 0] },
  locomotion: 'swim-fish',
  activity: 'diurnal',
  // Clownfish stay low and close to cover (their anemone; kelp here).
  habitat: { heightMin: 0.4, heightMax: 3.2, coverAffinity: 0.75 },
  swim: {
    cruiseSpeed: 0.45,
    maxSpeed: 1.8,
    turnRate: 2.6,
    schooling: 0.35,
    neighbourRadius: 2,
    bodyLength: 0.3,
  },
  scaleRange: [0.85, 1.15],
  diet: 'flakes',
};

export { fishToCanvas } from './layout';
