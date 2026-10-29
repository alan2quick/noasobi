import { useApp } from '../core/store';
import { runtime } from '../core/runtime';
import { sound } from './engine';

const pageStart = Date.now();

/**
 * Connects the sound engine to the app: unlocks on the first user gesture (autoplay policy),
 * follows `muted`, suspends while the tab is hidden, darkens the ambience at night (polled at
 * 0.5 Hz, not per frame) and chimes when a design is saved.
 */
export function startAudio() {
  const unlock = () => {
    sound.unlock();
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    window.removeEventListener('touchend', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('touchend', unlock, true);

  sound.setMuted(useApp.getState().muted);
  sound.setHidden(document.hidden);
  document.addEventListener('visibilitychange', () => sound.setHidden(document.hidden));

  let latestSave = Math.max(0, ...Object.values(useApp.getState().designs).map((d) => d.updatedAt));
  useApp.subscribe((s, prev) => {
    if (s.muted !== prev.muted) sound.setMuted(s.muted);
    if (s.designs !== prev.designs) {
      let newest = latestSave;
      for (const id in s.designs) newest = Math.max(newest, s.designs[id].updatedAt);
      // Restored designs arrive with old timestamps; only a fresh save is newer than the page.
      if (newest > latestSave && newest > pageStart) sound.chime();
      latestSave = newest;
    }
  });

  let lastDay = -1;
  setInterval(() => {
    const d = Math.round(runtime.daylight * 20) / 20;
    if (d !== lastDay) {
      lastDay = d;
      sound.setDaylight(d);
    }
  }, 2000);
}
