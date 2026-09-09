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
