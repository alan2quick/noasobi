import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, PlaneGeometry, ShaderMaterial, type Mesh } from 'three';
import { SURFACE_Y } from '../../core/terrain';
import { envUniforms } from '../../core/runtime';
import { WATER_GLSL, waterUniforms } from './water';
import { causticsTexture } from './caustics';

/**
 * The underside of the water surface: rippling light, a bright Snell's window overhead, total
 * internal reflection (darker water) outside it, and the same fog as everything else.
 * One quad that follows the camera.
 */
const SIZE = 320;

export function WaterSurface() {
  const mesh = useRef<Mesh>(null);
  const { geometry, material } = useMemo(() => {
    const geometry = new PlaneGeometry(SIZE, SIZE, 1, 1);
    geometry.rotateX(Math.PI / 2); // face down
    const material = new ShaderMaterial({
      uniforms: {
        uFogColor: waterUniforms.uFogColor,
        uFogDensity: waterUniforms.uFogDensity,
        uSkyColor: waterUniforms.uSkyColor,
        uSunColor: waterUniforms.uSunColor,
        uTime: envUniforms.uTime,
        uDaylight: envUniforms.uDaylight,
        uSunDir: envUniforms.uSunDir,
        uCausticTex: { value: causticsTexture },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform vec3 uSkyColor;
        uniform vec3 uSunColor;
        uniform float uTime;
        uniform float uDaylight;
        uniform vec3 uSunDir;
        uniform sampler2D uCausticTex;
        varying vec3 vWorld;
        ${WATER_GLSL}
        void main() {
          vec3 off = vWorld - cameraPosition;
          float dist = length(off);
          vec3 dir = off / dist;
          vec2 uv = vWorld.xz * 0.03;
          uv += 0.03 * sin(uv.yx * 7.0 + uTime * vec2(0.4, 0.33));
          float a = texture2D(uCausticTex, uv + vec2(0.018, 0.011) * uTime).r;
          float b = texture2D(uCausticTex, uv * 1.31 + vec2(-0.013, 0.02) * uTime + 0.3).r;
          float web = (a + b) * 0.5;
          // Snell's window: the sky is only visible within ~48.6 deg of straight up.
          float wobble = 0.025 * sin(vWorld.x * 0.35 + uTime * 0.9) * sin(vWorld.z * 0.29 - uTime * 0.7);
          float win = smoothstep(0.6, 0.72, dir.y + wobble);
          vec3 tir = noaWaterColor(uFogColor, -dir.y * 0.6, cameraPosition.y) * 1.15;
          vec3 sky = mix(uFogColor * 1.6, uSkyColor * 0.92, 0.35 + 0.65 * uDaylight);
          vec3 c = mix(tir, sky, win);
          // Bright ring at the window edge and glinting ripples.
          c += uSkyColor * (win * (1.0 - win)) * 0.6;
          c += uSunColor * web * (0.1 + 0.22 * win) * (0.3 + 0.7 * uDaylight);
          // Sun (or moon) disc smeared by the waves.
          float s = max(dot(dir, uSunDir), 0.0);
          c += uSunColor * (pow(s, 40.0) * 0.9 + pow(s, 6.0) * 0.18) * (0.35 + 0.65 * uDaylight);
          vec3 f = noaFogFactor(uFogDensity * 0.85, dist);
          c = mix(c, noaWaterColor(uFogColor, dir.y, cameraPosition.y), f);
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: DoubleSide,
      fog: false,
      toneMapped: false,
    });
    return { geometry, material };
  }, []);

  useFrame(({ camera }) => {
    const m = mesh.current;
    if (!m) return;
    m.position.set(camera.position.x, SURFACE_Y, camera.position.z);
  });

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} />;
}
