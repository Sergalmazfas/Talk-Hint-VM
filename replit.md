# TalkHint v2 - Real-time Voice Assistant

## Overview

TalkHint is an AI-powered real-time voice assistant for phone calls. It provides live transcription, translation hints, and GPT-powered suggestions during phone conversations. The application uses Twilio for phone call handling, Deepgram for speech-to-text, and OpenAI's Realtime API for AI-powered assistance.

**TalkHint v2** adds subscription-based plans with Stripe, multiple phone numbers per user (Personal + Work) with different AI prompts/contexts for each number.

### Subscription Plans
- **Personal Plan** - $9/month: 1 personal phone number, 100 minutes/month
- **Pro Plan** - $19/month: 2 phone numbers (personal + work), unlimited minutes
- **Additional Work Number** - $10/month add-on

The system has two main interfaces:
1. A React landing page that redirects to the main app
2. A standalone TalkHint UI served from `/app` with voice calling capabilities

## User Preferences

Preferred communication style: Simple, everyday language.
Key phrase: "не запрещаем, предупреждаем" - warn users when changing prompts on work numbers, don't block.

## System Architecture

### Frontend Architecture
- **React + TypeScript** with Vite for the main client application
- **Standalone HTML/JS UI** at `talkhint/ui/` served at `/app` route for the voice assistant interface
- **shadcn/ui** component library with Radix UI primitives
- **TailwindCSS** for styling with custom theme variables
- **React Query** for server state management
- **Wouter** for client-side routing

### Backend Architecture
- **Express.js** server with TypeScript
- **WebSocket connections** for real-time audio streaming:
  - Twilio media streams for phone call audio
  - Browser microphone audio ("Honor stream")
  - UI client connections for broadcasting transcripts
- **Audio Processing Pipeline**:
  - μ-law to PCM16 conversion for Twilio audio
  - 8kHz to 24kHz upsampling for OpenAI compatibility
  - FFmpeg-based audio conversion utilities

### Data Storage
- **PostgreSQL** database with Drizzle ORM
- **Schema** includes calls table with: id, callSid, fromNumber, toNumber, status, timestamps, transcript, and metadata
- **In-memory storage** class available as fallback (MemStorage)

### Real-time Communication
- Multiple WebSocket endpoints:
  - `/twilio-stream` - Receives Twilio media streams
  - `/honor-stream` - Receives browser microphone audio
  - `/ui` - UI client connections for receiving transcripts/responses
- Mode system (universal, massage, dispatcher) for context-specific prompts

### Build System
- **Vite** for frontend bundling
- **esbuild** for server bundling with selective dependency bundling
- Custom build script that bundles allowlisted dependencies for faster cold starts

## External Dependencies

### Voice & Telephony
- **Twilio Voice SDK** (`@twilio/voice-sdk`) - Browser-based phone calling
- **Twilio Node SDK** (`twilio`) - Server-side call management
- Required env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_TWIML_APP_SID`
- Line tokens: `TH_NUM_1_TOKEN` through `TH_NUM_7_TOKEN` for contractor authentication

### Twilio Architecture (Canonical)
One TwiML App serves all phone numbers with intelligent routing:

**Authentication Endpoints:**
- `POST /auth/by-token` - Authenticate with TH_NUM_X_TOKEN → returns session + lineId + twilioNumber
- `GET /twilio/access-token` - Get Twilio JWT (requires Bearer session token)
- `GET /api/token` - Get Twilio JWT for logged-in users (uses user identity)

**Webhook Endpoint:**
- `POST /twilio/voice` - Unified TwiML webhook for all numbers
  - Signature validation via TWILIO_AUTH_TOKEN (disable with `DISABLE_TWILIO_SIGNATURE_CHECK=true`)
  - Incoming calls: Lookup by `To` in phoneNumbers or available_numbers
  - Outbound calls: Support for `client:line_X` and `client:user-{userId}` identities
  - Automatic Caller ID selection based on identity

**Line Mapping:**
- Lines 1-7 map to available_numbers with subaccountName format: `TH-NUM-001` to `TH-NUM-007`
- Each line has a corresponding TH_NUM_X_TOKEN for authentication

### AI Services
- **OpenAI Realtime API** - GPT-4o realtime for voice-to-voice AI assistance
- **Deepgram SDK** (`@deepgram/sdk`) - Live transcription
- Required env vars: `OPENAI_API_KEY`

### Database
- **PostgreSQL** via `DATABASE_URL` environment variable
- **Drizzle ORM** with drizzle-kit for migrations
- **Session Storage**: In development uses in-memory, in production uses PostgreSQL via `connect-pg-simple` (table: `user_sessions`)

### Production Deployment Notes
- **Seed runs only in development** - Never runs automatically in production to avoid deployment failures
- **To seed production**: Set `RUN_SEED=true` environment variable
- **Diagnostic endpoint**: `/api/build` - Returns deployment info (host, env, dbConnected, replId) for debugging domain/session issues
- **Session persistence**: Uses PostgreSQL session store in production to support autoscale

### Audio Processing
- **FFmpeg** (system dependency) - Audio format conversion between μ-law and PCM16

### Fast Conversation Layer
Быстрый слой коротких фраз для заполнения пауз пока GPT думает:
- **server/fastLayer.ts** - FastLayerManager с таймером 450ms и cooldown 1200ms
- **server/fastPhrases.json** - База фраз с категориями:
  - `hold/ack` - короткие подтверждения ("Got it", "Okay")
  - `steer` - ведущие вопросы ("What time works for you?")
  - `clarify` - уточнения при шуме/обрыве
- **Принципы:**
  - Не LLM, а детерминированная логика (rules + база)
  - 1 fast-фраза на 1 реплику GST
  - Не сохраняется в историю/контекст GPT
  - WebSocket событие `fast_phrase` с target: HON
  - UI показывает временно (fade-out через 5 сек)

### Goal State Engine
State-machine для отслеживания цели разговора и прогресса:
- **shared/goalTypes.ts** - Типы GoalType, GoalStatus, GoalState, SlotMap
- **server/slotExtractors.ts** - Regex для извлечения 7 слотов: date, time, phone, name, location, price, service
- **server/goalEngine.ts** - GoalEngine класс с методами:
  - `updateOnUtterance({speaker, text, ts})` - обновление состояния
  - `detectGoalType(text, prevGoal)` - определение цели с confidence
  - `extractSlots(text)` - извлечение слотов из текста
  - `computeMissingSlots(goalType, slots)` - расчёт недостающих слотов
  - `checkAchieved(goalType, slots, text)` - проверка достижения цели
- **Goal Types:** booking, pricing, support, info, negotiation, other
- **Achieved Rules:**
  - `booking` - date + time ИЛИ фраза "confirmed/booked/see you"
  - `pricing` - найден price
  - `support` - фраза "fixed/works now/done"
- **WebSocket события:**
  - `goal_state_update` - после каждого финального utterance
  - `goal_achieved` - один раз при достижении цели
- **Интеграция с FastLayer:**
  - Анти-повтор steer: lastSteerSlot + lastSteerAt с cooldown 5 сек
  - GoalEngine получает fastMeta и не предлагает тот же слот повторно
- **UI панель:** Goal Progress с goalType, missingSlots, status, nextBestAction