import { Vector2, Vector3, Quaternion } from 'three';

/**
 * Per-frame shared state that must not trigger React renders.
 * Writers: the day/night clock writes `daylight` and the env uniforms; the creature sim writes
 * `transforms`; the food system owns `food`. Readers: anything (camera follow, picking, audio).
 */

export interface LiveTransform {
  position: Vector3;
  quaternion: Quaternion;
  /** Approximate radius for picking, metres. */
  radius: number;
}

export interface FoodFlake {
  id: number;
  position: Vector3;
  alive: boolean;
}

export const runtime = {
  /** 0 = deep night, 1 = full day. */
  daylight: 1,
  /** Live transforms of moving entities, keyed by PlacedEntity.id. */
  transforms: new Map<string, LiveTransform>(),
  food: [] as FoodFlake[],
};

/**
 * Shader uniforms shared by every custom material. Pass these objects by reference into
 * `shader.uniforms` inside onBeforeCompile so a single write updates all materials.
 */
export const envUniforms = {
  uTime: { value: 0 },
  /** 0 = night .. 1 = day. */
  uDaylight: { value: 1 },
  /** Water current, xz direction scaled by strength (m/s). Plants sway along it. */
  uCurrent: { value: new Vector2(0.6, 0.25) },
  /** Strength of the caustic light pattern, 0..1. */
  uCaustics: { value: 1 },
  uSunDir: { value: new Vector3(0.3, 1, 0.2).normalize() },
};

/** Day/night clock, owned by the biome's clock. 0 = midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
export const clock = {
  timeOfDay: 0.35,
  /** Seconds for one full day. */
  dayLength: 360,
  /** Set by UI to jump smoothly to a time; the clock eases toward it then clears it. */
  target: null as number | null,
};
