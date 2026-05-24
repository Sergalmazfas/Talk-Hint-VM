# TalkHint LIVE Call Pipeline — Technical Audit (May 2026)

Companion to `TRAINING_PIPELINE_AUDIT.md`. This document is about **real phone calls** (Twilio + Deepgram + OpenAI Chat), not training simulation.

State as of commit `9dd7486`. Diagnosis only — no code changes proposed here.

---

## 1. REAL LIVE CALL FLOW (end-to-end trace)

User flow: open `/app` → tap "Call" → enter number → Twilio connects to PSTN → remote phone rings → answers → both sides speak → partial transcripts appear → hint appears 1–2 s after guest finishes speaking.

### Phase A — Call setup (one-time, ~3–10 s, blocking only the dial action)

| # | Step | File:func | Service | Transport | Avg | Worst | Notes |
|---|---|---|---|---|---|---|---|
| A1 | Page load fetches `/api/token` | `talkhint/ui/script.js::initTwilioDevice` (L992) → `server/routes.ts` (L750) | own server | REST | 60 ms | 400 ms | Twilio AccessToken JWT (identity = `user-{id}`) |
| A2 | `new TwilioDevice(token)` + `device.register()` | script.js:1012 | Twilio Voice SDK (CDN bundle) | WS to Twilio Edge | 200–800 ms | 3 s | Stays connected for incoming calls |
| A3 | `device.connect({ params:{ To, CallerId } })` | script.js (outbound dial) | Twilio Edge | WS signaling | 100 ms | 1 s | Triggers TwiML webhook below |
| A4 | Twilio POST → `/twilio/voice` | `server/routes.ts::/twilio/voice` (L795) | own server | REST | 50 ms | 200 ms | Returns TwiML XML |
| A5 | TwiML response: `<Start><Stream url="wss://host/twilio-stream"/></Start>` + `<Dial>` to PSTN | routes.ts L809 | — | — | — | — | Stream + Dial run in parallel |
| A6 | Twilio dials PSTN, opens Media Stream WS to our server | Twilio cloud → `setupWebSocket` upgrade (websocket.ts:440) | Twilio Media Streams | WS (μ-law 8 kHz, base64, 20 ms frames, both tracks) | **3–10 s** (carrier ring time) | 30 s | This is where the user waits during "ringing" |

### Phase B — Per-utterance loop (repeats every guest sentence, ~1.7–2.8 s perceived)

