import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useApp } from '../core/store';

/** Tiny FPS / draw-call overlay, only when the URL has `?stats`. Mount inside the Canvas. */
export function Stats() {
  const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('stats');
  return enabled ? <StatsOverlay /> : null;
}

function StatsOverlay() {
  const gl = useThree((s) => s.gl);
  const div = useRef<HTMLDivElement | null>(null);
  const acc = useRef({ frames: 0, time: 0, worst: 0 });

  useEffect(() => {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      top: '8px',
      right: '8px',
      padding: '6px 8px',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
      color: '#eaffff',
      background: 'rgba(0, 20, 40, 0.6)',
      borderRadius: '8px',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      zIndex: '1000',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
    div.current = el;
    return () => {
      el.remove();
      div.current = null;
    };
  }, []);

  useFrame((state, delta) => {
    const a = acc.current;
    a.frames++;
    a.time += delta;
    a.worst = Math.max(a.worst, delta);
    if (a.time < 0.5 || !div.current) return;
    // gl.info still holds the previous frame here (it resets at the start of each render).
    const info = gl.info.render;
    const fps = a.frames / a.time;
    div.current.textContent =
      `${fps.toFixed(0)} fps  ${((a.time / a.frames) * 1000).toFixed(1)} ms (max ${(a.worst * 1000).toFixed(0)})\n` +
      `${info.calls} calls  ${(info.triangles / 1000).toFixed(1)}k tris  ${info.points} pts\n` +
      `dpr ${state.viewport.dpr.toFixed(2)}  ${useApp.getState().quality}  ${gl.info.programs?.length ?? 0} progs`;
    a.frames = 0;
    a.time = 0;
    a.worst = 0;
  });

  return null;
}
