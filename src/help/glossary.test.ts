import { describe, expect, it } from 'vitest';
import { HELP_INDEX, TOPICS, stepKindTopic, stepTopic, validateGlossary } from './glossary';
import { parseBody } from './link';
import { STEP_TYPE_IDS } from '../lib/strategy/steps';
import { PATTERNS } from '../lib/patterns';

describe('glossary', () => {
  it('has no dangling links, self links, or duplicate ids/aliases', () => {
    expect(validateGlossary()).toEqual([]);
  });

  it('has a card for every step type and kind the builder can show', () => {
    for (const type of STEP_TYPE_IDS) expect(TOPICS.has(stepTopic(type)), type).toBe(true);
    for (const kind of ['candle', 'instant', 'guard', 'tracker']) expect(TOPICS.has(stepKindTopic(kind)), kind).toBe(true);
  });

  it('has a card behind every price-action pattern the chart can draw', () => {
    for (const p of PATTERNS) expect(TOPICS.has(p.help), p.id).toBe(true);
  });

  it('every card links onward to at least one other card', () => {
    for (const t of TOPICS.values()) {
      const terms = parseBody(t.body, HELP_INDEX, { self: t.id })
        .flatMap((b) => (b.kind === 'p' ? b.segments : b.items.flat()))
        .filter((s) => s.kind === 'term');
      expect(terms.length + (t.related?.length ?? 0), t.id).toBeGreaterThan(0);
    }
  });
});
