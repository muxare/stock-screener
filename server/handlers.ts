// handlers.ts — thin request handlers. Transport-agnostic: parsed request +
// warm universe → plain result. `index.ts` wraps these in HTTP/JSON.

import type { Stock } from '../src/lib/market.ts';
import { runFanScreen } from './screen.ts';
import type { FanRow } from './screen.ts';
import { runFanSignals } from './signals.ts';
import type { FanSignalRow } from './signals.ts';
import type { FanBacktestConfig } from '../src/lib/fanBacktest.ts';

export interface ScreenResponse {
  universe: number;
  elapsedMs: number;
  matches: FanRow[];
  near: FanRow[];
}

export class RequestError extends Error {}

export function handleScreen(universe: Stock[]): ScreenResponse {
  const start = performance.now();
  const { matches, near } = runFanScreen(universe);
  return {
    universe: universe.length,
    elapsedMs: performance.now() - start,
    matches,
    near,
  };
}

export interface SignalsResponse {
  universe: number;
  elapsedMs: number;
  /** Strategy id (preset or saved) and its display name. */
  strategy: string;
  strategyName: string;
  rows: FanSignalRow[];
}

export function handleSignals(universe: Stock[], config: FanBacktestConfig): SignalsResponse {
  const start = performance.now();
  const rows = runFanSignals(universe, config);
  return {
    universe: universe.length,
    elapsedMs: performance.now() - start,
    strategy: config.strategy.id,
    strategyName: config.strategy.name,
    rows,
  };
}

export interface FactsResponse {
  total: number;
  sectors: string[];
  sample: string | null;
}

export function handleFacets(universe: Stock[]): FactsResponse {
  const sectors = [...new Set(universe.map((s) => s.sector))].sort();
  return {
    total: universe.length,
    sectors,
    sample: universe.length ? universe[0].ticker : null,
  };
}
