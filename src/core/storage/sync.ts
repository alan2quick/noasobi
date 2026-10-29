import { Vector3 } from 'three';
import type { BiomeId, DesignMeta, StorageAdapter, WorldState } from '../types';
import { getDesignSource, useApp } from '../store';
import { clock } from '../runtime';
import { seedDemoWorld } from '../seed';
import { getCameraTarget, setCameraView } from '../../render/CameraRig';
import { sceneRefs } from '../../render/sceneRefs';
import { IdbAdapter, idbWorks } from './idbAdapter';
import { MemoryAdapter } from './memoryAdapter';
import { diffDesigns } from './serialize';

/**
 * Persistence wiring. The store stays storage-agnostic: this module restores state at startup and
 * then subscribes to the store, writing through the StorageAdapter interface only.
 *
 * - Designs: written (PNG Blob + meta) whenever a design is new or its `updatedAt` changes,
 *   deleted when it leaves the store.
 * - World (entities, time of day, camera): debounced ~1.5 s after entity changes, also when the
 *   camera has moved (checked every few seconds) and immediately on visibilitychange/pagehide.
 * - Settings: muted, designLevel.
 * If IndexedDB is unavailable the in-memory adapter is used and the app runs normally.
 */

const BIOME: BiomeId = 'ocean';
const WORLD_DEBOUNCE_MS = 1500;
const CAMERA_CHECK_MS = 4000;

export const SETTINGS_KEYS = { muted: 'muted', designLevel: 'designLevel' } as const;

let adapter: StorageAdapter | null = null;
/** Resolves once startup restore is finished (designs uploaded, world restored or seeded). */
export let storageReady: Promise<void> = Promise.resolve();

export function getStorage(): StorageAdapter | null {
  return adapter;
}

/** Serialises every write so a delete can never overtake the save it follows. */
let queue: Promise<unknown> = Promise.resolve();
function enqueue(label: string, job: () => Promise<unknown>) {
  queue = queue.then(job).catch((err) => console.warn(`[storage] ${label} failed`, err));
  return queue;
}

async function pickAdapter(): Promise<StorageAdapter> {
  if (await idbWorks()) return new IdbAdapter();
  console.info('[storage] IndexedDB unavailable, keeping everything in memory');
  return new MemoryAdapter();
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png'),
  );
}

async function decodeBlob(blob: Blob): Promise<CanvasImageSource> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Safe: the decoded image keeps its pixels.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

const _pos = new Vector3();
const _target = new Vector3();

function captureWorld(): WorldState {
  const cam = sceneRefs.camera;
  const target = getCameraTarget();
  return {
    biome: BIOME,
    entities: useApp.getState().entities,
    timeOfDay: clock.timeOfDay,
    ...(cam
      ? {
          camera: {
            position: [cam.position.x, cam.position.y, cam.position.z],
            target: [target.x, target.y, target.z],
          },
        }
      : {}),
  };
}

/** Restores saved state, seeds the demo world if nothing was saved, then starts syncing. */
export function startPersistence(): Promise<void> {
  storageReady = run();
  return storageReady;
}

async function run() {
  let a: StorageAdapter;
  try {
    a = await pickAdapter();
  } catch {
    a = new MemoryAdapter();
  }
  adapter = a;

  const persistedDesigns = new Map<string, number>();
  let restoredWorld = false;

  try {
    // Settings.
    const [muted, level] = await Promise.all([
      a.loadSettings<boolean>(SETTINGS_KEYS.muted),
      a.loadSettings<number>(SETTINGS_KEYS.designLevel),
    ]);
    if (typeof muted === 'boolean') useApp.getState().setMuted(muted);
    if (level === 1 || level === 2) useApp.getState().setDesignLevel(level);

    // Designs: decode in parallel, upload in one store update.
    const metas = await a.listDesigns();
    const restored = await Promise.all(
      metas.map(async (meta) => {
        try {
          const blob = await a.loadDesignTexture(meta.id);
          if (!blob) return null;
          return { meta, source: await decodeBlob(blob) };
        } catch (err) {
          console.warn('[storage] could not decode design', meta.id, err);
          return null;
        }
      }),
    );
    const ok = restored.filter((r): r is { meta: DesignMeta; source: CanvasImageSource } => r !== null);
    for (const r of ok) persistedDesigns.set(r.meta.id, r.meta.updatedAt);
    useApp.getState().restoreDesigns(ok);
    for (const r of ok) if ('close' in r.source && typeof r.source.close === 'function') r.source.close();

    // World.
    const world = await a.loadWorld(BIOME);
    if (world) {
      restoredWorld = true;
      useApp.setState({ entities: world.entities });
      clock.timeOfDay = world.timeOfDay;
      clock.target = null;
      if (world.camera) setCameraView(_pos.fromArray(world.camera.position), _target.fromArray(world.camera.target));
    }
  } catch (err) {
    console.warn('[storage] restore failed, starting fresh', err);
  }

  if (!restoredWorld) seedDemoWorld();
  subscribe(a, persistedDesigns);
}

function subscribe(a: StorageAdapter, persistedDesigns: Map<string, number>) {
  // ── Designs ────────────────────────────────────────────────────────────────────────────────
  const syncDesigns = (designs: Record<string, DesignMeta>) => {
    const { save, remove } = diffDesigns(designs, persistedDesigns);
    for (const meta of save) {
      persistedDesigns.set(meta.id, meta.updatedAt);
      const source = getDesignSource(meta.id);
      if (!source) continue;
      enqueue(`save design ${meta.id}`, async () => a.saveDesign(meta, await canvasToPng(source)));
    }
    for (const id of remove) {
      persistedDesigns.delete(id);
      enqueue(`delete design ${id}`, () => a.deleteDesign(id));
    }
  };
  syncDesigns(useApp.getState().designs);

  // ── World ──────────────────────────────────────────────────────────────────────────────────
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastCam = '';
  const camKey = () => {
    const c = sceneRefs.camera;
    const t = getCameraTarget();
    if (!c) return '';
    const r = (v: number) => Math.round(v * 2);
    return `${r(c.position.x)},${r(c.position.y)},${r(c.position.z)}|${r(t.x)},${r(t.y)},${r(t.z)}`;
  };
  const saveWorldNow = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastCam = camKey();
    const world = captureWorld();
    enqueue('save world', () => a.saveWorld(world));
  };
  const scheduleWorld = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(saveWorldNow, WORLD_DEBOUNCE_MS);
  };
  lastCam = camKey();
  // Make sure a seeded world is on disk so the next load restores instead of re-seeding.
  scheduleWorld();

  setInterval(() => {
    if (document.hidden) return;
    if (camKey() !== lastCam) scheduleWorld();
  }, CAMERA_CHECK_MS);

  const flush = () => {
    if (timer || camKey() !== lastCam) saveWorldNow();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveWorldNow();
  });
  window.addEventListener('pagehide', flush);

  // ── Store subscription ────────────────────────────────────────────────────────────────────
  useApp.subscribe((s, prev) => {
    if (s.designs !== prev.designs) syncDesigns(s.designs);
    if (s.entities !== prev.entities) scheduleWorld();
    if (s.muted !== prev.muted) enqueue('save muted', () => a.saveSettings(SETTINGS_KEYS.muted, s.muted));
    if (s.designLevel !== prev.designLevel)
      enqueue('save designLevel', () => a.saveSettings(SETTINGS_KEYS.designLevel, s.designLevel));
  });
}
