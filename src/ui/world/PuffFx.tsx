import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, type Vector3 } from 'three';

/**
 * Little sparkle/bubble puff played when something is placed or moved. A fixed pool of point
 * sprites in one draw call; `puff()` claims particles from the pool. No per-frame allocations,
 * and the update loop exits early when nothing is alive.
 */

const MAX = 72;
const PER_PUFF = 16;
const LIFE = 1.1;

const pos = new Float32Array(MAX * 3);
const vel = new Float32Array(MAX * 3);
const alpha = new Float32Array(MAX);
const size = new Float32Array(MAX);
const life = new Float32Array(MAX); // remaining seconds, <= 0 = free
let alive = 0;
let cursor = 0;

/** Spawns a puff at a world point. */
export function puff(p: Vector3, spread = 1) {
  for (let k = 0; k < PER_PUFF; k++) {
    const i = cursor;
    cursor = (cursor + 1) % MAX;
    if (life[i] <= 0) alive++;
    const a = Math.random() * Math.PI * 2;
    const r = (0.25 + Math.random() * 0.6) * spread;
    pos[i * 3] = p.x + Math.cos(a) * 0.12 * spread;
    pos[i * 3 + 1] = p.y + (Math.random() - 0.3) * 0.2 * spread;
    pos[i * 3 + 2] = p.z + Math.sin(a) * 0.12 * spread;
    vel[i * 3] = Math.cos(a) * r;
    vel[i * 3 + 1] = (0.5 + Math.random() * 0.9) * spread;
    vel[i * 3 + 2] = Math.sin(a) * r;
    size[i] = (0.08 + Math.random() * 0.14) * spread;
    life[i] = LIFE * (0.7 + Math.random() * 0.3);
    alpha[i] = 1;
  }
}

export function PuffFx() {
  const { points, geometry, material } = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('aAlpha', new BufferAttribute(alpha, 1));
    geometry.setAttribute('aSize', new BufferAttribute(size, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aSize;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aAlpha > 0.0 ? max(1.0, aSize * uScale / max(-mv.z, 0.1)) : 0.0;
          vAlpha = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          if (d > 1.0) discard;
          // bright rim + soft glint: reads as a bubble or a sparkle
          float rim = smoothstep(0.55, 0.85, d) * (1.0 - smoothstep(0.85, 1.0, d));
          float glint = 1.0 - smoothstep(0.0, 0.35, length(c - vec2(-0.15, 0.15)) * 2.0);
          float a = (rim * 0.9 + glint * 0.8 + 0.08) * vAlpha;
          gl_FragColor = vec4(vec3(0.85, 0.97, 1.0) * a, a);
        }`,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 10;
    return { points, geometry, material };
  }, []);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((_, rawDt) => {
    if (alive <= 0) {
      points.visible = false;
      return;
    }
    points.visible = true;
    const dt = Math.min(rawDt, 0.05);
    const drag = Math.exp(-2.5 * dt);
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        alpha[i] = 0;
        alive--;
        continue;
      }
      vel[i * 3] *= drag;
      vel[i * 3 + 2] *= drag;
      vel[i * 3 + 1] = vel[i * 3 + 1] * drag + 0.6 * dt; // bubbles keep rising
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      alpha[i] = Math.min(1, life[i] / (LIFE * 0.5));
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aAlpha.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
  });

  return <primitive object={points} />;
}
