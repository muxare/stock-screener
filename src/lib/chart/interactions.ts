export interface ChartLayout {
  padL: number;
  plotW: number;
  visible: number;
  from: number;
  to: number;
  bottom: number;
}

export function barIndexAtX(mx: number, layout: ChartLayout): number {
  const { padL, plotW, visible, from, to } = layout;
  return Math.max(from, Math.min(to, from + Math.round((mx - padL) / (plotW / visible) - 0.5)));
}

export function barCenterX(i: number, layout: Pick<ChartLayout, 'padL' | 'plotW' | 'visible' | 'from'>): number {
  return layout.padL + (i - layout.from + 0.5) * (layout.plotW / layout.visible);
}

export function isInPlot(mx: number, my: number, layout: ChartLayout, top: number): boolean {
  return mx >= layout.padL && mx <= layout.padL + layout.plotW && my >= top && my <= layout.bottom;
}

// ---- hit-testing, for the chart's help targets ------------------------------
//
// The chart is one canvas, so nothing on it can carry a data-help attribute.
// The help layer takes virtual anchors instead (help/anchors.ts) and the chart
// has to answer "what is under the pointer" itself. These are the two shapes
// that answer it: a box the renderer already computed (a pattern chip), and a
// horizontal band (an indicator pane). Pure, so they are testable without a
// canvas.

export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * The box under the pointer. Boxes are not expected to overlap — the label
 * placer guarantees it for chips — but when `pad` makes two of them reachable
 * at once the nearer centre wins, so the answer never depends on array order.
 */
export function boxAt<T extends Box>(mx: number, my: number, boxes: readonly T[], pad = 0): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const b of boxes) {
    if (mx < b.left - pad || mx > b.right + pad || my < b.top - pad || my > b.bottom + pad) continue;
    const dx = mx - (b.left + b.right) / 2, dy = my - (b.top + b.bottom) / 2;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

/** A horizontal slice of the chart that documents itself — an indicator pane. */
export interface Band { top: number; bottom: number; topic: string }

/** The band the pointer is inside, if any. Bands do not overlap. */
export function bandAt(my: number, bands: readonly Band[]): Band | undefined {
  return bands.find((b) => my >= b.top && my <= b.bottom);
}
