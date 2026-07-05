---
id: IDEA-015
type: idea
status: inbox
captured: 2026-07-05
discovery_type: out-of-scope
born_from: STORY-034
found_by: STORY-034 code review (out-of-scope #2)
why: STORY-034 added UniverseStore.close() (disposes the active provider) but nothing invokes it: server/index.ts has no SIGTERM/SIGINT handler calling productionUniverse.close(), so AC3's 'disposes the provider on shutdown' half is mechanism-only. server/index.ts is outside STORY-034 Touch scope. Fix: add a shutdown hook. Low real-world risk (OS reclaims fds on exit). Human may instead accept store.close()+reload-closes-outgoing as satisfying AC3 in spirit. SAD#5.10 lifecycle.
---

# IDEA-015 — Wire productionUniverse.close() into a server shutdown (SIGTERM/SIGINT) hook

STORY-034 added UniverseStore.close() (disposes the active provider) but nothing invokes it: server/index.ts has no SIGTERM/SIGINT handler calling productionUniverse.close(), so AC3's 'disposes the provider on shutdown' half is mechanism-only. server/index.ts is outside STORY-034 Touch scope. Fix: add a shutdown hook. Low real-world risk (OS reclaims fds on exit). Human may instead accept store.close()+reload-closes-outgoing as satisfying AC3 in spirit. SAD#5.10 lifecycle.

_Capture≠commit: firewalled from the build loop until a human promotes it through Vision gate (refine → plan → SAD amendment/ADR)._
