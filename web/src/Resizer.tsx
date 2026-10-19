import { type KeyboardEvent, type PointerEvent, useCallback, useState } from 'react';

interface Bounds {
  initial: number;
  min: number;
  max: number;
}

const clamp = (width: number, { min, max }: Bounds) => Math.min(max, Math.max(min, Math.round(width)));

export function useStoredWidth(key: string, bounds: Bounds): [number, (width: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(key));
      return stored ? clamp(stored, bounds) : bounds.initial;
    } catch {
      return bounds.initial;
    }
  });
  const set = useCallback(
    (next: number) => {
      const value = clamp(next, bounds);
      setWidth(value);
      try {
        localStorage.setItem(key, String(value));
      } catch {
        // Private windows can refuse storage; the width then lasts until reload.
      }
    },
    [key, bounds],
  );
  return [width, set];
}

interface HandleProps {
  /** Which edge of its column the handle sits on: the sidebar grows rightward, the panel leftward. */
  edge: 'right' | 'left';
  label: string;
  width: number;
  bounds: Bounds;
  onResize: (width: number) => void;
}

const KEY_STEP = 16;

export function ResizeHandle({ edge, label, width, bounds, onResize }: HandleProps) {
  const direction = edge === 'right' ? 1 : -1;

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const handle = e.currentTarget;
    const startX = e.clientX;
    const startWidth = width;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const move = (ev: globalThis.PointerEvent) => onResize(startWidth + (ev.clientX - startX) * direction);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    onResize(width + (e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP) * direction);
  }

  return (
    <div
      className={`resize-handle ${edge}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onResize(bounds.initial)}
    />
  );
}
