# Acronym & Abbreviation Index — stock-screener

A glossary of the acronyms and abbreviations used across this project. Meanings are
grounded in how each term is actually used in *this* codebase — not generic definitions.
Grouped into: (1) tech stack & tooling, (2) finance / stock-screening domain,
(3) project workflow & governance, and (4) short identifiers that recur in the code.

> Note on indicator coverage: the rule engine implements **only** EMA, SMA, RSI, MACD,
> and Stochastic RSI. There is intentionally no VWAP / ATR / ADX / Bollinger / etc.

---

## 1. Tech stack & tooling

| Acronym | Stands for | Where / context |
|---|---|---|
| **TS** | TypeScript | Used throughout; `CLAUDE.md` ("TS + Python tooling") |
| **JS** | JavaScript | `poc/market.js`, `poc/support.js` |
| **UI** | User Interface | `CLAUDE.md`, `src/lib/market.ts` ("builder UI"), `src/components/` |
| **API** | Application Programming Interface | `server/index.ts` (HTTP/JSON API), `CLAUDE.md` |
| **HTTP** | HyperText Transfer Protocol | `server/index.ts`, `tools/yahoo-fetch/*` (retry on 429/5xx) |
| **JSON** | JavaScript Object Notation | Config files, `server/index.ts`, node identity in `dag/node.ts` |
| **NDJSON** | Newline-Delimited JSON | `/backtest` streaming response (`application/x-ndjson`) |
| **CSV** | Comma-Separated Values | `tools/eod-import/*`, `server/devImport.ts` (CSV upload/import) |
| **SQL / SQLite** | Structured Query Language / SQLite embedded DB | `tools/eod-import/db.ts`, `src/lib/data/sqlite.ts` (`node:sqlite`) |
| **DB** | Database | `dev-market.db`, `yahoo-market.db`, `MARKETDATA_DB` |
| **DAG** | Directed Acyclic Graph | `src/lib/dag/*` — the computation-DAG indicator engine |
| **SPA** | Single-Page Application | `SAD-001` ("React + TS + Vite SPA") |
| **HMR** | Hot Module Replacement | `README.md` (Vite dev server) |
| **SWC** | Speedy Web Compiler | `README.md` (Vite React plugin option) |
| **Oxc** | Oxidation Compiler | `README.md` (compiler behind `@vitejs/plugin-react`) |
| **CLI** | Command-Line Interface | `tools/*/README.md`, `eod-import` |
| **SDK** | Software Development Kit | `SAD-001` ("no vendor SDK") |
| **DOM** | Document Object Model | Purity notes in `market.ts` / `dag/node.ts` ("no DOM") |
| **ES module** | ECMAScript module | `market.ts` ("dependency-free pure ES module") |
| **I/O** | Input / Output | Purity notes across `dag/` and `market.ts` |
| **IP** | Internet Protocol (address) | `SAD-001` §8.8 (HTTP 429 throttling from a dev IP) |
| **URL** | Uniform Resource Locator | `server/index.ts` (`req.url`), `buildChartUrl` |
| **MiB** | Mebibyte | `server/index.ts` (`MAX_BODY_BYTES`, body-size limits) |
| **CI** | Continuous Integration | `SAD-001` §2.1, `tools/yahoo-fetch/README.md` ("no live network in CI") |
| **ToS** | Terms of Service | `SAD-001` §8.8 (Yahoo endpoint "ToS bars redistribution") |
| **MVP** | Minimum Viable Product | `SAD-001` §8.8 (data-source decision) |
| **CRUD** | Create, Read, Update, Delete | `SAD-001` §3.2 (presets: built-in + custom CRUD) |
| **p50 / p95** | 50th / 95th percentile (latency) | `server/metrics.ts`, `server/README.md` |
| **MCP** | Model Context Protocol | `agentic-sprint-planning.md` (connectors) |
| **PR** | Pull Request | `agentic-sprint-planning.md` |
| **v8** | version 8 (Yahoo `chart` endpoint) | `tools/yahoo-fetch/README.md` |

**Environment variables:** `NODE_ENV`, `DEV_TOOLS`, `PORT`, `MARKETDATA_DB`
(`server/universe.ts`, `server/index.ts`, `package.json`).

---

## 2. Finance / stock-screening domain

The indicators and terms the rule engine actually implements
(`src/lib/market.ts`, `src/lib/dag/`).

