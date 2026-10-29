import { Raycaster, Vector3 } from 'three';
import type { Camera, InstancedMesh, Object3D, PerspectiveCamera, Ray } from 'three';
import type { LiveTransform } from '../../core/runtime';

/**
 * Tap picking.
 * - Moving creatures are not raycastable (their shape comes from the vertex shader), so they are
 *   picked in screen space from `runtime.transforms`: project each position, add a generous touch
 *   radius to its projected size, take the best match.
 * - Plants are raycast against their InstancedMeshes (`userData.entityIds[instanceId]`).
 * Helpers below allocate nothing per call except where noted (plant raycast, once per tap).
 */

/** Default touch slop around a creature, CSS px. */
export const TOUCH_RADIUS_PX = 40;

export interface ScreenHit {
  x: number;
  y: number;
  /** Distance from the camera along its view axis (metres); negative/zero means behind. */
  depth: number;
}

const _v = new Vector3();

/**
 * Projects a world point into CSS pixels of a `width` x `height` viewport. Returns false when the
 * point is behind the camera (or on its plane).
 */
export function projectToScreen(p: Vector3, camera: Camera, width: number, height: number, out: ScreenHit): boolean {
  _v.copy(p).applyMatrix4(camera.matrixWorldInverse);
  out.depth = -_v.z;
  if (out.depth <= 1e-4) return false;
  _v.applyMatrix4(camera.projectionMatrix);
  out.x = (_v.x * 0.5 + 0.5) * width;
  out.y = (-_v.y * 0.5 + 0.5) * height;
  return true;
}

/** On-screen radius in CSS px of a sphere of `radius` metres at view depth `depth`. */
export function projectedRadiusPx(radius: number, depth: number, fovDeg: number, viewportHeight: number): number {
  if (depth <= 0) return 0;
  const f = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  return (radius * f) / depth;
}

/**
 * Pick score for a target at (tx, ty) with on-screen radius `radiusPx` for a tap at (sx, sy):
 * distance relative to the accepted radius (0 = dead centre, < 1 = inside), or Infinity if outside.
 */
export function pickScore(sx: number, sy: number, tx: number, ty: number, radiusPx: number, touchPx = TOUCH_RADIUS_PX): number {
  const accept = touchPx + radiusPx;
  const d = Math.hypot(sx - tx, sy - ty);
  return d <= accept ? d / accept : Infinity;
}

const _hit: ScreenHit = { x: 0, y: 0, depth: 0 };

/** Nearest moving creature to a tap, or null. `ignore` skips ids (e.g. an entity being moved). */
export function pickCreature(
  transforms: Map<string, LiveTransform>,
  camera: PerspectiveCamera,
  width: number,
  height: number,
  sx: number,
  sy: number,
  touchPx = TOUCH_RADIUS_PX,
): string | null {
  camera.updateMatrixWorld();
  let best: string | null = null;
  let bestScore = Infinity;
  let bestDepth = Infinity;
  for (const [id, t] of transforms) {
    if (!projectToScreen(t.position, camera, width, height, _hit)) continue;
    // Far-away fish still get the touch slop, but very distant ones (tiny dots) are not useful.
    if (_hit.depth > camera.far) continue;
    const r = projectedRadiusPx(t.radius, _hit.depth, camera.fov, height);
    const s = pickScore(sx, sy, _hit.x, _hit.y, r, touchPx);
    if (s === Infinity) continue;
    // Prefer the closer-to-centre one; break near-ties toward the camera.
    if (s < bestScore - 0.08 || (Math.abs(s - bestScore) <= 0.08 && _hit.depth < bestDepth)) {
      best = id;
      bestScore = s;
      bestDepth = _hit.depth;
    }
  }
  return best;
}

const raycaster = new Raycaster();

/** Instanced plant meshes in the scene (named `plants:<speciesId>` by the Plants renderer). */
export function plantMeshes(scene: Object3D): InstancedMesh[] {
  const out: InstancedMesh[] = [];
  scene.traverse((o) => {
    if ((o as InstancedMesh).isInstancedMesh && o.name.startsWith('plants:') && o.visible) out.push(o as InstancedMesh);
  });
  return out;
}

/** Raycasts plants along `ray`. Returns the entity id and hit distance, or null. */
export function raycastPlant(scene: Object3D, ray: Ray, maxDist = 120): { id: string; distance: number } | null {
  const meshes = plantMeshes(scene);
  if (meshes.length === 0) return null;
  raycaster.ray.copy(ray);
  raycaster.near = 0;
  raycaster.far = maxDist;
  const hits = raycaster.intersectObjects(meshes, false);
  for (const h of hits) {
    if (h.instanceId === undefined) continue;
    const ids = (h.object.userData as { entityIds?: string[] }).entityIds;
    const id = ids?.[h.instanceId];
    if (id) return { id, distance: h.distance };
  }
  return null;
}
