import { useEffect, useRef, useState } from 'react';
import { clock } from '../core/runtime';
import { isNight, sunElevation } from '../biomes/ocean/dayNight';
import type { SpeciesDef } from '../core/types';
import { templateThumbnail } from './thumbnails';
import { sound } from '../audio/engine';

/** Night or day, including a pending jump. Polled at 2 Hz; re-renders only on change. */
export function useIsNight(): [boolean, () => void] {
  const read = () => (clock.target !== null ? sunElevation(clock.target) < -0.05 : isNight());
  const [night, setNight] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setNight(read()), 500);
    return () => clearInterval(id);
  }, []);
  return [night, () => setNight(read())];
}

/** Natural-look picture of a species (null until the renderer exists; retried briefly). */
export function useTemplateThumb(species: SpeciesDef | undefined, size = 128): string | null {
  const [url, setUrl] = useState<string | null>(() => (species ? templateThumbnail(species, size) : null));
  useEffect(() => {
    if (!species) return;
    const now = templateThumbnail(species, size);
    if (now) {
      setUrl(now);
      return;
    }
    let tries = 0;
    const id = setInterval(() => {
      const u = templateThumbnail(species, size);
      if (u || ++tries > 20) {
        clearInterval(id);
        if (u) setUrl(u);
      }
    }, 250);
    return () => clearInterval(id);
  }, [species, size]);
  return url;
}

/**
 * Tap vs long-press on one element. Returns pointer handlers; `onTap` fires on a short press,
 * `onLong` after `ms` held still.
 */
export function usePress(onTap: () => void, onLong: () => void, ms = 550) {
  const st = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean; x: number; y: number }>({
    timer: null,
    fired: false,
    x: 0,
    y: 0,
  });
  const clear = () => {
    if (st.current.timer) clearTimeout(st.current.timer);
    st.current.timer = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      clear();
      st.current.fired = false;
      st.current.x = e.clientX;
      st.current.y = e.clientY;
      st.current.timer = setTimeout(() => {
        st.current.timer = null;
        st.current.fired = true;
        sound.pop();
        onLong();
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (st.current.timer && Math.hypot(e.clientX - st.current.x, e.clientY - st.current.y) > 10) clear();
    },
    onPointerUp: () => {
      const wasPending = st.current.timer !== null;
      clear();
      if (wasPending && !st.current.fired) {
        sound.pop();
        onTap();
      }
    },
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}
