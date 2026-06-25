# Deferred capabilities

The coverage invariant (`board.py validate`, change #10) flags any `SAD#3`
capability that has **no** story — that's how a silently-dropped capability gets
caught. But sometimes a capability is *consciously* not scheduled yet (waiting on
an ADR, a vendor decision, or simply a later batch). List those here so the
invariant can tell a deliberate deferral (a non-blocking **warning**) from an
accidental drop (a **violation**).

Format — one bullet per deferred capability, `CAP-id: reason`:

```
- CAP-example: parked until ADR-008 (vendor) is decided — see STORY-015
```

_(empty: every SAD#3 capability currently has at least one story)_
