# Help cards — how the first card should be summoned

Status (2026-09-09): **phases 0 and 1 built; 2-4 open**. Written from Mikael's note that the
first card arrives too eagerly and covers the thing you were looking at, and his
suggestion to gate it behind Shift; revised the same day after three follow-ups — which
modifier (Ctrl/Cmd considered and rejected, see idea A), the wish to hover marks *on the
chart* for their documentation (phase 4, which is why the modifier cannot be switched off
over a canvas), and **Mikael's decision to retire Shift-drag zoom-to-range in favour of
wheel-zoom and drag-pan, which frees Shift outright** (phase 0). Phase 1 answers the
original complaint; everything else builds on it. All open questions were closed the same
day (see Decisions at the end). **Phases 0 and 1 landed 2026-09-09 on
`feat/help-summon-modifier` — see the diary entry of that date. Phases 2-4 are open.**

## Context — what the trigger does today

`src/help/HelpProvider.tsx` listens once at the document level. Every element carrying
`data-help="<topic>"` is a target (64 of them today). The rules, as built:

- `HOVER_DELAY = 380 ms` — dwell on any target and its card opens.
- `NESTED_DELAY = 180 ms` — a highlighted term *inside* an open card opens faster.
- `LEAVE_GRACE = 170 ms` — leaving a card or its anchor closes it, after a grace so the
  pointer can cross the gap between the two.
- `T` pins the deepest card; `Esc`, a click outside, a scroll or a resize closes the chain.
- The card is 330 px wide, dark, and lands 6 px below the anchor's left edge
  (`placeNear`), flipping above only when it would fall off the bottom.

So the only condition for a card is *time*: 380 ms of the pointer resting anywhere over a
target. Nothing about the trigger distinguishes "reading the UI" from "crossing it".

## Problem

Three things compound, and it is worth separating them because they have different fixes.

1. **380 ms is inside the range of ordinary pointer travel.** Moving from the ticker list
   to the Backtest button, or pausing mid-thought over a filter chip, clears the bar. The
   card is not answering a question — it is interrupting one.
2. **Several anchors are much larger than the word they explain.** `data-help="filters"`
   sits on the whole filter row, `data-help="search"` on a 340 px wrapper, the tab
   anchors on whole tabs, `data-help="detail-dock"` on the resize handle. A big target is
   a big trap: the pointer is over it far more often than the user is asking about it.
3. **The card is opaque, dark and 330 px wide, and it opens *downward over the content
   below the anchor*.** For a TopBar or FilterBar anchor that content is the table you
   were reading. A trigger that fires by accident is annoying; one that fires by accident
   and then covers the screen is what prompted this note.

Mikael's instinct — require a modifier for the *first* card, then drop the requirement
because intent is now established — attacks (1) directly and is the strongest single
change. It does not fix (2) or (3), which is why they get their own phases.

## Ideas considered

### A. Modifier-gated first card (Mikael's proposal) — **recommended**

Hold **Shift** and point at something; the card opens almost at once. Without Shift,
nothing opens, no matter how long you dwell.

- Removes accidental cards completely rather than making them rarer. Dwell heuristics
  only move the threshold; a modifier changes the question from "did you linger?" to
  "did you ask?".
- It makes the card *faster* when you do want it — an explicit request needs no 380 ms
  suspicion delay, ~90 ms is enough to avoid strobing while sweeping with Shift down.
- Cost is discoverability: an invisible gesture. Phase 2 exists to pay that cost.
- Which modifier is its own question, and the answer is not obvious. See below.

#### Which modifier? *(revisited 2026-09-09, after Mikael raised Ctrl/Cmd)*

The worry was that Shift is already taken by range-select drag on the charts
(`FanDetail.tsx:349`, `FanTradeReview.tsx:444`). That is a **conceptual** clash, not a
functional one: the selection needs a `mousedown` inside the plot, and the chart canvas
carries no `data-help`, so holding Shift over a chart summons nothing today and would
summon nothing after phase 1. One modifier meaning two things in two places is still
worth avoiding — but Ctrl and Cmd each buy that tidiness at a higher price, because they
are *browser and OS* modifiers rather than application ones.

