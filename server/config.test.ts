// config.test.ts — the one validated environment surface (hardening 4.1).
//
// Two things are being pinned here. The first is that a malformed variable stops
// the boot instead of being read as a default: `PORT=eight` used to serve 8787,
// and a service on the wrong port looks healthy from the inside. The second is
// the production guard, which used to live in `universe.ts` and is now stated
// once, here, because it is a claim about the environment rather than about any
// one adapter.

import { describe, it, expect } from 'vitest';
import { loadConfig, assertDevTestAdaptersAllowed, ConfigError } from './config.ts';

const env = (extra: Partial<NodeJS.ProcessEnv> = {}) => extra as NodeJS.ProcessEnv;

describe('loadConfig defaults', () => {
  it('serves loopback:8787 at info level with no dev tools when nothing is set', () => {
    const cfg = loadConfig(env());
    expect(cfg).toMatchObject({
      nodeEnv: 'development',
      port: 8787,
      host: '127.0.0.1',
      devTools: false,
      logLevel: 'info',
      marketDataDb: null,
      marketDataDir: null,
      eodDataDir: null,
      anthropicApiKey: null,
    });
  });

  it('resolves the path variables to absolute paths', () => {
    const cfg = loadConfig(env({ MARKETDATA_DB: 'dev-market.db', MARKETDATA_DIR: '.', EOD_DATA_DIR: 'data' }));
    expect(cfg.marketDataDb?.startsWith('/')).toBe(true);
    expect(cfg.marketDataDb?.endsWith('dev-market.db')).toBe(true);
    expect(cfg.marketDataDir?.startsWith('/')).toBe(true);
    expect(cfg.eodDataDir?.endsWith('/data')).toBe(true);
  });
});

describe('loadConfig validation', () => {
  it('refuses a PORT that is not a port instead of silently serving 8787', () => {
    expect(() => loadConfig(env({ PORT: 'eight' }))).toThrow(ConfigError);
    expect(() => loadConfig(env({ PORT: 'eight' }))).toThrow(/PORT/);
    expect(() => loadConfig(env({ PORT: '0' }))).toThrow(/1-65535/);
    expect(() => loadConfig(env({ PORT: '70000' }))).toThrow(/1-65535/);
    expect(loadConfig(env({ PORT: '9090' })).port).toBe(9090);
  });

  it('reads DEV_TOOLS as an explicit opt-in and refuses anything ambiguous', () => {
    expect(loadConfig(env()).devTools).toBe(false);
    expect(loadConfig(env({ DEV_TOOLS: '0' })).devTools).toBe(false);
    expect(loadConfig(env({ DEV_TOOLS: 'false' })).devTools).toBe(false);
    expect(loadConfig(env({ DEV_TOOLS: '1' })).devTools).toBe(true);
    expect(loadConfig(env({ DEV_TOOLS: 'true' })).devTools).toBe(true);
    // `DEV_TOOLS=yes` used to mean "off", which is the wrong answer to give quietly.
    expect(() => loadConfig(env({ DEV_TOOLS: 'yes' }))).toThrow(/DEV_TOOLS/);
  });

  it('refuses an unknown LOG_LEVEL', () => {
    expect(loadConfig(env({ LOG_LEVEL: 'debug' })).logLevel).toBe('debug');
    expect(loadConfig(env({ LOG_LEVEL: 'silent' })).logLevel).toBe('silent');
    expect(() => loadConfig(env({ LOG_LEVEL: 'chatty' }))).toThrow(/LOG_LEVEL/);
  });
});

describe('ANTHROPIC_API_KEY', () => {
  const key = 'sk-ant-api03-' + 'a'.repeat(40);

  it('is optional today and accepted when it has the right shape', () => {
    expect(loadConfig(env()).anthropicApiKey).toBeNull();
    expect(loadConfig(env({ ANTHROPIC_API_KEY: key })).anthropicApiKey).toBe(key);
  });

  it('rejects a key of the wrong shape without repeating it', () => {
    const bad = 'sk-proj-not-an-anthropic-key-0123456789';
    let message = '';
    try { loadConfig(env({ ANTHROPIC_API_KEY: bad })); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/ANTHROPIC_API_KEY/);
    expect(message).not.toContain(bad);
  });

  it('accepts a short or unusual tail, because the tail is Anthropic\'s format to change', () => {
    // The check is the prefix, not a guess at the key's alphabet or length: a
    // valid key rejected at boot is a worse failure than one that fails later
    // against the real API.
    expect(loadConfig(env({ ANTHROPIC_API_KEY: 'sk-ant-x' })).anthropicApiKey).toBe('sk-ant-x');
  });

  it('keeps the key out of the loggable view, so logging the config cannot leak it', () => {
    const cfg = loadConfig(env({ ANTHROPIC_API_KEY: key }));
    const serialised = JSON.stringify(cfg);
    expect(serialised).not.toContain(key);
    expect(JSON.parse(serialised).anthropicApiKey).toBe('[set]');
  });
});

describe('production guard (SAD#8.7)', () => {
  // Both adapters behind the MarketDataProvider port are dev/test only, so there
  // is no environment in which this service may call itself production. Before
  // hardening 4.1 this lived in `universe.ts` and fired when the default provider
  // was built; it now refuses the configuration itself, which is earlier and one
  // place instead of one per entry point.
  it('refuses NODE_ENV=production outright', () => {
    expect(() => loadConfig(env({ NODE_ENV: 'production' }))).toThrow(/production/);
    expect(() => assertDevTestAdaptersAllowed('production')).toThrow(ConfigError);
  });

  it('refuses production even when a real market-data DB is configured', () => {
    // The environment is at fault, not the file — so a perfectly good DB path
    // does not buy a pass.
    expect(() => loadConfig(env({ NODE_ENV: 'production', MARKETDATA_DB: '/tmp/market.db' }))).toThrow(/production/);
  });

  it('allows every other NODE_ENV, including an unset one', () => {
    expect(() => assertDevTestAdaptersAllowed('development')).not.toThrow();
    expect(() => assertDevTestAdaptersAllowed('test')).not.toThrow();
    expect(loadConfig(env()).nodeEnv).toBe('development');
  });
});
