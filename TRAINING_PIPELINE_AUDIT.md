# TalkHint Training Call Pipeline — Technical Audit (May 2026)

Status: **current state as of commit `61d9fef`**. No changes proposed in this document — only diagnosis.

---

## 1. CURRENT TRAINING FLOW (end-to-end trace)

User flow: tap mic → speak → release → wait → tap Send → wait → GST reply + HINT appears → TTS plays.

| # | Step | File / function | Provider | Transport | Avg | Worst | Blocks UI? |
|---|---|---|---|---|---|---|---|
| 1 | Mic permission + start | `talkhint/ui/script.js::startRecording` (L2927) | Browser MediaRecorder | local | 50 ms (1st call), 0 after | 300 ms | no |
| 2 | Capture (push-to-talk hold) | MediaRecorder, `audio/webm;codecs=opus`, 32 kbps | local | local | == speech duration | — | no |
| 3 | `stop()` → assemble Blob | `mediaRecorder.onstop` (L2967) | local | local | 20–80 ms | 200 ms | yes |
| 4 | Skip if <2 KB | L2985 (added recently) | local | — | 0 | — | — |
| 5 | Blob → base64 (`FileReader`) | `blobToBase64` (L3019) | local | local | 30–150 ms | 400 ms | yes |
| 6 | `POST /training/stt` (full audio in JSON) | `sendAudioForTranscription` (L3032) | own server | REST | 100–500 ms (LAN+JSON+base64) | 1500 ms | yes |
| 7 | Server decodes base64, calls Deepgram **prerecorded** REST | `server/routes.ts::/training/stt` (L1856), `nova-3`, `language=en`, `punctuate=true` | Deepgram | REST POST | **700–1500 ms** | 3000 ms | yes |
| 8 | Transcript returned, placed into input box | L3078 — value written, system message "Tap Send to confirm" | local | local | <5 ms | — | yes (manual gate) |
| 9 | **USER MUST TAP SEND** ← biggest non-network delay | — | human | — | **1000–3000 ms** | 10 s | yes (UX gate) |
| 10 | `POST /training/turn` with `{sessionId, hon_text}` | `sendTrainingTurn` (L1993) | own server | REST | 10–40 ms net | 150 ms | yes |
| 11 | Server: push to history, update dialogState (regex slot extraction) | `server/training.ts::processTrainingTurn` (~L830) | local | local | <5 ms | — | yes |
| 12 | **GST GPT call** (sequential, must finish before HINT) | `gpt-4o-mini`, temp 0.6, max_tokens 80, `GST_FAST_PROMPT` | OpenAI Chat Completions | REST POST | **700–2000 ms** | 4000 ms | yes |
| 13 | Parse JSON `{gst_text}`, push to history, run WAIT_PATTERNS regex | L897–917 | local | — | <2 ms | — | yes |
| 14 | **Translation + HINT in `Promise.all`** | both `gpt-4o-mini`; translation 80 tok, HINT 120 tok | OpenAI ×2 parallel | REST POST | **700–1500 ms** (slower of two) | 3000 ms | yes |
| 15 | Apply WAIT_STATE override (forces "Sure, thank you.") | L1010–1026 | local | — | <1 ms | — | — |
| 16 | Anti-loop + responseType heuristics (TASK 1–6) | L1028–1067 | local | — | <2 ms | — | — |
| 17 | JSON response → UI | `addGstMessageWithTTS`, `addHintMessage` | — | — | 5–30 ms render | 100 ms | no |
| 18 | UI auto-plays GST TTS | `POST /training/tts` (L2302 → routes L1904) | server → ElevenLabs REST | REST | **500–1500 ms** generation + 100–400 ms playback start | 3000 ms | no (background) |

### Realistic end-to-end timing (one turn)

```
User stops speaking ───┐
                       │  ~250 ms       (steps 3–6, browser side)
Deepgram STT  ─────────┤  ~1000 ms      (step 7)
"Tap Send" gate ───────┤  ~1500 ms      (step 9, HUMAN)
GST GPT  ──────────────┤  ~1300 ms      (step 12)
Translate + HINT  ─────┤  ~1100 ms      (step 14)
TTS first audio  ──────┤  ~900 ms       (step 18, parallel after step 17)
                       └──────────────
                       Total perceived: ~5.1 s typical, 9–12 s worst
                       Without "Tap Send" gate: ~3.6 s typical
```

