import { SphereGeometry, Float32BufferAttribute } from 'three';
import type { SpeciesDef } from '../../core/types';

// Placeholder: replaced by the procedural shark model.
export const shark: SpeciesDef = {
  id: 'shark',
  name: 'Shark',
  kind: 'creature',
  biomes: ['ocean'],
  icon: '🦈',
  symmetry: 'bilateral',
  buildGeometry() {
    const g = new SphereGeometry(0.5, 12, 8);
    g.scale(1, 0.25, 0.25);
    const pos = g.getAttribute('position');
    const spine = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) spine[i] = 0.5 - pos.getX(i);
    g.setAttribute('aSpine', new Float32BufferAttribute(spine, 1));
    return g;
  },
  drawTemplate(ctx) {
    ctx.fillStyle = '#7d8a96';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  },
  sideView: { direction: [0, 0, -1], up: [0, 1, 0] },
  locomotion: 'swim-fish',
  activity: 'always',
  habitat: { heightMin: 2, heightMax: 9, coverAffinity: 0 },
  swim: {
    cruiseSpeed: 1.1,
    maxSpeed: 2.4,
    turnRate: 0.7,
    schooling: 0,
    neighbourRadius: 6,
    bodyLength: 2.2,
    minSpeed: 0.7,
    roamRadius: 35,
    bodyWave: 0.15,
  },
  predator: true,
  scaleRange: [0.85, 1.15],
  diet: 'none',
};
