/**
 * Design studio: paint a species, save the design, go back to the world.
 * Level 1 (default) is a flat, locked side view with big simple tools for young children.
 * Level 2 is a rotatable 3D view with sliders, eyedropper, mirror toggle and redo.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import type { BufferGeometry } from 'three';
import { getDesignSource, useApp } from '../core/store';
import { DESIGN_TEX_HEIGHT, DESIGN_TEX_WIDTH, type SpeciesDef } from '../core/types';
import { getSpecies } from '../species';
import { ColorWheel, Slider } from './ColorWheel';
import { PaintEngine, type HistoryState } from './PaintEngine';
import { StudioView, measureModel, type ModelInfo, type StudioViewApi } from './StudioView';
import type { BrushId } from './brushes';
import { PATTERNS, patternPreview, type PatternId } from './patterns';
import { SWATCHES, useStudio } from './studioStore';
import { testFish } from './dev/testFish';
import {
  BucketIcon,
  CheckIcon,
  CloseIcon,
  CrayonIcon,
  CubeIcon,
  DotIcon,
  DropperIcon,
  EraserIcon,
  FlatIcon,
  FlipIcon,
  HandPaintIcon,
  HardnessIcon,
  MirrorIcon,
  OpacityIcon,
  PaletteIcon,
  PencilIcon,
  RedoIcon,
  RotateIcon,
  SoftBrushIcon,
  TagIcon,
  TrashIcon,
  UndoIcon,
} from './icons';
import './studio.css';

/** `?studioTest` swaps the clownfish for a dev test fish and exposes stores on window. */
const STUDIO_TEST = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('studioTest');
// Dev builds expose the stores for debugging and automated checks.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__noasobi = { useApp, useStudio };
}
if (STUDIO_TEST) queueMicrotask(() => useApp.getState().openStudio('clownfish'));

function resolveSpecies(id: string): SpeciesDef {
  if (STUDIO_TEST && id === 'clownfish') return testFish;
  return getSpecies(id);
}

/** The uncoloured colouring-book page (or the natural template for species without one). */
function drawColoringPageCanvas(species: SpeciesDef): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = DESIGN_TEX_WIDTH;
  c.height = DESIGN_TEX_HEIGHT;
  const ctx = c.getContext('2d')!;
  if (species.drawColoringPage) species.drawColoringPage(ctx);
  else species.drawTemplate(ctx);
  return c;
}

export function DesignStudio() {
  const studio = useApp((s) => s.studio);
  if (!studio) return null;
  return <Studio key={`${studio.speciesId}|${studio.designId ?? ''}`} speciesId={studio.speciesId} designId={studio.designId} />;
}

const BRUSHES: { id: BrushId; Icon: typeof PencilIcon }[] = [
  { id: 'pencil', Icon: PencilIcon },
  { id: 'soft', Icon: SoftBrushIcon },
  { id: 'crayon', Icon: CrayonIcon },
];

