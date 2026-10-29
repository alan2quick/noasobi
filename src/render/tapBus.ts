import { Ray, Vector3 } from 'three';
import { SURFACE_Y, terrainHeight } from '../core/terrain';

/**
 * Tap dispatch. The camera rig turns a short, still touch/click on the canvas into a TapEvent and
 * offers it to registered handlers, highest priority first. The first handler that returns true
 * consumes the tap; if none does, the rig glides the camera to the tapped seabed point.
 */

export interface TapEvent {
  /** CSS pixels relative to the canvas' top-left corner. */
  screen: { x: number; y: number };
  /** Normalised device coordinates (-1..1, y up). */
  ndc: { x: number; y: number };
  /** World-space ray from the camera through the tap. Do not keep a reference: it is reused. */
  ray: Ray;
  /** Where the ray hits the seabed, or null. Reused object: copy it if you keep it. */
  seabedPoint: Vector3 | null;
}

export type TapHandler = (e: TapEvent) => boolean;

interface Entry {
  handler: TapHandler;
  priority: number;
  order: number;
}

const entries: Entry[] = [];
let orderCounter = 0;

/** Registers a tap handler. Higher priority runs first. Returns an unsubscribe function. */
export function addTapHandler(handler: TapHandler, priority = 0): () => void {
  const entry: Entry = { handler, priority, order: orderCounter++ };
  entries.push(entry);
  entries.sort((a, b) => b.priority - a.priority || b.order - a.order);
  return () => {
    const i = entries.indexOf(entry);
    if (i >= 0) entries.splice(i, 1);
  };
}

/** Offers a tap to every handler in priority order. Returns true if one consumed it. */
export function dispatchTap(e: TapEvent): boolean {
  // Copy so handlers may unsubscribe during dispatch.
  const list = entries.slice();
  for (const entry of list) {
    if (entry.handler(e)) return true;
  }
  return false;
}

const _p = new Vector3();

/**
 * Intersects a ray with the analytic seabed (`terrainHeight`) by ray marching plus bisection.
 * Writes the hit into `out` and returns it, or returns null. Cheap enough to call per tap/drag.
 */
export function raySeabed(ray: Ray, out: Vector3, maxDist = 220): Vector3 | null {
  const o = ray.origin;
  const d = ray.direction;
  if (d.y >= 0 && o.y > 4) return null;
  let prevT = 0;
  if (o.y - terrainHeight(o.x, o.z) < 0) return null;
  let t = 0.5;
  while (t < maxDist) {
    _p.copy(d).multiplyScalar(t).add(o);
    if (_p.y > SURFACE_Y + 1 && d.y >= 0) return null;
    if (_p.y - terrainHeight(_p.x, _p.z) < 0) {
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) * 0.5;
        _p.copy(d).multiplyScalar(mid).add(o);
        if (_p.y - terrainHeight(_p.x, _p.z) < 0) hi = mid;
        else lo = mid;
      }
      out.copy(d).multiplyScalar(hi).add(o);
      out.y = terrainHeight(out.x, out.z);
      return out;
    }
    prevT = t;
    t += 0.5 + t * 0.02;
  }
  return null;
}
