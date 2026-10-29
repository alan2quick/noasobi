import { Quaternion, Vector3 } from 'three';
import type { PlacedEntity, SpeciesDef } from '../core/types';
import { templateDesignId } from '../core/types';
import { runtime } from '../core/runtime';
import type { LiveTransform } from '../core/runtime';
import { SURFACE_Y, WORLD_HALF, terrainHeight } from '../core/terrain';
import { SpatialHash } from './spatialHash';
import { nearestFood } from './food';
import {
  TAU,
  activityLevel,
  angleDelta,
  approach,
  boundsSteer,
  clamp,
  composeMatrix,
  damp,
  hash01,
  heightBandSteer,
  lodInterval,
  quatYawPitchRoll,
  smoothstep,
  wrapAngle,
  yawOf,
} from './steering';

/**
 * Steering sim for every creature with locomotion 'swim-fish', all species in one SoA so the
 * neighbour hash is shared. Generic: everything species-specific comes from SpeciesDef
 * (swim params, habitat, activity, diet).
 *
 * Per frame (all fish): kinematics (turn towards the desired direction at turnRate, speed easing,
 * bank/pitch), tail/pectoral phase integration, transforms + render buffers.
 * Steering (wander, habitat band, home, bounds, schooling, cover, food) runs at a camera-distance
 * LOD: near fish every frame, far fish every 2/4/8 frames with the accumulated dt.
 */

const enum Mode {
  Cruise = 0,
  Burst = 1,
  Glide = 2,
  Hover = 3,
}

/** Render buffers for one species' InstancedMesh. Owned by the sim, bound by the renderer. */
export interface FishBatch {
  species: SpeciesDef;
  capacity: number;
  count: number;
  /** capacity * 16, column-major instance matrices. */
  matrices: Float32Array;
  /** capacity * 4: tailPhase, tailAmp, pecPhase, pecAmp. */
  swim: Float32Array;
  /** capacity: turning curvature. */
  bend: Float32Array;
  /** capacity: design texture layer. */
  layers: Float32Array;
  slotToFish: Int32Array;
  /** Bumped whenever the arrays above are reallocated. */
  generation: number;
  /** Set when `layers` changed; the renderer clears it after uploading. */
  layersDirty: boolean;
}

interface SpeciesInfo {
  def: SpeciesDef;
  batch: FishBatch;
  homeRadius: number;
}

/** Resolves a design id to a texture layer (injected so the sim stays testable without DOM). */
export type LayerResolver = (designId: string, speciesId: string) => number;

const FIELDS = [
  'px', 'py', 'pz', 'ax', 'ay', 'az', 'yaw', 'pitch', 'roll', 'speed', 'tSpeed', 'yawRate',
  'dX', 'dY', 'dZ', 'wYaw', 'wYawT', 'wPitch', 'wTimer', 'modeT', 'tailPh', 'tailAmp', 'pecPh',
  'pecAmp', 'thrust', 'bend', 'scale', 'seed', 'steerAcc', 'coverT', 'feed',
] as const;
type Field = (typeof FIELDS)[number];

const MAX_NEIGHBOURS = 64;
const COVER_SENSE = 8;
const FOOD_SENSE = 5;

export class FishSim {
  n = 0;
  private cap = 0;
  private f = {} as Record<Field, Float32Array>;
  private mode = new Uint8Array(0);
  private species = new Uint16Array(0);
  private slot = new Int32Array(0);
  private cover = new Int32Array(0);
  private ids: string[] = [];
  private designIds: string[] = [];
  private transforms: LiveTransform[] = [];
  private index = new Map<string, number>();

  private speciesList: SpeciesInfo[] = [];
  private speciesIndex = new Map<string, number>();

  private hash = new SpatialHash(2, false, 256, 10);
  private neighbours = new Int32Array(MAX_NEIGHBOURS);

  private plantHash = new SpatialHash(4, true, 256, 10);
  private plantX = new Float32Array(0);
  private plantY = new Float32Array(0);
  private plantZ = new Float32Array(0);
  private plantN = 0;
  private plantCandidates = new Int32Array(128);

  private frame = 0;
  private time = 0;
  private quat = new Float32Array(4);
  private rngState = 1;

  constructor(
    private getSpecies: (id: string) => SpeciesDef,
    private resolveLayer: LayerResolver = () => 0,
  ) {
    this.grow(64);
  }

