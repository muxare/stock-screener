// claude/evals/score.ts — turning two extractions into numbers, and nothing else.
//
// This file is pure: no filesystem, no API, no clock, no `console`. Everything it
// needs arrives as an argument and everything it produces is returned. That is not
// tidiness for its own sake — phase D of `docs/cca-f-learning-plan.md` says the
// arithmetic that turns extractions into a report is the part most likely to be
// quietly wrong, and a pure module is the part that an ordinary keyless
// `*.test.ts` can pin down completely. The half of the harness that costs money
// lives in `portfolio.eval.ts` and does no arithmetic of its own.
//
// Two rules the whole file obeys:
//
//   - **Nothing extracted is printed.** A failure is reported as a row *index* and
//     a *field name* — "row 2: shares" — never as the value that was read or the
//     value that was expected. The fixtures are synthetic, so nothing here would
//     leak today; the point is that the scorer must not be the module that
//     establishes the habit, because the same code is what someone will reach for
//     the first time they want to score a real screenshot. See the "Never logged"
//     section of `.claude/rules/claude.md`.
//   - **Rows are matched explicitly, never by index.** A model that drops the
//     second of five rows would otherwise score four mismatches instead of one
//     miss, which turns a small, specific failure into a meaningless one.

import type { Confidence, Extraction, Holding } from '../portfolio/schema.ts';

/**
 * What a fixture asserts about the answer.
 *
 * `exact`   — every field of every row must match the expected document.
 * `all-null` — the image is illegible, so every holding field must come back null
 *              with low confidence. The row *count* is deliberately not asserted:
 *              phase C found that a table's structure survives what its contents
 *              do not, so four empty rows and zero rows are both honest answers.
 * `empty`   — the image is not a holdings table. No rows at all, and a warning
 *              that names what the image actually shows.
 */
export type CaseMode = 'exact' | 'all-null' | 'empty';

/**
 * The fields a score is computed over.
 *
 * `confidence` is excluded on purpose: it is the thing being *measured against*
 * (see `meanConfidenceOnWrongFields`), so scoring it as a fact would be circular.
 * `note` is excluded because it is free prose — two correct notes rarely share a
 * word, and an eval that scored them would be measuring phrasing.
 */
export const SCORED_FIELDS = [
  'ticker',
  'name',
  'shares',
  'averagePrice',
  'lastPrice',
  'marketValue',
  'currency',
  'valueCurrency',
] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

/**
 * Confidence as a number, for one statistic only.
 *
 * This mapping is a **reporting convenience and not a claim about calibration**.
 * The schema deliberately asks for three buckets rather than a float precisely
 * because a model is not calibrated to two decimal places, and averaging three
 * ordinal labels does not make it so: the mean of one `high` and one `low` is
 * 0.5, which is not "medium" in any measurable sense. What the number is good for
 * is a *trend* across runs of the same fixtures — if the mean confidence on the
 * fields the model got wrong goes up after a prompt change, the prompt has made
 * the model more confident about being wrong, and that is worth knowing whatever
 * the absolute figure means. Read it as an index, never as a probability.
 *
 * **Which wrong fields count, in every mode.** A wrong field contributes its
 * row's confidence exactly when the model put a *value* there. A field it
 * answered `null` never contributes, whether the null was a refusal on a row that
 * should have had a number or one cell of a row that should not exist at all.
 * The rule has to be stated because an earlier version had two of them — a
 * spurious row charged all eight of its cells while an `all-null` fabrication
 * charged only the cells that were filled in — so the statistic moved when a
 * failure changed *mode* rather than when confidence changed. Beyond consistency
 * the rule is also the sharper question: a confidently wrong *number* is the
 * error that silently changes position sizing, while a confident `null` is only
 * over-caution and already shows up in the null rate.
 */
export const CONFIDENCE_VALUE: Record<Confidence, number> = { high: 1, medium: 0.5, low: 0 };

/** Why one field did not score. Carries no value read off the image. */
export interface FieldMiss {
  /** 1-based index into the *expected* document, or the actual one for a spurious row. */
  row: number;
  field: ScoredField;
  /**
   * `mismatch` — both sides had a value and they differ.
   * `refused`  — a value was expected and the model answered null.
   * `invented` — nothing was expected and the model answered a value.
   * `missing-row` / `spurious-row` — the row itself had no counterpart.
   */
  kind: 'mismatch' | 'refused' | 'invented' | 'missing-row' | 'spurious-row';
}

