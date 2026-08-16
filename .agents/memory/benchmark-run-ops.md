---
name: Benchmark run operations
description: How to run EARS/BRAIN benchmark runs and imports as the agent — env, auth, process durability gotchas.
---

# Benchmark run operations

- Benchmark storage lives in the **dev** DB (real fixtures + runs) even though the user browses admin UI on prod too; prod DB is read-only for the agent and prod admin gate rejects leo@talkhint.app (`BENCHMARK_ADMIN_EMAILS` = owner's personal email only — do NOT circumvent).
- **Why:** owner decided (2026-08-15) only his personal account is admin; ADMIN_PROVISION_USER account is deliberately excluded.
- **How to run a benchmark as the agent:** insert a temp row into dev `sessions` (id = 64-char hex token, user_id of admin user, expires_at) and call the running dev server's admin HTTP endpoints with `Authorization: Bearer <token>`. The dev server is the only durable process — long orchestrator runs launched via detached `nohup tsx` scripts die silently (shell disconnects kill them, env restarts wipe /tmp, and stray tsx processes end up with a dead DB pool).
- Env restarts can roll back uncommitted-looking dev-DB inserts made from one-off tsx scripts — always SELECT-verify after insert, and keep artifacts under `.agents/outputs/`, not /tmp.
- **Accelerated streaming vs Deepgram drain:** Deepgram (Flux & nova-3) processes accelerated input at ~1x realtime — after the last frame the transcript lags by up to duration×(1−1/accel). A short fixed flush window truncates the tail (this alone produced the artifact WER ~74% on Fixture #2; real Deepgram WER is ~8%). Drain must feed μ-law silence at realtime pace (idle socket dies after 60s with INACTIVE_CLIENT; Flux has no KeepAlive), stop on provider audio offset ≥ audio end or a full backlog time budget — NEVER on "no finals for N seconds" (a per-role channel is legitimately silent for minutes). Deepgram EOT/final latency figures under acceleration are backlog-inflated upper bounds, not production latency.
- Fixture import needs criticalEntities populated or the Numbers/Money and Terms scorecard columns come back null.
- Flux/batch candidates emitting fewer finals than reference turns silently fall back to document-level WER (turnsScored=2), making them incomparable per-turn (see follow-up task).

## Fixture #2 reference is STT-verified, not human-verified
Fixture #2 (09e6bcce…) reference_turns were rebuilt with user approval from whisper-1 segment boundaries (gives tEndMs → per-turn basis "timestamps") reconciled with gpt-4o-transcribe text; tags `ref-v-stt`/`reference-stt-verified`. **Why:** user chose STT self-verification knowing the bias — WER is systematically flattering to OpenAI candidates; never present these numbers as engine-neutral ground truth or use them alone to demote Flux in production.

## Per-turn reference verification (2026-08-15)
- Admin Edit Reference is now per-turn: turn-audio clips are sliced from the ROLE's channel using tStartMs/tEndMs (per-channel timeline, +300ms pad); PATCH one turn; bulk PUT is gated — structural change without `confirmDestructive:true` returns 409 (mergeReferenceTurns preserves timings/verified positionally). Never bulk-save an annotated fixture casually.
- Realtime-only EARS run: POST /ears/run {realtimeOnly:true} → shortlist section in report. First shortlist run on Fixture #2 (~20 min wall): OpenAI realtime WER ~7-9% vs Deepgram ~74% — a gap that large on the same audio smells like a measurement artifact (reference built by OpenAI STT + normalization), not real quality; do not act on it without human-verified turns.

## Copilot-chain judge (brain-v2)
- Judge = 6 chain dims + overall, each {score, explanation}; parse is fail-closed (any missing/malformed dim → null judge, never fabricated 1s); legacy bare-int accepted explicitly.
- The judge MUST receive the candidate-specific envelope (envByTurnIdx in brainHarness) — the pre-built envelopes have EMPTY hint history; passing them silently invalidates tried_memory/avoids_rejected_strategy. **Why:** this exact bug shipped once and was caught in review.
- Judge scores swing run-to-run (gpt-5.2: 8.71→6.43 on identical config) — single-sample LLM judging is noisy; don't make model decisions off one run (follow-up filed).