  setLayerResolver(fn: LayerResolver) {
    this.resolveLayer = fn;
    this.refreshLayers();
  }

  private rand() {
    this.rngState = (this.rngState + 0x6d2b79f5) | 0;
    return hash01(this.rngState);
  }

  // ── Storage ──────────────────────────────────────────────────────────────────────────────────
  private grow(cap: number) {
    const old = this.f;
    const next = {} as Record<Field, Float32Array>;
    for (const k of FIELDS) {
      next[k] = new Float32Array(cap);
      if (old[k]) next[k].set(old[k].subarray(0, this.n));
    }
    this.f = next;
    const copy = <T extends Uint8Array | Uint16Array | Int32Array>(a: T, b: T) => (b.set(a.subarray(0, this.n)), b);
    this.mode = copy(this.mode, new Uint8Array(cap));
    this.species = copy(this.species, new Uint16Array(cap));
    this.slot = copy(this.slot, new Int32Array(cap));
    this.cover = copy(this.cover, new Int32Array(cap));
    this.cap = cap;
  }

  private speciesInfo(def: SpeciesDef): number {
    let si = this.speciesIndex.get(def.id);
    if (si !== undefined) return si;
    si = this.speciesList.length;
    const cap = 32;
    this.speciesList.push({
      def,
      homeRadius: 3 + 12 * (1 - def.habitat.coverAffinity),
      batch: {
        species: def,
        capacity: cap,
        count: 0,
        matrices: new Float32Array(cap * 16),
        swim: new Float32Array(cap * 4),
        bend: new Float32Array(cap),
        layers: new Float32Array(cap),
        slotToFish: new Int32Array(cap),
        generation: 0,
        layersDirty: true,
      },
    });
    this.speciesIndex.set(def.id, si);
    return si;
  }

  /** Render batch for a species (created on demand, possibly empty). */
  batchFor(def: SpeciesDef): FishBatch {
    return this.speciesList[this.speciesInfo(def)].batch;
  }

  private growBatch(b: FishBatch) {
    const cap = b.capacity * 2;
    const grow = (a: Float32Array, per: number) => {
      const out = new Float32Array(cap * per);
      out.set(a);
      return out;
    };
    b.matrices = grow(b.matrices, 16);
    b.swim = grow(b.swim, 4);
    b.bend = grow(b.bend, 1);
    b.layers = grow(b.layers, 1);
    const s2f = new Int32Array(cap);
    s2f.set(b.slotToFish);
    b.slotToFish = s2f;
    b.capacity = cap;
    b.generation++;
    b.layersDirty = true;
  }

  // ── Entity sync ──────────────────────────────────────────────────────────────────────────────
  /** Diffs the placed entities: adds new fish at their anchor, removes deleted ones, updates others. */
  sync(entities: PlacedEntity[]) {
    const keep = new Set<string>();
    const plants: PlacedEntity[] = [];
    for (const e of entities) {
      let def: SpeciesDef;
      try {
        def = this.getSpecies(e.speciesId);
      } catch {
        continue;
      }
      if (def.kind === 'plant' || def.kind === 'rock') {
        plants.push(e);
        continue;
      }
      if (def.locomotion !== 'swim-fish' || !def.swim) continue;
      keep.add(e.id);
      const i = this.index.get(e.id);
      if (i === undefined) this.add(e, def);
      else this.update(i, e);
    }
    for (let i = this.n - 1; i >= 0; i--) if (!keep.has(this.ids[i])) this.remove(i);
    this.syncPlants(plants);
  }

  private syncPlants(plants: PlacedEntity[]) {
    if (plants.length > this.plantX.length) {
      const cap = Math.max(64, plants.length * 2);
      this.plantX = new Float32Array(cap);
      this.plantY = new Float32Array(cap);
      this.plantZ = new Float32Array(cap);
    }
    plants.forEach((p, k) => {
      this.plantX[k] = p.position[0];
      this.plantY[k] = p.position[1];
      this.plantZ[k] = p.position[2];
    });
    this.plantN = plants.length;
    this.plantHash.build(this.plantX, this.plantY, this.plantZ, this.plantN);
    // Force every fish to look up its nearest cover again.
    this.cover.fill(-1);
    this.f.coverT.fill(0);
  }

