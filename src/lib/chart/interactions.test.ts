import { describe, expect, it } from 'vitest';
import { bandAt, boxAt, type Band, type Box } from './interactions';

const box = (left: number, top: number, right: number, bottom: number, tag = ''): Box & { tag: string } =>
  ({ left, top, right, bottom, tag });

describe('boxAt', () => {
  const a = box(10, 10, 30, 20, 'a');
  const b = box(50, 10, 70, 20, 'b');

  it('finds the box the pointer is inside, and nothing outside them', () => {
    expect(boxAt(20, 15, [a, b])?.tag).toBe('a');
    expect(boxAt(60, 15, [a, b])?.tag).toBe('b');
    expect(boxAt(40, 15, [a, b])).toBeUndefined();
    expect(boxAt(20, 40, [a, b])).toBeUndefined();
  });

  it('counts the edges as hits, and pad as slack around them', () => {
    expect(boxAt(30, 20, [a])?.tag).toBe('a');
    expect(boxAt(33, 15, [a])).toBeUndefined();
    expect(boxAt(33, 15, [a], 3)?.tag).toBe('a');
  });

  it('gives the nearer centre when pad puts two boxes in reach at once', () => {
    // 12 px of empty between them; the pointer sits 4 px into the gap from a.
    const left = box(0, 0, 20, 10, 'left');
    const right = box(32, 0, 52, 10, 'right');
    expect(boxAt(24, 5, [left, right], 10)?.tag).toBe('left');
    expect(boxAt(28, 5, [right, left], 10)?.tag).toBe('right');
  });

  it('has nothing to find in an empty list', () => {
    expect(boxAt(5, 5, [])).toBeUndefined();
  });
});

describe('bandAt', () => {
  const bands: Band[] = [
    { top: 100, bottom: 178, topic: 'volume' },
    { top: 194, bottom: 266, topic: 'macd' },
  ];

  it('answers with the band the pointer is in, edges included', () => {
    expect(bandAt(120, bands)?.topic).toBe('volume');
    expect(bandAt(178, bands)?.topic).toBe('volume');
    expect(bandAt(194, bands)?.topic).toBe('macd');
  });

  it('answers with nothing above, below or between the bands', () => {
    expect(bandAt(50, bands)).toBeUndefined();
    expect(bandAt(186, bands)).toBeUndefined();
    expect(bandAt(400, bands)).toBeUndefined();
  });
});
