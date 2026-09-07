// strategy/trade.ts — 1R trade simulation driven by an ExitSpec.
//
// Risk: the stop is set by the engine (StopSpec). Management: move the stop to
// breakeven at N R, then trail an EMA or confirmed pivot lows; or run to a hard
// R target / the 2.5R course window. MACD exit and max hold apply only when not
// trailing (max hold is also waived while the slow fan holds under a trail).
// Illustrative only — no costs, slippage, or gap handling.

import { BUNN_PENNY, BUNN_WINDOW_LO, MIN_R_FRAC, lastConfirmedPivotLow, slowFanUp, statusAt, type MacdSeries } from './primitives.ts';
import type { ExitSpec } from './types.ts';

export type FanTradeExitReason =
  | 'stop_r'
  | 'target_r'
  | 'target_window'
  | 'breakeven'
  | 'trail'
  | 'pivot_trail'
  | 'macd_window'
  | 'slow_fan_break'
  | 'fan_break'
  | 'max_hold'
  | 'end_of_data';

export interface FanSimulatedTrade {
  entryBar: number;
  exitBar: number;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  targetPrice: number;
  returnPct: number;
  realizedR: number;
  barsHeld: number;
  maxFavorablePct: number;
  maxAdversePct: number;
  exitReason: FanTradeExitReason;
  /** Calendar date of exitBar when the subject carries dates. */
  exitDate?: string | null;
}

export interface Ohlc { o: number[]; h: number[]; l: number[]; c: number[] }
export interface FanEmas { e18: number[]; e50: number[]; e100: number[]; e200: number[] }

function breakevenAt(exit: ExitSpec): number | null {
  return exit.breakevenAtR != null && exit.breakevenAtR > 0 ? exit.breakevenAtR : null;
}

export function simulateRTrade(
  bars: Ohlc,
  emas: FanEmas,
  macd: MacdSeries,
  entryBar: number,
  stopPrice: number,
  targetPrice: number,
  exit: ExitSpec,
  fillPrice?: number,
): FanSimulatedTrade | null {
  const entryPrice = fillPrice ?? bars.c[entryBar];
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  if (!(stopPrice < entryPrice)) return null;
  const rSize = entryPrice - stopPrice;
  if (rSize / entryPrice < MIN_R_FRAC) return null;
  const trailPivot = exit.trailPivot === true;
  const trailEma = trailPivot ? null : (exit.trailEma === 18 || exit.trailEma === 50 ? exit.trailEma : null);
  const trailing = trailEma != null || trailPivot;
  const windowOn = exit.targetWindow === true && !trailing;
  const exitLevel = windowOn ? entryPrice + BUNN_WINDOW_LO * rSize : targetPrice;
  if (!trailing && !(exitLevel > entryPrice)) return null;
  const fullFanExit = exit.fanExit === 'full';

  let stop = stopPrice;
  const beAt = breakevenAt(exit);
  let maxFav = 0;
  let maxAdv = 0;
  const last = bars.c.length - 1;

  for (let j = entryBar + 1; j <= last; j++) {
    maxFav = Math.max(maxFav, ((bars.h[j] - entryPrice) / entryPrice) * 100);
    maxAdv = Math.min(maxAdv, ((bars.l[j] - entryPrice) / entryPrice) * 100);

    const hitStop = bars.l[j] <= stop;
    const hitTarget = !trailing && bars.h[j] >= exitLevel;
    if (hitStop && hitTarget) {
      return finish(entryBar, j, entryPrice, stopPrice, stopPrice, targetPrice, -1, maxFav, maxAdv, 'stop_r');
    }
    if (hitStop) {
      const raised = stop > stopPrice + 1e-12;
      const reason: FanTradeExitReason = trailPivot && raised
        ? 'pivot_trail'
        : stop > entryPrice + 1e-12 ? 'trail' : Math.abs(stop - entryPrice) < 1e-12 ? 'breakeven' : 'stop_r';
      const realizedR = (stop - entryPrice) / rSize;
      return finish(entryBar, j, entryPrice, stop, stopPrice, targetPrice, realizedR, maxFav, maxAdv, reason);
    }
    if (hitTarget) {
      if (windowOn) {
        return finish(entryBar, j, entryPrice, exitLevel, stopPrice, exitLevel, BUNN_WINDOW_LO, maxFav, maxAdv, 'target_window');
      }
      return finish(entryBar, j, entryPrice, targetPrice, stopPrice, targetPrice, exit.targetR, maxFav, maxAdv, 'target_r');
    }
    if (exit.macdExit && !trailing && macd.line[j] < macd.signal[j]) {
      return finish(entryBar, j, entryPrice, bars.c[j], stopPrice, targetPrice, (bars.c[j] - entryPrice) / rSize, maxFav, maxAdv, 'macd_window');
    }
    if (fullFanExit && statusAt(emas.e18, emas.e50, emas.e100, emas.e200, j) !== 'match') {
      return finish(entryBar, j, entryPrice, bars.c[j], stopPrice, targetPrice, (bars.c[j] - entryPrice) / rSize, maxFav, maxAdv, 'fan_break');
    }
    if (!fullFanExit && !slowFanUp(emas.e50, emas.e100, emas.e200, j)) {
      return finish(entryBar, j, entryPrice, bars.c[j], stopPrice, targetPrice, (bars.c[j] - entryPrice) / rSize, maxFav, maxAdv, 'slow_fan_break');
    }
    const skipHold = trailing && slowFanUp(emas.e50, emas.e100, emas.e200, j);
    if (!skipHold && exit.maxHoldBars != null && j - entryBar >= exit.maxHoldBars) {
      return finish(entryBar, j, entryPrice, bars.c[j], stopPrice, targetPrice, (bars.c[j] - entryPrice) / rSize, maxFav, maxAdv, 'max_hold');
    }

    if (beAt != null && bars.h[j] >= entryPrice + beAt * rSize) {
      stop = Math.max(stop, entryPrice);
    }
    if (stop >= entryPrice - 1e-12 && trailEma != null) {
      const t = trailEma === 18 ? emas.e18[j] : emas.e50[j];
      if (Number.isFinite(t)) stop = Math.max(stop, t);
    }
    if (trailPivot) {
      const p = lastConfirmedPivotLow(bars.h, bars.l, j, entryBar);
      if (p != null) stop = Math.max(stop, p - BUNN_PENNY);
    }
  }

  const exitPrice = bars.c[last];
  return finish(entryBar, last, entryPrice, exitPrice, stopPrice, targetPrice, (exitPrice - entryPrice) / rSize, maxFav, maxAdv, 'end_of_data');
}

function finish(
  entryBar: number, exitBar: number, entryPrice: number, exitPrice: number,
  stopPrice: number, targetPrice: number, realizedR: number,
  maxFav: number, maxAdv: number, exitReason: FanTradeExitReason,
): FanSimulatedTrade {
  return {
    entryBar, exitBar, entryPrice, exitPrice, stopPrice, targetPrice,
    returnPct: ((exitPrice - entryPrice) / entryPrice) * 100,
    realizedR, barsHeld: exitBar - entryBar, maxFavorablePct: maxFav, maxAdversePct: maxAdv, exitReason,
  };
}
