# Idea — Habit streak CLI

Track a handful of daily habits from the terminal. Mark done for today, see
current streak per habit, list history for the last 7 days. Data in a single
JSON file under the user's home config dir.

## Seed non-goals (for refine-idea)
- No reminders, push notifications, or calendar integration.
- No mobile app or web dashboard.
- No social features or shared habits.
- No charts or analytics beyond streak count and recent history.

## Why this idea fits sad-wf
**Date logic** and **idempotency** (mark done twice today) make good acceptance
criteria. Persistence path outside repo tests Touch scope discipline.

## Rough capabilities (hint for SAD#3)
- `habit.model` — habit id, title
- `habit.log` — record completion by date (local timezone)
- `habit.streak` — compute current/longest streak
- `persist.config` — read/write habits file
