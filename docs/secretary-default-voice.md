# Secretary default: direct OpenAI audio

New Secretary tasks that omit `voiceProvider` select `openai`:
`gpt-realtime-2.1`, built-in `marin`, high reasoning. The Dev Lab selects this
option initially. Existing `elevenlabs` and `cartesia` selections remain valid;
already-created tasks and signed confirmations are never rewritten.

The phone path uses the existing owner-authenticated task, approval, single-use
dialer and signed Twilio Media Stream. It does NOT dial from the Dev WebRTC
comparison. The native OpenAI WebSocket uses `audio/pcmu` input and output
directly, no external voice synthesis or STT→text→TTS response chain.
Input transcription is for the saved report.

Before dialing, exact model access is checked; a mismatch/outage refuses the
attempt before a paid telephone leg. The actual model, voice and both telephone
audio formats are checked again at the realtime handshake. No automatic fallback.

Output is paced as 160-byte/20ms Twilio frames. On interruption, queued obsolete
audio is removed, Twilio receives clear, and model context is truncated to the
bounded amount sent/elapsed, excluding locally added silence padding.
Late chunks from the interrupted response are discarded. A complete secretary
transcript is persisted only after the corresponding Twilio playback mark;
generated-but-unconfirmed interrupted text is not presented as fully heard.
The existing five-minute call cap remains; silence/hold does not add a hangup
timer. Recording remains disabled and call approval/idempotency are unchanged.

## Scope and compatibility

- No DB migration or data rewrite: task creation always stores the selected
  provider explicitly; the historical SQL default is not changed.
- Translator, Copilot, normal calls and their shared iOS voice preferences are
  unchanged. Old iOS clients explicitly submit their stored ElevenLabs/Cartesia
  preference for Secretary, which is respected. Changing that native selection
  UX/default requires a separate iOS update; do not silently reinterpret it.
- MCP uses the same URL and OAuth configuration, with server version `1.4.0`
  and the additional optional provider choice. Existing scopes and call approval
  remain required.
- This is prepared source code, not a production publication. No real phone
  call has verified this native audio path.

## Verification

Actual account accepted the exact model, voice, high reasoning and **both**
`audio/pcmu` formats via an authenticated Realtime handshake, without input
audio, response generation or telephone dialing.
Mock wire/bridge tests cover G711 relay, single introduction, obsolete output
rejection, paced playback and marks, owner authorization, clone-free execution,
three-minute hold and unavailable-model refusal. Physical PSTN audio quality
and live interruption/latency still need one separately authorized phone test.
