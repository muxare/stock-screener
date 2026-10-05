// mcp/tools.test.ts — the MCP tools through their handler layer (phase E of
// `docs/cca-f-learning-plan.md`).
//
// `runTool` is what the MCP request handler calls, minus the transport, so these
// tests pin the two things the phase is graded on: that a tool returns what the
// wrapped handler computed, and that every failure comes back as
// `{ errorCategory, isRetryable, message }` with the retry flag the plan fixes
// for its category. The universe is the synthetic dataset the other server
// tests use; nothing here opens a database file or the network.

import { describe, it, expect } from 'vitest';
import { syntheticProvider } from '../../src/lib/data/synthetic.ts';
import type { MarketDataProvider } from '../../src/lib/data/provider.ts';
import { createUniverseStore } from '../universe.ts';
import type { UniverseStore } from '../universe.ts';
import { handleScreen, handleSignals } from '../handlers.ts';
import { parseFanSignalsBody } from '../signals.ts';
import { createDatasets, guardProvider } from './datasets.ts';
import { errorResult } from './errors.ts';
import type { ToolErrorBody } from './errors.ts';
import { TOOLS, inputJsonSchema, runTool } from './tools.ts';
import type { ToolContext } from './tools.ts';

const SYNTHETIC = { kind: 'synthetic' } as const;
const provider = syntheticProvider(7);
const store = createUniverseStore(guardProvider(provider), SYNTHETIC);
const ctx: ToolContext = { datasets: createDatasets(store, () => []) };

function ok(name: string, args: unknown): Record<string, unknown> {
  const out = runTool(name, args, ctx);
  if (!out.ok) throw new Error(`expected success, got ${JSON.stringify(out.error)}`);
  return out.value as Record<string, unknown>;
}

function fail(name: string, args: unknown, context: ToolContext = ctx): ToolErrorBody {
  const out = runTool(name, args, context);
  if (out.ok) throw new Error('expected a failure');
  return out.error;
}

describe('tool definitions', () => {
  it('describes every tool for the model: when not to call it, units, an example', () => {
    expect(TOOLS.map((t) => t.name)).toEqual(['screen_fan', 'scan_signals', 'get_instrument']);
    for (const t of TOOLS) {
      expect(t.description).toMatch(/Do not/);
      expect(t.description).toMatch(/Units:/);
      expect(t.description).toMatch(/Example: \{/);
      expect(inputJsonSchema(t).type).toBe('object');
    }
  });
});

describe('screen_fan', () => {
  it('returns the handler\'s matches, paginated and without sparklines', () => {
    const want = handleScreen(store.get());
    const first = ok('screen_fan', { limit: 5 });
    expect(first).toMatchObject({
      dataset: 'synthetic',
      universe: 44,
      counts: { matches: want.matches.length, near: want.near.length },
      list: 'matches',
      total: want.matches.length,
      offset: 0,
    });
    const rows = first.rows as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.ticker)).toEqual(want.matches.slice(0, 5).map((r) => r.ticker));
    expect(rows[0]).not.toHaveProperty('sparkline');

    // Walking nextOffset visits every match exactly once.
    const seen: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const p = ok('screen_fan', { limit: 5, offset });
      seen.push(...(p.rows as Array<{ ticker: string }>).map((r) => r.ticker));
      offset = p.nextOffset as number | null;
    }
    expect(seen).toEqual(want.matches.map((r) => r.ticker));
  });

  it('filters to one ticker', () => {
    const [top] = handleScreen(store.get()).matches;
    const page = ok('screen_fan', { ticker: top.ticker });
    expect((page.rows as Array<{ ticker: string }>).map((r) => r.ticker)).toEqual([top.ticker]);
  });
});

describe('scan_signals', () => {
  it('returns the /signals handler\'s rows for a preset id', () => {
    const want = handleSignals(store.get(), parseFanSignalsBody({ strategy: 'tag50' }));
    const got = ok('scan_signals', { strategy: 'tag50', limit: 100 });
    expect(got).toMatchObject({ strategy: 'tag50', strategyName: want.strategyName, total: want.rows.length });
    expect((got.rows as Array<{ ticker: string }>).map((r) => r.ticker)).toEqual(
      want.rows.slice(0, 100).map((r) => r.ticker),
    );
  });

  it('refuses an unknown strategy as invalid_input, not retryable', () => {
    // RequestError from the shared body parser, mapped without the tool translating it.
    expect(fail('scan_signals', { strategy: 'nope' })).toEqual({
      errorCategory: 'invalid_input',
      isRetryable: false,
      message: 'unknown strategy "nope"',
    });
  });
});

describe('get_instrument', () => {
  it('returns the last N bars, oldest first', () => {
    const got = ok('get_instrument', { ticker: 'AAPL', bars: 3 });
    const full = provider.getInstrument('AAPL')!;
    expect(got.totalBars).toBe(full.bars.length);
    expect((got.bars as Array<{ c: number }>).map((b) => b.c)).toEqual(full.bars.slice(-3).map((b) => b.c));
  });

  it('answers a bad ticker with unknown_ticker, not retryable', () => {
    const err = fail('get_instrument', { ticker: 'NOPE' });
    expect(err.errorCategory).toBe('unknown_ticker');
    expect(err.isRetryable).toBe(false);
    expect(err.message).toMatch(/NOPE/);
  });
});

describe('structured errors', () => {
  it('answers a schema violation with invalid_input, not retryable', () => {
    const err = fail('screen_fan', { limit: 'ten' });
    expect(err).toMatchObject({ errorCategory: 'invalid_input', isRetryable: false });
    expect(err.message).toMatch(/limit/);
    expect(fail('get_instrument', {})).toMatchObject({ errorCategory: 'invalid_input', isRetryable: false });
    expect(fail('get_instrument', { ticker: 'AAPL', bars: 0 })).toMatchObject({ errorCategory: 'invalid_input' });
  });

  it('answers an unknown dataset or tool with invalid_input', () => {
    expect(fail('screen_fan', { dataset: 'nope.db' })).toMatchObject({ errorCategory: 'invalid_input', isRetryable: false });
    expect(fail('drop_tables', {})).toMatchObject({ errorCategory: 'invalid_input', isRetryable: false });
  });

  it('answers an unreadable dataset with universe_cold, retryable', () => {
    const broken: MarketDataProvider = {
      getUniverse() { throw new Error('database is locked'); },
      getInstrument() { throw new Error('database is locked'); },
    };
    const cold: ToolContext = { datasets: createDatasets(createUniverseStore(guardProvider(broken), SYNTHETIC), () => []) };
    for (const [name, args] of [['screen_fan', {}], ['scan_signals', { strategy: 'onset' }], ['get_instrument', { ticker: 'AAPL' }]] as const) {
      const err = fail(name, args, cold);
      expect(err).toMatchObject({ errorCategory: 'universe_cold', isRetryable: true });
      expect(err.message).toMatch(/database is locked/);
    }
  });

  it('answers our own bug with internal, retryable once, and keeps the cause for the log', () => {
    const buggy: UniverseStore = { ...store, get() { throw new TypeError('x is undefined'); } };
    const out = runTool('screen_fan', {}, { datasets: createDatasets(buggy, () => []) });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatchObject({ errorCategory: 'internal', isRetryable: true });
    expect(out.error.message).toMatch(/once/);
    expect(out.error.message).not.toMatch(/x is undefined/);
    expect(out.cause).toBeInstanceOf(TypeError);
  });

  it('carries the body as an MCP tool error, in text and structured content', () => {
    const body = fail('get_instrument', { ticker: 'NOPE' });
    const result = errorResult(body);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(body);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(body);
  });
});
