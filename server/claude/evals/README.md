# The portfolio extraction eval

Phase D of [`docs/cca-f-learning-plan.md`](../../../docs/cca-f-learning-plan.md). It exists
because `.claude/rules/claude.md` says to build an eval before tuning a prompt, and because a
diary entry that claims a prompt change helped has to point at something other than the
author's impression of it. What this directory produces is that something: a table of numbers
for a fixed set of screenshots, reproducible by anyone with a key, and comparable between two
runs of the same fixtures.

## What it measures

Five fixtures go through `extractPortfolio()` — the production path, with the production
prompt, the production schema and the production two-attempt repair loop — and the answers are
scored against expected documents that were written before the images were rendered. Each
fixture declares a **mode**, and the mode decides what "correct" means for it:

| Mode | The image | What is asserted |
|---|---|---|
| `exact` | A legible holdings table | Every field of every row matches the expected document |
| `all-null` | A table degraded until the digits are unreadable | Every holding field is `null` at `low` confidence. The row count is deliberately *not* asserted: a table's structure survives what its contents do not, so both four empty rows and zero rows are honest answers |
| `empty` | Something that is not a holdings table | No rows at all, and a warning naming what the image actually shows |

Eight fields are scored: `ticker`, `name`, `shares`, `averagePrice`, `lastPrice`,
`marketValue`, `currency`, `valueCurrency`. `confidence` is not scored as a fact — it is what
the wrong-field statistic is measured *against*, so scoring it would be circular — and `note`
is not scored because it is free prose, and two correct notes rarely share a word.

The metrics, all of which the table prints per case and again per mode and overall:

- **exact-match rate** — matched rows in which every scored field was right, over the number of
  rows the fixture expected. The headline number, and the one a regression shows up in first.
- **field accuracy** — correct fields over compared fields. A row the model dropped and a row
  it invented each contribute eight *wrong* fields, so returning fewer rows cannot raise this
  number. It degrades more slowly than the exact-match rate — a row that fails on one field
  still scores seven of eight — which is why its floor is set higher.
- **null rate** — scored fields the model answered `null`, over every scored field it returned.
  On an `exact` case a rising null rate is a model that has become timid. It is reported in
  every row of the table and is **not** asserted by any floor; the `all-null` mode asserts a
  count of fabricated fields instead, for the reason under "Why this one is a count".
- **low-confidence rate** — rows reported at `low` confidence. The `all-null` fixtures are
  where this matters.
- **h/m/l** — how the returned rows' confidence was distributed, as counts. This is the only
  way `mild-blur` can be read off the report at all: that fixture prints the same numbers as
  the clean one and exists to ask whether the model *lowers its confidence* when the image
  degrades, but `confidence` is not a scored field and conf@wrong has an empty denominator
  exactly when the case goes as intended. Without this column, a run that read it perfectly at
  `high` and one that read it perfectly at `low` printed byte-identical tables. There is
  deliberately **no floor** on it — nothing here has measured what a good distribution looks
  like, and a floor invented from nothing would fail runs without meaning anything.
- **conf@wrong** — the mean confidence of the fields that were wrong, with `high` as 1,
  `medium` as 0.5 and `low` as 0. A wrong field counts here **only when the model put a value
  there**: a `null` never contributes, in any mode, whether it was a refusal on a row that
  should have had a number or one cell of a row that should not exist at all. The rule is
  worth stating because there used to be two of them — a spurious row charged all eight of its
  cells while an `all-null` fabrication charged only the filled ones — so the number moved when
  a failure changed *mode* rather than when confidence changed. Beyond consistency it is the
  sharper question: a confidently wrong *number* is the error that silently changes position
  sizing, while a confident `null` is only over-caution and already shows up in the null rate.
  **The high/medium/low mapping is a reporting convenience and not a claim about
  calibration.** The schema asks for three buckets rather than a float precisely because
  a model is not calibrated to two decimal places, and averaging three ordinal labels does not
  make it so. What the number is good for is the trend: if conf@wrong goes *up* after a prompt
  change, the prompt has made the model more confident about being wrong, which is worth
  knowing whatever the absolute figure means.
- **attempts** and **problems** — how many model turns the run spent, and how many meaning
  checks were still failing when the repair loop gave up. A prompt change that quietly doubles
  the retry rate has doubled the cost of the feature, and this is where that shows.

Rows are matched between the expected and the actual document **explicitly** — on ticker first,
then on name — and never by position. A model that drops the second of five rows would
otherwise score four mismatches instead of one miss, turning a small, specific failure into a
meaningless one. An expected row with no counterpart is a miss; a returned row that matches
nothing expected is a spurious row.

### When a fixture throws

A rate limit or a 529 on the fourth of five fixtures must not discard the three already paid
for, so the runner catches per fixture. The failure is recorded by its `ClaudeErrorCategory` —
a category and not a message, because the vocabulary is closed and so cannot carry anything
read off an image — the run continues, and the report names the errored cases above the scoring
detail.

