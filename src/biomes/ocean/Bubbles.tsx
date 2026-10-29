import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, Float32BufferAttribute, NormalBlending, ShaderMaterial, type PerspectiveCamera } from 'three';
import { SURFACE_Y } from '../../core/terrain';
import { envUniforms } from '../../core/runtime';
import { waterUniforms } from './water';
import { bubbleVents, mulberry } from './layout';

/** Bubble streams rising from vents on the seabed. All animation is in the vertex shader. */
const PER_STREAM = 16;

export function Bubbles({ streams }: { streams: number }) {
  const uniforms = useMemo(
    () => ({
      uTime: envUniforms.uTime,
      uDaylight: envUniforms.uDaylight,
      uSkyColor: waterUniforms.uSkyColor,
      uFogDensity: waterUniforms.uFogDensity,
      uScale: { value: 500 },
    }),
    [],
  );

  const geometry = useMemo(() => {
    const rand = mulberry(5);
    const vents = bubbleVents.slice(0, streams);
    const n = vents.length * PER_STREAM;
    const pos = new Float32Array(n * 3);
    const rnd = new Float32Array(n * 3);
    let k = 0;
    for (const [x, y, z] of vents) {
      for (let i = 0; i < PER_STREAM; i++) {
        pos[k * 3] = x + (rand() - 0.5) * 0.25;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z + (rand() - 0.5) * 0.25;
        rnd[k * 3] = i / PER_STREAM + rand() * 0.04; // phase
        rnd[k * 3 + 1] = rand(); // size / speed
        rnd[k * 3 + 2] = rand(); // wobble
        k++;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('aRand', new Float32BufferAttribute(rnd, 3));
    return g;
  }, [streams]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms,
        vertexShader: /* glsl */ `
          attribute vec3 aRand;
          uniform float uTime;
          uniform float uScale;
          uniform float uFogDensity;
          varying float vAlpha;
          void main() {
            float height = ${SURFACE_Y.toFixed(1)} - position.y;
            float speed = 1.1 + aRand.y * 0.6;
            float cycle = height / speed;
            float ph = fract(uTime / cycle + aRand.x);
            float rise = ph * height;
            vec3 p = position;
            p.y += rise;
            float wob = 0.06 + rise * 0.012;
            p.x += sin(uTime * (3.0 + aRand.z * 2.0) + aRand.x * 30.0) * wob;
            p.z += cos(uTime * (2.6 + aRand.z * 2.0) + aRand.x * 20.0) * wob;
            vec4 mv = viewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float dist = -mv.z;
            float size = (0.05 + aRand.y * 0.07) * (1.0 + rise * 0.03);
            gl_PointSize = max(1.0, size * uScale / max(dist, 0.1));
            vAlpha = smoothstep(0.0, 0.03, ph) * (1.0 - smoothstep(0.92, 1.0, ph))
              * smoothstep(0.3, 1.2, dist)
              * exp(-pow(uFogDensity * dist, 2.0));
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSkyColor;
          uniform float uDaylight;
          varying float vAlpha;
          void main() {
            vec2 d = gl_PointCoord - 0.5;
            float r = length(d) * 2.0;
            if (r > 1.0) discard;
            float rim = smoothstep(0.55, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
            float hi = 1.0 - smoothstep(0.0, 0.22, length(d - vec2(-0.16, 0.16)));
            float a = (rim * 0.75 + hi * 0.9 + 0.1) * vAlpha;
            gl_FragColor = vec4(uSkyColor * (0.6 + 0.4 * uDaylight), a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
        fog: false,
        toneMapped: false,
      }),
    [uniforms],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera, size, viewport }) => {
    const fov = (camera as PerspectiveCamera).fov ?? 55;
    uniforms.uScale.value = (size.height * viewport.dpr) / (2 * Math.tan((fov * Math.PI) / 360));
  });

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={12} />;
}
