import { Color, FogExp2, ShaderChunk } from 'three';
import { SURFACE_Y } from '../../core/terrain';

/**
 * Shared "water volume" look: one function decides the colour of water seen in a given direction,
 * used by the fog of every material, the backdrop and the water surface, so far objects always
 * dissolve into exactly the colour behind them, in every direction.
 *
 * All values here live in display (sRGB) space, because three applies fog after tone mapping and
 * colour-space conversion.
 */

const S = SURFACE_Y.toFixed(1);

export const WATER_GLSL = /* glsl */ `
vec3 noaWaterColor(vec3 base, float dirY, float camY) {
  float up = smoothstep(-0.55, 0.95, dirY);
  up = up * up * (3.0 - 2.0 * up);
  vec3 deep = base * vec3(0.30, 0.40, 0.48);
  vec3 high = base * 1.55 + vec3(0.03, 0.07, 0.08) * base.b;
  vec3 c = mix(deep, high, up);
  float camK = clamp(camY / ${S}, 0.0, 1.0);
  return c * mix(0.86, 1.1, camK);
}
vec3 noaFogFactor(float density, float dist) {
  float k = density * dist;
  k *= k;
  // Red is absorbed first, so distant things turn blue-green before they vanish.
  return 1.0 - exp(-k * vec3(1.5, 1.0, 0.92));
}
`;

/** Live fog: DayNight updates its colour (linear) and density. */
export const waterFog = new FogExp2(0x1d7f99, 0.019);

/** Uniforms for the custom water shaders. Colours are display-space (sRGB). */
export const waterUniforms = {
  uFogColor: { value: new Color(0.1, 0.45, 0.55) },
  uFogDensity: { value: 0.019 },
  /** Bright tint of the sky seen through Snell's window. */
  uSkyColor: { value: new Color(0.8, 0.95, 1) },
  /** Sun/moon glint colour on the surface and in god rays. */
  uSunColor: { value: new Color(1, 0.95, 0.8) },
  /** Marine-snow tint. */
  uSnowColor: { value: new Color(0.8, 0.9, 0.95) },
};

let installed = false;

/**
 * Replaces three's fog chunks once, before any material compiles. Every material with fog enabled
 * (ours and other modules') gets direction-dependent water colour and per-channel absorption.
 * Still driven by scene.fog (FogExp2 colour/density), so nothing else needs to change.
 */
export function installWaterFog() {
  if (installed) return;
  installed = true;
  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vNoaFogOff;
#endif
`;
  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vNoaFogOff = mvPosition.xyz * mat3( viewMatrix );
#endif
`;
  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vNoaFogOff;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${WATER_GLSL}
#endif
`;
  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float noaDist = length( vNoaFogOff );
  float noaDirY = noaDist > 1e-4 ? vNoaFogOff.y / noaDist : 0.0;
  vec3 noaFogC = noaWaterColor( fogColor, noaDirY, cameraPosition.y );
  #ifdef FOG_EXP2
    vec3 noaF = noaFogFactor( fogDensity, noaDist );
  #else
    vec3 noaF = vec3( smoothstep( fogNear, fogFar, noaDist ) );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, noaFogC, noaF );
#endif
`;
}

installWaterFog();
