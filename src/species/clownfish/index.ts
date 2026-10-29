import { SphereGeometry, Float32BufferAttribute } from 'three';
import type { SpeciesDef } from '../../core/types';

// Placeholder: replaced by the procedural clownfish model.
export const clownfish: SpeciesDef = {
  id: 'clownfish',
  name: 'Clownfish',
  kind: 'creature',
  biomes: ['ocean'],
  icon: '🐠',
  symmetry: 'bilateral',
  buildGeometry() {
    const g = new SphereGeometry(0.5, 12, 8);
    g.scale(1, 0.6, 0.35);
    const pos = g.getAttribute('position');
    const spine = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) spine[i] = 0.5 - pos.getX(i);
    g.setAttribute('aSpine', new Float32BufferAttribute(spine, 1));
    return g;
  },
  drawTemplate(ctx) {
    ctx.fillStyle = '#f26a1b';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  },
  sideView: { direction: [0, 0, -1], up: [0, 1, 0] },
  locomotion: 'swim-fish',
  activity: 'diurnal',
  habitat: { heightMin: 0.5, heightMax: 4, coverAffinity: 0.7 },
  swim: { cruiseSpeed: 0.6, maxSpeed: 2.2, turnRate: 2.5, schooling: 0.5, neighbourRadius: 2.5, bodyLength: 0.12 },
  scaleRange: [0.85, 1.15],
  diet: 'flakes',
};
