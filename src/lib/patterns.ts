// patterns.ts — price-action pattern detection.
//
// Pure, isomorphic, arrays in → markers out, in the spirit of ./indicators.ts.
// A marker is one recognised pattern: which bars it spans, which bar confirms
// it, which way it leans, and the price it turns on. Nothing here knows about
// canvases — lib/chart/patternLayer.ts draws whatever it is handed, and the
// detail chart decides which detectors to run.
//
// Two families:
//   structure — pivots, the HH/HL/LH/LL sequence they form, and pullbacks
//   bars      — the 1–3 bar formations (2/3-bar reversal, pin, engulfing,
//               inside, outside, doji) and the failed breakout
//
// Every threshold lives in PatternConfig, so a chart, a test or a later screen
// filter can tighten one without forking a detector. Detection is confirmed-only
// and never looks past the bar it anchors on plus the bars a pattern needs to
// close: a pivot at bar i is only known `right` bars later, which is why the
// last few bars of a series carry no pivot.

import { atr14 } from './indicators.ts';
import type { OHLC } from './market.ts';

export type PatternId =
  | 'pivot'
  | 'structure'
  | 'pullback'
  | 'reversal2'
  | 'reversal3'
  | 'pinBar'
  | 'engulfing'
  | 'insideBar'
  | 'outsideBar'
  | 'doji'
  | 'failedBreak';

export type PatternDir = 'bull' | 'bear' | 'neutral';

export interface PatternMarker {
  id: PatternId;
  /** the bar that confirms the pattern — where the glyph is anchored */
  index: number;
  /** first bar of the span (≤ index) */
  from: number;
  /** last bar of the span (≥ index); === index for single-bar patterns */
  to: number;
  dir: PatternDir;
  /** the price the glyph points at: the extreme, or the level that broke */
  price: number;
  /** short chart label — 'HH', '2R', 'PIN' … */
  tag: string;
  /** one line for the crosshair readout and the hover card */
  note: string;
  /** pivots only: bars either side that confirmed it (3 = long, 1 = short) */
  strength?: number;
}

export interface PatternConfig {
  /** bars either side for a long (structural) pivot */
  longPivot: number;
  /** bars either side for a short (minor) pivot */
  shortPivot: number;
  /** minimum consecutive counter-trend bars in a pullback */
  pullbackMin: number;
  /** EMA pair whose order defines the pullback's trend context */
  trendFast: number;
  trendSlow: number;
  /** bars a reversal's first bar must make a new extreme over */
  reversalLookback: number;
  /** fraction of bar 1's range bar 2 must take back (2-bar reversal) */
  reversalRetrace: number;
  /** pin bar: the signal wick as a fraction of the bar's range */
  pinWick: number;
  /** pin bar: cap on the opposite wick, as a fraction of the range */
  pinOppWick: number;
  /** pin bar: cap on the body, as a fraction of the range */
  pinBody: number;
  /** doji: |close − open| as a fraction of the range */
  dojiBody: number;
  /** failed breakout: bars whose extreme defines the level */
  breakLookback: number;
  /** failed breakout: bars allowed to close back through the level */
  breakWithin: number;
  /** noise floor: a bar's range must be this fraction of ATR(14) to count */
  minRangeAtr: number;
}

export const DEFAULT_CONFIG: PatternConfig = {
  longPivot: 3,
  shortPivot: 1,
  pullbackMin: 2,
  trendFast: 20,
  trendSlow: 50,
  reversalLookback: 5,
  reversalRetrace: 0.5,
  pinWick: 0.55,
  pinOppWick: 0.25,
  pinBody: 0.35,
  dojiBody: 0.1,
  breakLookback: 20,
  breakWithin: 3,
  minRangeAtr: 0.25,
};

// ---------------------------------------------------------------- registry

export type PatternGroup = 'structure' | 'reversal' | 'bar';

export interface PatternMeta {
  id: PatternId;
  label: string;
  group: PatternGroup;
  /** help/glossary topic id behind the toggle */
  help: string;
  /** what the glyph looks like on the chart, for the chooser */
  blurb: string;
}

export const GROUP_LABEL: Record<PatternGroup, string> = {
  structure: 'Structure',
  reversal: 'Reversals',
  bar: 'Bar formations',
};

