---
id: IDEA-013
type: idea
status: inbox
captured: 2026-07-02
discovery_type: out-of-scope
born_from: STORY-052
found_by: code-reviewer
why: The 3 yahoo-fetch CLI front-ends (SAD-003#5.1) duplicate parseIsoDate/parseIntFlag/parseFractionFlag/printUsage + coverage wiring. A shared CLI helper (alongside the extracted importResults tail) would DRY this if a third+ run mode appears. Pure refactor of existing components; no new capability/ADR — speculative, so firewalled for Vision-gate triage.
---

# IDEA-013 — Extract a shared yahoo-fetch CLI helper (dedupe arg-parsing across the 3 run modes)

The 3 yahoo-fetch CLI front-ends (SAD-003#5.1) duplicate parseIsoDate/parseIntFlag/parseFractionFlag/printUsage + coverage wiring. A shared CLI helper (alongside the extracted importResults tail) would DRY this if a third+ run mode appears. Pure refactor of existing components; no new capability/ADR — speculative, so firewalled for Vision-gate triage.

_Capture≠commit: firewalled from the build loop until a human promotes it through Vision gate (refine → plan → SAD amendment/ADR)._
