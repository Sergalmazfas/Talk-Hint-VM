---
name: Translator Realtime Spike
description: Dev-only bench for realtime RU↔EN voice translation behind a provider boundary; OpenAI Realtime GA gotchas.
---

- Core rule: translation code depends only on the provider boundary (`server/translation/provider.ts`); OpenAI wire details live solely in the adapter. Future Translator screen / call integration must plug in here, not into OpenAI events.
- **Why:** user's explicit architecture requirement — provider abstraction first, OpenAI Realtime is only the first adapter.
- OpenAI Realtime GA (`gpt-realtime`): no `OpenAI-Beta` header (only `*preview*` models need it); GA session shape `{type:"realtime", audio:{input:{format,transcription,turn_detection}, output:{format,voice}}}`; GA event names `response.output_audio.delta` / `response.output_audio_transcript.*` (adapter also accepts beta names).
- Continuous open-mic + server VAD: mid-phrase pauses (~500ms silence) trigger a response, and continued speech CANCELS it (`response.done status=cancelled reason=turn_detected`). This is correct barge-in but means long monologues with pauses lose partial translations — a report finding, not a bug.
- Latency measured (speech end → first translated audio): 320–560 ms server-side on 5–10-word phrases; ~$0.015 per turn on gpt-realtime; numbers/dates/phone numbers carried exactly with the frozen interpreter prompt (`buildInterpreterInstructions`).
- Dev-stand auth pattern: per-boot random token embedded only in the dev-only page (404 in prod), WS upgrade rejected in prod entirely; timingSafeEqual compare. Simpler than user sessions for benches.
- **How to apply:** stage-2 iPhone integration should reuse the adapter + boundary; the headline latency is generation latency, not audible-playback latency — label it accordingly in UX claims.
