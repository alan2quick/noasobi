import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, ShaderMaterial, Vector3, type PerspectiveCamera } from 'three';
import { SURFACE_Y } from '../../core/terrain';
import { envUniforms } from '../../core/runtime';
import { waterUniforms } from './water';
import { mulberry } from './layout';

/**
 * Drifting marine snow in a box that follows the camera (positions wrap in the vertex shader),
 * with a few bioluminescent glints that twinkle at night. One draw call, no per-frame CPU work
 * besides a few uniforms.
 */
const BOX = 36;

export function MarineSnow({ count }: { count: number }) {
  const uniforms = useMemo(
    () => ({
      uTime: envUniforms.uTime,
      uDaylight: envUniforms.uDaylight,
      uCurrent: envUniforms.uCurrent,
      uSnowColor: waterUniforms.uSnowColor,
      uFogDensity: waterUniforms.uFogDensity,
      uCam: { value: new Vector3() },
      uScale: { value: 500 },
    }),
    [],
  );

  const geometry = useMemo(() => {
    const rand = mulberry(99);
    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      pos[i] = rand() * BOX;
      rnd[i] = rand();
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('aRand', new Float32BufferAttribute(rnd, 3));
    return g;
  }, [count]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms,
        vertexShader: /* glsl */ `
          attribute vec3 aRand;
          uniform float uTime;
          uniform float uDaylight;
          uniform vec2 uCurrent;
          uniform vec3 uCam;
          uniform float uScale;
          uniform float uFogDensity;
          varying float vAlpha;
          varying float vGlow;
          void main() {
            vec3 p = position;
            float t = uTime;
            p.x += uCurrent.x * t * 0.35 + sin(t * 0.37 + aRand.x * 31.0) * 0.5;
            p.z += uCurrent.y * t * 0.35 + cos(t * 0.29 + aRand.z * 23.0) * 0.5;
            p.y -= t * (0.04 + aRand.y * 0.07);
            p = uCam + mod(p - uCam + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
            vec4 mv = viewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float dist = -mv.z;
            float edge = length(p - uCam) / ${(BOX / 2).toFixed(1)};
            float night = 1.0 - uDaylight;
            float glowy = step(0.8, aRand.x);
            vGlow = glowy * night * pow(0.5 + 0.5 * sin(t * (0.6 + aRand.y * 1.4) + aRand.z * 40.0), 3.0);
            vAlpha = (1.0 - smoothstep(0.6, 1.0, edge))
              * smoothstep(0.4, 1.5, dist)
              * (1.0 - smoothstep(${(SURFACE_Y - 2).toFixed(1)}, ${SURFACE_Y.toFixed(1)}, p.y))
              * exp(-pow(uFogDensity * dist, 2.0));
            float size = 0.045 + aRand.y * 0.05 + vGlow * 0.11;
            gl_PointSize = max(1.0, size * uScale / max(dist, 0.1));
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSnowColor;
          uniform float uDaylight;
          varying float vAlpha;
          varying float vGlow;
          void main() {
            vec2 d = gl_PointCoord - 0.5;
            float r = 1.0 - smoothstep(0.1, 0.5, length(d));
            vec3 glowC = vec3(0.35, 1.0, 0.85);
            vec3 c = mix(uSnowColor, glowC, clamp(vGlow * 1.5, 0.0, 1.0));
            float a = r * vAlpha * (0.22 + 0.2 * uDaylight + vGlow * 2.0);
            gl_FragColor = vec4(c, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
        toneMapped: false,
      }),
    [uniforms],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera, size, viewport }) => {
    uniforms.uCam.value.copy(camera.position);
    const fov = (camera as PerspectiveCamera).fov ?? 55;
    uniforms.uScale.value = (size.height * viewport.dpr) / (2 * Math.tan((fov * Math.PI) / 360));
  });

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={11} />;
}
