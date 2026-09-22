// score.test.ts — the arithmetic, pinned down without a key and without a cent.
//
// This is the test phase D's plan asks for by name: the scorer is the part of the
// harness most likely to be quietly wrong, because a scoring bug does not crash,
// it just reports a number that is not the number. Every case below is
// hand-computed in the assertion — where a figure like 15/16 appears, the
// comment says where the 16 came from — so a change in the scoring rules has to
// change a stated denominator rather than a mysterious constant.
//
// The fixtures here are invented in this file, not read from `fixtures/`. The
// scorer takes extractions as arguments and touches no filesystem, and an
// arithmetic test that depended on a rendered PNG would be neither fast nor
// keyless nor honest about what it covers.
//
// `report.ts` is covered here too rather than in a file of its own. It is a pure
// function over the same data structures, its whole contract is "what may reach a
// terminal", and that contract is only meaningful next to the scorer that decides
// what the numbers are.

import { describe, it, expect } from 'vitest';
import type { Extraction, Holding } from '../portfolio/schema.ts';
import { renderReport } from './report.ts';
import {
  CONFIDENCE_VALUE,
  FLOORS,
  SCORED_FIELDS,
  checkFloors,
  matchRows,
  ratesOf,
  scoreCase,
  scoreRun,
  sumTotals,
} from './score.ts';
import type { CaseResult, Totals } from './score.ts';

const holding = (over: Partial<Holding> = {}): Holding => ({
  ticker: 'AAA',
  name: 'Alpha AB',
  shares: 100,
  averagePrice: 12.5,
  lastPrice: 15,
  marketValue: 1500,
  currency: 'SEK',
  valueCurrency: 'SEK',
  confidence: 'high',
  note: null,
  ...over,
});

/** Every scored field null, which is what an illegible row must look like. */
const blankRow = (confidence: Holding['confidence'] = 'low'): Holding => ({
  ticker: null,
  name: null,
  shares: null,
  averagePrice: null,
  lastPrice: null,
  marketValue: null,
  currency: null,
  valueCurrency: null,
  confidence,
  note: 'the whole row is illegible',
});

const doc = (holdings: Holding[], warnings: string[] = []): Extraction => ({
  accountLabel: 'ISK',
  holdings,
  warnings,
});

const result = (over: Partial<CaseResult> = {}): CaseResult => ({
  id: 'case',
  mode: 'exact',
  expected: doc([holding()]),
  actual: doc([holding()]),
  attempts: 1,
  problems: [],
  ...over,
});

const FIELDS = SCORED_FIELDS.length; // eight, and the tests say so out loud

describe('SCORED_FIELDS', () => {
  it('scores the facts and not the model’s opinion of them', () => {
    // `confidence` is what the wrong-field statistic is measured *against*, so
    // scoring it as a fact would be circular; `note` is free prose.
    expect(SCORED_FIELDS).not.toContain('confidence');
    expect(SCORED_FIELDS).not.toContain('note');
    expect(FIELDS).toBe(8);
  });
});

