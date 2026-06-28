---
id: IDEA-002
type: idea
status: refined
captured: 2026-06-28
refined_to: PLAN-003
discovery_type: out-of-scope
born_from: ~
found_by: human (Mikael)
why: Resolves SAD#8.8 ADR-008 (market-data vendor selection, open) by selecting Yahoo Finance EOD as the production vendor; supplies the vendor adapter behind the MarketDataProvider port (SAD#5.10) and the ingestion/adjustment boundary (SAD#4.3, SAD#8 ADR-005). Needs an ADR + SAD amendment before it can become work.
---

# IDEA-002 — End-of-day market-data service (Yahoo Finance EOD ingestion)

Resolves SAD#8.8 ADR-008 (market-data vendor selection, open) by selecting Yahoo Finance EOD as the production vendor; supplies the vendor adapter behind the MarketDataProvider port (SAD#5.10) and the ingestion/adjustment boundary (SAD#4.3, SAD#8 ADR-005). Needs an ADR + SAD amendment before it can become work.

_Capture≠commit: firewalled from the build loop until a human promotes it through Gate 1 (refine → plan → SAD amendment/ADR)._
