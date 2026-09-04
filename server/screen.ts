// screen.ts — full-universe EMA-fan classification.
//
// Composition of `src/lib/fan.ts` over the warm universe. Not a second
// classifier: match / entering-near / none live in fan.ts.

import { screenFan } from '../src/lib/fan.ts';
import type { FanRow } from '../src/lib/fan.ts';
import type { Stock } from '../src/lib/market.ts';

export type { FanRow };

export function runFanScreen(universe: Stock[]): { matches: FanRow[]; near: FanRow[] } {
  return screenFan(universe);
}
