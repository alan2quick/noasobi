import { Quaternion, Vector3 } from 'three';
import type { PlacedEntity, SpeciesDef } from '../core/types';
import { templateDesignId } from '../core/types';
import { envUniforms, runtime } from '../core/runtime';
import type { LiveTransform } from '../core/runtime';
import { SURFACE_Y, WORLD_HALF, terrainHeight } from '../core/terrain';
import { SpatialHash } from './spatialHash';
import { TAU, activityLevel, boundsSteer, clamp, composeMatrix, damp, hash01, lodInterval, smoothstep, wrapAngle } from './steering';

/**
 * Pulse-and-drift sim for every creature with locomotion 'swim-jelly' (all species share one SoA
 * and one neighbour hash). Everything species-specific comes from SpeciesDef.drift/habitat/activity.
 *
 * Motion model (per jelly):
 *  - A pulse clock `phase` (cycles). Each cycle the bell squeezes (power stroke, phase 0 .. POWER)
 *    and gives an impulse of `pulseThrust` m/s along the bell axis, spread over the stroke.
 *  - Water-relative velocity `w` is dragged back to a slow sink (0, -sinkSpeed, 0) between pulses.
 *  - The bell axis leans slowly (max MAX_TILT, wandering target) and spins gently; the pulse
 *    pushes along the axis, so leaning is also how it steers.
 *  - It is carried along by the water current (CARRY of envUniforms.uCurrent), softly pulled back
 *    to its anchor beyond HOME_R, pushed out of other jellies, and kept inside its habitat band.
 *  - Pulses are weaker when above the target height and stronger below, so the sawtooth
 *    rise/sink keeps it near the anchor's height without any hard vertical forces.
 * Steering runs at a camera-distance LOD; kinematics and render writes run every frame.
 */

/** Fraction of a pulse cycle spent on the power stroke (the bell contracting). */
export const POWER = 0.28;
/** Largest tilt of the bell axis from vertical, radians (about 25 degrees). */
export const MAX_TILT = 0.43;
/** Soft return to the anchor starts here, metres. */
export const HOME_R = 5;
/** Share of the water current the jelly is carried along with. */
const CARRY = 0.25;
/** Drag on the water-relative velocity, 1/s. */
const DRAG = 3;

// ── Pure helpers ───────────────────────────────────────────────────────────────────────────────

/**
 * Bell contraction over a pulse cycle: 0 relaxed, 1 fully squeezed. A quick squeeze (power stroke),
 * a slower relaxation that overshoots slightly (the bell flares), then rest. Continuous and
 * periodic. The vertex shader uses the same curve (keep jellyShader.ts in sync).
 */
export function pulseContraction(x: number): number {
  x -= Math.floor(x);
  const rise = smoothstep(0, POWER, x);
  const fall = smoothstep(POWER, 0.62, x);
  return rise - 1.15 * fall + 0.15 * smoothstep(0.55, 1, x);
}

/** Cumulative share (0..1) of a pulse's thrust delivered by phase x within one cycle. */
export function thrustShare(x: number): number {
  if (x <= 0) return 0;
  if (x >= POWER) return 1;
  return x / POWER - Math.sin((TAU * x) / POWER) / TAU;
}

/** Thrust share delivered while the phase advances from p0 to p0 + dph (p0 in [0,1), dph < 1). */
export function pulseImpulse(p0: number, dph: number): number {
  const p1 = p0 + dph;
  const cum = (x: number) => Math.floor(x) + thrustShare(x - Math.floor(x));
  return cum(p1) - cum(p0);
}

/**
 * Orientation of a jelly: the bell axis leans by the vector (lx, lz) (its length is the tilt angle,
 * and the axis tips towards that horizontal direction), after spinning by `yaw` about the axis.
 * Writes x, y, z, w to out[o..o+3].
 */
export function jellyQuat(lx: number, lz: number, yaw: number, out: Float32Array | number[], o = 0) {
  const a = Math.hypot(lx, lz);
  let tx = 0, tz = 0, tw = 1;
  if (a > 1e-6) {
    const s = Math.sin(a / 2) / a;
    // Rotation taking +Y to (sin a * lx/a, cos a, sin a * lz/a) is about (lz, 0, -lx).
    tx = s * lz;
    tz = -s * lx;
    tw = Math.cos(a / 2);
  }
  const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2);
  // q = qTilt * qYaw, with qTilt = (tx, 0, tz, tw) and qYaw = (0, sy, 0, cy).
  out[o] = tx * cy - tz * sy;
  out[o + 1] = tw * sy;
  out[o + 2] = tx * sy + tz * cy;
  out[o + 3] = tw * cy;
}

