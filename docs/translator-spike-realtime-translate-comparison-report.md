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

## 5. Head-to-head scorecard — live evidence received (incomplete)

Two exports and the user's live observation were received on 2026-08-30.
They do **not** yet form a valid head-to-head: the non-empty export identifies
itself as `openai-realtime` / `gpt-realtime` (Marin), while the export captured
for the selected `gpt-realtime-translate` session has `session: null`, zero
turns, and zero event-log entries. The screenshot shows the translate option
selected, but the export metadata is authoritative for attribution; it must
not be relabeled as a translate run.

The non-empty run is also a partial live run (8 completed source turns, not
the planned 30–40), so the numbers below are evidence from the run, not a
statistically complete benchmark.

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

### 5.1 Evidence from the received exports

| Criterion | Current (`gpt-realtime`) | `gpt-realtime-translate` |
|---|---|---|
| Export identity | **Confirmed**: `openai-realtime`, `gpt-realtime`, Marin | **Not confirmed**: export has `session: null`; no provider metadata |
| Live sample | 8 completed source turns; 10 source-transcript entries (2 marked non-meaningful) | 0 turns, 0 source entries, 0 events |
| Successful translations | 6/8; 2 completed source turns lost (`lost_translation_rate: 0.25`) | Not measurable |
| Fidelity | Several normal phrases were faithful; one feedback-suspect STT fragment was rendered as “We'll load up the tires…”, and a Chinese fragment was rendered as an unrelated English question | Not measurable; user reports no output |
| Noise / added content | Native forensic result: `noiseMicroturnsCommittedMultilingual = PROVEN`; 1 suppressed microturn and 1 feedback-suspect source turn | Not measurable |
| Cancellations | 6, all classified `UNKNOWN`; 1 occurred while playback was active | No provider session to inspect |
| Latency, speech-end → first audio | median **361 ms**, p95 **402 ms** (7 turns with latency) | Not measurable; synthetic adapter smoke was 671–751 ms, not a live result |
| Cost | Estimated **$0.0788 / active audio min**, **$0.0689 / wall-clock min** for this token-based run | Not measurable; published duration price remains **$0.034 / audio min** |
| Voice behavior | Fixed Marin voice confirmed | Dynamic adaptation not observed |
| **Verdict** | **BLOCKED** for a clean translator use case: fast, but loses 25% of completed turns and has proven noise/fragment hallucination | **BLOCKED**: no valid live output/export; requires a correctly attributed run |

The user's observation matches the current-provider evidence: it is quick,
but it can hear playback/other speech and produce a response that is not a
translation. The forensic log does not prove every such event was playback
feedback (`playbackRecapture` is `INCONCLUSIVE`), but it does prove that
noise/fragment input produced multilingual hallucinated source text and an
unrelated translation.

## 6. Verdict and recommendation

**No provider passes the live comparison yet.**

1. **Do not select `gpt-realtime` for production translation based on speed
   alone.** This run's 361 ms median is attractive, but 2/8 completed turns
   were lost, six cancellations were unexplained by the classifier, and the
   forensic analyzer marked noise-induced multilingual hallucination as
   **PROVEN**.
2. **Do not select `gpt-realtime-translate` yet.** Its export is empty and
   cannot establish either success or failure. The screenshot/export
   mismatch is itself a test-integrity failure: a fresh run must be exported
   only after the JSON's `session.provider` and `session.model` identify
   `openai-realtime-translate` / `gpt-realtime-translate`.
3. The next required comparison is one fresh, correctly attributed
   `gpt-realtime-translate` run with 30–40 utterances and the same script.
   Record whether it emits audio, source/translated transcripts, and whether
   dynamic voice adaptation is acceptable. Only then can latency
   distributions, fidelity, noise behavior, and cost be compared.

Until that run exists, the recommendation is **BLOCKED / no production
provider decision**. Structurally, translate remains the safer candidate if
it works as documented (it cannot answer conversationally and has no
server-side turn machinery), but this has not been demonstrated on the live
microphone stand.