What each actually costs, checked against this codebase and macOS/Chrome:

| | Shift | Ctrl | Cmd |
|---|---|---|---|
| Clicking a help anchor while held | normal click | **macOS: secondary click → context menu** | normal click (no `<a>` anchors exist, so no new-tab) |
| Wheel / trackpad scroll while held | horizontal scroll | **browser zoom** | **browser zoom** |
| Pressing `T` to pin while held | pins | **new tab on Windows/Linux** | **new tab on macOS** |
| Held for seconds near other keys | harmless (capitals) | mostly harmless | `Cmd+W` / `Cmd+Q` one key away |
| In-app collision | chart shift-drag (plot only) | none | none |

Three of those are real, and the third one hurts most: **the summon modifier and the pin
key would fight each other.** `Cmd+T` opens a browser tab on macOS, `Ctrl+T` does on
Windows and Linux, so the natural gesture — hold the key, card appears, press `T` to pin
— would open a tab instead of pinning. Worse, it would fail *silently on our side*: the
provider's `onKey` already ignores `T` when `ctrlKey`/`metaKey` is set, so the app would
do nothing while the browser did something. Choosing Ctrl or Cmd therefore also means
moving the pin key; it is not a one-line swap.

The context-menu hazard is next. Every help anchor is a live control — the Backtest
button, the `?` button, filter chips, inputs — so on macOS "hold Ctrl, read the card,
click the thing" ends in a context menu instead of a click. And on zoom: the charts'
`wheel` handlers call `preventDefault()`, so Ctrl/Cmd+wheel is swallowed *over a chart*
but zooms the browser everywhere else — which is exactly where the help anchors live.

**Second revision, same day — the canvas exclusion is withdrawn.** Mikael's next point
kills it: we will want help *inside* the chart, hovering a pattern glyph or an indicator
to ask what it is and why it fired (phase 4 below). A rule that says "never arm over a
canvas" would exclude the single richest documentation surface in the app. Separating the
two meanings by *surface* is therefore not available.

**Resolved 2026-09-09 — remove the conflict at its source.** Mikael's call: drop
Shift-drag zoom-to-range from the charts and keep wheel-to-zoom and drag-to-pan, which
already do the same job between them. Shift then has exactly one meaning in the app,
everywhere, including over a chart, and none of the compromises below are needed. That is
**phase 0**, and phase 1 depends on it.

The alternative that this replaces — arming only when the pointer is still and
buttonless, with a longer armed delay over a canvas so a Shift-then-drag never flashed a
card — was workable but was two rules and a second constant existing purely to disambiguate
a gesture we do not need. One rule from it is worth keeping regardless: **never arm while a
mouse button is down**, since drag-to-pan is now the primary chart gesture and a card must
not appear mid-pan if Shift happens to be held.

**Either way, keep it a one-line decision.** `SUMMON_MODIFIER: 'shift' | 'ctrl' | 'meta'`
is a constant in `trigger.ts` and `decideTrigger` reads a plain `modifierDown` boolean, so
the provider maps whichever key is configured and the on-screen copy is generated from it.
Flipping it after a day of use is one edit. If Cmd wins in the end, the pin key moves with
it: the 📌 button in the card header already pins without a key, and because a card
outlives the modifier, "release Cmd, press `T`" also still works — so the fallback is a
copy change, not a redesign.

Alt was rejected before and stays rejected: macOS composes characters with it, and some
window managers steal Alt-drag.

### B. Latch after the first card — **recommended, pairs with A**

Once a card is open the modifier is redundant, exactly as Mikael says: you are already
reading documentation. So while any hover card is open — and for a short grace after the
last one closes — plain hover behaves as it does today (380 / 180 ms). Terms inside a
card were never gated at all.

The grace matters more than it sounds: it is what lets you leave a card, look at the
control it described, and hover a neighbouring one without reaching for Shift again. An
explicit dismissal (`Esc`, or a click outside) should clear the latch immediately — that
gesture means "stop showing me cards", and honouring it is what keeps the latch from
becoming a second kind of accident.

