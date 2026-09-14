import { describe, expect, it } from 'vitest';
import { anchorChanged, toViewport, type VirtualAnchor } from './anchors';

const rect = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 };
const at = (key: string, over: Partial<VirtualAnchor> = {}): VirtualAnchor =>
  ({ key, topic: 'pa-pin-bar', rect, ...over });

describe('anchorChanged', () => {
  it('is nothing happening when the same mark is republished', () => {
    // The chart calls this on every mousemove; the pointer crossing a chip
    // must not restart the timer that is already counting down for it.
    expect(anchorChanged(at('chip:pinBar@412'), at('chip:pinBar@412'))).toBe(false);
    expect(anchorChanged(null, null)).toBe(false);
  });

  it('ignores everything but the key, which is what identity means here', () => {
    const moved = at('chip:pinBar@412', { rect: { ...rect, left: 99, right: 109 }, instance: 'later' });
    expect(anchorChanged(at('chip:pinBar@412'), moved)).toBe(false);
  });

  it('is a change when the key changes, or the target appears or goes', () => {
    expect(anchorChanged(at('chip:pinBar@412'), at('chip:pinBar@413'))).toBe(true);
    expect(anchorChanged(at('chip:pinBar@412'), at('pane:macd'))).toBe(true);
    expect(anchorChanged(null, at('pane:macd'))).toBe(true);
    expect(anchorChanged(at('pane:macd'), null)).toBe(true);
  });
});

describe('toViewport', () => {
  it('moves a canvas-space box to where it is on screen', () => {
    expect(toViewport({ left: 10, top: 20, right: 40, bottom: 33 }, { left: 100, top: 200 }))
      .toEqual({ left: 110, top: 220, right: 140, bottom: 233, width: 30, height: 13 });
  });
});
