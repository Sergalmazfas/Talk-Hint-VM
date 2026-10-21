# Secretary Lab — isolated administrator conversation bench

Location: `/secretary-lab`, linked from Dashboard and the existing
`/admin/diagnostics` model bench. Same benchmark email allowlist and normal
TalkHint bearer authentication; no additional account.

## What is real

The browser is the test counterpart, not the owner microphone in a real call.
The lab invokes the **same** Secretary agent and instructions, OpenAI Realtime,
STT and owner-selected ElevenLabs/Cartesia voice. There is no telephone-number
input and no import of the dialer, task worker or call storage.

An in-memory Twilio protocol peer preserves μ-law 8 kHz framing, 20ms paced
output, playback marks and clear/interruption semantics. Browser microphone
frames enter the same native agent path. The lab does **not** validate PSTN,
carrier transfers, real Twilio networking or acoustic output from the user's
hardware.

## Security and data

- A paid-processing consent checkbox is required before session creation.
- HTTP endpoints: GET `/api/admin/secretary-lab`, POST
  `/api/admin/secretary-lab/sessions`, DELETE
  `/api/admin/secretary-lab/sessions/:id`.
- First-frame WebSocket authentication on `/secretary-lab-stream`, same-origin
  only. Tickets expire in 30 seconds and are single-use, never URL parameters.
- One active session per owner, six starts/hour, five minutes/session.
- Session disconnect closes the engine; no automatic reconnect, retry or dial.
- Reports contain text, translations, events and metrics, **not audio**, private
  voice identifiers or tickets. Reports are owner-scoped and in memory only.
- Retention is approximately one hour (one-minute cleanup interval); reboot
  clears history. This is not a durable production-call history.
- Existing linked voice is NOT proof that it is the owner's personal clone.
- Lab does not turn diagnostic recording on/off for ordinary telephone calls.
- No new database tables or migrations.

## First owner test

1. Open Secretary Lab in the development app and sign in with the existing
   benchmark-admin account. If voice is unavailable, use the existing Voice Lab
   to configure it; do not substitute a shared voice silently.
2. Review the assignment/provider and paid-processing consent. Use headphones.
3. Start and allow microphone/audio. Act as the company's representative.
4. Say “Please hold while I try to connect you”, try silence/music, then speak as
   a new representative. Interrupt one of the Secretary's replies.
5. Stop; inspect played utterances, translations, telemetry and end reason.
   Export JSON if needed. No audio is exported.

Latency metrics distinguish server output timing from browser scheduling and
final STT timing. They are not a physical speaker audibility measurement.
Translation failure never intentionally terminates audio.

## Verification boundary

Verified during implementation: **118 test files / 1453 tests passed**,
TypeScript passed, offline build and MCP inclusion gate passed. Development
server restarted successfully; anonymous live GET returned **401**. Desktop and
phone-width visual fixtures rendered without browser errors. No actual paid
conversation, phone call or publication was performed.

Isolated tests use the real agent with injected no-network Realtime/TTS and
local HTTP/WebSocket transports. Visual harness
`scripts/serve-secretary-lab-preview.ts` renders the real component with fake
readiness and rejects session creation. Never mount that harness in the app.
Do not claim an actual model/voice conversation, iPhone audio permission flow
or carrier call has passed until the owner performs it.
