# ElevenLabs + TalkHint Engine: Dev latency experiments

Only `/admin/secretary-lab?stand=eleven-engine` consumes these profiles.
GPT, Retell managed and Retell + Engine retain their previous settings.
No telephone integration, working calendar or notification tools are involved.

## Preserved baseline and isolated profiles

All profiles use Sarah (`EXAVITQu4vr4xnSDxMaL`), Scribe Realtime,
the same `gpt-6.1-sol` TalkHint Engine and TEST tools. Native ElevenLabs
LLM fallback is disabled. Speculative turns and soft-timeout filler remain off.
Model output limit remains 1600 tokens. Baseline is still the default.

| Profile | TTS | Primary language | Reasoning | Turn | Extra reply constraint | Checkpoint before model |
|---|---|---|---|---|---|---|
| baseline | eleven_multilingual_v2 | en | medium | normal | Existing common prompt | Every round |
| flash | eleven_flash_v2_5 | ru | medium | normal | Existing common prompt | Every round |
| eager | eleven_multilingual_v2 | en | medium | eager | Existing common prompt | Every round |
| low | eleven_multilingual_v2 | en | low | normal | Existing common prompt | Every round |
| brief | eleven_multilingual_v2 | en | medium | normal | 1–2 sentences, preserving required checks | Every round |
| optimized | eleven_flash_v2_5 | ru | medium | normal | Existing common prompt | If action ledger changed |

The optimized profile is **pending human iPhone listening**, not a default or
proof of better conversation quality. Eager is deliberately not included:
the synthetic number/address fixture triggered generation before input ended.
Low and the extra brief-answer constraint remain separate experiments: the
small same-text sample did not establish a useful first-text gain. The earlier
combined candidate remains archived with its actual low/brief configuration;
historical snapshots are not rewritten to match current profile definitions.

### Flash limitation

Actual agent creation rejected Flash v2.5 with primary language EN:
“English Agents must use turbo or flash v2.” The RU-primary configuration
was accepted. We did not silently substitute Flash v2. Thus Flash comparisons
also vary the provider's primary-language setting. Language following remains
in TalkHint's prompt; recognition and pronunciation require actual language tests.

## Timing interpretation

Each HTTP generation gets a response ID and a timing row. Server timestamps are
milliseconds since session creation:

- physical speech-end and provider EOT: **null**, not exposed by this interface;
- final transcript receipt: receipt time of the provider event, **not** ASR
  processing completion time;
- Engine request receipt and first non-whitespace text forwarded over SSE;
- first provider audio frame received for the current uncancelled generation;
- checkpoint durations, skipped unchanged checkpoints and cancellation;
- browser SDK playback telemetry: a **separate client clock**, never subtracted
  from server timestamps.

Provider audio association is sequential/best-effort, not an exact provider
turn-ID guarantee. Playback telemetry is not acoustic audibility. Provider
region and network-only latency are not isolated.

The adapter forwards text immediately; an automated regression test verifies
that the first fragment is written before the model completes. Eleven Agents
can still buffer text before synthesizing speech. Direct TTS WebSocket
parameters are not applied to this interface. No Realtime model is used.

## Safe checkpoint optimization

The optimized profile skips a blocking pre-model checkpoint only when the same
action ledger is already acknowledged by the common comparison repository.
A new TEST action must be checkpointed before the follow-up model may announce
success. Failure stops the session. Cancellation never rolls back an already
committed action or replays it. Exact-request replay and action argument
deduplication remain in force.

Configuration, timing rows, TEST ledger, transcript and manual evaluation are
saved in the existing comparison store, under the session/request ID. No
parallel report table or permanent audio archive was created. Existing retention
and administrator access apply. ElevenLabs has a separate **Скачать JSON**
button for the selected report.

## Reproducible provider probes

`scripts/probe-eleven-latency.ts --run` is explicitly opt-in and consumes provider
API usage. It requires `NODE_ENV=development`, the existing opted-in lab owner,
and free Dev port 5000 for the real public Custom LLM callback.
Stop **only** the Dev workflow, run the probe, then restore that workflow.
Never run on a deployment. Never enable webhook repointing.

The probe uses actual provider synthesis, text input, paced synthetic PCM
speech, shared DB checkpoints, TEST save/replay and a new process to read each
saved result. Fixtures and summaries are gitignored in
`generated-artifacts/eleven-latency/`; canonical reports remain in the common DB.
Failures are not discarded. An unsuccessful run exits nonzero.

It does not open a microphone, play audio, place calls or assign subjective
ratings. A synthetic source's last chunk is **not** physical speech-end.
SDK raw control messages and audio output listeners are subscribed separately.
Large valid PCM replies exposed the old 256KiB upstream frame cap; the Eleven
adapter now admits bounded frames up to 1MiB.

### Required human comparison

Use baseline and each isolated experiment before the combination:

1. RU, EN, ES and language changes with the same assignment.
2. Interrupt near beginning, middle and end; verify the old answer does not resume.
3. Pause and hesitate inside phone numbers/addresses, then correct a detail.
4. Save an explicitly approved TEST message with name, place and time. Reopen
   its ID and retry; verify one action and no real delivery/calendar entry.
5. Stop while starting and while speaking. Confirm the iPhone microphone
   indicator disappears, then switch profiles and restart.
6. Record first-word wait, intelligibility and naturalness separately. Only
   the listener supplies subjective ratings.

## Official references (checked 2026-10-24)

- [Custom LLM](https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm)
  — SSE and prohibition on combining Custom LLM with a Realtime model.
- [Conversation flow](https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow)
  — eager/normal/patient; provider text buffering; silence timeout is not the
  ordinary end-of-speech delay.
- [Languages](https://elevenlabs.io/docs/eleven-agents/customization/voice/customization/language)
  — English v2 vs additional-language v2.5 behavior.

## Observed provider measurements, 2026-10-24

Three identical text inputs (EN, RU, ES) per profile, actual Custom LLM callback
and provider audio. These isolate neither ASR nor physical playback and are too
small/nonrandomized to establish a stable speed guarantee.

| Median, milliseconds | baseline | final optimized |
|---|---:|---:|
| Request received → useful text | 1158 | 1019 |
| Useful text → provider audio frame | 564 | 290 |
| Request received → provider audio frame | 1790 | 1309 |

Canonical shared report IDs:

- baseline: `662dc458-22b9-4d4d-881b-1ba548e4cfcd`
- Flash alone: `9e7e223c-bb44-46bd-a113-9e058a1942c1`
- Eager: `b0b502ce-8211-442e-9e70-e649a9405255`
- Low alone: `207f0843-620e-4608-b809-7553f27c0c31`
- Brief alone: `960a7c56-32db-422f-a925-a2f88f157957`
- final optimized (medium, no extra brief rule):
  `8c9b5915-f6b6-4bab-b0d6-76135b9026c4`

The Low-only first-text mean was 1119ms vs baseline 1123ms; the brief-only mean
was 1208ms. Neither establishes useful first-word acceleration. Both remain
isolated, opt-in profiles rather than global changes.

All seven successful reports, including an earlier low/brief combined candidate,
saved one TEST action and reread it from a fresh process after a repeat request.
The number/address fixture caused Eager to request generation before input
finished. Baseline and final optimized also showed an early-generation event in
the two-sentence Spanish fixture. This is a turn-taking warning, not proof of
audible cutoff; human conversation quality and microphone release on iPhone
remain unverified. Synthetic fixture observations are attached to the same
shared report records.