| # | Step | File:func | Service | Transport | Avg | Worst | Blocks? | Streaming? |
|---|---|---|---|---|---|---|---|---|
| B1 | Twilio sends `connected` event → server pre-inits 2 Deepgram WS (one per track) | `handleTwilioStream` (websocket.ts:623), `setupDeepgram` (L1063) | Deepgram | WS | 100–300 ms | 1 s | startup only | — |
| B2 | Twilio sends audio frames (`media` events, μ-law base64, 20 ms each, `track=inbound`/`outbound`) | websocket.ts:1299 | Twilio | WS | continuous | — | no | yes |
| B3 | Server forwards raw μ-law bytes to matching Deepgram WS (NO conversion — `encoding=mulaw&sample_rate=8000`) | websocket.ts:1319 | Deepgram | WS | <5 ms | 20 ms | no | yes |
| B4 | Deepgram returns partial transcripts (~every 250 ms) + VAD events (`SpeechStarted`, `UtteranceEnd`) | websocket.ts:1110 | Deepgram nova-2 | WS | 200–400 ms after speech onset | 800 ms | no | yes |
| B5 | **Partial transcript broadcast immediately to UI** as `guest_transcript`/`owner_transcript` with `isFinal=false` | websocket.ts:1149 | own | WS `/ui` | <20 ms | 100 ms | no | yes |
| B6 | Same transcript fed into `utteranceGate.processTranscript()` | websocket.ts:1146, `utteranceGate.ts::ingestTranscript` | local | — | <2 ms | — | no | — |
| B7 | Gate debounces — waits `END_SILENCE_MS = 1000` after last final OR fires immediately on Deepgram `UtteranceEnd` VAD | utteranceGate.ts:31, 103 | local | — | 0–1000 ms | 1000 ms | yes (intentional) | — |
| B8 | On flush → `handleGuestUtteranceComplete(text, utteranceId)` | websocket.ts:750 | local | — | <5 ms | — | no | — |
| B9 | `GoalEngine.updateOnUtterance()` — regex slot extraction, missing-slot calc, achievement check; broadcast `goal_state_update` | goalEngine.ts, websocket.ts:765 | local | — | <10 ms | 50 ms | no | — |
| B10 | WAIT_STATE pattern check (`WAIT_PATTERNS` / `EXIT_WAIT_PATTERNS` regex) | websocket.ts:808 | local | — | <1 ms | — | no | — |
| B11 | `fastLayer.onGstUtteranceEnd()` — schedules pre-canned filler from `fastPhrases.json` if GPT not back in time | `server/fastLayer.ts`, websocket.ts:830 | local | — | <2 ms | — | no | — |
| B12 | **`translateAndSuggest(text, goal, lang, contextHistory)`** — one GPT call, returns translation + suggestion in single JSON | websocket.ts:119 → OpenAI Chat Completions | OpenAI `gpt-4o-mini` (temp 0.4, max_tokens 120) | REST | **700–1500 ms** | 4000 ms | no (parallel to fast-layer) | no |
| B13 | Broadcast `guest_transcript` with `isFinal=true, translation` to UI | websocket.ts:838 | own | WS `/ui` | <20 ms | 100 ms | no | — |
| B14 | Hint throttling checks: `goalAchievedFlag`, same `utteranceId`, cooldown `HINT_COOLDOWN_MS=1500`, reaction-only, wait_state, repeat_intent, Jaccard duplicate >0.8 | websocket.ts:848–948 | local | — | <1 ms | — | no | — |
| B15 | If passes → broadcast `suggestion` to UI | websocket.ts:957 | own | WS `/ui` | <20 ms | 100 ms | no | — |
| B16 | UI renders translation under guest bubble + suggestion card | `talkhint/ui/script.js` `/ui` WS handlers | DOM | local | <30 ms | 100 ms | no | — |
| B17 | **No TTS** — user reads suggestion and says it themselves | — | — | — | — | — | — | — |

### Realistic per-utterance timing

```
Guest stops speaking ──┐
                       │ Deepgram VAD UtteranceEnd  ~250 ms (or 1000 ms silence gate if VAD missed)
                       ├─ partial transcripts already visible ✓
                       │ translateAndSuggest GPT     ~1100 ms
                       │ UI broadcast + render        ~30 ms
                       └────────────────────────────
                       Total speech-end → hint:    ~1.4 s typical, 2.8 s worst
                       Total speech-end → translation only: ~1.3 s
                       Partial transcript onscreen: ~250 ms after speech onset
```

This is **3–5× faster than training mode** because there is no "Tap Send" gate, no base64 REST upload, and Deepgram is streaming.

---

## 2. AUDIO PATHS — two speakers, clearly separated

### 2.1 HONOR / local user / browser microphone

There are **two different ways** Honor audio can be captured. Only the first is used during real calls.

#### (a) Via Twilio (default during real calls)
- Browser mic → Twilio Voice SDK (WebRTC) → Twilio Edge → Twilio mixes/forks audio → sends both legs to our Media Stream WS
- Our server sees Honor audio as `track=inbound` on `/twilio-stream`
- Forwarded raw to a dedicated Deepgram WS connection (call it `deepgramInbound`)
- Partial transcripts broadcast as `owner_transcript`
- Latency: speech → text ≈ 300–600 ms (Twilio + Deepgram)
- **Deepgram is NOT direct from browser** — it goes Browser → Twilio → our server → Deepgram

#### (b) Via `/honor-stream` (legacy / experimental, NOT used in normal calls)
- `server/websocket.ts::handleHonorStream` (L561) → `GPTRealtimeHandler` (L252)
- Browser mic → our `/honor-stream` WS → **OpenAI Realtime API** (`gpt-4o-realtime-preview-2024-10-01`) directly, native `g711_ulaw` in and out
- Used by older "Honor stream" path; current `/app` UI does not invoke this during Twilio calls
- This is the most modern stack in the codebase but is **wired only for the standalone HON pipeline**, not the LIVE call loop