  private add(e: PlacedEntity, def: SpeciesDef) {
    if (this.n >= this.cap) this.grow(this.cap * 2);
    const i = this.n++;
    const F = this.f;
    for (const k of FIELDS) F[k][i] = 0;
    const si = this.speciesInfo(def);
    const sw = def.swim!;
    F.px[i] = F.ax[i] = e.position[0];
    F.py[i] = F.ay[i] = e.position[1];
    F.pz[i] = F.az[i] = e.position[2];
    F.yaw[i] = wrapAngle(e.rotationY);
    F.dX[i] = Math.cos(e.rotationY);
    F.dZ[i] = -Math.sin(e.rotationY);
    F.speed[i] = sw.cruiseSpeed * 0.5;
    F.tSpeed[i] = sw.cruiseSpeed;
    F.scale[i] = e.scale;
    F.seed[i] = this.rand();
    F.tailPh[i] = this.rand() * TAU;
    F.pecPh[i] = this.rand() * TAU;
    F.modeT[i] = this.rand() * 2;
    F.pecAmp[i] = 0.5;
    F.feed[i] = -1;
    this.mode[i] = Mode.Cruise;
    this.species[i] = si;
    this.cover[i] = -1;
    this.ids[i] = e.id;
    this.designIds[i] = e.designId;
    this.index.set(e.id, i);

    const b = this.speciesList[si].batch;
    if (b.count >= b.capacity) this.growBatch(b);
    const s = b.count++;
    b.slotToFish[s] = i;
    this.slot[i] = s;
    b.layers[s] = this.resolveLayer(e.designId, def.id);
    b.layersDirty = true;

    const t: LiveTransform = { position: new Vector3(), quaternion: new Quaternion(), radius: sw.bodyLength * e.scale * 0.6 };
    this.transforms[i] = t;
    runtime.transforms.set(e.id, t);
    this.writeOut(i);
  }

  private update(i: number, e: PlacedEntity) {
    const F = this.f;
    const def = this.speciesList[this.species[i]].def;
    if (F.ax[i] !== e.position[0] || F.ay[i] !== e.position[1] || F.az[i] !== e.position[2]) {
      // Anchor moved (edit mode): teleport there so the change is obvious.
      F.px[i] = F.ax[i] = e.position[0];
      F.py[i] = F.ay[i] = e.position[1];
      F.pz[i] = F.az[i] = e.position[2];
      F.yaw[i] = wrapAngle(e.rotationY);
    }
    F.scale[i] = e.scale;
    this.transforms[i].radius = def.swim!.bodyLength * e.scale * 0.6;
    if (this.designIds[i] !== e.designId) {
      this.designIds[i] = e.designId;
      const b = this.speciesList[this.species[i]].batch;
      b.layers[this.slot[i]] = this.resolveLayer(e.designId, def.id);
      b.layersDirty = true;
    }
  }

  private remove(i: number) {
    const id = this.ids[i];
    runtime.transforms.delete(id);
    this.index.delete(id);

    // Free the render slot (swap with the batch's last slot).
    const b = this.speciesList[this.species[i]].batch;
    const s = this.slot[i];
    const last = b.count - 1;
    if (s !== last) {
      const j = b.slotToFish[last];
      b.slotToFish[s] = j;
      this.slot[j] = s;
      b.matrices.copyWithin(s * 16, last * 16, last * 16 + 16);
      b.swim.copyWithin(s * 4, last * 4, last * 4 + 4);
      b.bend[s] = b.bend[last];
      b.layers[s] = b.layers[last];
      b.layersDirty = true;
    }
    b.count--;

    // Swap-remove from the SoA.
    const lastI = this.n - 1;
    if (i !== lastI) {
      for (const k of FIELDS) this.f[k][i] = this.f[k][lastI];
      this.mode[i] = this.mode[lastI];
      this.species[i] = this.species[lastI];
      this.slot[i] = this.slot[lastI];
      this.cover[i] = this.cover[lastI];
      this.ids[i] = this.ids[lastI];
      this.designIds[i] = this.designIds[lastI];
      this.transforms[i] = this.transforms[lastI];
      this.index.set(this.ids[i], i);
      const bl = this.speciesList[this.species[i]].batch;
      bl.slotToFish[this.slot[i]] = i;
    }
    this.ids.length = lastI;
    this.designIds.length = lastI;
    this.transforms.length = lastI;
    this.n = lastI;
  }

