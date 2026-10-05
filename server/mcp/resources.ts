// mcp/resources.ts — reference data the model should read rather than call for.
//
// A tool is for something that has to be computed now; a resource is for
// something that already is. The help glossary and the strategy presets are
// both stable, so they are resources: a client can list them, a model can read
// one topic when it needs the meaning of "worst gap" or "R", and nothing runs.
//
//   - `glossary://<topic>` — one help card per topic, the same text the app's
//     hover cards show (`src/help/glossary.ts`), with its [[links]] rewritten as
//     glossary URIs so the model can follow them.
//   - `screener://strategies/presets` — the built-in strategies as definition
//     objects, which is also the shape `scan_signals` accepts for a custom one.
//   - `screener://datasets` — the dataset names the tools' `dataset` argument
//     accepts. Not static, but cheap, and it is what a model needs to read before
//     comparing anything across datasets.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { KIND_LABEL, TOPICS } from '../../src/help/glossary.ts';
import type { HelpTopic } from '../../src/help/glossary.ts';
import { presets } from '../../src/lib/strategy/presets.ts';
import type { Datasets } from './datasets.ts';

const LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/** One help card as Markdown, links rewritten to `glossary://` URIs. */
export function renderTopic(topic: HelpTopic): string {
  const body = topic.body.replace(LINK, (_m, id: string, shown?: string) => {
    const text = shown ?? TOPICS.get(id)?.title ?? id;
    return `${text} (glossary://${id})`;
  });
  const lines = [`# ${topic.title}`, '', `Kind: ${KIND_LABEL[topic.kind]}`, '', body];
  if (topic.related?.length) {
    lines.push('', `Related: ${topic.related.map((id) => `glossary://${id}`).join(', ')}`);
  }
  return lines.join('\n');
}

export function registerResources(server: McpServer, datasets: Datasets): void {
  server.registerResource(
    'glossary',
    new ResourceTemplate('glossary://{topic}', {
      list: () => ({
        resources: [...TOPICS.values()].map((t) => ({
          uri: `glossary://${t.id}`,
          name: t.id,
          title: t.title,
          description: `${KIND_LABEL[t.kind]} help card`,
          mimeType: 'text/markdown',
        })),
      }),
      complete: {
        topic: (value) => [...TOPICS.keys()].filter((id) => id.startsWith(value)),
      },
    }),
    {
      title: 'Screener glossary',
      description:
        'What a term in the screener means — an indicator, a fan state, a strategy step, a trade ' +
        'rule or a backtest statistic. Read glossary://r for R, glossary://fan for the EMA fan.',
      mimeType: 'text/markdown',
    },
    (uri, variables) => {
      const id = String(variables.topic);
      const topic = TOPICS.get(id);
      // The SDK turns a throw here into a protocol error naming the URI, which
      // is the right answer to a resource that does not exist.
      if (!topic) throw new Error(`no glossary topic "${id}"`);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: renderTopic(topic) }] };
    },
  );

  server.registerResource(
    'strategy-presets',
    'screener://strategies/presets',
    {
      title: 'Built-in strategies',
      description:
        'The eight built-in entry strategies as definition objects: steps, entry, stop and exit ' +
        'rules. Pass an id to scan_signals, or a modified copy as a custom strategy.',
      mimeType: 'application/json',
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(presets(), null, 2) }],
    }),
  );

  server.registerResource(
    'datasets',
    'screener://datasets',
    {
      title: 'Datasets',
      description: 'The market datasets the tools can run against, default first. Pass a name as a tool\'s dataset argument.',
      mimeType: 'application/json',
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(datasets.list(), null, 2) }],
    }),
  );
}