export const PATTERNS: readonly PatternMeta[] = [
  { id: 'pivot', label: 'Pivots', group: 'structure', help: 'pa-pivot',
    blurb: 'Swing highs and lows — big markers are 3-bar, small are 1-bar' },
  { id: 'structure', label: 'HH / HL / LH / LL', group: 'structure', help: 'pa-structure',
    blurb: 'Labels each long pivot against the last one of its kind' },
  { id: 'pullback', label: 'Pullbacks', group: 'structure', help: 'pa-pullback',
    blurb: 'Counter-trend runs of lower highs and lows inside a trend' },
  { id: 'reversal2', label: '2-bar reversal', group: 'reversal', help: 'pa-reversal-2bar',
    blurb: 'A new extreme, then a bar that takes most of it back' },
  { id: 'reversal3', label: '3-bar reversal', group: 'reversal', help: 'pa-reversal-3bar',
    blurb: 'Extreme, indecision, then a close back through the first bar' },
  { id: 'pinBar', label: 'Pin bar', group: 'reversal', help: 'pa-pin-bar',
    blurb: 'Long wick, small body — price pushed to an extreme and rejected' },
  { id: 'engulfing', label: 'Engulfing', group: 'reversal', help: 'pa-engulfing',
    blurb: "A body that swallows the prior bar's body, the other way" },
  { id: 'failedBreak', label: 'Failed breakout', group: 'reversal', help: 'pa-failed-break',
    blurb: 'A break of a 20-bar extreme that closes back inside' },
  { id: 'insideBar', label: 'Inside bar', group: 'bar', help: 'pa-inside-bar',
    blurb: "Range inside the previous bar's — compression before a break" },
  { id: 'outsideBar', label: 'Outside bar', group: 'bar', help: 'pa-outside-bar',
    blurb: 'Range engulfing the previous bar’s — expansion' },
  { id: 'doji', label: 'Doji', group: 'bar', help: 'pa-doji',
    blurb: 'Open and close all but equal — indecision' },
];

export const PATTERN_IDS: readonly PatternId[] = PATTERNS.map((p) => p.id);

/** What the detail chart shows before anyone touches the chooser. */
export const DEFAULT_PATTERNS: readonly PatternId[] = ['pivot', 'structure'];

export function patternMeta(id: PatternId): PatternMeta | undefined {
  return PATTERNS.find((p) => p.id === id);
}

// ---------------------------------------------------------------- helpers

const range = (h: number, l: number) => h - l;
const body = (o: number, c: number) => Math.abs(c - o);
const isUp = (o: number, c: number) => c > o;
const isDown = (o: number, c: number) => c < o;

/** True when bar i's high beats every high within `k` bars either side. */
function pivotHighAt(h: number[], i: number, k: number): boolean {
  if (i - k < 0 || i + k >= h.length) return false;
  for (let j = i - k; j <= i + k; j++) {
    if (j !== i && h[j] >= h[i]) return false;
  }
  return true;
}

function pivotLowAt(l: number[], i: number, k: number): boolean {
  if (i - k < 0 || i + k >= l.length) return false;
  for (let j = i - k; j <= i + k; j++) {
    if (j !== i && l[j] <= l[i]) return false;
  }
  return true;
}

/** Highest high over [i-n, i-1]; -Infinity when the window is short. */
function priorHigh(h: number[], i: number, n: number): number {
  if (i - n < 0) return -Infinity;
  let m = -Infinity;
  for (let j = i - n; j < i; j++) if (h[j] > m) m = h[j];
  return m;
}

function priorLow(l: number[], i: number, n: number): number {
  if (i - n < 0) return Infinity;
  let m = Infinity;
  for (let j = i - n; j < i; j++) if (l[j] < m) m = l[j];
  return m;
}

/** EMA order at each bar: +1 fast over slow (up), -1 under (down). */
function trendOf(closes: number[], fast: number, slow: number): Int8Array {
  const k1 = 2 / (fast + 1), k2 = 2 / (slow + 1);
  const out = new Int8Array(closes.length);
  let f = closes[0] ?? 0, s = closes[0] ?? 0;
  for (let i = 0; i < closes.length; i++) {
    if (i > 0) {
      f = closes[i] * k1 + f * (1 - k1);
      s = closes[i] * k2 + s * (1 - k2);
    }
    out[i] = f > s ? 1 : f < s ? -1 : 0;
  }
  return out;
}

