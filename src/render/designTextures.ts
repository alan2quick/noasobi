import {
  ClampToEdgeWrapping,
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';

/**
 * All painted designs (and species templates) live in one texture array so every instance of a
 * species renders in a single draw call, each instance picking its layer.
 * In-world resolution is half the studio canvas to keep GPU memory low on phones.
 */
export const ARRAY_TEX_W = 512;
export const ARRAY_TEX_H = 256;
const LAYER_BYTES = ARRAY_TEX_W * ARRAY_TEX_H * 4;

type Listener = () => void;

class DesignTextureArray {
  /** Pass this object by reference as a shader uniform; `.value` changes when the array grows. */
  readonly uniform: { value: DataArrayTexture };
  private layers = new Map<string, number>();
  private freeLayers: number[] = [];
  private capacity = 0;
  private data = new Uint8Array(0);
  private scratch: CanvasRenderingContext2D | null = null;
  private listeners = new Set<Listener>();

  constructor(initialCapacity = 8) {
    this.uniform = { value: this.allocate(initialCapacity) };
  }

  private allocate(capacity: number): DataArrayTexture {
    const data = new Uint8Array(LAYER_BYTES * capacity);
    data.set(this.data.subarray(0, Math.min(this.data.length, data.length)));
    for (let l = this.capacity; l < capacity; l++) this.freeLayers.push(l);
    this.data = data;
    this.capacity = capacity;
    const tex = new DataArrayTexture(data, ARRAY_TEX_W, ARRAY_TEX_H, capacity);
    tex.format = RGBAFormat;
    tex.type = UnsignedByteType;
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  private grow() {
    const old = this.uniform.value;
    this.uniform.value = this.allocate(this.capacity * 2);
    old.dispose();
  }

  has(designId: string) {
    return this.layers.has(designId);
  }

  /** Layer index for a design, or -1 if it has not been uploaded. */
  layerOf(designId: string): number {
    return this.layers.get(designId) ?? -1;
  }

  /** Uploads (or replaces) a design. `source` is usually the studio's 1024x512 paint canvas. */
  setDesign(designId: string, source: CanvasImageSource): number {
    let layer = this.layers.get(designId);
    if (layer === undefined) {
      if (this.freeLayers.length === 0) this.grow();
      layer = this.freeLayers.shift()!;
      this.layers.set(designId, layer);
    }
    const ctx = this.getScratch();
    ctx.clearRect(0, 0, ARRAY_TEX_W, ARRAY_TEX_H);
    ctx.drawImage(source, 0, 0, ARRAY_TEX_W, ARRAY_TEX_H);
    const pixels = ctx.getImageData(0, 0, ARRAY_TEX_W, ARRAY_TEX_H).data;
    // Flip rows so canvas top lands on v = 1, matching CanvasTexture's default flipY.
    const rowBytes = ARRAY_TEX_W * 4;
    const base = layer * LAYER_BYTES;
    for (let y = 0; y < ARRAY_TEX_H; y++) {
      const src = (ARRAY_TEX_H - 1 - y) * rowBytes;
      this.data.set(pixels.subarray(src, src + rowBytes), base + y * rowBytes);
    }
    const tex = this.uniform.value;
    tex.addLayerUpdate(layer);
    tex.needsUpdate = true;
    this.emit();
    return layer;
  }

  removeDesign(designId: string) {
    const layer = this.layers.get(designId);
    if (layer === undefined) return;
    this.layers.delete(designId);
    this.freeLayers.push(layer);
    this.emit();
  }

  /** Called when layers are added, replaced or removed, so renderers can refresh layer attributes. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  private getScratch() {
    if (!this.scratch) {
      const canvas = document.createElement('canvas');
      canvas.width = ARRAY_TEX_W;
      canvas.height = ARRAY_TEX_H;
      this.scratch = canvas.getContext('2d', { willReadFrequently: true })!;
    }
    return this.scratch;
  }
}

export const designTextures = new DesignTextureArray();

/**
 * Call inside a material's onBeforeCompile (MeshLambertMaterial or MeshStandardMaterial) to make
 * it sample its base colour from the design array. The geometry (or InstancedMesh) must provide a
 * float attribute `aDesignLayer`; use an InstancedBufferAttribute for per-instance designs.
 * Compose it with your own vertex patches; it only touches <common>, <uv_vertex> and <map_fragment>.
 */
export function applyDesignArray(shader: WebGLProgramParametersWithUniforms) {
  shader.uniforms.uDesignArray = designTextures.uniform;
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute float aDesignLayer;
varying vec2 vDesignUv;
flat varying float vDesignLayer;`,
    )
    .replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
vDesignUv = uv;
vDesignLayer = aDesignLayer;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uDesignArray;
varying vec2 vDesignUv;
flat varying float vDesignLayer;`,
    )
    .replace('#include <map_fragment>', 'diffuseColor *= texture(uDesignArray, vec3(vDesignUv, vDesignLayer));');
}
