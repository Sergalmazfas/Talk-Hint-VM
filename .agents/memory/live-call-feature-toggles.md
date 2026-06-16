---
name: Live-call feature toggles (Live Hints + Translation)
description: How the per-user Live Hints / Translation toggles gate the live-call hint pipeline, and the easy-to-miss suggestion paths.
---

# Per-user live-call toggles

Two per-user booleans on `users` (`live_hints_enabled`, `translation_enabled`, both default true) control the live hint pipeline. Stored server-side; iPhone settings screen + `/api/settings/hints` GET/POST. Loaded per call in `server/websocket.ts` on the Twilio "start" event (chained off `ownerContextReady`, keyed by the resolved call owner) into a `callSettings` var; default ON if load fails.

**Rule: Live Hints OFF means NO model call at all** — short-circuit before `translateAndSuggest` (no GPT/Gemini, no translation, no suggestion). Still broadcast the raw final transcript (original language). Transcription, transcript persistence, post-call summary/contact memory, and AirAtoma CRM delivery are all independent (they run on socket close), so they keep working — do NOT touch them.

**Rule: Translation OFF must gate EVERY suggestion output, not just `translateAndSuggest`.**
**Why:** suggestions reach the UI from several places, and it's easy to fix only the model path and leave hardcoded localized strings translated. The paths that all carry a `translation` field:
- `translateAndSuggest` output (guest transcript translation + suggestion.translation) — gated via its `translateEnabled` param + post-parse force-empty.
- Goal-achieved **closing** phrase (hardcoded ru/es string).
- Wait-state **ACK** phrase (`ackPhrases` ru/es).
- **fast_phrase** layer (FastLayerManager callback — currently disabled, but still a hint feature; suppress entirely when hints OFF).
**How to apply:** when adding any new live suggestion/hint broadcast, gate emission on `callSettings.liveHintsEnabled` and send `translation: ""` when `!callSettings.translationEnabled`.
