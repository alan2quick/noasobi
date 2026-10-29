import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Ray, Raycaster, Vector2, Vector3 } from 'three';
import { SURFACE_Y, WORLD_HALF, terrainHeight } from '../core/terrain';
import { runtime } from '../core/runtime';
import { useApp } from '../core/store';
import { dispatchTap, raySeabed, type TapEvent } from './tapBus';

/**
 * Touch-first glide + orbit camera.
 * - One finger / left mouse: orbit around the target.
 * - Pinch / wheel: zoom. Two fingers / right mouse / shift+left: pan (screen space).
 * - Tap: offered to tapBus handlers; if none consumes it, glide the target to the seabed point.
 * - Follows `useApp.followId` using `runtime.transforms`.
 */

const MIN_DIST = 2.2;
const MAX_DIST = 48;
const MIN_PITCH = -0.55;
const MAX_PITCH = 1.45;
const FLOOR_CLEARANCE = 0.8;
const CEILING = SURFACE_Y - 1;
const BOUND = WORLD_HALF - 2;
const TAP_SLOP_PX = 10;
const TAP_MAX_MS = 450;

const rig = {
  target: new Vector3(0, 3.2, -12),
  targetGoal: new Vector3(0, 3.2, -12),
  yaw: 0.25,
  yawGoal: 0.25,
  pitch: 0.32,
  pitchGoal: 0.32,
  dist: 26,
  distGoal: 26,
  glide: { active: false, t: 0, duration: 1, from: new Vector3(), to: new Vector3() },
  following: null as string | null,
};

function clampTarget(v: Vector3) {
  v.x = Math.min(BOUND, Math.max(-BOUND, v.x));
  v.z = Math.min(BOUND, Math.max(-BOUND, v.z));
  const floor = terrainHeight(v.x, v.z) + 0.3;
  v.y = Math.min(SURFACE_Y - 2, Math.max(floor, v.y));
  return v;
}

/** Smoothly glides the camera target to a world point (e.g. a seabed hit). */
export function glideTo(point: Vector3, lift = 1.4) {
  const g = rig.glide;
  g.from.copy(rig.target);
  g.to.set(point.x, point.y + lift, point.z);
  clampTarget(g.to);
  const d = g.from.distanceTo(g.to);
  g.duration = Math.min(2.6, 0.7 + d * 0.035);
  g.t = 0;
  g.active = true;
  rig.targetGoal.copy(g.to);
}

/** Current orbit target (live object: copy it if you keep it). */
export function getCameraTarget(): Vector3 {
  return rig.target;
}

/** Sets the camera view directly (e.g. restoring a saved world). */
export function setCameraView(position: Vector3, target: Vector3) {
  rig.glide.active = false;
  rig.target.copy(target);
  clampTarget(rig.target);
  rig.targetGoal.copy(rig.target);
  _v.copy(position).sub(rig.target);
  const dist = Math.max(MIN_DIST, Math.min(MAX_DIST, _v.length()));
  rig.dist = rig.distGoal = dist;
  rig.yaw = rig.yawGoal = Math.atan2(_v.x, _v.z);
  rig.pitch = rig.pitchGoal = Math.max(MIN_PITCH, Math.min(MAX_PITCH, Math.asin(_v.y / dist)));
}

const _v = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _hit = new Vector3();
const _ndc = new Vector2();
const raycaster = new Raycaster();
const tapEvent: TapEvent = { screen: { x: 0, y: 0 }, ndc: { x: 0, y: 0 }, ray: new Ray(), seabedPoint: null };

const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface PointerInfo {
  x: number;
  y: number;
  startX: number;
  startY: number;
  button: number;
  shift: boolean;
}

