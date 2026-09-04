// Textbook schematic of the selected fan-backtest config.
// EMA spacing is exaggerated so the stack, tag, and management are readable —
// this is not a live ticker and is not fed through findFanEntries.

import { ema } from './indicators.ts';
import {
  BUNN_PENNY,
  BUNN_WINDOW_HI,
  BUNN_WINDOW_LO,
  FAN_STRATEGIES,
  type FanBacktestConfig,
  type FanStrategyId,
} from './fanBacktest.ts';

export interface FanExamplePhase {
  id: string;
  label: string;
  from: number;
  to: number;
  fill: string;
}

export interface FanExampleMark {
  bar: number;
  price: number;
  kind: 'entry' | 'exit' | 'fan' | 'impulse' | 'bounce' | 'adverse' | 'resume' | 'pivot';
  label: string;
}

export interface FanExampleLevel {
  price: number;
  color: string;
  label: string;
  dash: number[];
}

export interface FanExampleBand {
  lo: number;
  hi: number;
  fill: string;
  label: string;
}

export interface FanExampleBar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface FanExampleChartModel {
  bars: FanExampleBar[];
  ema18: number[];
  ema50: number[];
  ema100: number[];
  ema200: number[];
  macd: { line: number[]; signal: number[]; hist: number[] };
  showMacd: boolean;
  phases: FanExamplePhase[];
  marks: FanExampleMark[];
  levels: FanExampleLevel[];
  bands: FanExampleBand[];
  title: string;
  caption: string;
  notes: string[];
}

const FILL = {
  quiet: 'rgba(124,92,191,0.07)',
  impulse: 'rgba(196,122,20,0.12)',
  pullback: 'rgba(58,160,255,0.12)',
  tag: 'rgba(6,169,107,0.16)',
  trade: 'rgba(6,169,107,0.08)',
  adverse: 'rgba(226,61,61,0.12)',
  bounce: 'rgba(217,135,31,0.14)',
  unstacked: 'rgba(154,161,168,0.12)',
  cont: 'rgba(58,160,255,0.10)',
};

const C = {
  stop: '#e23d3d',
  entry: '#06865a',
  target: '#d9871f',
};

type Shape = 'body' | 'hammer' | 'tag18' | 'tag50' | 'dual' | 'rev';

interface Seg {
  id: string;
  label: string;
  fill: string;
  n: number;
  close: 'fan' | 'impulse' | 'pull18' | 'pull50' | 'pull100' | 'tag' | 'run' | 'unstacked' | 'crossWait';
  shape?: Shape;
  vol?: number;
}

function trailMode(config: FanBacktestConfig): 'ema50' | 'pivot' | null {
  if (config.trailPivot) return 'pivot';
  if (config.trailEma === 50) return 'ema50';
  return null;
}

function runLabel(config: FanBacktestConfig): string {
  const t = trailMode(config);
  if (t === 'ema50') return 'Trail 50-EMA';
  if (t === 'pivot') return 'Trail pivots';
  if (config.targetWindow) return 'Run to 2.5R';
  return `Run to ${config.targetR}R`;
}

function runBars(config: FanBacktestConfig): number {
  if (trailMode(config)) return 16;
  if (config.maxHoldBars != null) return Math.max(6, Math.min(config.maxHoldBars, 16));
  return 14;
}

function showContinuation(config: FanBacktestConfig): boolean {
  if (config.continueEpisode === false) return false;
  return config.strategy === 'tag18' || config.strategy === 'tag50'
    || config.strategy === 'structure' || config.strategy === 'dual_ema';
}

