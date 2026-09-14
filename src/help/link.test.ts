import { describe, expect, it } from 'vitest';
import { buildLinkIndex, explicitLinks, linkText, parseBody } from './link';

const index = buildLinkIndex([
  { id: 'ema', title: 'EMA', aliases: ['EMA', '50-EMA', 'exponential moving average'] },
  { id: 'ema-tag', title: 'EMA tag', aliases: ['EMA tag', '50-EMA tag'] },
  { id: 'r', title: 'R (risk unit)', aliases: ['1R'] },
  { id: 'plain', title: 'Plain' },
]);

describe('linkText', () => {
  it('links an explicit [[id]] using the topic title', () => {
    expect(linkText('see [[ema]] here', index)).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'term', topic: 'ema', text: 'EMA' },
      { kind: 'text', text: ' here' },
    ]);
  });

  it('uses the shown text of [[id|text]]', () => {
    expect(linkText('[[r|2.5R]]', index)).toEqual([{ kind: 'term', topic: 'r', text: '2.5R' }]);
  });

  it('leaves an unknown explicit link as plain text', () => {
    expect(linkText('[[nope|shown]]', index)).toEqual([{ kind: 'text', text: 'shown' }]);
  });

  it('auto-links aliases, longest first, case-insensitively', () => {
    expect(linkText('a 50-ema tag then the 50-EMA', index)).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'term', topic: 'ema-tag', text: '50-ema tag' },
      { kind: 'text', text: ' then the ' },
      { kind: 'term', topic: 'ema', text: '50-EMA' },
    ]);
  });

  it('respects word boundaries so 2.5R is not the alias 1R and EMAs is not EMA', () => {
    expect(linkText('2.5R and 11R and EMAs', index)).toEqual([{ kind: 'text', text: '2.5R and 11R and EMAs' }]);
    expect(linkText('risk 1R.', index)).toEqual([
      { kind: 'text', text: 'risk ' },
      { kind: 'term', topic: 'r', text: '1R' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('links each topic once, explicit or automatic', () => {
    expect(linkText('EMA and EMA and [[ema]]', index)).toEqual([
      { kind: 'term', topic: 'ema', text: 'EMA' },
      { kind: 'text', text: ' and EMA and EMA' },
    ]);
  });

  it('never links a topic to itself', () => {
    expect(linkText('the EMA and [[ema]]', index, { self: 'ema' })).toEqual([{ kind: 'text', text: 'the EMA and EMA' }]);
  });
});

describe('parseBody', () => {
  it('splits paragraphs and lists and shares the once-per-body rule', () => {
    const blocks = parseBody('First EMA.\n\n- one EMA\n- two [[r]]\n\nlast', index);
    expect(blocks).toEqual([
      { kind: 'p', segments: [{ kind: 'text', text: 'First ' }, { kind: 'term', topic: 'ema', text: 'EMA' }, { kind: 'text', text: '.' }] },
      { kind: 'ul', items: [
        [{ kind: 'text', text: 'one EMA' }],
        [{ kind: 'text', text: 'two ' }, { kind: 'term', topic: 'r', text: 'R (risk unit)' }],
      ] },
      { kind: 'p', segments: [{ kind: 'text', text: 'last' }] },
    ]);
  });

  it('joins wrapped lines of one paragraph', () => {
    expect(parseBody('a\nb', index)).toEqual([{ kind: 'p', segments: [{ kind: 'text', text: 'a b' }] }]);
  });
});

describe('explicitLinks', () => {
  it('lists every explicit target', () => {
    expect(explicitLinks('[[a]] x [[b|shown]] [[a]]')).toEqual(['a', 'b', 'a']);
  });
});
