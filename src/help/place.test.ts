import { describe, expect, it } from 'vitest';
import { clampToViewport, placeNear } from './place';

const anchor = { left: 100, top: 100, right: 160, bottom: 120, width: 60, height: 20 };

describe('placeNear', () => {
  it('sits below the anchor, left-aligned, when there is room', () => {
    expect(placeNear(anchor, 300, 150, 1200, 800)).toEqual({ x: 100, y: 126 });
  });
  it('flips above when it would run off the bottom', () => {
    expect(placeNear(anchor, 300, 150, 1200, 200)).toEqual({ x: 100, y: 42 });
    expect(placeNear({ ...anchor, top: 500, bottom: 520 }, 300, 150, 1200, 600)).toEqual({ x: 100, y: 344 });
  });
  it('shifts left when it would run off the right edge', () => {
    expect(placeNear({ ...anchor, left: 1100, right: 1160 }, 300, 150, 1200, 800)).toEqual({ x: 892, y: 126 });
  });
});

describe('clampToViewport', () => {
  it('keeps a dragged card inside the margins', () => {
    expect(clampToViewport(-50, -50, 300, 100, 1200, 800)).toEqual({ x: 8, y: 8 });
    expect(clampToViewport(5000, 5000, 300, 100, 1200, 800)).toEqual({ x: 892, y: 692 });
  });
});
