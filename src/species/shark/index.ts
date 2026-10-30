import type { SpeciesDef } from '../../core/types';
import { buildSharkGeometry } from './geometry';
import { drawSharkColoringPage, drawSharkTemplate } from './template';

/**
 * Blacktip reef shark: calm and majestic, never scary. Geometry is 1 unit long (snout +X); the
 * renderer scales it to swim.bodyLength * entity.scale. It patrols a wide loop at a steady pace,
 * never eats anything, and smaller fish simply give it room. See layout.ts for the UV layout used
 * by the studio.
 */
export const shark: SpeciesDef = {
  id: 'shark',
  name: 'Shark',
  kind: 'creature',
  biomes: ['ocean'],
  icon: '🦈',
  symmetry: 'bilateral',
  buildGeometry: buildSharkGeometry,
  drawTemplate: drawSharkTemplate,
  drawColoringPage: drawSharkColoringPage,
  // Left flank faces -Z: the flat view looks at the left flank, snout pointing left on screen.
  sideView: { direction: [0, 0, -1], up: [0, 1, 0] },
  locomotion: 'swim-fish',
  activity: 'always',
  // Open water, well off the seabed.
  habitat: { heightMin: 2, heightMax: 9, coverAffinity: 0 },
  swim: {
    cruiseSpeed: 1,
    maxSpeed: 2.2,
    // Low: with the speed floor this gives wide, lazy arcs (turn radius of several body lengths).
    turnRate: 0.2,
    schooling: 0,
    neighbourRadius: 8,
    bodyLength: 2.2,
    minSpeed: 0.6,
    roamRadius: 35,
    // Tail-driven: the front of the body stays nearly rigid.
    bodyWave: 0.15,
  },
  predator: true,
  scaleRange: [0.9, 1.15],
  diet: 'none',
};

export { fishToCanvas } from './layout';
