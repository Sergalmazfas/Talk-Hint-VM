# TalkHint - Real-time Voice Assistant

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
- **Twilio Media Streams** - Phone call audio streaming (requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)

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