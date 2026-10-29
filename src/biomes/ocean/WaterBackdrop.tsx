import { useMemo } from 'react';
import { BackSide, BoxGeometry, ShaderMaterial } from 'three';
import { WATER_GLSL, waterUniforms } from './water';
import { envUniforms } from '../../core/runtime';

/**
 * Infinite water around the camera: a unit box drawn at the far plane with the same
 * direction-dependent water colour the fog uses, so everything fades into it seamlessly.
 */
export function WaterBackdrop() {
  const { geometry, material } = useMemo(() => {
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new ShaderMaterial({
      uniforms: {
        uFogColor: waterUniforms.uFogColor,
        uSunColor: waterUniforms.uSunColor,
        uSunDir: envUniforms.uSunDir,
        uDaylight: envUniforms.uDaylight,
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uFogColor;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        uniform float uDaylight;
        varying vec3 vDir;
        ${WATER_GLSL}
        void main() {
          vec3 dir = normalize(vDir);
          vec3 c = noaWaterColor(uFogColor, dir.y, cameraPosition.y);
          // Soft glow toward the light, strongest by day.
          float g = pow(max(dot(dir, uSunDir), 0.0), 6.0);
          c += uSunColor * g * (0.05 + 0.12 * uDaylight);
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    return { geometry, material };
  }, []);

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={-1000} />;
}