// ---------------------------------------------------------------- detectors

/** Long and short swing points. A bar that is both is emitted once, as long. */
function detectPivots(bars: OHLC, cfg: PatternConfig): PatternMarker[] {
  const { h, l } = bars;
  const out: PatternMarker[] = [];
  for (let i = 0; i < h.length; i++) {
    const longHi = pivotHighAt(h, i, cfg.longPivot);
    const longLo = pivotLowAt(l, i, cfg.longPivot);
    const shortHi = !longHi && pivotHighAt(h, i, cfg.shortPivot);
    const shortLo = !longLo && pivotLowAt(l, i, cfg.shortPivot);
    // The span is the pivot bar alone; the bars either side confirmed it but are
    // not part of it, and `strength` is where that confirmation is recorded.
    if (longHi || shortHi) {
      const k = longHi ? cfg.longPivot : cfg.shortPivot;
      out.push({
        id: 'pivot', index: i, from: i, to: i, dir: 'bear', price: h[i],
        tag: longHi ? 'PH' : '', strength: k,
        note: `${longHi ? 'Swing' : 'Minor'} pivot high — high above the ${k} bar${k === 1 ? '' : 's'} either side`,
      });
    }
    if (longLo || shortLo) {
      const k = longLo ? cfg.longPivot : cfg.shortPivot;
      out.push({
        id: 'pivot', index: i, from: i, to: i, dir: 'bull', price: l[i],
        tag: longLo ? 'PL' : '', strength: k,
        note: `${longLo ? 'Swing' : 'Minor'} pivot low — low below the ${k} bar${k === 1 ? '' : 's'} either side`,
      });
    }
  }
  return out;
}

/** HH / HL / LH / LL: each long pivot read against the last pivot of its kind. */
function detectStructure(bars: OHLC, cfg: PatternConfig): PatternMarker[] {
  const { h, l } = bars;
  const out: PatternMarker[] = [];
  let lastHigh = NaN, lastLow = NaN;
  for (let i = 0; i < h.length; i++) {
    if (pivotHighAt(h, i, cfg.longPivot)) {
      if (Number.isFinite(lastHigh)) {
        const up = h[i] > lastHigh;
        out.push({
          id: 'structure', index: i, from: i, to: i, dir: up ? 'bull' : 'bear', price: h[i],
          tag: up ? 'HH' : 'LH',
          note: up
            ? 'Higher high — the swing high beat the previous one'
            : 'Lower high — the swing high failed to beat the previous one',
        });
      }
      lastHigh = h[i];
    }
    if (pivotLowAt(l, i, cfg.longPivot)) {
      if (Number.isFinite(lastLow)) {
        const up = l[i] > lastLow;
        out.push({
          id: 'structure', index: i, from: i, to: i, dir: up ? 'bull' : 'bear', price: l[i],
          tag: up ? 'HL' : 'LL',
          note: up
            ? 'Higher low — the swing low held above the previous one'
            : 'Lower low — the swing low broke the previous one',
        });
      }
      lastLow = l[i];
    }
  }
  return out;
}

/** Counter-trend runs: lower highs + lower lows in an uptrend, and the mirror. */
function detectPullbacks(bars: OHLC, cfg: PatternConfig): PatternMarker[] {
  const { h, l, c } = bars;
  const trend = trendOf(c, cfg.trendFast, cfg.trendSlow);
  const out: PatternMarker[] = [];
  let i = 1;
  while (i < h.length) {
    const down = h[i] < h[i - 1] && l[i] < l[i - 1];
    const up = h[i] > h[i - 1] && l[i] > l[i - 1];
    const dir: PatternDir | null = down && trend[i - 1] === 1 ? 'bull'
      : up && trend[i - 1] === -1 ? 'bear'
        : null;
    if (!dir) { i++; continue; }
    let end = i;
    while (end + 1 < h.length) {
      const nxt = dir === 'bull'
        ? h[end + 1] < h[end] && l[end + 1] < l[end]
        : h[end + 1] > h[end] && l[end + 1] > l[end];
      if (!nxt) break;
      end++;
    }
    const bars_ = end - i + 1;
    if (bars_ >= cfg.pullbackMin) {
      let hi = -Infinity, lo = Infinity;
      for (let j = i - 1; j <= end; j++) { if (h[j] > hi) hi = h[j]; if (l[j] < lo) lo = l[j]; }
      out.push({
        id: 'pullback', index: end, from: i - 1, to: end, dir, price: dir === 'bull' ? lo : hi,
        tag: 'PB',
        note: dir === 'bull'
          ? `Pullback — ${bars_} bars of lower highs and lows inside an uptrend`
          : `Rally — ${bars_} bars of higher highs and lows inside a downtrend`,
      });
    }
    i = end + 1;
  }
  return out;
}

