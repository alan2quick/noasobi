import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Raycaster, Vector2, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { useApp } from '../../core/store';
import { runtime } from '../../core/runtime';
import { SURFACE_Y, terrainHeight } from '../../core/terrain';
import { addTapHandler, raySeabed, type TapEvent } from '../../render/tapBus';
import { getCameraTarget, glideTo } from '../../render/CameraRig';
import { spawnFood } from '../../sim/food';
import { sound } from '../../audio/engine';
import { useUi } from '../uiStore';
import { trySpecies, modelHeight } from '../speciesInfo';
import { pickCreature, projectToScreen, raycastPlant, type ScreenHit } from './picking';
import { anchorAt, isMobile, rollEntity } from './placement';
import { ghost } from './PlacementGhost';
import { puff } from './PuffFx';

/**
 * World input for the HUD modes, mounted inside the Canvas:
 * - one tapBus handler (priority 50, above the camera's default glide) that routes taps by mode:
 *   place (drop one entity), edit (select / move here), feed, and normal picking + follow;
 * - mouse hover moves the place-mode ghost;
 * - in edit mode, pressing on the selected plant drags it along the seabed (captured before the
 *   camera rig sees the pointer, so the camera does not orbit while dragging).
 */

export const INTERACTION_PRIORITY = 50;
const FEED_HEIGHT = 3;
const FEED_RAY_DIST = 6;
const DRAG_GRAB_PX = 64;

const _p = new Vector3();
const _q = new Vector3();
const _ndc = new Vector2();
const _ray = new Raycaster();
const _seabed = new Vector3();
const _screen: ScreenHit = { x: 0, y: 0, depth: 0 };

interface Hit {
  id: string;
  mobile: boolean;
}

