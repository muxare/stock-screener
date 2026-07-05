---
id: IDEA-014
type: idea
status: inbox
captured: 2026-07-05
discovery_type: out-of-scope
born_from: STORY-034
found_by: STORY-034 code review (out-of-scope #1)
why: server/devImport.ts:~200 calls runImport(...targetDb...) which opens a read-write connection BEFORE store.reload(sqliteProvider(targetDb)) closes the outgoing reader. When targetDb == the DB the active provider already serves (the 'refresh the running dev server' flow STORY-034's Context names), the write races the still-open read handle — the motivating scenario is not fixed end-to-end. server/devImport.ts is outside STORY-034 Touch scope. Fix: dispose the outgoing provider (or store.reload with a fresh one) BEFORE runImport writes; add a devImport.test.ts case that boots the store on a sqlite provider pointed at targetDb. Relates SAD#5.10 lifecycle.
---

# IDEA-014 — devImport re-import closes outgoing provider before runImport writes targetDb

server/devImport.ts:~200 calls runImport(...targetDb...) which opens a read-write connection BEFORE store.reload(sqliteProvider(targetDb)) closes the outgoing reader. When targetDb == the DB the active provider already serves (the 'refresh the running dev server' flow STORY-034's Context names), the write races the still-open read handle — the motivating scenario is not fixed end-to-end. server/devImport.ts is outside STORY-034 Touch scope. Fix: dispose the outgoing provider (or store.reload with a fresh one) BEFORE runImport writes; add a devImport.test.ts case that boots the store on a sqlite provider pointed at targetDb. Relates SAD#5.10 lifecycle.

_Capture≠commit: firewalled from the build loop until a human promotes it through Vision gate (refine → plan → SAD amendment/ADR)._
