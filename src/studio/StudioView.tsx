/**
 * The studio's 3D view: the species mesh wearing the paint texture, the cameras for both levels,
 * pointer input (painting by raycast, orbit, pinch zoom) and thumbnail rendering.
 * Renders on demand: frames happen only when paint or the camera changes.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AmbientLight,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import type { SpeciesDef } from '../core/types';
import type { PaintEngine, StrokeStyle } from './PaintEngine';
import { BRUSH_HARDNESS } from './brushes';
import {
  fitOrtho,
  interpolateScreen,
  isSeamJump,
  linearToSrgbByte,
  projectedExtents,
  stampsAlong,
  texelScale,
  uvToCanvas,
  type Pt,
} from './paintMath';
import { L1_SIZES, l2SizeFraction, useStudio } from './studioStore';

export interface StudioViewApi {
  renderThumbnail(size?: number): string;
}

/** Facts about the mesh the studio needs: centre, size and texel density. */
export interface ModelInfo {
  center: Vector3;
  radius: number;
  /** Largest bounding-box extent, the reference for brush and pattern sizes. */
  size: number;
  unitsPerPxX: number;
  unitsPerPxY: number;
}

export function measureModel(geometry: BufferGeometry): ModelInfo {
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const box = geometry.boundingBox ?? new Box3();
  const sphere = geometry.boundingSphere ?? new Sphere();
  const s = box.getSize(new Vector3());
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const idx = geometry.getIndex();
  const t = uv
    ? texelScale(pos.array as ArrayLike<number>, uv.array as ArrayLike<number>, idx ? (idx.array as ArrayLike<number>) : null)
    : { unitsPerPxX: 1, unitsPerPxY: 1 };
  return { center: box.getCenter(new Vector3()), radius: sphere.radius, size: Math.max(s.x, s.y, s.z), ...t };
}

/** Brush radii in canvas pixels for a size given as a fraction of the model size. */
export function brushRadii(info: ModelInfo, fraction: number) {
  const r = fraction * info.size;
  let rx = r / info.unitsPerPxX;
  let ry = r / info.unitsPerPxY;
  // keep pathological UV layouts from producing needle-thin stamps
  const ratio = rx / ry;
  if (ratio > 4) rx = ry * 4;
  else if (ratio < 0.25) ry = rx * 4;
  const clamp = (v: number) => Math.max(1.2, Math.min(220, v));
  return { radiusX: clamp(rx), radiusY: clamp(ry) };
}

/**
 * Geometry used for raycasting: species may include non-paintable parts flagged by an `aEye`
 * attribute (x > 0.5), e.g. the clownfish's eye domes. Those triangles are left out so strokes
 * paint the body underneath instead of stopping at the eye.
 */
export function paintableGeometry(geometry: BufferGeometry): BufferGeometry {
  const eye = geometry.getAttribute('aEye');
  if (!eye) return geometry;
  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : geometry.getAttribute('position').count / 3;
  const keep: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const a = index ? index.getX(t * 3) : t * 3;
    const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    if (eye.getX(a) > 0.5 && eye.getX(b) > 0.5 && eye.getX(c) > 0.5) continue;
    keep.push(a, b, c);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', geometry.getAttribute('position'));
  g.setAttribute('uv', geometry.getAttribute('uv'));
  g.setIndex(keep);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Draws eyes procedurally on vertices flagged by `aEye` = (isEye, ex, ey), ignoring the paint. */
function applyEyeShader(shader: { vertexShader: string; fragmentShader: string }) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
attribute vec3 aEye;
varying vec3 vEye;`)
    .replace('#include <uv_vertex>', `#include <uv_vertex>
vEye = aEye;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec3 vEye;`)
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
if (vEye.x > 0.5) {
  float r = length(vEye.yz);
  vec3 eyeCol = mix(vec3(0.02), vec3(0.32, 0.2, 0.06), smoothstep(0.5, 0.6, r));
  eyeCol = mix(eyeCol, vec3(0.03), smoothstep(0.85, 0.95, r));
  float hl = 1.0 - smoothstep(0.12, 0.2, length(vEye.yz - vec2(-0.28, 0.32)));
  diffuseColor.rgb = mix(eyeCol, vec3(1.0), hl);
}`,
    );
}