/** How strongly a jelly pulses: 1 at full activity, a calmer 0.45 when its activity is low. */
export function pulseRateFactor(act: number): number {
  return 0.45 + 0.55 * act;
}

// ── Sim ────────────────────────────────────────────────────────────────────────────────────────

/** Render buffers for one species' InstancedMesh. Owned by the sim, bound by the renderer. */
export interface JellyBatch {
  species: SpeciesDef;
  capacity: number;
  count: number;
  /** capacity * 16, column-major instance matrices (scale = entity scale; geometry is in metres). */
  matrices: Float32Array;
  /** capacity * 4: pulse phase (cycles), pulse amplitude 0..1, per-jelly seed, unused. */
  pulse: Float32Array;
  /** capacity * 3: water-relative velocity (world axes), m/s. */
  vel: Float32Array;
  /** capacity: design texture layer. */
  layers: Float32Array;
  slotToJelly: Int32Array;
  /** Bumped whenever the arrays above are reallocated. */
  generation: number;
  /** Set when `layers` changed; the renderer clears it after uploading. */
  layersDirty: boolean;
}

/** Resolves a design id to a texture layer (injected so the sim stays testable without DOM). */
export type LayerResolver = (designId: string, speciesId: string) => number;

const FIELDS = [
  'px', 'py', 'pz', 'ax', 'ay', 'az', 'wx', 'wy', 'wz', 'fx', 'fy', 'fz', 'lx', 'lz', 'ltx', 'ltz',
  'yaw', 'yawRate', 'yawT', 'phase', 'rateK', 'amp', 'scale', 'seed', 'wTimer', 'steerAcc', 'thrustK',
] as const;
type Field = (typeof FIELDS)[number];

const MAX_NEIGHBOURS = 48;

export class JellySim {
  n = 0;
  private cap = 0;
  private f = {} as Record<Field, Float32Array>;
  private species = new Uint16Array(0);
  private slot = new Int32Array(0);
  private ids: string[] = [];
  private designIds: string[] = [];
  private transforms: LiveTransform[] = [];
  private index = new Map<string, number>();

  private speciesList: { def: SpeciesDef; batch: JellyBatch }[] = [];
  private speciesIndex = new Map<string, number>();

  private hash = new SpatialHash(2.5, false, 128, 9);
  private neighbours = new Int32Array(MAX_NEIGHBOURS);

  private frame = 0;
  time = 0;
  private quat = new Float32Array(4);
  private rngState = 7;

  constructor(
    private getSpecies: (id: string) => SpeciesDef,
    private resolveLayer: LayerResolver = () => 0,
  ) {
    this.grow(32);
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
    const copy = <T extends Uint16Array | Int32Array>(a: T, b: T) => (b.set(a.subarray(0, this.n)), b);
    this.species = copy(this.species, new Uint16Array(cap));
    this.slot = copy(this.slot, new Int32Array(cap));
    this.cap = cap;
  }

  private speciesInfo(def: SpeciesDef): number {
    let si = this.speciesIndex.get(def.id);
    if (si !== undefined) return si;
    si = this.speciesList.length;
    const cap = 32;
    this.speciesList.push({
      def,
      batch: {
        species: def,
        capacity: cap,
        count: 0,
        matrices: new Float32Array(cap * 16),
        pulse: new Float32Array(cap * 4),
        vel: new Float32Array(cap * 3),
        layers: new Float32Array(cap),
        slotToJelly: new Int32Array(cap),
        generation: 0,
        layersDirty: true,
      },
    });
    this.speciesIndex.set(def.id, si);
    return si;
  }

  /** Render batch for a species (created on demand, possibly empty). */
  batchFor(def: SpeciesDef): JellyBatch {
    return this.speciesList[this.speciesInfo(def)].batch;
  }

