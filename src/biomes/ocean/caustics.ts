import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { SURFACE_Y } from '../../core/terrain';
import { envUniforms } from '../../core/runtime';

/**
 * Caustics: a tileable Worley-edge "light web" generated once on the CPU, sampled twice with
 * different drift directions and combined with min(), projected along the sun direction.
 * Two texture reads per pixel, so it is cheap on mobile.
 */

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCausticsTexture(size = 256, cells = 6): DataTexture {
  const rand = mulberry(1234);
  const pts = new Float32Array(cells * cells * 2);
  const gain = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    pts[i * 2] = 0.1 + rand() * 0.8;
    pts[i * 2 + 1] = 0.1 + rand() * 0.8;
    gain[i] = 0.55 + rand() * 0.45;
  }
  const TAU = Math.PI * 2;
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Tileable domain warp (integer frequencies) makes the cell borders curvy.
      const wu = u + 0.045 * Math.sin(TAU * (2 * v + u)) + 0.025 * Math.sin(TAU * (3 * u - 2 * v));
      const wv = v + 0.045 * Math.sin(TAU * (2 * u - v)) + 0.025 * Math.sin(TAU * (3 * v + u));
      const fx = wu * cells;
      const fy = wv * cells;
      const cx = Math.floor(fx);
      const cy = Math.floor(fy);
      let f1 = 9;
      let f2 = 9;
      let g1 = 1;
      let g2 = 1;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox;
          const ny = cy + oy;
          const wx = ((nx % cells) + cells) % cells;
          const wy = ((ny % cells) + cells) % cells;
          const k = wy * cells + wx;
          const d = Math.hypot(nx + pts[k * 2] - fx, ny + pts[k * 2 + 1] - fy);
          if (d < f1) {
            f2 = f1;
            g2 = g1;
            f1 = d;
            g1 = gain[k];
          } else if (d < f2) {
            f2 = d;
            g2 = gain[k];
          }
        }
      }
      const edge = f2 - f1; // 0 on cell borders
      const line = Math.pow(Math.max(0, 1 - edge * 3.2), 4);
      const glow = Math.pow(Math.max(0, 1 - edge * 1.2), 2) * 0.18;
      const val = (line * 0.85 + glow) * ((g1 + g2) * 0.5);
      data[y * size + x] = Math.round(Math.min(1, val) * 255);
    }
  }
  const tex = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export const causticsTexture = makeCausticsTexture();

const S = SURFACE_Y.toFixed(1);

/** GLSL: needs uniforms uCausticTex, uSunDir. Returns 0..~1 brightness of the caustic web. */
export const CAUSTICS_GLSL = /* glsl */ `
float noaCaustic(vec3 wp, float t) {
  // Project to the surface point the light came through.
  vec2 p = wp.xz + uSunDir.xz / max(uSunDir.y, 0.35) * (${S} - wp.y) * 0.5;
  vec2 uv = p * 0.07;
  uv += 0.025 * sin(uv.yx * 9.0 + t * vec2(0.31, 0.27));
  float a = texture2D(uCausticTex, uv + vec2(0.021, 0.013) * t).r;
  float b = texture2D(uCausticTex, uv * 1.37 + vec2(-0.017, 0.024) * t + 0.43).r;
  return min(a, b) * 2.0 + a * b * 0.8;
}
`;

const RIPPLE_GLSL = /* glsl */ `
  {
    float rDist = length(vNoaWorld - cameraPosition);
    float rFade = 1.0 - smoothstep(9.0, 30.0, rDist);
    vec2 rp = vNoaWorld.xz;
    float warp = sin(rp.x * 0.23 + sin(rp.y * 0.19) * 1.7) * 1.4 + sin(rp.y * 0.071 + rp.x * 0.03) * 2.2;
    float rip = sin(dot(rp, vec2(0.86, 0.51)) * 7.5 + warp);
    rip = rip * abs(rip);
    diffuseColor.rgb *= 1.0 + rip * 0.075 * rFade;
  }
`;

export interface CausticsOptions {
  ripples?: boolean;
  /** Multiplies the caustic strength for this material. */
  strength?: number;
}

/**
 * Patches a MeshLambertMaterial (or other lit three material) to receive animated caustics and,
 * optionally, sand ripples. Works with InstancedMesh. Uses the shared env uniforms.
 */
export function applyCaustics<M extends Material>(material: M, opts: CausticsOptions = {}): M {
  const strength = (opts.strength ?? 1).toFixed(3);
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = envUniforms.uTime;
    shader.uniforms.uDaylight = envUniforms.uDaylight;
    shader.uniforms.uCaustics = envUniforms.uCaustics;
    shader.uniforms.uSunDir = envUniforms.uSunDir;
    shader.uniforms.uCausticTex = { value: causticsTexture };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vNoaWorld;')
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
  vec4 noaWp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    noaWp = instanceMatrix * noaWp;
  #endif
  vNoaWorld = ( modelMatrix * noaWp ).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vNoaWorld;
uniform float uTime;
uniform float uDaylight;
uniform float uCaustics;
uniform vec3 uSunDir;
uniform sampler2D uCausticTex;
${CAUSTICS_GLSL}`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + (opts.ripples ? RIPPLE_GLSL : ''))
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `{
    vec3 cN = normalize( cross( dFdx( vNoaWorld ), dFdy( vNoaWorld ) ) );
    float cUp = smoothstep( 0.15, 0.85, cN.y );
    float cS = uCaustics * mix( 0.07, 1.0, uDaylight ) * cUp * ${strength};
    outgoingLight += diffuseColor.rgb * noaCaustic( vNoaWorld, uTime ) * cS * 0.9;
  }
  #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `noa-caustics-${opts.ripples ? 1 : 0}-${strength}`;
  return material;
}
