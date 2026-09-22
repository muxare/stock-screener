# Portfolio screenshot fixtures

The images in this folder are the input side of the screenshot-reader eval built in phase D
of `docs/cca-f-learning-plan.md`. Each one is paired with the answer a correct extraction
would produce, and `manifest.json` is the contract between the two halves: the runner reads
it, loads each image and its expected file, and scores the model's answer according to the
case's `mode`.

## What the set measures

Five cases, chosen so that each one fails for a different reason, which is the only way a
regression tells you anything:

| Case | Mode | What it measures |
|---|---|---|
| `four-positions-sek` | `exact` | The baseline. Four legible rows in one currency, Swedish thousands spaces and decimal commas parsed correctly, and a `Totalt värde` summary row that is not a position and must not become one. |
| `mixed-currency` | `exact` | That `currency` and `valueCurrency` stay separate questions. A US holding in a Swedish account prints USD prices beside a value in kronor, and reading those as one currency is what made `validate.ts` call a correctly-read row a misread on 2026-09-21. |
| `mild-blur` | `exact` | Calibration. The digits of the baseline survive a gentle resampling blur, so the numbers must still be right; what is expected to move is the confidence. |
| `unreadable` | `all-null` | Refusal. The same table degraded until no glyph resolves. Every field must come back `null` with `low` confidence, because a plausible invented share count is the failure this feature exists to avoid. |
| `not-holdings` | `empty` | That the model refuses a page from the same app that is not a holdings table. No positions may be invented from a sector breakdown, and a warning must name what the image actually shows. |

`mode` is what the runner asserts, and it is deliberately narrower than "the JSON matches":

- **`exact`** — every data field of every row must equal the expected file, in order.
- **`all-null`** — every holding field must be `null` and every row's confidence `low`. The
  row count is *not* asserted: phase C found that the table's structure survives a
  degradation its contents do not, so four empty rows and zero rows are both honest answers
  and neither is the thing under test.
- **`empty`** — no holdings at all, plus a warning that names what the image shows.

Two fields in the expected files are documentation rather than assertions, in every mode.
`confidence` is reported by the scorer as its own metric — the plan's "mean confidence on
the fields that were wrong" is the number that says whether confidence means anything — so
asserting it as an exact match would destroy the measurement. `warnings` are free prose
about the image as a whole; the strings in the expected files show what a good warning says,
and only the `empty` case asserts that one exists.

## How to regenerate

```bash
npm run eval:fixtures     # runs server/claude/evals/fixtures/render.ts
```

The script renders every page under `src/` with the copy of Chrome already installed on the
machine and derives the two degraded variants with macOS `sips`. It is idempotent: each run
deletes its outputs and rebuilds them from source, so running it twice produces the same
bytes and a half-finished run leaves nothing stale behind. It fails with a named path if
Chrome or `sips` is missing rather than producing a partial set.

Adding a case means writing `src/<id>.html`, adding it to `RENDERS` in `render.ts` with a
window size large enough to hold the whole card, writing `<id>.expected.json`, and adding an
entry to `manifest.json`. Then look at the PNG. Chrome has no fit-to-content flag, so a
window a few pixels too short silently crops the table — which is how the first run of this
set cut the `Totalt värde` row off the bottom of two fixtures.

The PNGs are committed even though they are a build product. The eval has to run on a
machine that has no Chrome, the whole set is under 350 kB, and a fixture whose bytes can
change between two people's machines is not a fixture.

## Why rendered, not redacted

Phase C's live pass ran against a real Avanza ISK account, and those screenshots are the only
ones this repository has ever seen. They live outside git on purpose and none of them was
used to build anything here.

Redacting them would have been the cheap route and it is the wrong one, because the digits
are precisely what the eval measures: a screenshot with the numbers blacked out has no
expected answer left in it. So the set is built the other way round — from an expected answer
outwards. Every name, ticker, share count, price and total below is invented, the arithmetic
is made to hold so that a failing run means the model misread something rather than that the
fixture was odd, and the page that produced each image is checked in beside it.

The rule that follows, and it is in `.claude/rules/claude.md` as well: **no real account
material ever enters this folder** — not a screenshot, not a crop, not a redaction, not a
single real holding name or quantity copied into an HTML page. If a real screenshot reveals a
defect, the fix is a new synthetic case that reproduces it, which is what `mixed-currency` is.
