import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { SRGBColorSpace, type DirectionalLight, type HemisphereLight } from 'three';
import { clock, envUniforms, runtime } from '../../core/runtime';
import { daylightAt, evaluateLook, lightDirAt, sunElevation } from './dayNight';
import { waterFog, waterUniforms } from './water';

const JUMP_SECONDS = 2;

/**
 * Owns the day/night clock and the lights. Advances clock.timeOfDay, eases toward clock.target,
 * and writes runtime.daylight plus the shared env uniforms, fog, and water uniforms.
 */
export function DayNightClock() {
  const hemi = useRef<HemisphereLight>(null);
  const sun = useRef<DirectionalLight>(null);
  const jump = useRef({ active: false, target: 0, from: 0, delta: 0, t: 0 });

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.1);
    const j = jump.current;

    if (clock.target !== null && (!j.active || clock.target !== j.target)) {
      j.active = true;
      j.target = clock.target;
      j.from = clock.timeOfDay;
      let d = (clock.target - clock.timeOfDay) % 1;
      if (d > 0.5) d -= 1;
      if (d < -0.5) d += 1;
      j.delta = d;
      j.t = 0;
    }
    if (j.active) {
      j.t = Math.min(1, j.t + dt / JUMP_SECONDS);
      const e = j.t * j.t * (3 - 2 * j.t);
      clock.timeOfDay = (((j.from + j.delta * e) % 1) + 1) % 1;
      if (j.t >= 1) {
        j.active = false;
        clock.target = null;
      }
    } else {
      clock.timeOfDay = (clock.timeOfDay + dt / clock.dayLength) % 1;
    }

    const tod = clock.timeOfDay;
    const daylight = daylightAt(tod);
    runtime.daylight = daylight;
    envUniforms.uTime.value = state.clock.elapsedTime;
    envUniforms.uDaylight.value = daylight;
    envUniforms.uCaustics.value = 0.55 + 0.45 * Math.max(0, sunElevation(tod));
    lightDirAt(tod, envUniforms.uSunDir.value);

    const look = evaluateLook(tod);
    waterFog.color.copy(look.fog);
    waterFog.density = look.density;
    look.fog.getRGB(waterUniforms.uFogColor.value, SRGBColorSpace);
    waterUniforms.uFogDensity.value = look.density;
    look.sky.getRGB(waterUniforms.uSkyColor.value, SRGBColorSpace);
    look.sun.getRGB(waterUniforms.uSunColor.value, SRGBColorSpace);
    look.snow.getRGB(waterUniforms.uSnowColor.value, SRGBColorSpace);

    if (hemi.current) {
      hemi.current.color.copy(look.hemiSky);
      hemi.current.groundColor.copy(look.hemiGround);
      hemi.current.intensity = look.hemiIntensity;
    }
    if (sun.current) {
      sun.current.color.copy(look.sun);
      sun.current.intensity = look.sunIntensity;
      sun.current.position.copy(envUniforms.uSunDir.value).multiplyScalar(50);
    }
  }, -2);

  return (
    <>
      {/* Attached during commit (not in an effect) so materials compile with fog on the first frame. */}
      <primitive object={waterFog} attach="fog" />
      <hemisphereLight ref={hemi} args={['#d4f6ff', '#8f8463', 1.4]} />
      <directionalLight ref={sun} position={[15, 50, 10]} intensity={1.8} />
    </>
  );
}
