import { describe, it, expect } from 'vitest';
import {
  detectPatterns,
  markersAtBar,
  countsInRange,
  PATTERNS,
  PATTERN_IDS,
  DEFAULT_PATTERNS,
  type PatternId,
  type PatternMarker,
} from './patterns.ts';
import type { OHLC } from './market.ts';

type Tup = [o: number, h: number, l: number, c: number];

function ohlc(rows: Tup[]): OHLC {
  return {
    o: rows.map((r) => r[0]),
    h: rows.map((r) => r[1]),
    l: rows.map((r) => r[2]),
    c: rows.map((r) => r[3]),
  };
}

/** n identical quiet bars — a small body, so they are not dojis themselves. */
function flat(n: number, p = 100): Tup[] {
  return Array.from({ length: n }, () => [p, p + 0.5, p - 0.5, p + 0.2] as Tup);
}

/** A steady advance: each bar a little above the last. */
function rise(n: number, start = 100, step = 0.5): Tup[] {
  return Array.from({ length: n }, (_, i) => {
    const base = start + i * step;
    return [base, base + step, base - step * 0.4, base + step * 0.8] as Tup;
  });
}

function only(markers: PatternMarker[], id: PatternId): PatternMarker[] {
  return markers.filter((m) => m.id === id);
}

function run(rows: Tup[], id: PatternId): PatternMarker[] {
  return only(detectPatterns(ohlc(rows), [id]), id);
}

describe('registry', () => {
  it('lists every id exactly once and defaults to the structural pair', () => {
    expect(new Set(PATTERN_IDS).size).toBe(PATTERNS.length);
    expect(DEFAULT_PATTERNS.every((id) => PATTERN_IDS.includes(id))).toBe(true);
  });

  it('returns nothing for an empty selection or a series too short to read', () => {
    expect(detectPatterns(ohlc(flat(50)), [])).toEqual([]);
    expect(detectPatterns(ohlc(flat(1)), PATTERN_IDS)).toEqual([]);
  });
});

describe('pivots', () => {
  const peak: Tup[] = [
    ...flat(6),
    [100, 104, 99.5, 103], // the swing high, bar 6
    ...flat(6),
  ];

  it('marks a swing high once, at long strength, spanning only its own bar', () => {
    const hi = run(peak, 'pivot').filter((m) => m.dir === 'bear');
    expect(hi).toHaveLength(1);
    expect(hi[0]).toMatchObject({ index: 6, from: 6, to: 6, strength: 3, tag: 'PH', price: 104 });
  });

  it('does not report the confirming bars either side as pivots themselves', () => {
    const all = detectPatterns(ohlc(peak), ['pivot']);
    expect(markersAtBar(all, 5).filter((m) => m.id === 'pivot' && m.dir === 'bear')).toHaveLength(0);
    expect(markersAtBar(all, 6).filter((m) => m.id === 'pivot' && m.dir === 'bear')).toHaveLength(1);
  });

  it('marks a minor swing with the short strength and no label', () => {
    // bar 3 digs deeper than bar 5, so bar 5 is a swing only at 1 bar either side
    const dip: Tup[] = [...flat(3), [100, 100.5, 97, 97.5], flat(1)[0], [100, 100.4, 99.2, 99.6], ...flat(4)];
    const minor = run(dip, 'pivot').filter((m) => m.dir === 'bull' && m.strength === 1);
    expect(minor).toHaveLength(1);
    expect(minor[0]).toMatchObject({ index: 5, tag: '' });
  });

  it('cannot confirm a long pivot inside the last `longPivot` bars', () => {
    const late: Tup[] = [...flat(8), [100, 104, 99.5, 103], flat(1)[0]];
    const marks = run(late, 'pivot');
    expect(marks.filter((m) => m.index === 8 && m.strength === 3)).toHaveLength(0);
    expect(marks.filter((m) => m.index === 8)).toHaveLength(1); // still a minor one
    expect(marks.filter((m) => m.index === 9)).toHaveLength(0); // last bar: nothing at all
  });

  it('ignores ties — a shared high is nobody’s pivot', () => {
    const tie: Tup[] = [...flat(4), [100, 104, 99.5, 103], [100, 104, 99.5, 103], ...flat(4)];
    expect(run(tie, 'pivot').filter((m) => m.dir === 'bear')).toHaveLength(0);
  });
});

describe('swing structure', () => {
  it('labels the second swing high against the first', () => {
    const higher: Tup[] = [...flat(4), [100, 104, 99.5, 103], ...flat(7), [100, 106, 99.5, 105], ...flat(4)];
    const lower: Tup[] = [...flat(4), [100, 106, 99.5, 105], ...flat(7), [100, 104, 99.5, 103], ...flat(4)];
    expect(run(higher, 'structure').map((m) => m.tag)).toEqual(['HH']);
    expect(run(lower, 'structure').map((m) => m.tag)).toEqual(['LH']);
  });

  it('labels swing lows as HL / LL and leans them the right way', () => {
    const hl: Tup[] = [...flat(4), [100, 100.5, 96, 97], ...flat(7), [100, 100.5, 98, 99], ...flat(4)];
    const marks = run(hl, 'structure');
    expect(marks.map((m) => m.tag)).toEqual(['HL']);
    expect(marks[0].dir).toBe('bull');
  });

  it('says nothing about the first swing of each kind', () => {
    const one: Tup[] = [...flat(4), [100, 104, 99.5, 103], ...flat(4)];
    expect(run(one, 'structure')).toHaveLength(0);
  });
});

