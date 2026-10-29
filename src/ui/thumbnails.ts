import {
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Spherical,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import type { SpeciesDef } from '../core/types';
import { templateDesignId } from '../core/types';
import { getDesignSource, getTemplateSource } from '../core/store';
import { sceneRefs } from '../render/sceneRefs';
import { linearToSrgbByte } from '../studio/paintMath';

/**
 * Picture of a species' natural look for the catalog and creature card, rendered once per
 * species with the main renderer into a small render target (no extra WebGL context), cached as a
 * data URL. Returns null until the main canvas exists.
 */

const cache = new Map<string, string>();
let lut: Uint8Array | null = null;

export function templateThumbnail(species: SpeciesDef, size = 128): string | null {
  const key = `${species.id}@${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const gl = sceneRefs.gl;
  if (!gl) return null;
  const source = getTemplateSource(species.id) ?? getDesignSource(templateDesignId(species.id));
  if (!source) return null;

  const res = size * 2;
  const rt = new WebGLRenderTarget(res, res);
  const geometry = species.buildGeometry();
  geometry.computeBoundingSphere();
  const map = new CanvasTexture(source);
  map.colorSpace = SRGBColorSpace;
  const material = new MeshLambertMaterial({ map });
  const scene = new Scene();
  scene.add(new AmbientLight(0xfff8f0, 1.6));
  const key1 = new DirectionalLight(0xffffff, 1.7);
  scene.add(key1, key1.target);
  scene.add(new Mesh(geometry, material));

  // A friendly 3/4 view based on the species' studio side view.
  const bs = geometry.boundingSphere!;
  const toCam = new Vector3(...species.sideView.direction).normalize();
  const sph = new Spherical().setFromVector3(toCam);
  sph.theta += species.kind === 'plant' ? 0.3 : 0.55;
  sph.phi = Math.max(0.2, sph.phi - 0.3);
  toCam.setFromSpherical(sph).normalize();
  const cam = new PerspectiveCamera(30, 1, 0.01, 100);
  const dist = (bs.radius / Math.sin((cam.fov * Math.PI) / 360)) * 0.92;
  cam.position.copy(bs.center).addScaledVector(toCam, dist);
  cam.up.set(...species.sideView.up);
  cam.lookAt(bs.center);
  cam.near = Math.max(0.01, dist - bs.radius * 2);
  cam.far = dist + bs.radius * 2;
  cam.updateProjectionMatrix();
  key1.position.copy(cam.position).add(new Vector3(-1, 2, 0).multiplyScalar(bs.radius));
  key1.target.position.copy(bs.center);
  key1.target.updateMatrixWorld();

  const prevTarget = gl.getRenderTarget();
  const prevColor = gl.getClearColor(new Color());
  const prevAlpha = gl.getClearAlpha();
  let url: string | null = null;
  try {
    gl.setRenderTarget(rt);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(scene, cam);
    const buf = new Uint8Array(res * res * 4);
    gl.readRenderTargetPixels(rt, 0, 0, res, res, buf);

    if (!lut) {
      lut = new Uint8Array(256);
      for (let i = 0; i < 256; i++) lut[i] = linearToSrgbByte(i / 255);
    }
    const big = document.createElement('canvas');
    big.width = big.height = res;
    const bctx = big.getContext('2d')!;
    const img = bctx.createImageData(res, res);
    for (let y = 0; y < res; y++) {
      const src = (res - 1 - y) * res * 4;
      const dst = y * res * 4;
      for (let x = 0; x < res * 4; x += 4) {
        img.data[dst + x] = lut[buf[src + x]];
        img.data[dst + x + 1] = lut[buf[src + x + 1]];
        img.data[dst + x + 2] = lut[buf[src + x + 2]];
        img.data[dst + x + 3] = buf[src + x + 3];
      }
    }
    bctx.putImageData(img, 0, 0);
    const small = document.createElement('canvas');
    small.width = small.height = size;
    const sctx = small.getContext('2d')!;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(big, 0, 0, size, size);
    url = small.toDataURL('image/png');
    cache.set(key, url);
  } catch (err) {
    console.warn('template thumbnail failed', err);
  } finally {
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(prevColor, prevAlpha);
    rt.dispose();
    geometry.dispose();
    material.dispose();
    map.dispose();
  }
  return url;
}