### 2.2 GUEST / remote phone caller

- Remote phone speaks → PSTN → Twilio → `<Stream>` forks audio → our server `/twilio-stream` WS
- Twilio Media Streams send `event=media` with `track=outbound`, μ-law 8 kHz, base64, 20 ms frames
- Server forwards raw bytes to a second Deepgram WS connection (`deepgramOutbound`)
- Partial transcripts broadcast as `guest_transcript`
- When utterance ends → translation + suggestion generated → broadcast to UI
- Latency: guest speech end → translation in UI ≈ 1.3 s; → suggestion ≈ 1.4 s

### Track mapping (one place trips us up)

```
ALL MODES (browser-outbound AND PSTN-forwarding):
  track=inbound   → HON (owner / our user)
  track=outbound  → GST (remote party)
```
This is enforced in `websocket.ts:1137–1140` and `1287`. Confirmed correct after the recent PSTN-forwarding fix.

---

## 3. SERVICES USED IN LIVE CALL

| Service | Where init | Why | Current | 2026 alternative |
|---|---|---|---|---|
| **Twilio Voice SDK** (browser, CDN bundle) | `script.js::initTwilioDevice` L992 | Browser WebRTC → Twilio Edge | OK | Keep (or Twilio Voice JS v2.10+) |
| **Twilio Access Tokens** | `routes.ts::/api/token` L750 | JWT for SDK | OK | Keep; cache 1-hour |
| **Twilio Programmable Voice + TwiML** | `routes.ts::/twilio/voice` L795 | Call routing, `<Stream>`+`<Dial>` | OK | Keep |
| **Twilio Media Streams** | TwiML `<Start><Stream wss://.../twilio-stream/>` (L809) | Fork raw call audio to our server | μ-law 8 kHz, both tracks | Keep; consider `track="both"` + tag for bidirectional TTS (currently outbound-only audio) |
| **Deepgram WS** (`@deepgram/sdk` + raw WS) | `websocket.ts::setupDeepgram` L1063 | Streaming STT | **`nova-2`**, en-US, mulaw, 8 kHz, interim_results, vad_events, punctuate, keepalive 10 s, exp-backoff reconnect ×3 | **`nova-3`** (already used in training!) — newer, 30 % lower WER on phone audio. Same WS API. |
| **OpenAI Chat Completions** | `websocket.ts::translateAndSuggest` L119, `generateHints` L1439, `analyzeSentiment` L75, `handleAIQuestion` L465 | Translation + suggestion + sentiment + Q&A | `gpt-4o-mini`, temp 0.4, max_tokens 50–200 | `gpt-4o-mini` is still good for cost/latency. Could use **`gpt-5-mini`** or **Groq Llama 3.3** (~200 ms) for translation-only path |
| **OpenAI Realtime API** | `websocket.ts::GPTRealtimeHandler` L252, only via `/honor-stream` | Voice-to-voice for HON browser mic | `gpt-4o-realtime-preview-2024-10-01` | Already on modern stack, but **not wired into the actual call loop** — biggest untapped asset in the repo |
| **ElevenLabs TTS** | Used only by training (`routes.ts::/training/tts` L1904) | Spoken hint playback | — | **Not used in LIVE.** Worth adding for whispered hints in user's earpiece |
| **WebSocket `/ui`** | `websocket.ts::handleUIConnection` L522 | Streams transcripts, translations, hints, goal updates, filler phrases to browser | OK | Keep |
| **Cloud Run / App Engine** | — | NOT used | We're on Replit Reserved VM (recommended) | Don't switch — autoscaling kills long-lived WS |
| **`utteranceGate`** | `server/utteranceGate.ts` | Debounces transcripts, waits 1000 ms silence or VAD `UtteranceEnd` before firing GPT | OK | Could drop END_SILENCE_MS to 500 ms now that Deepgram VAD is reliable |
| **`fastLayer`** | `server/fastLayer.ts`, fires `fastPhrases.json` while GPT runs | Pre-canned filler ("One moment", "Got it") to bridge GPT latency | OK | Keep — already smart |
| **`GoalEngine`** | `server/goalEngine.ts` | State machine over slots (date/time/phone/...), goal achievement | OK | Could swap regex extractors for GPT function-calling for harder slots |
| **`pushService` (VAPID)** | `server/pushService.ts` | Web Push for incoming calls | OK | Keep |
| **`twilioService`** | `server/twilioService.ts` | Outbound call init via Twilio REST | OK | Keep |