### C. Stickier dwell / hover-intent

Raise `HOVER_DELAY` to ~700 ms and require the pointer to be near-stationary (say < 4 px
of movement over the last 120 ms) before the timer even starts.

- Zero discoverability cost, keeps the current gesture, cheap to build.
- But it only trades one failure for another: high enough to stop accidents, it is high
  enough to feel broken when you *do* want a card. It is the right fallback if the
  modifier tests badly, and it is a reasonable extra condition *inside* latched mode
  (phase 1 keeps latched dwell at 380 ms; adding stillness there is a phase-3 nicety).

### D. Sticky help mode via the "?" button — **recommended as the accessible twin of A**

The `?` button in the TopBar already carries `data-help="help"` and does nothing when
clicked. Make it a toggle: help mode on = today's plain-hover behaviour, everywhere, with
the button visibly lit and `Esc` exiting.

- Gives the gesture a visible home, which is where a user discovers Shift at all.
- Covers everyone who cannot comfortably hold a modifier while moving a pointer (sticky
  keys, one-handed use, touch). A hidden-modifier-only design would be an accessibility
  regression against today's behaviour; this is what prevents that.

### E. Affordance-first: hover the marker, not the region

Give each target a small marker (a dotted underline on the label, or an ⓘ that fades in
on hover) and open the card only from the marker.

- This is the honest fix for problem (2) and how documentation UIs usually work.
- But 64 anchors, many of them wrapping divs and labels, is a lot of visual noise to add
  to a dense screen — and the noise is permanent while the benefit is occasional. A
  cheaper 80 % is simply moving the over-broad anchors onto the words they describe
  (phase 3), which is invisible and mechanical.

### F. Peek, then expand

A one-line "peek" strip after the dwell, expanding into the full card on Shift or a
further dwell.

- Attractive, but it is a third UI state to design, place and test, and the app already
  has a peek layer: 48 `title=""` attributes giving the native tooltip. Not worth it
  while a modifier is on the table. Revisit only if phase 1 tests badly.

### G. Placement and opacity, independent of the trigger

Prefer the side with more room rather than always below; never overlap the anchor's own
row; open at ~92 % opacity and go solid when the pointer enters the card; keep a card
inside the panel it belongs to when one fits.

- Orthogonal to the trigger — worth doing whatever else lands, because it lowers the cost
  of *every* card, wanted or not. Phase 3.

### Rejected

- **Click to open.** Nearly every anchor is a live control; the click belongs to it.
- **Long-press.** Same conflict, plus it fights drag on the chart and the resize handle.
- **Auto-open only for terms you have not seen before.** State that decays invisibly;
  users cannot form a model of when documentation appears.

## Recommendation

Phase 0 = **free the key**: retire Shift-drag zoom-to-range, which wheel-zoom and
drag-pan already cover between them. Phase 1 = **A + B**: Shift arms the first card, the
chain latches so nothing else needs the modifier, and an explicit dismissal clears the
latch. Phase 2 = **D** plus a small hint so the gesture is findable.
Phase 3 = **E-lite + G**: narrow the over-broad anchors and stop the card landing on top
of what you were reading. Phase 4 = **help on the chart itself** — hover a pattern glyph
or an indicator pane for what it is and why it fired; it is the phase that earns the
trigger work, and the reason the trigger must work over a canvas.

## Phase 0 — free the Shift key — **landed 2026-09-09**

Retire Shift-drag zoom-to-range. Wheel-to-zoom and drag-to-pan stay and between them do
the same job, so Shift belongs to the documentation layer alone. Small, self-contained,
and a prerequisite for phase 1.

**What is actually being given up.** The gesture landed 2026-08-26 (diary) and does one
thing: `drawZoomSelection` draws a dashed marquee, and on release `setRange(min, max)`
zooms to that bar span. No measurement, no statistics, nothing else reads the selection.
The loss is therefore *precision in one gesture* — jumping straight to an exact window
instead of a few wheel notches and a pan. Worth naming rather than pretending the removal
is free, but small against a modifier that has to work over the chart for phase 4.

