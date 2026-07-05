# Sprint Planning for a Team of Agents

*A brainstorm on reframing Scrum roles when the "team" is a fleet of Claude Code agents.*

Status: working draft for the team · Last updated: 2026-07-04

> **Repo note (2026-07-04):** this repo's `workflow/` system already implements
> these four lenses as a read-only advisory panel (`product-owner-lens`,
> `dev-team-lens`, `scrum-master-lens`, `claude-code-leverage`) wired into the
> `board.py` gate machine, SAD-anchored stories, and autonomy tiers. The one
> substantive change made from this brainstorm was to **flip `scrum-master-lens`**
> from a capacity/WIP-limiting role into the *parallelization architect* described
> in Lens 3: it now produces a parallelization map (parallel lanes vs a serialized
> spine), split-for-parallelism recommendations, and re-frames WIP as a
> safe-parallelism ceiling (integration + review-bandwidth risk, not throughput).
> `dev-team-lens`, `claude-code-leverage`, and the `/sprint-plan` + `/sprint-retro`
> ceremonies were reconciled so the division of labor is clean: **dev-team** gives
> the coupling read → **scrum-master** builds the parallelization map → **claude-code-leverage**
> turns it into worktree/tier/reviewer mechanics. The sections below are the
> reasoning behind that flip.

---

## The core reframe

Classic Scrum is built around one scarce resource: **human attention**. Almost every ceremony and rule exists to protect it. WIP limits stop people thrashing. The Scrum Master shields the team from overcommitment. Story points estimate how much a fixed-size team can absorb. The whole machine is tuned to keep a small number of humans from being overwhelmed.

When the delivery team is a fleet of agents, that scarce resource largely disappears. Agent attention is cheap, elastic, and parallelizable — you can spin up ten workers as easily as one. But the constraints don't vanish; they **move**. The new binding constraints are:

1. **Integration risk** — parallel edits collide; merges conflict; the build breaks when independently-correct changes meet.
2. **Context coherence** — every agent needs the same picture of the architecture, conventions, and contracts, or the outputs drift apart.
3. **Human review bandwidth** — a human still has to trust what ships. This is now the tightest bottleneck, not the coding.
4. **Cost and rate limits** — a wide fan-out is real money and real API throughput.
5. **Coherence of intent** — more hands means more ways to quietly diverge from what the product actually needs.

So the job of sprint planning flips from *"how do we avoid taking on too much?"* to *"how do we decompose work so the maximum amount can run safely in parallel, and so the human at the end can trust it without reviewing every line?"*

Each of the three traditional roles gets re-pointed at this new constraint set, and a fourth lens is added for the tooling itself. The four lenses below are **planning perspectives**, not necessarily four separate people — one person (you) can wear all four, ideally with an agent backing each one.

---

## Lens 1 — Product Owner: vision and a prioritized backlog

The PO's mandate is the least changed, but it can afford to think **bigger**, because delivery capacity is no longer the ceiling.

**Two horizons, two artifacts.**

- **Long plan — the vision (`VISION.md`).** A durable North Star: what the product is for, who it serves, the handful of outcomes that matter this quarter/half, and the things we're explicitly *not* doing. This is the anchor every agent can be pointed at so their local decisions ladder up to something coherent.
- **Short plan — a rolling Now / Next / Later backlog.** The next sprint's committed items sit in *Now*, groomed with real acceptance criteria. *Next* and *Later* stay coarser. Because agents can chew through work fast, keep the backlog **deeper than you would for a human team** — you want enough ready, well-specified work that a fan-out never stalls waiting for grooming.

**Own and prioritize the backlog.** Priority is where the PO earns their keep. A lightweight scoring model works well because it can be applied by an agent: value × confidence ÷ effort, with an explicit risk/urgency bump (a WSJF-style ordering). The output isn't just an ordered list — it's an ordered list *with rationale*, so the parallelization lens downstream understands what can slip and what can't.

**Machine-legible stories are the deliverable.** The single highest-leverage change the PO makes for an agent team: write stories that an agent can execute **without a hallway conversation**. That means explicit acceptance criteria, concrete examples, named files or surfaces where known, and a definition of done. A vague story that a human would clarify by asking becomes a source of drift when handed to an agent. Treat every backlog item as a spec.

---

## Lens 2 — Development Team: owning the code and pushing back on the product