/** Everything summable about one case, so an aggregate is an addition. */
export interface Totals {
  cases: number;
  passedCases: number;
  expectedRows: number;
  actualRows: number;
  matchedRows: number;
  /** Expected rows the model never produced. */
  missingRows: number;
  /** Rows the model produced that no expected row matches. */
  spuriousRows: number;
  /** Matched rows in which every scored field was correct. */
  exactRows: number;
  fieldsCompared: number;
  fieldsCorrect: number;
  /** Scored fields the model answered `null`, over every row it returned. */
  nullFields: number;
  /** Denominator for the null rate: every scored field of every actual row. */
  actualFields: number;
  /** `all-null` cases only: a non-null field where refusal was the right answer. */
  fabricatedFields: number;
  lowConfidenceRows: number;
  mediumConfidenceRows: number;
  highConfidenceRows: number;
  /** Denominator for the low-confidence rate and the confidence distribution. */
  rowsWithConfidence: number;
  /** Sum of `CONFIDENCE_VALUE` over wrong fields that had an actual row behind them. */
  confidenceSumOnWrongFields: number;
  /** Denominator for the mean above — wrong fields with a confidence to attribute. */
  wrongFieldsWithConfidence: number;
  attempts: number;
  problems: number;
  warnings: number;
  /**
   * `all-null` cases that said nothing at all: no rows and no warnings.
   *
   * Counted separately because it is the one way this mode's other numbers can
   * look perfect while the model has done nothing. See `FLOORS`.
   */
  vacuousCases: number;
  /** Cases where the extraction threw instead of answering. */
  erroredCases: number;
}

export interface CaseScore extends Totals {
  id: string;
  mode: CaseMode;
  /** Every field that did not score, as indices and field names only. */
  misses: FieldMiss[];
  /** Why this case is not a clean pass. Empty when `passedCases` is 1. */
  failures: string[];
  /**
   * The `ClaudeErrorCategory` of the failure, when the extraction threw.
   *
   * A category and not a message: the vocabulary is closed and fixed in
   * `errors.ts`, so it cannot carry anything read off an image, which an SDK
   * error message conceivably could.
   */
  errorCategory: string | null;
}

/** The rates a report prints. All are `null` when their denominator is zero. */
export interface Rates {
  /** Matched-and-perfect rows over expected rows. The headline number. */
  exactMatchRate: number | null;
  fieldAccuracy: number | null;
  nullRate: number | null;
  lowConfidenceRate: number | null;
  mediumConfidenceRate: number | null;
  highConfidenceRate: number | null;
  meanConfidenceOnWrongFields: number | null;
  meanAttempts: number | null;
}

export interface ScoredRun {
  cases: CaseScore[];
  overall: Totals;
  /** Present only for modes the run actually contained. */
  byMode: Partial<Record<CaseMode, Totals>>;
}