function Studio({ speciesId, designId }: { speciesId: string; designId?: string }) {
  const species = useMemo(() => resolveSpecies(speciesId), [speciesId]);
  const level = useApp((s) => s.designLevel);
  const setDesignLevel = useApp((s) => s.setDesignLevel);
  const closeStudio = useApp((s) => s.closeStudio);
  const existing = useApp((s) => (designId ? s.designs[designId] : undefined));

  const st = useStudio();
  const [engine, setEngine] = useState<PaintEngine | null>(null);
  const [model, setModel] = useState<{ geometry: BufferGeometry; info: ModelInfo } | null>(null);
  const [history, setHistory] = useState<HistoryState>({ canUndo: false, canRedo: false, edits: 0 });
  const [confirm, setConfirm] = useState<'clear' | 'cancel' | null>(null);
  const [tab, setTab] = useState<'tools' | 'colors'>('tools');
  const [saving, setSaving] = useState(false);
  const apiRef = useRef<StudioViewApi | null>(null);

  // Geometry + paint engine are created in an effect so StrictMode's mount/unmount/mount cycle
  // never leaves us holding a disposed engine.
  useEffect(() => {
    const geometry = species.buildGeometry();
    const info = measureModel(geometry);
    // New designs start from the colouring page, and "start over" goes back to it. The natural
    // look stays available as the species template in the catalog.
    const page = drawColoringPageCanvas(species);
    const base = (designId && getDesignSource(designId)) || page;
    // Pattern tiles about 56 canvas px, stretched so motifs stay round on the model.
    const a = info.unitsPerPxX;
    const b = info.unitsPerPxY;
    const T = 56;
    const tile = { x: T * Math.sqrt(b / a), y: T * Math.sqrt(a / b) };
    const eng = new PaintEngine(base, page, species.symmetry, tile);
    const unsub = eng.subscribe(setHistory);
    setEngine(eng);
    setModel({ geometry, info });
    if (import.meta.env.DEV) (window as unknown as { __noasobi: Record<string, unknown> }).__noasobi.engine = eng;
    return () => {
      unsub();
      eng.dispose();
      geometry.dispose();
      setEngine(null);
      setModel(null);
    };
  }, [species, designId]);

  // Fresh tool state per session; keep colour and brush choices.
  useEffect(() => {
    useStudio.getState().set({
      name: existing?.name ?? '',
      flipped: false,
      rotateMode: false,
      mirror: species.symmetry === 'bilateral',
      tool: useStudio.getState().tool === 'eyedropper' ? 'brush' : useStudio.getState().tool,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [species]);

  // Keyboard shortcuts for desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!engine || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) engine.redo();
        else engine.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        engine.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  const previews = useMemo(() => {
    const out = {} as Record<PatternId, string>;
    for (const p of PATTERNS) out[p] = patternPreview(p, st.color);
    return out;
  }, [st.color]);

  const save = () => {
    if (!engine || saving) return;
    setSaving(true);
    const canvas = engine.composite();
    let thumbnail = '';
    try {
      thumbnail = apiRef.current?.renderThumbnail(128) ?? '';
    } catch (err) {
      console.warn('thumbnail failed', err);
    }
    const name = useStudio.getState().name.trim();
    useApp.getState().saveDesign({ speciesId, designId, name: name || undefined, canvas, thumbnail });
    engine.markSaved();
    closeStudio();
  };

  const cancel = () => {
    if (history.edits > 0) setConfirm('cancel');
    else closeStudio();
  };

  const fillAll = () => {
    if (!engine) return;
    const s = useStudio.getState();
    engine.fillAll({ tool: s.tool === 'pattern' ? 'pattern' : 'brush', color: s.color, pattern: s.pattern, opacity: level === 1 ? 1 : s.opacity });
    s.pushRecent(s.color);
  };

  const L2 = level === 2;
  const bilateral = species.symmetry === 'bilateral';
  const isBrush = (id: BrushId) => st.tool === 'brush' && st.brush === id;

  const brushButtons = (
    <div className="group">
      {BRUSHES.map(({ id, Icon }) => (
        <button
          key={id}
          className={`tool ${isBrush(id) ? 'on' : ''}`}
          onClick={() => {
            st.set({ brush: id });
            st.setTool('brush');
          }}
          aria-label={id}
        >
          <Icon color={id === 'pencil' ? undefined : st.color} />
        </button>
      ))}
      <button className={`tool ${st.tool === 'eraser' ? 'on' : ''}`} onClick={() => st.setTool('eraser')} aria-label="eraser">
        <EraserIcon />
      </button>
      {L2 && (
        <button className={`tool ${st.tool === 'eyedropper' ? 'on' : ''}`} onClick={() => st.setTool('eyedropper')} aria-label="pick colour">
          <DropperIcon color={st.color} />
        </button>
      )}
    </div>
  );

  const sizeButtons = !L2 && (
    <div className="group sizes">
      {[6, 10, 15].map((r, i) => (
        <button key={i} className={`tool ${st.sizeIndex === i ? 'on' : ''}`} onClick={() => st.set({ sizeIndex: i })} aria-label={`size ${i + 1}`}>
          <DotIcon r={r} color={st.tool === 'eraser' ? '#f8bbd0' : st.color} />
        </button>
      ))}
    </div>
  );

  const patternButtons = (
    <div className="group patterns">
      {PATTERNS.map((p) => (
        <button
          key={p}
          className={`tool pattern ${st.tool === 'pattern' && st.pattern === p ? 'on' : ''}`}
          onClick={() => {
            st.set({ pattern: p });
            st.setTool('pattern');
          }}
          aria-label={p}
        >
          <img src={previews[p]} alt="" draggable={false} />
        </button>
      ))}
    </div>
  );

  const bucketPreview = st.tool === 'pattern' ? previews[st.pattern] : undefined;
  const actionButtons = (
    <div className="group">
      <button className="tool bucket" onClick={fillAll} aria-label="paint everything">
        <span className="bucket-swatch" style={bucketPreview ? { backgroundImage: `url(${bucketPreview})` } : { background: st.color }} />
        <BucketIcon color={st.color} />
      </button>
      {L2 && bilateral && (
        <button className={`tool ${st.mirror ? 'on' : ''}`} onClick={() => st.set({ mirror: !st.mirror })} aria-label="mirror">
          <MirrorIcon on={st.mirror} />
        </button>
      )}
    </div>
  );

  const sliders = L2 && (
    <div className="sliders">
      <Slider value={st.size} onChange={(size) => st.set({ size })} left={<DotIcon r={4} />} right={<DotIcon r={16} />} label="brush size" />
      <Slider value={st.opacity} onChange={(opacity) => st.set({ opacity: Math.max(0.05, opacity) })} left={<OpacityIcon solid={false} />} right={<OpacityIcon solid />} label="opacity" />
      <Slider value={st.hardness} onChange={(hardness) => st.set({ hardness })} left={<HardnessIcon hard={false} />} right={<HardnessIcon hard />} label="hardness" />
    </div>
  );

  const nameField = L2 && (
    <label className="name-field">
      <TagIcon size={30} />
      <input value={st.name} onChange={(e) => st.set({ name: e.target.value.slice(0, 32) })} placeholder={species.name} maxLength={32} aria-label="design name" />
    </label>
  );

  const wheelSize = useWheelSize(L2);

  return (
    <div className={`studio level-${level}`} data-tab={tab}>
      <header className="topbar">
        <button className="round close" onClick={cancel} aria-label="cancel">
          <CloseIcon size={30} />
        </button>
        <div className="level-toggle" role="radiogroup" aria-label="level">
          <button className={level === 1 ? 'on' : ''} onClick={() => setDesignLevel(1)} aria-label="simple flat" role="radio" aria-checked={level === 1}>
            <FlatIcon size={30} />
          </button>
          <button className={level === 2 ? 'on' : ''} onClick={() => setDesignLevel(2)} aria-label="3D designer" role="radio" aria-checked={level === 2}>
            <CubeIcon size={30} />
          </button>
        </div>
        <div className="spacer" />
        <button className="round" disabled={!history.canUndo} onClick={() => engine?.undo()} aria-label="undo">
          <UndoIcon size={30} />
        </button>
        {L2 && (
          <button className="round" disabled={!history.canRedo} onClick={() => engine?.redo()} aria-label="redo">
            <RedoIcon size={30} />
          </button>
        )}
        <button className="round" onClick={() => setConfirm('clear')} aria-label="start over">
          <TrashIcon size={30} />
        </button>
        <button className="round save" onClick={save} disabled={!engine || saving} aria-label="save">
          <CheckIcon size={34} />
        </button>
      </header>

      <main className="view">
        {engine && model && (
          <Canvas flat dpr={[1, 2]} frameloop="demand" gl={{ alpha: true, antialias: true }} style={{ touchAction: 'none' }}>
            <StudioView engine={engine} species={species} geometry={model.geometry} info={model.info} level={level} apiRef={apiRef} />
          </Canvas>
        )}
        <div className="view-buttons">
          {!L2 && (
            <button className={`round ${st.flipped ? 'on' : ''}`} onClick={() => st.set({ flipped: !st.flipped })} aria-label="look at the other side">
              <FlipIcon size={32} />
            </button>
          )}
          {L2 && (
            <button className={`round mode ${st.rotateMode ? 'on' : ''}`} onClick={() => st.set({ rotateMode: !st.rotateMode })} aria-label={st.rotateMode ? 'rotate mode' : 'paint mode'}>
              {st.rotateMode ? <RotateIcon size={34} /> : <HandPaintIcon size={34} />}
            </button>
          )}
        </div>
        {st.tool === 'eyedropper' && <div className="view-hint"><DropperIcon size={40} color={st.color} /></div>}
      </main>

      <div className="sheet">
        <nav className="tabs">
          <button className={tab === 'tools' ? 'on' : ''} onClick={() => setTab('tools')} aria-label="tools">
            <PencilIcon size={30} />
          </button>
          <button className={tab === 'colors' ? 'on' : ''} onClick={() => setTab('colors')} aria-label="colours">
            <PaletteIcon size={30} color={st.color} />
            <span className="tab-dot" style={{ background: st.color }} />
          </button>
        </nav>
        <section className={`panel tools ${tab === 'tools' ? 'active' : ''}`}>
          {brushButtons}
          {sizeButtons}
          {patternButtons}
          {actionButtons}
          {sliders && <div className="only-portrait">{sliders}</div>}
          {nameField}
        </section>
        <section className={`panel colors ${tab === 'colors' ? 'active' : ''}`}>
          <ColorWheel color={st.color} onChange={(color) => st.set({ color, tool: st.tool === 'eraser' ? 'brush' : st.tool })} showValue={L2} size={wheelSize} />
          <div className="swatches">
            {SWATCHES.map((c) => (
              <button
                key={c}
                className={`swatch ${st.color.toLowerCase() === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => st.set({ color: c, tool: st.tool === 'eraser' || st.tool === 'eyedropper' ? 'brush' : st.tool })}
                aria-label={c}
              />
            ))}
          </div>
          {L2 && st.recent.length > 0 && (
            <div className="recent">
              {st.recent.map((c) => (
                <button key={c} className="swatch small" style={{ background: c }} onClick={() => st.set({ color: c })} aria-label={`recent ${c}`} />
              ))}
            </div>
          )}
          {sliders && <div className="only-landscape">{sliders}</div>}
        </section>
      </div>

      {confirm && (
        <div className="confirm" onPointerDown={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="confirm-card">
            <div className="confirm-icon">{confirm === 'clear' ? <TrashIcon size={72} /> : <CloseIcon size={72} color="#e53935" />}</div>
            <div className="confirm-buttons">
              <button className="round big no" onClick={() => setConfirm(null)} aria-label="no, keep painting">
                <UndoIcon size={40} />
              </button>
              <button
                className="round big yes"
                onClick={() => {
                  if (confirm === 'clear') engine?.clearAll();
                  else closeStudio();
                  setConfirm(null);
                }}
                aria-label="yes"
              >
                <CheckIcon size={44} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Colour wheel size that fits phones in both orientations. */
function useWheelSize(l2: boolean) {
  const calc = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const portrait = h >= w;
    const s = portrait ? Math.min(w * 0.36, h * 0.2) : Math.min(h * (l2 ? 0.3 : 0.38), w * 0.18);
    return Math.round(Math.max(96, Math.min(180, s)));
  };
  const [size, setSize] = useState(calc);
  useEffect(() => {
    const on = () => setSize(calc());
    window.addEventListener('resize', on);
    on();
    return () => window.removeEventListener('resize', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l2]);
  return size;
}