describe('matchRows', () => {
  it('matches on ticker even when the rows arrive in a different order', () => {
    const expected = [holding({ ticker: 'AAA' }), holding({ ticker: 'BBB', name: 'Beta AB' })];
    const actual = [holding({ ticker: 'BBB', name: 'Beta AB' }), holding({ ticker: 'AAA' })];
    const match = matchRows(expected, actual);
    expect(match.pairs).toEqual([[0, 1], [1, 0]]);
    expect(match.missing).toEqual([]);
    expect(match.spurious).toEqual([]);
  });

  it('falls back to the name when the screenshot printed no ticker', () => {
    const expected = [holding({ ticker: null, name: 'Investor B' })];
    const actual = [holding({ ticker: null, name: 'investor  b' })]; // case and spacing normalised
    expect(matchRows(expected, actual).pairs).toEqual([[0, 0]]);
  });

  it('prefers a ticker match over a name match that would consume the same row', () => {
    // Expected row 0 would match actual row 1 by name if names were tried first;
    // the ticker pass claims actual row 1 for expected row 1 instead, leaving the
    // pairing that makes both rows scoreable.
    const expected = [holding({ ticker: 'XXX', name: 'Shared Name' }), holding({ ticker: 'YYY', name: 'Shared Name' })];
    const actual = [holding({ ticker: 'YYY', name: 'Shared Name' }), holding({ ticker: 'XXX', name: 'Shared Name' })];
    expect(matchRows(expected, actual).pairs).toEqual([[0, 1], [1, 0]]);
  });

  it('reports an unmatched expected row as missing and an unmatched actual row as spurious', () => {
    const expected = [holding({ ticker: 'AAA' }), holding({ ticker: 'BBB', name: 'Beta AB' })];
    const actual = [holding({ ticker: 'AAA' }), holding({ ticker: 'CCC', name: 'Gamma AB' })];
    const match = matchRows(expected, actual);
    expect(match.pairs).toEqual([[0, 0]]);
    expect(match.missing).toEqual([1]);
    expect(match.spurious).toEqual([1]);
  });

  it('never matches a row with no ticker and no name', () => {
    const match = matchRows([blankRow()], [blankRow()]);
    expect(match.pairs).toEqual([]);
    expect(match.missing).toEqual([0]);
    expect(match.spurious).toEqual([0]);
  });

  it('does not fall back on index alignment when one row is dropped', () => {
    // The regression this whole function exists for: drop the middle row and a
    // positional scorer reports two mismatches instead of one miss.
    const expected = ['AAA', 'BBB', 'CCC'].map((ticker) => holding({ ticker, name: `${ticker} AB` }));
    const actual = [expected[0], expected[2]];
    const match = matchRows(expected, actual);
    expect(match.pairs).toEqual([[0, 0], [2, 1]]);
    expect(match.missing).toEqual([1]);
  });
});