export function WorldInteraction() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const el = gl.domElement;
    // Dev builds only: extend the studio's debug handle for automated checks.
    if (import.meta.env.DEV) {
      const w = window as unknown as { __noasobi?: Record<string, unknown> };
      w.__noasobi = { ...w.__noasobi, runtime, camera };
    }

    const size =() => ({ w: el.clientWidth || 1, h: el.clientHeight || 1 });

    const pick = (e: TapEvent): Hit | null => {
      const { w, h } = size();
      const fish = pickCreature(runtime.transforms, camera, w, h, e.screen.x, e.screen.y);
      if (fish) return { id: fish, mobile: true };
      const plant = raycastPlant(scene, e.ray);
      if (plant) return { id: plant.id, mobile: false };
      return null;
    };

    const entityPos = (id: string, out: Vector3) => {
      const live = runtime.transforms.get(id);
      if (live) return out.copy(live.position);
      const ent = useApp.getState().entities.find((x) => x.id === id);
      return ent ? out.fromArray(ent.position) : null;
    };

    // ── Place ────────────────────────────────────────────────────────────────────────────────
    const place = (e: TapEvent) => {
      const s = useApp.getState();
      const pl = s.placement;
      if (!pl || !e.seabedPoint) return;
      const species = trySpecies(pl.speciesId);
      if (!species) return;
      const design = s.designs[pl.designId];
      const name = design && design.name ? design.name : species.name;
      const ent = s.addEntity(rollEntity(species, pl.designId, name, e.seabedPoint.x, e.seabedPoint.z));
      const ui = useUi.getState();
      ui.setPlaced([...ui.placed, ent.id]);
      ghost.target.copy(e.seabedPoint);
      ghost.valid = true;
      puff(_p.fromArray(ent.position), isMobile(species) ? 1 : 1.4);
      sound.bloop();
    };

    // ── Move (edit mode) ─────────────────────────────────────────────────────────────────────
    const moveTo = (id: string, x: number, z: number, effects: boolean) => {
      const s = useApp.getState();
      const ent = s.entities.find((x2) => x2.id === id);
      const species = ent && trySpecies(ent.speciesId);
      if (!ent || !species) return;
      anchorAt(species, x, z, 0.5, _q);
      s.updateEntity(id, { position: [_q.x, _q.y, _q.z] });
      if (effects) {
        puff(_q, isMobile(species) ? 1 : 1.4);
        sound.bloop();
      }
    };

    // ── Feed ─────────────────────────────────────────────────────────────────────────────────
    const feed = (e: TapEvent) => {
      if (e.seabedPoint) {
        _p.copy(e.seabedPoint);
        _p.y = Math.min(SURFACE_Y - 1, _p.y + FEED_HEIGHT);
      } else {
        e.ray.at(FEED_RAY_DIST, _p);
        _p.y = Math.min(SURFACE_Y - 1, Math.max(terrainHeight(_p.x, _p.z) + 0.5, _p.y));
      }
      spawnFood(_p, 12);
      sound.sprinkle();
    };

    const onTap = (e: TapEvent): boolean => {
      const s = useApp.getState();
      switch (s.mode) {
        case 'place':
          place(e);
          return true;
        case 'edit': {
          const hit = pick(e);
          if (hit) {
            s.select(hit.id);
            sound.pop();
            return true;
          }
          if (s.selectedId && e.seabedPoint) {
            moveTo(s.selectedId, e.seabedPoint.x, e.seabedPoint.z, true);
            return true;
          }
          return false; // camera glides
        }
        case 'world': {
          if (useUi.getState().feeding) {
            feed(e);
            return true;
          }
          const hit = pick(e);
          if (hit) {
            s.select(hit.id);
            if (hit.mobile) {
              s.follow(hit.id);
            } else {
              s.follow(null);
              if (entityPos(hit.id, _p)) glideTo(_p, 1.8);
            }
            sound.pop();
            return true;
          }
          if (s.followId) {
            s.follow(null);
            s.select(null);
            if (e.seabedPoint) glideTo(e.seabedPoint);
            return true;
          }
          if (s.selectedId) s.select(null);
          return false;
        }
        default:
          return true;
      }
    };
    const offTap = addTapHandler(onTap, INTERACTION_PRIORITY);

    // ── Ray helper for raw pointer events ────────────────────────────────────────────────────
    const rayAt = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      camera.updateMatrixWorld();
      _ray.setFromCamera(_ndc, camera);
      return _ray.ray;
    };

    // ── Ghost hover (mouse) ──────────────────────────────────────────────────────────────────
    const onHover = (e: PointerEvent) => {
      if (useApp.getState().mode !== 'place') return;
      if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
      const hit = raySeabed(rayAt(e.clientX, e.clientY), _seabed);
      if (hit) {
        ghost.target.copy(hit);
        ghost.valid = true;
      }
    };
    el.addEventListener('pointermove', onHover);

    // Entering place mode: start the ghost under the camera's focus point.
    const resetGhost = () => {
      const t = getCameraTarget();
      ghost.target.set(t.x, terrainHeight(t.x, t.z), t.z);
      ghost.valid = true;
    };
    if (useApp.getState().mode === 'place') resetGhost();
    const offMode = useApp.subscribe((s, prev) => {
      if (s.mode === 'place' && (prev.mode !== 'place' || s.placement !== prev.placement)) {
        resetGhost();
        if (prev.mode !== 'place') useUi.getState().setPlaced([]);
      }
      if (s.mode !== 'world' && useUi.getState().feeding) useUi.getState().setFeeding(false);
    });

    // ── Plant drag (edit mode) ───────────────────────────────────────────────────────────────
    let drag: { pointerId: number; id: string; moved: boolean; sx: number; sy: number } | null = null;
    let pending = false;
    let raf = 0;
    const host = el.parentElement ?? el;

    const grabbable = (clientX: number, clientY: number): string | null => {
      const s = useApp.getState();
      if (s.mode !== 'edit' || !s.selectedId) return null;
      const ent = s.entities.find((x) => x.id === s.selectedId);
      const species = ent && trySpecies(ent.speciesId);
      if (!ent || !species || isMobile(species)) return null;
      const hit = raycastPlant(scene, rayAt(clientX, clientY));
      if (hit && hit.id === ent.id) return ent.id;
      // Generous fallback: near the base or the lower stem on screen.
      const rect = el.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const h = Math.min(modelHeight(species) * ent.scale, 3);
      for (const f of [0, 0.5, 1]) {
        _p.set(ent.position[0], ent.position[1] + h * f, ent.position[2]);
        if (projectToScreen(_p, camera, rect.width, rect.height, _screen) && Math.hypot(_screen.x - sx, _screen.y - sy) < DRAG_GRAB_PX)
          return ent.id;
      }
      return null;
    };

    const applyDrag = () => {
      raf = 0;
      if (!drag || !pending) return;
      pending = false;
      moveTo(drag.id, _seabed.x, _seabed.z, false);
    };

    const onDragMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
      drag.moved = true;
      const hit = raySeabed(rayAt(e.clientX, e.clientY), _seabed);
      if (!hit) return;
      pending = true;
      if (!raf) raf = requestAnimationFrame(applyDrag);
    };

    const endDrag = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const d = drag;
      drag = null;
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (pending) {
        pending = false;
        moveTo(d.id, _seabed.x, _seabed.z, false);
      }
      if (d.moved) {
        const ent = useApp.getState().entities.find((x) => x.id === d.id);
        if (ent) puff(_p.fromArray(ent.position), 1.4);
        sound.bloop();
      }
    };

    const onDownCapture = (e: PointerEvent) => {
      if (e.target !== el) return;
      if (drag) {
        // Ignore extra fingers while dragging so the camera does not start a gesture mid-drag.
        e.stopPropagation();
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const id = grabbable(e.clientX, e.clientY);
      if (!id) return;
      e.stopPropagation();
      e.preventDefault();
      drag = { pointerId: e.pointerId, id, moved: false, sx: e.clientX, sy: e.clientY };
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    };
    host.addEventListener('pointerdown', onDownCapture, true);

    return () => {
      offTap();
      offMode();
      el.removeEventListener('pointermove', onHover);
      host.removeEventListener('pointerdown', onDownCapture, true);
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [camera, gl, scene]);

  return null;
}
