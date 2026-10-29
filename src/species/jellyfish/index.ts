import { SphereGeometry } from 'three';
import type { SpeciesDef } from '../../core/types';

// Placeholder: replaced by the procedural jellyfish model.
export const jellyfish: SpeciesDef = {
  id: 'jellyfish',
  name: 'Jellyfish',
  kind: 'creature',
  biomes: ['ocean'],
  icon: '🪼',
  symmetry: 'none',
  buildGeometry() {
    const g = new SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    return g;
  },
  drawTemplate(ctx) {
    ctx.fillStyle = '#f3b7d6';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  },
  sideView: { direction: [0, 0, 1], up: [0, 1, 0] },
  locomotion: 'swim-jelly',
  activity: 'always',
  habitat: { heightMin: 3, heightMax: 14, coverAffinity: 0 },
  drift: { pulseRate: 0.7, pulseThrust: 0.35, sinkSpeed: 0.08, bellRadius: 0.35, nightGlow: 0.8 },
  scaleRange: [0.7, 1.3],
  diet: 'none',
};