  /** Re-resolves every fish's design layer (call when design textures change). */
  refreshLayers() {
    for (let i = 0; i < this.n; i++) {
      const info = this.speciesList[this.species[i]];
      info.batch.layers[this.slot[i]] = this.resolveLayer(this.designIds[i], info.def.id);
      info.batch.layersDirty = true;
    }
  }

  /** Index of a fish by entity id (or -1). */
  indexOf(id: string) {
    return this.index.get(id) ?? -1;
  }

  // ── Step ─────────────────────────────────────────────────────────────────────────────────────
  step(dt: number, camX: number, camY: number, camZ: number) {
    if (dt <= 0) return;
    this.frame++;
    this.time += dt;
    const F = this.f;
    for (let i = 0; i < this.n; i++) F.steerAcc[i] += dt;
    this.hash.build(F.px, F.py, F.pz, this.n);
    const daylight = runtime.daylight;
    for (let i = 0; i < this.n; i++) {
      const dx = F.px[i] - camX, dy = F.py[i] - camY, dz = F.pz[i] - camZ;
      const interval = lodInterval(dx * dx + dy * dy + dz * dz);
      if ((this.frame + i) % interval === 0) {
        this.steer(i, F.steerAcc[i], daylight);
        F.steerAcc[i] = 0;
      }
    }
    for (let i = 0; i < this.n; i++) {
      this.integrate(i, dt, daylight);
      this.writeOut(i);
    }
  }

