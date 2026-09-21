// config.ts — the one place this process reads its environment (hardening 4.1).
//
// Before this file the reads were scattered and each site had its own idea of
// what a missing or malformed value meant: `index.ts` took PORT and HOST,
// `universe.ts` took MARKETDATA_DB, DEV_TOOLS and NODE_ENV, `devImport.ts` took
// MARKETDATA_DB and EOD_DATA_DIR, `devDataset.ts` took MARKETDATA_DIR. The
// failure mode that matters is the quiet one: `Number(process.env.PORT) || 8787`
// served 8787 for `PORT=eight`, so a container booted on the wrong port and
// looked healthy. Everything below therefore validates, and an invalid value is
// a boot failure naming the variable rather than a surprise three layers down.
//
// The module-scope `config` is resolved once, at import, which is what makes the
// failure fast: nothing in the service can observe a half-valid environment.
// Callers that need a different environment (tests, and only tests) call
// `loadConfig(env)` and pass the result in explicitly.

import { resolve } from 'node:path';

// pino's levels, plus 'silent'. LOG_LEVEL is not in phase 4.1's original list of
// variables; it is here because phase 2.3 introduced a logger, and a logger you
// cannot quiet is one that gets commented out.
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// A rejected environment. Thrown at import time, so it surfaces as a boot error.
export class ConfigError extends Error {}

export interface ServerConfig {
  /** `development` when unset. `production` is refused outright — see the guard below. */
  readonly nodeEnv: string;
  readonly port: number;
  readonly host: string;
  /** DEV_TOOLS: registers the `/dev/*` plugin and honours the dev-dataset pointer. */
  readonly devTools: boolean;
  readonly logLevel: LogLevel;
  /** MARKETDATA_DB, resolved to an absolute path; null when unset. */
  readonly marketDataDb: string | null;
  /** MARKETDATA_DIR — the dev DB-selector's scan directory; null means "the repo root". */
  readonly marketDataDir: string | null;
  /** EOD_DATA_DIR — the dev import picker's browsable root; null means "work it out". */
  readonly eodDataDir: string | null;
  /** Unused until stage 3. Validated for shape only, and never logged. */
  readonly anthropicApiKey: string | null;
  /**
   * The loggable view of this config. `JSON.stringify` and pino both honour
   * `toJSON`, so logging the whole object cannot leak the API key by accident —
   * it reports whether a key is present, never the key.
   */
  toJSON(): Record<string, unknown>;
}

function required(name: string, detail: string): ConfigError {
  return new ConfigError(`${name} is invalid: ${detail}`);
}

// A port the OS will actually bind. `PORT=0` is excluded deliberately: it means
// "any free port", which is useful in a test and never what a deployment meant.
function readPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 8787;
  if (!/^\d+$/.test(raw)) throw required('PORT', `expected a whole number, got "${raw}"`);
  const port = Number(raw);
  if (port < 1 || port > 65535) throw required('PORT', `expected 1-65535, got ${port}`);
  return port;
}

// Loopback by default so the dev-tools surface is not reachable from the LAN;
// HOST=0.0.0.0 exposes it, and that has to be typed out on purpose.
function readHost(raw: string | undefined): string {
  if (raw === undefined || raw === '') return '127.0.0.1';
  if (raw.trim() !== raw) throw required('HOST', 'must not be padded with whitespace');
  return raw;
}

// An explicit opt-in, never inferred from NODE_ENV: the same entry point run
// without the flag must not expose the import surface. Anything that is neither
// clearly on nor clearly off is refused rather than read as "off" — `DEV_TOOLS=yes`
// used to mean "no", silently, which is exactly the class of bug 4.1 is for.
function readBool(name: string, raw: string | undefined): boolean {
  if (raw === undefined || raw === '' || raw === '0' || raw === 'false') return false;
  if (raw === '1' || raw === 'true') return true;
  throw required(name, `expected 1, true, 0 or false, got "${raw}"`);
}

function readLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw === '') return 'info';
  if ((LOG_LEVELS as readonly string[]).includes(raw)) return raw as LogLevel;
  throw required('LOG_LEVEL', `expected one of ${LOG_LEVELS.join(', ')}, got "${raw}"`);
}

