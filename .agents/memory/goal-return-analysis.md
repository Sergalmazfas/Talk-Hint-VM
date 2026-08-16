---
name: Goal-return analysis
description: Data limits for offline goal-return/digression analysis of recorded calls.
---

# Goal-return analysis (offline)

- Production call records now persist `goalText` + `goalType` in `calls.metadata` (flushed at call end alongside `hintLatency`). Delivered hint `text` was already in `hintLatency.entries[].text` since the latency recorder started.
- **Why:** goal and hint history were in-memory per-call state, cleared at call end; offline analysis had no access to them.
- **How to apply:** offline goal analysis reads `metadata.goalText` / `metadata.goalType` directly from the call record. If absent (legacy call recorded before the flush was added), fall back to a frozen fixture and mark the source honestly. Hint texts are in `metadata.hintLatency.entries[].text` (sent hints only, capped at 500 chars each; absent = unknown). Owner-turn labels remain a fuzzy "spoken match" heuristic, not a replacement for explicit hint records.
