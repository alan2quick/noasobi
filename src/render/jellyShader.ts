import { DoubleSide, MeshLambertMaterial } from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { envUniforms } from '../core/runtime';
import { applyDesignArray } from './designTextures';

/**
 * Translucent, pulsing, night-glowing jellyfish material for 'swim-jelly' species.
 *
 * Geometry attribute `aJ` (vec4), see species/jellyfish/geometry.ts:
 *   x = bell weight (0 apex .. 1 rim), y = trail (0 attachment .. 1 tip), z = hanging length (m),
 *   w = per-part phase (rad)
 * Per-instance attributes written by the sim (jellySim.ts) every frame:
 *   aPulse (vec4): x = pulse phase (cycles), y = pulse amplitude 0..1, z = seed
 *   aVel (vec3)  : water-relative velocity, world axes (m/s); arms and tentacles trail behind it
 *   aDesignLayer : design texture layer (designTextures.ts)
 *
 * All motion is in the vertex shader. The pulse curve is the same as `pulseContraction` in
 * sim/jellySim.ts (squeeze fast, relax slowly with a small flare). The bell squeezes inwards and
 * its rim pulls in and down; arms and tentacles run the same pulse a little later the further
 * they hang (a wave travelling down), trail opposite the velocity, hang towards true world-down
 * when the bell leans, sway, and drift with the water current.
 *
 * Transparency: a single instanced draw with no depth writes. three renders transparent
 * double-sided materials as a back-face pass then a front-face pass (so 2 draw calls per
 * species); instances are not sorted against each other, which is fine for soft pale shapes.
 */

const VERT_PARS = /* glsl */ `
attribute vec4 aJ;
attribute vec4 aPulse;
attribute vec3 aVel;
uniform float uTime;
uniform vec2 uCurrent;
varying float vPulse;
varying float vTrail;

float jellyPulse( float x ) {
  x = fract( x );
  float rise = smoothstep( 0.0, 0.28, x );
  float fall = smoothstep( 0.28, 0.62, x );
  return rise - 1.15 * fall + 0.15 * smoothstep( 0.55, 1.0, x );
}
`;

// Replaces <project_vertex>: deform in object space, go to world space with the instance matrix,
// add the world-space trailing / current / sway offsets, then project.
const VERT_PROJECT = /* glsl */ `
vec3 jp = transformed;
float jW = aJ.x;
float jTrail = aJ.y;
float jHang = aJ.z;
float jAmp = aPulse.y;
// Pulse, running later further down the hanging parts.
float jC = jellyPulse( aPulse.x - jTrail * 0.17 ) * jAmp;
float jRim = pow( jW, 1.4 );
// Hanging parts follow the rim's squeeze near their root only.
float jRadial = 1.0 - 0.3 * jC * jRim * ( 1.0 - 0.55 * jTrail );
jp.xz *= jRadial;
// The rim drops as the bell squeezes (longer, narrower bell), the crown lifts a touch.
jp.y -= 0.05 * jC * jRim;
jp.y += 0.015 * jC * ( 1.0 - jW ) * step( jTrail, 0.001 );
vPulse = jC;
vTrail = jTrail;

vec4 mvPosition = vec4( jp, 1.0 );
float jS = 1.0;
mat3 jR = mat3( 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  jS = length( instanceMatrix[ 0 ].xyz );
  jR = mat3( instanceMatrix ) / jS;
#endif
if ( jTrail > 0.0 ) {
  float tt = jTrail * jTrail;
  // Trail opposite the swimming velocity (less vertically, so lengths hold).
  vec3 off = -vec3( aVel.x, aVel.y * 0.4, aVel.z ) * 0.55 * tt;
  float ol = length( off );
  float maxL = 0.5 * jHang;
  off *= min( 1.0, maxL / max( ol, 1e-4 ) );
  off *= jS;
  // Hang towards world-down even when the bell leans.
  off += ( vec3( 0.0, -1.0, 0.0 ) - jR * vec3( 0.0, -1.0, 0.0 ) ) * jHang * jS * jTrail * 0.55;
  // Water current streams them out.
  off.xz += uCurrent * 0.22 * tt * jS;
  // Gentle sway, out of step between parts, growing towards the tips.
  float ph = aJ.w + aPulse.z * 6.2831853;
  float sw1 = sin( uTime * 1.3 + ph - jTrail * 4.5 );
  float sw2 = sin( uTime * 0.9 + ph * 1.7 - jTrail * 3.2 );
  off += vec3( sw1, 0.0, sw2 ) * 0.07 * jHang * jS * pow( jTrail, 1.4 );
  mvPosition.xyz += off;
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

const FRAG_PARS = /* glsl */ `
uniform float uDaylight;
uniform float uGlow;
varying float vPulse;
varying float vTrail;
`;

// Fresnel rim, glow at night tinted by the painted colour, thinner / fainter tentacle tips.
const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  float jFr = 1.0 - abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
  float jFr2 = jFr * jFr;
  float jNight = 1.0 - uDaylight;
  vec3 jCol = diffuseColor.rgb;
  float jPart = step( 0.001, vTrail );
  // Soft inner light so it never reads as a grey lump, plus a bright pale edge.
  totalEmissiveRadiance += jCol * ( 0.16 + 0.12 * uDaylight );
  totalEmissiveRadiance += mix( jCol, vec3( 1.0 ), 0.55 ) * jFr2 * ( 0.28 + 0.2 * uDaylight );
  // Night glow: stronger for the bell, pulsing a little with each squeeze.
  totalEmissiveRadiance += jCol * uGlow * jNight * ( 1.1 - 0.3 * jPart + 0.5 * vPulse );
  float a = diffuseColor.a;
  a = mix( a, min( 1.0, a + 0.22 ), jPart );
  a *= 1.0 - 0.55 * smoothstep( 0.45, 1.0, vTrail );
  a += jFr2 * 0.3 + uGlow * jNight * 0.12;
  diffuseColor.a = clamp( a, 0.0, 0.95 );
}
`;

export interface JellyMaterialOptions {
  /** Night glow strength 0..1 (SpeciesDef.drift.nightGlow). */
  glow: number;
  /** Base opacity of the bell, about 0.6..0.8. */
  opacity?: number;
}

/** One material per jelly species (the compiled program is shared between them). */
export function createJellyMaterial({ glow, opacity = 0.7 }: JellyMaterialOptions) {
  const material = new MeshLambertMaterial({
    side: DoubleSide,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const local = { uGlow: { value: glow } };
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    applyDesignArray(shader);
    shader.uniforms.uTime = envUniforms.uTime;
    shader.uniforms.uCurrent = envUniforms.uCurrent;
    shader.uniforms.uDaylight = envUniforms.uDaylight;
    Object.assign(shader.uniforms, local);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', VERT_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
  };
  material.customProgramCacheKey = () => 'noasobi-jelly-1';
  return Object.assign(material, { jellyUniforms: local });
}
