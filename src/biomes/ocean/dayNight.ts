import { Color, Vector3 } from 'three';
import { clock } from '../../core/runtime';

/**
 * Day/night helpers and the ocean colour palette.
 * timeOfDay: 0 = midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
 */

/** Smoothly jump (about 2 s) to late morning. */
export function jumpToDay() {
  clock.target = 0.45;
}

/** Smoothly jump (about 2 s) to the middle of the night. */
export function jumpToNight() {
  clock.target = 0.0;
}

/** Smoothly jump to any time of day (0..1). */
export function jumpToTime(t: number) {
  clock.target = ((t % 1) + 1) % 1;
}

export const isNight = () => sunElevation(clock.timeOfDay) < -0.05;

/** -1 at midnight, 0 at sunrise/sunset, 1 at noon. */
export function sunElevation(t: number) {
  return Math.sin((t - 0.25) * Math.PI * 2);
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0 = night .. 1 = day. */
export function daylightAt(t: number) {
  return smooth(-0.2, 0.3, sunElevation(t));
}

/** Peaks around sunrise and sunset. */
export function duskAt(t: number) {
  const e = sunElevation(t);
  return Math.exp(-((e / 0.22) ** 2));
}

/** Direction toward the light (sun by day, moon by night), steep because light refracts down. */
export function lightDirAt(t: number, out: Vector3) {
  const az = Math.cos((t - 0.25) * Math.PI * 2); // +1 at sunrise, -1 at sunset
  // Blend sun -> moon through dusk so caustics and rays never jump.
  const m = 1 - smooth(-0.3, 0.02, sunElevation(t));
  out.set(az * 0.55 * (1 - m) - az * 0.35 * m, 1, 0.22 - 0.4 * m);
  return out.normalize();
}

interface Look {
  fog: Color;
  density: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  sun: Color;
  sunIntensity: number;
  sky: Color;
  snow: Color;
}

const look = (
  fog: string,
  density: number,
  hemiSky: string,
  hemiGround: string,
  hemiIntensity: number,
  sun: string,
  sunIntensity: number,
  sky: string,
  snow: string,
): Look => ({
  fog: new Color(fog),
  density,
  hemiSky: new Color(hemiSky),
  hemiGround: new Color(hemiGround),
  hemiIntensity,
  sun: new Color(sun),
  sunIntensity,
  sky: new Color(sky),
  snow: new Color(snow),
});

// Colours are authored in sRGB hex; three converts them to linear.
const DAY = look('#2aa5bf', 0.02, '#d4f6ff', '#8f8463', 1.45, '#fff2d8', 1.9, '#e8fbff', '#e9f8ff');
const DUSK = look('#4f7f9a', 0.023, '#ffd9b0', '#5d5562', 1.05, '#ffb36b', 1.15, '#ffd9a8', '#ffe2c4');
const NIGHT = look('#17497a', 0.025, '#8fb0f0', '#2a3d6a', 1.35, '#b4ccff', 0.8, '#7d9ee0', '#9fbfff');

/** Mutable output, reused every frame. */
export const currentLook: Look = look('#000', 0, '#000', '#000', 0, '#000', 0, '#000', '#000');

function blend(out: Look, a: Look, b: Look, t: number) {
  out.fog.lerpColors(a.fog, b.fog, t);
  out.density = a.density + (b.density - a.density) * t;
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t);
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t);
  out.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t;
  out.sun.lerpColors(a.sun, b.sun, t);
  out.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t;
  out.sky.lerpColors(a.sky, b.sky, t);
  out.snow.lerpColors(a.snow, b.snow, t);
}

/** Evaluates the palette for a time of day into `currentLook`. No allocations. */
export function evaluateLook(t: number): Look {
  blend(currentLook, NIGHT, DAY, daylightAt(t));
  blend(currentLook, currentLook, DUSK, duskAt(t) * 0.75);
  return currentLook;
}
