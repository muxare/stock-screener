import { useEffect, useRef } from 'react';

/**
 * Close-on-outside-click / Esc for a popover. Returns the ref to put on the
 * element that counts as "inside" (the trigger and the panel together).
 */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const wrap = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return wrap;
}

export const POPOVER: React.CSSProperties = {
  position: 'absolute', top: 32, left: 0, zIndex: 30,
  background: '#fff', border: '1px solid #e7e8ea', borderRadius: 10,
  boxShadow: '0 8px 24px rgba(15, 20, 25, 0.14)', padding: 10,
};

export const LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: '#98a0a8',
};
