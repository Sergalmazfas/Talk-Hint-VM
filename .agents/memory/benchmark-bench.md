---
name: LIVE Ears & Brain Benchmark bench
description: Durable rules for benchmark work — isolation from production telephony, fail-closed availability, PII policy
---

- The benchmark is a separate admin-only layer that must never import from or alter the production call path; the only allowed touch is the opt-in dual-channel recording toggle (env-gated, default OFF).
- **Why:** hard user constraint — production telephony must not change; no auto-switching of models based on benchmark results.
- Availability is fail-closed: a candidate is benchmarked only after a REAL API probe succeeds; unavailable candidates are reported UNAVAILABLE with the raw error — never silently substituted.
- **PII policy:** benchmark fixtures must be fully de-identified (synthetic names, SSN, DOB, call ids); never commit verbatim production transcripts. A committed real transcript was rejected in code review once already.
- Streaming LLM timeouts must cover the entire SSE body read, not just headers; every per-turn interaction is try/caught so one failed turn never blocks the next (continuity invariant).
- Benchmark tables are self-provisioned with idempotent CREATE TABLE IF NOT EXISTS at request time because the Reserved-VM deploy runs no drizzle migrations.
- API reality (Aug 2026): OpenAI realtime transcription is provisioned via POST /v1/realtime/client_secrets (older transcription_sessions endpoint 404s); semantic_vad accepted.