The scorer charges such a case as a **total miss**: every expected row counts as not returned.
Skipping it would be the friendlier arithmetic and the wrong one, because a run in which four
of five fixtures were rate-limited would then report a perfect score over the one that
survived, and a floor exists to make a broken run visible. The report's "cases that never
produced an answer" section is what tells the reader the cause was the API and not the prompt —
two findings that lead to completely different next steps.

The bar series handed to `validateExtraction` is deliberately empty: the fixture tickers are
invented, so no real price history could confirm or refute them. The consequence to remember
when reading a report is that this eval measures *reading*, not plausibility against the
market.

## Running it

```bash
npm run eval             # the production prompt
npm run eval:weakened    # the control run (see below)
npm run eval:fixtures    # re-render the fixture images from their HTML sources
```

`npm run eval` needs `ANTHROPIC_API_KEY`. The script loads `.env` from the repository root with
`node --env-file-if-exists=.env`, the same way `npm run dev:server` and
`npm run portfolio:backfill` do, so a key in `.env` is enough; an exported variable works too.
With no key the run fails immediately with a sentence saying so, rather than a 401 stack trace
five fixtures in.

### Roughly what it costs

An estimate, not a measurement — nothing in this repository has billed a run yet, and the first
real figure belongs in the diary entry rather than here.

At Opus 5's rates of $5 per million input tokens and $25 per million output tokens, and with
image tokens running at about `width × height / 750`, one fixture is on the order of 2,500–3,000
input tokens (a screenshot of a few hundred kilopixels plus a roughly 1,200-token system
prompt) and 2,000–3,000 output tokens. Adaptive thinking is billed as output and dominates, so
a five-fixture run lands somewhere around **$0.30–$0.60**, plus whatever repair attempts the
run needs — each repair re-sends the image at full price, which is exactly why the loop is
bounded at two attempts.

That is cheap enough to run on every prompt change and expensive enough that it must not run on
every push. Hence the opt-in.

### The weakened-prompt check

Phase D's Verify line says "a deliberately weakened prompt lowers the score". That sentence is
only worth writing if it can be run:

```bash
npm run eval:weakened      # or: EVAL_PROMPT=weakened npm run eval
```

`weakened.ts` holds a system prompt that does carelessly everything the real one does carefully:
adjectives instead of per-field criteria, no null rule, nothing about Swedish number formatting,
one currency question where there are two, and no instruction to refuse a non-holdings image.
The substitution happens on the request itself, through the client that `apiCaller()` was
already built to accept, so **`prompt.ts` is not touched and not branched**. Everything else
about the call — model, max tokens, adaptive thinking, the schema, the user prompt, the repair
prompt, the retry loop — is provably identical between the two runs, which is what makes the
difference in score attributable to the system prompt and nothing else.

The weakened run inverts the assertion: it *fails* if it meets every floor. A harness whose
score does not move when the prompt is gutted is measuring the fixtures rather than the prompt,
and every future "the eval delta says this change helped" would be worthless. The fix for a red
weakened run is a harder fixture or a tighter floor, never a softer assertion.

Run both, and record both tables in the diary entry. The delta is the result; either table
alone is a number without a baseline.

## Why runs are opt-in, and the naming rule

**Any file in this directory that calls the API is named `*.eval.ts`.** That suffix is the
entire opt-in mechanism, and it is load-bearing rather than decorative.

`npm test` runs Vitest's default include, `**/*.{test,spec}.?(c|m)[jt]s?(x)`, which `.eval.ts`
does not match, and `vitest.eval.config.ts` includes that suffix and *nothing else* — the
default include is not extended, so a `*.test.ts` dropped in here belongs to `npm test`, where
it is free.

That leaves the actual hazard: a **paid** eval added here and named `portfolio.test.ts` would
be collected by `npm test` and would bill the account on every push. `naming.test.ts` is the
guard for it — a keyless test in the ordinary suite that walks this tree and fails on any
`*.test.ts` or `*.spec.ts` outside a two-name allowlist, fails if an allowlisted file starts
reaching for the API, and fails if a file that *does* call `apiCaller()` is not named
`*.eval.ts`. Adding to the allowlist is a visible line in a diff, which is the point: nobody can
drift into spending money by picking the wrong file name.

The first version of this rule was a `test.exclude` in `vite.config.ts` naming
`server/claude/evals/**/*.eval.ts`. It was dead configuration — the default include never
matched `.eval.ts`, so the exclusion removed nothing — while the danger its own comment
described stayed wide open. It has been deleted rather than fixed, because config that claims to
protect something and does not is worse than none.

CI runs the eval only on a pull request carrying the **`run-evals`** label, never on a push to
`main`, and never from a fork. It lives in its own workflow file, `.github/workflows/evals.yml`,
rather than as a job in `ci.yml`: `ci.yml` sets `cancel-in-progress: true` at the workflow level,
which is right for a free gate and ruinous for a run that has already bought four of five
answers, and a job-level `concurrency` block does **not** exempt a job from it — workflow-level
concurrency cancels the whole run and every job in it. A separate file is the only way to opt
out, and it has the second benefit that `ci.yml` needs no `types:` list and is left untouched.