### Touch scope
- `src/components/detail/FanDetail.tsx` — drop `selectionRef`, the `e.shiftKey` branch in
  `onDown`, `drawSelection`, and the selection branch in `endPointer`
- `src/components/modals/FanTradeReview.tsx` — the same four, they are duplicates
- `src/lib/chart/interactions.ts` — `drawZoomSelection` and `ZoomSelection` become dead;
  remove both. `barIndexAtX`, `barCenterX` and `isInPlot` stay — though not, as written here,
  because the crosshair uses them: it re-derived all three inline. Point it at the helpers
  instead, which is what keeps them alive and drops the duplication
- `src/components/ui/ChartControls.tsx:166` — the hint becomes
  `scroll = zoom · drag = pan`, and phase 2 appends the help gesture to it
- `docs/development-diary.md` — an entry, since this reverses a documented feature

### A decision inside it
`setRange` in `src/lib/chart/viewport.ts` loses both its callers. Delete it, unless a
date-range control is wanted later — in which case leave it with a comment saying what it
is for. My preference is to delete: `zoomAtBar` + `panByBars` + `reset` are a complete
viewport API, and an uncalled setter is the kind of thing `CLAUDE.md` warns about in
`store.ts` and `fanBacktest.ts`, only smaller.

### Verification
Scroll zooms, drag pans, the zoom buttons and reset still work on both charts; holding
Shift changes nothing anywhere; `npm run test` and `npm run lint` clean.

## Phase 1 — Shift-armed first card, latched chain — **landed 2026-09-09**

### Touch scope
- `src/help/trigger.ts` (new) — the pure decision function
- `src/help/trigger.test.ts` (new)
- `src/help/HelpProvider.tsx` — call it; add the Shift and latch state
- `src/help/glossary.ts` — the `help` topic's body describes the new gesture
- `src/help/HelpCard.tsx` — footer hint text

### Design

**The decision is pure and lives outside the provider.** `place.ts` is already written
this way ("Pure, so it is testable") and the provider is the least testable file in
`src/help/`. Extract exactly the decision, not the effects:

```ts
// src/help/trigger.ts
export interface TriggerState {
  insideCard: boolean;   // the target is a term inside an open help card
  chainOpen: boolean;    // at least one hover card is showing
  helpMode: boolean;     // sticky mode (phase 2); always false in phase 1
  modifierDown: boolean;  // SUMMON_MODIFIER is down (default 'shift')
  pointerBusy: boolean;   // a mouse button is down — never arm mid-drag
  latchedUntil: number;  // epoch ms; 0 = not latched
  now: number;
}
export type TriggerDecision =
  | { open: false; armable: boolean }   // armable: the modifier would open it now
  | { open: true; delay: number };
export function decideTrigger(s: TriggerState): TriggerDecision;
```

Rules, in order: a term inside a card is never gated (`delay = NESTED_DELAY`); help mode
or an open chain or a live latch means plain hover (`delay = HOVER_DELAY`); the modifier
down means `delay = ARMED_DELAY`; otherwise `{ open: false, armable: true }`.
`pointerBusy` short-circuits everything to `{ open: false, armable: false }`, so no card
can appear mid-pan. There is no chart special case: after phase 0 the canvas is an
ordinary help surface.

**Constants** (`ARMED_DELAY = 90`, `LATCH_GRACE = 800`, `SUMMON_MODIFIER = 'shift'`) live
beside the existing three at the top of `HelpProvider.tsx` and are passed in, so a test can
pin them and so the modifier is one edit away from changing.

**Provider changes**, all inside the one `useEffect`:

- Track the modifier on `keydown` / `keyup` in a ref — read it from the event's
  `shiftKey` / `ctrlKey` / `metaKey` flag rather than matching `e.key`, which also keeps
  it correct when the key goes down before the window has focus. Never `preventDefault`
  it. Both Shift keys count: `ShiftLeft` only would be a trap for sticky keys and for
  anyone whose left hand is on the mouse, and the gain is nil.
