---
name: Translator Realtime Spike
description: Dev-only bench for realtime RU↔EN voice translation behind a provider boundary; OpenAI Realtime GA gotchas.
---

- Core rule: translation code depends only on the provider boundary (`server/translation/provider.ts`); OpenAI wire details live solely in the adapter. Future Translator screen / call integration must plug in here, not into OpenAI events.
- **Why:** user's explicit architecture requirement — provider abstraction first, OpenAI Realtime is only the first adapter.
- OpenAI Realtime GA (`gpt-realtime`): no `OpenAI-Beta` header (only `*preview*` models need it); GA session shape `{type:"realtime", audio:{input:{format,transcription,turn_detection}, output:{format,voice}}}`; GA event names `response.output_audio.delta` / `response.output_audio_transcript.*` (adapter also accepts beta names).
- Continuous open-mic + server VAD: mid-phrase pauses (~500ms silence) trigger a response, and continued speech CANCELS it (`response.done status=cancelled reason=turn_detected`). This is correct barge-in but means long monologues with pauses lose partial translations — a report finding, not a bug.
- Latency measured (speech end → first translated audio): 320–560 ms server-side on 5–10-word phrases; ~$0.015 per turn on gpt-realtime; numbers/dates/phone numbers carried exactly with the frozen interpreter prompt (`buildInterpreterInstructions`).
- Evidence correlation: never match source utterance ↔ translation/cancellation by event arrival order (async transcription + barge-in reorder events). Use the provider's conversation item_id with FIFO response attribution (input_audio_buffer.committed queue → response.done shift); compute associations at report time.
- Cancelled responses also emit response.done (status=cancelled) and consume their pending item; a cancelled turn must reset all per-turn accumulators so the next turn is clean.
- Half-duplex mic gate: gating decision must run off the SCHEDULED playback end (audio-context playhead, negative ms-since-end while queued), never the audible flag or onended callback — otherwise a leak window at the last chunk defeats the feedback fix; force-close open gate intervals at run-archive boundaries so durations land in the right run.
- Dev-stand auth pattern: per-boot random token embedded only in the dev-only page (404 in prod), WS upgrade rejected in prod entirely; timingSafeEqual compare. Simpler than user sessions for benches.
- Self-conversation failure mode (leading hypothesis, pending a live instrumented run): open-speaker playback re-entering the mic plus the "repeat verbatim if already in output language" prompt rule can create a self-continuing narrative loop, with multilingual STT hallucinating CJK on the resulting noise microturns. If confirmed, the fix is gating mic input during playback (half-duplex) rather than VAD tuning. Forensic verdicts must stay fail-closed: missing or truncated event-level evidence ⇒ INCONCLUSIVE, never "clean".
- gpt-realtime-translate (second adapter): dedicated endpoint `/v1/realtime/translations`, continuous 24 kHz PCM16 in/out INCLUDING silence, NO turn lifecycle/cancellation/custom prompt/voice (dynamic voice adaptation), source transcript via companion `gpt-realtime-whisper`, graceful end = `session.close`→`session.closed`, pricing $0.034 per audio minute (silence bills). Per-turn metrics require a LOCAL RMS segmenter; transcript↔turn attribution is FIFO between local boundaries — label as methodology. Emit `ready` before startSession returns ⇒ must replay it to late `onEvent` subscribers.
- **How to apply:** stage-2 iPhone integration should reuse the adapter + boundary; the headline latency is generation latency, not audible-playback latency — label it accordingly in UX claims.

## Continuous output stream vs half-duplex mic gate
gpt-realtime-translate streams output audio CONTINUOUSLY, including silence between phrases (~5x more audio out than speech in). Any mic gate keyed on "queued playback exists" therefore gates the mic FOREVER — the model never hears the user and the stand looks completely dead. The gate must key off the scheduled end of the last AUDIBLE (voiced, RMS-checked) chunk, never the raw playhead.
**Why:** live bug «он вообще не реагирует» — server logs showed mic frames + translated deltas flowing while the user heard/saw nothing: the client was substituting zeroed frames for every mic frame.
**How to apply:** any client playing a continuous-output translation stream (stand, future iOS/app integration) must use voiced-playback tracking for echo gating, or rely on device echo cancellation instead of half-duplex gating.

## iPhone browser audio and report export
The browser stand must not assume `AudioContext({sampleRate:24000})` is honored. Resample microphone audio from the actual context rate to provider-native 24 kHz, and resample returned 24 kHz PCM back to the device rate for playback.
**Why:** iOS Safari commonly runs its audio graph at 48 kHz; labeling unconverted device PCM as 24 kHz corrupts timing, recognition, pitch, and playback/gate duration.
**How to apply:** use the runtime `AudioContext.sampleRate` at both boundaries. On iOS, invoke Share directly from the tap before any awaited analysis (or Safari discards user activation), and retain a visible file-link fallback.


## Native iOS Translator isolation
The native Translator is a standalone authenticated RU↔EN channel with PCM16 mono at 24 kHz. It uses the provider boundary and must remain separate from `/ui`, Deepgram, Hint models/prompts, and Twilio media.
**Why:** translation was deliberately introduced as an independently testable mode so realtime audio behavior cannot regress the established phone/Hint path. Server-side direction is fixed so a client cannot silently select a different model or mode.
**How to apply:** translator start/stop on both iOS and server must be generation-guarded because delayed WebSocket/provider callbacks can otherwise tear down a restarted session or leak a late provider session. Gate mic capture during translated playback to prevent feedback.
## Translator candidate decision
For the current translator effort, the conversational `gpt-realtime` adapter is the selected candidate: it has demonstrated faithful RU↔EN behavior and should be integrated only through the separate Translator surface. The dedicated continuous translator is deprioritized.
**Why:** the live stand showed good quality and reverse-direction potential for `gpt-realtime`, while the continuous model emitted premature fragments and was not useful for the immediate deadline.
**How to apply:** preserve the existing Deepgram, hints, hint-model, and ordinary telephony paths; translator work must remain isolated until the iOS reverse-direction check is complete.