---

## 2. ALL SERVICES & MODELS IN PLAY

| Service | Where init / call | Why used | Still needed in 2026? | Modern alternative |
|---|---|---|---|---|
| **Deepgram REST `/v1/listen`** | `server/routes.ts` L1876, `model=nova-3` | English STT for training mic input | Necessary, but using wrong endpoint | **Deepgram WebSocket streaming** (`/v1/listen` WS) — partial transcripts + endpointing, cuts 800 ms |
| **OpenAI `gpt-4o-mini` ×3 per turn** | `server/training.ts` L861 (GST), L932 (translate), L951 (HINT) | Three independent reasoning tasks | Yes, but architecturally weak | **OpenAI Realtime API (gpt-4o-realtime)** — voice-in/voice-out, ~300 ms; or **Gemini 2.0 Flash voice mode** |
| **OpenAI Chat for opening hint / greeting** | `server/training.ts` L684, L754 | One-shot session init | OK, called once per session | Keep |
| **ElevenLabs TTS REST** | `server/routes.ts` L1904 → `generateTTS` in training.ts | GST + HINT speech playback | Necessary, but blocking | **ElevenLabs streaming TTS** (`stream-input` WS) — first audio in ~300 ms instead of 900 |
| **Browser MediaRecorder** | `talkhint/ui/script.js` L2958 | Push-to-talk capture | Yes | Keep, OR add **browser VAD** (`@ricky0123/vad-web`) to auto-detect end of speech |
| **WebSocket `/ui`** | `server/websocket.ts` | Used by LIVE mode for transcript broadcast | Connected during training but **carries no training data** | Reuse it to stream partial transcripts + HINT tokens |
| **Twilio Voice SDK** | `talkhint/ui/script.js` L1001 + bundle | LIVE-call only | Not used in training; fails harmlessly | Skip token fetch when `callMode=training` |
| **Web Push (VAPID)** | `service-worker.js` + `/api/push/*` | Incoming-call notifications | Yes for LIVE | Unused in training, no impact |
| **In-memory `trainingSessions` Map** | `server/training.ts` (top of file) | Session state, dialog state, anti-loop counters | OK for single-instance | If we ever scale beyond Reserved VM → Redis |
| **regex slot extractors** (`detectIntent`, `updateDialogState`) | `server/training.ts` L283–360 | Track price/types/availability/time slots | Brittle but cheap | LLM function-calling or structured output via Realtime tool calls |
| **HINT_FAST_PROMPT / GST_FAST_PROMPT** | `server/training.ts` L9, L34 | Behavior shaping | Yes | Keep, port to Realtime API system prompt |

---

## 3. LATENCY BREAKDOWN

### Per-turn (after recent optimizations: nova-3, 32 kbps opus, blob<2KB skip)

| Step | Avg ms | Worst ms | Blocking? | Notes |
|---|---|---|---|---|
| Mic capture start | 50 | 300 | yes (1st only) | getUserMedia permission |
| Blob assembly + base64 | 80 | 400 | yes | base64 inflates payload ×1.37 |
| HTTP upload to `/training/stt` | 200 | 1500 | yes | full audio in JSON body, **not streaming** |
| Deepgram nova-3 (REST) | 1000 | 3000 | yes | prerecorded = waits for full file |
| **"Tap Send" human gate** | **1500** | **10000** | **yes** | UX-imposed, not technical |
| GST GPT (gpt-4o-mini, 80 tok) | 1300 | 4000 | yes | OpenAI cold + token gen |
| Translate + HINT parallel | 1100 | 3000 | yes | slower of two |
| UI render | 20 | 100 | no | DOM insertion |
| TTS request + first audio | 900 | 3000 | no | background, blocks playback only |
| **Total perceived** | **~5100 ms** | **~12 s** | — | excluding TTS playback delay |

### Biggest bottlenecks (ranked)