/** A new extreme, then a bar that takes back `reversalRetrace` of its range. */
function detectReversal2(bars: OHLC, cfg: PatternConfig, atr: number[]): PatternMarker[] {
  const { o, h, l, c } = bars;
  const out: PatternMarker[] = [];
  for (let i = 1; i < c.length; i++) {
    const a = i - 1;
    const ra = range(h[a], l[a]), rb = range(h[i], l[i]);
    if (ra <= 0 || rb < cfg.minRangeAtr * atr[i]) continue;
    // bullish: down bar into a new low, then an up bar closing back through it
    if (isDown(o[a], c[a]) && isUp(o[i], c[i])
      && l[a] < priorLow(l, a, cfg.reversalLookback)
      && c[i] >= l[a] + cfg.reversalRetrace * ra) {
      out.push({
        id: 'reversal2', index: i, from: a, to: i, dir: 'bull', price: Math.min(l[a], l[i]),
        tag: '2R',
        note: 'Bullish 2-bar reversal — a new low, then a close back through it',
      });
      continue;
    }
    // bearish: up bar into a new high, then a down bar giving it back
    if (isUp(o[a], c[a]) && isDown(o[i], c[i])
      && h[a] > priorHigh(h, a, cfg.reversalLookback)
      && c[i] <= h[a] - cfg.reversalRetrace * ra) {
      out.push({
        id: 'reversal2', index: i, from: a, to: i, dir: 'bear', price: Math.max(h[a], h[i]),
        tag: '2R',
        note: 'Bearish 2-bar reversal — a new high, then a close back through it',
      });
    }
  }
  return out;
}

/** Extreme, indecision, then a close beyond the first bar — the filtered turn. */
function detectReversal3(bars: OHLC, cfg: PatternConfig, atr: number[]): PatternMarker[] {
  const { o, h, l, c } = bars;
  const out: PatternMarker[] = [];
  for (let i = 2; i < c.length; i++) {
    const a = i - 2, m = i - 1;
    const ra = range(h[a], l[a]), rm = range(h[m], l[m]);
    if (ra < cfg.minRangeAtr * atr[a] || rm <= 0) continue;
    const indecisive = body(o[m], c[m]) <= 0.5 * rm && rm <= ra;
    if (!indecisive) continue;
    if (l[a] < priorLow(l, a, cfg.reversalLookback) && l[m] >= l[a] && c[i] > h[a]) {
      out.push({
        id: 'reversal3', index: i, from: a, to: i, dir: 'bull', price: Math.min(l[a], l[m]),
        tag: '3R',
        note: 'Bullish 3-bar reversal — a low, a pause, then a close above the low bar',
      });
      continue;
    }
    if (h[a] > priorHigh(h, a, cfg.reversalLookback) && h[m] <= h[a] && c[i] < l[a]) {
      out.push({
        id: 'reversal3', index: i, from: a, to: i, dir: 'bear', price: Math.max(h[a], h[m]),
        tag: '3R',
        note: 'Bearish 3-bar reversal — a high, a pause, then a close below the high bar',
      });
    }
  }
  return out;
}

