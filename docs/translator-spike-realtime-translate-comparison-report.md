# Translator Spike — gpt-realtime-translate adapter + head-to-head comparison (task #286)

Date: 2026-08-18. Status: adapter built, contract verified live, stand extended.
Live head-to-head runs (real microphone) are pending — only the user can
perform them; see "How to run the comparison" below.

## 1. Contract forensic (verified, not assumed)

Sources: official OpenAI docs (guide, model page, cookbook, client/server
event reference) + **two live probes against the real endpoint on 2026-08-18**
(raw WS probe and a full adapter smoke through the provider abstraction).

| Feature | Current provider (gpt-realtime, conversational) | gpt-realtime-translate | Source |
|---|---|---|---|
| Endpoint | `wss://api.openai.com/v1/realtime?model=…` | `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate` (only this one) | docs + live probe |
| Audio in | PCM16, configurable rate; VAD-committed turns | base64 PCM16 **24 kHz**, continuous stream INCLUDING silence (`session.input_audio_buffer.append`) | docs + live probe |
| Audio out | per-response audio deltas | `session.output_audio.delta`, PCM16 24 kHz, ~200 ms chunks | docs + live probe |
| Turn lifecycle | full (speech_started/stopped, response.created/…) | **none** — no response.create, no conversation items, no VAD events | docs + live probe (only 7 server event types exist) |
| Cancellation / barge-in | response.cancel | **none** | docs |
| Custom prompt / instructions | yes (strict interpreter prompt) | **no** — session.update accepts only `audio.output.language`, `audio.input.transcription`, `audio.input.noise_reduction` | docs + live probe (session.updated echo) |
| Voice selection | marin / cedar | **no** — dynamic voice adaptation (voice follows the speaker's tone) | docs |
| Source transcript | built-in input transcription | opt-in companion model `gpt-realtime-whisper` → `session.input_transcript.delta` | docs + live probe |
| Graceful end | close socket | `session.close` → server flush → `session.closed` (verified) | live probe |
| Languages | prompt-driven | 13 output languages (incl. en/ru/es), 70+ input with auto-detect; may NOT translate speech already in the target language (documented behavior) | docs |
| Pricing | token-based (~$32/M audio-in etc.) | **$0.034 per audio minute** (duration-based; silence bills too) | model page |
| Rate limit | token TPM | Tier 1: 50 audio-minutes per minute | model page |

Live probe transcript facts: `session.created` returns `type:"translation"`,
default output language `es`, `include:null`; `session.updated` confirms
language + whisper transcription; `session.closed` arrives after
`session.close`; an output-audio delta can arrive even for non-speech input
(the model streams audio freely — there is no turn gating).

## 2. What was built

- `server/translation/openaiRealtimeTranslateAdapter.ts` — second provider
  behind the existing `RealtimeTranslationProvider` abstraction. The current
  adapter and production code are untouched.
- **Local segmentation**: the provider has no turn lifecycle, so per-turn
  metrics come from a local RMS speech segmenter (`openRms 0.02`, hangover
  600 ms, speech-end backdated to the last voiced frame). Timestamps were
  always measured on our side; what is NEW and approximate here is
  **attribution**: transcripts accumulated between local segment boundaries
  are assigned FIFO to the segment. This is labeled methodology, not
  provider data.
- **Latency metric**: speech-end (local segmenter) → first
  `session.output_audio.delta` after speech-end. Not directly comparable to
  the current provider's server-VAD-based latency; both are honest but
  measured differently — noted wherever numbers appear side by side.
- **Cost**: per-turn estimate = input-audio-minutes × $0.034. Wall-clock
  session time also bills (silence streams too); the per-turn figure is a
  lower bound and labeled ESTIMATED.
- **No suppression gates** were copied from the conversational adapter
  (micro-turn gate etc.): task #286 measures the purpose-built model's
  NATIVE behavior first.
- Stand (`/translator-spike`): a single new "Provider" selector. When
  gpt-realtime-translate is chosen the voice selector is hidden
  (capabilities-aware UI — no dead controls). Changing provider live cleanly
  restarts the session, same as the other controls. `session_config` now
  carries `provider` + `capabilities`.
- **Bounded handshake**: `startSession` can never hang — if `session.updated`
  does not arrive within 10 s the socket is terminated and the start fails
  honestly (tested against a fake stalled server).
- **Capability-aware scorecard**: this provider emits no item ids, so
  item-id lost-translation correlation is reported as UNAVAILABLE
  (`correlation_methodology` field) instead of falsely counting every
  utterance lost; translated count falls back to completed local segments
  with a translation transcript.
- **Honest cost accounting**: for the duration-billed provider the
  scorecard's total = wall-clock minutes × $0.034 (silence bills too) and
  `cost_methodology` labels per-turn values as PARTIAL speech-segment
  estimates.
- **Continuous input preserved through the mic gate**: for
  gpt-realtime-translate a gated microphone frame is replaced by a
  same-size zeroed (silent) frame instead of being dropped — the contract
  requires an unbroken 24 kHz timeline including silence, and gaps would
  change native model behavior. The conversational provider keeps the
  original drop behavior (its server VAD would otherwise commit silence
  turns). Logic embedded from the tested `gatedFrameAction` helper.
- Tests: 30 new/updated (segmenter, RMS, event mapping, turn finalization
  idempotence, latency guard, capabilities, provider allowlist fail-closed,
  stalled/closed/unreachable handshake). Full suite: **1038 tests / 78 files
  green**. `tsc` clean (pre-existing `server/db.ts` error excluded, as
  agreed).

## 3. Capabilities declared by the adapter

`voiceSelection:false`, `customPrompt:false`,
`sourceTranscriptBuiltIn:false` (whisper companion), `turnLifecycle:false`,
`cancellation:false`, `dynamicVoiceAdaptation:true`, output langs en/ru/es.

## 4. Verification performed

| Check | Result |
|---|---|
| Raw WS probe: connect, session.update (ru + whisper), silence stream, session.close→closed | PASS |
| Adapter smoke via provider abstraction: ready → speech_started/stopped (local) → translated_audio → turn_completed (latency 671–751 ms for a synthetic tone) → clean stop | PASS |
| ready-event replay to late subscribers (stand subscribes after startSession) | PASS (fixed + smoke re-run) |
| Full vitest suite + tsc | PASS (1035/1035) |
| Stand page serves with provider selector | PASS (HTTP 200) |

## 5. Head-to-head scorecard — PENDING LIVE RUNS

Only a human with a real microphone can produce honest comparison data.
Methodology (same as Run #2/#3):

1. Open `/translator-spike` (dev), pick provider, run 30–40 turns RU→EN:
   normal phrases, the Run #3 hallucination cases («Сегодня день рождения
   моего сына…»), throat-clearing/noise-only inputs, the echo test
   (speakers on), and one long multi-sentence turn.
2. Repeat with the other provider, same script.
3. Export JSON for each run; compare: translation fidelity, model-added
   content on noise (the current provider needed the micro-turn gate —
   does the purpose-built model add content natively?), latency
   (methodologies differ — compare distributions, not single numbers),
   voice quality/gender behavior (dynamic adaptation vs fixed voice),
   cost per minute.

| Criterion | Current (gpt-realtime) | gpt-realtime-translate |
|---|---|---|
| Contract forensic | PASS | PASS |
| Adapter + stand integration | PASS | PASS |
| Live fidelity run | PASS (Run #3) | **pending user run** |
| Noise/hallucination behavior | PASS after #282 gate | **pending — measure native behavior** |
| Latency (speech-end→first audio) | median 291 ms / p95 362 ms (Run #3) | 671–751 ms on synthetic smoke — needs real speech run |
| Verdict | baseline | **BLOCKED on live run** |

## 6. Preliminary recommendation

Defer the provider decision until the live head-to-head. Notable a-priori
trade-offs: gpt-realtime-translate removes our two biggest failure classes by
construction (no conversational replies — it cannot "answer" the speaker; no
turn machinery to mis-fire) and is dramatically cheaper ($0.034/min vs
token pricing), but gives up the custom interpreter prompt, fixed voice,
barge-in/cancellation, and any server-side turn semantics — and its smoke
latency looked higher than the tuned current pipeline. If live runs show
clean fidelity and acceptable latency, it is the structurally safer choice.