describe('scoreCase — exact mode', () => {
  it('scores a perfect single-row case as clean', () => {
    const score = scoreCase(result());
    expect(score.failures).toEqual([]);
    expect(score.passedCases).toBe(1);
    expect(score.exactRows).toBe(1);
    expect(score.fieldsCompared).toBe(FIELDS);
    expect(score.fieldsCorrect).toBe(FIELDS);
    expect(ratesOf(score).exactMatchRate).toBe(1);
    expect(ratesOf(score).fieldAccuracy).toBe(1);
    // Nothing was wrong, so there is no confidence to average.
    expect(ratesOf(score).meanConfidenceOnWrongFields).toBeNull();
  });

  it('counts one wrong field, not one wrong row', () => {
    const score = scoreCase(result({ actual: doc([holding({ shares: 101 })]) }));
    expect(score.matchedRows).toBe(1);
    expect(score.exactRows).toBe(0);
    expect(score.fieldsCorrect).toBe(FIELDS - 1); // seven of eight
    expect(score.misses).toEqual([{ row: 1, field: 'shares', kind: 'mismatch' }]);
    expect(ratesOf(score).fieldAccuracy).toBeCloseTo(7 / 8, 10);
    expect(score.failures).toEqual(['1 matched row(s) with at least one wrong field']);
  });

  it('distinguishes a refusal from an invention', () => {
    const refused = scoreCase(result({ actual: doc([holding({ shares: null })]) }));
    expect(refused.misses[0].kind).toBe('refused');
    const invented = scoreCase(
      result({
        expected: doc([holding({ ticker: null })]),
        actual: doc([holding({ ticker: 'AAA' })]),
      }),
    );
    // The rows still match by name, so this is one invented field and not a
    // missing row plus a spurious one.
    expect(invented.matchedRows).toBe(1);
    expect(invented.misses).toEqual([{ row: 1, field: 'ticker', kind: 'invented' }]);
  });

  it('charges a dropped row eight wrong fields so dropping rows cannot raise accuracy', () => {
    const expected = doc([holding({ ticker: 'AAA' }), holding({ ticker: 'BBB', name: 'Beta AB' })]);
    const score = scoreCase(result({ expected, actual: doc([holding({ ticker: 'AAA' })]) }));
    expect(score.missingRows).toBe(1);
    expect(score.fieldsCompared).toBe(2 * FIELDS); // sixteen: one matched row plus one dropped
    expect(score.fieldsCorrect).toBe(FIELDS); // the eight that were returned and right
    expect(ratesOf(score).fieldAccuracy).toBe(0.5);
    expect(ratesOf(score).exactMatchRate).toBe(0.5); // one of two expected rows perfect
    expect(score.misses.filter((m) => m.kind === 'missing-row')).toHaveLength(FIELDS);
  });

  it('charges an invented row eight wrong fields as well', () => {
    const score = scoreCase(
      result({ actual: doc([holding(), holding({ ticker: 'ZZZ', name: 'Omega AB', confidence: 'high' })]) }),
    );
    expect(score.spuriousRows).toBe(1);
    expect(score.fieldsCompared).toBe(2 * FIELDS);
    expect(score.fieldsCorrect).toBe(FIELDS);
    // An invented row at high confidence drags the wrong-field confidence to 1.
    expect(ratesOf(score).meanConfidenceOnWrongFields).toBe(CONFIDENCE_VALUE.high);
    expect(score.failures).toEqual(['1 row(s) returned that no expected row matches']);
  });

  it('averages confidence over wrong fields, weighted by how many each row got wrong', () => {
    // Row one is wrong in one field at high confidence; row two is wrong in two
    // fields at low confidence. The mean is (1 + 0 + 0) / 3.
    const expected = doc([
      holding({ ticker: 'AAA' }),
      holding({ ticker: 'BBB', name: 'Beta AB', shares: 50, lastPrice: 20, marketValue: 1000 }),
    ]);
    const actual = doc([
      holding({ ticker: 'AAA', shares: 999 }),
      holding({ ticker: 'BBB', name: 'Beta AB', shares: 51, lastPrice: 21, marketValue: 1000, confidence: 'low' }),
    ]);
    const score = scoreCase(result({ expected, actual }));
    expect(score.wrongFieldsWithConfidence).toBe(3);
    expect(ratesOf(score).meanConfidenceOnWrongFields).toBeCloseTo(1 / 3, 10);
  });

  it('charges a wrong field to conf@wrong only when the model filled it in', () => {
    // The uniform rule, stated on CONFIDENCE_VALUE: a refusal is a wrong field
    // and contributes nothing, because the statistic asks how confident the model
    // was in the *values* it got wrong. Here one field is refused and one is
    // misread, so the denominator is 1 and not 2.
    const score = scoreCase(
      result({
        actual: doc([holding({ shares: null, lastPrice: 99, confidence: 'high' })]),
      }),
    );
    expect(score.misses.map((m) => m.kind)).toEqual(['refused', 'mismatch']);
    expect(score.wrongFieldsWithConfidence).toBe(1);
    expect(ratesOf(score).meanConfidenceOnWrongFields).toBe(1);
  });

  it('applies that same rule to a spurious row, which used to charge all eight', () => {
    // An invented row with six of its eight fields null charges two, not eight.
    // Before this rule an `exact`-mode spurious row charged every cell while an
    // `all-null` fabrication charged only the filled ones, so conf@wrong moved
    // when a failure changed mode rather than when confidence changed.
    const spurious = holding({
      ticker: 'ZZZ',
      name: 'Omega AB',
      shares: null,
      averagePrice: null,
      lastPrice: null,
      marketValue: null,
      currency: null,
      valueCurrency: null,
      confidence: 'high',
    });
    const score = scoreCase(result({ actual: doc([holding(), spurious]) }));
    expect(score.spuriousRows).toBe(1);
    // All eight still count as wrong fields for accuracy…
    expect(score.misses.filter((m) => m.kind === 'spurious-row')).toHaveLength(FIELDS);
    // …but only the two the model actually filled in reach conf@wrong.
    expect(score.wrongFieldsWithConfidence).toBe(2);
  });

  it('treats a float that survived a JSON round trip as the same reading', () => {
    const score = scoreCase(
      result({
        expected: doc([holding({ marketValue: 1234.5 })]),
        actual: doc([holding({ marketValue: 1234.5 + 1e-12 })]),
      }),
    );
    expect(score.exactRows).toBe(1);
  });

  it('does not forgive a transposed digit', () => {
    const score = scoreCase(
      result({
        expected: doc([holding({ marketValue: 1234.5 })]),
        actual: doc([holding({ marketValue: 1243.5 })]),
      }),
    );
    expect(score.exactRows).toBe(0);
  });

  it('counts the confidence distribution over the rows the model returned', () => {
    // The calibration signal for `mild-blur`, which scores identically to the
    // clean fixture by construction and can only be told apart by this.
    const score = scoreCase(
      result({
        expected: doc([holding({ ticker: 'AAA' }), holding({ ticker: 'BBB', name: 'Beta AB' })]),
        actual: doc([
          holding({ ticker: 'AAA', confidence: 'medium' }),
          holding({ ticker: 'BBB', name: 'Beta AB', confidence: 'low' }),
        ]),
      }),
    );
    expect(score.exactRows).toBe(2); // every value right…
    expect([score.highConfidenceRows, score.mediumConfidenceRows, score.lowConfidenceRows]).toEqual([0, 1, 1]);
    expect(ratesOf(score).mediumConfidenceRate).toBe(0.5);
    expect(ratesOf(score).highConfidenceRate).toBe(0);
  });

  it('counts nulls over the rows the model returned, whatever the mode', () => {
    const score = scoreCase(result({ actual: doc([holding({ shares: null, lastPrice: null })]) }));
    expect(score.actualFields).toBe(FIELDS);
    expect(score.nullFields).toBe(2);
    expect(ratesOf(score).nullRate).toBe(0.25);
  });
});

