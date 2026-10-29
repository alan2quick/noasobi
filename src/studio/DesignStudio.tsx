// Placeholder: replaced by the design studio (Level 1 and Level 2 painters).
import { useApp } from '../core/store';

export function DesignStudio() {
  const close = useApp((s) => s.closeStudio);
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#123', color: 'white', display: 'grid', placeItems: 'center' }}>
      <button onClick={close}>Close studio</button>
    </div>
  );
}
