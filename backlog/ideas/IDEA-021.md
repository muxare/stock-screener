---
id: IDEA-021
type: idea
status: inbox
captured: 2026-07-09
discovery_type: out-of-scope
born_from: Results.tsx-changePct-crash-investigation
found_by: claude
why: IN-SCOPE, NOT new architecture: SAD#5.7 already anchors 'stream/paginate large result sets' and the seam exists (marketClient.ts ScreenResp carries total/count/offset/limit). Client store (SAD#5.9) + results table (SAD#5.2) just don't consume it — UI pulls the whole universe (~3.9MB / 67 requests). At Vision gate promote DIRECTLY to a story under the results/screening feature; no SAD amendment needed.
---

# IDEA-021 — UI loads full universe instead of using the paged screen seam

IN-SCOPE, NOT new architecture: SAD#5.7 already anchors 'stream/paginate large result sets' and the seam exists (marketClient.ts ScreenResp carries total/count/offset/limit). Client store (SAD#5.9) + results table (SAD#5.2) just don't consume it — UI pulls the whole universe (~3.9MB / 67 requests). At Vision gate promote DIRECTLY to a story under the results/screening feature; no SAD amendment needed.

_Capture≠commit: firewalled from the build loop until a human promotes it through Vision gate (refine → plan → SAD amendment/ADR)._
