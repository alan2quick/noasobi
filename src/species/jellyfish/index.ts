import type { SpeciesDef } from '../../core/types';
import { buildJellyfishGeometry } from './geometry';
import { BELL_R } from './layout';
import { drawJellyfishColoringPage, drawJellyfishTemplate } from './template';

/**
 * Moon jelly (Aurelia aurita): a pale, translucent, glowing drifter. Geometry is in metres at
 * scale 1 (bell radius BELL_R, tentacles hang about 0.6 m); see layout.ts for the UV layout and
 * geometry.ts for the animation attributes. Sim: src/sim/jellySim.ts, renderer: Drifters.tsx.
 */
export const jellyfish: SpeciesDef = {
  id: 'jellyfish',
  name: 'Jellyfish',
  kind: 'creature',
  biomes: ['ocean'],
  icon: '🪼',
  symmetry: 'none',
  buildGeometry: buildJellyfishGeometry,
  drawTemplate: drawJellyfishTemplate,
  drawColoringPage: drawJellyfishColoringPage,
  // Studio Level 1 looks at the bell from the front and a little above, so the gonad rings on top
  // of the dome stay visible while the tentacles still hang in view. up is +Y.
  sideView: { direction: [0, 0.42, 1], up: [0, 1, 0] },
  locomotion: 'swim-jelly',
  activity: 'always',
  // Open water, well off the seabed.
  habitat: { heightMin: 3, heightMax: 14, coverAffinity: 0 },
  drift: { pulseRate: 0.7, pulseThrust: 0.35, sinkSpeed: 0.08, bellRadius: BELL_R, nightGlow: 0.8 },
  scaleRange: [0.7, 1.3],
  diet: 'none',
};