// Paths are resolved but not probed. Existence is the adapter's business and it
// already fails fast with a better message than this file could write: a missing
// MARKETDATA_DB is reported by the SQLite reader, which knows what it wanted.
function readPath(name: string, raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  if (raw.trim() !== raw) throw required(name, 'must not be padded with whitespace');
  return resolve(raw);
}

// Prefix only, and the value never reaches the message. This deliberately checks
// less than it could: an earlier version also pinned the tail to twenty or more
// characters of `[A-Za-z0-9_-]`, which is true of every key we have seen and is
// still a guess about a format Anthropic owns and can change. The failure mode of
// guessing too much is the worse one — a valid key rejected at boot with a message
// insisting it is malformed — so the rule is `sk-ant-` followed by a non-empty,
// unspaced tail. That still catches the mistakes worth catching (an empty
// variable, an unsubstituted placeholder, a key for another vendor) and does not
// pretend to know whether the key is live. Stage 3 makes it required; today an
// absent key is simply a feature that is not wired up yet.
const ANTHROPIC_KEY_SHAPE = /^sk-ant-\S+$/;
function readAnthropicKey(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  if (!ANTHROPIC_KEY_SHAPE.test(raw)) {
    // Deliberately says nothing about what was supplied. A secret that reaches
    // one log line has left the machine, and an error message is a log line.
    throw new ConfigError(
      'ANTHROPIC_API_KEY is invalid: expected a key beginning "sk-ant-". ' +
        'The value is not shown here on purpose.',
    );
  }
  return raw;
}

// PRODUCTION GUARD (SAD#8.7), moved here from `universe.ts` by phase 4.1 so it is
// stated and tested in one place. Both adapters behind the MarketDataProvider port
// are dev/test only — the synthetic generator (SAD#8.7) and the SQLite reader
// (STORY-032) — because the licensed-vendor adapter is deferred to ADR-008
// (SAD#8.8). There is therefore no environment in which this service may claim to
// be production, and saying so at config time refuses the boot rather than letting
// demo or imported data quietly back production screening traffic.
export function assertDevTestAdaptersAllowed(nodeEnv: string): void {
  if (nodeEnv !== 'production') return;
  throw new ConfigError(
    `Refusing to boot in a production environment (NODE_ENV=production): the ` +
      `synthetic generator (SAD#8.7) and the SQLite reader (STORY-032) are the only ` +
      `market-data adapters this service has, both are dev/test only, and neither ` +
      `must ever back production screening traffic. The production adapter is ` +
      `deferred to ADR-008 (SAD#8.8).`,
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV && env.NODE_ENV !== '' ? env.NODE_ENV : 'development';
  assertDevTestAdaptersAllowed(nodeEnv);
  const anthropicApiKey = readAnthropicKey(env.ANTHROPIC_API_KEY);
  const cfg: ServerConfig = {
    nodeEnv,
    port: readPort(env.PORT),
    host: readHost(env.HOST),
    devTools: readBool('DEV_TOOLS', env.DEV_TOOLS),
    logLevel: readLogLevel(env.LOG_LEVEL),
    marketDataDb: readPath('MARKETDATA_DB', env.MARKETDATA_DB),
    marketDataDir: readPath('MARKETDATA_DIR', env.MARKETDATA_DIR),
    eodDataDir: readPath('EOD_DATA_DIR', env.EOD_DATA_DIR),
    anthropicApiKey,
    toJSON(): Record<string, unknown> {
      return {
        nodeEnv: cfg.nodeEnv,
        port: cfg.port,
        host: cfg.host,
        devTools: cfg.devTools,
        logLevel: cfg.logLevel,
        marketDataDb: cfg.marketDataDb,
        marketDataDir: cfg.marketDataDir,
        eodDataDir: cfg.eodDataDir,
        anthropicApiKey: cfg.anthropicApiKey ? '[set]' : null,
      };
    },
  };
  return cfg;
}

// The running service's configuration. Resolved at import so a bad environment
// stops the process here, before a listener exists or a database is opened.
export const config: ServerConfig = loadConfig();
