// mcp/prompts.ts — two canned research questions.
//
// A prompt is the third MCP primitive: a template the *user* picks (in Claude
// Code they appear as `/mcp__screener__<name>`), which expands into a message
// telling the model which tools and resources to use and what an honest answer
// has to say. These two are the ones phase E names. Both carry the caveats a
// backtest reviewer would add — open entries are not performance, costs are not
// modelled — because a prompt that asks for a comparison without them invites
// exactly the encouraging wrong answer phase 6.2 of the hardening plan is about.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

function userText(text: string): GetPromptResult {
  return { messages: [{ role: 'user', content: { type: 'text', text } }] };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'compare_strategy_across_datasets',
    {
      title: 'Compare a strategy across datasets',
      description: 'Run one strategy\'s live scan on several datasets and compare what it holds on each.',
      argsSchema: {
        strategy: z.string().describe('A preset strategy id, e.g. tag50.'),
        datasets: z.string().optional().describe('Comma-separated dataset names; omit for all of them.'),
      },
    },
    ({ strategy, datasets }) => userText([
      `Compare the "${strategy}" strategy across ${datasets ? `these datasets: ${datasets}` : 'every dataset the screener has'}.`,
      '',
      '1. Read screener://datasets for the names, and screener://strategies/presets for what the strategy does.',
      `2. For each dataset, call scan_signals with {"strategy": "${strategy}", "dataset": <name>} and the same`,
      '   filters every time. Use total for the count; page only if you need the rows themselves.',
      '3. Report, per dataset: universe size, open entries (total, and as a share of the universe),',
      '   the median riskPct, and how many entries are fresh (barsAgo 0-1) versus old.',
      '4. Say what differs and the likeliest reason (history length, universe composition, market regime).',
      '',
      'Be explicit about what this cannot show: scan_signals returns trades open on the latest bar, not',
      'backtest results, so nothing here says whether the strategy makes money on any dataset.',
      'Transaction costs are not modelled, and with stops around 2.5% of price they are a large part',
      'of one R. If a tool returns universe_cold, retry once after a pause; do not retry invalid_input.',
    ].join('\n')),
  );

  server.registerPrompt(
    'explain_ticker_match',
    {
      title: 'Explain why a ticker matched',
      description: 'Explain, from its bars, why one ticker is in the EMA fan or has an open entry for a strategy.',
      argsSchema: {
        ticker: z.string().describe('The ticker, exactly as the screener lists it.'),
        strategy: z.string().optional().describe('A preset strategy id; omit to explain the fan match only.'),
        dataset: z.string().optional().describe('Dataset name; omit for the default.'),
      },
    },
    ({ ticker, strategy, dataset }) => {
      const ds = dataset ? `, "dataset": "${dataset}"` : '';
      return userText([
        `Explain why ${ticker} matched${strategy ? ` the "${strategy}" strategy` : ' the EMA-fan screen'}.`,
        '',
        `1. Call screen_fan with {"ticker": "${ticker}"${ds}}, and again with "list": "near" if the first page is`,
        '   empty, to get its fan state, EMA levels and worstGap.',
        strategy
          ? `2. Call scan_signals with {"strategy": "${strategy}", "ticker": "${ticker}"${ds}} for the entry, stop and R.` +
            '\n   Read screener://strategies/presets for the rules that strategy applies, step by step.'
          : '2. Read glossary://fan and glossary://worst-gap for what the fan classification means.',
        `3. Call get_instrument with {"ticker": "${ticker}", "bars": 60${ds}} and point at the bars that did it.`,
        '',
        'Tie every claim to a number a tool returned; read glossary://<topic> for any term you use.',
        'If the ticker did not match, say so plainly instead of explaining a match that is not there.',
        'If get_instrument returns unknown_ticker, stop and say so: retrying the same ticker cannot help.',
      ].join('\n'));
    },
  );
}
