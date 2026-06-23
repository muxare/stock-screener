---
id: PLAN-001
type: plan
parent: poc/
source_kind: poc
---

# Project Plan — Technical Stock Screener

Derived from the working prototype in `poc/` (`Stock Screener.dc.html`,
`StockDetail.dc.html`, `market.js`, `support.js`). The POC already runs a full
screen → results → detail → backtest loop against a synthetic universe; this
plan keeps the product surface it proves and quarantines the demo scaffolding.

## Problem
Self-directed technical traders compose, verify, and test screens across
disconnected tools — a screener (e.g. TC2000) to find names, a separate
charting app to confirm them, and spreadsheets or memory to judge whether a
setup actually has an edge. Building a screen, seeing *which* names match and
*why*, confirming it on a chart with the same overlays, and backtesting it are
four contexts. The POC collapses them into one loop: build a rule set (or paste
an existing TC2000 formula), see matches grouped by sector, open any name on an
interactive candlestick chart with the screen's overlays and a per-rule "why it
fired" trace, and backtest the screen's forward returns across history.

## Target users
Active and swing traders and technical analysts who already think in
EMA/SMA/RSI/MACD/Stoch-RSI, price-action patterns, and TC2000 Personal Criteria
Formulas. Power users who build custom indicators and multi-condition setups,
not casual investors who want a tip list.

## Success metrics
(measurable)
- Time to build and run a custom screen from scratch (target: under ~60s).
- Share of pasted TC2000 PCFs that parse and evaluate to the same result the
  user expects (target: high parity on the supported operator/indicator set).
- Screen-run latency over the **production** universe (not the 43-name demo).
- Backtest of a screen over the full universe + history completes within a
  stated time budget.
- User's saved indicators / presets / setups survive across sessions (retention
  of saved artifacts → repeat use).
- Match → detail click-through, and share of sessions that run a backtest.

## Constraints
(include real limits the POC reveals)
- **Indicator math and rule semantics must match the POC exactly** — EMA/SMA/RSI
  (Wilder smoothing)/Stoch-RSI/MACD, AND/OR grouping, bar offsets, cross-overs,
  and the TC2000 PCF dialect. Traders won't trust numbers that disagree with
  TC2000 or the chart.
- Must run on **real market data** with corporate-action adjustment (splits/
  dividends) — the POC's generated data hides this entirely.
- Screening + backtesting must **scale past browser-only compute**; the POC
  computes every indicator for every bar of every name in the client, which
  works for 43 names but not for thousands.
- Compliance: surfaces buy/sell-flavored signals → "not investment advice"
  posture and data-redistribution licensing must be settled before launch.

