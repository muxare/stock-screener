// mcp/stdio.test.ts — the MCP server end to end, through the stdio transport.
//
// Spawns `server/mcp/stdio.ts` exactly as Claude Code would (a child process
// speaking JSON-RPC over stdin/stdout) and talks to it with the SDK's own
// client. That proves what the handler tests cannot: that the entry point boots,
// that nothing but protocol reaches stdout, and that tools, resources and
// prompts are all advertised and callable over the wire.
//
// The child is pinned to the synthetic dataset — no MARKETDATA_DB, DEV_TOOLS
// off so the dev pointer is ignored — and its database scan points at an empty
// directory, so the test needs no database file, no network and no API key.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = resolve(import.meta.dirname, '../..');
let client: Client;
let emptyDir: string;

beforeAll(async () => {
  emptyDir = mkdtempSync(join(tmpdir(), 'mcp-stdio-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['server/mcp/stdio.ts'],
    cwd: ROOT,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', DEV_TOOLS: '0', MARKETDATA_DB: '', MARKETDATA_DIR: emptyDir },
    stderr: 'pipe',
  });
  client = new Client({ name: 'stdio-test', version: '0.0.0' });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client?.close();
  rmSync(emptyDir, { recursive: true, force: true });
});

describe('MCP server over stdio', () => {
  it('lists the three tools, the resources and the two prompts', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_instrument', 'scan_signals', 'screen_fan']);
    expect(tools.find((t) => t.name === 'get_instrument')?.inputSchema.required).toEqual(['ticker']);

    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('screener://strategies/presets');
    expect(uris).toContain('glossary://fan');

    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['compare_strategy_across_datasets', 'explain_ticker_match']);
  });

  it('calls a tool, reads a resource and expands a prompt', async () => {
    const screen = await client.callTool({ name: 'screen_fan', arguments: { limit: 3 } });
    expect(screen.isError).toBeFalsy();
    expect(screen.structuredContent).toMatchObject({ dataset: 'synthetic', universe: 44, offset: 0 });

    const glossary = await client.readResource({ uri: 'glossary://r' });
    expect((glossary.contents[0] as { text: string }).text).toMatch(/^# /);

    const prompt = await client.getPrompt({ name: 'explain_ticker_match', arguments: { ticker: 'AAPL' } });
    expect(JSON.stringify(prompt.messages)).toMatch(/get_instrument/);
  });

  it('returns a bad ticker as a structured, non-retryable tool error', async () => {
    const res = await client.callTool({ name: 'get_instrument', arguments: { ticker: 'NOPE' } });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ errorCategory: 'unknown_ticker', isRetryable: false });
  });
});