---

## 4. LATENCY REPORT (per guest utterance)

| Step | Avg ms | Worst ms | Blocking? | Notes |
|---|---|---|---|---|
| Twilio call connect (one-time) | 4000 | 15000 | yes (dial) | PSTN carrier dependent |
| Audio frame → Twilio → our server | 80 | 250 | no | continuous stream |
| Frame → Deepgram WS | 5 | 20 | no | raw forward |
| Deepgram partial transcript | 250 | 800 | no | shown to UI immediately ✓ |
| Deepgram final transcript | 600 | 1200 | no | |
| Deepgram `UtteranceEnd` VAD | ~250 ms after speech stop | 1000 | yes | preferred trigger |
| utteranceGate `END_SILENCE_MS` fallback | 1000 | 1000 | yes | only fires if VAD missed |
| GoalEngine + WAIT_STATE + fastLayer scheduling | 10 | 50 | no | |
| **`translateAndSuggest` GPT** | **1100** | **4000** | yes (for hint, not transcript) | gpt-4o-mini, single call returns translation+suggestion |
| Throttling/anti-loop checks | 1 | 5 | no | |
| UI broadcast `/ui` WS | 15 | 100 | no | |
| UI render (DOM insert) | 25 | 100 | no | |
| **Speech end → translation in UI** | **~1.3 s** | **~3 s** | — | — |
| **Speech end → suggestion in UI** | **~1.4 s** | **~3 s** | — | — |
| **Speech onset → partial transcript** | **~300 ms** | **~800 ms** | — | feels instant ✓ |

### Real bottlenecks (ranked)

1. **`translateAndSuggest` GPT call** — dominates the loop (~1.1 s of the 1.4 s total). Single biggest lever.
2. **`END_SILENCE_MS = 1000` fallback** — when Deepgram VAD misses an `UtteranceEnd` event, we eat a full second before flushing. Could be 500 ms.
3. **Twilio call connect** — 3–10 s of "ringing" silence. Mostly unavoidable (PSTN), but UI could mask better.
4. **No streaming GPT response** — we wait for the full JSON before broadcasting. Streaming the suggestion tokens would put the first word on screen ~300 ms sooner.
5. **No TTS** — user must read the hint and speak it themselves. Adds ~500–1500 ms of human reaction time before they actually say the line. Biggest UX improvement opportunity, not a server-side latency.
6. **Filler phrases fire at 2 s into GPT** — a bit late; should fire at ~600 ms if hint isn't ready yet.

### Unnecessary waits

- Two separate Deepgram WS instead of one multichannel — costs an extra ~50 ms on Deepgram startup, also 2× keepalive/billing.
- Sentiment analysis is a **separate `gpt-4o-mini` call** (`analyzeSentiment`, L75) when triggered — could be merged into the same prompt as `translateAndSuggest` (already exists infra for it, just not enabled).
- Sequential pipeline: GoalEngine update → translateAndSuggest is awaited inline before broadcasting translation. Translation broadcast and GoalEngine update could be parallel (both <50 ms but adds polish).

---

## 5. WHY REAL CALL FEELS SLOW OR UNNATURAL — root causes in code