This lens looks at the system *as it actually is* — the state of the code, the technical debt, the architectural risk — and it **owns the product from the technical side**. Crucially, it doesn't just take orders; it feeds work *upward* into the backlog and pushes back on the PO when the tech reality demands it.

**Keep a living technical picture.** A standing artifact (`TECH_HEALTH.md` or a debt register) that tracks: churn hotspots, complexity, test coverage gaps, flaky areas, dependency/version risk, `TODO`/`FIXME` density, and known architectural strain. With agents this can be *continuously* maintained — a surveyor agent re-scans the repo each sprint and updates the register, so it's never stale.

**Tech generates its own backlog.** The debt register isn't a diary; it's a **source of backlog items** — refactors, test-coverage work, dependency upgrades, and *enablers* (architecture that has to exist before a feature can be built well). These items compete for priority alongside the PO's feature work. This is the mechanism by which the code "influences the product": the Dev Team lens converts technical reality into prioritizable items with a clear value/risk story the PO can weigh.

**The negotiation is the point.** Each sprint, the PO's feature backlog and the Dev Team's tech backlog get merged into one ordered list. The healthy tension — ship features vs. pay down debt vs. build enablers — is exactly what you want surfaced at planning, not discovered mid-sprint. For an agent team there's a bonus: because capacity is elastic, some debt paydown can run *in parallel* with feature work rather than competing for a fixed budget, as long as it touches disjoint code (see Lens 3).

**Tech owns the definition of "done well."** Coding standards, architectural guardrails, and the non-negotiables (test coverage, no secrets in edits, migration discipline) belong to this lens. In an agent world these shouldn't live only in prose — they become enforced gates (see the appendix on hooks).

---

## Lens 3 — Scrum Master, flipped: the Parallelization Architect

This is the biggest inversion. The traditional Scrum Master limits intake so the team isn't overwhelmed. Here, the team can't be overwhelmed the same way — so this lens does the **opposite**: it looks at the PO's prioritized backlog and finds everything that can safely run **in parallel**, then shapes the work so Claude Code can spawn a fleet of agents to attack it at once. The constraint it manages is no longer *cognitive load* but *integration risk*.

**Three jobs each sprint.**

*1. Map the dependency graph.* Turn the ordered backlog into a DAG. What genuinely depends on what? Most backlogs are drawn as a straight line when the real structure is a wide, shallow tree with a few serial spines. The independent branches are your parallel lanes.

*2. Score each item for parallelizability.* For every candidate, ask:

- **Blast radius** — how many files/modules does it touch?
- **Shared-state overlap** — does it edit files other in-flight work also edits (schema, routing, config, shared types)? High overlap = serialize it.
- **Contract dependency** — does it need an interface/type/API that doesn't exist yet?
- **Reviewability** — can a human verify the result quickly in isolation?

Low blast radius + no shared-state overlap + no missing contract = a safe parallel lane. High overlap on hot shared files = pull it into a serialized "spine."

*3. Split stories for parallelism, then produce a fan-out plan.* This is the creative core of the role.

**Story-splitting heuristics for parallelism** (distinct from splitting for size):

- **Contract-first slicing.** Do *one* serialized task that defines the shared surface — the API signature, the TypeScript types, the DB schema, the event shape. Once the contract exists and is committed, N tasks implement against it **in parallel** without colliding. This single move unlocks most fan-outs.
- **Slice along file/module boundaries.** Prefer splits where each slice owns a disjoint set of files. Two agents editing different modules never merge-conflict; two agents editing the same file usually do.
- **Separate the spine from the limbs.** Risky shared files (config, routing tables, migrations, DI wiring) go into a serialized spine task done *first and alone*. The independent limbs fan out after.
- **Split by layer only when layers are contract-separated.** Frontend + backend can go parallel *if* the API contract is fixed first; otherwise they thrash.
- **Fan out the "wide and shallow" naturally.** Per-endpoint, per-component, per-table-migration, per-file test coverage, docs, and independent bug fixes are almost always parallel-safe and make great fleet work.

**The deliverable** is a *fan-out plan*: which items run in parallel lanes, which are serialized and in what order, the isolation strategy (worktree per lane), the merge/integration order, and a set of ready-to-dispatch, self-contained **task specs** — one per agent, each carrying its own acceptance criteria and file scope.