## Non-goals
(explicit — flows into SAD#1.2 via `/plan-to-sad PLAN-001 SAD-001`)
- **The `dc-runtime` prototyping harness is not the product.** `support.js` and
  the `.dc.html` "deckcode" format are a demo renderer; the real app is the
  React + TypeScript + Vite project already scaffolded in `src/`. Do not carry
  `<x-dc>`, `sc-for`/`sc-if`, or the `data-dc-script` mechanism forward.
- **The synthetic market universe is not a data source.** The seeded
  `mulberry32` random-walk generator, the 43 hardcoded tickers, the faked
  "ends today" weekday dates, and the ~260-bar history are demo fixtures, not a
  feed to be productionized.
- No accounts, auth, or multi-user collaboration in this scope (but see Open
  questions — persistence of saved artifacts likely forces this soon).
- No portfolio/order management, brokerage integration, or real trading.
- No intraday/real-time streaming in v1 (the POC is daily-bar, end-of-day).
- Not a TC2000 clone: full PCF-language coverage beyond the operators the POC
  supports is out of scope unless explicitly committed.

## Open questions
(the "Decide later" pile)
- **Data provider & coverage:** which feed, how many names/markets, EOD vs
  intraday, real-time vs delayed, and how corporate actions are adjusted.
- **Where computation runs:** client, server, or precomputed/materialized
  indicators — and the latency budget for screening the full universe and for a
  full-history backtest.
- **Persistence & accounts:** saved indicators, presets, named setups, and
  watchlists currently live in memory only. Do they persist per-user? Sharable?
  This likely pulls accounts/auth back into scope.
- **Backtest fidelity:** the POC measures naive forward returns at 5/10/20 bars
  with a 30-bar warmup and no costs/slippage/position-sizing/significance test.
  How rigorous must v1 be before results are presentable?
- **Compliance/legal:** market-data redistribution licensing and "not
  investment advice" review.
- **TC2000 PCF parity:** is "paste any PCF" a committed feature with a defined
  supported subset, or a best-effort convenience?

## POC findings

### Demonstrated capabilities (candidate SAD#3 capabilities)
1. **Universe screening with composable rules** — rule sets evaluated with
   AND/OR grouping (`evalGroupedRules`); empty rule set = full universe.
2. **Strategy presets** — built-in library (oversold-in-uptrend, MACD momentum,
   fresh MACD cross, volume breakout, Stoch-RSI turn, trend pullback, and six
   TC2000 setups) **plus** user create/edit/delete of custom presets.
3. **Custom indicator builder** — EMA/SMA/RSI/MACD/Stoch-RSI over a chosen
   source (close/open/high/low/hl2/hlc3/volume) with per-type parameter schema
   and defaults; saved indicators become screenable and chartable.
4. **Setup / condition-group builder** — pairwise comparisons combined with
   AND/OR, each operand carrying a **bar offset** (t−1, t−2…) and optional
   ×mult/+add arithmetic; cross-up/cross-down operators.
5. **TC2000 PCF paste** — `parsePCF` turns pasted Personal Criteria Formula text
   (`C > XAVGC50 AND ...`, `XAVGC18>XAVGC50`, offsets via `.1`, arithmetic) into
   a condition group, with a "Load example" worked sample.
6. **Named screens (chains)** — ordered comparisons like `EMA18 > 50 > 100 > 200`
   saved and reused.
7. **Price-action pattern filters** — consecutive up/down, higher/lower
   highs+lows, inside/outside bar, bull/bear engulfing, gaps, N-bar high/low
   breakouts, RSI bull/bear divergence, doji.
8. **Cross-sectional ranking** — top/bottom percentile by a field, across the
   whole universe or within each sector (excluded from backtests).
9. **Results view** — matches grouped by sector, a session **diff banner**
   ("what changed vs the last screen"), and empty/loosen-a-rule guidance.
10. **Interactive detail chart** — candlesticks with EMA(9/20/50/200) overlays,
    volume/MACD/RSI/Stoch panes, pan/zoom/double-click-reset, panel toggles,
    signal markers where the screen fires, and dashed overlays for custom
    price-scale indicators referenced by rules.
11. **Per-rule explainability** — on the detail screen, each rule shows pass/fail
    plus a "why did this fire" sparkline (`whySpark`) over recent bars.
12. **Stock comparison** — a compare bar + drawer for side-by-side names.
13. **Backtesting** — walk every bar of every name; forward returns at 5/10/20
    horizons with fire rate, win rate, avg/median/best/worst.
14. **Search & quick signals** — ticker/company search; golden/death cross,
    MACD/Stoch crosses surfaced as quick toggles.

### Implied data model (feeds SAD#6)
- **Instrument:** ticker, name, sector; daily OHLCV bars (POC: ~260 days);
  derived price, changePct, 52w hi/lo, `pct52w` (range position), `relVol`.
- **Indicator series per instrument:** EMA(9/20/50/200 + arbitrary windows),
  RSI(14, Wilder), Stoch-RSI(%K/%D), MACD(line/signal/hist), volume SMA(20),
  with per-def caching keyed by a `defSig` signature.
- **Indicator def:** `{ type, source, length, fast, slow, signal, output,
  rsiLen, stochLen, kSmooth, dSmooth }` (only keys relevant to `type` are read).
- **Rule kinds:** `num` / `flag` / `ema` (snapshot-based legacy), `ind`
  (indicator vs const/price/indicator), `chain` (ordered operand comparisons),
  `group` (AND/OR conditions with bar offsets + arithmetic), `pattern`, `rank`
  (cross-sectional). Each carries an optional `conj` for AND/OR grouping.
- **Preset:** `{ id, name, desc, rules[] }`. **Named screen:** name + chain/group.
  **Saved custom indicators** and **per-bar snapshots** for historical eval.
- **Backtest result:** `{ signals, evaluated, fireRate, horizons:[{ h, n, avg,
  median, winRate, best, worst }] }`.

### Load-bearing logic (algorithms/rules to preserve — feeds SAD#5)
All in `poc/market.js` — this is the asset worth keeping verbatim:
- **Indicator math:** `ema`, `sma`, `rsi` (Wilder smoothing), `stochRsi`,
  `macd`/`macdFull`, and `indSeries` (def → cached scalar series).
- **Rule engine:** `evalRuleAt` routing across kinds; `evalGroupedRules` /
  `evalGroupAt` AND/OR grouping; `evalChainAt`, `evalCondAt` (with bar offsets
  and ×mult/+add), `evalIndRuleAt`, `evalPatternAt`; `rankPassSet`.
- **TC2000 PCF parser:** `parsePCF` + `parsePcfOperand`/`parsePcfBase`
  (XAVGC/AVGC/O·H·L·C·V, `.n` offsets, arithmetic, AND/OR).
- **Backtest:** `backtestRules` — per-bar walk with warmup and forward-return
  horizons.
- **Catalogues / schemas** that drive the builder UIs: `INDICATOR_TYPES`,
  `IND_DEFAULTS`, `SOURCES`, `FIELDS`, `FLAGS`, `PATTERNS`, `RANK_FIELDS`,
  `OP_LABELS`, `EMA_WINDOWS`, and the `PRESETS` library.

### POC-to-production gaps (what "Replace" really costs)
- **Data:** swap the seeded generator for a licensed market-data feed with
  historical + (later) live bars and corporate-action adjustment. Touches the
  whole pipeline — every indicator and backtest assumes clean adjusted closes.
- **Runtime:** rebuild the two `.dc.html` screens as real React/TS components in
  `src/`; the indicator/rule/backtest engine (`market.js`) ports largely as-is
  since it is a dependency-free pure ES module.
- **Compute & scale:** decide client vs server vs precomputed; the POC's
  "compute everything in the browser" approach is the single biggest thing that
  does not survive a universe of thousands of names.
- **Persistence:** saved indicators/presets/screens are in-memory; production
  needs storage and (probably) accounts.
- **Rigor & compliance:** backtest needs costs/slippage/significance before it's
  presentable as an "edge"; data licensing and the not-investment-advice posture
  need legal sign-off.