/** One case, as the runner hands it to the scorer. */
export interface CaseResult {
  id: string;
  mode: CaseMode;
  expected: Extraction;
  actual: Extraction;
  attempts: number;
  problems: readonly string[];
  /**
   * The error category, when this fixture threw instead of answering.
   *
   * A paid run must not lose the cases it already paid for because the last one
   * hit a 529, so the runner catches per fixture and reports the failure here
   * rather than letting it propagate. `actual` is an empty extraction in that
   * case and is not read.
   */
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Strings compare with surrounding and repeated whitespace normalised and case
 * ignored. The eval measures whether the model identified the instrument, not
 * whether it reproduced the broker's capitalisation; a run that failed on
 * "Volvo B" against "VOLVO B" would report a reading error that did not happen.
 */
function sameString(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Numbers compare with a relative epsilon, not with `===`.
 *
 * The expected values come out of JSON and the actual ones out of the model, and
 * both are IEEE doubles: 1234.5 survives that round trip exactly, but a value the
 * model reports as 1234.4999999999998 is the same reading and must not score as a
 * misread. The tolerance is far tighter than any misreading — a transposed digit
 * moves a number by whole percent, not by parts in a billion.
 */
function sameNumber(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b);
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function compareField(expected: Holding, actual: Holding, field: ScoredField): FieldMiss['kind'] | null {
  const e = expected[field];
  const a = actual[field];
  if (e === null && a === null) return null;
  if (e === null) return 'invented';
  if (a === null) return 'refused';
  if (typeof e === 'number' && typeof a === 'number') return sameNumber(e, a) ? null : 'mismatch';
  if (typeof e === 'string' && typeof a === 'string') return sameString(e, a) ? null : 'mismatch';
  // The schema makes this unreachable — both sides are the same Zod type — but a
  // hand-written expected file is checked in by a human, so a string where a
  // number belongs is a mistake worth reporting as a mismatch rather than a crash.
  return 'mismatch';
}

// ---------------------------------------------------------------------------
// Row matching
// ---------------------------------------------------------------------------

export interface RowMatch {
  /** `[expectedIndex, actualIndex]`, both 0-based. */
  pairs: [number, number][];
  /** 0-based indices into the expected rows that found no counterpart. */
  missing: number[];
  /** 0-based indices into the actual rows that matched nothing expected. */
  spurious: number[];
}

function identity(value: string | null): string | null {
  const trimmed = value?.trim().replace(/\s+/g, ' ').toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * Pair expected rows with actual rows on identity, never on position.
 *
 * Ticker first, then name, in two passes rather than one: a single pass that
 * accepted either would let an early expected row consume an actual row by name
 * when a later expected row was that row's exact ticker match. Both passes are
 * greedy and first-come — a fixture with two rows sharing a ticker *and* a name
 * would be an ambiguous fixture, and the right fix for that is the fixture.
 *
 * A screenshot may legitimately print no ticker (Avanza's holdings table often
 * prints only the instrument name), so a row whose ticker and name are both null
 * has no identity at all and can never match. It is reported as missing or
 * spurious, which is the honest answer: an unidentifiable row is not a reading
 * of any particular position.
 */
export function matchRows(expected: readonly Holding[], actual: readonly Holding[]): RowMatch {
  const pairs: [number, number][] = [];
  const takenExpected = new Set<number>();
  const takenActual = new Set<number>();

  for (const key of ['ticker', 'name'] as const) {
    for (let e = 0; e < expected.length; e += 1) {
      if (takenExpected.has(e)) continue;
      const want = identity(expected[e][key]);
      if (want === null) continue;
      for (let a = 0; a < actual.length; a += 1) {
        if (takenActual.has(a)) continue;
        if (identity(actual[a][key]) !== want) continue;
        pairs.push([e, a]);
        takenExpected.add(e);
        takenActual.add(a);
        break;
      }
    }
  }

  pairs.sort((x, y) => x[0] - y[0]);
  const missing = expected.map((_, i) => i).filter((i) => !takenExpected.has(i));
  const spurious = actual.map((_, i) => i).filter((i) => !takenActual.has(i));
  return { pairs, missing, spurious };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function emptyTotals(): Totals {
  return {
    cases: 0,
    passedCases: 0,
    expectedRows: 0,
    actualRows: 0,
    matchedRows: 0,
    missingRows: 0,
    spuriousRows: 0,
    exactRows: 0,
    fieldsCompared: 0,
    fieldsCorrect: 0,
    nullFields: 0,
    actualFields: 0,
    fabricatedFields: 0,
    lowConfidenceRows: 0,
    mediumConfidenceRows: 0,
    highConfidenceRows: 0,
    rowsWithConfidence: 0,
    confidenceSumOnWrongFields: 0,
    wrongFieldsWithConfidence: 0,
    attempts: 0,
    problems: 0,
    warnings: 0,
    vacuousCases: 0,
    erroredCases: 0,
  };
}

/** Counts every actual row's nulls and confidence. Mode-independent. */
function countActual(totals: Totals, actual: Extraction): void {
  totals.actualRows = actual.holdings.length;
  totals.actualFields = actual.holdings.length * SCORED_FIELDS.length;
  totals.rowsWithConfidence = actual.holdings.length;
  totals.warnings = actual.warnings.length;
  for (const row of actual.holdings) {
    if (row.confidence === 'low') totals.lowConfidenceRows += 1;
    if (row.confidence === 'medium') totals.mediumConfidenceRows += 1;
    if (row.confidence === 'high') totals.highConfidenceRows += 1;
    for (const field of SCORED_FIELDS) if (row[field] === null) totals.nullFields += 1;
  }
}

/**
 * `exact`: every field of every row, with unmatched rows on both sides counted as
 * eight wrong fields each.
 *
 * Counting them rather than skipping them is what stops a model from improving
 * its field accuracy by returning fewer rows: drop a row and eight fields go into
 * the denominator as wrong, exactly as if it had misread all eight.
 */
/**
 * Charge one wrong field to the confidence statistic, under the single rule
 * stated on `CONFIDENCE_VALUE`: only a field the model actually filled in.
 */
function chargeConfidence(score: CaseScore, row: Holding, field: ScoredField): void {
  if (row[field] === null) return;
  score.confidenceSumOnWrongFields += CONFIDENCE_VALUE[row.confidence];
  score.wrongFieldsWithConfidence += 1;
}

function scoreExact(score: CaseScore, expected: Extraction, actual: Extraction): void {
  const match = matchRows(expected.holdings, actual.holdings);
  score.matchedRows = match.pairs.length;
  score.missingRows = match.missing.length;
  score.spuriousRows = match.spurious.length;

  for (const [e, a] of match.pairs) {
    const expectedRow = expected.holdings[e];
    const actualRow = actual.holdings[a];
    let rowIsExact = true;
    for (const field of SCORED_FIELDS) {
      score.fieldsCompared += 1;
      const kind = compareField(expectedRow, actualRow, field);
      if (kind === null) {
        score.fieldsCorrect += 1;
        continue;
      }
      rowIsExact = false;
      score.misses.push({ row: e + 1, field, kind });
      chargeConfidence(score, actualRow, field);
    }
    if (rowIsExact) score.exactRows += 1;
  }

  for (const e of match.missing) {
    for (const field of SCORED_FIELDS) {
      score.fieldsCompared += 1;
      score.misses.push({ row: e + 1, field, kind: 'missing-row' });
    }
  }

  for (const a of match.spurious) {
    const actualRow = actual.holdings[a];
    for (const field of SCORED_FIELDS) {
      score.fieldsCompared += 1;
      score.misses.push({ row: a + 1, field, kind: 'spurious-row' });
      chargeConfidence(score, actualRow, field);
    }
  }

  if (score.missingRows > 0) score.failures.push(`${score.missingRows} expected row(s) not returned`);
  if (score.spuriousRows > 0) score.failures.push(`${score.spuriousRows} row(s) returned that no expected row matches`);
  const wrongMatched = score.matchedRows - score.exactRows;
  if (wrongMatched > 0) score.failures.push(`${wrongMatched} matched row(s) with at least one wrong field`);
}

/**
 * `all-null`: the image is illegible and every field must be a refusal.
 *
 * There is no field-by-field comparison here, so `fieldsCompared` stays zero and
 * the case contributes nothing to field accuracy — the question is not "did it
 * read the digits" but "did it invent any". Every non-null field is a fabricated
 * field, and it carries its row's confidence into the wrong-field mean, because a
 * fabricated value reported as `high` is the single worst thing this feature can
 * do.
 */
function scoreAllNull(score: CaseScore, actual: Extraction): void {
  for (const [index, row] of actual.holdings.entries()) {
    for (const field of SCORED_FIELDS) {
      if (row[field] === null) continue;
      score.fabricatedFields += 1;
      score.misses.push({ row: index + 1, field, kind: 'invented' });
      chargeConfidence(score, row, field);
    }
  }
  const notLow = score.rowsWithConfidence - score.lowConfidenceRows;
  if (score.fabricatedFields > 0) score.failures.push(`${score.fabricatedFields} field(s) filled in where the image is illegible`);
  if (notLow > 0) score.failures.push(`${notLow} row(s) not reported at low confidence`);

  // The vacuous answer. This mode's row count is deliberately not asserted, and
  // that leniency has an exploit: an answer of no rows and no warnings has a null
  // rate with no denominator, a low-confidence rate with no denominator and zero
  // fabricated fields, so it scores a clean pass on the one mode whose whole job
  // is to catch invention. Refusing to read the image is a legitimate answer;
  // refusing to say anything at all is not, and one of the two has to be present.
  if (actual.holdings.length === 0 && actual.warnings.length === 0) {
    score.vacuousCases = 1;
    score.failures.push('no rows and no warning: nothing was refused and nothing was said');
  }
}

/**
 * `empty`: the image is not a holdings table, so any row at all is a fabrication
 * and silence is not enough — a warning has to say what the image actually shows,
 * or the user is left with a blank table and no reason for it.
 */
function scoreEmpty(score: CaseScore, actual: Extraction): void {
  score.spuriousRows = actual.holdings.length;
  for (const [index, row] of actual.holdings.entries()) {
    for (const field of SCORED_FIELDS) {
      score.misses.push({ row: index + 1, field, kind: 'spurious-row' });
      chargeConfidence(score, row, field);
    }
  }
  if (score.spuriousRows > 0) score.failures.push(`${score.spuriousRows} holding(s) returned for an image that is not a holdings table`);
  if (score.warnings === 0) score.failures.push('no warning naming what the image shows');
}

/** Score one case. Pure; the same input always gives the same output. */
export function scoreCase(result: CaseResult): CaseScore {
  const score: CaseScore = {
    ...emptyTotals(),
    id: result.id,
    mode: result.mode,
    misses: [],
    failures: [],
    errorCategory: null,
  };
  score.cases = 1;
  score.attempts = result.attempts;
  score.problems = result.problems.length;
  score.expectedRows = result.mode === 'exact' ? result.expected.holdings.length : 0;

  // A fixture that threw is scored as a total miss, not skipped.
  //
  // Skipping it would be the friendlier arithmetic and the wrong one: a run in
  // which four of five fixtures were rate-limited would report a perfect score
  // over the one that survived, and a floor is supposed to make a broken run
  // visible. So every expected row is charged as not returned, which no floor
  // can survive, and the category is carried up so the report can say that the
  // cause was the API rather than the prompt.
  if (result.error) {
    score.errorCategory = result.error;
    score.failures.push(`the extraction failed (${result.error})`);
    score.erroredCases = 1;
    for (let e = 0; e < score.expectedRows; e += 1) {
      score.missingRows += 1;
      for (const field of SCORED_FIELDS) {
        score.fieldsCompared += 1;
        score.misses.push({ row: e + 1, field, kind: 'missing-row' });
      }
    }
    return score;
  }

  countActual(score, result.actual);

  switch (result.mode) {
    case 'exact':
      scoreExact(score, result.expected, result.actual);
      break;
    case 'all-null':
      scoreAllNull(score, result.actual);
      break;
    case 'empty':
      scoreEmpty(score, result.actual);
      break;
  }

  score.passedCases = score.failures.length === 0 ? 1 : 0;
  return score;
}

const SUMMABLE = [
  'cases', 'passedCases', 'expectedRows', 'actualRows', 'matchedRows', 'missingRows',
  'spuriousRows', 'exactRows', 'fieldsCompared', 'fieldsCorrect', 'nullFields',
  'actualFields', 'fabricatedFields', 'lowConfidenceRows', 'mediumConfidenceRows',
  'highConfidenceRows', 'rowsWithConfidence', 'confidenceSumOnWrongFields',
  'wrongFieldsWithConfidence', 'attempts', 'problems', 'warnings', 'vacuousCases',
  'erroredCases',
] as const satisfies readonly (keyof Totals)[];

export function sumTotals(parts: readonly Totals[]): Totals {
  const out = emptyTotals();
  for (const part of parts) for (const key of SUMMABLE) out[key] += part[key];
  return out;
}

export function scoreRun(results: readonly CaseResult[]): ScoredRun {
  const cases = results.map(scoreCase);
  const byMode: Partial<Record<CaseMode, Totals>> = {};
  for (const mode of ['exact', 'all-null', 'empty'] as const) {
    const of = cases.filter((c) => c.mode === mode);
    if (of.length > 0) byMode[mode] = sumTotals(of);
  }
  return { cases, overall: sumTotals(cases), byMode };
}

/** Division that answers `null` rather than `NaN` when there is nothing to divide. */
function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function ratesOf(totals: Totals): Rates {
  return {
    exactMatchRate: rate(totals.exactRows, totals.expectedRows),
    fieldAccuracy: rate(totals.fieldsCorrect, totals.fieldsCompared),
    nullRate: rate(totals.nullFields, totals.actualFields),
    lowConfidenceRate: rate(totals.lowConfidenceRows, totals.rowsWithConfidence),
    mediumConfidenceRate: rate(totals.mediumConfidenceRows, totals.rowsWithConfidence),
    highConfidenceRate: rate(totals.highConfidenceRows, totals.rowsWithConfidence),
    meanConfidenceOnWrongFields: rate(totals.confidenceSumOnWrongFields, totals.wrongFieldsWithConfidence),
    meanAttempts: rate(totals.attempts, totals.cases),
  };
}

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

/**
 * The minimum a run has to clear, per mode.
 *
 * A floor exists to catch a regression, not to be passed: it sits a little below
 * what phase C measured on a real account (2026-09-21 — all four positions read
 * correctly in one attempt on both crops, every field null with low confidence on
 * the illegible crop, no invented rows on either non-holdings crop), so an
 * ordinary run clears it with room and a prompt change that costs the model a row
 * or a digit does not. Tighten a floor when a run has beaten it repeatedly; never
 * loosen one to make a red run green without saying why in the diary.
 *
 * Where the numbers come from:
 *
 *   - `exact.exactMatchRate >= 0.8` — the three exact cases carry roughly a dozen
 *     rows between them, so this tolerates two rows going wrong and fails on
 *     three. A single misread digit anywhere is visible in the report without
 *     being a red run, because a paid run that goes red on noise stops being run.
 *   - `exact.fieldAccuracy >= 0.95` — eight fields a row, so this is "about one
 *     field in twenty". Set above the row floor on purpose: a row that fails on
 *     one field still scores seven of eight, so field accuracy degrades more
 *     slowly and needs a tighter bound to mean anything.
 *   - `exact.spuriousRows === 0` — categorical, not a rate. Inventing a position
 *     that is not in the picture is the failure mode this whole feature exists to
 *     prevent, and one of them is one too many.
 *   - `all-null.maxFabricatedFields === 1` — a **count**, where this used to be a
 *     null rate of 0.95, and the change is the durable lesson of 2026-09-22
 *     rather than a tuning tweak.
 *
 *     A rate floor's strictness here moves with a quantity this mode is
 *     documented not to assert. Do the arithmetic: with four rows returned there
 *     are 32 scored fields, so one fabricated field is 31/32 = 0.969 and passes;
 *     with two rows there are 16, and the *same single fabrication* is 15/16 =
 *     0.9375 and fails. A model that refuses correctly but returns fewer rows was
 *     therefore held to a stricter bar than one that returns more — and the row
 *     count is the one thing `all-null` explicitly does not care about, because a
 *     table's structure survives what its contents do not. A floor should be
 *     expressed in the units of the failure it is trying to catch. The failure
 *     here is "a digit invented on an image nobody could read", which is counted,
 *     not rated.
 *
 *     **One, not zero.** Three clean runs is thin evidence for zero tolerance,
 *     and one unit of fixed slack costs nothing anyone would want to catch — a
 *     single fabricated field is visible in the report either way, and a floor
 *     that reddens on it would be a floor people stop believing. The slack is
 *     fixed rather than proportional, which is the whole point: it no longer
 *     drifts with the shape of the answer.
 *
 *     **Why the old floor looked flaky, and what it actually was.** The illegible
 *     fixture scored 1.000 / 0.875 / 0.875 across three runs, which read like
 *     sampling noise and was not. 0.875 is exactly 28/32 — four fabricated fields
 *     across four rows, one per row — because phase C's legibility rule named the
 *     share count, the prices and the market value but never the currency fields,
 *     so the model filled those in on every row when it filled them in at all.
 *     Naming them took the fixture to 1.000 three runs running while the weakened
 *     control stayed at 0.750. Worth recording precisely: it fired in two runs of
 *     three, not in every run, so the *intermittency* was real even though the
 *     cause was not random. A defect that only sometimes fires still has a cause,
 *     and "flaky" is a hypothesis to be disproved rather than a property to be
 *     tolerated with a looser threshold.
 *   - `all-null.lowConfidenceRate >= 0.75` — deliberately looser. Refusing to
 *     guess is a rule the model can follow exactly; grading its own uncertainty
 *     is a judgement, and holding a judgement to the same bar as a rule would
 *     make the harness fail on something it is only measuring.
 *   - `all-null.maxVacuousCases === 0` — categorical, and the one floor here that
 *     is not about how well the model read. Every other `all-null` number has a
 *     denominator that an empty answer makes zero, so a model that returned no
 *     rows and said nothing would clear this mode — the only mode that guards
 *     against invention — by declining to participate in it. An illegible image
 *     must produce either rows that refuse field by field or a warning saying why
 *     it could not.
 *   - `empty.passRate === 1` — also categorical. Every non-holdings image must
 *     come back with no rows and a warning that says what it is instead.
 *
 * **There is deliberately no floor on the confidence distribution.** The report
 * prints it per case, because `mild-blur` is a fixture whose whole purpose is
 * calibration and the scored fields cannot see confidence at all — two runs that
 * read it perfectly, one at `high` and one at `low`, would otherwise print
 * identical tables. But nothing here has measured what a *good* distribution
 * looks like, and a floor invented from nothing would be a number that fails runs
 * without meaning anything. It stays a reported signal until there is a
 * measurement to set it from.
 */
export interface ModeFloor {
  exactMatchRate?: number;
  fieldAccuracy?: number;
  lowConfidenceRate?: number;
  maxSpuriousRows?: number;
  /** See the `all-null` entry above: a count, deliberately not a null rate. */
  maxFabricatedFields?: number;
  maxVacuousCases?: number;
  passRate?: number;
}

// There is deliberately no `nullRate` knob here. The null rate is still reported
// in every row of the table — it is the number a reader wants to see — but it is
// no longer assertable, so re-introducing the floor this file just removed is a
// type error rather than a plausible-looking line in a constant.

export const FLOORS: Record<CaseMode, ModeFloor> = {
  exact: { exactMatchRate: 0.8, fieldAccuracy: 0.95, maxSpuriousRows: 0 },
  'all-null': { maxFabricatedFields: 1, lowConfidenceRate: 0.75, maxVacuousCases: 0 },
  empty: { passRate: 1 },
};

/**
 * Every floor the run fails, as sentences. An empty array is a passing run.
 *
 * A rate whose denominator is zero cannot be below its floor and is not reported:
 * `meanConfidenceOnWrongFields` on a flawless run has nothing to average, and a
 * mode the run did not contain has nothing to check.
 */
export function checkFloors(run: ScoredRun, floors: Record<CaseMode, ModeFloor> = FLOORS): string[] {
  const violations: string[] = [];
  for (const [mode, totals] of Object.entries(run.byMode) as [CaseMode, Totals][]) {
    const floor = floors[mode];
    const rates = ratesOf(totals);
    const below = (name: keyof Rates, min: number | undefined) => {
      if (min === undefined) return;
      const value = rates[name];
      if (value !== null && value < min) {
        violations.push(`${mode}: ${name} ${value.toFixed(3)} is below the floor of ${min.toFixed(3)}`);
      }
    };
    below('exactMatchRate', floor.exactMatchRate);
    below('fieldAccuracy', floor.fieldAccuracy);
    below('lowConfidenceRate', floor.lowConfidenceRate);
    if (floor.passRate !== undefined) {
      const passRate = rate(totals.passedCases, totals.cases);
      if (passRate !== null && passRate < floor.passRate) {
        violations.push(`${mode}: passRate ${passRate.toFixed(3)} is below the floor of ${floor.passRate.toFixed(3)}`);
      }
    }
    if (floor.maxFabricatedFields !== undefined && totals.fabricatedFields > floor.maxFabricatedFields) {
      violations.push(
        `${mode}: ${totals.fabricatedFields} fabricated field(s) on an illegible image, ` +
          `at most ${floor.maxFabricatedFields} allowed`,
      );
    }
    if (floor.maxSpuriousRows !== undefined && totals.spuriousRows > floor.maxSpuriousRows) {
      violations.push(`${mode}: ${totals.spuriousRows} spurious row(s), at most ${floor.maxSpuriousRows} allowed`);
    }
    if (floor.maxVacuousCases !== undefined && totals.vacuousCases > floor.maxVacuousCases) {
      violations.push(
        `${mode}: ${totals.vacuousCases} case(s) answered with no rows and no warning, ` +
          `at most ${floor.maxVacuousCases} allowed`,
      );
    }
    // Not a per-mode floor but reported through the same channel: a case that
    // never got an answer is a broken run, and saying so beside the rates it
    // wrecked is where a reader will look.
    if (totals.erroredCases > 0) {
      violations.push(`${mode}: ${totals.erroredCases} case(s) failed to produce an answer at all`);
    }
  }
  return violations;
}