**The flipped WIP limit.** There is still a limit — it just isn't cognitive. The real ceiling is *how many parallel lanes can land before the merge queue, the CI, or the human reviewer becomes the bottleneck.* That's the number this lens tunes. Too few lanes wastes elastic capacity; too many floods review and turns integration into a merge nightmare. Finding that number each sprint is the new Scrum Master craft.

---

## Lens 4 — The Claude Code lens: leveraging the tooling itself

The fourth lens exists because the platform is part of the process. It asks: **how do we use Claude Code and the Claude API to make the whole loop faster and more reliable?** Conceptually it maps each role above onto a concrete mechanism; the appendix gives the exact features.

- **Each planning lens gets a backing subagent.** A `product-owner` agent that grooms `VISION.md` and the backlog; a `tech-surveyor` agent that keeps the debt register fresh; a `parallel-planner` agent (the flipped Scrum Master) that ingests the backlog and emits the fan-out plan and task specs. Roles become reusable, versioned prompts living in the repo.
- **Planning happens in plan mode; execution fans out into worktrees.** Do the thinking read-only and reviewable, approve it, then dispatch the parallel lanes into isolated git worktrees so they can't corrupt each other.
- **Quality gates are enforced, not requested.** Tests, lint, and "don't touch these files" become hooks that block a bad edit automatically, so the human reviewer only ever sees work that already passes the bar.
- **Scale and cost are deliberate.** Small fan-outs run as parallel subagents in one session; large, mechanical fan-outs (mass test generation, sweeping refactors) move to the SDK / headless orchestration or the Batch API at half price. Cheap models do the surveying; strong models do the risky design.

---

## Reframing the ceremonies

| Ceremony | Human-team version | Agent-team version |
|---|---|---|
| **Backlog refinement** | Clarify stories enough to estimate | Make stories *machine-executable* — full acceptance criteria, file scope |
| **Sprint planning** | Commit to what fits capacity | PO prioritizes → Dev injects tech items → SM produces fan-out plan + task specs → dispatch fleet |
| **Daily standup** | People report progress/blockers | Automated status roll-up across agent sessions; human triages what needs input |
| **Review** | Demo finished work | Human reviews merged output — *the scarce resource*; keep PRs small and independent |
| **Retro** | Improve team process | Analyze what parallelized cleanly vs. what caused merge/integration pain; refine splitting heuristics |

The sprint-planning session itself has a new shape: **(1)** PO presents the prioritized backlog with rationale; **(2)** Dev Team injects tech-debt/enabler items and flags anything technically blocking; **(3)** the merged list is ordered; **(4)** the Parallelization Architect turns the top of the list into a fan-out plan — dependency DAG, lanes, spine, isolation, merge order, task specs; **(5)** dispatch. Steps 1–4 are exactly where the four lenses collaborate.

---

## New metrics to watch

Because the constraints moved, the metrics should too. Velocity in points matters less than:

- **Parallelism ratio** — average lanes in flight vs. serialized work. Low ratio means the backlog isn't being sliced for parallelism.
- **Merge-conflict / integration-failure rate** — the direct signal that splitting or isolation was wrong.
- **Review latency & rework rate** — is the human bottleneck keeping up, and how often does merged work bounce back?
- **Cost per shipped story** and **rate-limit hits** — is the fan-out economically sane?

A rising merge-conflict rate is the canonical sign the Parallelization Architect split along the wrong seams — feed it into the retro.

---

## Risks and guardrails

- **Agents stepping on each other** → worktree isolation per lane; contract-first; a serialized spine for hot shared files.
- **Context drift / incoherent outputs** → one shared source of truth (`CLAUDE.md`, committed contracts) that every agent reads; define interfaces before fanning out.
- **Human review becomes the bottleneck** → keep parallel PRs small, independent, and individually verifiable; batch and templatize review; don't open more lanes than review can absorb.
- **Runaway cost / rate limits** → cap fan-out width; cheap models for surveying, strong models for design; Batch API for bulk mechanical work.
- **Silent quality regressions** → enforce tests/lint via hooks so nothing merges below the bar; gate subagent completion.

---

*(Concrete Claude Code mechanics — subagents, worktrees, hooks, slash commands, plan mode, CLAUDE.md, MCP, the Agent SDK, and the Batch API — are in the appendix below.)*

