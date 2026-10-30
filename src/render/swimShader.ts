import { MeshLambertMaterial } from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { applyDesignArray } from './designTextures';

/**
 * Swim animation for 'swim-fish' geometry (any species following the SpeciesDef conventions:
 * 1 unit long, nose +X, `aSpine` 0 nose .. 1 tail tip). Optional geometry attributes:
 *   aPec (float): paired-fin flutter weight, side * distance-from-hinge (0 = rigid)
 *   aEye (vec3) : (isEye, ex, ey) procedural eye disc, never painted. isEye = 1: bright
 *                 amber-ringed eye (reef fish); isEye = 2: dark, friendly eye (sharks)
 * Per-instance attributes written by the sim every frame:
 *   aSwim (vec4): tail phase (rad), tail amplitude (body units at the tail tip),
 *                 pectoral phase (rad), pectoral amplitude (0..1)
 *   aBend (float): turning curvature, + = turning left (towards -Z)
 *   aDesignLayer (float): design texture layer (see designTextures.ts)
 * Per-material uniform:
 *   uBodyWave (float): 0 = only the tail beats (the front 60% of the body stays nearly rigid and
 *                      the wave concentrates in the rear body and tail), 1 = the whole body
 *                      undulates. 0.5 (the default) is the original reef-fish wave.
 * Phases are integrated on the CPU, so changing speed never makes the tail jump.
 */

const VERT_COMMON = /* glsl */ `
attribute float aSpine;
attribute float aPec;
attribute vec3 aEye;
attribute vec4 aSwim;
attribute float aBend;
uniform float uBodyWave;
varying vec3 vEye;

// Lateral (z) offset of the spine at s: a travelling wave whose amplitude grows towards the tail,
// a little head recoil, plus a C-bend into turns. Low uBodyWave pushes the point where the wave
// starts to grow back along the body (s0 = 0.2 at 0.5, 0.6 at 0.15) and shrinks the head recoil.
float swimLateral(float s) {
  float s0 = max(0.0, 0.2 + (0.5 - uBodyWave) * 1.15);
  float k = clamp((s - s0) / (1.0 - s0), 0.0, 1.0);
  float floorEnv = 0.12 * uBodyWave;
  float env = floorEnv + (1.0 - floorEnv) * k * k;
  float wave = aSwim.y * env * sin(aSwim.x - 5.6 * s);
  float c = max(s - 0.3, 0.0);
  float bend = aBend * c * c * 1.8;
  return wave - bend;
}
`;

const VERT_NORMAL = /* glsl */ `
#include <beginnormal_vertex>
float swLat = swimLateral(aSpine);
// x = 0.5 - s, so dz/dx = -dz/ds. For p' = (x, y, z + f(x)) the normal is (n.x - f' n.z, n.y, n.z).
float swDzdx = -(swimLateral(aSpine + 0.02) - swLat) / 0.02;
objectNormal = normalize(vec3(objectNormal.x - swDzdx * objectNormal.z, objectNormal.y, objectNormal.z));
`;

const VERT_BEGIN = /* glsl */ `
#include <begin_vertex>
transformed.z += swLat;
// Pectoral flutter: rowing sweep about the hinge, mostly outwards from the flank.
float pecD = abs(aPec);
float pecSide = sign(aPec);
transformed.z += pecSide * pecD * aSwim.w * 0.055 * (0.55 + sin(aSwim.z));
transformed.x += pecD * aSwim.w * 0.03 * cos(aSwim.z);
transformed.y += pecD * aSwim.w * 0.012 * sin(aSwim.z + 1.2);
vEye = aEye;
`;

const FRAG_COMMON = /* glsl */ `
varying vec3 vEye;
`;

const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
if (vEye.x > 0.5) {
  float er = length(vEye.yz);
  vec3 iris = mix(vec3(0.78, 0.42, 0.06), vec3(0.2, 0.13, 0.07), step(1.5, vEye.x));
  vec3 ec = mix(vec3(0.02), iris, smoothstep(0.46, 0.52, er));
  ec = mix(ec, vec3(0.03), smoothstep(0.8, 0.88, er));
  diffuseColor.rgb = ec;
}
`;

const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
if (vEye.x > 0.5) {
  float hl = 1.0 - smoothstep(0.12, 0.2, length(vEye.yz - vec2(0.26, 0.3)));
  totalEmissiveRadiance += vec3(0.85 * hl);
}
`;

export function patchSwimShader(shader: WebGLProgramParametersWithUniforms, bodyWave = 0.5) {
  applyDesignArray(shader);
  shader.uniforms.uBodyWave = { value: bodyWave };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERT_COMMON}`)
    .replace('#include <beginnormal_vertex>', VERT_NORMAL)
    .replace('#include <begin_vertex>', VERT_BEGIN);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAG_COMMON}`)
    .replace('#include <color_fragment>', FRAG_COLOR)
    .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
}

/** Lambert material for instanced swimming fish (one per species batch). */
export function createSwimMaterial(bodyWave = 0.5): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => patchSwimShader(shader, bodyWave);
  mat.customProgramCacheKey = () => 'swim-fish-v2';
  return mat;
}
