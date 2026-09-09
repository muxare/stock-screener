import { describe, expect, it } from 'vitest';
import { clampToViewport, placeNear } from './place';

const anchor = { left: 100, top: 100, right: 160, bottom: 120, width: 60, height: 20 };

describe('placeNear', () => {
  it('sits beside the anchor, top-aligned, when there is room', () => {
    // 1200 wide: 1034 to the right of the anchor, 86 to its left — right wins.
    expect(placeNear(anchor, 300, 150, 1200, 800)).toEqual({ x: 166, y: 100 });
  });

  it('prefers the side with more room', () => {
    const nearRightEdge = { ...anchor, left: 1000, right: 1060 };
    // 132 right, 986 left — so it goes left rather than hanging off the edge.
    expect(placeNear(nearRightEdge, 300, 150, 1200, 800)).toEqual({ x: 694, y: 100 });
  });

  it('takes the only side that fits, even when it is the smaller one', () => {
    // 320 right of the anchor, 292 left: right is the one that can hold 300.
    const a = { ...anchor, left: 300, right: 380 };
    expect(placeNear(a, 300, 150, 706, 800)).toEqual({ x: 386, y: 100 });
  });

  it('never covers the anchor row: it drops below only when neither side fits', () => {
    // A wide anchor — a table row, the filter row — leaves no side to sit on.
    const wide = { left: 20, top: 100, right: 1180, bottom: 120, width: 1160, height: 20 };
    expect(placeNear(wide, 300, 150, 1200, 800)).toEqual({ x: 20, y: 126 });
  });

  it('flips above when neither side fits and it would run off the bottom', () => {
    const wide = { left: 20, top: 100, right: 1180, bottom: 120, width: 1160, height: 20 };
    expect(placeNear(wide, 300, 150, 1200, 200)).toEqual({ x: 20, y: 42 });
    expect(placeNear({ ...wide, top: 500, bottom: 520 }, 300, 150, 1200, 600)).toEqual({ x: 20, y: 344 });
  });

  it('clamps a beside card up when the anchor is near the bottom', () => {
    expect(placeNear({ ...anchor, top: 700, bottom: 720 }, 300, 150, 1200, 800)).toEqual({ x: 166, y: 642 });
  });

  it('clears the host control, not just the anchor inside it', () => {
    // The ⌕ marker at the left edge of a 340 px search box: beside the glyph
    // would land on the box it names, so the box decides the side.
    const glyph = { left: 160, top: 20, right: 174, bottom: 34, width: 14, height: 14 };
    const box = { left: 155, top: 14, right: 495, bottom: 40, width: 340, height: 26 };
    expect(placeNear(glyph, 330, 200, 1550, 800, box)).toEqual({ x: 501, y: 20 });
  });

  it('ignores a host too wide to have a side of its own', () => {
    // A table header cell in its full-width header row: the row has no side,
    // so the cell places itself and the column below it stays readable.
    const cell = { left: 1340, top: 140, right: 1380, bottom: 156, width: 40, height: 16 };
    const row = { left: 0, top: 138, right: 1550, bottom: 158, width: 1550, height: 20 };
    expect(placeNear(cell, 330, 200, 1550, 800, row)).toEqual({ x: 1004, y: 140 });
  });
});

describe('clampToViewport', () => {
  it('keeps a dragged card inside the margins', () => {
    expect(clampToViewport(-50, -50, 300, 100, 1200, 800)).toEqual({ x: 8, y: 8 });
    expect(clampToViewport(5000, 5000, 300, 100, 1200, 800)).toEqual({ x: 892, y: 692 });
  });
});