describe('pullbacks', () => {
  it('marks a run of lower highs and lows inside an uptrend', () => {
    const rows: Tup[] = [
      ...rise(80),
      [120, 120.2, 118.5, 119],
      [119, 119.4, 117.5, 118],
      [118, 118.4, 116.5, 117],
      ...rise(6, 118),
    ];
    const pb = run(rows, 'pullback');
    expect(pb).toHaveLength(1);
    expect(pb[0]).toMatchObject({ id: 'pullback', dir: 'bull', from: 79, to: 82, index: 82 });
    expect(pb[0].note).toContain('3 bars');
  });

  it('needs the trend behind it — the same three bars in a downtrend are not a pullback', () => {
    const rows: Tup[] = [
      ...rise(80, 140, -0.5),
      [100, 100.2, 98.5, 99],
      [99, 99.4, 97.5, 98],
      [98, 98.4, 96.5, 97],
      ...flat(6, 98),
    ];
    expect(run(rows, 'pullback').filter((m) => m.dir === 'bull')).toHaveLength(0);
  });

  it('needs at least `pullbackMin` bars', () => {
    const rows: Tup[] = [...rise(80), [120, 120.2, 118.5, 119], ...rise(6, 120)];
    expect(run(rows, 'pullback')).toHaveLength(0);
  });
});

describe('2-bar reversal', () => {
  const bull: Tup[] = [...flat(10), [100, 100.2, 97, 97.5], [97.6, 99.5, 97.4, 99.4], ...flat(3)];

  it('fires on a new low taken straight back', () => {
    const m = run(bull, 'reversal2');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ dir: 'bull', from: 10, to: 11, index: 11, price: 97 });
  });

  it('does not fire when the second bar barely recovers', () => {
    const weak: Tup[] = [...flat(10), [100, 100.2, 97, 97.5], [97.6, 98, 97.4, 97.9], ...flat(3)];
    expect(run(weak, 'reversal2')).toHaveLength(0);
  });

  it('mirrors at a high', () => {
    const bear: Tup[] = [...flat(10), [100, 103, 99.8, 102.5], [102.4, 102.6, 100.5, 100.6], ...flat(3)];
    const m = run(bear, 'reversal2');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ dir: 'bear', price: 103 });
  });
});

describe('3-bar reversal', () => {
  it('needs the middle bar to pause and the third to close through', () => {
    const rows: Tup[] = [
      ...flat(10),
      [100, 100.2, 97, 97.4],     // the low
      [97.5, 98.2, 97.2, 97.6],   // indecision, narrower
      [97.7, 101, 97.6, 100.8],   // closes above bar 10's high
      ...flat(3),
    ];
    const m = run(rows, 'reversal3');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ dir: 'bull', from: 10, to: 12, index: 12 });
  });

  it('rejects a third bar that stops short of the first bar’s high', () => {
    const rows: Tup[] = [
      ...flat(10),
      [100, 100.2, 97, 97.4],
      [97.5, 98.2, 97.2, 97.6],
      [97.7, 99.5, 97.6, 99.4],
      ...flat(3),
    ];
    expect(run(rows, 'reversal3')).toHaveLength(0);
  });
});

describe('single-bar formations', () => {
  it('finds a bullish pin bar by its wick, not its colour', () => {
    const rows: Tup[] = [...flat(10), [100, 100.3, 96, 99.9], ...flat(3)];
    const m = run(rows, 'pinBar');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ dir: 'bull', price: 96, index: 10 });
  });

  it('finds a bearish pin bar', () => {
    const rows: Tup[] = [...flat(10), [100, 104, 99.7, 100.1], ...flat(3)];
    expect(run(rows, 'pinBar')[0]).toMatchObject({ dir: 'bear', price: 104 });
  });

  it('rejects a long-wicked bar that also has a fat body', () => {
    const rows: Tup[] = [...flat(10), [100, 100.2, 96, 97], ...flat(3)];
    expect(run(rows, 'pinBar')).toHaveLength(0);
  });

  it('finds a doji and ignores a bar with a real body', () => {
    const doji: Tup[] = [...flat(10), [100, 102, 98, 100.05], ...flat(3)];
    const solid: Tup[] = [...flat(10), [100, 102, 98, 101.5], ...flat(3)];
    expect(run(doji, 'doji')).toHaveLength(1);
    expect(run(solid, 'doji')).toHaveLength(0);
  });
});