---

# Appendix — Concrete Claude Code implementation

This layer maps the four lenses onto real Claude Code features. Feature names and limits below reflect the current Claude Code / Agent SDK docs as of mid-2026; verify specifics against the linked docs before relying on them, since the platform moves fast.

## A. Roles as subagents

Define each planning lens as a **subagent**: a Markdown file with YAML frontmatter in `.claude/agents/` (project-scoped, committed to the repo) or `~/.claude/agents/` (personal). The body is the subagent's system prompt.

Frontmatter fields worth using:

- `name`, `description` (required)
- `model` — alias (`opus`, `sonnet`, `haiku`) or full ID. Put strong models on the risky lenses (planner, architecture) and cheap ones on mechanical lenses (surveyor).
- `tools` — allowlist to constrain what a role can touch (e.g., the surveyor gets read-only tools only).
- `isolation: worktree` — give the subagent its own git checkout (see §C).

Suggested repo layout:

```
.claude/agents/
  product-owner.md      # grooms VISION.md + backlog, scores priority
  tech-surveyor.md      # read-only; refreshes TECH_HEALTH.md each sprint
  parallel-planner.md   # the flipped Scrum Master; emits the fan-out plan
  implementer.md        # executes a single task spec in a worktree
  reviewer.md           # checks a merged lane against acceptance criteria
```

Invoke a specific one by naming it ("Use the parallel-planner agent to fan out the top 8 backlog items"). Independent subagents run **concurrently** — a fan-out finishes in the slowest lane's time, not the sum.

