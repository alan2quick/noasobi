import type { ReactNode } from 'react';
import { sound } from '../audio/engine';

interface Props {
  icon: ReactNode;
  /** Accessible name; also the mouse tooltip. */
  title: string;
  /** Optional short visible label under the button. */
  label?: string;
  active?: boolean;
  variant?: 'ok' | 'danger';
  small?: boolean;
  disabled?: boolean;
  onClick(): void;
}

/** Big round icon button with a soft pop sound. */
export function IconButton({ icon, title, label, active, variant, small, disabled, onClick }: Props) {
  const cls = ['hud-btn', active && 'active', variant, small && 'small'].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      title={title}
      aria-label={title}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onClick={() => {
        sound.pop();
        onClick();
      }}
    >
      <span aria-hidden="true">{icon}</span>
      {label && <span className="lbl">{label}</span>}
    </button>
  );
}

/** Small depth gauge: three bands, the creature's band highlighted (0 = bottom .. 1 = high). */
export function DepthIcon({ level, size = 24 }: { level: number; size?: number }) {
  const band = level < 0.34 ? 2 : level < 0.67 ? 1 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="2" width="18" height="20" rx="4" fill="#8fd3ec" />
      <rect x="3" y="16" width="18" height="6" rx="3" fill="#e9cf98" />
      {[0, 1, 2].map((i) => (
        <rect key={i} x="5" y={3.5 + i * 5.6} width="14" height="4.2" rx="2" fill={i === band ? '#ff8f00' : 'rgba(255,255,255,0.55)'} />
      ))}
    </svg>
  );
}
