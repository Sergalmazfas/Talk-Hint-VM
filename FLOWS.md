# TalkHint: Training vs Real Call Flows

## Overview

TalkHint has two completely separate call modes:
- **Training Mode** - Practice calls with AI, no Twilio
- **Real Call Mode** - Live calls through Twilio with AI assistance

These modes are **fully isolated** - different files, endpoints, prompts, and session storage.

---

## Training Flow

```
UI (Browser) → /training/start → training.ts → OpenAI Chat API
     ↓
Microphone → /training/stt → Deepgram prerecorded → text
     ↓
text → /training/turn → training.ts → GST response + Hint
     ↓
(optional) → /training/tts → ElevenLabs → audio
```

### Files
| Component | File |
|-----------|------|
| Session management | `server/training.ts` |
| Routes | `server/routes.ts` (lines 1638-1720) |
| Prompts | `server/training.ts` (GST_FAST_PROMPT, HINT_FAST_PROMPT) |

### Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/training/start` | POST | Start new training session |
| `/training/turn` | POST | Process user message, get GST + Hint |
| `/training/stt` | POST | Convert voice to text (Deepgram) |
| `/training/tts` | POST | Convert text to voice (ElevenLabs) |
| `/training/reset` | POST | Clear session history |

### Session Storage
- In-memory `Map<string, TrainingSession>`
- Key: `sessionId` (UUID)
- Auto-cleanup every 5 minutes (30 min expiry)

### Prompts Used
- `GST_FAST_PROMPT` - Simulates phone call partner (3-4 lines)
- `HINT_FAST_PROMPT` - Generates suggestions for user
- Model: `gpt-4o-mini` (Chat Completions API)

---

## Real Call Flow

```
Twilio → /twilio/voice (TwiML) → /twilio-stream (WebSocket)
                                       ↓
                               websocket.ts (media handler)
                                       ↓
                               Deepgram Live STT
                                       ↓
                               OpenAI Realtime API
                                       ↓
                               /ui (WebSocket) → UI
```

### Files
| Component | File |
|-----------|------|
| WebSocket handling | `server/websocket.ts` |
| Twilio routes | `server/routes.ts` (TwiML endpoints) |
| Prompts | `shared/prompts.ts` (TALKHINT_GOLDEN_PROMPT, MODE_PROMPTS) |

### Endpoints
| Endpoint | Type | Purpose |
|----------|------|---------|
| `/twilio/voice` | POST | TwiML webhook for incoming calls |
| `/twilio-stream` | WebSocket | Receives Twilio media stream |
| `/honor-stream` | WebSocket | Browser microphone audio |
| `/ui` | WebSocket | Broadcasts transcripts to UI |

### Session Storage
- Database: `calls` table
- Key: `callSid` (Twilio Call SID)
- Persisted with transcript and metadata

### Prompts Used
- `TALKHINT_GOLDEN_PROMPT` - Main assistant prompt (100+ lines)
- `MODE_PROMPTS` - Mode-specific instructions (universal, massage, dispatcher)
- Model: `gpt-4o-realtime-preview` (Realtime API)

---

## Key Differences

| Aspect | Training | Real Call |
|--------|----------|-----------|
| **Twilio** | Not used | Required |
| **STT** | Deepgram prerecorded | Deepgram live WebSocket |
| **LLM** | gpt-4o-mini (Chat API) | gpt-4o-realtime (Realtime API) |
| **Latency** | ~500-1500ms per turn | ~200-400ms streaming |
| **Session** | In-memory (temp) | Database (persisted) |
| **Audio** | Browser MediaRecorder | Twilio μ-law stream |

---

## Isolation Guarantees

1. **No shared state** - Training sessions and call sessions use different storage
2. **No shared endpoints** - `/training/*` never touches Twilio code
3. **No shared prompts** - Training uses short prompts, calls use full prompts
4. **No shared context** - trainingSessionId ≠ callSid

---

## File Reference

```
server/
├── training.ts      # Training mode ONLY
├── websocket.ts     # Real calls ONLY  
├── routes.ts        # Both (different route prefixes)
└── twilioService.ts # Twilio operations (calls only)

shared/
├── prompts.ts       # Real call prompts
└── schema.ts        # Database schema (calls table)
```
