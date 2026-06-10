# TalkHint v2 - Real-time Voice Ass
istant

## Overview
TalkHint is an AI-powered real-time voice assistant designed for phone calls. It offers live transcription, translation hints, and GPT-powered suggestions during conversations. The system integrates Twilio for call handling, Deepgram for speech-to-text, and OpenAI's Realtime API for AI assistance. TalkHint v2 introduces subscription-based plans with Stripe, focusing on a simplified Basic plan. The project aims to provide an advanced conversational AI experience, enhancing communication efficiency and effectiveness for users during phone interactions.

## User Preferences
Preferred communication style: Simple, everyday language.
Key phrase: "не запрещаем, предупреждаем" - warn users when changing prompts on work numbers, don't block.

## System Architecture

### Frontend
The main client application is built with React and TypeScript using Vite, providing a modern and responsive user interface. A separate, standalone HTML/JS UI is served at `/app` for the core voice assistant interface. Design is based on `shadcn/ui` with Radix UI primitives and styled using TailwindCSS. React Query manages server state, and Wouter handles client-side routing.

### Backend
The backend runs on Express.js with TypeScript, facilitating real-time audio streaming via WebSockets. It handles Twilio media streams, browser microphone audio ("Honor stream"), and broadcasts transcripts to UI clients. An audio processing pipeline converts μ-law to PCM16 and upsamples to 24kHz for OpenAI compatibility, utilizing FFmpeg for conversions.

### Data Storage
PostgreSQL serves as the primary database, managed with Drizzle ORM. The schema includes a `calls` table for tracking call details, transcripts, and metadata. In production, `connect-pg-simple` is used for session storage in PostgreSQL.

### Real-time Communication
Multiple WebSocket endpoints (`/twilio-stream`, `/honor-stream`, `/ui`) manage real-time audio and data flow. A mode system (universal, massage, dispatcher) applies context-specific prompts. The system employs an Utterance Gate to prevent interruptions by waiting for complete speaker turns before GPT processing, and Hint Throttling to limit suggestion frequency. A Fast Conversation Layer provides immediate, short phrases to fill pauses while GPT processes, using a predefined `fastPhrases.json` database.

### Speech-to-Text (Deepgram Flux v2)
Transcription uses Deepgram **Flux** (`flux-general-en`) over the v2 streaming endpoint (`wss://api.deepgram.com/v2/listen`). Flux does conversational, model-native turn detection, so the old Nova-3 signals (`is_final` / `speech_final` / VAD `SpeechStarted` / `UtteranceEnd`) are gone. Instead it emits `TurnInfo` events: `StartOfTurn` (log only), `Update` (interim text → broadcast to UI as non-final), and `EndOfTurn` (turn complete → committed to the pipeline + broadcast as final). Audio is sent as Twilio-native μ-law @ 8kHz with no transcoding. Tuning params: `eot_threshold=0.7`, `eot_timeout_ms=3000`; eager mode is **off** (no `eager_eot_threshold`). No manual `KeepAlive` is sent — Flux has a server-side watchdog. The Utterance Gate is reduced to a thin finalizer (`commitTurn`) doing min-length filtering, consecutive-duplicate suppression, and per-speaker turn counting; cross-track echo dedup stays in the websocket layer.

