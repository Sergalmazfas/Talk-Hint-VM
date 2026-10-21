# Secretary Lab — isolated administrator conversation bench

Location: `/secretary-lab`, linked from Dashboard and the existing
`/admin/diagnostics` model bench. Same benchmark email allowlist and normal
TalkHint bearer authentication; no additional account.

## What is real

The browser is the test counterpart, not the owner microphone in a real call.
The existing cloned-voice option invokes the **same** Secretary agent and instructions, OpenAI Realtime,
STT and owner-selected ElevenLabs/Cartesia voice. There is no telephone-number
input and no import of the dialer, task worker or call storage.

An in-memory Twilio protocol peer preserves μ-law 8 kHz framing, 20ms paced
output, playback marks and clear/interruption semantics. Browser microphone
frames enter the same native agent path. The lab does **not** validate PSTN,
carrier transfers, real Twilio networking or acoustic output from the user's
hardware.

## Explicit Dev comparison: GPT-Realtime-2.1

Choose **OpenAI · WebRTC** to compare against the existing ElevenLabs option.
The task text is retained when switching, and reports retain that exact task.
This mode is enabled only when `NODE_ENV=development`; publishing the code does
not enable this experiment in production. It is not connected to ChatGPT.

- Exact model: `gpt-realtime-2.1`, built-in voice `marin`, reasoning `high`.
- Account model access is checked with the Models API, cached for one minute.
  An unavailable model disables this option with a reason, without substitution.
  The actual session model and voice must match before the mic is enabled.
- Browser microphone and OpenAI-generated speech use direct WebRTC. No
  ElevenLabs/Cartesia synthesis and no STT-to-text-to-TTS conversational chain.
  Optional input transcription is solely for the displayed report/subtitles.
- The backend negotiates SDP at owner-authenticated
  `POST /api/admin/secretary-lab/sessions/:id/webrtc`. The browser never receives
  the standard API key. Negotiation and introduction are single-use.
- Trusted provider-side transcripts arrive through an authenticated server
  sideband and the existing owner-ticket WebSocket, not arbitrary browser text.
- Semantic VAD interrupts server playback. The client immediately mutes obsolete
  output and only unmutes a new response. Interrupted generated text is marked;
  no assertion that every generated word was physically heard.
- A hold instruction acknowledges once then waits; there is no silence timeout.
  The existing five-minute session cap remains. Hold music replaces the outgoing
  audio track without routing it to speakers, then restores the original track.
- Existing cloned-mode mic processing now has an explicit zero-gain output sink
  and zeroes the processor output before every early return. The microphone is
  never intentionally played through local speakers. Acoustic echo cancellation
  is requested, but real device behavior must be tested separately.

Availability was verified against the actual account: Models HTTP 200 and a
Realtime session accepted the exact model, `marin`, high reasoning and semantic
VAD. This is distinct from verifying a complete live conversation.

Optional paid integration probe:
`npx tsx scripts/probe-secretary-lab-realtime.ts --live`.
It uses synthetic counterpart speech, Chromium WebRTC and the actual OpenAI
sideband; no owner profile, Twilio, telephone numbers or audio files. Never run
it as a publish gate. An automated Chromium result does not prove iPhone quality.

### Actual verification, 2026-10-21

- Exact Models lookup: HTTP 200. A real session echoed `gpt-realtime-2.1`,
  `marin`, high reasoning and semantic VAD.
- Actual browser WebRTC connected and began model speech; synthetic counterpart
  speech caused a real speech-start and output-buffer-cleared event without
  ending the session. Full browser dialogue was **not accepted**: the synthetic
  audio harness did not observe speech-end/final input transcription after the
  interruption. Its finite WebAudio input lacked a continuous silence source;
  the harness has been corrected but the corrected browser run is unverified.
- Independent real provider-audio validation
  (`--live --websocket-check`) **passed** with continuous clocked input: Hello,
  clarification about Saturday, one hold acknowledgment, eight actual seconds
  waiting, then an answer correctly retaining Saturday 09:00–12:00. This used
  the requested model and voice, no clone synthesis, and saved no audio.
  This check is NOT the browser WebRTC transport or a runtime fallback.
- Mock tests cover 180-second waiting, interruption/obsolete output rejection,
  single negotiation, recovery without renegotiation, owner isolation,
  unavailable-model refusal and cleanup.
- Physical iPhone microphone, speaker/AEC, Safari autoplay and end-to-end
  intelligibility remain unverified. Do not label this experimental option
  fully working based on availability or provider-only validation.

For the native-audio comparison, latency is VAD speech-end → provider RTP-output
start, not optional STT completion → browser scheduling and not acoustic latency.

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

The initial implementation passed TypeScript, offline build, MCP inclusion and
the then-existing test suite. However, the owner's first live test did not
produce a usable dialogue. That passing suite did not establish live readiness.

Additional regressions cover cancellation after model completion while external
TTS plays, server-VAD cancellation races, multiple turns with valid non-aligned
PCM tails and the native-to-browser codec. Chromium Web Audio rendered a
synthetic jittered stream at 44.1 and 48 kHz without speech-frame gaps. These
checks do not establish real clone quality or iPhone microphone interoperability.

Browser failure categories are preserved in the report instead of being
reported as user stops. Server end logs contain session ID, category, counts
and last stage only, never transcript, audio, identity, ticket or voice ID.

Isolated tests use the real agent with injected no-network Realtime/TTS and
local HTTP/WebSocket transports. Visual harness
`scripts/serve-secretary-lab-preview.ts` renders the real component with fake
readiness and rejects session creation. Never mount that harness in the app.
Do not claim an actual model/voice conversation, iPhone audio permission flow
or carrier call has passed until the owner performs it.