/** Long wick, small body, stub on the other side: price rejected at an extreme. */
function detectPinBars(bars: OHLC, cfg: PatternConfig, atr: number[]): PatternMarker[] {
  const { o, h, l, c } = bars;
  const out: PatternMarker[] = [];
  for (let i = 0; i < c.length; i++) {
    const r = range(h[i], l[i]);
    if (r <= 0 || r < cfg.minRangeAtr * atr[i]) continue;
    const b = body(o[i], c[i]);
    if (b > cfg.pinBody * r) continue;
    const upper = h[i] - Math.max(o[i], c[i]);
    const lower = Math.min(o[i], c[i]) - l[i];
    if (lower >= cfg.pinWick * r && upper <= cfg.pinOppWick * r) {
      out.push({
        id: 'pinBar', index: i, from: i, to: i, dir: 'bull', price: l[i], tag: 'PIN',
        note: 'Bullish pin bar — a long lower wick rejected the low',
      });
    } else if (upper >= cfg.pinWick * r && lower <= cfg.pinOppWick * r) {
      out.push({
        id: 'pinBar', index: i, from: i, to: i, dir: 'bear', price: h[i], tag: 'PIN',
        note: 'Bearish pin bar — a long upper wick rejected the high',
      });
    }
  }
  return out;
}

/** A body that swallows the previous body, the other way round. */
function detectEngulfing(bars: OHLC, cfg: PatternConfig, atr: number[]): PatternMarker[] {
  const { o, h, l, c } = bars;
  const out: PatternMarker[] = [];
  for (let i = 1; i < c.length; i++) {
    const a = i - 1;
    const prevBody = body(o[a], c[a]), curBody = body(o[i], c[i]);
    if (prevBody <= 0 || curBody <= prevBody) continue;
    if (curBody < cfg.minRangeAtr * atr[i]) continue;
    const lo = Math.min(l[a], l[i]), hi = Math.max(h[a], h[i]);
    if (isDown(o[a], c[a]) && isUp(o[i], c[i]) && o[i] <= c[a] && c[i] >= o[a]) {
      out.push({
        id: 'engulfing', index: i, from: a, to: i, dir: 'bull', price: lo, tag: 'ENG',
        note: "Bullish engulfing — the up body swallowed the prior down body",
      });
    } else if (isUp(o[a], c[a]) && isDown(o[i], c[i]) && o[i] >= c[a] && c[i] <= o[a]) {
      out.push({
        id: 'engulfing', index: i, from: a, to: i, dir: 'bear', price: hi, tag: 'ENG',
        note: "Bearish engulfing — the down body swallowed the prior up body",
      });
    }
  }
  return out;
}

/** Range wholly inside the previous bar's — compression. */
function detectInsideBars(bars: OHLC): PatternMarker[] {
  const { h, l } = bars;
  const out: PatternMarker[] = [];
  for (let i = 1; i < h.length; i++) {
    if (h[i] <= h[i - 1] && l[i] >= l[i - 1] && (h[i] < h[i - 1] || l[i] > l[i - 1])) {
      out.push({
        id: 'insideBar', index: i, from: i - 1, to: i, dir: 'neutral', price: h[i - 1], tag: 'IB',
        note: "Inside bar — the range sits inside the mother bar; traded as a break of either side",
      });
    }
  }
  return out;
}

/** Range engulfing the previous bar's high and low — expansion. */
function detectOutsideBars(bars: OHLC): PatternMarker[] {
  const { o, h, l, c } = bars;
  const out: PatternMarker[] = [];
  for (let i = 1; i < h.length; i++) {
    if (h[i] > h[i - 1] && l[i] < l[i - 1]) {
      const up = c[i] >= o[i];
      out.push({
        id: 'outsideBar', index: i, from: i - 1, to: i, dir: up ? 'bull' : 'bear',
        price: up ? h[i] : l[i], tag: 'OB',
        note: `Outside bar — the range covered the whole prior bar and closed ${up ? 'up' : 'down'}`,
      });
    }
  }
  return out;
}

/** Open and close all but equal — balance. */
function detectDoji(bars: OHLC, cfg: PatternConfig, atr: number[]): PatternMarker[] {
  const { o, h, l, c } = bars;
  const out: PatternMarker[] = [];
  for (let i = 0; i < c.length; i++) {
    const r = range(h[i], l[i]);
    if (r <= 0 || r < cfg.minRangeAtr * atr[i]) continue;
    if (body(o[i], c[i]) <= cfg.dojiBody * r) {
      out.push({
        id: 'doji', index: i, from: i, to: i, dir: 'neutral', price: h[i], tag: 'DOJ',
        note: 'Doji — open and close all but equal; indecision',
      });
    }
  }
  return out;
}

