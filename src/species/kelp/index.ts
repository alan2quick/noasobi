import { CylinderGeometry } from 'three';
import type { SpeciesDef } from '../../core/types';

// Placeholder: replaced by the procedural kelp model.
export const kelp: SpeciesDef = {
  id: 'kelp',
  name: 'Kelp',
  kind: 'plant',
  biomes: ['ocean'],
  icon: '🌿',
  symmetry: 'none',
  buildGeometry() {
    const g = new CylinderGeometry(0.05, 0.08, 8, 5, 8);
    g.translate(0, 4, 0);
    return g;
  },
  drawTemplate(ctx) {
    ctx.fillStyle = '#6b7d1f';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  },
  sideView: { direction: [0, 0, -1], up: [0, 1, 0] },
  locomotion: 'sway-plant',
  activity: 'always',
  habitat: { heightMin: 0, heightMax: 0, coverAffinity: 0 },
  scaleRange: [0.7, 1.4],
  diet: 'none',
};
