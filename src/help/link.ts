// help/link.ts — turns a help topic's body text into renderable blocks whose
// glossary terms are marked up as nested hover targets (the "buzzwords").
//
// Two ways a term gets linked:
//   explicit  [[topic-id]] or [[topic-id|shown text]]
//   automatic any alias of a known topic, matched case-insensitively on word
//             boundaries, longest alias first, first occurrence only
//
// Pure: no DOM, no React. The card component renders the segments.

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'term'; topic: string; text: string };

export type Block =
  | { kind: 'p'; segments: Segment[] }
  | { kind: 'ul'; items: Segment[][] };

export interface LinkableTopic {
  id: string;
  title: string;
  aliases?: string[];
}

export interface LinkIndex {
  titleOf(id: string): string | undefined;
  /** Matches any alias; group 1 is the alias text. Null when nothing is aliased. */
  pattern: RegExp | null;
  topicOfAlias(alias: string): string | undefined;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildLinkIndex(topics: Iterable<LinkableTopic>): LinkIndex {
  const titles = new Map<string, string>();
  const byAlias = new Map<string, string>();
  for (const t of topics) {
    titles.set(t.id, t.title);
    for (const a of t.aliases ?? []) byAlias.set(a.toLowerCase(), t.id);
  }
  const aliases = [...byAlias.keys()].sort((a, b) => b.length - a.length);
  const pattern = aliases.length
    ? new RegExp(`(?<![\\w])(${aliases.map(escapeRe).join('|')})(?![\\w])`, 'gi')
    : null;
  return {
    titleOf: (id) => titles.get(id),
    pattern,
    topicOfAlias: (alias) => byAlias.get(alias.toLowerCase()),
  };
}

export interface LinkOptions {
  /** The topic whose body this is; it is never linked to itself. */
  self?: string;
}

const EXPLICIT = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

function pushText(out: Segment[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === 'text') last.text += text;
  else out.push({ kind: 'text', text });
}

function autoLink(out: Segment[], text: string, index: LinkIndex, seen: Set<string>, self?: string): void {
  if (!index.pattern) {
    pushText(out, text);
    return;
  }
  const re = new RegExp(index.pattern.source, index.pattern.flags);
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const topic = index.topicOfAlias(m[1]);
    if (!topic || topic === self || seen.has(topic)) continue;
    pushText(out, text.slice(at, m.index));
    out.push({ kind: 'term', topic, text: m[1] });
    seen.add(topic);
    at = m.index + m[1].length;
  }
  pushText(out, text.slice(at));
}

/** Link one run of prose. Explicit links win; aliases fill in around them. */
export function linkText(text: string, index: LinkIndex, opts: LinkOptions = {}, seen = new Set<string>()): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  const re = new RegExp(EXPLICIT.source, EXPLICIT.flags);
  for (let m = re.exec(text); m; m = re.exec(text)) {
    autoLink(out, text.slice(at, m.index), index, seen, opts.self);
    const id = m[1].trim();
    const shown = m[2]?.trim() || index.titleOf(id) || id;
    if (id === opts.self || !index.titleOf(id) || seen.has(id)) pushText(out, shown);
    else {
      out.push({ kind: 'term', topic: id, text: shown });
      seen.add(id);
    }
    at = m.index + m[0].length;
  }
  autoLink(out, text.slice(at), index, seen, opts.self);
  return out;
}

/**
 * Body → blocks. Blank lines separate blocks; a block whose lines all start
 * with "- " is a list. A topic is linked once per body, first occurrence wins.
 */
export function parseBody(body: string, index: LinkIndex, opts: LinkOptions = {}): Block[] {
  const seen = new Set<string>();
  const blocks: Block[] = [];
  for (const raw of body.trim().split(/\n\s*\n/)) {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (lines.every((l) => l.startsWith('- '))) {
      blocks.push({ kind: 'ul', items: lines.map((l) => linkText(l.slice(2), index, opts, seen)) });
    } else {
      blocks.push({ kind: 'p', segments: linkText(lines.join(' '), index, opts, seen) });
    }
  }
  return blocks;
}

/** Every topic id an explicit [[link]] in `body` points at (for validation). */
export function explicitLinks(body: string): string[] {
  const ids: string[] = [];
  const re = new RegExp(EXPLICIT.source, EXPLICIT.flags);
  for (let m = re.exec(body); m; m = re.exec(body)) ids.push(m[1].trim());
  return ids;
}
