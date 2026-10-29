// Temporary developer controls until the real HUD exists.
import { useApp } from '../core/store';
import { clock } from '../core/runtime';

const btn: React.CSSProperties = { fontSize: 22, padding: '8px 12px', borderRadius: 12, border: 'none', background: 'rgba(255,255,255,0.85)' };

export function DevBar() {
  const openStudio = useApp((s) => s.openStudio);
  return (
    <div style={{ position: 'fixed', left: 12, bottom: 12, display: 'flex', gap: 8 }}>
      <button style={btn} onClick={() => openStudio('clownfish')}>🐠🎨</button>
      <button style={btn} onClick={() => openStudio('kelp')}>🌿🎨</button>
      <button style={btn} onClick={() => (clock.target = 0.5)}>☀️</button>
      <button style={btn} onClick={() => (clock.target = 0.0)}>🌙</button>
    </div>
  );
}
