// mcp/stdio.ts — the MCP server over stdio, for Claude Code and the inspector.
//
//   npm run mcp:stdio          (or: node server/mcp/stdio.ts)
//
// The dataset is chosen exactly as the HTTP service chooses it (`config.ts`):
// MARKETDATA_DB, else the dev-dataset pointer when DEV_TOOLS is set, else the
// synthetic generator. `.mcp.json` sets DEV_TOOLS=1 so a Claude Code session
// sees whatever the dev UI last selected; the choice is read once, at boot.
//
// stdout is the protocol channel, so nothing else may write to it. That is why
// this entry point does not use `logger.ts`: the root logger writes to stdout
// (and through pino-pretty in development), and one log line there is a
// corrupted JSON-RPC stream. This one writes JSON lines to stderr, which Claude
// Code keeps as the server's log.

import { pino, destination } from 'pino';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from '../config.ts';
import { createUniverseStore, providerFromConfig, sourceFromConfig } from '../universe.ts';
import { createDatasets, guardProvider } from './datasets.ts';
import { createScreenerMcpServer } from './server.ts';

if (import.meta.main) {
  const log = pino({ level: config.logLevel, base: { svc: 'mcp' } }, destination(2));
  const source = sourceFromConfig();
  const datasets = createDatasets(createUniverseStore(guardProvider(providerFromConfig()), source));
  const server = createScreenerMcpServer({
    datasets,
    onInternalError: (err, tool) => log.error({ err, tool }, 'tool failed'),
  });

  const stop = async () => {
    await server.close();
    datasets.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  // stdin closing is how a stdio client says goodbye.
  process.stdin.on('close', () => void stop());

  await server.connect(new StdioServerTransport());
  log.info({ dataset: source.kind === 'sqlite' ? source.path : source.kind }, 'screener MCP server ready on stdio');

  // Warm the universe after the handshake rather than before it: a build of the
  // larger datasets takes a couple of seconds, and a client waiting on
  // `initialize` for that long may give up. A failure here is only logged — the
  // first tool call retries the build and reports `universe_cold` if it fails again.
  setImmediate(() => {
    try { datasets.open().store.get(); } catch (err) { log.warn({ err }, 'could not warm the universe'); }
  });
}
