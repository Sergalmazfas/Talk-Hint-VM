# TalkHint - Real-time Voice Assistant

## Golden Version (Stable Release)

**Commit:** `ee0ed3ac6617b015a106677402f0fa93ca81237e`  
**Date:** December 20, 2025  
**Status:** Production-ready, fully working on published site

Key features working in this version:
- Browser-to-phone calling via Twilio Voice SDK
- Real-time transcription and AI hints
- Multilingual speech recognition (RU/ES/EN)
- Voice waveform animation
- PREP mode for call rehearsal
- **NEW: Assistant Chat** - text-based chat with AI during live calls

## Recent Changes

**December 28, 2025 - Assistant Chat Feature**
- Added ASSISTANT_CHAT_PROMPT in server/websocket.ts - AI acts as prompter/sufleur for Honor
- Updated /api/chat endpoint to support live call mode with conversation context
- UI integration: sendToAssistant() function with context tracking
- Honor can write in any language (RU/ES/EN), assistant provides ready-to-say English phrases
- Conversation context (last 20 messages) passed to AI for relevant suggestions

To restore this version, use Replit's checkpoint/rollback feature.

## Overview

TalkHint is a real-time voice assistant application that helps users during phone calls by providing live transcription, translation hints, and AI-powered suggestions. The system processes audio streams from both Twilio phone calls and browser microphones, transcribes speech using OpenAI's Realtime API, and delivers contextual hints to the host (HON) during conversations with guests (GST).

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Application Structure
The project follows a full-stack monorepo pattern with clear separation between client, server, and domain-specific modules:

- **client/** - React frontend using Vite, TailwindCSS, and shadcn/ui components
- **server/** - Express.js backend with WebSocket support for real-time communication
- **shared/** - Shared TypeScript types and database schema definitions
- **talkhint/** - Core TalkHint functionality including audio processing and GPT integration

### Frontend Architecture
- React with TypeScript using Vite as the build tool
- TailwindCSS for styling with shadcn/ui component library (New York style)
- TanStack Query for server state management
- Wouter for client-side routing
- Path aliases: `@/` for client/src, `@shared/` for shared modules

### Backend Architecture
- Express.js server with native HTTP server for WebSocket support
- Three WebSocket endpoints:
  - `/twilio-stream` - Receives audio from Twilio Media Streams (phone calls)
  - `/honor-stream` - Receives audio from browser microphone (host's device)
  - `/ui` - Broadcasts events to connected UI clients
- Audio conversion using ffmpeg (μ-law to PCM16 at 16kHz)

### Real-time Processing Pipeline
1. Audio input arrives via WebSocket (Twilio or browser)
2. Audio is converted from μ-law/raw to PCM16 16kHz mono using ffmpeg streaming
3. Converted audio streams to OpenAI Realtime API via WebSocket
4. GPT provides transcription and contextual hints
5. Results broadcast to UI clients via WebSocket

### Data Storage
- Drizzle ORM with PostgreSQL dialect configured
- In-memory storage implementation (MemStorage) currently in use
- Schema defines calls table with: id, callSid, fromNumber, toNumber, status, timestamps, transcript, metadata

### Mode System
Three operational modes for different use cases:
- Universal - General purpose assistant
- Massage - Massage salon client communication
- Dispatcher - Call dispatcher assistance

## External Dependencies

### APIs and Services
- **OpenAI Realtime API** - GPT-4 model for real-time speech transcription and AI hints (requires OPENAI_API_KEY)
- **Twilio Voice SDK** - Browser-to-PSTN WebRTC calling (requires TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_PHONE_NUMBER, TWILIO_TWIML_APP_SID)

### WebRTC Browser Calling (Working!)
- Uses @twilio/voice-sdk 2.17.0 bundled with esbuild for browser
- TalkHint UI at /app/ - direct browser-to-phone calling
- Token endpoint: GET /api/token - generates Access Token with Voice Grant
- TwiML webhook: POST /twilio/voice - handles outbound dial
- TwiML App SID: AP10d04a2c23c851da6c300263849c993f

### Database
- PostgreSQL via Drizzle ORM (DATABASE_URL environment variable required)
- Migrations stored in /migrations directory
- Schema defined in shared/schema.ts

### System Requirements
- ffmpeg - Required for audio format conversion (μ-law to PCM16)
- Node.js with ES modules support

### Key NPM Packages
- ws - WebSocket server and client implementation
- drizzle-orm/drizzle-kit - Database ORM and migrations
- express - HTTP server framework
- @tanstack/react-query - Client-side data fetching
- Radix UI primitives - Accessible component foundations