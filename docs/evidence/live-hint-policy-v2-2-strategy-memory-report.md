# LIVE Hint Policy v2.2 — Strategy Memory: Evidence Report

Task #236. Date: 2026-08-16.

## Verdict: PASS (code + tests + live model smoke) / real-call production acceptance PENDING first post-deploy call

## 1. What changed

v2.1 Terra saw conversation history, GOAL and context — but never its own previous suggestions or whether the user actually used them. v2.2 adds a bounded, deterministic **Strategy Memory** to the realtime path: the last ≤4 hint cycles (`suggestion → actual Owner speech → Guest reaction → outcome`) rendered as a compact `RECENT STRATEGY MEMORY` prompt block, plus a `STRATEGY MEMORY RULES` policy layer. Core principle enforced everywhere: **Suggestion ≠ Owner fact.**

### Server-side cycle tracker (`server/strategyMemory.ts` — new pure module)
- `StrategyMemoryTracker`: `recordSuggestion` (only when a hint actually REACHED the UI — drops/stale/dedup never open a cycle), `recordOwnerTurn` (actual speech, ≤2 turns per cycle), `recordGuestTurn` (the reaction that closes a cycle). Only closed cycles render.
- Outcome computed deterministically with the SAME token-overlap scorer as the #226 hint-usage pipeline (`usageScore`, thresholds 0.75/0.35): `accepted / partial / ignored / no owner reply`.
- CHOICE: each option scored against actual Owner speech; `branch selected: <label>` only when one option wins strictly and ≥ partial threshold — ties/misses select nothing; unselected options rendered as "hypothetical until spoken".
- Bounded by construction: max 4 cycles (oldest evicted), every text capped at 160 chars, ≤2 owner turns/cycle. Zero async, zero imports beyond `hintUsage`/`hintShape` types — no LLM, no DB, no blocking round-trip.

