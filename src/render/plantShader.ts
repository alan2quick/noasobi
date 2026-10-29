import { BufferGeometry, DoubleSide, Float32BufferAttribute, MeshLambertMaterial } from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { envUniforms } from '../core/runtime';
import { applyDesignArray } from './designTextures';

/**
 * Underwater sway for instanced plants (any species with locomotion 'sway-plant').
 *
 * Geometry attribute `aSway` (vec3):
 *   x = height along the plant (0 at the seabed .. 1 at the top), drives the bend
 *   y = flutter weight (0 rigid .. 1 free blade tip), extra flutter and trailing
 *   z = per-part phase (radians) so blades flutter out of step
 * `ensureSwayAttributes` derives a plain height-only version for plants that don't provide it.
 *
 * The bend is applied after the instance matrix, in world space, so the current direction is
 * correct whatever each instance's rotationY. Per-instance phase is hashed from the instance
 * position, so no extra attribute is needed.
 */

/** Adds a default `aSway` (height only, no flutter) when the species geometry has none. */
export function ensureSwayAttributes(geometry: BufferGeometry): BufferGeometry {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (!geometry.getAttribute('aSway')) {
    const pos = geometry.getAttribute('position');
    const maxY = Math.max(geometry.boundingBox!.max.y, 1e-3);
    const sway = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) sway[i * 3] = Math.max(0, pos.getY(i)) / maxY;
    geometry.setAttribute('aSway', new Float32BufferAttribute(sway, 3));
  }
  return geometry;
}

const VERT_PARS = /* glsl */ `
attribute vec3 aSway;
uniform float uTime;
uniform vec2 uCurrent;
uniform float uSwayHeight;
uniform float uSwayAmount;
`;

// Replaces <project_vertex>. `mvPosition` is first taken to world space (the InstancedMesh itself
// sits at the origin), displaced there, then projected.
const VERT_PROJECT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  float swScale = length( instanceMatrix[ 0 ].xyz );
  vec2 swAnchor = instanceMatrix[ 3 ].xz;
  mat3 swRot = mat3( instanceMatrix );
#else
  float swScale = 1.0;
  vec2 swAnchor = vec2( 0.0 );
  mat3 swRot = mat3( 1.0 );
#endif
{
  float h = aSway.x;
  float fl = aSway.y;
  float t = uTime;
  float iph = fract( sin( dot( swAnchor, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2831853;
  float cs = length( uCurrent );
  vec2 cd = cs > 1e-4 ? uCurrent / cs : vec2( 1.0, 0.0 );
  vec2 cp = vec2( -cd.y, cd.x );
  float H = uSwayHeight * swScale;

  // Base stays planted; bend grows with height.
  float prof = h * ( 0.2 + 0.8 * h );
  // Slow gusts modulate a steady lean into the current.
  float gust = 0.6 + 0.4 * sin( t * 0.23 + iph ) * sin( t * 0.097 + iph * 1.7 );
  // Wave surge: slow back-and-forth along the current; the phase lags with height so the motion
  // rolls up the stalk (buoyant, springy) instead of the whole plant tilting rigidly.
  float lag = h * 1.6;
  float surge = sin( t * 0.52 + iph - lag ) + 0.35 * sin( t * 0.87 + iph * 2.3 - lag * 1.4 );
  float sideSw = sin( t * 0.33 + iph * 1.3 - lag * 0.8 );
  // Faster, small secondary ripple travelling up the stalk.
  float ripple = sin( t * 1.7 + iph * 3.1 - h * 9.0 );

  vec2 off = cd * ( cs * 0.22 * gust + surge * 0.065 * ( 0.5 + cs ) )
           + cp * ( sideSw * 0.045 + ripple * 0.01 );
  off *= H * prof * uSwayAmount;
  // Roughly preserve length: leaning tips dip.
  float drop = dot( off, off ) / ( 2.0 * max( h * H, 0.3 ) );
  mvPosition.xz += off;
  mvPosition.y -= min( drop, 0.4 * h * H );

  // Blades: flutter along their own normal in a wave running to the tip, and trail downstream.
  if ( fl > 0.0 ) {
    vec3 nW = normalize( swRot * objectNormal );
    float f = fl * swScale * uSwayAmount;
    float wave = sin( t * 2.1 + aSway.z + iph - fl * 4.0 );
    mvPosition.xyz += nW * ( wave * 0.09 * f * ( 0.6 + 0.4 * gust ) );
    mvPosition.xz += cd * ( f * ( 0.4 * cs * gust + 0.07 * surge ) )
                   + cp * ( f * 0.05 * sin( t * 0.9 + aSway.z * 1.7 ) );
    mvPosition.y += f * 0.05 * cs;
  }
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

const FRAG_PARS = /* glsl */ `
uniform float uDaylight;
uniform float uGlow;
`;

// Thin blades let light through: a little self-lit glow so backs and shaded sides never go black.
const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * uGlow * ( 0.3 + 0.7 * uDaylight );
`;

export interface PlantMaterialOptions {
  /** Plant height at scale 1, metres (top of the geometry). */
  height: number;
  /** Multiplier on all motion, 1 = default. */
  swayAmount?: number;
  /** Translucency glow, 0..~0.3. */
  glow?: number;
}

/** One shared material per plant species. The design array is sampled per instance. */
export function createPlantMaterial({ height, swayAmount = 1, glow = 0.16 }: PlantMaterialOptions) {
  const material = new MeshLambertMaterial({ side: DoubleSide });
  const local = {
    uSwayHeight: { value: height },
    uSwayAmount: { value: swayAmount },
    uGlow: { value: glow },
  };
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
  // Same GLSL for every plant species, so they share one compiled program.
  material.customProgramCacheKey = () => 'noasobi-plant-sway-1';
  return Object.assign(material, { swayUniforms: local });
}