const SEAM_JUMP = 64; // canvas px; consecutive hits further apart crossed a UV seam
const SCREEN_STEP = 3; // css px between raycasts along a stroke

/** Direction rotated 180 degrees about `up` (look at the other flank). */
function flipDir(d: Vector3, up: Vector3) {
  return up.clone().multiplyScalar(2 * d.dot(up)).sub(d);
}

/** Camera basis and ortho framing for viewing the model along `dir`. */
function frameOrtho(cam: OrthographicCamera, geometry: BufferGeometry, info: ModelInfo, dir: Vector3, up: Vector3, aspect: number, margin: number) {
  const d = dir.clone().normalize();
  const right = new Vector3().crossVectors(d, up).normalize();
  const u = new Vector3().crossVectors(right, d).normalize();
  const pos = geometry.getAttribute('position').array as ArrayLike<number>;
  const e = projectedExtents(pos, right.toArray() as [number, number, number], u.toArray() as [number, number, number]);
  const { halfW, halfH } = fitOrtho(e.maxR - e.minR, e.maxU - e.minU, aspect, margin);
  const target = right
    .clone()
    .multiplyScalar((e.minR + e.maxR) / 2)
    .add(u.clone().multiplyScalar((e.minU + e.maxU) / 2))
    .add(d.clone().multiplyScalar(info.center.dot(d)));
  const dist = info.radius * 4 + 1;
  cam.left = -halfW;
  cam.right = halfW;
  cam.top = halfH;
  cam.bottom = -halfH;
  cam.near = 0.01;
  cam.far = dist * 2 + info.radius * 2;
  cam.up.copy(u);
  cam.position.copy(target).addScaledVector(d, -dist);
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}

function makeLights() {
  const ambient = new AmbientLight(0xfff8f0, 1.55);
  const key = new DirectionalLight(0xffffff, 1.6);
  return { ambient, key };
}

/** Points the key light from slightly above and to the left of the camera. */
function aimKeyLight(key: DirectionalLight, cam: { position: Vector3; up: Vector3 }, target: Vector3) {
  const toCam = cam.position.clone().sub(target).normalize();
  const right = new Vector3().crossVectors(cam.up, toCam).normalize();
  key.position.copy(target).add(toCam.multiplyScalar(3)).addScaledVector(cam.up, 1.6).addScaledVector(right, -1.2);
  key.target.position.copy(target);
  key.target.updateMatrixWorld();
}

interface Props {
  engine: PaintEngine;
  species: SpeciesDef;
  geometry: BufferGeometry;
  info: ModelInfo;
  level: 1 | 2;
  apiRef: React.MutableRefObject<StudioViewApi | null>;
}

