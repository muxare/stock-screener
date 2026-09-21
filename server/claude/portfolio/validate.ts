// claude/portfolio/validate.ts — the meaning check.
//
// The schema decides whether the answer has the right shape; this file decides
// whether it could be true. The distinction matters because structured outputs
// make the first question nearly uninteresting — the API will not return a
// string where the schema says number — while leaving the second one entirely
// open. A share count of -400 validates. A GAV of 1 570 on an instrument that
// has never traded above 210 validates. Both are misreads, and both are exactly
// what a retry is for.
//
// Three checks, in the order they catch things:
//
//   1. **Arithmetic.** A number that cannot be a count or a price — negative,
//      non-finite, a fractional share count where the broker deals in whole
//      shares. Cheap, needs nothing but the row.
//   2. **Internal consistency.** Printed market value against shares × last
//      price. This is the single strongest detector of a misread digit, because
//      one wrong digit in a share count moves the product by a factor of ten and
//      the printed total does not move with it. It is not in phase C's plan text
//      — the plan named the first and third checks — and it earns its place.
//   3. **Against the market data we hold.** An average price outside the range
//      the instrument has ever traded in cannot be an average acquisition price.
//      This only fires for tickers the universe knows, which is the honest
//      limit: a holding we have no bars for is unchecked rather than doubted.
//
// Every check states which row and which rule failed, because that text is what
// the repair prompt sends back to the model.

import type { InstrumentBars } from '../../../src/lib/market.ts';
import type { Extraction, Holding } from './schema.ts';

/** What the extraction is checked against. The universe store satisfies it. */
export interface BarLookup {
  getInstrument(ticker: string): InstrumentBars | null;
}

/**
 * How far the printed market value may sit from shares × last price before the
 * row is called inconsistent. Generous on purpose: the printed value is a
 * rounded figure struck at a slightly different moment than the printed last
 * price, and intraday that gap is real. Two per cent absorbs the rounding and
 * the moment; a misread digit is off by tens or hundreds of per cent.
 */
const VALUE_TOLERANCE = 0.02;

/**
 * How far outside the instrument's all-time low/high an average price may fall
 * before it is called impossible. The band exists because the bars we hold are
 * split-adjusted and a GAV printed by the broker is not always: a 10% cushion
 * keeps an ordinary adjustment mismatch from being reported as a misread, while
 * a transposed digit is still well outside.
 */
const PRICE_BAND = 0.1;

function rowLabel(row: Holding, index: number): string {
  const named = row.ticker ?? row.name;
  return named ? `row ${index + 1} (${named})` : `row ${index + 1}`;
}

function checkRow(row: Holding, index: number, bars: BarLookup): string[] {
  const problems: string[] = [];
  const where = rowLabel(row, index);

  if (row.shares !== null) {
    if (!Number.isFinite(row.shares) || row.shares < 0) {
      problems.push(`${where}: a share count of ${row.shares} is impossible — report null if the digits are not legible`);
    } else if (!Number.isInteger(row.shares)) {
      problems.push(`${where}: a share count of ${row.shares} is not a whole number — re-read the Antal column`);
    }
  }

  for (const [field, value] of [
    ['averagePrice', row.averagePrice],
    ['lastPrice', row.lastPrice],
    ['marketValue', row.marketValue],
  ] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      problems.push(`${where}: ${field} of ${value} is impossible — report null if it is not legible`);
    }
  }

  // Internal consistency. Only when all three are present, the position is not
  // empty — a zero-share row has nothing to be consistent with — and the price
  // and the value are in the same currency.
  //
  // That last condition is the one the first real screenshot taught. Avanza
  // prints a position's value in the account's currency and its price in the
  // instrument's, so a US holding in a Swedish account shows 3 x 375.86 USD
  // beside a value of 11 097 kr, and comparing them called a perfectly-read row
  // a misread — and spent a second attempt proving it. Unknown currencies are
  // treated as comparable, because the common case is a single-currency account
  // that prints no code at all, and refusing to check those would give up the
  // most useful check in the file to avoid a rarer false positive.
  const currenciesComparable =
    row.currency === null || row.valueCurrency === null || row.currency === row.valueCurrency;
  if (
    currenciesComparable &&
    row.shares !== null && row.shares > 0 &&
    row.lastPrice !== null && row.lastPrice > 0 &&
    row.marketValue !== null && row.marketValue > 0
  ) {
    const implied = row.shares * row.lastPrice;
    const drift = Math.abs(implied - row.marketValue) / row.marketValue;
    if (drift > VALUE_TOLERANCE) {
      problems.push(
        `${where}: shares (${row.shares}) x last price (${row.lastPrice}) is ${implied.toFixed(2)}, ` +
          `but the market value reads ${row.marketValue} — one of the three digits is misread, ` +
          `or the row genuinely prints a mismatch and the note must say so`,
      );
    }
  }

  // Against the bars we hold.
  if (row.ticker && row.averagePrice !== null && row.averagePrice > 0) {
    const instrument = bars.getInstrument(row.ticker);
    if (instrument && instrument.bars.length > 0) {
      let low = Infinity;
      let high = -Infinity;
      for (const bar of instrument.bars) {
        if (bar.l < low) low = bar.l;
        if (bar.h > high) high = bar.h;
      }
      const floor = low * (1 - PRICE_BAND);
      const ceiling = high * (1 + PRICE_BAND);
      if (row.averagePrice < floor || row.averagePrice > ceiling) {
        problems.push(
          `${where}: an average price of ${row.averagePrice} is outside everything ${row.ticker} has traded at ` +
            `(${low.toFixed(2)}–${high.toFixed(2)}) — re-read the GAV column`,
        );
      }
    }
  }

  return problems;
}

/**
 * Every way this extraction could not be true, as sentences for the model.
 *
 * An empty array means the extraction passed. It does **not** mean the
 * extraction is correct: a confidently misread value that happens to be
 * arithmetically consistent passes every check here, which is why the result is
 * a proposal the user confirms and never a fact the service stores.
 */
export function validateExtraction(extraction: Extraction, bars: BarLookup): string[] {
  return extraction.holdings.flatMap((row, index) => checkRow(row, index, bars));
}