### Hint model & timing
The live hint generator (`translateAndSuggest`) defaults to `gemini-2.5-flash-lite`. The active model is a server-side global (`currentModel`) that the user picks from the **AI Model** selector in the `/app` sidebar — the UI sends a `set_model` WebSocket message, validated against an allowlist (`ALLOWED_HINT_MODELS`: gpt-4.1-mini, gpt-4.1-nano, gpt-4o-mini, gpt-4o, gemini-2.5-flash-lite, gemini-2.5-flash) and persisted in `localStorage`. Provider routing is by model name: `gemini-*` models go to Google Gemini (`generateContent` REST, `thinkingBudget=0`, key from `GEMINI_API_KEY` with fallback to the misspelled `GEMINI_API_KAY` secret); everything else goes to OpenAI. Both providers share the same prompt and JSON-parsing path. If a Gemini call fails or returns empty/unparseable output, hint generation automatically falls back to OpenAI (`OPENAI_FALLBACK_MODEL` = `gpt-4.1-mini`) so live calls never lose hints. Fallback frequency is tracked (`getHintFallbackStats()`): each fallback logs a running rate (`[fallbacks N/total = X%]`) and the cumulative counters (`geminiAttempts`, `geminiFallbacks`, `fallbackRatePct`) are exposed under `hintFallback` on `GET /api/health` to spot Gemini degradation. The startup default can still be overridden with the `HINT_MODEL` env var. Like `currentMode`/`currentLanguage`, the model is process-global (effectively single-user), not per-user. The guest-utterance pipeline emits `[TIMING]` logs per turn: `gpt=<ms>` (OpenAI call duration), `reaction end_of_turn->caption=<ms>` and `reaction end_of_turn->suggestion=<ms>` (measured from `handleGuestUtteranceComplete` entry ≈ Deepgram EndOfTurn). Duplicate-suggestion blocking uses `DUPLICATE_SIMILARITY = 0.8` (Jaccard).

### AI and Conversation Flow
The system incorporates a Goal State Engine, a state machine that tracks conversation objectives (e.g., booking, pricing). It uses regex-based slot extractors for key information (date, time, phone, etc.) and determines when a goal is achieved. In "Training Mode," the system simulates phone calls using two distinct prompts: one for the simulated conversational partner (GST_SYSTEM_PROMPT_TEMPLATE) and another for the TalkHint assistant (HINT_SYSTEM_PROMPT_TEMPLATE), supporting voice input via Deepgram STT and goal-first guidance.

### Build and Deployment
Vite is used for frontend bundling, while esbuild handles server bundling with selective dependency inclusion for optimized cold starts. Graceful shutdowns are managed with SIGTERM/SIGINT handlers. For production voice calls, Reserved VM Deployment is recommended to ensure consistent uptime for WebSocket connections, avoiding issues with autoscaling.

On every production startup (i.e. after each Publish), the server automatically repoints all Twilio pool numbers' voice/status webhooks at the live production URL via `repointWebhooksOnStartup` in `server/index.ts`. The URL is resolved from `PRODUCTION_URL` → `REPLIT_DEPLOYMENT_URL` → first host in `REPLIT_DOMAINS` → fallback. This is idempotent and logs which numbers were updated. Set `DISABLE_AUTO_WEBHOOK_REPOINT=true` to opt out. `scripts/configure-twilio-webhooks.ts` remains as a manual fallback.

### Stripe Integration (Manual)
Stripe runs in **manual mode** — no Replit Stripe connector / `stripe-replit-sync` package. The backend uses only `STRIPE_SECRET_KEY` (server) and `STRIPE_PUBLISHABLE_KEY` (client). Webhook signature is verified manually via `stripe.webhooks.constructEvent` using `STRIPE_WEBHOOK_SECRET`. The webhook endpoint must be registered manually in the Stripe Dashboard (`/api/stripe/webhook`) for events `checkout.session.completed` and `customer.subscription.created/updated/deleted`. Product/subscription data is fetched directly from the Stripe API on demand (no DB sync schema).