  private steer(i: number, dt: number, daylight: number) {
    const F = this.f;
    const info = this.speciesList[this.species[i]];
    const def = info.def;
    const sw = def.swim!;
    const hab = def.habitat;
    const act = activityLevel(def.activity, daylight);
    const rest = 1 - act;
    const px = F.px[i], py = F.py[i], pz = F.pz[i];
    const cp = Math.cos(F.pitch[i]);
    const fx = Math.cos(F.yaw[i]) * cp, fz = -Math.sin(F.yaw[i]) * cp;
    const len = sw.bodyLength * F.scale[i];

    // Wander: a smoothly drifting heading offset, retargeted every few seconds.
    F.wTimer[i] -= dt;
    if (F.wTimer[i] <= 0) {
      F.wTimer[i] = 1.5 + this.rand() * 4;
      F.wYawT[i] = (this.rand() - 0.5) * 2.4 * (1 - 0.6 * rest);
      F.wPitch[i] = (this.rand() - 0.5) * 0.6;
    }
    F.wYaw[i] = damp(F.wYaw[i], F.wYawT[i], 1.2, dt);
    const wy = F.yaw[i] + F.wYaw[i];
    let ddx = Math.cos(wy);
    let ddz = -Math.sin(wy);
    let ddy = F.wPitch[i] * 0.4;

    // Home: stay loosely around the anchor (tighter when resting).
    const homeR = info.homeRadius * (1 - 0.5 * rest);
    const hx = F.ax[i] - px, hz = F.az[i] - pz;
    const hd = Math.hypot(hx, hz);
    if (hd > homeR * 0.35) {
      const k = smoothstep(homeR * 0.35, homeR, hd) * 2.2 + (hd > homeR ? (hd - homeR) * 0.5 : 0);
      ddx += (hx / hd) * k;
      ddz += (hz / hd) * k;
    }

    // Cover: hang around plants (looked up about once a second).
    F.coverT[i] -= dt;
    if (F.coverT[i] <= 0 && this.plantN > 0 && hab.coverAffinity > 0) {
      F.coverT[i] = 0.8 + this.rand() * 0.6;
      this.cover[i] = this.nearestPlant(px, pz);
    }
    const c = this.cover[i];
    if (c >= 0 && hab.coverAffinity > 0) {
      const cx = this.plantX[c] - px, cz = this.plantZ[c] - pz;
      const cd = Math.hypot(cx, cz) || 1e-3;
      const aff = hab.coverAffinity * (1 + rest * 1.5);
      const pull = smoothstep(0.8, 4, cd) * aff * 1.2;
      const push = cd < 0.35 ? (0.35 - cd) * 6 : 0;
      ddx += (cx / cd) * (pull - push);
      ddz += (cz / cd) * (pull - push);
    }

    // Schooling with the same species + separation from everyone of that species.
    const school = sw.schooling;
    const nr = sw.neighbourRadius;
    const sepR = len * 3.5;
    const m = this.hash.query(px, py, pz, nr, this.neighbours);
    let sx = 0, sy = 0, sz = 0, axs = 0, ays = 0, azs = 0, cxs = 0, cys = 0, czs = 0, cnt = 0;
    const mySpecies = this.species[i];
    for (let k = 0; k < m; k++) {
      const j = this.neighbours[k];
      if (j === i || this.species[j] !== mySpecies) continue;
      const ox = px - F.px[j], oy = py - F.py[j], oz = pz - F.pz[j];
      const d2 = ox * ox + oy * oy + oz * oz;
      if (d2 > nr * nr || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      if (d < sepR) {
        const w = (1 - d / sepR) / d;
        sx += ox * w;
        sy += oy * w;
        sz += oz * w;
      }
      const cpj = Math.cos(F.pitch[j]);
      axs += Math.cos(F.yaw[j]) * cpj;
      ays += Math.sin(F.pitch[j]);
      azs += -Math.sin(F.yaw[j]) * cpj;
      cxs += F.px[j];
      cys += F.py[j];
      czs += F.pz[j];
      cnt++;
    }
    ddx += sx * 1.6;
    ddy += sy * 1.2;
    ddz += sz * 1.6;
    if (cnt > 0 && school > 0) {
      const inv = 1 / cnt;
      ddx += axs * inv * school * 1.2;
      ddy += ays * inv * school * 0.6;
      ddz += azs * inv * school * 1.2;
      const tx = cxs * inv - px, ty = cys * inv - py, tz = czs * inv - pz;
      const td = Math.hypot(tx, ty, tz) || 1;
      const k = school * smoothstep(sepR, nr, td) * 1.0;
      ddx += (tx / td) * k;
      ddy += (ty / td) * k * 0.6;
      ddz += (tz / td) * k;
    }

    // Habitat height band (lower when resting), looking a little ahead for rising seabed.
    const ground = terrainHeight(px, pz);
    const aheadGround = terrainHeight(px + fx * 1.2, pz + fz * 1.2);
    const h = py - Math.max(ground, aheadGround - 0.2);
    const bandMin = hab.heightMin * (1 - 0.4 * rest);
    const bandMax = hab.heightMax + (hab.heightMin + 0.4 - hab.heightMax) * rest;
    ddy += heightBandSteer(h, bandMin, bandMax, SURFACE_Y - py);

    // World bounds.
    const lim = WORLD_HALF - 10;
    ddx += boundsSteer(px, lim);
    ddz += boundsSteer(pz, lim);

    // Food: dart to the nearest flake and eat it.
    F.feed[i] = -1;
    if (def.diet === 'flakes' && runtime.food.length > 0) {
      const fi = nearestFood(px, py, pz, FOOD_SENSE * (0.5 + 0.5 * act));
      if (fi >= 0) {
        const flake = runtime.food[fi];
        const tx = flake.position.x - px, ty = flake.position.y - py, tz = flake.position.z - pz;
        const td = Math.hypot(tx, ty, tz) || 1e-3;
        if (td < 0.06 + len * 0.45) {
          flake.alive = false;
          this.mode[i] = Mode.Glide;
          F.modeT[i] = 0.4 + this.rand() * 0.6;
        } else {
          // Override the softer urges: aim mostly at the flake.
          ddx = ddx * 0.2 + (tx / td) * 4;
          ddy = ddy * 0.2 + (ty / td) * 4;
          ddz = ddz * 0.2 + (tz / td) * 4;
          F.feed[i] = td;
        }
      }
    }

    const dl = Math.hypot(ddx, ddy, ddz);
    if (dl > 1e-5) {
      F.dX[i] = ddx / dl;
      F.dY[i] = ddy / dl;
      F.dZ[i] = ddz / dl;
    }

    // Burst-and-glide rhythm with hovering pauses.
    F.modeT[i] -= dt;
    if (F.modeT[i] <= 0) this.nextMode(i, sw.cruiseSpeed, sw.maxSpeed, rest);
    // Strayed far or feeding: keep moving with purpose.
    const far = hd > homeR * 1.2 || h < bandMin * 0.5;
    if (F.feed[i] >= 0) {
      // Dart in from afar, then slow down to arrive (no orbiting around the flake).
      const fd = F.feed[i];
      if (fd > 1.2) {
        F.tSpeed[i] = sw.maxSpeed * 0.6;
        if (this.mode[i] !== Mode.Burst) {
          this.mode[i] = Mode.Burst;
          F.modeT[i] = 0.3;
        }
      } else {
        F.tSpeed[i] = Math.max(sw.cruiseSpeed * 0.3, fd * sw.maxSpeed * 0.45);
        this.mode[i] = Mode.Cruise;
        F.modeT[i] = 0.5;
      }
    } else if (far && this.mode[i] === Mode.Hover) {
      this.mode[i] = Mode.Cruise;
      F.modeT[i] = 2;
      F.tSpeed[i] = sw.cruiseSpeed;
    }
  }

  private nextMode(i: number, cruise: number, max: number, rest: number) {
    const F = this.f;
    const r = this.rand();
    const prev = this.mode[i];
    let next: Mode;
    if (rest > 0.6) next = r < 0.55 ? Mode.Hover : Mode.Cruise;
    else if (prev === Mode.Burst) next = Mode.Glide;
    else if (prev === Mode.Glide) next = r < 0.55 ? Mode.Cruise : r < 0.8 ? Mode.Hover : Mode.Burst;
    else if (prev === Mode.Hover) next = r < 0.6 ? Mode.Cruise : Mode.Burst;
    else next = r < 0.3 ? Mode.Burst : r < 0.55 ? Mode.Hover : Mode.Cruise;
    this.mode[i] = next;
    const slow = 1 - 0.65 * rest;
    switch (next) {
      case Mode.Burst:
        F.modeT[i] = 0.25 + this.rand() * 0.35;
        F.tSpeed[i] = max * (0.5 + this.rand() * 0.3);
        break;
      case Mode.Glide:
        F.modeT[i] = 0.7 + this.rand() * 1.3;
        F.tSpeed[i] = cruise * 0.25 * slow;
        break;
      case Mode.Hover:
        F.modeT[i] = (1.2 + this.rand() * 3) * (1 + rest);
        F.tSpeed[i] = 0.03;
        break;
      default:
        F.modeT[i] = 1.5 + this.rand() * 3.5;
        F.tSpeed[i] = cruise * (0.7 + this.rand() * 0.5) * slow;
    }
  }

  private nearestPlant(x: number, z: number) {
    const m = this.plantHash.query(x, 0, z, COVER_SENSE, this.plantCandidates);
    let best = -1;
    let bestD = COVER_SENSE * COVER_SENSE;
    for (let k = 0; k < m; k++) {
      const j = this.plantCandidates[k];
      const dx = this.plantX[j] - x, dz = this.plantZ[j] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  }

  private integrate(i: number, dt: number, daylight: number) {
    const F = this.f;
    const def = this.speciesList[this.species[i]].def;
    const sw = def.swim!;
    const mode = this.mode[i];
    const act = activityLevel(def.activity, daylight);
    let speed = F.speed[i];

    // Turning: rate-limited, slower fish turn a bit slower (pectoral turns are still possible).
    const dYaw = yawOf(F.dX[i], F.dZ[i]);
    const horiz = Math.hypot(F.dX[i], F.dZ[i]);
    const speedK = Math.min(1, speed / sw.cruiseSpeed);
    const cap = sw.turnRate * (0.45 + 0.55 * speedK) * (F.feed[i] >= 0 ? 1.4 : 1);
    const diff = horiz > 1e-4 ? angleDelta(F.yaw[i], dYaw) : 0;
    F.yawRate[i] = damp(F.yawRate[i], clamp(diff * 2.2, -cap, cap), 6, dt);
    F.yaw[i] = wrapAngle(F.yaw[i] + F.yawRate[i] * dt);
    const dPitch = clamp(Math.atan2(F.dY[i], horiz), -0.6, 0.6) * Math.min(1, 0.25 + speedK);
    F.pitch[i] = damp(F.pitch[i], dPitch, 2.5, dt);

    // Speed: quick to accelerate in a burst, long low-drag glides.
    const tS = F.tSpeed[i];
    if (speed < tS) speed = approach(speed, tS, (mode === Mode.Burst ? sw.maxSpeed * 3 : sw.cruiseSpeed * 1.2) * dt);
    else speed = damp(speed, tS, mode === Mode.Glide ? 0.7 : 1.8, dt);
    F.speed[i] = speed;

    // Tail effort: hard in bursts, none while gliding, gentle while cruising/hovering.
    let thrustT: number;
    if (mode === Mode.Glide) thrustT = 0;
    else if (mode === Mode.Burst) thrustT = 1;
    else if (mode === Mode.Hover) thrustT = 0.04;
    else thrustT = 0.2 + 0.6 * clamp(speed / sw.maxSpeed, 0, 1) + (tS > speed + 0.05 ? 0.2 : 0);
    F.thrust[i] = damp(F.thrust[i], thrustT, mode === Mode.Glide ? 5 : 10, dt);
    const thrust = F.thrust[i];
    const turn = Math.abs(F.yawRate[i]);
    F.tailAmp[i] = 0.012 + 0.11 * thrust + Math.min(0.04, turn * 0.012);
    const tailHz = 0.8 + 6.5 * thrust + turn * 0.4;
    F.tailPh[i] = (F.tailPh[i] + TAU * tailHz * dt) % TAU;

    // Pectorals: busy when slow (hovering, manoeuvring), tucked in fast swimming.
    const pecT = clamp(1.15 - speed / (sw.cruiseSpeed * 1.6), 0.15, 1) * (0.55 + 0.45 * act) + Math.min(0.3, turn * 0.15);
    F.pecAmp[i] = damp(F.pecAmp[i], Math.min(1, pecT), 4, dt);
    F.pecPh[i] = (F.pecPh[i] + TAU * (2.2 + 2 * F.pecAmp[i]) * dt) % TAU;

    // Body C-bend into turns and banking.
    F.bend[i] = damp(F.bend[i], clamp(F.yawRate[i] * 0.045, -0.12, 0.12), 8, dt);
    F.roll[i] = damp(F.roll[i], clamp(-F.yawRate[i] * Math.min(speed, 1.2) * 0.28, -0.4, 0.4), 5, dt);

    // Move.
    const cp = Math.cos(F.pitch[i]);
    let px = F.px[i] + Math.cos(F.yaw[i]) * cp * speed * dt;
    let py = F.py[i] + Math.sin(F.pitch[i]) * speed * dt;
    let pz = F.pz[i] - Math.sin(F.yaw[i]) * cp * speed * dt;
    // Slow fish adjust depth with their fins (settling at night, rising off the seabed) without
    // having to pitch, plus a gentle hover bob.
    py += clamp(F.dY[i], -1, 1) * 0.3 * (1 - speedK) * dt;
    py += Math.sin(this.time * 1.7 + F.seed[i] * 40) * 0.025 * F.pecAmp[i] * dt;

    const len = sw.bodyLength * F.scale[i];
    const floor = terrainHeight(px, pz) + len * 0.3 + 0.02;
    if (py < floor) py = floor;
    if (py > SURFACE_Y - 0.3) py = SURFACE_Y - 0.3;
    const lim = WORLD_HALF - 2;
    px = clamp(px, -lim, lim);
    pz = clamp(pz, -lim, lim);
    F.px[i] = px;
    F.py[i] = py;
    F.pz[i] = pz;
  }

  private writeOut(i: number) {
    const F = this.f;
    const info = this.speciesList[this.species[i]];
    const q = this.quat;
    quatYawPitchRoll(F.yaw[i], F.pitch[i], F.roll[i], q, 0);
    const t = this.transforms[i];
    t.position.set(F.px[i], F.py[i], F.pz[i]);
    t.quaternion.set(q[0], q[1], q[2], q[3]);
    const b = info.batch;
    const s = this.slot[i];
    const scale = info.def.swim!.bodyLength * F.scale[i];
    composeMatrix(b.matrices, s * 16, F.px[i], F.py[i], F.pz[i], q[0], q[1], q[2], q[3], scale);
    b.swim[s * 4] = F.tailPh[i];
    b.swim[s * 4 + 1] = F.tailAmp[i];
    b.swim[s * 4 + 2] = F.pecPh[i];
    b.swim[s * 4 + 3] = F.pecAmp[i];
    b.bend[s] = F.bend[i];
  }
}

/** Default resolver key helper: a design's layer, else the species template, else 0. */
export function fallbackLayer(layerOf: (id: string) => number): LayerResolver {
  return (designId, speciesId) => {
    const l = layerOf(designId);
    if (l >= 0) return l;
    return Math.max(0, layerOf(templateDesignId(speciesId)));
  };
}
