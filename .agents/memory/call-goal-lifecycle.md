---
name: Call goal lifecycle
description: How the live-call goal is stored, displayed, updated mid-call, and cleared — and the leakage/race pitfalls.
---

# Call goal lifecycle

Rules (user-approved UX spec, Aug 2026):
- The goal is a **compact event in the conversation feed** (iOS feed card "GOAL"/"GOAL UPDATED", web `addGoalFeedEvent`), never a persistent banner/status line. It scrolls away with history.
- The assistant free-text input doubles as a mid-call goal editor: `ask_ai` runs a fail-safe LLM classifier (`detectGoalUpdate`); on a goal declaration the server adopts it, emits `goal_updated` to all of that user's sockets, and answers grounded in the new goal.
- A new call always starts WITHOUT the previous call's goal.

**Why:** the old design kept one closure-scoped `currentGoal` for the whole WS server — one user's goal could ground another user's hints (cross-user leak found in review), and a stale goal survived into the next call.

**How to apply:**
- Goal state is per-user (`goalsByUser` map keyed by authenticated userId). Never reintroduce a shared mutable goal.
- Clear it on EVERY call end path: Twilio stream `stop` AND `close` backstop server-side; clients also send `set_goal:""` on call end (covers calls that never opened a media stream).
- Async classifier results must compare-and-set against a goal snapshot so a late result can't overwrite a newer explicit set_goal.
- Feed events are deduped client-side (server re-echoes `goal_set` on reconnect since persisted selections are re-sent).
- Known accepted limitation: state is user-scoped, not call-scoped — two simultaneous calls by one user would share a goal.