1. **"Tap Send" manual confirmation** (≈1.5 s, up to 10 s) — pure UX cost, zero technical value
2. **Deepgram prerecorded** (~1 s) — replaceable with WS streaming (saves 600–900 ms)
3. **GST GPT serial before HINT** (~1.3 s) — HINT genuinely depends on GST text, but could be **speculatively pre-fetched** as soon as STT finalizes (predict 70 % of GST replies)
4. **TTS waits for full text** (~0.9 s) — ElevenLabs streaming gives first chunk in 300 ms
5. **Three separate GPT calls per turn** — one Realtime session replaces all three

### Unnecessary waits

- Audio sent only after `stop()` — could stream WS chunks during speech
- Transcript shown only when final — Deepgram WS gives partials every ~250 ms
- HINT generation starts AFTER GST returns — could start in parallel with speculative branch
- TTS request fires AFTER UI render — could fire in parallel with HINT
- Translation is 80 tokens of GPT — could be done inline by HINT call (single prompt) or via `gpt-4o-mini-translate` shortcut

---

## 4. WHY IT FEELS OUTDATED — root causes

| Symptom | Root cause in code | File:Line |
|---|---|---|
| "Long pause before hint" | Sequential STT → manual Send → GST → HINT (3 round-trips serialized) | training.ts:858–967 |
| "I have to tap Send every time" | UX gate `addSystemMessage('Tap Send to confirm...')` after STT | script.js:3080 |
| "No speech detected" | Deepgram prerecorded gives empty transcript on short/noisy clips; <2 KB filter now catches some but not all | routes.ts:1892, script.js:2985 |
| "Repeated 'Sure thank you'" (mostly fixed now) | Forced wait-state override; was firing on every turn while waiting. Now gated by `waitAckShown` | training.ts:1010–1026 |
| "Robotic GST replies" | Old `GST_FAST_PROMPT` had no instruction to offer alternatives. **Fixed in last commit** but still scripted | training.ts:9 |
| "GST ends call too fast" | HINT marked `achieved=true` on polite endings → UI says "Training ended". **Fixed in last commit** | training.ts:1062, script.js:2094 |
| "No streaming feel" | Everything is REST request/response, no WebSocket for training data path | routes.ts:1856, 1904 |
| "Repetitive hints" | Anti-loop is regex-based with reaction-only filter; works but cosmetic | websocket.ts (LIVE mode), partial port in training.ts |
| "Generic scripted hints" | `HINT_FAST_PROMPT` is general-purpose, GPT does not know caller profile / goal context deeply | training.ts:34 |
| "Token error (Training)" badge | `/api/token` is Twilio Voice token (LIVE only), called unconditionally on page load | routes.ts (api/token), script.js:1001 |

---

## 5. WHAT 2026 STACK ENABLES (vs. current)

| Capability | Current | 2026 option | Benefit |
|---|---|---|---|
| Voice-to-voice loop | STT(REST) → GPT(REST) ×3 → TTS(REST) | **OpenAI Realtime API** (`gpt-4o-realtime-preview`) — WS, audio in / audio out | 5 s → 0.4 s, natural turn-taking, interruptions |
| STT | Deepgram prerecorded REST | Deepgram WS `nova-3-general` with `endpointing=300` | 1 s → 0.2 s (partial), no manual end-of-speech |
| TTS | ElevenLabs `text-to-speech` REST | ElevenLabs **`/v1/text-to-speech/{id}/stream-input`** WS | first audio 0.9 s → 0.3 s |
| End-of-speech detection | Push-to-talk manual | **Browser VAD** (`@ricky0123/vad-web` ~1 MB wasm) or Deepgram endpointing | no button, auto-send |
| Hint generation | After GST returns | **Speculative pre-fetch**: as soon as STT final, fire HINT predicting common GST responses; pick best when GST actually returns | -800 ms perceived |
| Translation | Separate GPT call | Have HINT prompt return both; one call instead of two | -300 ms |
| State / memory | In-memory Map + history slice -6 | OpenAI Realtime API has built-in session state | cleaner |
| Interruption | Not supported | Realtime API supports user interruption mid-TTS | natural conversation |
| Multilingual mid-conversation | Fixed at session start | Realtime API handles language switching | |
| Edge inference | None | Cloudflare Workers AI / Groq for sub-100 ms GPT alternatives | optional |

