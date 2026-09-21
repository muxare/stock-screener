# portfolio-backfill

Reads a folder of brokerage screenshots through the **Message Batches API** and
writes what Claude made of each one as JSON, for a human to check.

```bash
ANTHROPIC_API_KEY=... npm run portfolio:backfill -- ~/screenshots
ANTHROPIC_API_KEY=... npm run portfolio:backfill -- ~/screenshots --out /tmp/holdings --poll 15
MARKETDATA_DB=./yahoo-market.db npm run portfolio:backfill -- ~/screenshots
```

## Why a batch rather than a loop of requests

A year of monthly account screenshots is fifty-odd images. None of them is
urgent, every one of them is the same request shape, and the Batches API prices
exactly that at half the interactive rate with results inside the hour. Sending
them one at a time would cost twice as much to get an answer nobody is waiting
for. This is the interactive route's cheaper sibling, not a different reader:
the model, the prompt, the schema and the validation all come from
`server/claude/portfolio/`, imported rather than restated, so a backfilled
holding is exactly as trustworthy as one read live.

## What it does differently, and why

**It does not retry.** The live route repairs a failed validation in a second
turn because somebody is waiting and a repair is cheaper than a failure they have
to look at. Here nobody is waiting: an item that fails validation is reported
with its problems, and re-running it is a new batch that costs nothing but time.

**It confirms nothing.** Everything it writes is a proposal. Stage 5 of
`docs/platform-hardening-plan.md` is where a confirmed holding gets a durable
home; until that exists, writing into one would create a second, unreviewed
source of truth — precisely what the confirm-before-storing rule exists to stop.

**Its price check is optional.** With `MARKETDATA_DB` set, the database is opened
read-only and an average price is checked against what the instrument has
actually traded at, the same check the service makes. Without it, the arithmetic
checks still run and the price check is skipped rather than faked.

## Output

`<folder>/extracted/` (or `--out`) gets one `<screenshot>.json` per image and a
`summary.json`:

```jsonc
{
  "customId": "2026-01.png",
  "ok": false,
  "extraction": { "accountLabel": "ISK", "holdings": [ /* … */ ], "warnings": [] },
  "problems": ["row 3 (VOLV-B): shares (100) x last price (241.5) is 24150.00, but the market value reads 2415"],
  "failure": null
}
```

`ok` is true only when the item parsed **and** passed every check. `problems`
carries the checks it failed; `failure` is set instead when the item produced no
answer at all (the API rejected it, the batch was cancelled, or it expired).

Results are keyed by the screenshot's file name, never by position — the API
returns items in whatever order they finished, and reading them positionally is
how a backfill files one month's holdings under another month's date.

## Screenshots are financial data

The images are read, encoded and sent; they are never written anywhere by this
tool and never logged. The output files contain your holdings, so `--out` should
point somewhere you are happy for them to sit. Nothing under this folder is
committed: the repository's `.gitignore` does not cover an arbitrary `--out`
path, so choose one outside the working tree if you are unsure.
