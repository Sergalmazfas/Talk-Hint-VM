# TalkHint v2 - Real-time Voice Assistant

## Overview

TalkHint is an AI-powered real-time voice assistant designed for phone calls, providing live transcription, translation hints, and GPT-powered suggestions during conversations. The project aims to enhance communication efficiency and support users in multilingual or complex call scenarios. TalkHint v2 introduces subscription-based plans to monetize the service and streamline the offering.

The system integrates with Twilio for call handling, Deepgram for speech-to-text, and OpenAI's Realtime API for AI assistance. It features a React-based web application for user interaction and a separate voice assistant interface. The current focus is on a simplified Basic plan, with previously developed features for work numbers and multi-tier plans temporarily hidden but maintained in the database.

## User Preferences

Preferred communication style: Simple, everyday language.
Key phrase: "не запрещаем, предупреждаем" - warn users when changing prompts on work numbers, don't block.

## System Architecture

### Frontend
The frontend is built with React and TypeScript, using Vite for bundling. It utilizes `shadcn/ui` with Radix UI for components, TailwindCSS for styling, React Query for server state management, and Wouter for client-side routing. A standalone HTML/JS UI is served at `/app` for the core voice assistant interface.

### Backend
The backend runs on an Express.js server with TypeScript. It manages WebSocket connections for real-time audio streaming from Twilio media streams, browser microphones ("Honor stream"), and UI clients. An audio processing pipeline handles μ-law to PCM16 conversion and 8kHz to 24kHz upsampling using FFmpeg.

### Data Storage
PostgreSQL is used for persistent data storage, managed with Drizzle ORM. The schema includes a `calls` table to store call details such as ID, `callSid`, numbers, status, timestamps, and transcripts. In-memory storage (`MemStorage`) is available as a fallback. Session persistence in production environments utilizes PostgreSQL.

### Real-time Communication
The system uses multiple WebSocket endpoints: `/twilio-stream` for Twilio media, `/honor-stream` for browser microphone audio, and `/ui` for broadcasting transcripts and responses to UI clients. A `mode` system (universal, massage, dispatcher) allows for context-specific prompt handling.

### Core Features
- **Utterance Gate**: Prevents interruption by waiting for a complete utterance before triggering GPT, using silence detection and minimum character thresholds.
- **Fast Conversation Layer**: Provides quick, deterministic short phrases (hold/ack, steer, clarify) to fill conversational pauses while GPT processes requests. Phrases are not LLM-generated and do not affect GPT context.
- **Goal State Engine**: A state machine that tracks conversation goals (e.g., booking, pricing, support) and their progress. It uses regex-based slot extraction and determines goal achievement based on defined rules.
- **Training Mode**: Allows users to practice phone calls without Twilio integration. It uses separate GPT prompts for simulating a caller (`GST_SYSTEM_PROMPT_TEMPLATE`) and providing hints (`HINT_SYSTEM_PROMPT_TEMPLATE`). The system guides the user with initial hints based on their goal, and the UI supports voice input and goal suggestions.

### Build System
Vite is used for frontend bundling, while esbuild handles server bundling, optimizing for faster cold starts by selectively bundling dependencies.

### Connection Stability
- **Twilio Call Timeout**: Configurable timeout (default 90 seconds) for `Dial` verbs and `Number` elements to prevent premature disconnections.
- **Deepgram WebSocket**: Implements keepalive pings and exponential backoff for auto-reconnection.
- **Process Stability**: Includes SIGTERM/SIGINT handlers for graceful shutdown and robust error logging. Reserved VM Deployment is recommended for production voice calls to ensure consistent uptime.

## External Dependencies

### Voice & Telephony
- **Twilio**: Used for browser-based phone calling (`@twilio/voice-sdk`) and server-side call management (`twilio` SDK). Requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, and `TWILIO_TWIML_APP_SID`. Authentication uses line tokens (e.g., `TH_NUM_1_TOKEN`).
- A unified TwiML webhook at `POST /twilio/voice` handles all incoming and outbound call routing.

### AI Services
- **OpenAI Realtime API**: Utilized for GPT-4o based real-time voice-to-voice AI assistance. Requires `OPENAI_API_KEY`.
- **Deepgram SDK**: Used for live transcription from audio streams.

### Database
- **PostgreSQL**: The primary database, configured via `DATABASE_URL`.
- **Drizzle ORM**: Used for database interactions and migrations with `drizzle-kit`.
- **connect-pg-simple**: Manages session storage in PostgreSQL for production deployments.

### Other
- **FFmpeg**: A system dependency used for audio format conversions (e.g., μ-law to PCM16).