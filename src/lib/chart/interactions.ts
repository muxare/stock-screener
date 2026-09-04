export interface ChartLayout {
  padL: number;
  plotW: number;
  visible: number;
  from: number;
  to: number;
  bottom: number;
}

export interface ZoomSelection {
  active: boolean;
  startBar: number;
  endBar: number;
}

export function barIndexAtX(mx: number, layout: ChartLayout): number {
  const { padL, plotW, visible, from, to } = layout;
  return Math.max(from, Math.min(to, from + Math.round((mx - padL) / (plotW / visible) - 0.5)));
}

export function barCenterX(i: number, layout: Pick<ChartLayout, 'padL' | 'plotW' | 'visible' | 'from'>): number {
  return layout.padL + (i - layout.from + 0.5) * (layout.plotW / layout.visible);
}

/** Draw the shift-drag zoom marquee on an overlay canvas. */
export function drawZoomSelection(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  startBar: number,
  endBar: number,
  top: number,
) {
  const leftBar = Math.min(startBar, endBar);
  const rightBar = Math.max(startBar, endBar);
  const barW = layout.plotW / layout.visible;
  const left = Math.max(layout.padL, barCenterX(leftBar, layout) - barW / 2);
  const right = Math.min(layout.padL + layout.plotW, barCenterX(rightBar, layout) + barW / 2);
  if (right <= left) return;

  ctx.fillStyle = 'rgba(43, 98, 214, 0.14)';
  ctx.fillRect(left, top, right - left, layout.bottom - top);
  ctx.strokeStyle = 'rgba(43, 98, 214, 0.6)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(left, top, right - left, layout.bottom - top);
  ctx.setLineDash([]);
}

export function isInPlot(mx: number, my: number, layout: ChartLayout, top: number): boolean {
  return mx >= layout.padL && mx <= layout.padL + layout.plotW && my >= top && my <= layout.bottom;
}
