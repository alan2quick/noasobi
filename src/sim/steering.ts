import type { Activity } from '../core/types';

/** Pure steering / kinematics helpers shared by creature sims. No allocations. */

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Wraps an angle to (-π, π]. */
export function wrapAngle(a: number) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Shortest signed angle from `from` to `to`. */
export function angleDelta(from: number, to: number) {
  return wrapAngle(to - from);
}

/** Moves `current` towards `target` by at most `maxStep`. */
export function approach(current: number, target: number, maxStep: number) {
  const d = target - current;
  if (d > maxStep) return current + maxStep;
  if (d < -maxStep) return current - maxStep;
  return target;
}

/** Frame-rate independent exponential smoothing (lambda = 1/s). */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return target + (current - target) * Math.exp(-lambda * dt);
}

/**
 * Heading yaw for a direction: rotation about +Y that turns local +X to (dx, ·, dz).
 * Positive yaw turns the nose towards -Z (the animal's left).
 */
export function yawOf(dx: number, dz: number) {
  return Math.atan2(-dz, dx);
}

/** 0..1 how awake/active a creature is at this daylight (0 night .. 1 day). */
export function activityLevel(activity: Activity, daylight: number) {
  switch (activity) {
    case 'diurnal':
      return smoothstep(0.15, 0.6, daylight);
    case 'nocturnal':
      return 1 - smoothstep(0.25, 0.7, daylight);
    case 'crepuscular':
      return 1 - smoothstep(0.15, 0.45, Math.abs(daylight - 0.5));
    default:
      return 1;
  }
}

/**
 * Vertical steering to keep `height` (above the seabed) inside [min, max], with a hard push away
 * from the seabed and the surface. Returns a desired vertical velocity-ish value (+ = up).
 */
export function heightBandSteer(height: number, min: number, max: number, depthBelowSurface: number) {
  let v = 0;
  if (height < min) v += (min - height) * 1.6 + 0.3;
  else if (height > max) v -= (height - max) * 0.8 + 0.15;
  if (height < 0.25) v += (0.25 - height) * 8;
  if (depthBelowSurface < 1.5) v -= (1.5 - depthBelowSurface) * 2;
  return v;
}

/** Inward push (along one axis) when beyond ±limit. */
export function boundsSteer(p: number, limit: number) {
  if (p > limit) return -(p - limit) * 0.6 - 0.2;
  if (p < -limit) return (-limit - p) * 0.6 + 0.2;
  return 0;
}

/** Simulation LOD: steer every N frames depending on camera distance squared. */
export function lodInterval(dist2: number) {
  if (dist2 < 18 * 18) return 1;
  if (dist2 < 35 * 35) return 2;
  if (dist2 < 60 * 60) return 4;
  return 8;
}

/**
 * Quaternion for yaw (about Y), then pitch (about local Z, + = nose up), then roll (about local
 * X, + = left flank tilts up). Written to out[o..o+3] as x, y, z, w.
 */
export function quatYawPitchRoll(yaw: number, pitch: number, roll: number, out: Float32Array | number[], o = 0) {
  const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5), sp = Math.sin(pitch * 0.5);
  const cr = Math.cos(roll * 0.5), sr = Math.sin(roll * 0.5);
  // a = qYaw(0, sy, 0, cy) * qPitch(0, 0, sp, cp)
  const ax = sy * sp;
  const ay = sy * cp;
  const az = cy * sp;
  const aw = cy * cp;
  // a * qRoll(sr, 0, 0, cr)
  out[o] = aw * sr + ax * cr;
  out[o + 1] = ay * cr + az * sr;
  out[o + 2] = az * cr - ay * sr;
  out[o + 3] = aw * cr - ax * sr;
}

/** Column-major 4x4 from position, quaternion (x,y,z,w) and uniform scale, into out[o..o+15]. */
export function composeMatrix(
  out: Float32Array,
  o: number,
  px: number,
  py: number,
  pz: number,
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  s: number,
) {
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  out[o] = (1 - (yy + zz)) * s;
  out[o + 1] = (xy + wz) * s;
  out[o + 2] = (xz - wy) * s;
  out[o + 3] = 0;
  out[o + 4] = (xy - wz) * s;
  out[o + 5] = (1 - (xx + zz)) * s;
  out[o + 6] = (yz + wx) * s;
  out[o + 7] = 0;
  out[o + 8] = (xz + wy) * s;
  out[o + 9] = (yz - wx) * s;
  out[o + 10] = (1 - (xx + yy)) * s;
  out[o + 11] = 0;
  out[o + 12] = px;
  out[o + 13] = py;
  out[o + 14] = pz;
  out[o + 15] = 1;
}

/** Small deterministic hash → [0, 1). */
export function hash01(n: number) {
  let h = Math.imul(n | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
