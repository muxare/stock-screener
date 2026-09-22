// claude/evals/report.ts — the table the eval prints.
//
// Separate from `score.ts` because it is a separate decision: the scorer decides
// what is true about a run, this file decides what a human reads at the end of a
// paid run, and the two change for different reasons. It is also pure — it
// returns a string and never touches `console` — so the runner owns the one place
// output happens and a future caller (a CI comment, a diary entry) can use the
// same renderer without a capture hack.
//
// What it may print is constrained by the same rule the scorer obeys: case ids,
// field names, counts and rates. Never a value read off an image, and never a
// holding's name. The failure detail is therefore "row 2: shares (mismatch)" —
// enough to open the fixture and look, and useless to anyone who should not see
// the account.

import type { CaseMode, CaseScore, FieldMiss, ScoredRun, Totals } from './score.ts';
import { ratesOf } from './score.ts';

/** A rate as a percentage, or a dash when there was nothing to divide. */
function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

/** The confidence index, which is not a percentage — see `CONFIDENCE_VALUE`. */
function idx(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

/**
 * How the returned rows' confidence was distributed, as `high/medium/low` counts.
 *
 * Here because `mild-blur` could not otherwise be read off the report at all.
 * That fixture prints the same numbers as the clean one and exists to ask whether
 * the model *lowers its confidence* when the image degrades — but `confidence` is
 * not a scored field, and conf@wrong has an empty denominator exactly when the
 * case goes as intended, so a run that read it perfectly at `high` and one that
 * read it perfectly at `low` used to print byte-identical tables. Counts rather
 * than percentages: with four rows in a fixture, "25%" is a harder way of writing
 * "one".
 */
function confidenceSpread(totals: Totals): string {
  if (totals.rowsWithConfidence === 0) return '—';
  return `${totals.highConfidenceRows}/${totals.mediumConfidenceRows}/${totals.lowConfidenceRows}`;
}

function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (text.length >= width) return text;
  const fill = ' '.repeat(width - text.length);
  return align === 'left' ? text + fill : fill + text;
}

interface Column {
  header: string;
  align: 'left' | 'right';
  of: (row: Row) => string;
}

interface Row {
  label: string;
  mode: string;
  totals: Totals;
  status: string;
}

const COLUMNS: Column[] = [
  { header: 'case', align: 'left', of: (r) => r.label },
  { header: 'mode', align: 'left', of: (r) => r.mode },
  { header: 'rows', align: 'right', of: (r) => `${r.totals.actualRows}/${r.totals.expectedRows || '—'}` },
  { header: 'exact', align: 'right', of: (r) => pct(ratesOf(r.totals).exactMatchRate) },
  { header: 'field acc', align: 'right', of: (r) => pct(ratesOf(r.totals).fieldAccuracy) },
  { header: 'null', align: 'right', of: (r) => pct(ratesOf(r.totals).nullRate) },
  { header: 'low conf', align: 'right', of: (r) => pct(ratesOf(r.totals).lowConfidenceRate) },
  { header: 'h/m/l', align: 'right', of: (r) => confidenceSpread(r.totals) },
  { header: 'conf@wrong', align: 'right', of: (r) => idx(ratesOf(r.totals).meanConfidenceOnWrongFields) },
  { header: 'spurious', align: 'right', of: (r) => String(r.totals.spuriousRows) },
  { header: 'attempts', align: 'right', of: (r) => idx(ratesOf(r.totals).meanAttempts) },
  { header: 'problems', align: 'right', of: (r) => String(r.totals.problems) },
  { header: '', align: 'left', of: (r) => r.status },
];

