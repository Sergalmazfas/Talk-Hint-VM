---
name: Strategy memory (live hints v2.2)
description: Design rules for the per-call strategy-memory tracker feeding RECENT STRATEGY MEMORY into the live prompt.
---

Rules that must survive future changes:
- Only a hint that actually REACHED the UI opens a memory cycle (record next to `latencyRecorder.sent`); drops/stale/dedup never do — an unseen hint can't shape behavior. Wait-state ACKs excluded; library hits included.
- The current Guest turn doubles as the previous cycle's reaction: close the cycle at the TOP of the guest handler, before the Terra prompt is built.
- Outcomes must reuse the #226 `usageScore` thresholds (0.75/0.35) — never a second LLM/classifier. CHOICE "branch selected" requires ≥ partial threshold AND a strict win over the other options (ties select nothing — never guess a branch).
- Memory is bounded by construction (4 cycles, 160-char caps, ≤2 owner turns/cycle) and only CLOSED cycles render.
- Ask-assistant/realtime golden-prompt paths get STRATEGY_MEMORY_RULES only; the data block reaches only translateAndSuggest (they lack the media-stream tracker).

**Why:** hard v2.2 constraints — one Terra call per Guest turn, no latency regression, suggestion ≠ Owner fact.
**How to apply:** any change to hint delivery paths or hint-usage scoring must keep these invariants; tests in server/__tests__/strategyMemory.test.ts pin them.
