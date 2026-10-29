import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

/**
 * Module-level handles to the main R3F camera, renderer and scene, so DOM-side code (picking,
 * persistence, thumbnails) can reach them without React state. Set by <SceneBridge/>.
 */
export const sceneRefs = {
  camera: null as PerspectiveCamera | null,
  gl: null as WebGLRenderer | null,
  scene: null as Scene | null,
};

/** Mount once inside the main Canvas. */
export function SceneBridge() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    sceneRefs.camera = camera;
    sceneRefs.gl = gl;
    sceneRefs.scene = scene;
  }, [camera, gl, scene]);
  return null;
}
