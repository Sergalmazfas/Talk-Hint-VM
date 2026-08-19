# TalkHint Admin — Diagnostic Call Recording & Benchmark Corpus v1 — Evidence Report

Date: 2026-08-14. Status: **BLOCKED — awaiting the first real phone call** (all code paths implemented and tested; final PASS requires a real Twilio call → recording → Gold Call → EARS/BRAIN → Replay, which only the diagnostic user can perform).

## Existing Twilio architecture (found)
- Outbound (web): browser client `client:user-{id}` → `/twilio/voice` → `<Start><Stream both_tracks>` + `<Dial answerOnBridge>` to the PSTN number; final status via `/twilio/dial-status` (parent leg).
- Incoming: Twilio number → `/twilio/voice` (owner lookup) → pending call + hold loop `/api/twilio/hold`; on accept the caller leg starts the media stream and is bridged either to `<Dial><Client>` (browser) or to a per-call conference (iOS).
- Live transcripts persist to `calls.transcript` (leading-edge + throttled flush) in "Speaker: text" line format.

## Native recording mechanism
- Twilio Voice Recording API only — no custom recorder, no Media Stream chunk assembly.
- Outbound web calls: `record="record-from-answer-dual"` on `<Dial>` (dual-channel: Owner/Guest separable).
- Incoming answered on web: same dual-channel `record` on the caller-leg `<Dial><Client>`.
- Incoming answered on iOS: conference recording `record-from-start` (Twilio conferences are mixed-channel; dual not supported there).
- All recording completion arrives via the standard `RecordingStatusCallback` → `POST /twilio/recording-status` (Twilio-signature-validated).

## Diagnostic recording policy
- Separate backend capability `users.diagnostic_recording_enabled` (default **false** for everyone). NOT tied to admin role.
- Enabled initially only for the approved admin/test account (`sergalmazfas@gmail.com`, Replit-auth login).
- Capability check is fail-closed: any DB/lookup error → "do not record"; a recording failure can never stop or degrade the call (all bookkeeping is try/caught, callbacks always answer 200).
- Recording is not enabled by a global environment toggle; the per-user admin capability is the only authority.

## Diagnostic recording policy
- Twilio does not announce recording automatically.
- Diagnostic calls from the approved test account to its own phones are recorded silently: no outbound whisper or incoming recording notice is played.
- Recording is controlled only by the per-user `diagnostic_recording_enabled` admin capability. The legacy global benchmark toggle cannot enable recording.
- Call metadata distinguishes `silent-test-v1` diagnostic recordings (`recordingNoticeText: null`) from diagnostic recordings that retain the configured notice (`notice-v1` by default).

## Stored metadata (per recorded call)
TalkHint call id ↔ CallSid ↔ RecordingSid, recording status, channels, duration, completion timestamp, consent policy version, diagnostic flag, plus (after intake) benchmark fixture id / Gold Call status.

## Admin → Diagnostics → Recorded Calls
New 5th tab (admin-gated, Bearer + email allowlist): list with date/time, duration, call id, recording status, channels, transcript presence, Gold Call and benchmark status; actions: Play (server-proxied WAV — Twilio credentials never reach the browser), View Transcript, Mark as Gold Call, Run EARS, Run BRAIN, Open Replay, Delete. The web dashboard shows an «Админ» button only for allowlisted admins (`/api/auth/me` → `isAdmin`; enforcement stays server-side).

## Benchmark integration (no second engine)
- Every completed diagnostic recording is auto-sent to the existing #172 bench: after a 20 s transcript-settle delay, a `recorded_call` fixture is created (real dual-channel audio + live transcript as reference turns) and EARS + BRAIN runs start automatically. Каждый звонок — это тест.
- Auto-recorded calls are NOT automatically Gold Calls. "Mark as Gold Call" freezes the fixture: audio copy, reference transcript (admin can override turns), Owner/Guest mapping, goal/confirmed facts if present, source CallSid, recording config, `gold-<ts>` version, capture timestamp. Later production transcript changes never mutate the frozen fixture.
- Candidates/availability/no-silent-substitution rules are exactly #172's.

## Security / retention
- Admin-only endpoints (fail-closed allowlist); audio streamed via server proxy; no audio or credentials in logs.
- Delete removes the recording from Twilio (by RecordingSid, URL fallback) and strips local recording metadata; `?includeFixture=1` also purges frozen fixture audio.
- Recordings are never used for model training and never forwarded to CRM/AirAtoma/other products (delivery paths untouched).
- Normal users: no recording attributes are ever emitted unless the flag/env is set (default path unchanged, verified by code inspection + unchanged test suite: 705/705 green).

## Acceptance checklist state
Implemented & unit/type-verified: items 1–2, 17–18 (policy fail-closed by construction), plus all server/UI plumbing for 3–16.
Pending the real call by the diagnostic user: items 3–16 end-to-end evidence (real CallSid/RecordingSid, callback logs, playback, Gold Call, EARS/BRAIN scorecards, Replay). Note: BRAIN/EARS runs also require the OpenAI account to have credits (exhausted as of Run #1, see #172 report).

**Final verdict: BLOCKED → will flip to PASS after the first real recorded call completes the full chain.**
