// mcp/datasets.ts — which market data a tool call runs against.
//
// The MCP server is its own process with its own warm universe: it does not
// reach into a running `npm run dev`, and it never swaps the dataset that
// service is serving. It boots on the same dataset the HTTP service would
// (`sourceFromConfig`: MARKETDATA_DB, else the dev pointer when DEV_TOOLS is on,
// else synthetic) and serves that as the default.
//
// A tool may also name another dataset — "compare this strategy across datasets"
// is one of the phase's canned prompts and cannot be answered otherwise. Only
// datasets the dev DB-selector would offer are openable (`listDatabases`, the
// same allow-list `/dev/databases/activate` uses), so a tool argument can never
// open an arbitrary path. A built universe of the larger databases is several
// hundred megabytes, so at most one non-default dataset is kept warm; asking for
// a third evicts the second.
//
// Every provider is wrapped so that a failure *reading* bars surfaces as
// `DatasetUnavailableError` (→ `universe_cold`, retryable) rather than as an
// anonymous throw that would be reported as our own bug.

import { basename } from 'node:path';
import { createUniverseStore, providerForSource } from '../universe.ts';
import type { DatasetSource, UniverseStore } from '../universe.ts';
import type { MarketDataProvider } from '../../src/lib/data/provider.ts';
import { listDatabases } from '../devDataset.ts';
import { DatasetUnavailableError, ToolError } from './errors.ts';

export const SYNTHETIC = 'synthetic';

/** The name a tool uses for a dataset: `synthetic`, or the database file name. */
export function datasetName(source: DatasetSource): string {
  return source.kind === 'synthetic' ? SYNTHETIC : basename(source.path);
}

function unavailable(err: unknown): DatasetUnavailableError {
  return new DatasetUnavailableError(err instanceof Error ? err.message : String(err));
}

/** Wrap a provider so read failures are told apart from engine failures. */
export function guardProvider(provider: MarketDataProvider): MarketDataProvider {
  return {
    getUniverse() {
      try { return provider.getUniverse(); } catch (err) { throw unavailable(err); }
    },
    getInstrument(ticker: string) {
      try { return provider.getInstrument(ticker); } catch (err) { throw unavailable(err); }
    },
    close() { provider.close?.(); },
  };
}

export interface DatasetInfo {
  name: string;
  /** Instrument count when known without building the universe; null otherwise. */
  instruments: number | null;
  default: boolean;
}

export interface Datasets {
  /** The datasets a tool may name, default first. */
  list(): DatasetInfo[];
  /** The store for `name`, or the default when `name` is omitted. */
  open(name?: string): { name: string; store: UniverseStore };
  close(): void;
}

/**
 * `discover` lists the non-default sources a tool may open. The default is the
 * dev DB-selector's scan; tests pass their own so they never touch the repo's
 * database files.
 */
export function createDatasets(
  primary: UniverseStore,
  discover: () => Array<{ source: DatasetSource; instruments: number | null }> = () => discoverDatabases(primary),
): Datasets {
  const primaryName = datasetName(primary.source());
  let extra: { name: string; store: UniverseStore } | null = null;

  const candidates = () => {
    const found = discover().filter((c) => datasetName(c.source) !== primaryName);
    if (primaryName !== SYNTHETIC) found.push({ source: { kind: 'synthetic' }, instruments: null });
    return found;
  };

  const list = (): DatasetInfo[] => {
    const found = discover();
    const own = found.find((c) => datasetName(c.source) === primaryName);
    return [
      { name: primaryName, instruments: own?.instruments ?? null, default: true },
      ...candidates().map((c) => ({ name: datasetName(c.source), instruments: c.instruments, default: false })),
    ];
  };

  return {
    list,
    open(name?: string) {
      if (name === undefined || name === primaryName) return { name: primaryName, store: primary };
      if (extra?.name === name) return extra;
      const hit = candidates().find((c) => datasetName(c.source) === name);
      if (!hit) {
        const known = list().map((d) => d.name).join(', ');
        throw new ToolError('invalid_input', `unknown dataset "${name}"; available: ${known}`);
      }
      let provider: MarketDataProvider;
      try { provider = providerForSource(hit.source); } catch (err) { throw unavailable(err); }
      extra?.store.close();
      extra = { name, store: createUniverseStore(guardProvider(provider), hit.source) };
      return extra;
    },
    close() {
      extra?.store.close();
      primary.close();
    },
  };
}

function discoverDatabases(store: UniverseStore): Array<{ source: DatasetSource; instruments: number | null }> {
  return listDatabases(store)
    .databases.filter((d) => d.valid)
    .map((d) => ({ source: { kind: 'sqlite', path: d.path }, instruments: d.instruments }));
}
