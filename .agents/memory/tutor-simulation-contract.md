---
name: Goal-Driven Simulation (Engine contract v1)
description: How TalkHint creates simulation tutor sessions, the fail-closed rules, and what is still blocked on the Engine side.
---

Contract v1 (received 2026-08-13, inlined in the Engine's task doc): simulation sessions = `mode:"simulation"` + `simulation:{goal(≤500), roles:{learner,tutor}(≤120), context}` with `language:{target,native}` object (practice keeps the old `target_language`/`native_language` shape).

**Rules (never violate):**
- `simulation.goal` is the literal user text — never send keywords/slots/goalAchieved internals.
- Context by REFERENCE only: `{source:"call_memory", call_memory_group_id, version}` — inline facts are rejected by design.
- FAIL-CLOSED: engine error codes (SIMULATION_NOT_ALLOWED_FOR_MODE/REQUIRED/INVALID, CALL_MEMORY_DISABLED/NOT_FOUND/NOT_CONFIRMED) map to explicit user errors; NEVER fall back to practice; POST /sessions is non-idempotent — never auto-retry.
- Verify the 201 `simulation` echo structurally (goal+roles+context) before connecting; refuse + complete the session if missing/mismatched.
- Opening turn: engine speaks FIRST after WS auth (`turn.started opening:true`); gate the mic until its `turn.completed`; `OPENING_IN_PROGRESS` is benign — stop mic, RECORDING→PROCESSING, keep gating. Never drive the PTT machine from turn events.
- WS callbacks are generation-guarded (`wsGen`) so a superseded socket can't clear the new session's opening gate or push it to ERROR.

**Why:** contract §5/§6 forbid engine-side logic in TalkHint and any silent practice fallback; the race fixes came from an architect review (stuck RECORDING + stale-socket callbacks).

**Still blocked on the Engine (do not work around):**
1. Contract v1 was NOT deployed at TUTOR_ENGINE_BASE as of 2026-08-13 (201 without simulation echo, no opening turn, no hard 422) — needs Engine republish; re-run live evidence then (docs/simulation-integration-report.md).
2. Source of `call_memory_group_id`+`version` is unconfirmed — the call-memory GET never carried them; we opportunistically capture group_id/version fields into tutor_call_memories.engine_group_id/engine_version (nullable; older memories can't seed simulations).
3. Engine-side "confirmed (ready_for_real_call)" semantics unknown — TalkHint confirmation is local; call_memory context may always 409 until clarified (docs/tutor-goal-contract-open-question.md).