/** A break of the prior `breakLookback` extreme that closes back inside. */
function detectFailedBreaks(bars: OHLC, cfg: PatternConfig): PatternMarker[] {
  const { h, l, c } = bars;
  const out: PatternMarker[] = [];
  let i = cfg.breakLookback;
  while (i < c.length) {
    const hiLevel = priorHigh(h, i, cfg.breakLookback);
    const loLevel = priorLow(l, i, cfg.breakLookback);
    let done = -1;
    if (h[i] > hiLevel) {
      for (let j = i; j <= Math.min(c.length - 1, i + cfg.breakWithin); j++) {
        if (c[j] < hiLevel) {
          out.push({
            id: 'failedBreak', index: j, from: i, to: j, dir: 'bear', price: hiLevel, tag: 'FB',
            note: `Failed breakout — broke the ${cfg.breakLookback}-bar high, then closed back below it`,
          });
          done = j;
          break;
        }
      }
    }
    if (done < 0 && l[i] < loLevel) {
      for (let j = i; j <= Math.min(c.length - 1, i + cfg.breakWithin); j++) {
        if (c[j] > loLevel) {
          out.push({
            id: 'failedBreak', index: j, from: i, to: j, dir: 'bull', price: loLevel, tag: 'FB',
            note: `Failed breakdown — broke the ${cfg.breakLookback}-bar low, then closed back above it`,
          });
          done = j;
          break;
        }
      }
    }
    i = done >= 0 ? done + 1 : i + 1;
  }
  return out;
}

// ---------------------------------------------------------------- entry point

const NEEDS_ATR: ReadonlySet<PatternId> = new Set<PatternId>([
  'reversal2', 'reversal3', 'pinBar', 'engulfing', 'doji',
]);

/**
 * Run the requested detectors over one series. Unknown ids are ignored; the
 * result is sorted by confirming bar, then by the order of PATTERNS, so the
 * chart layer can draw and label deterministically.
 */
export function detectPatterns(
  bars: OHLC,
  ids: Iterable<PatternId>,
  config: Partial<PatternConfig> = {},
): PatternMarker[] {
  const want = new Set(ids);
  const n = bars.c.length;
  if (n < 2 || want.size === 0) return [];
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const atr = [...want].some((id) => NEEDS_ATR.has(id))
    ? atr14(bars.h, bars.l, bars.c)
    : [];

  const out: PatternMarker[] = [];
  if (want.has('pivot')) out.push(...detectPivots(bars, cfg));
  if (want.has('structure')) out.push(...detectStructure(bars, cfg));
  if (want.has('pullback')) out.push(...detectPullbacks(bars, cfg));
  if (want.has('reversal2')) out.push(...detectReversal2(bars, cfg, atr));
  if (want.has('reversal3')) out.push(...detectReversal3(bars, cfg, atr));
  if (want.has('pinBar')) out.push(...detectPinBars(bars, cfg, atr));
  if (want.has('engulfing')) out.push(...detectEngulfing(bars, cfg, atr));
  if (want.has('insideBar')) out.push(...detectInsideBars(bars));
  if (want.has('outsideBar')) out.push(...detectOutsideBars(bars));
  if (want.has('doji')) out.push(...detectDoji(bars, cfg, atr));
  if (want.has('failedBreak')) out.push(...detectFailedBreaks(bars, cfg));

  const order = new Map(PATTERN_IDS.map((id, i) => [id, i]));
  return out.sort((a, b) =>
    a.index - b.index
    || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
    || b.price - a.price);
}

/** Markers whose span covers bar `i` — what the crosshair reports. */
export function markersAtBar(markers: readonly PatternMarker[], i: number): PatternMarker[] {
  return markers.filter((m) => i >= m.from && i <= m.to);
}

/** How many of each pattern fall inside [from, to] — the chooser's counts. */
export function countsInRange(
  markers: readonly PatternMarker[],
  from: number,
  to: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of markers) {
    if (m.to < from || m.from > to) continue;
    out[m.id] = (out[m.id] ?? 0) + 1;
  }
  return out;
}