- Refuse to arm while a mouse button is down, and let `onDown` clear the pending target
  as well as the chain, so a card never appears while panning a chart.
- `onOver` already computes `anchorEl` / `topic` / `keepIds` and stores a `Pending`. Keep
  doing that even when the decision is `open: false` — the pending target is what the
  Shift keypress opens. Only the timer is conditional.
- On the modifier's `keydown`, if a `Pending` exists and `pending.anchorEl.matches(':hover')`,
  start the `ARMED_DELAY` timer. This is the path that matters most: the pointer is
  usually already parked on the thing before the hand reaches for Shift.
- On the modifier's `keyup`, cancel an armed timer that has not fired, but never close an open
  card. Releasing the key to move the pointer into the card must not destroy it — that is
  the whole reason B exists, and it is also what keeps `T` usable if we ever move to Cmd.
- Latch: `latchedUntil = Infinity` while `chain.length > 0`; when the chain empties
  normally, `latchedUntil = now + LATCH_GRACE`. `closeHover()` from `Esc`, `mousedown`
  outside, scroll or resize sets it to `0`.
- Pinned cards do **not** hold the latch open. A pinned card is a parked reference, not
  an active reading session; keeping every page hover live for as long as one is on
  screen would undo the fix. Terms *inside* the pinned card still work, because
  `insideCard` is checked before everything else.
- `pinTop()`'s "pressed T before the delay elapsed" path stays, and now also covers
  "pressed T while a pending target was never armed" — pressing T is as explicit as the
  modifier, so it should open and pin in one go.

### Tests
- `src/help/trigger.test.ts` — the matrix: cold, no modifier → closed but armable; cold +
  modifier → `ARMED_DELAY`; latched within grace → `HOVER_DELAY`; latched, grace expired →
  closed; chain open → `HOVER_DELAY`; inside a card → `NESTED_DELAY` regardless of the
  modifier or the latch; help mode → `HOVER_DELAY` regardless; `pointerBusy` → closed and
  **not** armable, even with the modifier down.
- Existing `place.test.ts` / `link.test.ts` / `glossary.test.ts` are untouched.

### Verification (manual, `npm run dev`)
1. Sweep the pointer across TopBar, the filter row and the table for ten seconds without
   Shift — no card appears.
2. Point at "Backtest", press Shift — card within ~0.1 s. Press `T` while still holding
   Shift — it pins, with no browser side effect (the check that Ctrl/Cmd would fail).
3. With the card up, release Shift and move into it, then hover a highlighted term — the
   child card opens as before; `T` pins; `Esc` closes.
4. Close with `Esc`, immediately hover a different chip — no card (explicit dismissal
   cleared the latch). Let a card close by walking away instead, then hover a neighbour
   within ~0.8 s — card opens without Shift.
5. Drag to pan and scroll to zoom the detail chart with Shift held down throughout — the
   chart behaves normally and no card appears mid-pan. (Holding Shift still over the plot
   opens nothing until phase 4 gives the canvas its own targets.)
6. `npm run test` and `npm run lint` clean.

## Phase 2 — making the gesture findable

### Touch scope
`src/components/TopBar.tsx`, `src/help/HelpProvider.tsx`, `src/help/help.css`,
`src/help/glossary.ts`

- **The `?` button becomes a real toggle** (idea D): click = help mode on, plain hover
  everywhere, button lit green, `Esc` or a second click exits. `helpMode` is already a
  field in `TriggerState`, so the provider change is a state flag and a context or a
  `data-help-mode` attribute on `<body>`; TopBar reads and sets it.
- **The whisper.** When a target has been hovered for ~600 ms and the decision was
  `armable`, show a single 11 px chip near the pointer — `⇧ help`, rendered from
  `SUMMON_MODIFIER` so it never lies about the key — with no background
  panel. It is the smallest thing that teaches the gesture at the moment it is wanted,
  and it costs nothing when it is not: it disappears on Shift, on leaving the target, and
  it should show at most a handful of times per session (a counter in the provider, not
  persisted — this is a hint, not a preference to manage).