### Keep
- WAIT_STATE / EXIT_WAIT pattern detection (deterministic, works)
- Anti-loop heuristics in HINT prompt
- Goal-first architecture (HON profile, slot tracking)
- Dialog state machine (price_known, types_known, etc.)
- Mode system (universal / massage / dispatcher)

### Modernize
- STT: REST → Deepgram WS
- TTS: REST → ElevenLabs streaming WS
- Three GPT calls → one Realtime API session (eventually)
- Manual "Tap Send" → VAD auto-send
- HINT generation: serial → speculative

### Remove
- "Tap Send to confirm" gate (script.js:3080)
- base64 audio in JSON body — use binary multipart or WS frames
- Separate translation GPT call (merge into HINT)
- `/api/token` fetch when `callMode=training` (script.js:1001)
- WAIT_PATTERNS over-matching when Goal already includes pivot logic (now safer post-fix)

---

## 6. CODE MAP — files involved in training mode

### Frontend
| File | Lines | Role |
|---|---|---|
| `talkhint/ui/script.js` | 1993–2095 | `sendTrainingTurn`, `stopTrainingSession` |
| `talkhint/ui/script.js` | 2281–2370 | TTS playback (`/training/tts` request, autoplay) |
| `talkhint/ui/script.js` | 2927–3007 | Mic capture (`startRecording`, MediaRecorder) |
| `talkhint/ui/script.js` | 3009–3017 | `stopRecording` |
| `talkhint/ui/script.js` | 3032–3086 | `sendAudioForTranscription` (STT call) |
| `talkhint/ui/script.js` | 2210–2280 | `addHintMessage`, `addGstMessageWithTTS` |
| `talkhint/ui/script.js` | 1255–1275 | WS message handlers (`goal_state_update`, `goal_achieved`) |
| `talkhint/ui/index.html` | — | Standalone UI shell |

### Backend
| File | Lines | Role |
|---|---|---|
| `server/routes.ts` | 1781–1853 | Training endpoints (start/turn/reset) wiring |
| `server/routes.ts` | 1855–1901 | `/training/stt` — Deepgram REST |
| `server/routes.ts` | 1903–1933 | `/training/tts` — ElevenLabs |
| `server/training.ts` | 9–30 | `GST_FAST_PROMPT` |
| `server/training.ts` | 34–119 | `HINT_FAST_PROMPT` |
| `server/training.ts` | 121–122 | `WAIT_PATTERNS`, `EXIT_WAIT_PATTERNS` |
| `server/training.ts` | 124–280 | `DialogState`, `TrainingSession` types |
| `server/training.ts` | 283–360 | `detectIntent`, `updateDialogState` (regex slots) |
| `server/training.ts` | 470–620 | `GST_SYSTEM_PROMPT_TEMPLATE`, `HINT_SYSTEM_PROMPT_TEMPLATE` (long-form, unused in FAST path) |
| `server/training.ts` | 636–800 | `startTrainingSession`, `generateInitialHint`, `generateInitialGstGreeting` |
| `server/training.ts` | 815–1095 | `processTrainingTurn` (the hot path — STT not here, just GST+translate+HINT) |
| `server/training.ts` | 1098–1130 | `resetTrainingSession` |
| `server/training.ts` | 1132–1205 | `generateTTS` (ElevenLabs) |
| `server/websocket.ts` | — | LIVE mode WS (not used by training currently, but `/ui` channel could carry training events) |
| `shared/prompts.ts` | — | LIVE mode prompts; training has its own in training.ts |

### State
- `trainingSessions: Map<string, TrainingSession>` — in-memory only (training.ts top)
- `session.dialogState` — slots, waitingForInfo, intent history, finishReason

---

## 7. QUICK WINS (prioritized)

### A. Same-day fixes (1–4 hours each)

1. **Remove "Tap Send" gate** — auto-send transcribed text immediately if length >2 chars.
   - File: `talkhint/ui/script.js` L3078–3080
   - Saves 1–3 s per turn, biggest single UX win
   - Risk: low; user already saw transcript in chat history
