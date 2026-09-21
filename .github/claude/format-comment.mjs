// Turns the JSON envelope printed by `claude -p --output-format json` into the body of
// the single advisory comment phase B keeps on a pull request. Reads the envelope from
// the path in argv[2], writes markdown to stdout.
//
// It never throws on a bad envelope. A run that failed, was cut off by the budget, or
// returned nothing the schema accepts still has to produce a comment saying so: silence
// on a pull request reads exactly like a pass, which is the one thing this must not do.
import { readFile } from 'node:fs/promises';

/** The workflow finds its own comment again by this line; it is invisible when rendered. */
const MARKER = '<!-- cca-f-phase-b-advisory -->';

const SYMBOL = { pass: '✅', warn: '⚠️', skip: '⏭️' };
const TITLE = { 'touch-scope': 'Touch scope', diary: 'Diary entry' };

const envelope = await readFile(process.argv[2], 'utf8')
  .then((text) => JSON.parse(text))
  .catch(() => null);

const lines = [MARKER, '### Claude advisory review', ''];

const checks = envelope?.structured_output?.checks;
if (!envelope || envelope.is_error || !Array.isArray(checks)) {
  const why = !envelope
    ? 'the run produced no parseable envelope'
    : envelope.is_error
      ? `the run ended in an error (stop reason: ${envelope.stop_reason ?? 'unknown'})`
      : 'the run returned no object matching the schema';
  lines.push(
    `The reviewer reached no verdict this time, because ${why}. Nothing is implied about`,
    'the pull request — the two checks simply did not run. Re-push to try again, or run',
    '`/touch-scope` and the `plan-auditor` agent locally, which ask the same questions.',
  );
} else {
  lines.push('| Check | Verdict | Reason |', '| --- | --- | --- |');
  for (const check of checks) {
    const title = TITLE[check.id] ?? check.id;
    const verdict = `${SYMBOL[check.verdict] ?? ''} ${check.verdict}`.trim();
    // A pipe inside a reason would split the row; the reason is model-written prose.
    const reason = String(check.reason ?? '').replaceAll('|', '\\|');
    lines.push(`| ${title} | ${verdict} | ${reason} |`);
  }
  const evidence = checks.filter((check) => check.evidence?.length);
  if (evidence.length) {
    lines.push('', '<details><summary>Evidence</summary>', '');
    for (const check of evidence) {
      lines.push(`- **${TITLE[check.id] ?? check.id}**`);
      for (const item of check.evidence) lines.push(`  - \`${String(item).replaceAll('`', "'")}\``);
    }
    lines.push('', '</details>');
  }
}

const cost = typeof envelope?.total_cost_usd === 'number' ? envelope.total_cost_usd.toFixed(3) : '?';
const denials = envelope?.permission_denials?.length ?? 0;

lines.push(
  '',
  `<sub>Advisory only — this comment never fails the build. ${process.env.CLAUDE_MODEL ?? 'model unknown'}` +
    `, ${envelope?.num_turns ?? '?'} turns, $${cost}` +
    (denials ? `, ${denials} tool call(s) refused by the allow-list` : '') +
    `. Commit ${(process.env.HEAD_SHA ?? '').slice(0, 7) || 'unknown'}.</sub>`,
);

process.stdout.write(`${lines.join('\n')}\n`);