  private growBatch(b: JellyBatch) {
    const cap = b.capacity * 2;
    const grow = (a: Float32Array, per: number) => {
      const out = new Float32Array(cap * per);
      out.set(a);
      return out;
    };
    b.matrices = grow(b.matrices, 16);
    b.pulse = grow(b.pulse, 4);
    b.vel = grow(b.vel, 3);
    b.layers = grow(b.layers, 1);
    const s2j = new Int32Array(cap);
    s2j.set(b.slotToJelly);
    b.slotToJelly = s2j;
    b.capacity = cap;
    b.generation++;
    b.layersDirty = true;
  }

  // ── Entity sync ──────────────────────────────────────────────────────────────────────────────
  /** Diffs the placed entities: adds new jellies at their anchor, removes deleted ones, updates others. */
  sync(entities: PlacedEntity[]) {
    const keep = new Set<string>();
    for (const e of entities) {
      let def: SpeciesDef;
      try {
        def = this.getSpecies(e.speciesId);
      } catch {
        continue;
      }
      if (def.locomotion !== 'swim-jelly' || !def.drift) continue;
      keep.add(e.id);
      const i = this.index.get(e.id);
      if (i === undefined) this.add(e, def);
      else this.update(i, e);
    }
    for (let i = this.n - 1; i >= 0; i--) if (!keep.has(this.ids[i])) this.remove(i);
  }