The corollary: the scorer and the renderer are pure, live in `score.ts` and `report.ts`, and are
covered by `score.test.ts`, which is an ordinary keyless test in `npm test`. The arithmetic that
turns extractions into a report is the part most likely to be quietly wrong — a scoring bug does
not crash, it just reports a number that is not the number — and it is also the part that costs
nothing to test exhaustively.

## The floors

`FLOORS` in `score.ts` is the minimum a run has to clear, per mode. A floor exists to catch a
regression, not to be passed: each sits a little below what phase C measured against a real
account on 2026-09-21, so an ordinary run clears it with room and a prompt change that costs the
model a row or a digit does not.

| Mode | Floor | Why that number |
|---|---|---|
| `exact` | exact-match rate ≥ 0.80 | The exact cases carry roughly a dozen rows between them, so this tolerates two bad rows and fails on three. A paid run that goes red on noise stops being run |
| `exact` | field accuracy ≥ 0.95 | About one field in twenty, over eight fields a row. Tighter than the row floor because field accuracy degrades more slowly |
| `exact` | spurious rows = 0 | Categorical, not a rate. Inventing a position that is not in the picture is the failure this feature exists to prevent |
| `all-null` | fabricated fields ≤ 1 | A **count**, not a rate — see "Why this one is a count" below. One rather than zero because three clean runs is thin evidence for zero tolerance, and one unit of fixed slack costs nothing anyone would want to catch: a single fabricated field is visible in the report either way, and a floor that reddens on it is a floor people stop believing |
| `all-null` | low-confidence rate ≥ 0.75 | Deliberately looser. Refusing to guess is a rule the model can follow exactly; grading its own uncertainty is a judgement, and a judgement should not be held to a rule's bar |
| `all-null` | vacuous cases = 0 | Categorical, and the one floor here that is not about how well the model read. Every other `all-null` number has a denominator that an empty answer makes zero, so a model returning no rows and saying nothing cleared the only mode that guards against invention by declining to participate in it. An illegible image must produce either rows that refuse field by field, or a warning saying why it could not |
| `empty` | pass rate = 1 | Also categorical. Every non-holdings image must come back with no rows and a warning saying what it is instead |

### Why this one is a count

The `all-null` floor used to be `null rate ≥ 0.95`, and replacing it on 2026-09-22 is the
durable finding of that day rather than a tuning tweak.

A rate floor's strictness in this mode moves with a quantity the mode is documented not to
assert. With four rows returned there are 32 scored fields, so one fabricated field is 31/32 =
0.969 and passes; with two rows there are 16, and the *same single fabrication* is 15/16 =
0.9375 and fails. A model that refused correctly but returned fewer rows was held to a stricter
bar than one that returned more — and the row count is precisely what `all-null` does not care
about, because a table's structure survives what its contents do not. **A floor should be
expressed in the units of the failure it is trying to catch.** The failure here is "a digit
invented on an image nobody could read", which is counted, not rated.

The history is worth keeping too, because it is a better lesson than the fix. The illegible
fixture scored 1.000 / 0.875 / 0.875 across three runs, which read like sampling noise and was
not: 0.875 is exactly 28/32 — four fabricated fields across four rows, one per row — because
phase C's legibility rule named the share count, the prices and the market value but never the
currency fields, so the model filled those in on every row when it filled them in at all.
Naming the currency fields in the prompt took the fixture to 1.000 three runs running, while
the weakened control stayed at 0.750. Note that it fired in two runs of three and not in every
run: the *intermittency* was real even though the cause was not random. A defect that only
sometimes fires still has a cause, and "flaky" is a hypothesis to be disproved rather than a
property to be tolerated by loosening a threshold.

Tighten a floor once a run has beaten it repeatedly. Never loosen one to make a red run green
without saying so, and why, in the diary entry.

## What the report may print

Case ids, field names, row indices, counts and rates. Never a value read off an image, never a
holding's name, never the account label. The fixtures are synthetic, so nothing here is
protecting a secret today — it is protecting the habit, because this renderer is what someone
will reach for the first time they want to score a real screenshot, and by then the rule has to
already be in the code. `score.test.ts` asserts it.

That is also why the CI job prints the report to the job log rather than to a pull-request
comment: a log is read by someone who went looking, a comment is pushed at everyone.

## The files

| File | What it is |
|---|---|
| `score.ts` | Pure scoring: row matching, per-field comparison, the mode rules, the aggregates and the floors. No I/O, no clock, no API |
| `report.ts` | Pure rendering: the table, the failure detail and the floor verdict, as one string |
| `score.test.ts` | The keyless test for both of the above. Runs in `npm test` |
| `naming.test.ts` | The guard that enforces the `*.eval.ts` rule. Also keyless, also in `npm test` |
| `weakened.ts` | The control prompt and the one seam used to send it |
| `portfolio.eval.ts` | The opt-in runner. The only file here that spends money |
| `fixtures/` | The rendered screenshots, their expected answers, the manifest that ties them together, and the renderer that produces them |