**Limits to plan around:** subagent nesting is capped (an agent deep in the tree can't keep spawning children), and a very wide fan-out from a single session can hit API rate limits. For dozens+ of agents, don't fan out from one conversation — use the SDK/Workflow path in §H.

## B. Planning in plan mode

Run the PO grooming and the parallel-planner in **plan mode** (Shift+Tab to toggle, or `/plan`). The agent explores the repo read-only and proposes a plan without editing source. You review/edit the plan before approving — ideal for signing off a fan-out plan *before* any agent starts writing code. Approve to switch into an execution permission mode.

## C. Isolation with git worktrees

The Parallelization Architect's isolation strategy is implemented with **worktrees**: each parallel lane runs in its own git checkout so simultaneous edits can't collide. Set `isolation: worktree` in the subagent frontmatter, or ask for it per task ("use worktrees for these agents"). Temporary worktrees are cleaned up automatically when an agent finishes without changes. Note that untracked files (`.env`, local config) aren't copied into a worktree by default — use a `.worktreeinclude` (gitignore syntax) if a lane needs them.

This is the mechanical backstop for the "don't step on each other" guardrail: disjoint file scope *plus* worktree isolation is what makes wide fan-outs safe.

## D. Quality gates as hooks

Turn the Dev Team's "done well" standards into **hooks** so they're enforced, not merely requested:

- **PreToolUse** — fires before a tool runs; can `deny` an action. Use it to hard-block edits to protected files (secrets, migrations) regardless of permission mode.
- **PostToolUse** — fires after a tool succeeds; receives the tool input and result. Use it to run lint/tests after an edit and feed failures back into the agent's context so it self-corrects.
- **Stop / SubagentStop** — fire when an agent (or subagent) finishes; a natural place to gate a lane's completion on a green test run before it's eligible to merge.

The payoff: the human reviewer only ever sees lanes that already pass lint and tests, which directly relieves the review bottleneck.

## E. Repeatable ceremonies as slash commands / skills

Encode the ceremonies as custom commands so they're one keystroke and consistent. A command is a Markdown file at `.claude/commands/<name>.md` (or the newer `.claude/skills/<name>/SKILL.md`, which supports both `/name` invocation and autonomous use). Arguments are supported (`$1`, `$2`, …). Candidates:

```
/sprint-plan     -> run PO prioritization, inject tech items, produce fan-out plan
/refine <id>     -> turn a rough backlog item into a machine-executable spec
/survey          -> refresh TECH_HEALTH.md from the current codebase
/fanout <n>      -> dispatch the top n independent lanes into worktrees
```

## F. Shared context via CLAUDE.md and rules

Coherence across agents comes from a single source of truth. `CLAUDE.md` (repo root or `.claude/CLAUDE.md`) is read at the start of every session — put build/test commands, coding standards, architectural decisions, and naming conventions there. Keep it tight (aim under ~200 lines); for larger or file-specific guidance use path-scoped files in `.claude/rules/` so they load only when relevant. Committed contracts (types, API schemas) belong here conceptually too: they're the shared surface the contract-first splitting strategy depends on.

## G. External systems via MCP

Wire the backlog to reality with **MCP servers** (configured in `.mcp.json` at the repo root). Connect Jira / Linear / Notion so the PO agent reads and updates real backlog items, and GitHub/GitLab so lanes open PRs and the reviewer agent reads them. This lets "implement ENG-4521 and open a PR" happen end-to-end. Tool search keeps the context cost of many MCP servers low by deferring tool definitions until needed.

## H. Scaling out: Agent SDK, headless, and the Batch API

For fan-outs bigger than a single interactive session comfortably drives:

- **Agent View** dispatches and manages many Claude Code sessions from one screen and moves each into its own worktree automatically — good for a human overseeing a dozen live lanes.
- **Agent SDK / headless mode** (CLI, Python, or TypeScript) runs Claude Code programmatically — the way to script sprint dispatch, wire it into CI, or build a custom orchestration loop. Use `--bare` in CI so local config doesn't leak in. Note that on subscription plans, SDK / non-interactive `claude -p` usage draws from a separate monthly Agent SDK credit — budget for it.
- **Workflow tool** moves orchestration of dozens-to-hundreds of agents into a script the runtime executes outside the conversation, avoiding the single-session rate-limit and context ceilings.
- **Message Batches API** runs non-time-sensitive bulk work at **~50% of standard price** — ideal for the "wide and shallow" mechanical fan-outs (generate tests across hundreds of files, sweep a mechanical refactor, backfill docs). Server tools (web search/fetch, code execution, MCP connectors) work inside batches too.

**Cost discipline:** the Agent SDK exposes per-step token and per-model cost (`total_cost_usd` / `modelUsage`), so you can attach a real cost-per-story figure to the metrics in the main report and tune fan-out width against it.

## I. A worked micro-example

Epic: *"Add CSV export to five report pages."*

1. **PO** writes acceptance criteria per page + a shared "export button" UX note; priority high, low risk.
2. **Tech-surveyor** flags that there's no shared export utility and that three pages share a data-table component → an enabler + a refactor item.
3. **Parallel-planner** produces the fan-out:
   - **Spine (serialized, 1 agent):** build the shared `exportToCsv()` utility + button component and commit the contract.
   - **Lanes (5 parallel agents, worktrees):** one per report page, each wiring the page's data into the committed utility. Disjoint files → no conflicts.
   - **Merge order:** spine first, then lanes in any order; reviewer agent checks each against its page's acceptance criteria; PostToolUse hook guarantees tests pass per lane.
4. **Dispatch** via `/fanout 5`. Five lanes land as five small, independently reviewable PRs.

The point: one epic that reads as linear becomes a 1-wide spine + 5-wide fan-out, and the human reviews five small diffs instead of one big one.

---

### Sources

- [Run agents in parallel](https://code.claude.com/docs/en/agents) · [Create custom subagents](https://code.claude.com/docs/en/sub-agents) · [Subagents in the SDK](https://code.claude.com/docs/en/agent-sdk/subagents)
- [Run parallel sessions with worktrees](https://code.claude.com/docs/en/worktrees) · [Agent view](https://code.claude.com/docs/en/agent-view) · [Agent teams](https://code.claude.com/docs/en/agent-teams) · [Dynamic workflows](https://code.claude.com/docs/en/workflows)
- [Hooks reference](https://code.claude.com/docs/en/hooks) · [Automate actions with hooks](https://code.claude.com/docs/en/hooks-guide)
- [Slash commands](https://code.claude.com/docs/en/slash-commands) · [Plan mode / ultraplan](https://code.claude.com/docs/en/ultraplan) · [Memory / CLAUDE.md](https://code.claude.com/docs/en/memory) · [The .claude directory](https://code.claude.com/docs/en/claude-directory)
- [Connect tools via MCP](https://code.claude.com/docs/en/mcp) · [Run Claude Code programmatically](https://code.claude.com/docs/en/headless) · [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) · [Cost tracking](https://platform.claude.com/docs/en/agent-sdk/cost-tracking) · [Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