- Update the `help` glossary topic and the hover-card footer (`<kbd>T</kbd>pin`) to state
  the gesture: "⇧ Shift + point for a card · T to pin" — both generated from
  `SUMMON_MODIFIER` so a change of key updates the copy with it.

### Verification
`?` toggles a visibly-lit mode in which today's hover behaviour returns; the whisper
appears on a cold hover, vanishes on Shift, and does not reappear indefinitely.

## Phase 3 — anchors and placement

### Touch scope
`src/components/TopBar.tsx`, `src/components/FilterBar.tsx`,
`src/components/ScreenView.tsx`, `src/components/filters/*.tsx`,
`src/components/detail/DetailPanels.tsx`, `src/help/place.ts`, `src/help/help.css`

- **Narrow the over-broad anchors** (E-lite): move `data-help` from wrappers onto the
  label text they describe — `search` from the 340 px div onto the input's label,
  `filters` onto the row's heading rather than the row, tab anchors onto the tab text.
  Mechanical, invisible, and it removes most of the remaining false positives even with
  the modifier in place. Note the nesting already works in our favour: `closest()` picks
  the innermost anchor, so a chip inside the filter row wins over the row.
- **`placeNear` prefers the side with room** rather than always below-then-above, and
  never covers the anchor's own row. A card for a TopBar control should sit beside it,
  not over the first six table rows.
- **Open at ~0.92 opacity, solid on pointer enter** — a card you can see through is a
  card that does not need to be dismissed to read the number underneath it.
- Optionally add the stillness condition from idea C to *latched* dwell, where the plain
  380 ms timer still applies.

### Verification
Every card opens beside, not on top of, the control that explains it, at every window
size in the phase-1 checklist; `place.test.ts` extended with the side-preference cases.

## Phase 4 — help on the chart itself

Mikael, 2026-09-09: *"hover over a mark or indicator on the chart and get the
documentation on what it is and why it is triggered."* This is the phase that makes the
whole feature worth the trigger work — and it is the reason the modifier cannot be scoped
away from the canvas.

It depends on phase 1 (the arming rules) and reads better after phase 3 (placement), but
it is independent of phase 2.

### Touch scope
- `src/help/HelpProvider.tsx` — virtual anchors (see below) and a small context API
- `src/help/anchors.ts` (new) — the `useHelpAnchor()` hook the chart calls
- `src/lib/chart/patternLayer.ts` — return the rects it already computes
- `src/components/detail/FanDetail.tsx` — hit-test on mousemove, publish the target
- `src/help/HelpCard.tsx` — an instance line above the topic body
- `src/help/glossary.ts` — indicator/pane topics that do not exist yet, if any

### Design

**Virtual anchors.** Today a `HoverEntry` holds `anchorEl: Element`, and the provider uses
it two ways: `anchorEl.contains(target)` to decide what stays open, and
`anchorEl.matches(':hover')` to confirm the pointer is still there when the timer fires.
Canvas marks are not elements, so both need a second implementation rather than a hack:

```ts
interface VirtualAnchor {
  key: string;          // 'pa-pin@412' — identity, so re-publishing the same mark is a no-op
  topic: string;        // glossary id
  rect: Rect;           // viewport coords, from the canvas rect + the glyph box
  instance?: string;    // marker.note — *why it fired, here*
}
```

The chart publishes one on mousemove and clears it on leave; the provider treats it
exactly like a hovered DOM anchor. `contains` becomes "is the live virtual key still this
one", `:hover` becomes "is it still published". Everything downstream — the delay, the
latch, `T`, `Esc`, the chain, pinning — is unchanged, which is the point of putting the
decision in `trigger.ts` in phase 1.

**What is hittable, cheapest first:**