describe('scoreCase — all-null mode', () => {
  const allNull = (holdings: Holding[]) =>
    result({ mode: 'all-null', expected: doc([]), actual: doc(holdings), id: 'unreadable' });

  it('passes when every field is null at low confidence, whatever the row count', () => {
    const score = scoreCase(allNull([blankRow(), blankRow(), blankRow(), blankRow()]));
    expect(score.failures).toEqual([]);
    expect(score.fabricatedFields).toBe(0);
    expect(ratesOf(score).nullRate).toBe(1);
    expect(ratesOf(score).lowConfidenceRate).toBe(1);
    expect(score.vacuousCases).toBe(0);
  });

  it('accepts zero rows when a warning says why, since the row count is not asserted', () => {
    const score = scoreCase(
      result({ mode: 'all-null', expected: doc([]), actual: doc([], ['every column is illegible']) }),
    );
    expect(score.failures).toEqual([]);
    expect(score.vacuousCases).toBe(0);
  });

  it('refuses the vacuous answer: no rows and no warning is not a refusal', () => {
    // The exploit this closes. With no rows at all, nullRate and
    // lowConfidenceRate have no denominator and fabricatedFields is zero, so a
    // model that returned nothing used to score a clean pass on the one mode
    // whose whole job is to catch invention.
    const score = scoreCase(allNull([]));
    expect(score.vacuousCases).toBe(1);
    expect(score.failures).toEqual(['no rows and no warning: nothing was refused and nothing was said']);
    expect(ratesOf(score).nullRate).toBeNull();
    expect(ratesOf(score).lowConfidenceRate).toBeNull();
  });

  it('does not compare fields, so an all-null case cannot move field accuracy', () => {
    const score = scoreCase(allNull([blankRow()]));
    expect(score.fieldsCompared).toBe(0);
    expect(ratesOf(score).fieldAccuracy).toBeNull();
    expect(ratesOf(score).exactMatchRate).toBeNull();
  });

  it('reports every filled-in field as a fabrication and carries its confidence', () => {
    const score = scoreCase(allNull([{ ...blankRow(), shares: 100, confidence: 'high' }]));
    expect(score.fabricatedFields).toBe(1);
    expect(score.misses).toEqual([{ row: 1, field: 'shares', kind: 'invented' }]);
    expect(ratesOf(score).meanConfidenceOnWrongFields).toBe(1);
    expect(score.failures).toContain('1 field(s) filled in where the image is illegible');
  });

  it('fails a row that refused to guess but still claimed to be sure', () => {
    const score = scoreCase(allNull([blankRow('high')]));
    expect(score.fabricatedFields).toBe(0);
    expect(score.failures).toEqual(['1 row(s) not reported at low confidence']);
    expect(ratesOf(score).lowConfidenceRate).toBe(0);
  });
});