function segsOf(config: FanBacktestConfig): Seg[] {
  const strat = config.strategy;
  const run: Seg = { id: 'trade', label: runLabel(config), fill: FILL.trade, n: runBars(config), close: 'run', vol: 1.15 };
  const tagShape: Shape = strat === 'dual_ema' ? 'dual' : strat === 'structure' ? 'rev' : strat === 'tag18' ? 'tag18' : 'tag50';
  const pull: Seg['close'] = strat === 'tag18' ? 'pull18' : 'pull50';
  const pullLabel = strat === 'tag18' ? 'Bone zone (18)' : 'Pullback to 50';
  const tagLabel = strat === 'dual_ema' ? 'Dual-EMA tag' : strat === 'structure' ? 'Structure tag' : strat === 'tag18' ? '18-tag — entry' : '50-tag — entry';

  if (strat === 'onset') {
    return [
      { id: 'unstacked', label: '18 catching up', fill: FILL.unstacked, n: 14, close: 'unstacked', vol: 0.9 },
      { id: 'tag', label: 'Fan onset — entry', fill: FILL.tag, n: 1, close: 'tag', shape: 'body', vol: 1.6 },
      run,
    ];
  }
  if (strat === 'cross') {
    return [
      { id: 'slow', label: 'Slow fan 50>100>200', fill: FILL.quiet, n: 12, close: 'crossWait', vol: 0.85 },
      { id: 'tag', label: '18/50 cross — entry', fill: FILL.tag, n: 1, close: 'tag', shape: 'body', vol: 1.7 },
      run,
    ];
  }
  if (strat === 'bunn_bounce') {
    return [
      { id: 'fan', label: 'Slow fan holds', fill: FILL.quiet, n: 12, close: 'fan', vol: 0.9 },
      { id: 'pull', label: 'Dip into 50', fill: FILL.pullback, n: 5, close: 'pull50', vol: 0.7 },
      { id: 'bounce', label: 'Bunn reversal', fill: FILL.bounce, n: 1, close: 'tag', shape: 'hammer', vol: 1.8 },
      { id: 'tag', label: 'Buy-stop fill', fill: FILL.tag, n: 1, close: 'tag', shape: 'body', vol: 1.5 },
      run,
    ];
  }
  if (strat === 'bunn_cont') {
    return [
      { id: 'fan', label: 'Stacked fan', fill: FILL.quiet, n: 8, close: 'fan', vol: 0.9 },
      { id: 'adverse', label: '18 crosses down 50', fill: FILL.adverse, n: 6, close: 'pull50', vol: 1.1 },
      { id: 'bounce', label: 'Bounce on 100/200', fill: FILL.bounce, n: 4, close: 'pull100', vol: 0.8 },
      { id: 'resume', label: 'Fan resumes', fill: FILL.impulse, n: 3, close: 'impulse', vol: 1.3 },
      { id: 'tag', label: 'Buy-stop fill', fill: FILL.tag, n: 1, close: 'tag', shape: 'body', vol: 1.6 },
      run,
    ];
  }

  const setup: Seg[] = [
    { id: 'fan', label: '18>50>100>200', fill: FILL.quiet, n: 8, close: 'fan', vol: 0.85 },
    { id: 'impulse', label: 'Impulse / swing high', fill: FILL.impulse, n: 6, close: 'impulse', vol: 1.45 },
    { id: 'pull', label: pullLabel, fill: FILL.pullback, n: 6, close: pull, vol: 0.65 },
    { id: 'tag', label: tagLabel, fill: FILL.tag, n: 1, close: 'tag', shape: tagShape, vol: 1.7 },
    run,
  ];
  if (showContinuation(config)) {
    setup.push(
      { id: 'cont_high', label: 'New swing high', fill: FILL.impulse, n: 4, close: 'impulse', vol: 1.35 },
      { id: 'cont_pull', label: 'Continuation pullback', fill: FILL.cont, n: 4, close: pull, vol: 0.7 },
      { id: 'cont_tag', label: 'Re-armed tag', fill: FILL.tag, n: 1, close: 'tag', shape: tagShape, vol: 1.6 },
      { id: 'cont_run', label: runLabel(config), fill: FILL.trade, n: 8, close: 'run', vol: 1.1 },
    );
  }
  return setup;
}

function stackedEmas(
  n: number,
  mode: 'stacked' | 'onset' | 'cross' | 'cont',
  catchUntil: number,
  dipFrom: number,
  dipTo: number,
) {
  const e200 = Array.from({ length: n }, (_, i) => 46 + i * 0.13);
  const e100 = e200.map((v, i) => v + 2.6 + i * 0.018);
  const e50 = e100.map((v, i) => v + 2.1 + i * 0.022);
  const e18 = e50.map((v, i) => {
    let extra = 1.7 + 0.22 * Math.sin(i / 4.2);
    if ((mode === 'onset' || mode === 'cross') && i < catchUntil) {
      extra = -2.0 * (1 - i / Math.max(1, catchUntil)) + extra * (i / Math.max(1, catchUntil));
    }
    if (mode === 'cont' && i >= dipFrom && i <= dipTo) {
      const u = (i - dipFrom) / Math.max(1, dipTo - dipFrom);
      extra -= 2.4 * Math.sin(u * Math.PI);
    }
    return v + extra;
  });
  return { e18, e50, e100, e200 };
}

