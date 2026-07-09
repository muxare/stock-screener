---
id: IDEA-022
type: idea
status: inbox
captured: 2026-07-09
discovery_type: out-of-scope
born_from: Results.tsx-changePct-crash-investigation
found_by: claude
why: OUT-OF-SCOPE, needs new architecture: no SAD capability covers universe selection by market index (no index/constituent/S&P anchor in SAD-001). Would need a new capability + a constituent-membership data source (relates to SAD#5.10 market-data port) and likely an ADR for the source. NOTE — companion idea 'index stocks BY screening filters' was considered and is NOT recommended: screen filters are continuous thresholds (RSI<30, relVol>1.5x), not discrete tags, so an inverted index doesn't map; it fights the single-shared-engine invariant (SAD#8.3/ADR-003). If scans get slow, push into SQL/columnar rather than hand-roll a filter index.
---

# IDEA-022 — Index-based universe selection (load constituents of a market index)

OUT-OF-SCOPE, needs new architecture: no SAD capability covers universe selection by market index (no index/constituent/S&P anchor in SAD-001). Would need a new capability + a constituent-membership data source (relates to SAD#5.10 market-data port) and likely an ADR for the source. NOTE — companion idea 'index stocks BY screening filters' was considered and is NOT recommended: screen filters are continuous thresholds (RSI<30, relVol>1.5x), not discrete tags, so an inverted index doesn't map; it fights the single-shared-engine invariant (SAD#8.3/ADR-003). If scans get slow, push into SQL/columnar rather than hand-roll a filter index.

_Capture≠commit: firewalled from the build loop until a human promotes it through Vision gate (refine → plan → SAD amendment/ADR)._
