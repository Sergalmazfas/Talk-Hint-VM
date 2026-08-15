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
- Diagnostic recording (per-user capability, not admin role): capability check in the Twilio webhook path is hard-deadlined + cached and fails closed to "don't record"; never let recording bookkeeping block TwiML.
- Twilio recording fetch/delete must go only to a canonical api.twilio.com Recordings URL for OUR account (built from a validated RecordingSid, redirects rejected) — a stored URL fetched blindly with Basic auth is an SSRF/credential-exfil hole.
- Real-call fixtures keep ORIGINAL telephone quality: dual-channel 8kHz WAV split per channel (de-interleave + PCM16→μ-law only), no enhancement/resampling — non-8kHz audio is rejected honestly. Each channel is scored against the reference turns of ITS role (channelRoles editable, default ch0=owner).
- Owner-first reporting: EARS report must give two separate conclusions — Best STT for Owner speech (headline; accented, short, imperfect speech) and Best for Guest/overall; batch is an accuracy ceiling and never a LIVE winner; nothing auto-changes production.
- Deepgram Flux TurnInfo carries CUMULATIVE turn transcript on every Update — collect finals only on EndOfTurn or WER explodes ~10x from duplication.
- When a candidate's turn detection collapses (finals < half of ref turns), score the channel as document-level WER with an explicit note — per-turn greedy alignment otherwise produces absurd 1000%+ WER.
- OpenAI GA realtime (2026): no `OpenAI-Beta: realtime=v1` header (beta_api_shape_disabled); under server/semantic VAD never send manual input_audio_buffer.commit (commit_empty, which must also be non-fatal) — append a silence tail instead.
- Long real calls: stream guard timeouts must scale with (audio duration / accel) + flush window, or multi-minute calls time out mid-stream at the fixed 60s guard.
- Production transcript is never reference ground truth — fixtures import it as a draft tagged needs-reference-review; the admin listens and edits via the reference editor (each save appends a ref-v<ts> tag).