export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, PointerInfo>();
    let gestureStart = 0;
    let gestureMaxPointers = 0;
    let gestureMoved = false;
    let pinchDist = 0;
    let midX = 0;
    let midY = 0;

    const pan = (dx: number, dy: number) => {
      if (rig.following) return;
      rig.glide.active = false;
      const h = el.clientHeight || 1;
      const scale = (2 * rig.dist * Math.tan((camera.fov * Math.PI) / 360)) / h;
      _right.setFromMatrixColumn(camera.matrixWorld, 0);
      _up.setFromMatrixColumn(camera.matrixWorld, 1);
      rig.targetGoal.addScaledVector(_right, -dx * scale).addScaledVector(_up, dy * scale);
      clampTarget(rig.targetGoal);
    };

    const orbit = (dx: number, dy: number) => {
      const h = el.clientHeight || 1;
      rig.yawGoal -= (dx / h) * Math.PI * 1.1;
      rig.pitchGoal = Math.max(MIN_PITCH, Math.min(MAX_PITCH, rig.pitchGoal + (dy / h) * Math.PI * 0.9));
    };

    const zoom = (factor: number) => {
      rig.distGoal = Math.max(MIN_DIST, Math.min(MAX_DIST, rig.distGoal * factor));
    };

    const twoFinger = () => {
      const [a, b] = [...pointers.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button > 2) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (pointers.size === 0) {
        gestureStart = performance.now();
        gestureMaxPointers = 0;
        gestureMoved = false;
      }
      pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        button: e.button,
        shift: e.shiftKey,
      });
      gestureMaxPointers = Math.max(gestureMaxPointers, pointers.size);
      if (pointers.size === 2) {
        const t = twoFinger();
        pinchDist = t.d;
        midX = t.mx;
        midY = t.my;
      }
    };

    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (Math.hypot(p.x - p.startX, p.y - p.startY) > TAP_SLOP_PX) gestureMoved = true;

      if (pointers.size === 1) {
        if (!gestureMoved) return;
        if (p.button === 2 || p.shift) pan(dx, dy);
        else orbit(dx, dy);
      } else if (pointers.size === 2) {
        const t = twoFinger();
        if (pinchDist > 0 && t.d > 0) zoom(pinchDist / t.d);
        pan(t.mx - midX, t.my - midY);
        pinchDist = t.d;
        midX = t.mx;
        midY = t.my;
        gestureMoved = true;
      }
    };

    const onUp = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      pointers.delete(e.pointerId);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (pointers.size === 2) {
        const t = twoFinger();
        pinchDist = t.d;
        midX = t.mx;
        midY = t.my;
      }
      if (pointers.size > 0) return;
      const isTap =
        e.type === 'pointerup' &&
        !gestureMoved &&
        gestureMaxPointers === 1 &&
        performance.now() - gestureStart < TAP_MAX_MS &&
        p.button === 0;
      if (isTap) handleTap(e.clientX, e.clientY);
    };

    const handleTap = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      _ndc.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
      camera.updateMatrixWorld();
      raycaster.setFromCamera(_ndc, camera);
      tapEvent.screen.x = x;
      tapEvent.screen.y = y;
      tapEvent.ndc.x = _ndc.x;
      tapEvent.ndc.y = _ndc.y;
      tapEvent.ray.copy(raycaster.ray);
      tapEvent.seabedPoint = raySeabed(tapEvent.ray, _hit);
      if (dispatchTap(tapEvent)) return;
      if (tapEvent.seabedPoint && !rig.following) glideTo(tapEvent.seabedPoint);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoom(Math.exp(Math.max(-0.5, Math.min(0.5, dy * 0.0012))));
    };

    const onContext = (e: Event) => e.preventDefault();

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
    };
  }, [camera, gl]);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.1);

    // Follow mode.
    const followId = useApp.getState().followId;
    const live = followId ? runtime.transforms.get(followId) : undefined;
    if (followId && live) {
      if (rig.following !== followId) {
        rig.following = followId;
        rig.glide.active = false;
        rig.distGoal = Math.max(3, Math.min(9, live.radius * 10 + 3));
      }
      rig.targetGoal.copy(live.position);
      clampTarget(rig.targetGoal);
      rig.target.lerp(rig.targetGoal, damp(4, dt));
    } else {
      if (rig.following) {
        rig.following = null;
        rig.targetGoal.copy(rig.target);
      }
      const g = rig.glide;
      if (g.active) {
        g.t += dt / g.duration;
        if (g.t >= 1) {
          g.active = false;
          rig.target.copy(g.to);
        } else {
          rig.target.lerpVectors(g.from, g.to, easeInOut(g.t));
        }
      } else {
        rig.target.lerp(rig.targetGoal, damp(10, dt));
      }
    }

    rig.yaw += (rig.yawGoal - rig.yaw) * damp(12, dt);
    rig.pitch += (rig.pitchGoal - rig.pitch) * damp(12, dt);
    rig.dist += (rig.distGoal - rig.dist) * damp(8, dt);

    // Camera position from spherical coordinates, then keep it in the water.
    const t = rig.target;
    const place = () => {
      const cp = Math.cos(rig.pitch);
      camera.position.set(
        t.x + Math.sin(rig.yaw) * cp * rig.dist,
        t.y + Math.sin(rig.pitch) * rig.dist,
        t.z + Math.cos(rig.yaw) * cp * rig.dist,
      );
    };
    place();
    const floor = terrainHeight(camera.position.x, camera.position.z) + FLOOR_CLEARANCE;
    if (camera.position.y < floor) {
      const minPitch = Math.asin(Math.max(-1, Math.min(1, (floor - t.y) / rig.dist)));
      rig.pitch = Math.max(rig.pitch, minPitch);
      rig.pitchGoal = Math.max(rig.pitchGoal, minPitch);
      place();
    } else if (camera.position.y > CEILING) {
      const maxPitch = Math.asin(Math.max(-1, Math.min(1, (CEILING - t.y) / rig.dist)));
      rig.pitch = Math.min(rig.pitch, maxPitch);
      rig.pitchGoal = Math.min(rig.pitchGoal, maxPitch);
      place();
    }
    const p = camera.position;
    p.x = Math.min(WORLD_HALF, Math.max(-WORLD_HALF, p.x));
    p.z = Math.min(WORLD_HALF, Math.max(-WORLD_HALF, p.z));
    p.y = Math.min(CEILING, Math.max(terrainHeight(p.x, p.z) + FLOOR_CLEARANCE, p.y));
    camera.lookAt(t);
  }, -1);

  return null;
}