function emaMode(strat: FanStrategyId): 'stacked' | 'onset' | 'cross' | 'cont' {
  if (strat === 'onset') return 'onset';
  if (strat === 'cross') return 'cross';
  if (strat === 'bunn_cont') return 'cont';
  return 'stacked';
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

function layout(segs: Seg[]): { phases: FanExamplePhase[]; n: number; at: (id: string) => { from: number; to: number } } {
  const phases: FanExamplePhase[] = [];
  const index = new Map<string, { from: number; to: number }>();
  let i = 0;
  for (const s of segs) {
    const from = i;
    const to = i + s.n - 1;
    phases.push({ id: s.id, label: s.label, from, to, fill: s.fill });
    index.set(s.id, { from, to });
    i += s.n;
  }
  return { phases, n: i, at: (id) => index.get(id) ?? { from: 0, to: 0 } };
}

function closePath(
  n: number,
  segs: Seg[],
  emas: { e18: number[]; e50: number[]; e100: number[] },
): { c: number[]; shape: Shape[]; vol: number[] } {
  const c = new Array<number>(n);
  const shape = new Array<Shape>(n).fill('body');
  const vol = new Array<number>(n).fill(1);
  let i = 0;
  let runStart = 0;
  for (const s of segs) {
    for (let k = 0; k < s.n; k++, i++) {
      const t = s.n === 1 ? 1 : k / (s.n - 1);
      const e18 = emas.e18[i];
      const e50 = emas.e50[i];
      const e100 = emas.e100[i];
      vol[i] = s.vol ?? 1;
      if (s.shape) shape[i] = s.shape;
      if (s.close === 'unstacked' || s.close === 'crossWait' || s.close === 'fan') c[i] = e18 + 0.45;
      else if (s.close === 'impulse') c[i] = e18 + 0.6 + t * 1.9;
      else if (s.close === 'pull18') c[i] = lerp(e18 + 1.6, e18 + 0.15, t);
      else if (s.close === 'pull50') c[i] = lerp(e18 + 1.4, e50 + 0.2, t);
      else if (s.close === 'pull100') c[i] = lerp(e50 + 0.3, e100 + 0.25, t);
      else if (s.close === 'tag') c[i] = (s.shape === 'tag18' ? e18 : s.shape === 'hammer' ? e50 : e50) + 0.55;
      else {
        if (k === 0) runStart = c[i - 1] ?? e18 + 0.5;
        c[i] = runStart + (k + 1) * 0.42;
      }
    }
  }
  return { c, shape, vol };
}

function ohlcOf(
  closes: number[],
  emas: { e18: number[]; e50: number[]; e100: number[] },
  shape: Shape[],
  vol: number[],
): FanExampleBar[] {
  return closes.map((close, i) => {
    const prev = i === 0 ? close : closes[i - 1];
    const up = close >= prev;
    let px = close;
    let o = lerp(prev, px, 0.35);
    let h = Math.max(o, px) + 0.28;
    let l = Math.min(o, px) - 0.22;
    const sh = shape[i];
    if (sh === 'tag18') {
      l = Math.min(l, emas.e18[i] - 0.18);
      o = Math.min(o, px - 0.12);
      h = Math.max(h, px + 0.2);
    } else if (sh === 'tag50') {
      l = Math.min(l, emas.e50[i] - 0.28);
      o = px - 0.2;
      h = px + 0.35;
    } else if (sh === 'dual') {
      l = Math.min(l, emas.e50[i] - 0.25);
      h = Math.max(h, emas.e18[i] + 0.35, px + 0.45);
      o = emas.e50[i] + 0.15;
    } else if (sh === 'rev') {
      l = Math.min(l, emas.e50[i] - 0.35, (i ? closes[i - 1] : px) - 0.4);
      o = px - 0.15;
      h = Math.min(h, i ? Math.max(closes[i - 1] - 0.05, px) : h);
    } else if (sh === 'hammer') {
      o = Math.max(emas.e50[i], emas.e100[i]) + 0.25;
      px = o + 0.2;
      l = Math.min(emas.e50[i], emas.e100[i], i ? closes[i - 1] : px) - 0.45;
      h = px + 0.18;
    }
    if (!up && sh === 'body') {
      o = Math.max(o, px + 0.12);
    }
    h = Math.max(h, o, px);
    l = Math.min(l, o, px);
    return { o, h, l, c: px, v: (vol[i] ?? 1) * (900_000 + (i % 5) * 40_000) };
  });
}

function accountNote(config: FanBacktestConfig): string {
  const cash = config.startCash ?? 10_000;
  const risk = config.riskPct ?? 1;
  const names = config.maxPositions ?? 4;
  const w = config.windowMonths ?? 3;
  const win = w === 0 ? 'all dated history' : `last ${w} month${w === 1 ? '' : 's'}`;
  return `Swing account (not drawn): ${risk}% of $${cash.toLocaleString()} per 1R, max ${names} names, ${win}.`;
}

function filterNote(config: FanBacktestConfig): string | null {
  const bits: string[] = [];
  if ((config.ema200RisingBars ?? 0) > 0) {
    const n = config.ema200RisingBars ?? 21;
    bits.push(`200-EMA rising vs ${n} bars ago`);
  }
  if ((config.minAvgVol ?? 0) > 0) bits.push('volume floor on');
  if ((config.minMarketCap ?? 0) > 0) bits.push('cap floor on');
  return bits.length ? `Universe filters: ${bits.join(', ')}.` : null;
}

export function buildFanExample(config: FanBacktestConfig): FanExampleChartModel {
  const segs = segsOf(config);
  const { phases, n, at } = layout(segs);
  const tag = at('tag');
  const bounce = at('bounce');
  const adverse = at('adverse');
  const resume = at('resume');
  const impulse = at('impulse');
  const unstacked = at('unstacked');
  const slow = at('slow');
  const mode = emaMode(config.strategy);
  const catchUntil = mode === 'onset' ? unstacked.to + 1 : mode === 'cross' ? slow.to + 1 : 0;
  const dipFrom = mode === 'cont' ? adverse.from : 0;
  const dipTo = mode === 'cont' ? bounce.to : 0;
  const emas = stackedEmas(n, mode, catchUntil, dipFrom, dipTo);
  const path = closePath(n, segs, emas);
  const bars = ohlcOf(path.c, emas, path.shape, path.vol);

  const fillBar = tag.from;
  const entryPrice = config.strategy === 'bunn_bounce' || config.strategy === 'bunn_cont'
    ? bars[Math.max(0, fillBar - 1)]?.h + BUNN_PENNY
    : bars[fillBar].c;
  const stopHint = config.strategy === 'bunn_bounce'
    ? entryPrice - ((bars[bounce.from]?.h ?? entryPrice) - (bars[bounce.from]?.l ?? entryPrice) + BUNN_PENNY)
    : config.strategy === 'bunn_cont'
      ? (bars[bounce.to]?.l ?? entryPrice) - BUNN_PENNY
      : Math.min(bars[fillBar].l, emas.e50[fillBar]) - 0.35;
  const stopPrice = Math.min(stopHint, entryPrice - 0.8);
  const rSize = entryPrice - stopPrice;
  const trail = trailMode(config);
  const targetPrice = trail
    ? entryPrice + 3 * rSize
    : config.targetWindow
      ? entryPrice + BUNN_WINDOW_LO * rSize
      : entryPrice + config.targetR * rSize;

  const trade = at('trade');
  let exitBar = trade.to;
  let exitPrice = bars[exitBar].c;
  if (trail === 'ema50') {
    exitBar = Math.min(n - 1, trade.from + 11);
    exitPrice = emas.e50[exitBar];
    bars[exitBar].l = Math.min(bars[exitBar].l, exitPrice - 0.05);
  } else if (trail === 'pivot') {
    exitBar = Math.min(n - 1, trade.from + 10);
    const pivot = at('trade').from + 3;
    exitPrice = bars[Math.min(pivot, n - 1)].l - BUNN_PENNY;
    bars[exitBar].l = Math.min(bars[exitBar].l, exitPrice);
  } else if (config.targetWindow || !trail) {
    const hit = bars.findIndex((b, i) => i > fillBar && b.h >= targetPrice);
    if (hit >= 0) {
      exitBar = hit;
      exitPrice = targetPrice;
      bars[hit].h = Math.max(bars[hit].h, targetPrice + 0.05);
    }
  }

  const line = emas.e18.map((v, i) => v - emas.e50[i]);
  const signal = ema(line, 9);
  const hist = line.map((v, i) => v - signal[i]);

  const marks: FanExampleMark[] = [
    { bar: fillBar, price: entryPrice, kind: 'entry', label: 'entry' },
    { bar: exitBar, price: exitPrice, kind: 'exit', label: 'exit' },
  ];
  const contTag = at('cont_tag');
  if (contTag.from > 0) {
    marks.push({ bar: contTag.from, price: bars[contTag.from].c, kind: 'entry', label: '2nd' });
  }
  if (impulse.from || impulse.to) {
    marks.push({ bar: impulse.to, price: bars[impulse.to].h, kind: 'impulse', label: 'high' });
  }
  if (config.strategy === 'onset') {
    marks.push({ bar: fillBar, price: bars[fillBar].c, kind: 'fan', label: 'fan on' });
  }
  if (config.strategy === 'bunn_bounce') {
    marks.push({ bar: bounce.from, price: bars[bounce.from].l, kind: 'bounce', label: 'reversal' });
  }
  if (config.strategy === 'bunn_cont') {
    marks.push({ bar: adverse.from, price: emas.e50[adverse.from], kind: 'adverse', label: '18×50 down' });
    marks.push({ bar: bounce.to, price: bars[bounce.to].l, kind: 'bounce', label: '100/200 bounce' });
    marks.push({ bar: resume.to, price: bars[resume.to].c, kind: 'resume', label: 'resume' });
  }
  if (trail === 'pivot') {
    const p = trade.from + 3;
    marks.push({ bar: p, price: bars[p].l, kind: 'pivot', label: 'pivot' });
  }

  const levels: FanExampleLevel[] = [
    { price: stopPrice, color: C.stop, label: 'stop', dash: [4, 3] },
    { price: entryPrice, color: C.entry, label: 'entry', dash: [2, 3] },
  ];
  if (!trail) {
    levels.push({
      price: targetPrice,
      color: C.target,
      label: config.targetWindow ? '2.5R' : `${config.targetR}R`,
      dash: [6, 4],
    });
  }
  if (config.breakevenAtR != null && config.breakevenAtR > 0) {
    levels.push({ price: entryPrice + config.breakevenAtR * rSize, color: '#6b7280', label: '1R / BE', dash: [2, 4] });
  }

  const bands: FanExampleBand[] = [];
  if (config.targetWindow && !trail) {
    bands.push({
      lo: entryPrice + BUNN_WINDOW_LO * rSize,
      hi: entryPrice + BUNN_WINDOW_HI * rSize,
      fill: 'rgba(217,135,31,0.12)',
      label: '2.5–3R window',
    });
  }

  const strat = FAN_STRATEGIES.find((s) => s.id === config.strategy);
  const notes: string[] = [];
  if (config.macdWindow) {
    notes.push(trail
      ? '18–50 MACD must be favorable at entry; it does not cut a trailed trade.'
      : '18–50 MACD must be favorable at entry and will flatten if the line drops through signal.');
  }
  if (trail === 'ema50') notes.push('After 1R the stop follows the 50-EMA (blue). MACD / max-hold do not cut while the slow fan holds.');
  if (trail === 'pivot') notes.push('After entry the stop ratchets 2¢ under each newly confirmed pivot low.');
  if (!trail && config.maxHoldBars != null) notes.push(`Max hold ${config.maxHoldBars} bars — the schematic exits by then if the target is not tagged.`);
  if (showContinuation(config)) notes.push('After a new swing high the same episode can re-arm for another pullback tag.');
  const filt = filterNote(config);
  if (filt) notes.push(filt);
  notes.push(accountNote(config));

  return {
    bars,
    ema18: emas.e18,
    ema50: emas.e50,
    ema100: emas.e100,
    ema200: emas.e200,
    macd: { line, signal, hist },
    showMacd: config.macdWindow,
    phases,
    marks,
    levels,
    bands,
    title: `Textbook: ${strat?.label ?? config.strategy}`,
    caption: strat?.hint ?? '',
    notes,
  };
}
