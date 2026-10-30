import { useApp } from './store';
import { templateDesignId } from './types';
import { terrainHeight } from './terrain';
import { getSpecies } from '../species';

/** Mulberry32: small deterministic PRNG so the demo world is the same every load. */
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fills an empty world with kelp groves and a few clownfish groups so there is something to see. */
export function seedDemoWorld() {
  const app = useApp.getState();
  if (app.entities.length > 0) return;
  const rand = rng(7);
  const kelp = getSpecies('kelp');
  const fish = getSpecies('clownfish');
  const groves: [number, number][] = [[0, -6], [-14, -18], [16, -22], [-26, 4], [24, 6], [4, -36]];
  for (const [gx, gz] of groves) {
    const count = 10 + Math.floor(rand() * 10);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 6;
      const x = gx + Math.cos(a) * r;
      const z = gz + Math.sin(a) * r;
      app.addEntity({
        speciesId: kelp.id,
        designId: templateDesignId(kelp.id),
        name: kelp.name,
        position: [x, terrainHeight(x, z), z],
        rotationY: rand() * Math.PI * 2,
        scale: kelp.scaleRange[0] + rand() * (kelp.scaleRange[1] - kelp.scaleRange[0]),
      });
    }
    const fishCount = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < fishCount; i++) {
      const x = gx + (rand() - 0.5) * 6;
      const z = gz + (rand() - 0.5) * 6;
      app.addEntity({
        speciesId: fish.id,
        designId: templateDesignId(fish.id),
        name: fish.name,
        position: [x, terrainHeight(x, z) + 1 + rand() * 2, z],
        rotationY: rand() * Math.PI * 2,
        scale: fish.scaleRange[0] + rand() * (fish.scaleRange[1] - fish.scaleRange[0]),
      });
    }
  }

  // A few jellies drifting above the groves, and one shark patrolling the open sand.
  const jelly = getSpecies('jellyfish');
  for (let i = 0; i < 6; i++) {
    const x = (rand() - 0.5) * 40;
    const z = -10 + (rand() - 0.5) * 40;
    app.addEntity({
      speciesId: jelly.id,
      designId: templateDesignId(jelly.id),
      name: jelly.name,
      position: [x, terrainHeight(x, z) + 5 + rand() * 5, z],
      rotationY: 0,
      scale: jelly.scaleRange[0] + rand() * (jelly.scaleRange[1] - jelly.scaleRange[0]),
    });
  }
  const shark = getSpecies('shark');
  app.addEntity({
    speciesId: shark.id,
    designId: templateDesignId(shark.id),
    name: shark.name,
    position: [0, terrainHeight(0, -20) + 5, -20],
    rotationY: 0,
    scale: 1,
  });
}