| Acronym | Stands for | Where / context |
|---|---|---|
| **EOD** | End Of Day (daily bars) | `package.json` (`eod:import`), `tools/eod-import`, `SAD-001` §1.2 |
| **OHLC** | Open, High, Low, Close | `interface OHLC` — the pure per-bar shape |
| **OHLCV** | Open, High, Low, Close, Volume | `market.ts`, `dag/eval.ts` (`Bars`), `eod-import` schema |
| **EMA** | Exponential Moving Average | `ema()`, `INDICATOR_TYPES.ema`; windows 5…200 + arbitrary |
| **SMA** | Simple Moving Average | `sma()`, `INDICATOR_TYPES.sma`; used for volume average |
| **MA** | Moving Average | PCF parser comments (`XAVG…` = exponential MA, `AVG…` = simple MA) |
| **RSI** | Relative Strength Index | `rsi()` (Wilder smoothing, default length 14) |
| **MACD** | Moving Average Convergence / Divergence | `macd()` / `macdFull()`; default 12/26/9; outputs line / signal / hist |
| **Stoch RSI** | Stochastic RSI | `stochRsi()`, `INDICATOR_TYPES.stochrsi`; outputs %K / %D |
| **%K / %D** | Stochastic %K and %D lines | `stochRsi` returns `{ k, d }`; `kSmooth` / `dSmooth` params |
| **hist** | (MACD) Histogram | `macdHist`, MACD output option |
| **hl2** | (High + Low) / 2 — "Median" price | `SOURCES`, `srcArr()`, `RAW_SOURCE.hl2` |
| **hlc3** | (High + Low + Close) / 3 — "Typical" price | `SOURCES`, `srcArr()`, `RAW_SOURCE.hlc3` |
| **relVol** | Relative Volume (today's vol ÷ 20-bar avg vol) | `Stock.relVol`, `FIELDS.relVol`, `RANK_FIELDS` |
| **volAvg20** | 20-period Volume Average (SMA of volume) | `Stock.ind.volAvg20` |
| **pct52w** | Percent position within the 52-week range (0–100) | `pct52w`, `FIELDS.pct52w` ("52w range position") |
| **hi52 / lo52** | 52-week High / 52-week Low | `Stock.hi52`, `Stock.lo52` |
| **changePct** | Percent change today (vs prior close) | `Stock.changePct`, `FIELDS.changePct` |
| **pPriceEma20/50/200** | Percent of Price vs EMA20 / 50 / 200 | `Snapshot`, `FIELDS.pPriceEma*` |
| **golden cross / death cross** | EMA50 crossing above / below EMA200 | `Stock.goldenCross` / `deathCross` |
| **adjClose** | Adjusted Close (corporate-action-adjusted) | `tools/yahoo-fetch/*`; mapped to `bar.c` |
| **ETF** | Exchange-Traded Fund | `SAD-001` §8.8 (~7.2k US stocks + 1.3k ETFs) |
| **PCF** | Personal Criteria Formula (TC2000's screening formula language) | `parsePCF()`; `SAD-001` §3.5 |
| **TC2000** | The TC2000 charting/screening platform (Worden) | `PRESETS` (`tc_bounce_long`, …), PCF parser |
| **XAVGC / XAVGO…** | eXponential AVeraGe of Close / Open… (PCF token) | `parsePcfBase()` → EMA node |
| **AVGC / AVGV…** | AVeraGe (simple) of Close / Volume… (PCF token) | `parsePcfBase()` → SMA node |
| **O / H / L / C / V** | Open / High / Low / Close / Volume per-bar fields (`.n` = n bars ago) | `PCF_SRC`, `OPERAND_FIELDS` |
| **Wilder** | Wilder's smoothing (RSI method) | `SAD-001` §2.1 / §6.2 |

**DAG level shorthand** (`src/lib/dag/node.ts`):

- **L0** — raw sources (OHLCV + hl2/hlc3); no inputs.
- **L1** — aggregations over raw sources (ema/sma/rsi, rollingMean/rollingSum).
- **L2+** — composites whose inputs include aggregations (macd/stochrsi/relVol/priceVsEma).

---

## 3. Project workflow & governance

From `workflow/` and `backlog/` — the lightweight agentic-Scrum board system.

| Acronym | Stands for | Where / context |
|---|---|---|
| **SAD** | Software Architecture Document | `backlog/sad/SAD-*.md`; the binding architectural contract, cited as `SAD#<n>` |
| **ADR** | Architecture Decision Record | `SAD` §8, `ADR-001`…`ADR-010` |
| **CAP** | Capability | `SAD` §3 (`CAP-screen`, `CAP-dag-model`, `CAP-eod-fetch`, …) |
| **EPIC** | Epic (top of backlog hierarchy) | `backlog/epics/EPIC-*.md` |
| **FEAT** | Feature | `backlog/features/FEAT-*.md` |
| **STORY** | User story (board work item) | `backlog/board/**/STORY-*.md` |
| **IDEA** | Idea (captured, un-committed scope) | `backlog/ideas/IDEA-*.md` ("capture ≠ commit") |
| **PLAN** | Plan | `backlog/plans/PLAN-*.md` |
| **RETRO** | Retrospective | `backlog/retros/RETRO-*.md`, `/sprint-retro` |
| **BATCH** | Batch (a committed sprint slice) | `backlog/batches/BATCH-*.md`; an active sprint with a `wip_limit` |
| **WIP** | Work In Progress | `CLAUDE.md`, `workflow/CLAUDE.md` (safe-parallelism ceiling; `wip_limit`) |
| **PO** | Product Owner (planning lens) | `workflow/CLAUDE.md`, `agentic-sprint-planning.md` |
| **SM** | Scrum Master ("parallelization architect" lens) | `workflow/CLAUDE.md` |
| **DoR** | Definition of Ready | `workflow/CLAUDE.md` |
| **DoD** | Definition of Done | `agentic-sprint-planning.md` |
| **A1 / A2 / A3** | Autonomy tiers (agent freedom levels; A2 is default) | `workflow/docs/autonomy-tiers.md` |
| **R-1** | The R-1 code-review gate (enforced on `move review` / `done`) | `workflow/CLAUDE.md`, `autonomy-tiers.md` |
| **POC** | Proof Of Concept (the prototype in `poc/`) | `SAD-001`, `market.ts` header |
| **WSJF** | Weighted Shortest Job First (prioritization scoring) | `agentic-sprint-planning.md` |
| **UX** | User Experience | `agentic-sprint-planning.md` |
| **w.r.t.** | with respect to | `server/index.ts`, `SAD` §4.2 ("stateless w.r.t. user identity") |
| **TBD** | To Be Determined | `SAD-001` §5.10 (vendor adapter "TBD") |

> **Example-only** (appear solely as sample idea artifacts in `workflow/docs/ideas/`,
> not part of the app): **RBAC** (Role-Based Access Control), **TOC** (Table Of Contents),
> **OpenAPI** (Open API Specification).

---

## 4. Short identifiers in the code

Recurring abbreviations in type names, enums, and locals — handy when reading `market.ts`.

| Identifier | Meaning | Where |
|---|---|---|
| `ind` / `IndicatorDef` / `indSeries` / `indExtra` | indicator (definition / computed series / extra windows) | `market.ts` |
| `def` / `defSig` | indicator descriptor / its structural signature (cache key) | `market.ts`; `nodeKey` in `dag/node.ts` |
| `conj` | conjunction (`'and'` \| `'or'`) joining rules | `Rule`, `Condition` |
| `snap` / `snapAt` / `Snapshot` | per-bar snapshot of computed values | `market.ts` |
| `osc` / `center` / `price` | oscillator pane / centered pane / price-axis overlay (indicator scale) | `INDICATOR_TYPES[*].scale` |
| `fast` / `slow` / `signal` | MACD fast/slow EMA periods + signal-line period | `IND_DEFAULTS.macd` |
| `rsiLen` / `stochLen` / `kSmooth` / `dSmooth` | RSI length / stochastic length / %K & %D smoothing | Stoch-RSI params |
| `mult` / `add` | per-operand multiply / add arithmetic | `Operand`, PCF parser |
| `_indCache` / `_dagCache` / `_rsiBT` / `_pcfEma` / `_pcfAvgv` | lazily-attached caches | `Stock`, `market.ts` |
| `hi` / `lo` / `rng` / `vol(s)` | high / low / range / volume(s) | `market.ts` locals |
| `cross_up` / `cross_down` / `gt` / `lt` / `gte` / `lte` / `eq` / `neq` | operator enum values (crosses above/below; >, <, ≥, ≤, ≈, ≠) | `OP_LABELS`, `RelationalKind` |
| `warmup` | leading bars with insufficient history (indicator not yet defined) | `backtestRules` |
| `horizons` / `fireRate` / `winRate` | forward-return horizons / signal fire rate / win rate | `BacktestResult`, `HorizonStat` |
| `elapsedMs` / `budgetMs` / `overBudget` | elapsed/budget milliseconds; over-budget sample count | `server/metrics.ts` |
| `facts` | universe count + sector facet counts (`/facts` endpoint) | `server/index.ts` |
| `whySpark` | per-rule "why did this fire" sparkline trace | `SAD` §3.10, `ui/Spark.tsx` |
| `kind` / `NodeKind` / `NodeFamily` | discriminant tag on rules / DAG node taxonomy | `market.ts`, `dag/node.ts` |
| `lower` / lowering | compiling `IndicatorDef`s down into DAG nodes | `src/lib/dag/lower.ts` |

---

*Generated from a read-only sweep of the repo. To verify any entry, the richest sources
are `src/lib/market.ts` (indicators, fields, presets, PCF parser), `src/lib/dag/node.ts`
(DAG taxonomy), `server/index.ts` + `server/metrics.ts` (API/latency), and
`backlog/sad/SAD-001.md` + `workflow/CLAUDE.md` (governance).*
