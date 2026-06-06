---
name: Deepgram Flux (v2) STT
description: How TalkHint consumes Deepgram Flux streaming STT and why the Utterance Gate is now a thin finalizer.
---

TalkHint's live transcription uses Deepgram **Flux** (`flux-general-en`) on the v2
streaming endpoint `wss://api.deepgram.com/v2/listen`, replacing Nova-3 (v1).

**Rule:** Flux owns turn detection. Do NOT reintroduce Nova-3-style signals
(`is_final`, `speech_final`, VAD `SpeechStarted`/`UtteranceEnd`) or silence-timer
buffering in the gate. Flux emits `TurnInfo` events instead:
- `StartOfTurn` — speaker began; log only.
- `Update` — interim transcript; broadcast to UI as non-final, never run the pipeline.
- `EndOfTurn` — turn complete; commit to the pipeline + broadcast as final.

**Why:** Flux decides end-of-turn by meaning/intonation, so the old timer/VAD
buffering machinery is redundant and would double-fire. The gate is now a thin
finalizer (`commitTurn`) doing min-length filtering, consecutive exact-duplicate
suppression, and a per-speaker turn counter.

**Single-final rule:** emit exactly ONE final transcript per turn to the UI. The
EndOfTurn handler broadcasts the completed text as interim (isFinal:false); the
canonical final (guest carries translation, owner carries isComplete) is emitted
once by the handle*UtteranceComplete path. Marking the EndOfTurn broadcast final
double-fires the same line.

**How to apply:**
- Audio stays Twilio-native μ-law @ 8kHz (`encoding=mulaw&sample_rate=8000`), NO transcoding.
- Tuning: `eot_threshold=0.7`, `eot_timeout_ms=3000`. Eager mode OFF — never add
  `eager_eot_threshold` unless explicitly asked (it changes the event model).
- Do NOT send manual `{type:"KeepAlive"}` — Flux has a server-side watchdog and v2 ignores it.
- Auth header stays `Authorization: Token ${DEEPGRAM_API_KEY}`.
- Cross-track echo dedup (same words mirrored on both legs on speakerphone) stays
  in the websocket onGenerate callback, NOT in the gate.
- Track mapping (caller-leg inbound=GST/outbound=HON; owner-leg mirrored) is unchanged.
- `end_of_turn_confidence` and per-word confidence are available on EndOfTurn if you
  ever want to gate low-confidence turns (not currently used).