### AirAtoma CRM Integration (outbound webhook)
After every call ends, TalkHint POSTs the finished transcript to the AirAtoma CRM webhook (`POST /api/talkhint/webhook` on the AirAtoma side), which runs its own Claude analysis (summary, key points, agreements, next steps, sentiment), auto-matches the call to a project, creates Decisions/Tasks, sends a Telegram notification, and shows it in a Calls tab. **That receiving side lives in the AirAtoma project, not here.** TalkHint only builds and sends the payload, implemented in `server/airatomaWebhook.ts` and fired from the Twilio-stream WebSocket `close` handler in `server/websocket.ts`, right beside the contact-memory summarization. The body matches the agreed contract: `{ callId, transcript, callerName, durationSecs, recordingUrl? }` where `callId` = Twilio CallSid (AirAtoma dedupes on it, so re-sends are safe), `transcript` = full speaker-labeled text (uncapped), `callerName` = the contact's saved name falling back to their phone number, `durationSecs` = whole-second call length, and `recordingUrl` is omitted (TalkHint does not record calls). Sending is **fire-and-forget with a ~5s AbortController timeout** so a slow/unresponsive AirAtoma can never block call teardown or leak hanging fetches. Config: `AIRATOMA_WEBHOOK_URL` enables the feature (a no-op when unset; skipped with a warning if it isn't an `http(s)` URL); optional `TALKHINT_WEBHOOK_SECRET` is sent as the `x-talkhint-secret` header.

## External Dependencies

### Voice & Telephony
- **Twilio Voice SDK**: For browser-based calling.
- **Twilio Node SDK**: For server-side call management.
- **Twilio**: Used for telephony services, including call routing and webhooks.

### AI Services
- **OpenAI Realtime API**: Provides real-time GPT-4o assistance for voice-to-voice interactions.
- **OpenAI Chat Completions**: Default provider for live hint generation (`translateAndSuggest`).
- **Google Gemini** (`generateContent` REST): Optional hint provider (`gemini-2.5-flash-lite`, `gemini-2.5-flash`), selectable from the AI Model picker. Key: `GEMINI_API_KEY` (fallback `GEMINI_API_KAY`).
- **Deepgram SDK**: Used for live speech-to-text transcription.

### Database
- **PostgreSQL**: Primary database.
- **Drizzle ORM**: Used for database interactions and migrations.

### Payments
- **Stripe** (manual): `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`. No Replit Stripe connector.

### Utilities
- **FFmpeg**: System dependency for audio format conversions.

## Hint Control Systems

### Hint Throttling (LIVE mode)
Prevents spam of suggestions - 1 hint = 1 GST utterance:
- **Constants:** `HINT_COOLDOWN_MS = 1500`, `END_SILENCE_MS = 1000`
- **Variables:** `lastHintTs`, `lastHintUtteranceId`, `goalAchievedFlag`
- **Blocks:** cooldown, duplicate utterance, goal achieved
- **Logging:** `[BLOCKED] reason=cooldown/hint_shown/goal_achieved`

### Anti-Loop Guards (LIVE mode)
Prevents cycling on same emotions/suggestions:
- **Reaction-only filter:** Blocks short emotional phrases ("That's good", "Amazing") from triggering suggestions. Translation still shown.
- **Repeat intent guard:** Blocks consecutive enthusiasm suggestions (enthusiasm → enthusiasm loop).
- **Duplicate suggestion filter:** Blocks suggestions with >80% Jaccard similarity.
- **Prompt rules:** "After agreement → next step" - forces GPT to ask concrete questions instead of looping on excitement.
- **Logging:** `[BLOCKED] reason=reaction_only/repeat_intent/duplicate_suggestion`

### Wait State (LIVE mode)
Prevents spam when GST says "let me check":
- **Trigger patterns:** "let me check", "one moment", "hold on", "just a second", "looking into", etc.
- **Exit patterns:** "found it", "here's", "the answer", "it's", "costs", "we have", etc.
- **Behavior:** When triggered, shows 1 ACK ("Sure, I'll wait"), then blocks all STEER suggestions until exit pattern detected.
- **Variables:** `waitingForInfo`, `waitAckShown`, `waitingSlot`
- **Logging:** `[WAIT_STATE] Entered/Exited`, `[BLOCKED] reason=wait_state`

### Goal Persistence
- Goal is passed in EVERY GPT request (system + user message)
- Goal is in both `translateAndSuggest()` and hint generation
- User message includes explicit reminder: "Your suggestion must ADVANCE the goal"