/** Chunky picture icons for the icon-first studio UI (48x48 viewBox). */
import type { ReactNode } from 'react';

const Svg = ({ children, size = 34 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

type P = { size?: number; color?: string };
const INK = '#3b3355';

export const PencilIcon = ({ size, color = '#ffb300' }: P) => (
  <Svg size={size}>
    <g transform="rotate(45 24 24)">
      <rect x="18" y="4" width="12" height="30" rx="2" fill={color} stroke={INK} strokeWidth="2.5" />
      <rect x="18" y="4" width="12" height="6" rx="2" fill="#f48fb1" stroke={INK} strokeWidth="2.5" />
      <path d="M18 34 L24 45 L30 34 Z" fill="#ffe0b2" stroke={INK} strokeWidth="2.5" />
      <path d="M22.2 41.5 L24 45 L25.8 41.5 Z" fill={INK} />
    </g>
  </Svg>
);

export const SoftBrushIcon = ({ size, color = '#42a5f5' }: P) => (
  <Svg size={size}>
    <circle cx="16" cy="32" r="11" fill={color} opacity="0.25" />
    <circle cx="16" cy="32" r="7" fill={color} opacity="0.5" />
    <g transform="rotate(40 30 18)">
      <rect x="27" y="0" width="7" height="20" rx="3" fill="#a1887f" stroke={INK} strokeWidth="2.5" />
      <rect x="25.5" y="19" width="10" height="6" fill="#cfd8dc" stroke={INK} strokeWidth="2.5" />
      <path d="M25.5 25 Q24 33 30.5 38 Q37 33 35.5 25 Z" fill={color} stroke={INK} strokeWidth="2.5" />
    </g>
  </Svg>
);

export const CrayonIcon = ({ size, color = '#e53935' }: P) => (
  <Svg size={size}>
    <g transform="rotate(45 24 24)">
      <path d="M18 12 L24 2 L30 12 Z" fill={color} stroke={INK} strokeWidth="2.5" />
      <rect x="18" y="12" width="12" height="32" rx="2" fill={color} stroke={INK} strokeWidth="2.5" />
      <rect x="18" y="18" width="12" height="16" fill="#fff8e1" stroke={INK} strokeWidth="2.5" />
      <path d="M20 23 H28 M20 28 H28" stroke={color} strokeWidth="2" />
    </g>
  </Svg>
);

export const EraserIcon = ({ size }: P) => (
  <Svg size={size}>
    <g transform="rotate(-35 24 24)">
      <rect x="8" y="16" width="32" height="16" rx="4" fill="#f8bbd0" stroke={INK} strokeWidth="2.5" />
      <rect x="8" y="16" width="12" height="16" rx="4" fill="#90caf9" stroke={INK} strokeWidth="2.5" />
    </g>
    <path d="M10 44 H38" stroke={INK} strokeWidth="2.5" strokeDasharray="3 4" />
  </Svg>
);

export const BucketIcon = ({ size, color = '#26a69a' }: P) => (
  <Svg size={size}>
    <path d="M8 18 L22 6 L38 22 L24 36 Z" fill="#eceff1" stroke={INK} strokeWidth="2.5" />
    <path d="M8 18 L38 22 Q30 26 24 36 Z" fill={color} stroke={INK} strokeWidth="2.5" />
    <path d="M40 26 Q46 36 40 40 Q34 36 40 26 Z" fill={color} stroke={INK} strokeWidth="2.5" />
  </Svg>
);

export const DropperIcon = ({ size, color = '#7e57c2' }: P) => (
  <Svg size={size}>
    <g transform="rotate(45 24 24)">
      <rect x="19" y="2" width="10" height="10" rx="4" fill="#455a64" stroke={INK} strokeWidth="2.5" />
      <rect x="17" y="12" width="14" height="4" rx="1" fill="#90a4ae" stroke={INK} strokeWidth="2.5" />
      <path d="M20 16 H28 V34 L24 42 L20 34 Z" fill="#e3f2fd" stroke={INK} strokeWidth="2.5" />
      <path d="M20 26 H28 V34 L24 42 L20 34 Z" fill={color} />
    </g>
  </Svg>
);

export const UndoIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M18 12 L8 21 L18 30" fill="none" stroke={INK} strokeWidth="5" />
    <path d="M9 21 H28 Q40 21 40 31 Q40 40 28 40 H22" fill="none" stroke={INK} strokeWidth="5" />
  </Svg>
);

export const RedoIcon = ({ size }: P) => (
  <Svg size={size}>
    <g transform="matrix(-1 0 0 1 48 0)">
      <path d="M18 12 L8 21 L18 30" fill="none" stroke={INK} strokeWidth="5" />
      <path d="M9 21 H28 Q40 21 40 31 Q40 40 28 40 H22" fill="none" stroke={INK} strokeWidth="5" />
    </g>
  </Svg>
);

export const TrashIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M10 13 H38" stroke={INK} strokeWidth="4" />
    <path d="M19 13 V8 H29 V13" fill="none" stroke={INK} strokeWidth="3.5" />
    <path d="M13 14 L15 42 H33 L35 14 Z" fill="#ffccbc" stroke={INK} strokeWidth="3" />
    <path d="M20 20 V36 M28 20 V36" stroke={INK} strokeWidth="3" />
  </Svg>
);

export const CheckIcon = ({ size, color = 'white' }: P) => (
  <Svg size={size}>
    <path d="M9 25 L20 36 L40 12" fill="none" stroke={color} strokeWidth="7" />
  </Svg>
);

