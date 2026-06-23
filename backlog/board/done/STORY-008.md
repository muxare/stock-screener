---
id: STORY-008
type: story
parent: FEAT-003
capability: CAP-pcf
sad_refs: [SAD#3.5, SAD#5.1, SAD#8.9]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want to paste a TC2000 PCF so that I can reuse an existing formula as a screen.

## Acceptance Criteria
- [x] `parsePCF` turns pasted PCF text (`C > XAVGC50 AND ...`, `XAVGC18>XAVGC50`, `.n` offsets, arithmetic, AND/OR) into a condition group.
- [x] A 'Load example' worked sample is available.
- [x] Unsupported syntax fails with a clear, non-silent error (per ADR-009 / SAD#8.9).

## Architectural Constraints (from SAD)
- Support exactly the POC `parsePCF` operator/indicator subset (SAD#8.9); do NOT silently drop unsupported conditions.

## Out of scope
- Expanding the PCF subset beyond the POC (SAD#1.2 — not a TC2000 clone).

## Status
DONE — as-built in `market.ts` `parsePCF` + screen builder.

## Claude Code Prompt
> Already implemented (as-built capture). If reopened, READ the `sad_refs` sections first and preserve POC semantics exactly; flag any conflict rather than improvising. Stay within Touch scope.

## Touch scope
- src/components/modals/ScreenBuilderModal.tsx
- src/lib/market.ts