export function StudioView({ engine, species, geometry, info, level, apiRef }: Props) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const set = useThree((s) => s.set);
  const invalidate = useThree((s) => s.invalidate);
  const flipped = useStudio((s) => s.flipped);
  const rotateMode = useStudio((s) => s.rotateMode);

  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ map: engine.texture, roughness: 0.78, metalness: 0, side: DoubleSide });
    if (geometry.getAttribute('aEye')) m.onBeforeCompile = applyEyeShader;
    return m;
  }, [engine, geometry]);
  const pickGeometry = useMemo(() => paintableGeometry(geometry), [geometry]);
  useEffect(() => () => {
    if (pickGeometry !== geometry) pickGeometry.dispose();
  }, [pickGeometry, geometry]);
  const pickMesh = useMemo(() => new Mesh(pickGeometry, new MeshBasicMaterial({ side: DoubleSide })), [pickGeometry]);
  useEffect(() => () => (pickMesh.material as MeshBasicMaterial).dispose(), [pickMesh]);
  useEffect(() => () => material.dispose(), [material]);

  const lights = useMemo(makeLights, []);
  const cams = useMemo(() => {
    const ortho = new OrthographicCamera();
    const persp = new PerspectiveCamera(32, 1, 0.01, 100);
    (ortho as OrthographicCamera & { manual?: boolean }).manual = true;
    (persp as PerspectiveCamera & { manual?: boolean }).manual = true;
    return { ortho, persp };
  }, []);

  // sideView.direction points from the model to the Level 1 camera; sideDir is the view direction.
  const sideDir = useMemo(() => new Vector3(...species.sideView.direction).normalize().negate(), [species]);
  const sideUp = useMemo(() => new Vector3(...species.sideView.up).normalize(), [species]);

  // Level 2 orbit state (spherical around the model centre, Y up).
  const orbit = useRef<Spherical | null>(null);
  if (!orbit.current) {
    const sph = new Spherical().setFromVector3(sideDir.clone().negate());
    sph.theta += 0.5;
    sph.phi = Math.max(0.2, Math.min(Math.PI - 0.2, sph.phi - 0.25));
    sph.radius = 1; // zoom factor; the distance is fitted to the viewport in updateCamera
    orbit.current = sph;
  }

  const updateCamera = () => {
    const aspect = Math.max(0.1, size.width / Math.max(1, size.height));
    if (level === 1) {
      const dir = flipped ? flipDir(sideDir, sideUp) : sideDir;
      frameOrtho(cams.ortho, geometry, info, dir, sideUp, aspect, 1.12);
      aimKeyLight(lights.key, cams.ortho, info.center);
    } else {
      const p = cams.persp;
      const sph = orbit.current!;
      p.aspect = aspect;
      // fit the bounding sphere in the narrower of the two fields of view
      const vHalf = (p.fov * Math.PI) / 360;
      const hHalf = Math.atan(Math.tan(vHalf) * aspect);
      const dist = (info.radius / Math.sin(Math.min(vHalf, hHalf))) * 1.04 * sph.radius;
      p.near = dist / 50;
      p.far = dist * 10;
      p.position.setFromSpherical(new Spherical(dist, sph.phi, sph.theta)).add(info.center);
      p.up.set(0, 1, 0);
      p.lookAt(info.center);
      p.updateProjectionMatrix();
      p.updateMatrixWorld();
      aimKeyLight(lights.key, p, info.center);
    }
    invalidate();
  };
  const updateRef = useRef(updateCamera);
  updateRef.current = updateCamera;

  useLayoutEffect(() => {
    set({ camera: level === 1 ? cams.ortho : cams.persp });
    updateCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, flipped, size.width, size.height, cams, set]);

  // Paint changes trigger a frame; the frame uploads the texture at most once.
  useEffect(() => {
    engine.onInvalidate = () => invalidate();
    invalidate();
    return () => {
      engine.onInvalidate = () => {};
    };
  }, [engine, invalidate]);

  useFrame(() => {
    engine.flush();
  });

  useEffect(() => {
    gl.domElement.style.cursor = level === 2 && rotateMode ? 'grab' : 'crosshair';
  }, [gl, level, rotateMode]);

  // ---------- pointer input ----------
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: 'idle' | 'paint' | 'orbit' | 'gesture' = 'idle';
    let strokeStart = 0;
    let lastScreen: Pt = { x: 0, y: 0 };
    let lastHit: Pt | null = null;
    let carry = 0;
    let gesture = { mid: { x: 0, y: 0 }, dist: 1 };

    const camera = () => (level === 1 ? cams.ortho : cams.persp);

    const raycast = (p: Pt): Pt | null => {
      const mesh = pickMesh;
      const rect = el.getBoundingClientRect();
      ndc.set(((p.x - rect.left) / rect.width) * 2 - 1, -((p.y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera());
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (!hit || !hit.uv) return null;
      return uvToCanvas(hit.uv.x, hit.uv.y);
    };

    const currentStyle = (): StrokeStyle => {
      const st = useStudio.getState();
      const fraction = level === 1 ? L1_SIZES[st.sizeIndex] : l2SizeFraction(st.size);
      const tool = st.tool === 'eyedropper' ? 'brush' : st.tool;
      return {
        tool,
        brush: st.brush,
        color: st.color,
        pattern: st.pattern,
        ...brushRadii(info, fraction),
        opacity: level === 1 ? 1 : st.opacity,
        hardness: level === 1 ? (tool === 'eraser' ? 0.9 : BRUSH_HARDNESS[st.brush]) : st.hardness,
        mirror: level === 1 ? true : st.mirror,
      };
    };

    const stampTo = (p: Pt) => {
      const pts = interpolateScreen(lastScreen, p, SCREEN_STEP);
      lastScreen = p;
      for (const q of pts) {
        const h = raycast(q);
        if (!h) {
          lastHit = null;
          continue;
        }
        if (!lastHit || isSeamJump(lastHit, h, SEAM_JUMP)) {
          engine.stamp(h.x, h.y);
          carry = 0;
        } else {
          const r = stampsAlong(lastHit, h, engine.spacing, carry);
          carry = r.carry;
          for (const s of r.points) engine.stamp(s.x, s.y);
        }
        lastHit = h;
      }
    };

    const beginPaint = (p: Pt) => {
      const st = useStudio.getState();
      if (st.tool === 'eyedropper') {
        const h = raycast(p);
        if (h) {
          st.set({ color: engine.pick(h.x, h.y) });
          st.setTool(st.prevTool);
        }
        mode = 'idle';
        return;
      }
      engine.beginStroke(currentStyle());
      mode = 'paint';
      strokeStart = performance.now();
      lastScreen = p;
      lastHit = raycast(p);
      carry = 0;
      if (lastHit) engine.stamp(lastHit.x, lastHit.y);
    };

    const endPaint = () => {
      if (mode !== 'paint') return;
      engine.endStroke();
      const st = useStudio.getState();
      if (st.tool !== 'eraser') st.pushRecent(st.color);
      mode = 'idle';
    };

    const rotateBy = (dx: number, dy: number) => {
      const sph = orbit.current!;
      const k = (Math.PI * 1.4) / Math.max(200, Math.min(size.width, size.height));
      sph.theta -= dx * k;
      sph.phi = Math.max(0.12, Math.min(Math.PI - 0.12, sph.phi - dy * k));
      updateRef.current();
    };

    const zoomBy = (factor: number) => {
      const sph = orbit.current!;
      sph.radius = Math.max(0.3, Math.min(2.5, sph.radius * factor));
      updateRef.current();
    };

    const gestureState = () => {
      const [a, b] = [...pointers.values()];
      return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)) };
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      const p = { x: e.clientX, y: e.clientY };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events */
      }
      if (e.pointerType === 'mouse') {
        if (e.button === 0 && !(level === 2 && useStudio.getState().rotateMode)) beginPaint(p);
        else if (level === 2) {
          mode = 'orbit';
          lastScreen = p;
        }
        return;
      }
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        if (level === 2 && useStudio.getState().rotateMode) {
          mode = 'orbit';
          lastScreen = p;
        } else beginPaint(p);
      } else if (pointers.size === 2) {
        if (mode === 'paint') {
          // A second finger landing right away means a pinch, not a stroke.
          if (performance.now() - strokeStart < 350) engine.cancelStroke();
          else engine.endStroke();
        }
        mode = level === 2 ? 'gesture' : 'idle';
        gesture = gestureState();
      }
    };

    const onMove = (e: PointerEvent) => {
      const p = { x: e.clientX, y: e.clientY };
      if (e.pointerType !== 'mouse') {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, p);
      }
      if (mode === 'paint') {
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        if (events.length > 1) for (const ce of events) stampTo({ x: ce.clientX, y: ce.clientY });
        else stampTo(p);
      } else if (mode === 'orbit') {
        rotateBy(p.x - lastScreen.x, p.y - lastScreen.y);
        lastScreen = p;
      } else if (mode === 'gesture' && pointers.size >= 2) {
        const g = gestureState();
        rotateBy(g.mid.x - gesture.mid.x, g.mid.y - gesture.mid.y);
        zoomBy(gesture.dist / g.dist);
        gesture = g;
      }
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (mode === 'paint') endPaint();
      else if (mode === 'orbit') mode = 'idle';
      else if (mode === 'gesture' && pointers.size < 2) mode = 'idle';
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (level === 2) zoomBy(Math.exp(e.deltaY * 0.0015));
    };
    const onContext = (e: Event) => e.preventDefault();

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);
    return () => {
      if (mode === 'paint') engine.endStroke();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
    };
  }, [gl, engine, level, cams, info, pickMesh, size.width, size.height]);

  // ---------- thumbnail ----------
  useEffect(() => {
    apiRef.current = {
      renderThumbnail(out = 128) {
        engine.flush();
        const res = out * 2;
        const rt = new WebGLRenderTarget(res, res);
        const scene = new Scene();
        const { ambient, key } = makeLights();
        scene.add(ambient, key, key.target);
        const mesh = new Mesh(geometry, material);
        scene.add(mesh);
        // a friendly 3/4 view: rotate the side view a little and look slightly from above
        const sph = new Spherical().setFromVector3(sideDir.clone().negate());
        sph.theta += species.kind === 'plant' ? 0.3 : 0.55;
        sph.phi = Math.max(0.2, sph.phi - 0.3);
        const dir = new Vector3().setFromSpherical(sph).negate();
        const cam = new OrthographicCamera();
        frameOrtho(cam, geometry, info, dir, sideUp, 1, 1.08);
        aimKeyLight(key, cam, info.center);

        const prevTarget = gl.getRenderTarget();
        const prevColor = gl.getClearColor(new Color());
        const prevAlpha = gl.getClearAlpha();
        gl.setRenderTarget(rt);
        gl.setClearColor(0x000000, 0);
        gl.clear();
        gl.render(scene, cam);
        const buf = new Uint8Array(res * res * 4);
        gl.readRenderTargetPixels(rt, 0, 0, res, res, buf);
        gl.setRenderTarget(prevTarget);
        gl.setClearColor(prevColor, prevAlpha);
        rt.dispose();

        // Render targets hold linear colour: encode to sRGB and flip rows.
        const lut = new Uint8Array(256);
        for (let i = 0; i < 256; i++) lut[i] = linearToSrgbByte(i / 255);
        const big = document.createElement('canvas');
        big.width = big.height = res;
        const bctx = big.getContext('2d')!;
        const img = bctx.createImageData(res, res);
        for (let y = 0; y < res; y++) {
          const src = (res - 1 - y) * res * 4;
          const dst = y * res * 4;
          for (let x = 0; x < res * 4; x += 4) {
            const a = buf[src + x + 3];
            img.data[dst + x] = lut[buf[src + x]];
            img.data[dst + x + 1] = lut[buf[src + x + 1]];
            img.data[dst + x + 2] = lut[buf[src + x + 2]];
            img.data[dst + x + 3] = a;
          }
        }
        bctx.putImageData(img, 0, 0);
        const small = document.createElement('canvas');
        small.width = small.height = out;
        const sctx = small.getContext('2d')!;
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(big, 0, 0, out, out);
        invalidate();
        return small.toDataURL('image/png');
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, engine, geometry, material, info, species, sideDir, sideUp, gl, invalidate]);

  return (
    <>
      <primitive object={lights.ambient} />
      <primitive object={lights.key} />
      <primitive object={lights.key.target} />
      <mesh geometry={geometry} material={material} dispose={null} />
    </>
  );
}