function table(rows: Row[]): string[] {
  const widths = COLUMNS.map((c, i) =>
    Math.max(c.header.length, ...rows.map((r) => COLUMNS[i].of(r).length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, i) => pad(cell, widths[i], COLUMNS[i].align)).join('  ').trimEnd();
  return [
    line(COLUMNS.map((c) => c.header)),
    // A rule under a nameless column would be a rule under nothing; the status
    // column carries pass/FAIL and has no heading.
    line(widths.map((w, i) => (COLUMNS[i].header ? '-'.repeat(w) : ''))),
    ...rows.map((r) => line(COLUMNS.map((c) => c.of(r)))),
  ];
}

/** "row 2: shares (mismatch)", collapsed so one bad row is one line per field. */
function describeMiss(miss: FieldMiss): string {
  return `row ${miss.row}: ${miss.field} (${miss.kind})`;
}

/**
 * A row's worth of misses, summarised.
 *
 * A dropped row produces eight `missing-row` misses that all say the same thing,
 * so they collapse to one line. Everything else is listed, because which field
 * went wrong is the whole diagnostic value of the report.
 */
function missLines(score: CaseScore): string[] {
  // Keyed by kind as well as by index, because the two indices count different
  // arrays: a `missing-row` 2 is the second *expected* row and a `spurious-row`
  // 2 is the second row the model *returned*, and collapsing them together hides
  // one of the two failures behind the other.
  const wholeRow = new Set<string>();
  for (const miss of score.misses) {
    if (miss.kind === 'missing-row' || miss.kind === 'spurious-row') wholeRow.add(`${miss.kind}:${miss.row}`);
  }
  const lines: string[] = [];
  // Sorted by kind and then *numerically* by index. A default string sort would
  // put "row 10" before "row 2", which is only ever confusing in a list whose
  // whole job is to point at one row of a fixture.
  const ordered = [...wholeRow]
    .map((key) => {
      const [kind, row] = key.split(':');
      return { kind, row: Number(row) };
    })
    .sort((a, b) => (a.kind === b.kind ? a.row - b.row : a.kind.localeCompare(b.kind)));
  for (const { kind, row } of ordered) {
    lines.push(
      kind === 'missing-row'
        ? `expected row ${row}: not returned`
        : `returned row ${row}: no expected counterpart`,
    );
  }
  for (const miss of score.misses) {
    if (miss.kind === 'missing-row' || miss.kind === 'spurious-row') continue;
    lines.push(describeMiss(miss));
  }
  return lines;
}

const MODE_LABEL: Record<CaseMode, string> = {
  exact: 'exact',
  'all-null': 'all-null',
  empty: 'empty',
};

export interface ReportOptions {
  /** Named in the header so a weakened-prompt run is never mistaken for a real one. */
  variant?: string;
  /** Floor violations from `checkFloors`, printed under the table. */
  violations?: readonly string[];
  /** How many misses to list per case before saying "and N more". */
  maxMissLines?: number;
}

/** The whole report as one string. Print it; do not parse it. */
export function renderReport(run: ScoredRun, options: ReportOptions = {}): string {
  const { variant = 'production prompt', violations = [], maxMissLines = 12 } = options;
  const out: string[] = [];
  out.push(`portfolio extraction eval — ${variant}`);
  out.push('');

  const rows: Row[] = run.cases.map((score) => ({
    label: score.id,
    mode: MODE_LABEL[score.mode],
    totals: score,
    status: score.passedCases === 1 ? 'pass' : score.errorCategory ? 'ERROR' : 'FAIL',
  }));
  for (const [mode, totals] of Object.entries(run.byMode) as [CaseMode, Totals][]) {
    rows.push({ label: `all ${MODE_LABEL[mode]}`, mode: '', totals, status: '' });
  }
  rows.push({ label: 'ALL CASES', mode: '', totals: run.overall, status: '' });
  out.push(...table(rows));
  out.push('');

  // Cases that never got an answer are called out above the scoring detail. A
  // reader who sees a floor missed needs to know first whether the prompt read
  // the images badly or whether the API never answered, because the two lead to
  // completely different next steps.
  const errored = run.cases.filter((c) => c.errorCategory !== null);
  if (errored.length > 0) {
    out.push('cases that never produced an answer (the run is not a measurement of the prompt):');
    for (const score of errored) out.push(`  ${score.id}: ${score.errorCategory}`);
    out.push('');
  }

  const failed = run.cases.filter((c) => c.passedCases === 0);
  if (failed.length > 0) {
    out.push('what went wrong (field names and row indices only — no extracted values):');
    for (const score of failed) {
      out.push(`  ${score.id}`);
      for (const failure of score.failures) out.push(`    - ${failure}`);
      const lines = missLines(score);
      for (const line of lines.slice(0, maxMissLines)) out.push(`      ${line}`);
      if (lines.length > maxMissLines) out.push(`      … and ${lines.length - maxMissLines} more`);
    }
    out.push('');
  }

  const { cases, passedCases, attempts, problems, erroredCases } = run.overall;
  out.push(
    `${passedCases}/${cases} cases clean, ${attempts} model turn(s) spent, ` +
      `${problems} unresolved validation problem(s)` +
      (erroredCases > 0 ? `, ${erroredCases} case(s) with no answer at all.` : '.'),
  );

  if (violations.length > 0) {
    out.push('');
    out.push('FLOORS NOT MET:');
    for (const violation of violations) out.push(`  - ${violation}`);
  } else {
    out.push('Every floor met.');
  }

  // The confidence index is the one number in the table that invites being read
  // as something it is not, so the table says so every time rather than relying
  // on the reader having read `score.ts`.
  out.push('');
  out.push(
    'h/m/l counts the returned rows by confidence. conf@wrong is high=1 / medium=0.5 / low=0 ' +
      'averaged over the wrong fields the model actually filled in (a null never counts). ' +
      'Both are comparable between runs of the same fixtures; neither is a probability, ' +
      'and neither has a floor.',
  );
  return out.join('\n');
}