describe('two-bar formations', () => {
  it('finds a bullish engulfing and requires the prior bar to be red', () => {
    const rows: Tup[] = [...flat(10), [100, 100.2, 98.5, 98.8], [98.6, 101.2, 98.4, 101], ...flat(3)];
    const m = run(rows, 'engulfing');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ dir: 'bull', from: 11 - 1, to: 11 });
  });

  it('finds a bearish engulfing', () => {
    const rows: Tup[] = [...flat(10), [100, 101.5, 99.8, 101.2], [101.3, 101.5, 99, 99.5], ...flat(3)];
    expect(run(rows, 'engulfing')[0]).toMatchObject({ dir: 'bear' });
  });

  it('reads an inside bar off the mother bar’s range', () => {
    const rows: Tup[] = [...flat(10), [100, 103, 97, 102], [101, 102.5, 98, 99], [99, 104, 96, 103]];
    const m = run(rows, 'insideBar');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ dir: 'neutral', from: 10, to: 11, price: 103 });
  });

  it('reads an outside bar and takes its lean from the close', () => {
    const up: Tup[] = [...flat(10), [100, 100.4, 99.6, 100.1], [99.5, 102, 98, 101.8], ...flat(3)];
    const down: Tup[] = [...flat(10), [100, 100.4, 99.6, 100.1], [100.5, 102, 98, 98.2], ...flat(3)];
    expect(run(up, 'outsideBar').find((m) => m.index === 11)).toMatchObject({ dir: 'bull', price: 102 });
    expect(run(down, 'outsideBar').find((m) => m.index === 11)).toMatchObject({ dir: 'bear', price: 98 });
  });

  it('does not call an identical range inside or outside', () => {
    const same: Tup[] = [...flat(10), [100, 101, 99, 100.5], [100, 101, 99, 99.5], ...flat(3)];
    expect(run(same, 'insideBar').some((m) => m.index === 11)).toBe(false);
    expect(run(same, 'outsideBar').some((m) => m.index === 11)).toBe(false);
  });
});

describe('failed breakout', () => {
  it('confirms on the bar that closes back inside the level', () => {
    const rows: Tup[] = [...flat(25), [100.4, 102, 100.2, 101.5], [101.4, 101.6, 99, 99.2], ...flat(3)];
    const m = run(rows, 'failedBreak');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ dir: 'bear', from: 25, to: 26, index: 26, price: 100.5 });
  });

  it('leaves a break that holds alone', () => {
    const rows: Tup[] = [...flat(25), [100.4, 102, 100.2, 101.5], ...flat(4, 102)];
    expect(run(rows, 'failedBreak')).toHaveLength(0);
  });

  it('mirrors below support', () => {
    const rows: Tup[] = [...flat(25), [99.6, 99.8, 98, 98.5], [98.6, 101, 98.4, 100.8], ...flat(3)];
    expect(run(rows, 'failedBreak')[0]).toMatchObject({ dir: 'bull', price: 99.5 });
  });

  it('gives up after `breakWithin` bars', () => {
    const rows: Tup[] = [
      ...flat(25),
      [100.4, 102, 100.2, 101.5],
      ...flat(4, 101.5),
      [101.5, 101.6, 99, 99.2],
    ];
    expect(run(rows, 'failedBreak')).toHaveLength(0);
  });
});

describe('the combined result', () => {
  const rows: Tup[] = [
    ...flat(25),
    [100, 100.2, 97, 97.5],
    [97.6, 99.5, 97.4, 99.4],
    ...flat(6, 99.5),
  ];

  it('is sorted by the confirming bar', () => {
    const all = detectPatterns(ohlc(rows), PATTERN_IDS);
    expect(all.length).toBeGreaterThan(0);
    for (let i = 1; i < all.length; i++) expect(all[i].index).toBeGreaterThanOrEqual(all[i - 1].index);
  });

  it('runs one detector at a time without changing what it finds', () => {
    const all = detectPatterns(ohlc(rows), PATTERN_IDS);
    const piecewise = PATTERN_IDS.flatMap((id) => detectPatterns(ohlc(rows), [id]));
    expect(all.length).toBe(piecewise.length);
  });

  it('reports the markers covering a bar, span included', () => {
    const all = detectPatterns(ohlc(rows), ['reversal2']);
    expect(markersAtBar(all, 25).map((m) => m.id)).toEqual(['reversal2']);
    expect(markersAtBar(all, 26)).toHaveLength(1);
    expect(markersAtBar(all, 24)).toHaveLength(0);
  });

  it('counts what overlaps a window, not only what confirms in it', () => {
    const all = detectPatterns(ohlc(rows), ['reversal2']);
    expect(countsInRange(all, 0, 25)).toEqual({ reversal2: 1 });
    expect(countsInRange(all, 0, 24)).toEqual({});
  });

  it('accepts a tightened threshold without touching the defaults', () => {
    const loose = detectPatterns(ohlc(rows), ['reversal2']);
    const strict = detectPatterns(ohlc(rows), ['reversal2'], { reversalRetrace: 0.95 });
    expect(loose).toHaveLength(1);
    expect(strict).toHaveLength(0);
  });
});