1. **Pattern glyphs and chips.** `markersAtBar(markers, i)` already answers "which
   patterns is this bar part of?" — it is what the crosshair readout prints today — and
   `PatternMarker.id` maps to a glossary topic by the `pa-` prefix that phase 1 of the
   patterns plan deliberately chose. `labelPlacer` in `patternLayer.ts` computes each
   chip's rectangle while drawing and then discards it; returning that array is the whole
   hit-test. Nearest chip under the pointer wins; failing a chip, the markers on the
   hovered bar, top-ranked first.
2. **Pane regions.** Pointer in the MACD pane → `macd`; the volume strip → `volume`; the
   Stoch RSI pane → its topic. A rectangle test against the layout the chart already
   computes, and high value for no hit-testing work at all.
3. **The fan lines.** Nearest EMA within ~4 px of the cursor → that EMA's topic (and the
   `fan` card when several converge). Needs a per-line distance test against the points
   already plotted; do it last, and only if pointing at a line feels natural in practice.

**The card says why *this* mark fired, not just what the pattern is.** `PatternMarker.note`
is already one line of prose about the instance ("lower wick 2.4× the body, closed in the
top third"), and `strength` says how many bars either side confirmed a pivot. Render that
as a highlighted line above the glossary body, with the bar's date. Generic documentation
answers "what is a pin bar"; the instance line answers "why is there one *here*", which is
the actual question someone hovering a glyph is asking.

**The crosshair readout becomes the peek layer, and the card the expansion.** The readout
already lists the patterns on the hovered bar as you move; Shift promotes the one under
the cursor into a full card. That is idea F from the trigger discussion, arriving for free
because the chart already built the peek half.

**Placement must not cover the bars being explained.** A 330 px opaque card over the
candles is the worst version of problem (3), and on a chart it is unusable rather than
merely annoying: the mark you asked about is *under the card*. So a chart card docks to
the chart panel's quieter side — opposite half from the glyph, inside the panel bounds —
instead of floating at the pointer. This is phase 3's `placeNear` work with one extra
input (a preferred container rect), which is why phase 4 reads better after it.

### Tests
- `patternLayer.test.ts` — the returned chip rects match what was drawn, and dropped
  chips (no free row) return no rect.
- `trigger.test.ts` — a virtual anchor arms and latches identically to a DOM one; a change
  of `key` swaps the pending target rather than keeping the old one.
- Hit-test unit tests are pure (rects in, topic out) and belong beside `patterns.test.ts`.

### Verification
Shift + point at a `PIN` chip → a card naming the pattern, the date and why that bar
qualified, docked beside the glyph and not over it. Shift + point in the MACD pane → the
MACD card. Shift-drag anywhere in the plot → a range selection and no card. `T` pins a
chart card; it stays pinned while you pan and zoom underneath it.

## Decisions

All four settled 2026-09-09; nothing is waiting on an answer.

1. **Which modifier — Shift, either key.** Freed by retiring Shift-drag zoom (phase 0).
   Ctrl and Cmd stay rejected: each collides with the browser's context menu, zoom, or
   `Cmd/Ctrl+T`, and any of them would force the pin key off `T`. Reading `e.shiftKey`
   rather than matching `e.key` gets "either key" for free, and is also what keeps the
   state right when the key goes down before the window has focus.
2. **Latch grace stays 800 ms.** It is one constant next to the other four, and the honest
   way to tune it is to live with it for a day, not to argue about it now.
3. **Help mode is session-only.** It costs a `useState` in the provider; persisting it
   would make it a stored preference, which means a store field and somewhere for it to
   live. If it turns out you always want it on, that is a different and better feature —
   defaulting help mode on — and it can be decided then.
4. **`T` stays the pin key**, and needs no change at all. `Shift+T` is unbound in the
   browser, and `onKey` already lowercases the key (`e.key.toLowerCase() !== PIN_KEY`), so
   the capital `T` produced while Shift is held pins exactly as it does today. Its guard
   rejects `altKey`/`ctrlKey`/`metaKey` and deliberately not `shiftKey` — already correct
   for this design. `Shift+click` was considered and rejected: nearly every help anchor is
   a live button, and the click belongs to it.
