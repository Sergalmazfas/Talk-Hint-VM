---
name: Benchmark run operations
description: How to run EARS/BRAIN benchmark runs and imports as the agent — env, auth, process durability gotchas.
---

# Benchmark run operations

- Benchmark storage lives in the **dev** DB (real fixtures + runs) even though the user browses admin UI on prod too; prod DB is read-only for the agent and prod admin gate rejects leo@talkhint.app (`BENCHMARK_ADMIN_EMAILS` = owner's personal email only — do NOT circumvent).
- **Why:** owner decided (2026-08-15) only his personal account is admin; ADMIN_PROVISION_USER account is deliberately excluded.
- **How to run a benchmark as the agent:** insert a temp row into dev `sessions` (id = 64-char hex token, user_id of admin user, expires_at) and call the running dev server's admin HTTP endpoints with `Authorization: Bearer <token>`. The dev server is the only durable process — long orchestrator runs launched via detached `nohup tsx` scripts die silently (shell disconnects kill them, env restarts wipe /tmp, and stray tsx processes end up with a dead DB pool).
- Env restarts can roll back uncommitted-looking dev-DB inserts made from one-off tsx scripts — always SELECT-verify after insert, and keep artifacts under `.agents/outputs/`, not /tmp.
- Fixture import needs criticalEntities populated or the Numbers/Money and Terms scorecard columns come back null.
- Flux/batch candidates emitting fewer finals than reference turns silently fall back to document-level WER (turnsScored=2), making them incomparable per-turn (see follow-up task).

## Fixture #2 reference is STT-verified, not human-verified
Fixture #2 (09e6bcce…) reference_turns were rebuilt with user approval from whisper-1 segment boundaries (gives tEndMs → per-turn basis "timestamps") reconciled with gpt-4o-transcribe text; tags `ref-v-stt`/`reference-stt-verified`. **Why:** user chose STT self-verification knowing the bias — WER is systematically flattering to OpenAI candidates; never present these numbers as engine-neutral ground truth or use them alone to demote Flux in production.
