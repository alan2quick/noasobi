/**
 * The studio paint stack.
 *
 *   base    colouring page or the design being edited (never painted on)
 *   paint   everything the player painted; the eraser removes from here so the base shows again
 *   stroke  coverage mask of the stroke in progress (white stamps)
 *   display base + paint + live stroke, shown on the model through a CanvasTexture
 *
 * Stamps only go into the stroke mask. Colour, pattern and crayon grain are applied when the mask is
 * composited, and the whole stroke is committed to `paint` with the chosen opacity on pointer up.
 * Only the region touched since the last frame is recomposited, and the texture is flagged for
 * upload at most once per frame (call `flush()` from the render loop).
 */
import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Symmetry } from '../core/types';
import { BRUSH_SPACING, getGrainTile, getStamps, type BrushId } from './brushes';
import { getPatternTile, type PatternId } from './patterns';
import {
  H,
  W,
  clampRect,
  emptyRect,
  includeBox,
  isEmptyRect,
  mergeRects,
  mirrorRect,
  mirrorX,
  rgbToHex,
  type Rect,
} from './paintMath';

export type PaintTool = 'brush' | 'eraser' | 'pattern';

export interface StrokeStyle {
  tool: PaintTool;
  brush: BrushId;
  color: string;
  pattern: PatternId;
  /** Stamp radii in canvas pixels (x and y differ when the UV layout is stretched). */
  radiusX: number;
  radiusY: number;
  opacity: number;
  hardness: number;
  mirror: boolean;
}

interface Patch {
  x: number;
  y: number;
  w: number;
  h: number;
  data: ImageData;
}

interface HistoryEntry {
  patches: Patch[];
  /** Base canvas before the operation, when the operation replaced the base (start over). */
  base?: HTMLCanvasElement;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  /** Number of edits since the last save; 0 = nothing to lose. */
  edits: number;
}

const MAX_STEPS = 20;
const MAX_BYTES = 64 * 1024 * 1024;
const FULL: Rect = { x: 0, y: 0, w: W, h: H };

