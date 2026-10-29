import { useEffect, useRef, useState } from 'react';
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from './paintMath';

interface WheelProps {
  color: string;
  onChange(hex: string): void;
  /** Level 2 shows a brightness bar; Level 1 keeps colours bright. */
  showValue?: boolean;
  size?: number;
}

/** Hue around, saturation inward. Big drag target, works with touch and mouse. */
export function ColorWheel({ color, onChange, showValue = false, size = 150 }: WheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hsv, setHsv] = useState(() => rgbToHsv(...hexToRgb(color)));
  const lastEmitted = useRef(color);

  // Follow outside changes (swatches, eyedropper) without losing hue on greys.
  useEffect(() => {
    if (color.toLowerCase() === lastEmitted.current.toLowerCase()) return;
    lastEmitted.current = color;
    const next = rgbToHsv(...hexToRgb(color));
    setHsv((prev) => ({ h: next.s < 0.02 ? prev.h : next.h, s: next.s, v: next.v }));
  }, [color]);

  const wheelV = showValue ? Math.max(0.15, hsv.v) : 1;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    c.width = c.height = px;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(px, px);
    const r = px / 2;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const dx = x + 0.5 - r;
        const dy = y + 0.5 - r;
        const d = Math.hypot(dx, dy) / r;
        const i = (y * px + x) * 4;
        if (d > 1) continue;
        const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const [R, G, B] = hsvToRgb(h, Math.min(1, d), wheelV);
        img.data[i] = R;
        img.data[i + 1] = G;
        img.data[i + 2] = B;
        // soft anti-aliased rim
        img.data[i + 3] = Math.round(255 * Math.min(1, (1 - d) * r));
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [size, wheelV]);

  const emit = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    const hex = rgbToHex(...hsvToRgb(next.h, next.s, next.v));
    lastEmitted.current = hex;
    onChange(hex);
  };

  const pickAt = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    emit({ h, s, v: showValue ? Math.max(0.15, hsv.v) : 1 });
  };

  const angle = (hsv.h * Math.PI) / 180;
  const mx = 50 + Math.cos(angle) * hsv.s * 50;
  const my = 50 + Math.sin(angle) * hsv.s * 50;

  return (
    <div className="wheel-wrap">
      <div className="wheel" style={{ width: size, height: size }}>
        <canvas
          ref={canvasRef}
          style={{ width: size, height: size }}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            pickAt(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons || e.pointerType !== 'mouse') {
              if ((e.target as Element).hasPointerCapture(e.pointerId)) pickAt(e);
            }
          }}
          aria-label="colour wheel"
        />
        <div className="wheel-marker" style={{ left: `${mx}%`, top: `${my}%`, background: color }} />
      </div>
      {showValue && (
        <Slider
          value={hsv.v}
          onChange={(v) => emit({ ...hsv, v })}
          track={`linear-gradient(to right, #000, ${rgbToHex(...hsvToRgb(hsv.h, hsv.s, 1))})`}
          left={<span className="dot" style={{ background: '#111' }} />}
          right={<span className="dot sun">☀</span>}
          label="brightness"
        />
      )}
    </div>
  );
}

interface SliderProps {
  value: number;
  onChange(v: number): void;
  track?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  label: string;
}

/** Chunky slider with icons at both ends. */
export function Slider({ value, onChange, track, left, right, label }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };
  return (
    <div className="slider" aria-label={label} role="slider" aria-valuenow={Math.round(value * 100)}>
      {left}
      <div
        ref={ref}
        className="slider-track"
        style={{ background: track }}
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          set(e);
        }}
        onPointerMove={(e) => {
          if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) set(e);
        }}
      >
        <div className="slider-knob" style={{ left: `${value * 100}%` }} />
      </div>
      {right}
    </div>
  );
}