  private add(e: PlacedEntity, def: SpeciesDef) {
    if (this.n >= this.cap) this.grow(this.cap * 2);
    const i = this.n++;
    const F = this.f;
    for (const k of FIELDS) F[k][i] = 0;
    const si = this.speciesInfo(def);
    F.px[i] = F.ax[i] = e.position[0];
    F.py[i] = F.ay[i] = e.position[1];
    F.pz[i] = F.az[i] = e.position[2];
    F.yaw[i] = wrapAngle(e.rotationY);
    F.scale[i] = e.scale;
    F.seed[i] = this.rand();
    F.phase[i] = this.rand();
    F.rateK[i] = 0.85 + this.rand() * 0.3;
    F.amp[i] = 1;
    F.thrustK[i] = 1;
    F.wTimer[i] = this.rand() * 3;
    F.steerAcc[i] = 1;
    this.species[i] = si;
    this.ids[i] = e.id;
    this.designIds[i] = e.designId;
    this.index.set(e.id, i);

    const b = this.speciesList[si].batch;
    if (b.count >= b.capacity) this.growBatch(b);
    const s = b.count++;
    b.slotToJelly[s] = i;
    this.slot[i] = s;
    b.layers[s] = this.resolveLayer(e.designId, def.id);
    b.layersDirty = true;

    const t: LiveTransform = {
      position: new Vector3(),
      quaternion: new Quaternion(),
      radius: def.drift!.bellRadius * e.scale,
    };
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
      F.wx[i] = F.wy[i] = F.wz[i] = 0;
      F.yaw[i] = wrapAngle(e.rotationY);
      this.writeOut(i);
    }
    F.scale[i] = e.scale;
    this.transforms[i].radius = def.drift!.bellRadius * e.scale;
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
      const j = b.slotToJelly[last];
      b.slotToJelly[s] = j;
      this.slot[j] = s;
      b.matrices.copyWithin(s * 16, last * 16, last * 16 + 16);
      b.pulse.copyWithin(s * 4, last * 4, last * 4 + 4);
      b.vel.copyWithin(s * 3, last * 3, last * 3 + 3);
      b.layers[s] = b.layers[last];
      b.layersDirty = true;
    }
    b.count--;

    // Swap-remove from the SoA.
    const lastI = this.n - 1;
    if (i !== lastI) {
      for (const k of FIELDS) this.f[k][i] = this.f[k][lastI];
      this.species[i] = this.species[lastI];
      this.slot[i] = this.slot[lastI];
      this.ids[i] = this.ids[lastI];
      this.designIds[i] = this.designIds[lastI];
      this.transforms[i] = this.transforms[lastI];
      this.index.set(this.ids[i], i);
      const bl = this.speciesList[this.species[i]].batch;
      bl.slotToJelly[this.slot[i]] = i;
    }
    this.ids.length = lastI;
    this.designIds.length = lastI;
    this.transforms.length = lastI;
    this.n = lastI;
  }

  /** Re-resolves every jelly's design layer (call when design textures change). */
  refreshLayers() {
    for (let i = 0; i < this.n; i++) {
      const info = this.speciesList[this.species[i]];
      info.batch.layers[this.slot[i]] = this.resolveLayer(this.designIds[i], info.def.id);
      info.batch.layersDirty = true;
    }
  }

  /** Index of a jelly by entity id (or -1). */
  indexOf(id: string) {
    return this.index.get(id) ?? -1;
  }

  // ── Read-only views for tests / debugging ────────────────────────────────────────────────────
  position(i: number, out: Vector3 = new Vector3()) {
    return out.set(this.f.px[i], this.f.py[i], this.f.pz[i]);
  }
  /** Tilt of the bell axis from vertical, radians. */
  tilt(i: number) {
    return Math.hypot(this.f.lx[i], this.f.lz[i]);
  }
  phase(i: number) {
    return this.f.phase[i];
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
        this.steer(i, F.steerAcc[i]);
        F.steerAcc[i] = 0;
      }
    }
    const cx = envUniforms.uCurrent.value.x;
    const cz = envUniforms.uCurrent.value.y;
    for (let i = 0; i < this.n; i++) {
      this.integrate(i, dt, daylight, cx, cz);
      this.writeOut(i);
    }
  }

  /** Slow decisions: lean target, home pull, separation, height control. */
  private steer(i: number, dt: number) {
    const F = this.f;
    const def = this.speciesList[this.species[i]].def;
    const hab = def.habitat;
    const px = F.px[i], py = F.py[i], pz = F.pz[i];
    const radius = def.drift!.bellRadius * F.scale[i];

    // Wander: a new lean target every few seconds.
    F.wTimer[i] -= dt;
    if (F.wTimer[i] <= 0) {
      F.wTimer[i] = 4 + this.rand() * 5;
      const a = this.rand() * TAU;
      const m = Math.pow(this.rand(), 0.7) * MAX_TILT * 0.85;
      F.ltx[i] = Math.cos(a) * m;
      F.ltz[i] = Math.sin(a) * m;
      F.yawT[i] = (this.rand() - 0.5) * 0.6;
    }

    let fx = 0, fy = 0, fz = 0;

    // Home: beyond HOME_R lean towards the anchor and add a gentle pull.
    const hx = F.ax[i] - px, hz = F.az[i] - pz;
    const hd = Math.hypot(hx, hz);
    if (hd > HOME_R * 0.6) {
      const k = smoothstep(HOME_R * 0.6, HOME_R * 1.4, hd);
      const mag = Math.min(MAX_TILT, 0.15 + 0.06 * Math.max(0, hd - HOME_R));
      F.ltx[i] += ((hx / hd) * mag - F.ltx[i]) * k;
      F.ltz[i] += ((hz / hd) * mag - F.ltz[i]) * k;
      if (hd > HOME_R) {
        const pull = 0.3 * (hd - HOME_R);
        fx += (hx / hd) * pull;
        fz += (hz / hd) * pull;
      }
    }

    // World bounds.
    const lim = WORLD_HALF - 8;
    fx += boundsSteer(px, lim) * 0.8;
    fz += boundsSteer(pz, lim) * 0.8;

    // Height: aim for the anchor's height inside the habitat band by scaling the pulse thrust.
    const ground = terrainHeight(px, pz);
    const lo = ground + hab.heightMin;
    const hi = Math.min(ground + hab.heightMax, SURFACE_Y - 2.5);
    const target = clamp(F.ay[i], lo, Math.max(lo, hi));
    F.thrustK[i] = clamp(1 + 0.25 * (target - py), 0.08, 1.8);
    if (py < lo) fy += (lo - py) * 0.6;
    else if (py > hi) fy -= (py - hi) * 0.5;

    // Separation from other jellies.
    const m = this.hash.query(px, py, pz, radius * 4 + 1.5, this.neighbours);
    for (let k = 0; k < m; k++) {
      const j = this.neighbours[k];
      if (j === i) continue;
      const ox = px - F.px[j], oy = py - F.py[j], oz = pz - F.pz[j];
      const rj = this.speciesList[this.species[j]].def.drift!.bellRadius * F.scale[j];
      const sep = (radius + rj) * 2.2 + 0.4;
      const d2 = ox * ox + oy * oy + oz * oz;
      if (d2 >= sep * sep) continue;
      const d = Math.sqrt(d2);
      let nx: number, ny: number, nz: number;
      if (d < 1e-4) {
        const a = this.rand() * TAU;
        nx = Math.cos(a);
        ny = 0;
        nz = Math.sin(a);
      } else {
        nx = ox / d;
        ny = oy / d;
        nz = oz / d;
      }
      const w = (1 - d / sep) * 2.4;
      fx += nx * w;
      fy += ny * w * 0.6;
      fz += nz * w;
    }
    F.fx[i] = fx;
    F.fy[i] = fy;
    F.fz[i] = fz;
  }

  private integrate(i: number, dt: number, daylight: number, curX: number, curZ: number) {
    const F = this.f;
    const def = this.speciesList[this.species[i]].def;
    const drift = def.drift!;
    const act = activityLevel(def.activity, daylight);
    const rateMult = pulseRateFactor(act);

    // Pulse clock and thrust impulse along the (current) bell axis.
    const rate = drift.pulseRate * F.rateK[i] * rateMult;
    const dph = Math.min(0.9, rate * dt);
    const impulse = pulseImpulse(F.phase[i], dph) * drift.pulseThrust * F.thrustK[i] * F.amp[i];
    F.phase[i] = (F.phase[i] + dph) % 1;
    F.amp[i] = damp(F.amp[i], 0.6 + 0.4 * act, 0.5, dt);

    // Lean (slowly towards its target) and spin.
    let lx = damp(F.lx[i], F.ltx[i], 0.6, dt);
    let lz = damp(F.lz[i], F.ltz[i], 0.6, dt);
    const tilt = Math.hypot(lx, lz);
    if (tilt > MAX_TILT) {
      lx *= MAX_TILT / tilt;
      lz *= MAX_TILT / tilt;
    }
    F.lx[i] = lx;
    F.lz[i] = lz;
    F.yawRate[i] = damp(F.yawRate[i], F.yawT[i], 0.8, dt);
    F.yaw[i] = wrapAngle(F.yaw[i] + F.yawRate[i] * dt);

    // Water-relative velocity: forces, impulse, drag towards the slow sink.
    const a = Math.hypot(lx, lz);
    const sinA = a > 1e-6 ? Math.sin(a) / a : 1;
    let wx = F.wx[i] + F.fx[i] * dt + sinA * lx * impulse;
    let wy = F.wy[i] + F.fy[i] * dt + Math.cos(a) * impulse;
    let wz = F.wz[i] + F.fz[i] * dt + sinA * lz * impulse;
    const k = Math.exp(-DRAG * dt);
    wx *= k;
    wy = -drift.sinkSpeed + (wy + drift.sinkSpeed) * k;
    wz *= k;

    let px = F.px[i] + (wx + curX * CARRY) * dt;
    let py = F.py[i] + wy * dt;
    let pz = F.pz[i] + (wz + curZ * CARRY) * dt;

    // Hard limits: the seabed (with the bell and its tentacles' reach), the surface, the world edge.
    const floor = terrainHeight(px, pz) + 1 + 0.5 * F.scale[i];
    const ceil = SURFACE_Y - 2;
    if (py < floor) {
      py = floor;
      if (wy < 0) wy = 0;
    } else if (py > ceil) {
      py = ceil;
      if (wy > 0) wy = 0;
    }
    const lim = WORLD_HALF - 3;
    px = clamp(px, -lim, lim);
    pz = clamp(pz, -lim, lim);

    F.wx[i] = wx;
    F.wy[i] = wy;
    F.wz[i] = wz;
    F.px[i] = px;
    F.py[i] = py;
    F.pz[i] = pz;
  }

  private writeOut(i: number) {
    const F = this.f;
    const info = this.speciesList[this.species[i]];
    const q = this.quat;
    jellyQuat(F.lx[i], F.lz[i], F.yaw[i], q, 0);
    const t = this.transforms[i];
    t.position.set(F.px[i], F.py[i], F.pz[i]);
    t.quaternion.set(q[0], q[1], q[2], q[3]);
    const b = info.batch;
    const s = this.slot[i];
    composeMatrix(b.matrices, s * 16, F.px[i], F.py[i], F.pz[i], q[0], q[1], q[2], q[3], F.scale[i]);
    b.pulse[s * 4] = F.phase[i];
    b.pulse[s * 4 + 1] = F.amp[i];
    b.pulse[s * 4 + 2] = F.seed[i];
    b.pulse[s * 4 + 3] = 0;
    b.vel[s * 3] = F.wx[i];
    b.vel[s * 3 + 1] = F.wy[i];
    b.vel[s * 3 + 2] = F.wz[i];
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
