import { useCallback, useState } from 'react';

// A viewport is an inclusive range of bar indices [from, to] currently visible
// on a chart. Zoom changes the width of the window; pan slides it.
export interface Viewport {
  from: number;
  to: number;
}

const MIN_BARS = 8;

// Clamp an arbitrary (possibly fractional) window to a valid integer viewport,
// preserving the requested span where possible.
function clampView(from: number, to: number, total: number): Viewport {
  if (total < 1) return { from: 0, to: 0 };
  const maxSpan = total - 1;
  let span = Math.round(to - from);
  if (span < MIN_BARS - 1) span = Math.min(MIN_BARS - 1, maxSpan);
  if (span > maxSpan) span = maxSpan;
  let f = Math.round(from);
  let t = f + span;
  if (f < 0) { f = 0; t = span; }
  if (t > maxSpan) { t = maxSpan; f = t - span; }
  if (f < 0) f = 0;
  return { from: f, to: t };
}

interface ViewState {
  key: string;
  def: Viewport;
  view: Viewport;
}

/**
 * Manages a zoom/pan viewport over a series of `total` bars. `initial` is the
 * default window (e.g. the full history, or a trade's focus window); the view
 * resets to it whenever the underlying data window changes.
 */
export function useChartViewport(total: number, initial: Viewport) {
  const key = `${total}:${initial.from}:${initial.to}`;
  const [state, setState] = useState<ViewState>(() => {
    const def = clampView(initial.from, initial.to, total);
    return { key, def, view: def };
  });

  // Reset to the default window when the underlying data window changes. This is
  // the documented "adjust state during render" pattern; React discards the
  // in-progress render and re-runs with the new state before painting.
  if (state.key !== key) {
    const def = clampView(initial.from, initial.to, total);
    setState({ key, def, view: def });
  }

  const zoomAtBar = useCallback((pivot: number, factor: number) => {
    setState((s) => {
      const v = s.view;
      const span = v.to - v.from;
      const newSpan = Math.max(MIN_BARS - 1, Math.min(total - 1, Math.round(span * factor)));
      const frac = span > 0 ? (pivot - v.from) / span : 0.5;
      const from = pivot - frac * newSpan;
      return { ...s, view: clampView(from, from + newSpan, total) };
    });
  }, [total]);

  const panByBars = useCallback((deltaBars: number) => {
    setState((s) => ({ ...s, view: clampView(s.view.from + deltaBars, s.view.to + deltaBars, total) }));
  }, [total]);

  const reset = useCallback(() => {
    setState((s) => ({ ...s, view: s.def }));
  }, []);

  const view = state.view;
  const isDefault = view.from === state.def.from && view.to === state.def.to;

  return { view, zoomAtBar, panByBars, reset, isDefault };
}