export const CloseIcon = ({ size, color = INK }: P) => (
  <Svg size={size}>
    <path d="M12 12 L36 36 M36 12 L12 36" fill="none" stroke={color} strokeWidth="6" />
  </Svg>
);

export const MirrorIcon = ({ size, on = true }: P & { on?: boolean }) => (
  <Svg size={size}>
    <path d="M22 10 Q8 10 6 24 Q8 38 22 38 Z" fill={on ? '#ff8a65' : '#cfd8dc'} stroke={INK} strokeWidth="2.5" />
    <path d="M26 10 Q40 10 42 24 Q40 38 26 38 Z" fill={on ? '#ff8a65' : 'none'} stroke={INK} strokeWidth="2.5" strokeDasharray={on ? undefined : '3 3'} />
    <circle cx="14" cy="20" r="3" fill={INK} />
    {on && <circle cx="34" cy="20" r="3" fill={INK} />}
    <path d="M24 4 V44" stroke={INK} strokeWidth="2" strokeDasharray="3 3" />
  </Svg>
);

export const RotateIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M24 14 L34 19 L24 24 L14 19 Z" fill="#b3e5fc" stroke={INK} strokeWidth="2.5" />
    <path d="M14 19 V29 L24 34 V24 Z" fill="#81d4fa" stroke={INK} strokeWidth="2.5" />
    <path d="M34 19 V29 L24 34 V24 Z" fill="#4fc3f7" stroke={INK} strokeWidth="2.5" />
    <path d="M8 34 Q24 48 40 34" fill="none" stroke={INK} strokeWidth="3" />
    <path d="M40 34 L41 27 M40 34 L33 33" fill="none" stroke={INK} strokeWidth="3" />
  </Svg>
);

export const HandPaintIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M18 40 Q10 34 10 26 L10 22 Q12 19 15 22 L16 26 L16 10 Q19 7 21 10 L21 22 L22 8 Q25 5 27 8 L27 22 L28 10 Q31 7 33 10 L33 24 L34 17 Q37 15 38 18 L38 30 Q38 40 30 42 Z" fill="#ffe0b2" stroke={INK} strokeWidth="2.5" />
  </Svg>
);

export const FlipIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M6 24 Q15 14 24 24 Q15 34 6 24 Z" fill="#ffb74d" stroke={INK} strokeWidth="2.5" />
    <path d="M42 24 Q33 14 24 24 Q33 34 42 24 Z" fill="#fff3e0" stroke={INK} strokeWidth="2.5" />
    <path d="M12 9 Q24 1 36 9" fill="none" stroke={INK} strokeWidth="3" />
    <path d="M36 9 L35 3 M36 9 L30 10" fill="none" stroke={INK} strokeWidth="3" />
  </Svg>
);

export const FlatIcon = ({ size }: P) => (
  <Svg size={size}>
    <rect x="8" y="10" width="32" height="28" rx="4" fill="#fff59d" stroke={INK} strokeWidth="3" />
    <path d="M14 30 Q20 18 26 26 Q30 20 34 30" fill="none" stroke="#ef6c00" strokeWidth="3" />
  </Svg>
);

export const CubeIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M24 6 L40 14 L24 22 L8 14 Z" fill="#b39ddb" stroke={INK} strokeWidth="3" />
    <path d="M8 14 V32 L24 42 V22 Z" fill="#9575cd" stroke={INK} strokeWidth="3" />
    <path d="M40 14 V32 L24 42 V22 Z" fill="#7e57c2" stroke={INK} strokeWidth="3" />
  </Svg>
);

export const BrushTabIcon = ({ size }: P) => <PencilIcon size={size} />;

export const PaletteIcon = ({ size, color = '#e53935' }: P) => (
  <Svg size={size}>
    <path d="M24 6 Q42 6 43 22 Q43 30 35 29 Q29 28 30 34 Q31 42 24 42 Q6 42 6 24 Q6 6 24 6 Z" fill="#ffe0b2" stroke={INK} strokeWidth="2.5" />
    <circle cx="16" cy="18" r="4" fill={color} />
    <circle cx="26" cy="14" r="4" fill="#1e88e5" />
    <circle cx="14" cy="29" r="4" fill="#7cb342" />
    <circle cx="35" cy="19" r="3.5" fill="#fdd835" />
  </Svg>
);

export const TagIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M6 24 L20 10 H40 V38 H20 Z" fill="#fff59d" stroke={INK} strokeWidth="2.5" />
    <circle cx="17" cy="24" r="3" fill={INK} />
  </Svg>
);

/** Brush size dot. */
export const DotIcon = ({ r, color = INK }: { r: number; color?: string }) => (
  <Svg size={34}>
    <circle cx="24" cy="24" r={r} fill={color} />
  </Svg>
);

export const OpacityIcon = ({ solid }: { solid: boolean }) => (
  <Svg size={26}>
    <circle cx="24" cy="24" r="15" fill={INK} opacity={solid ? 1 : 0.2} stroke={INK} strokeWidth="2" />
  </Svg>
);

export const HardnessIcon = ({ hard }: { hard: boolean }) => (
  <Svg size={26}>
    <defs>
      <radialGradient id="softdot">
        <stop offset="0" stopColor={INK} stopOpacity="1" />
        <stop offset="1" stopColor={INK} stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx="24" cy="24" r={hard ? 14 : 20} fill={hard ? INK : 'url(#softdot)'} />
  </Svg>
);
