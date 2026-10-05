// schemas.test.ts — the wire schemas and the types they describe cannot drift.
//
// Most of this file does its work in the compiler, not at run time. A route's
// handler is already checked one way by the type provider — what it returns must
// fit its response schema — but that check is one-directional: a field added to
// the engine's `FanRow` and not to `FanRowSchema` still type-checks, and the
// serialiser then strips it from the wire without a word. The equalities below
// close the other direction, so a shape changed on either side without the other
// fails `npm run typecheck` (which includes this file through the server
// program) before any test runs.

import { describe, it, expect, expectTypeOf } from 'vitest';
import type { z } from 'zod';
import type { FanRow } from '../../src/lib/fan.ts';
import type { FanSignalRow } from '../../src/lib/fanSignals.ts';
import type { FanBacktestProgress } from '../../src/lib/fanBacktest.ts';
import type { IndicatorSnapshot } from '../../src/lib/screen/snapshot.ts';
import type { InstrumentBars } from '../../src/lib/market.ts';
import type * as Handlers from '../handlers.ts';
import type { PathStats, MetricPath } from '../metrics.ts';
import type { ImportOptions, DevImportRequest, DevImportResult } from '../devImport.ts';
import type { DatabaseList, ActivateRequest, ActivateResult } from '../devDataset.ts';
import type { PortfolioExtraction } from '../claude/portfolio/extract.ts';
import type { ClaudeErrorCategory } from '../claude/errors.ts';
import { FanRowSchema, FanSignalRowSchema, IndicatorSnapshotSchema, InstrumentBarsSchema } from './rows.ts';
import type * as Screen from './screen.ts';
import { SignalsRequestSchema, BacktestRequestSchema } from './screen.ts';
import type * as System from './system.ts';
import type * as Dev from './dev.ts';
import type * as Portfolio from './portfolio.ts';
import { parseBody } from './validate.ts';
import { RequestError } from '../handlers.ts';

describe('the wire schemas match the types they describe', () => {
  it('engine rows', () => {
    expectTypeOf<z.output<typeof FanRowSchema>>().toEqualTypeOf<FanRow>();
    expectTypeOf<z.output<typeof FanSignalRowSchema>>().toEqualTypeOf<FanSignalRow>();
    expectTypeOf<z.output<typeof IndicatorSnapshotSchema>>().toEqualTypeOf<IndicatorSnapshot>();
    expectTypeOf<z.output<typeof InstrumentBarsSchema>>().toEqualTypeOf<InstrumentBars>();
  });

  it('handler results', () => {
    expectTypeOf<Screen.FactsResponse>().toEqualTypeOf<Handlers.FactsResponse>();
    expectTypeOf<Screen.ScreenResponse>().toEqualTypeOf<Handlers.ScreenResponse>();
    expectTypeOf<Screen.SignalsResponse>().toEqualTypeOf<Handlers.SignalsResponse>();
    expectTypeOf<System.MetricsResponse>().toEqualTypeOf<Record<MetricPath, PathStats>>();
    expectTypeOf<Omit<Screen.BacktestProgressLine, 'type'>>().toEqualTypeOf<FanBacktestProgress>();
  });

  it('dev tooling', () => {
    expectTypeOf<Dev.ImportOptionsResponse>().toEqualTypeOf<ImportOptions>();
    expectTypeOf<Dev.DevImportRequest>().toEqualTypeOf<DevImportRequest>();
    expectTypeOf<Dev.DevImportResponse>().toEqualTypeOf<DevImportResult>();
    expectTypeOf<Dev.DatabasesResponse>().toEqualTypeOf<DatabaseList>();
    expectTypeOf<Dev.ActivateRequest>().toEqualTypeOf<ActivateRequest>();
    expectTypeOf<Dev.ActivateResponse>().toEqualTypeOf<ActivateResult>();
  });

  it('the portfolio reader', () => {
    expectTypeOf<Portfolio.ExtractResponse>().toEqualTypeOf<PortfolioExtraction>();
    type Category = NonNullable<z.output<typeof Portfolio.PortfolioErrorResponseSchema>['errorCategory']>;
    expectTypeOf<Category>().toEqualTypeOf<ClaudeErrorCategory>();
  });
});

describe('request schemas check shape and leave meaning to the parsers', () => {
  it('refuses a wrong type with the field named, rather than defaulting it', () => {
    expect(() => parseBody(BacktestRequestSchema, { minAvgVol: 'lots' })).toThrowError(
      new RequestError('minAvgVol: Invalid input: expected number, received string'),
    );
    expect(() => parseBody(BacktestRequestSchema, { horizons: [5, 'x'] })).toThrowError(/^horizons\.1: /);
  });

  it('keeps the old wording for an absent strategy', () => {
    expect(() => parseBody(SignalsRequestSchema, {})).toThrowError(new RequestError('unknown or missing strategy'));
  });

  it('accepts what the parsers used to default — out-of-range numbers and nulls', () => {
    // A negative floor or an emptied input (NaN, sent as null) is meaning, not
    // shape: the config builders default it, as the hand-written parsers did.
    const body = parseBody(BacktestRequestSchema, { minAvgVol: -5, startCash: null, riskPct: 500 });
    expect(body).toEqual({ minAvgVol: -5, startCash: null, riskPct: 500 });
  });

  it('passes an unknown preset or an empty step list through to the strategy parser', () => {
    expect(parseBody(SignalsRequestSchema, { strategy: 'nope' }).strategy).toBe('nope');
    expect(parseBody(SignalsRequestSchema, { strategy: { steps: [] } }).strategy).toEqual({ steps: [] });
  });
});