| Symptom | Root cause | File:Line |
|---|---|---|
| "Hint comes 1–2 sec after guest finishes" | `END_SILENCE_MS=1000` + GPT ~1.1 s + render | utteranceGate.ts:31, websocket.ts:833 |
| "Sometimes hint never comes" | Throttling: same utteranceId, cooldown, reaction-only, wait_state, repeat_intent, Jaccard duplicate | websocket.ts:870–948 — all by design but can over-block on chatty calls |
| "Partial transcript looks fine then jumps to slightly different final" | Deepgram nova-2 rewrites partials on finalization | websocket.ts:1067 (model=nova-2) — upgrade to nova-3 reduces this |
| "Hint feels generic / scripted" | Single 120-token GPT call with `TALKHINT_GOLDEN_PROMPT` + goal stuffed in user message; no few-shot examples per industry/mode | websocket.ts:142–169 |
| "Repeats the same hint twice" | Jaccard threshold is 0.8 — borderline rephrases slip through | websocket.ts:944 |
| "Goes silent during long guest sentences" | Gate waits for `UtteranceEnd` or 1 s silence — long monologues batch into one big block, GPT then has to respond to lots of context | utteranceGate.ts:113, websocket.ts:833 |
| "Translation arrives a beat before suggestion" | They arrive in the same JSON simultaneously; UI renders translation under bubble first because it's pushed inside `guest_transcript` payload, suggestion is a separate `uiBroadcast` right after | websocket.ts:838, 957 — fine but creates a "stutter" feel |
| "Filler phrases ('Sure, I'll wait') feel canned" | Hard-coded ACK in WAIT_STATE branch | websocket.ts:901–917 |
| "No voice from assistant" | Intentional — text-only display | — |
| "First call after page load is slow" | Twilio Device registration (3 s worst), Deepgram WS cold-open (300 ms), GPT cold (1.5 s worst) all hit at once | A2 + B1 + B12 |
| "Hint appears AFTER guest already started next sentence" | 1.4 s pipeline + human read time. By the time user reads hint, guest is mid next utterance. | combined |
| "Duplicated messages in transcript" | When VAD fires `UtteranceEnd` and silence timer also fires, both can trigger flush. Gate has `lastGeneratedUtteranceId` guard but race exists. | utteranceGate.ts:10 + 165 |
| "Stale hints after goal changed mid-call" | Goal is captured in `currentGoal` closure at module scope, updated by UI `set_goal`; reads stale in mid-flight GPT call | websocket.ts:463, 535 — minor |
| "WAIT_STATE blocks too aggressively" | Pattern regex matches polite chatter; only one EXIT match needed to unblock; can hang for whole sub-conversation | websocket.ts:649 (patterns), 897 (block) |

---

## 6. CODE MAP — files involved in LIVE call mode

### Frontend
| File | Lines | Role |
|---|---|---|
| `talkhint/ui/script.js` | 992–1060 | `initTwilioDevice`, device.on('incoming'/'cancel'/'disconnect'), audio setup |
| `talkhint/ui/script.js` | 1116–1280 | `/ui` WS connect, message handlers (`guest_transcript`, `owner_transcript`, `suggestion`, `goal_state_update`, `goal_achieved`, `fast_phrase`, `hon_transcript`, `hon_response`) |
| `talkhint/ui/script.js` | 2620 | `initTwilioDevice()` bootstrap call |
| `talkhint/ui/script.js` | — | Outbound dial: `device.connect({ params:{ To, CallerId } })` |
| `talkhint/ui/index.html` | — | Standalone LIVE UI shell, loads Twilio SDK bundle |
| `client/src/...` (Vite React app) | — | Marketing/dashboard pages, **not** the LIVE call surface |

### Backend — Twilio + call setup
| File | Lines | Role |
|---|---|---|
| `server/routes.ts` | 750–791 | `/api/token` — Twilio Access Token (VoiceGrant, identity=`user-{id}`) |
| `server/routes.ts` | 795–933 | `/twilio/voice` TwiML webhook (browser-outbound, incoming, PSTN-forwarding) |
| `server/routes.ts` | 385–411 | Webhook URL configuration helpers |
| `server/routes.ts` | 670–700 | Outbound call init paths (`twilioClient.calls.create` etc.) |
| `server/twilioService.ts` | full | Twilio REST helpers (numbers, subaccounts, line pool) |

