import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, ShaderMaterial, Vector3 } from 'three';
import { SURFACE_Y } from '../../core/terrain';
import { envUniforms } from '../../core/runtime';
import { waterUniforms } from './water';
import { mulberry } from './layout';

/**
 * Swaying light shafts from the surface, one draw call. Each shaft is a camera-facing ribbon
 * along the light direction, wrapped around the camera so there are always some in view.
 */
const RANGE = 32; // shafts live within +-RANGE of the camera (xz)
const LENGTH = 30;
const _fwd = new Vector3();

function buildShafts(count: number) {
  const rand = mulberry(77);
  const corner: number[] = [];
  const shaft: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s < count; s++) {
    const ox = (rand() * 2 - 1) * RANGE;
    const oz = (rand() * 2 - 1) * RANGE;
    const width = 0.7 + rand() * 1.6;
    const seed = rand();
    const base = s * 4;
    for (const [side, along] of [
      [-1, 0],
      [1, 0],
      [-1, 1],
      [1, 1],
    ]) {
      corner.push(side, along, 0);
      shaft.push(ox, oz, width, seed);
    }
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(corner, 3));
  g.setAttribute('aShaft', new Float32BufferAttribute(shaft, 4));
  g.setIndex(idx);
  return g;
}

export function GodRays({ count }: { count: number }) {
  const uniforms = useMemo(
    () => ({
      uTime: envUniforms.uTime,
      uDaylight: envUniforms.uDaylight,
      uSunDir: envUniforms.uSunDir,
      uSunColor: waterUniforms.uSunColor,
      uFogDensity: waterUniforms.uFogDensity,
      uCam: { value: new Vector3() },
    }),
    [],
  );

  const geometry = useMemo(() => buildShafts(count), [count]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms,
        vertexShader: /* glsl */ `
          attribute vec4 aShaft;
          uniform float uTime;
          uniform vec3 uSunDir;
          uniform vec3 uCam;
          uniform float uFogDensity;
          varying float vAlpha;
          varying float vSide;
          varying float vAlong;
          void main() {
            float seed = aShaft.w;
            vec2 o = aShaft.xy + vec2(uTime * 0.25, uTime * 0.1);
            vec2 rel = mod(o - uCam.xz + ${RANGE.toFixed(1)}, ${(RANGE * 2).toFixed(1)}) - ${RANGE.toFixed(1)};
            vec3 top = vec3(uCam.x + rel.x, ${SURFACE_Y.toFixed(1)} + 0.5, uCam.z + rel.y);
            vec3 axis = -normalize(uSunDir + vec3(sin(uTime * 0.31 + seed * 17.0) * 0.06, 0.0, cos(uTime * 0.23 + seed * 11.0) * 0.06));
            float along = position.y;
            vec3 p = top + axis * ${LENGTH.toFixed(1)} * along;
            vec3 toCam = normalize(cameraPosition - p);
            vec3 side = normalize(cross(axis, toCam));
            float w = aShaft.z * (1.0 + along * 0.9);
            p += side * position.x * w;
            float dist = length(p - cameraPosition);
            float hd = length(rel);
            float pulse = 0.55 + 0.45 * sin(uTime * (0.35 + seed * 0.4) + seed * 40.0);
            vAlpha = pulse
              * (1.0 - smoothstep(${(RANGE * 0.7).toFixed(1)}, ${RANGE.toFixed(1)}, hd))
              * smoothstep(3.0, 12.0, dist)
              * exp(-pow(uFogDensity * dist * 0.8, 2.0));
            vSide = position.x;
            vec4 mv = viewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            vAlong = along;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSunColor;
          uniform float uDaylight;
          varying float vAlpha;
          varying float vSide;
          varying float vAlong;
          void main() {
            float edge = 1.0 - vSide * vSide;
            float len = smoothstep(0.0, 0.08, vAlong) * (1.0 - smoothstep(0.55, 1.0, vAlong));
            gl_FragColor = vec4(uSunColor, edge * len * vAlpha * 0.4 * uDaylight);
          }`,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        fog: false,
        toneMapped: false,
      }),
    [uniforms],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera }) => {
    // Centre the shaft field ahead of the camera so most shafts are in view.
    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    uniforms.uCam.value.copy(camera.position).addScaledVector(_fwd, RANGE * 0.65);
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={10} />;
}