2. **Skip Twilio token fetch in training mode** — kills "Token error" badge.
   - File: `talkhint/ui/script.js` L1001
   - Wrap in `if (callMode !== 'training')`
3. **Merge translation into HINT GPT call** — request `gst_translation` field in HINT JSON.
   - File: `server/training.ts` L932–967
   - Saves 1 GPT round-trip (≈300 ms typical)
4. **Fire TTS request in parallel with HINT** instead of after.
   - File: `talkhint/ui/script.js` L2028 + server response path
   - Saves 200–400 ms before TTS audible
5. **Show "transcribing…" + "thinking…" placeholders** instead of blank pauses.
   - Files: script.js mic handler + sendTrainingTurn
   - No latency saved, but perceived speed +30 %

### B. Week-scope (1–5 days each)

6. **Deepgram WebSocket streaming STT** with `endpointing=300`, partial transcripts to UI as they arrive.
   - Cuts STT latency 1 s → 0.2 s; removes "no speech detected" misses
   - Replace `/training/stt` REST with WS proxy through `/ui` channel
7. **Browser VAD** (`@ricky0123/vad-web`) — no push-to-talk, auto-detects end of speech, auto-sends.
   - Combines with Deepgram WS for full hands-free
8. **ElevenLabs streaming TTS** (`stream-input` WS) — first audio chunk in 300 ms.
   - Replace `generateTTS` in training.ts
9. **Speculative HINT pre-fetch** — when STT finalizes, fire HINT call against predicted GST reply ("most common acknowledgment + question"); discard if real GST differs significantly.
   - Trickier, ~2-day dev
10. **Stream UI updates via WebSocket** instead of per-turn REST — partial transcript + partial hint tokens render as they arrive.

### C. Architecture upgrades (2–6 weeks)

11. **Migrate to OpenAI Realtime API (`gpt-4o-realtime-preview`)** for GST + HINT in a single WS session.
    - Voice-in (mic audio) / voice-out (GST TTS) end-to-end ~400 ms
    - HINT runs as a separate Realtime tool call or side-channel function
    - Removes Deepgram + ElevenLabs for GST path (keep them only for HINT TTS / fallback)
    - 5 s → <1 s per turn perceived
12. **Hybrid: Realtime API for GST voice, separate text HINT side-channel** — best of both; keeps HINT logic in our control.
13. **Session memory in Redis** if/when scaling beyond single Reserved VM.
14. **Replace regex slot extractors with function-calling** in HINT GPT — cleaner state, harder to break.
15. **Per-mode (massage/recruiter/dispatcher) prompt + few-shot library** — reduces "generic hint" feel.

---

## 8. RECOMMENDED ROADMAP

| Week | Tasks | Outcome |
|---|---|---|
| 1 | Quick wins A1, A2, A3, A4, A5 | Turn latency 5 s → 3.5 s; UI feels responsive |
| 2 | B6 (Deepgram WS), B7 (VAD) | Hands-free; STT vanishes from latency |
| 3 | B8 (ElevenLabs streaming), B10 (WS UI) | First audio in 300 ms |
| 4–5 | B9 (speculative HINT) | Turn latency 3.5 s → 1.8 s |
| 6+ | C11 (Realtime API) | Turn latency 1.8 s → 0.6 s, true conversation feel |

Stop point if budget-constrained: **end of Week 3** — that already moves us from "slow chat" to "fast push-to-talk", which is what most production voice-copilots ship today.

---

## 9. TL;DR

TalkHint Training today is a **request/response chat with voice glue**: Deepgram-prerecorded → 3× GPT REST → ElevenLabs-REST, with a manual "Tap Send" gate that alone costs 1.5–3 s per turn. The code is healthy and modular; the architecture is from 2024.

**Three changes account for ~80 % of the perceived improvement**:
1. Remove the Tap-Send gate (free)
2. Deepgram WebSocket streaming with VAD (1 week)
3. ElevenLabs streaming TTS (2 days)

Everything beyond that is an architectural upgrade to OpenAI Realtime API, which is a separate project worth scoping after the quick wins land.