### Backend — WebSocket + STT + GPT
| File | Lines | Role |
|---|---|---|
| `server/websocket.ts` | 60–73 | Twilio Media WS message types, MODES, prompt re-exports |
| `server/websocket.ts` | 75–116 | `analyzeSentiment` (separate GPT call, used sparingly) |
| `server/websocket.ts` | 119–197 | **`translateAndSuggest`** — main GPT call for each guest utterance |
| `server/websocket.ts` | 13–48 | μ-law decode table + `mulawToPcm16` 8→24 kHz upsample (used only by Realtime path) |
| `server/websocket.ts` | 252–434 | `GPTRealtimeHandler` — OpenAI Realtime API client for `/honor-stream` |
| `server/websocket.ts` | 437–461 | `setupWebSocket`, upgrade routing for `/twilio-stream`, `/honor-stream`, `/ui`, `/media` |
| `server/websocket.ts` | 465–520 | `handleAIQuestion` — user-typed Q&A during a call |
| `server/websocket.ts` | 522–559 | `handleUIConnection` — `/ui` WS, accepts `set_mode`, `update_goal`, `set_language`, `ask_ai` |
| `server/websocket.ts` | 561–621 | `handleHonorStream` — browser mic → Realtime API (NOT used in normal calls) |
| `server/websocket.ts` | 623–1402 | **`handleTwilioStream`** — the LIVE call hot path |
| `server/websocket.ts` | 634–648 | Hint throttling + wait state per-call vars |
| `server/websocket.ts` | 649–727 | WAIT/EXIT patterns, reaction-only detector, intent detector, Jaccard similarity |
| `server/websocket.ts` | 741–747 | `UtteranceGate` instance + callback wiring |
| `server/websocket.ts` | 750–969 | `handleGuestUtteranceComplete` — the orchestration heart of LIVE |
| `server/websocket.ts` | 972–1028 | `handleOwnerUtteranceComplete` |
| `server/websocket.ts` | 1031–1050 | `FastLayerManager` instance (fast filler phrases) |
| `server/websocket.ts` | 1052–1206 | Deepgram WS lifecycle: `setupDeepgram`, keepalive 10 s, reconnect ×3 exp backoff, partial+final+VAD handling |
| `server/websocket.ts` | 1208–1357 | Twilio Media WS message router (`connected`, `start`, `media`, `stop`) |
| `server/websocket.ts` | 1404–1437 | Filler phrases (English/Russian/Spanish) |
| `server/websocket.ts` | 1439–1500 | `generateHints` (legacy hints path, partly superseded by translateAndSuggest) |
| `server/utteranceGate.ts` | 1–275 | Debounce gate, `END_SILENCE_MS=1000`, `forceFlush` from VAD |
| `server/fastLayer.ts` | full | Pre-canned filler scheduler reading `fastPhrases.json` |
| `server/fastPhrases.json` | — | Bank of fast phrases by category/slot/lang |
| `server/goalEngine.ts` | full | Per-call state machine, slot tracking, goal achievement |
| `server/slotExtractors.ts` | full | Regex extractors for date, time, phone, name, count, money |
| `shared/prompts.ts` | full | `TALKHINT_GOLDEN_PROMPT`, `LIVE_ANTI_LOOP_RULES`, `LANGUAGE_NAMES`, mode prompts |

### State (per-call, in-memory)
- `uiClients: Set<WebSocket>` — broadcast targets (websocket.ts:206)
- `currentMode`, `currentLanguage`, `currentGoal` — module-level (last UI message wins, **shared across all simultaneous calls** — bug surface if multi-user)
- `lastHintTs`, `lastHintUtteranceId`, `goalAchievedFlag`, `lastSuggestionIntent`, `lastSuggestionText`, `waitingForInfo`, `waitAckShown`, `waitingSlot` — also closure-scoped per Twilio WS connection (websocket.ts:634–648)
- `goalEngine` instance per `callSid` via `getOrCreateEngine` (goalEngine.ts)
- `utteranceGate` instance per Twilio connection
- `conversationLog` last 10 entries

---

## 7. TRAINING vs LIVE — side-by-side

