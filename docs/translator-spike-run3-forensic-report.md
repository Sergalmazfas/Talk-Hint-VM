# Translator Spike — Run #3 forensic report (2026-08-18)

Source: `attached_assets/translator-spike-run2-report_1787064565123.json` (single live run, RU→EN, voice Cedar, mic gate v#280 active).

## Verdict: acoustic feedback loop is GONE

All 5 forensic suspicions from Run #2 are **DISPROVEN** by the event log:

- `playbackRecapture` — DISPROVEN: no committed source turn opened while translated audio was playing.
- `cancelledResponseContinuedOutput` — DISPROVEN.
- `multipleResponsesPerTurn` — DISPROVEN: 7 responses for 7 committed turns, all attributed 1→1.
- `inputBufferNotClearedAfterCancel` — DISPROVEN.
- `noiseMicroturnsCommittedMultilingual` — DISPROVEN.

Mic gate demonstrably working: **6 gate intervals, 19.0 s total gated time**; every playback window shows `mic_audio gated:true` frames that never reached the provider. `feedback_suspect_source_turns: 0`, `invariant_violations: 0`.

Latency: median **291 ms**, p95 **362 ms**. Cost ≈ $0.092/active-audio-minute.

## The «What about you?» incident (turn 6)

User reported a phrase he never said. Event log (seq 249–272) shows:

1. Playback of the previous translation ended (seq 250), gate closed correctly (seq 251).
2. **2.3 s later**, a fresh `speech_started` fired with playback inactive (seq 254) — so this is NOT feedback; the mic picked up ~0.85 s of real ambient sound/breath.
3. The fragment was committed, but **input transcription never produced a source text** for that item.
4. The model, given an unintelligible micro-utterance, **invented a conversational filler** — «What about you?» — and voiced it (650 ms of audio was played, seq 263–271; user likely didn't notice the short quiet clip).

Classification: **model-added content** (the known gpt-realtime weakness the prompt hardening reduces but does not eliminate), triggered by a committed micro-utterance without a usable transcript. Same class as turn 1 («Yes, that's right», 1.07 s input, no source transcript).

## Follow-up direction

Suppress responses for committed turns whose input transcription is empty/unintelligible (or below a duration threshold), instead of letting the model improvise.