describe('scoreCase — empty mode', () => {
  const empty = (holdings: Holding[], warnings: string[]) =>
    result({ mode: 'empty', expected: doc([]), actual: doc(holdings, warnings), id: 'not-holdings' });

  it('passes on no rows and a warning that says what the image is', () => {
    const score = scoreCase(empty([], ['this is a price chart, not a holdings table']));
    expect(score.failures).toEqual([]);
    expect(score.spuriousRows).toBe(0);
  });

  it('fails on silence, because a blank table with no reason is not an answer', () => {
    expect(scoreCase(empty([], [])).failures).toEqual(['no warning naming what the image shows']);
  });

  it('fails on any invented holding and records its confidence', () => {
    const score = scoreCase(empty([holding({ confidence: 'medium' })], ['looks like a chart']));
    expect(score.spuriousRows).toBe(1);
    expect(score.misses).toHaveLength(FIELDS);
    expect(ratesOf(score).meanConfidenceOnWrongFields).toBe(CONFIDENCE_VALUE.medium);
    expect(score.failures).toEqual([
      '1 holding(s) returned for an image that is not a holdings table',
    ]);
  });
});

describe('scoreRun and sumTotals', () => {
  it('groups by mode and adds every countable field', () => {
    const run = scoreRun([
      result({ id: 'a', attempts: 1 }),
      result({ id: 'b', attempts: 2, problems: ['a row does not multiply out'] }),
      result({ id: 'c', mode: 'empty', expected: doc([]), actual: doc([], ['a chart']) }),
    ]);
    expect(run.cases.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(run.byMode.exact?.cases).toBe(2);
    expect(run.byMode.empty?.cases).toBe(1);
    expect(run.byMode['all-null']).toBeUndefined(); // a mode the run did not contain
    expect(run.overall.cases).toBe(3);
    expect(run.overall.attempts).toBe(4);
    expect(run.overall.problems).toBe(1);
    expect(ratesOf(run.overall).meanAttempts).toBeCloseTo(4 / 3, 10);
  });

  it('adds nothing when there is nothing to add', () => {
    const zero: Totals = sumTotals([]);
    expect(zero.cases).toBe(0);
    expect(ratesOf(zero).fieldAccuracy).toBeNull();
    expect(ratesOf(zero).meanAttempts).toBeNull();
  });
});

describe('checkFloors', () => {
  it('is quiet on a clean run', () => {
    const run = scoreRun([
      result({ id: 'exact-1' }),
      result({ id: 'unreadable', mode: 'all-null', expected: doc([]), actual: doc([blankRow()]) }),
      result({ id: 'not-holdings', mode: 'empty', expected: doc([]), actual: doc([], ['a chart']) }),
    ]);
    expect(checkFloors(run)).toEqual([]);
  });

  it('names the mode, the rate and the floor it missed', () => {
    // Two expected rows, one returned: exact-match rate 0.5, field accuracy 0.5,
    // both under their floors of 0.8 and 0.95.
    const run = scoreRun([
      result({
        id: 'exact-1',
        expected: doc([holding({ ticker: 'AAA' }), holding({ ticker: 'BBB', name: 'Beta AB' })]),
        actual: doc([holding({ ticker: 'AAA' })]),
      }),
    ]);
    const violations = checkFloors(run);
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain('exact: exactMatchRate 0.500');
    expect(violations[0]).toContain('floor of 0.800');
    expect(violations[1]).toContain('exact: fieldAccuracy 0.500');
  });

  it('treats a spurious row as categorical rather than as a rate', () => {
    // Field accuracy here is 8/16 = 0.5, so two floors fail; the point of the
    // assertion is that the spurious row is reported as a count, not a percentage.
    const run = scoreRun([
      result({ id: 'exact-1', actual: doc([holding(), holding({ ticker: 'ZZZ', name: 'Omega AB' })]) }),
    ]);
    expect(checkFloors(run)).toContain('exact: 1 spurious row(s), at most 0 allowed');
  });

  it('fails an empty case that invented a row, through the categorical pass rate', () => {
    const run = scoreRun([
      result({ id: 'not-holdings', mode: 'empty', expected: doc([]), actual: doc([holding()], ['a chart']) }),
    ]);
    expect(checkFloors(run)).toContain('empty: passRate 0.000 is below the floor of 1.000');
  });

  it('tolerates one fabricated field on an illegible image and refuses two', () => {
    const allNullRun = (rows: Holding[]) =>
      scoreRun([result({ id: 'unreadable', mode: 'all-null', expected: doc([]), actual: doc(rows) })]);

    expect(checkFloors(allNullRun([{ ...blankRow(), shares: 100 }]))).toEqual([]);
    expect(checkFloors(allNullRun([{ ...blankRow(), shares: 100, currency: 'SEK' }]))).toEqual([
      'all-null: 2 fabricated field(s) on an illegible image, at most 1 allowed',
    ]);
  });

  it('holds that tolerance steady however many rows the model returned', () => {
    // The regression the count floor exists for. As a null rate of 0.95 this was
    // not one bar but several: one fabricated field is 31/32 = 0.969 and passes
    // with four rows returned, while the same single fabrication is 15/16 =
    // 0.9375 and fails with two — and `all-null` is the one mode documented not
    // to assert a row count at all.
    const oneFabrication = (rowCount: number) => {
      const rows = Array.from({ length: rowCount }, () => blankRow());
      rows[0] = { ...rows[0], shares: 100 };
      return scoreRun([
        result({ id: 'unreadable', mode: 'all-null', expected: doc([]), actual: doc(rows) }),
      ]);
    };
    for (const rowCount of [1, 2, 4, 8]) {
      const run = oneFabrication(rowCount);
      expect(run.overall.fabricatedFields).toBe(1);
      expect(checkFloors(run), `${rowCount} row(s) returned`).toEqual([]);
    }
    // And the null rate that used to be asserted does move with the row count,
    // which is exactly why it was the wrong instrument.
    expect(ratesOf(oneFabrication(1).overall).nullRate).toBeCloseTo(7 / 8, 10);
    expect(ratesOf(oneFabrication(4).overall).nullRate).toBeCloseTo(31 / 32, 10);
  });

  it('still reports the null rate even though nothing asserts it', () => {
    const run = scoreRun([
      result({
        id: 'unreadable',
        mode: 'all-null',
        expected: doc([]),
        actual: doc([{ ...blankRow(), shares: 100 }]),
      }),
    ]);
    expect(ratesOf(run.overall).nullRate).toBeCloseTo(7 / 8, 10);
    expect(renderReport(run)).toContain('87.5%');
  });

  it('ignores a rate whose denominator is zero, but not a vacuous answer', () => {
    // An all-null case with no rows has no confidence rate to take and nothing
    // it could have fabricated, so those floors are correctly silent — and the
    // vacuity floor is what stops that silence from being a pass.
    const run = scoreRun([
      result({ id: 'unreadable', mode: 'all-null', expected: doc([]), actual: doc([]) }),
    ]);
    expect(checkFloors(run)).toEqual([
      'all-null: 1 case(s) answered with no rows and no warning, at most 0 allowed',
    ]);
  });

  it('is silent on an all-null case that answered with a warning instead of rows', () => {
    const run = scoreRun([
      result({ id: 'unreadable', mode: 'all-null', expected: doc([]), actual: doc([], ['illegible']) }),
    ]);
    expect(checkFloors(run)).toEqual([]);
  });

  it('takes the floors as an argument so a stricter set can be checked against a run', () => {
    const run = scoreRun([result({ id: 'exact-1' })]);
    expect(checkFloors(run, { ...FLOORS, exact: { ...FLOORS.exact, fieldAccuracy: 1.1 } })).toHaveLength(1);
  });
});

describe('renderReport', () => {
  /** A run with one of everything that can go wrong. */
  const messyRun = () =>
    scoreRun([
      result({ id: 'four-positions-sek' }),
      result({
        id: 'mixed-currency',
        expected: doc([holding({ ticker: 'AAA' }), holding({ ticker: 'BBB', name: 'Beta AB' })]),
        actual: doc([holding({ ticker: 'AAA', shares: 999 }), holding({ ticker: 'ZZZ', name: 'Omega AB' })]),
        attempts: 2,
        problems: ['row 2 does not multiply out'],
      }),
      result({ id: 'unreadable', mode: 'all-null', expected: doc([]), actual: doc([blankRow()]) }),
      result({ id: 'not-holdings', mode: 'empty', expected: doc([]), actual: doc([], ['a price chart']) }),
    ]);

  it('prints no value that was read off an image', () => {
    // The rule from `.claude/rules/claude.md`: counts, categories and ids reach a
    // terminal; holdings never do. The fixtures here are invented, so this test is
    // not protecting a secret — it is protecting the habit, because this renderer
    // is what someone will reach for the first time they score a real account.
    const text = renderReport(messyRun(), { violations: checkFloors(messyRun()) });
    for (const leak of ['Alpha AB', 'Beta AB', 'Omega AB', 'AAA', 'BBB', 'ZZZ', 'ISK', '999', '12.5', '1500']) {
      expect(text, `the report printed ${leak}`).not.toContain(leak);
    }
  });

  it('names every case, its mode and the aggregate', () => {
    const text = renderReport(messyRun());
    for (const id of ['four-positions-sek', 'mixed-currency', 'unreadable', 'not-holdings']) {
      expect(text).toContain(id);
    }
    expect(text).toContain('all exact');
    expect(text).toContain('ALL CASES');
    expect(text).toContain('3/4 cases clean');
  });

  it('keeps a missing expected row and a spurious returned row apart', () => {
    // Both are "row 2" in their own array, and an earlier version collapsed them
    // into one line, hiding one failure behind the other.
    const text = renderReport(messyRun());
    expect(text).toContain('expected row 2: not returned');
    expect(text).toContain('returned row 2: no expected counterpart');
    expect(text).toContain('row 1: shares (mismatch)');
  });

  it('says which variant produced the numbers', () => {
    expect(renderReport(messyRun())).toContain('production prompt');
    expect(renderReport(messyRun(), { variant: 'WEAKENED prompt' })).toContain('WEAKENED prompt');
  });

  it('lists the floors that were missed, or says every floor was met', () => {
    const clean = scoreRun([result({ id: 'four-positions-sek' })]);
    expect(renderReport(clean, { violations: [] })).toContain('Every floor met.');
    const text = renderReport(messyRun(), { violations: checkFloors(messyRun()) });
    expect(text).toContain('FLOORS NOT MET:');
    expect(text).toContain('exactMatchRate');
  });

  it('truncates a long miss list rather than printing a wall of fields', () => {
    const wide = scoreRun([
      result({
        id: 'exact-1',
        expected: doc([holding({ ticker: 'AAA' }), holding({ ticker: 'BBB', name: 'Beta AB' })]),
        actual: doc([]),
      }),
    ]);
    const text = renderReport(wide, { maxMissLines: 1 });
    expect(text).toContain('… and 1 more');
  });

  it('sorts whole-row failures numerically, not as strings', () => {
    // "expected row 10" must not list before "expected row 2".
    const expected = doc(
      Array.from({ length: 12 }, (_, i) => holding({ ticker: `T${i}`, name: `Name ${i}` })),
    );
    const run = scoreRun([result({ id: 'exact-1', expected, actual: doc([]) })]);
    const text = renderReport(run, { maxMissLines: 20 });
    const rows = [...text.matchAll(/expected row (\d+): not returned/g)].map((m) => Number(m[1]));
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(rows.slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('shows the confidence distribution so a calibration change is visible', () => {
    // Two runs that read every value correctly, differing only in how sure the
    // model said it was. Without this column their reports are identical.
    const confident = scoreRun([result({ id: 'mild-blur' })]);
    const hesitant = scoreRun([
      result({ id: 'mild-blur', actual: doc([holding({ confidence: 'low' })]) }),
    ]);
    expect(confident.cases[0].exactRows).toBe(hesitant.cases[0].exactRows);
    expect(renderReport(confident)).toContain('1/0/0');
    expect(renderReport(hesitant)).toContain('0/0/1');
    expect(renderReport(confident)).not.toEqual(renderReport(hesitant));
  });

  it('calls out a case that never answered, above the scoring detail', () => {
    const run = scoreRun([
      result({ id: 'four-positions-sek' }),
      result({
        id: 'mixed-currency',
        expected: doc([holding({ ticker: 'AAA' })]),
        actual: doc([]),
        attempts: 0,
        error: 'rate_limited',
      }),
    ]);
    const text = renderReport(run, { violations: checkFloors(run) });
    expect(text).toContain('cases that never produced an answer');
    expect(text).toContain('mixed-currency: rate_limited');
    expect(text).toContain('ERROR');
    expect(text).toContain('1 case(s) with no answer at all.');
    // And the case that did answer is still scored and printed.
    expect(text).toContain('four-positions-sek');
    expect(text).toContain('pass');
  });

  it('prints a dash rather than NaN where a rate has no denominator', () => {
    const text = renderReport(scoreRun([result({ id: 'not-holdings', mode: 'empty', expected: doc([]), actual: doc([], ['a chart']) })]));
    expect(text).not.toContain('NaN');
    expect(text).toContain('—');
  });
});

describe('scoreCase — a fixture that never got an answer', () => {
  const errored = (over: Partial<CaseResult> = {}) =>
    result({
      id: 'mixed-currency',
      expected: doc([holding({ ticker: 'AAA' }), holding({ ticker: 'BBB', name: 'Beta AB' })]),
      actual: doc([]),
      attempts: 0,
      error: 'rate_limited',
      ...over,
    });

  it('records the category and fails the case', () => {
    const score = scoreCase(errored());
    expect(score.erroredCases).toBe(1);
    expect(score.errorCategory).toBe('rate_limited');
    expect(score.passedCases).toBe(0);
    expect(score.failures).toEqual(['the extraction failed (rate_limited)']);
  });

  it('charges every expected row as a total miss rather than skipping the case', () => {
    // Skipping would be the friendlier arithmetic and the wrong one: a run in
    // which four of five fixtures were rate-limited would otherwise report a
    // perfect score over the one that survived.
    const score = scoreCase(errored());
    expect(score.missingRows).toBe(2);
    expect(score.fieldsCompared).toBe(2 * FIELDS);
    expect(score.fieldsCorrect).toBe(0);
    expect(ratesOf(score).exactMatchRate).toBe(0);
    expect(ratesOf(score).fieldAccuracy).toBe(0);
  });

  it('charges nothing to the confidence statistics, having no rows to charge', () => {
    const score = scoreCase(errored());
    expect(score.rowsWithConfidence).toBe(0);
    expect(score.wrongFieldsWithConfidence).toBe(0);
    expect(ratesOf(score).meanConfidenceOnWrongFields).toBeNull();
  });

  it('does not count as a vacuous all-null answer, which is a different failure', () => {
    const score = scoreCase(errored({ mode: 'all-null', error: 'overloaded' }));
    expect(score.vacuousCases).toBe(0);
    expect(score.failures).toEqual(['the extraction failed (overloaded)']);
  });

  it('is reported as a floor violation in whichever mode it belonged to', () => {
    const run = scoreRun([errored(), result({ id: 'four-positions-sek' })]);
    expect(checkFloors(run)).toContain('exact: 1 case(s) failed to produce an answer at all');
    expect(run.overall.erroredCases).toBe(1);
  });

  it('still lets the cases that did answer be scored and aggregated', () => {
    // The whole point of catching per fixture: the four already paid for are
    // still in the report.
    const run = scoreRun([
      result({ id: 'four-positions-sek' }),
      result({ id: 'mild-blur' }),
      errored(),
    ]);
    expect(run.overall.cases).toBe(3);
    expect(run.overall.passedCases).toBe(2);
    expect(run.cases.map((c) => c.errorCategory)).toEqual([null, null, 'rate_limited']);
  });
});
