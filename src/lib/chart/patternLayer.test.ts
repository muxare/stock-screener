import { describe, expect, it } from 'vitest';
import { drawPatternLayer } from './patternLayer';
import type { OHLC } from '../market';
import type { PatternMarker } from '../patterns';

/**
 * Enough of a 2D context to run the layer, plus a record of the text it drew.
 * The point of the phase-4 change is that the chips the layer hands back are
 * the chips it actually painted, so the test compares the two.
 */
function fakeCtx() {
  const drew: Array<{ text: string; x: number; y: number }> = [];
  const noop = () => {};
  const ctx = {
    font: '', textAlign: '', textBaseline: '',
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    save: noop, restore: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, arc: noop, arcTo: noop, rect: noop, clip: noop,
    fill: noop, stroke: noop, fillRect: noop, setLineDash: noop,
    // 6 px a character, so a two-letter tag is a 20 px chip (12 + 8 padding).
    measureText: (t: string) => ({ width: t.length * 6 }),
    fillText: (text: string, x: number, y: number) => { drew.push({ text, x, y }); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drew };
}

const bars: OHLC = { o: [1, 1, 1, 1, 1, 1, 1, 1], h: [2, 2, 2, 2, 2, 2, 2, 2], l: [0, 0, 0, 0, 0, 0, 0, 0], c: [1, 1, 1, 1, 1, 1, 1, 1] };

const structure = (index: number, tag: string): PatternMarker => ({
  id: 'structure', index, from: index, to: index, dir: 'bull', price: 1, tag, note: `${tag} at ${index}`,
});

/** 20 px a bar, so `cw` of 6.2 leaves the layer well above its label threshold. */
const args = {
  bars, from: 0, to: 7, x: (i: number) => 20 + i * 20, cw: 6.2,
};

describe('drawPatternLayer', () => {
  it('hands back the chips it drew, where it drew them', () => {
    const { ctx, drew } = fakeCtx();
    const markers = [structure(2, 'HL'), structure(5, 'HH')];
    const chips = drawPatternLayer({ ...args, ctx, markers, py: () => 150, top: 0, height: 300 });

    expect(chips.map((c) => c.marker.tag)).toEqual(drew.map((d) => d.text));
    expect(chips).toHaveLength(2);
    for (const [i, c] of chips.entries()) {
      // A chip is 20 px wide and 13 px tall, centred on the text baseline.
      expect((c.left + c.right) / 2).toBeCloseTo(drew[i].x);
      expect((c.top + c.bottom) / 2).toBeCloseTo(drew[i].y - 0.5);
      expect(c.right - c.left).toBeCloseTo(20);
      expect(c.bottom - c.top).toBeCloseTo(13);
    }
    // 'HL' hangs below its pivot, 'HH' above it.
    expect(chips.find((c) => c.marker.tag === 'HL')!.top).toBeGreaterThan(150);
    expect(chips.find((c) => c.marker.tag === 'HH')!.bottom).toBeLessThan(150);
  });

  it('leaves out a chip that found no free row, and keeps the one that did', () => {
    const { ctx, drew } = fakeCtx();
    // Three labels on one bar in a pane one row tall: the first takes the row,
    // the rest are pushed off the pane and dropped rather than overprinted.
    const markers = [structure(3, 'HL'), structure(3, 'LL'), structure(3, 'LH')];
    const chips = drawPatternLayer({ ...args, ctx, markers, py: () => -8, top: 0, height: 16 });

    expect(chips).toHaveLength(1);
    expect(drew).toHaveLength(1);
    expect(chips[0].marker.tag).toBe(drew[0].text);
  });

  it('returns nothing when there is nothing in the window to label', () => {
    const { ctx } = fakeCtx();
    expect(drawPatternLayer({ ...args, ctx, markers: [], py: () => 150, top: 0, height: 300 })).toEqual([]);
    expect(drawPatternLayer({
      ...args, ctx, markers: [structure(40, 'HH')], py: () => 150, top: 0, height: 300,
    })).toEqual([]);
  });

  it('drops every chip when the bars are too narrow for text', () => {
    const { ctx, drew } = fakeCtx();
    const chips = drawPatternLayer({
      ...args, ctx, cw: 2, markers: [structure(2, 'HL')], py: () => 150, top: 0, height: 300,
    });
    expect(chips).toEqual([]);
    expect(drew).toEqual([]);
  });
});
