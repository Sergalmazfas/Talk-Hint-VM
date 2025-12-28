# TalkHint - Real-time Voice Assistant

## Overview

TalkHint is an AI-powered real-time voice assistant for phone calls. It provides live transcription, translation hints, and GPT-powered suggestions during phone conversations. The application uses Twilio for phone call handling, Deepgram for speech-to-text, and OpenAI's Realtime API for AI-powered assistance.

The system has two main interfaces:
1. A React landing page that redirects to the main app
2. A standalone TalkHint UI served from `/app` with voice calling capabilities

## User Preferences

Preferred communication style: Simple, everyday language.

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

### AI Services
- **OpenAI Realtime API** - GPT-4o realtime for voice-to-voice AI assistance
- **Deepgram SDK** (`@deepgram/sdk`) - Live transcription
- Required env vars: `OPENAI_API_KEY`

### Database
- **PostgreSQL** via `DATABASE_URL` environment variable
- **Drizzle ORM** with drizzle-kit for migrations

### Audio Processing
- **FFmpeg** (system dependency) - Audio format conversion between μ-law and PCM16