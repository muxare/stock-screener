import { describe, expect, it } from 'vitest';
import { DOCK_BREAKPOINT, DOCK_DEFAULT, DOCK_MIN, clampDockWidth, isNarrow } from './dock.ts';

describe('clampDockWidth', () => {
  it('keeps a dragged width between the dock minimum and the list minimum', () => {
    expect(clampDockWidth(700, 1600)).toBe(700);
    expect(clampDockWidth(200, 1600)).toBe(DOCK_MIN);
    expect(clampDockWidth(1400, 1600)).toBe(1080); // 1600 − 520 for the list
  });

  it('never returns less than the dock minimum, however cramped the viewport', () => {
    expect(clampDockWidth(DOCK_DEFAULT, 600)).toBe(DOCK_MIN);
  });

  it('leaves the width alone when no viewport is given', () => {
    expect(clampDockWidth(2000)).toBe(2000);
    expect(clampDockWidth(100)).toBe(DOCK_MIN);
  });

  it('falls back to the default for a width that is not a number', () => {
    expect(clampDockWidth(NaN, 1600)).toBe(DOCK_DEFAULT);
  });

  it('rounds to whole pixels', () => {
    expect(clampDockWidth(560.4, 1600)).toBe(560);
  });

  it('still fits the default dock at the breakpoint', () => {
    expect(clampDockWidth(DOCK_DEFAULT, DOCK_BREAKPOINT)).toBe(DOCK_DEFAULT);
  });
});

describe('isNarrow', () => {
  it('switches to the overlay below the breakpoint only', () => {
    expect(isNarrow(DOCK_BREAKPOINT - 1)).toBe(true);
    expect(isNarrow(DOCK_BREAKPOINT)).toBe(false);
  });
});