function canvas2d(w = W, h = H): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export class PaintEngine {
  readonly texture: CanvasTexture;
  readonly display: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private readonly template: HTMLCanvasElement;
  private readonly paint: HTMLCanvasElement;
  private readonly stroke: HTMLCanvasElement;
  private readonly tmp: HTMLCanvasElement;
  private readonly dctx: CanvasRenderingContext2D;
  private readonly pctx: CanvasRenderingContext2D;
  private readonly sctx: CanvasRenderingContext2D;
  private readonly tctx: CanvasRenderingContext2D;

  /** Regions to recomposite, one per half so mirrored strokes do not redraw the whole width. */
  private pending: [Rect, Rect] = [emptyRect(), emptyRect()];
  private grain: HTMLCanvasElement | null = null;
  private strokeRect: Rect = emptyRect();
  private style: StrokeStyle | null = null;
  private stamps: HTMLCanvasElement[] = [];
  private stampCount = 0;

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private edits = 0;
  private listeners = new Set<(h: HistoryState) => void>();

  /** Called whenever something needs a redraw (hook it to R3F's invalidate). */
  onInvalidate: () => void = () => {};

  constructor(
    initialBase: HTMLCanvasElement,
    template: HTMLCanvasElement,
    readonly symmetry: Symmetry,
    /** Base pattern tile size in canvas pixels along x and y (texel-aspect corrected). */
    public tilePx: { x: number; y: number } = { x: 64, y: 64 },
  ) {
    this.base = initialBase;
    this.template = template;
    let ctx: CanvasRenderingContext2D;
    [this.display, ctx] = canvas2d();
    this.dctx = ctx;
    [this.paint, this.pctx] = canvas2d();
    [this.stroke, this.sctx] = canvas2d();
    [this.tmp, this.tctx] = canvas2d();
    this.texture = new CanvasTexture(this.display);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.markDirty(FULL);
  }

  // ---------- history ----------

  subscribe(fn: (h: HistoryState) => void): () => void {
    this.listeners.add(fn);
    fn(this.historyState());
    return () => this.listeners.delete(fn);
  }

  historyState(): HistoryState {
    return { canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, edits: this.edits };
  }

  private emitHistory() {
    const h = this.historyState();
    this.listeners.forEach((fn) => fn(h));
  }

  private capture(rects: Rect[]): Patch[] {
    return rects.map((r) => ({ ...r, data: this.pctx.getImageData(r.x, r.y, r.w, r.h) }));
  }

  private pushUndo(entry: HistoryEntry) {
    this.undoStack.push(entry);
    this.redoStack = [];
    this.edits++;
    const bytes = (e: HistoryEntry) => e.patches.reduce((s, p) => s + p.data.data.byteLength, 0);
    let total = this.undoStack.reduce((s, e) => s + bytes(e), 0);
    while (this.undoStack.length > MAX_STEPS || (total > MAX_BYTES && this.undoStack.length > 1)) {
      total -= bytes(this.undoStack.shift()!);
    }
    this.emitHistory();
  }

  private swap(from: HistoryEntry[], to: HistoryEntry[]) {
    const entry = from.pop();
    if (!entry) return;
    if (this.style) this.cancelStroke();
    const reverse: HistoryEntry = { patches: this.capture(entry.patches) };
    if (entry.base) {
      reverse.base = this.base;
      this.base = entry.base;
    }
    for (const p of entry.patches) this.pctx.putImageData(p.data, p.x, p.y);
    to.push(reverse);
    this.edits = Math.max(0, this.edits + (from === this.undoStack ? -1 : 1));
    if (entry.base) this.markDirty(FULL);
    else entry.patches.forEach((p) => this.markDirty(p));
    this.emitHistory();
  }

  undo() {
    this.swap(this.undoStack, this.redoStack);
  }

  redo() {
    this.swap(this.redoStack, this.undoStack);
  }

  /** Call after saving so the cancel button stops asking. */
  markSaved() {
    this.edits = 0;
    this.emitHistory();
  }

  // ---------- strokes ----------

  /** Stamp spacing in canvas pixels for the current stroke. */
  get spacing(): number {
    if (!this.style) return 2;
    const key = this.style.tool === 'eraser' ? 'eraser' : this.style.brush;
    return Math.max(0.75, BRUSH_SPACING[key] * Math.min(this.style.radiusX, this.style.radiusY));
  }

  get stroking(): boolean {
    return this.style !== null;
  }

  beginStroke(style: StrokeStyle) {
    if (this.style) this.cancelStroke();
    this.style = { ...style, mirror: style.mirror && this.symmetry === 'bilateral' };
    const brush = style.tool === 'eraser' ? 'eraser' : style.brush;
    this.stamps = getStamps(brush === 'eraser' ? 'soft' : brush, style.hardness, Math.max(style.radiusX, style.radiusY));
    this.strokeRect = emptyRect();
    this.stampCount = 0;
  }

  /** Adds one brush stamp (and its mirror) at canvas coordinates. */
  stamp(x: number, y: number) {
    const s = this.style;
    if (!s) return;
    this.drawStamp(x, y, false, true);
    if (s.mirror) this.drawStamp(mirrorX(x), y, true, false);
  }

  private drawStamp(x: number, y: number, mirrored: boolean, track: boolean) {
    const s = this.style!;
    const img = this.stamps[this.stampCount++ % this.stamps.length];
    const rx = s.radiusX;
    const ry = s.radiusY;
    const ang = s.brush === 'crayon' && s.tool !== 'eraser' ? ((this.stampCount * 2.39996) % (Math.PI * 2)) * (mirrored ? -1 : 1) : 0;
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    const ctx = this.sctx;
    ctx.setTransform(rx * c * (mirrored ? -1 : 1), ry * sn, -rx * sn, ry * c, x, y);
    ctx.drawImage(img, -1, -1, 2, 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const m = ang ? Math.max(rx, ry) : 0;
    const ex = (m || rx) + 2;
    const ey = (m || ry) + 2;
    // Only the primary stamps are tracked: the mirrored side is mirrorRect(strokeRect).
    if (track) includeBox(this.strokeRect, x - ex, y - ey, x + ex, y + ey);
    this.markDirty({ x: x - ex, y: y - ey, w: ex * 2, h: ey * 2 });
  }

  /** Commits the stroke into the paint layer as one undo step. */
  endStroke() {
    const s = this.style;
    if (!s) return;
    const r = clampRect(this.strokeRect);
    if (!r) {
      this.style = null;
      return;
    }
    const rects = mergeRects(s.mirror ? [r, clampRect(mirrorRect(r))!] : [r]);
    const patches = this.capture(rects);
    for (const rr of rects) {
      if (s.tool === 'eraser') {
        this.pctx.globalCompositeOperation = 'destination-out';
        this.pctx.globalAlpha = s.opacity;
        this.pctx.drawImage(this.stroke, rr.x, rr.y, rr.w, rr.h, rr.x, rr.y, rr.w, rr.h);
      } else {
        this.buildTinted(rr, s);
        this.pctx.globalAlpha = s.opacity;
        this.pctx.drawImage(this.tmp, rr.x, rr.y, rr.w, rr.h, rr.x, rr.y, rr.w, rr.h);
      }
      this.pctx.globalCompositeOperation = 'source-over';
      this.pctx.globalAlpha = 1;
      this.sctx.clearRect(rr.x, rr.y, rr.w, rr.h);
      this.markDirty(rr);
    }
    this.style = null;
    this.pushUndo({ patches });
  }

  /** Drops the stroke in progress (e.g. a second finger turned it into a pinch). */
  cancelStroke() {
    if (!this.style) return;
    const r = clampRect(this.strokeRect);
    this.style = null;
    if (r) {
      const rects = mergeRects([r, mirrorRect(r)]);
      rects.forEach((rr) => {
        this.sctx.clearRect(rr.x, rr.y, rr.w, rr.h);
        this.markDirty(rr);
      });
    }
  }

  // ---------- whole-body operations ----------

  /** Paints the whole body with the colour, or the pattern when style.tool is 'pattern'. */
  fillAll(style: Pick<StrokeStyle, 'tool' | 'color' | 'pattern' | 'opacity'>) {
    if (this.style) this.cancelStroke();
    const patches = this.capture([FULL]);
    const ctx = this.pctx;
    ctx.globalAlpha = style.opacity;
    this.fillRegion(ctx, FULL, style.tool === 'pattern' ? style.pattern : null, style.color);
    ctx.globalAlpha = 1;
    this.markDirty(FULL);
    this.pushUndo({ patches });
  }

  /** Start over: wipes the paint layer, and goes back to the colouring page when editing a design. */
  clearAll() {
    if (this.style) this.cancelStroke();
    const entry: HistoryEntry = { patches: this.capture([FULL]) };
    if (this.base !== this.template) {
      entry.base = this.base;
      this.base = this.template;
    }
    this.pctx.clearRect(0, 0, W, H);
    this.markDirty(FULL);
    this.pushUndo(entry);
  }

  /** Composite colour at a canvas pixel, as #rrggbb. */
  pick(x: number, y: number): string {
    this.flush();
    const px = Math.max(0, Math.min(W - 1, Math.floor(x)));
    const py = Math.max(0, Math.min(H - 1, Math.floor(y)));
    const d = this.dctx.getImageData(px, py, 1, 1).data;
    return rgbToHex(d[0], d[1], d[2]);
  }

  /** Flattened base + paint, for saving. */
  composite(): HTMLCanvasElement {
    const [c, ctx] = canvas2d();
    ctx.drawImage(this.base, 0, 0, W, H);
    ctx.drawImage(this.paint, 0, 0);
    return c;
  }

  // ---------- compositing ----------

  private markDirty(r: Rect) {
    const wasEmpty = isEmptyRect(this.pending[0]) && isEmptyRect(this.pending[1]);
    const half = r.x + r.w / 2 < W / 2 ? 0 : 1;
    includeBox(this.pending[half], r.x, r.y, r.x + r.w, r.y + r.h);
    if (wasEmpty) this.onInvalidate();
  }

  /** Full-size paper grain, mirrored on the right flank for bilateral species. */
  private grainCanvas(): HTMLCanvasElement {
    if (this.grain) return this.grain;
    const [c, ctx] = canvas2d();
    const pat = ctx.createPattern(getGrainTile(), 'repeat')!;
    ctx.fillStyle = pat;
    if (this.symmetry === 'bilateral') {
      ctx.fillRect(0, 0, W / 2, H);
      ctx.setTransform(-1, 0, 0, 1, W, 0);
      ctx.fillRect(0, 0, W / 2, H);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else ctx.fillRect(0, 0, W, H);
    this.grain = c;
    return c;
  }

  /** Fills a region with a colour or a pattern; bilateral species get the pattern mirrored on the right flank. */
  private fillRegion(ctx: CanvasRenderingContext2D, r: Rect, pattern: PatternId | null, color: string) {
    if (!pattern) {
      ctx.fillStyle = color;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      return;
    }
    const tile = getPatternTile(pattern, color, this.tilePx.x, this.tilePx.y);
    const pat = ctx.createPattern(tile, 'repeat');
    if (!pat) return;
    ctx.fillStyle = pat;
    if (this.symmetry !== 'bilateral') {
      ctx.fillRect(r.x, r.y, r.w, r.h);
      return;
    }
    const mid = W / 2;
    if (r.x < mid) ctx.fillRect(r.x, r.y, Math.min(r.x + r.w, mid) - r.x, r.h);
    if (r.x + r.w > mid) {
      const x0 = Math.max(r.x, mid);
      const x1 = r.x + r.w;
      ctx.save();
      ctx.setTransform(-1, 0, 0, 1, W, 0);
      ctx.fillRect(W - x1, r.y, x1 - x0, r.h);
      ctx.restore();
    }
  }

  /** tmp <- (colour or pattern) masked by the stroke coverage (and crayon grain) inside r. */
  private buildTinted(r: Rect, s: StrokeStyle) {
    const t = this.tctx;
    t.globalCompositeOperation = 'source-over';
    t.clearRect(r.x, r.y, r.w, r.h);
    this.fillRegion(t, r, s.tool === 'pattern' ? s.pattern : null, s.color);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(this.stroke, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    // One drawImage: 'destination-in' is unbounded, so a second fill would wipe the first.
    if (s.brush === 'crayon') t.drawImage(this.grainCanvas(), r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    t.globalCompositeOperation = 'source-over';
  }

  /** Recomposites what changed since the last frame. Returns true if the texture needs uploading. */
  flush(): boolean {
    const rects = this.pending.map((p) => clampRect(p)).filter((r): r is Rect => r !== null);
    this.pending = [emptyRect(), emptyRect()];
    if (rects.length === 0) return false;
    for (const r of mergeRects(rects)) this.compositeRect(r);
    this.texture.needsUpdate = true;
    return true;
  }

  private compositeRect(r: Rect) {
    const d = this.dctx;
    const s = this.style;
    d.clearRect(r.x, r.y, r.w, r.h);
    d.drawImage(this.base, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    if (s && s.tool === 'eraser') {
      const t = this.tctx;
      t.clearRect(r.x, r.y, r.w, r.h);
      t.drawImage(this.paint, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      t.globalCompositeOperation = 'destination-out';
      t.globalAlpha = s.opacity;
      t.drawImage(this.stroke, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      t.globalCompositeOperation = 'source-over';
      t.globalAlpha = 1;
      d.drawImage(this.tmp, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    } else {
      d.drawImage(this.paint, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      if (s) {
        this.buildTinted(r, s);
        d.globalAlpha = s.opacity;
        d.drawImage(this.tmp, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        d.globalAlpha = 1;
      }
    }
  }

  dispose() {
    this.texture.dispose();
    this.listeners.clear();
    this.undoStack = [];
    this.redoStack = [];
    // Release canvas backing stores early on memory-tight phones.
    for (const c of [this.display, this.paint, this.stroke, this.tmp, this.grain]) if (c) c.width = c.height = 1;
  }
}