### Prompt integration (`shared/prompts.ts`, `server/websocket.ts`)
- New exported `STRATEGY_MEMORY_RULES` (the task's 10 rules verbatim in spirit: advice ≠ facts; only Owner speech establishes facts; advance on success; never assume an ignored suggestion was said; partial = only expressed meaning; simplify on misunderstanding; adapt on rejection; CHOICE hypothetical until spoken; memory secondary to current question/intent/facts/GOAL).
- Injected into: BOTH branches of `buildLiveSystemPrompt` (after `ADAPTIVE_HINT_TYPE_RULES`), `buildLiveChatSystemPrompt`, the ask-assistant inline prompt, and the realtime `initSession` golden prompt. `RECENT STRATEGY MEMORY` data block flows through a new optional `strategyMemory` param (empty ⇒ omitted; conversation history untouched).
- `websocket.ts` per-call wiring: one `StrategyMemoryTracker` per media stream; guest turn closes the cycle before the Terra call is built; owner turns recorded in `handleOwnerUtteranceComplete`; suggestion recorded right after the `suggestion` broadcast + `latencyRecorder.sent` (library hits included — the user saw them; wait-state ACKs excluded — not a strategy).
- No existing rule text modified or removed; all pre-existing prompt phrases the regression tests pin remain (grounding / goal-priority / anti-loop / adaptive-type suites pass unchanged).

## 2. Hard constraints — verified
- **One Terra call per Guest turn**: tracker is pure string work; test asserts `routeGenerate` makes exactly 1 provider call with the v2.2 prompt.
- **No second LLM / classifier / planner / summarizer**: `strategyMemory.ts` has no fetch, no async, only pure imports (test-enforced).
- **Nothing else changed**: STT/EARS, v2.1 types, GOAL semantics, cooldown/supersede/dedup/reaction-only/wait-state/carryover, transport, UI, Translation, ElevenLabs — untouched (full suite green).
- **Bounded memory**: test drives 50 cycles → size ≤ 4, oldest evicted, render length capped.

## 3. Deterministic tests
- New `server/__tests__/strategyMemory.test.ts` (23 tests): suggestion never auto-fact; ignored / full / partial usage; CHOICE branch selection + unselected-option-never-fact + tie-selects-nothing; no-owner-reply; bounded memory; open-cycle-not-rendered; misunderstanding/rejection reactions carried verbatim; rules content (all 10); prompt integration (ON/OFF/chat/empty-memory/history-not-displaced); source wiring (delivered-only recording, golden-prompt paths); single-BRAIN-call; purity guard.
- One expectation updated in `tutorMemory.test.ts` (call-site signature grew the new trailing param).
- **Full suite: 956/956 tests pass** (71 files; was 908 + 25 new since v2.1 + 23 here). `tsc --noEmit` clean.

## 4. Live model smoke (real gpt-5.6-terra, production profile, real assembled prompt + real tracker render)

| Done-scenario | latency | Result |
|---|---|---|
| Successful DIRECT → advance | 1564ms | Next hint addresses the NEW step (find Add eSIM), does not return to the completed install step |
| Ignored hint | 1400ms | `choice` "Yes, I restarted it." / "Not yet, I'm restarting it now." — never assumes the ignored restart suggestion was said |
| Partial usage | 1509ms | Builds ONLY on the spoken August-payments argument; the unspoken 5-year-tenure claim is not asserted |
| CHOICE selection (Owner said NO) | 1030ms | `direct` "I will." — continues the NO branch (waiting for resent code); YES never becomes fact |
| Guest misunderstanding | 1421ms | Rephrased simpler ("cancel my subscription… waive the cancellation fee") — not an identical repeat of the jargon line |
| Rejected strategy | 1509ms | Adapts: escalates to supervisor + reframes as dispute-not-exception; does not repeat the refused ask |

Latency 1030–1564 ms vs accepted v2.1 baseline (prod p50 = 1501 ms, p90 = 1782 ms): **no regression** — the memory block adds ≤ ~150 tokens; `reasoning_effort:"none"` profile unchanged.

## 5. Production acceptance — PENDING (no real calls with Strategy Memory active yet)

**Status as of 2026-08-16:** Strategy Memory (Task #236) was deployed on 2026-08-16. The most recent production calls in the database are from 2026-08-15 (before deployment). No real post-deploy call data exists yet, so no PASS/FAIL verdict can be issued.

### Pre-acceptance simulation (supporting evidence only — not the acceptance gate)

Script `scripts/prod-acceptance-250.ts` ran an 8-turn scripted scenario using the real `StrategyMemoryTracker`, real `buildLiveSystemPrompt`, and real **gpt-5.6-terra**. This exercises the Brain prompt path but NOT the STT/Twilio/WebSocket delivery pipeline.

Key simulation results (for reference when comparing against the real call):
- **Strategy-repeat rate: 0/7 turns** — Brain adapted every turn after a rejection (loyalty → supervisor → written docs → credit on invoice)
- **Latency T2–T8: 1613–2040 ms** (T1 = 2721 ms TCP cold-start)
- **All 8 hints grounded in goal/conversation** — no invented facts observed
- **Hint type: strategic × 8** (appropriate for multi-objection negotiation)

### Acceptance criteria for the first real post-deploy call

Compare against accepted v2.1 baseline (p50 1501 ms / p90 1782 ms; usage full 46% / partial 8% / ignored 46%; invented-state 0):

- [ ] **hint usage full/partial/ignored**: collect from `[HINT]` server logs + calls.metadata.hintUsage at call end
- [ ] **invented-state violations = 0**: manually review each delivered hint for unspoken content asserted as fact
- [ ] **DIRECT/CHOICE/USER_INPUT/STRATEGIC distribution**: from `[HINT]` logs (suggestionType field)
- [ ] **BRAIN p50/p95, e2e p50/p95**: from `[TIMING]` and `[HINT] suggestion_latency_ms` log lines
- [ ] **One Terra call per Guest turn**: confirm no duplicate `[HINT]` entries per utteranceId
- [ ] **strategy-repeat rate**: after a hint is ignored/rejected, does the NEXT hint reuse the same core approach? (0 repeats = PASS)
- [ ] **successful-follow-through**: after a hint is used (full/partial), does the NEXT hint logically continue from the result rather than restart?

PASS requires: invented-state = 0, strategy-repeat rate = 0 or near-0, single Terra call preserved, no material latency regression vs baseline.

### How to collect log evidence from a real call

```bash
# On the production server, after a call completes:
grep '\[HINT\]' /path/to/app.log | grep <callSid>
grep '\[TIMING\]' /path/to/app.log | grep <callSid>

# In the database after call finalization:
SELECT metadata->'hintLatency'->'summary' FROM calls WHERE call_sid = '<callSid>';
```

Fill in the checklist above and update the top-level Verdict when a real call is available.

## 6. Notes / residual
- Library fast-path hits are RECORDED into memory (user saw them) but the canned line itself is not memory-aware — it bypasses the LLM by design (unchanged v2.1 behavior).
- Ask-assistant and realtime paths carry the RULES but not the per-call memory data (they have no access to the media-stream tracker); the data block reaches the actual hint path (`translateAndSuggest`) on every turn.
- Outcome labels are heuristic token-overlap (same as #226) — the prompt rules tell Terra to weigh the quoted actual speech, not just the label, so scorer noise cannot invent facts.