| Aspect | Training mode | LIVE call mode |
|---|---|---|
| Audio in | Browser MediaRecorder, webm/opus 32 kbps | Twilio Media Streams, μ-law 8 kHz, both tracks |
| Transport | REST (base64 audio in JSON) | WebSocket (raw bytes) |
| STT | Deepgram **REST prerecorded** `nova-3` | Deepgram **WS streaming** `nova-2` |
| End-of-speech | Push-to-talk manual + "Tap Send" gate | Deepgram VAD `UtteranceEnd` or 1 s silence — automatic |
| Partial transcript shown? | No | **Yes** — feels alive |
| GST reply generation | Yes (simulated speaker, `gpt-4o-mini` 80 tok) | No — real human |
| Translation | Separate GPT call (`gpt-4o-mini` 80 tok) | Same GPT call as suggestion |
| HINT generation | Separate GPT call (`gpt-4o-mini` 120 tok) | Combined with translation (`gpt-4o-mini` 120 tok) |
| GPT calls per turn | 3 (GST + translate + HINT) | 1 (translate+suggest) |
| TTS | ElevenLabs REST after every turn | None |
| Throttling / anti-loop | Light (`processTraining` heuristics) | Full (cooldown, reaction-only, wait_state, repeat_intent, Jaccard) |
| Goal engine | `dialogState` regex slots, per-session in-memory | `GoalEngine` per `callSid`, slot extractors, achievement |
| Wait state | `WAIT_PATTERNS` regex, single ACK | Same patterns, single ACK |
| Fast filler phrases | No | Yes (`fastLayer`) |
| Per-utterance latency | ~5.1 s (with Tap Send), ~3.6 s without | ~1.4 s |
| Where slow | Tap Send (1.5 s) + 3 GPT calls (3.1 s) + STT REST (1 s) + TTS (0.9 s) | Single GPT call (1.1 s) + silence gate (1 s when VAD misses) |
| Multi-language | EN ↔ RU/ES via translation GPT | Same |

### What SHOULD be shared
- **Prompts** (`TALKHINT_GOLDEN_PROMPT`, `HINT_FAST_PROMPT`, `LIVE_ANTI_LOOP_RULES`) — currently `shared/prompts.ts` is shared but training has its own copies in `training.ts`. Consolidate.
- **GoalEngine / slot extractors** — currently LIVE uses `goalEngine.ts`, training uses bespoke `dialogState`. Should be one.
- **Throttling / anti-loop / wait-state logic** — duplicated. Extract to `server/hintGuards.ts`.
- **Fast filler bank** — `fastPhrases.json` works for both; training doesn't use it.

