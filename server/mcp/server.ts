// mcp/server.ts — the screener as an MCP server (phase E of
// `docs/cca-f-learning-plan.md`).
//
// Tools, resources and prompts over the warm universe, with no transport: the
// stdio entry point (`stdio.ts`) and the tests each connect their own.
//
// Resources and prompts go through the SDK's `McpServer` registrations. Tools do
// not: the two tool request handlers are installed on the underlying `Server`
// directly, over the definitions in `tools.ts`. `McpServer.registerTool`
// validates arguments against the Zod schema *before* the tool runs and answers
// a violation with plain text, so a model that sent a string for `limit` would
// get an error with no category and no retry flag — the one failure the
// structured-error rule most needs to cover. Owning the handler means every
// failure, validation included, leaves as `{ errorCategory, isRetryable, message }`.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Datasets } from './datasets.ts';
import { errorResult } from './errors.ts';
import { TOOLS, inputJsonSchema, runTool } from './tools.ts';
import { registerResources } from './resources.ts';
import { registerPrompts } from './prompts.ts';

export const SERVER_NAME = 'screener';

export interface ScreenerMcpOptions {
  datasets: Datasets;
  /** Called with the original error when a tool fails with `internal`. */
  onInternalError?: (err: unknown, tool: string) => void;
}

const INSTRUCTIONS = [
  'Read-only access to a stock screener: the EMA-fan screen, live strategy entries and daily bars',
  'over one market dataset at a time. Advisory only — nothing here places or can place an order.',
  'Every tool failure is JSON {errorCategory, isRetryable, message}; retry only when isRetryable',
  'is true, and an "internal" failure at most once. Term definitions are glossary://<topic> resources.',
].join(' ');

export function createScreenerMcpServer(opts: ScreenerMcpOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: '0.1.0' }, { instructions: INSTRUCTIONS });
  const ctx = { datasets: opts.datasets };

  server.server.registerCapabilities({ tools: {} });

  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: inputJsonSchema(t),
      // Every tool only reads; none reaches beyond the local datasets.
      annotations: { readOnlyHint: true, openWorldHint: false },
    })),
  }));

  server.server.setRequestHandler(CallToolRequestSchema, (request): CallToolResult => {
    const { name, arguments: args } = request.params;
    const outcome = runTool(name, args, ctx);
    if (!outcome.ok) {
      if (outcome.cause !== undefined) opts.onInternalError?.(outcome.cause, name);
      return errorResult(outcome.error);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(outcome.value) }],
      structuredContent: outcome.value as Record<string, unknown>,
    };
  });

  registerResources(server, opts.datasets);
  registerPrompts(server);
  return server;
}