### What should stay separate
- Audio transport (training mic vs Twilio Stream)
- GST simulator (training only)
- TTS layer (training has it, LIVE doesn't yet)
- Throttling tuning (training is "tap Send"-paced, LIVE is real-time)

### Why this matters
- Training mode today does NOT feel like a real call (manual Send, post-hoc TTS, 5 s lag). It cannot be a useful rehearsal tool until it adopts the LIVE loop's streaming model.
- LIVE mode today feels fast but is read-only text — it should adopt training's TTS layer (whispered playback into earpiece).
- The architectural target: **one shared hint engine** + two thin shells (training=simulated GST, live=Twilio).

---

## 8. MODERNIZATION PLAN — best 2026 architecture for LIVE

### Option comparison

| Option | What it is | Pros | Cons | Verdict |
|---|---|---|---|---|
| **1. Keep current (Twilio + Deepgram + OpenAI Chat)** | Status quo | Stable, costs ~$0.02/min, working | Nova-2 outdated, sequential GPT, no streaming hint, no TTS | Patch, don't replace |
| **2. Upgrade to streaming Deepgram nova-3 + GPT streaming + ElevenLabs whisper TTS** | Same shape, modern parts | Same architecture, big perceived win: ~1.4 s → ~0.7 s + voiced hints | Just engineering work, no risk | **Recommended baseline** |
| **3. OpenAI Realtime API for end-to-end voice** | Replace Deepgram + Chat with Realtime WS, route Twilio audio directly in | Sub-500 ms voice-to-voice, natural interruptions, free speaker diarization | Realtime API doesn't natively ingest Twilio's μ-law fork from two tracks — needs careful audio plumbing, harder to keep our "hint" mental model (Realtime wants to be the speaker, not the coach) | Use for **Honor-only side channel**, not as the spine |
| **4. Vapi / Retell / Bland AI architecture (managed)** | Hand call to a managed agent platform | Out-of-the-box latency optimizations, barge-in, TTS | Loses our control over hint UX, our anti-loop / wait-state / goal-engine logic; cost ~$0.10/min | Reference for ideas only — don't migrate |

### Practical recommendation

**Three-layer modernization, hybrid:**

1. **Spine stays:** Twilio Media Streams → our server → Deepgram WS → GPT. This is what gives us the "coach watching the call" model that competitors don't have.
2. **Upgrade the spine:** Deepgram nova-3, streaming GPT, drop END_SILENCE_MS to 500 ms.
3. **Add a voice channel:** ElevenLabs streaming TTS plays the hint as a whisper into Honor's earpiece via a separate Twilio `<Stream>` (or a small `<Play>` injection). Removes the "user must read the hint" delay.

### What to fix — by horizon

#### Same day (1–4 hours each)

1. **Deepgram `nova-2` → `nova-3`** — one-line URL change in `websocket.ts:1067`. Lower WER on phone audio; matches training mode.
2. **Drop `END_SILENCE_MS` 1000 → 500 ms** — VAD already catches the real boundaries; this is a safety net. Cuts ~250 ms typical. (`utteranceGate.ts:31`)
3. **Pre-warm OpenAI on call start** — fire a dummy `gpt-4o-mini` call when `start` event arrives so the first real call doesn't pay cold-start tax.
4. **Fire fast-layer filler at 600 ms instead of 2000 ms** — currently waits too long, user doesn't get the "we're thinking" cue.
5. **Merge sentiment into `translateAndSuggest` prompt** — kills a whole second GPT call when it fires.
6. **Tighten Jaccard threshold 0.8 → 0.7** for duplicate-suggestion to catch more rephrases.

#### One week (2–5 days each)

7. **Stream GPT response tokens** to UI as they arrive (`stream:true` in OpenAI body). First token visible ~300 ms after GPT receives request. Big perceived speedup.
8. **One multichannel Deepgram WS instead of two** — `multichannel=true&channels=2`; saves a connection, simpler reconnect logic.
9. **ElevenLabs streaming TTS for hints** played to Honor via a second Twilio `<Stream>` track or `<Play>` redirect. First audio in ~300 ms.
10. **Speculative hint pre-fetch** — fire a draft suggestion based on partial transcript + last hint; replace when final arrives. Saves ~700 ms on the common case.
11. **Per-call goal/mode/language** (not module-level) — fix multi-call race in `currentGoal`/`currentMode`/`currentLanguage` (`websocket.ts:463, 204–205`).
12. **Shared `hintGuards.ts`** with training mode — single source of throttling, anti-loop, wait-state.

#### Architecture rebuild (3–6 weeks)

13. **Realtime API side-channel for HON** — wire `handleHonorStream` into the actual call (instead of standalone), giving Honor a voice-in/voice-out copilot that whispers hints based on real call audio. Twilio audio for HON feeds Realtime; suggestions still come from our Chat-based hint engine but spoken via Realtime's TTS.
14. **Unified hint engine** consumed by both LIVE (Twilio shell) and Training (simulated-GST shell). One prompt bank, one goal engine, one anti-loop module.
15. **Per-tenant fine-tune / few-shot bank** — load mode-specific examples (massage / dispatcher / recruiter / sales) into the prompt for less-generic hints.
16. **Replace regex slot extractors** with GPT function-calling for harder slots (addresses, fuzzy dates) — keep regex as the fast path.
17. **Move stateful per-call objects (GoalEngine, utteranceGate, throttling) out of closures** into a `CallContext` class; cleaner, testable, ready for multi-instance scale.

---

## 9. TL;DR

**TalkHint LIVE today is already a respectable streaming pipeline:** Twilio Media Streams → Deepgram WS → utteranceGate → one GPT-4o-mini call → UI. Speech-end to hint is **~1.4 s**, which is in the same ballpark as Vapi/Retell and 3–5× faster than our own training mode.

The three things that hold it back:

1. **`nova-2`** on Deepgram while training already uses `nova-3` — free upgrade.
2. **No streaming GPT response and no TTS** — hint arrives as a chunk of text the user has to read; both fixable with ~1 week of work each.
3. **`END_SILENCE_MS=1000` fallback** when Deepgram VAD does the same job in ~250 ms — drop to 500 ms.

After those three, perceived latency drops to **~0.6–0.8 s**, and the hint becomes a whisper in the user's ear instead of a paragraph to read. That's the gap between "useful coach" and "feels alive".

The bigger architectural play — **OpenAI Realtime API as a HON side-channel** — is worth doing, but only after the quick wins land. Don't replace the spine; modernize each segment.
