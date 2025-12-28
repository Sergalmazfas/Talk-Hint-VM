# TalkHint - Real-time Voice Assistant

TalkHint helps non-English speakers during phone calls with live transcription, translation hints, and AI-powered suggestions.

## Features

- **Browser-to-Phone Calling** - Make calls directly from browser using Twilio Voice SDK
- **Real-time Transcription** - Live speech-to-text in Russian, Spanish, and English
- **AI Hints** - GPT-powered contextual suggestions during calls
- **PREP Mode** - Practice phone conversations before making real calls
- **Voice Waveform Animation** - Visual feedback when speaking
- **Multilingual Support** - Auto-detect language (RU/ES/EN)

## How It Works

1. Open the app at `/app/`
2. Enter a phone number with country code (e.g., +1234567890)
3. Click the green call button to start a call
4. Speak into your microphone - you'll see live transcription
5. AI provides hints and suggestions in real-time

### PREP Mode (Call Rehearsal)

1. Select a scenario from the left menu (Realtor, Dispatcher, Handyman, etc.)
2. Click the microphone button to speak
3. Your speech is transcribed and AI generates a practice dialogue
4. Use the copy button to save phrases for your real call

## Tech Stack

- **Frontend**: React, TailwindCSS, Vite
- **Backend**: Express.js, WebSocket
- **Voice**: Twilio Voice SDK, Web Audio API
- **AI**: OpenAI GPT-4 Realtime API
- **Database**: PostgreSQL with Drizzle ORM

## Environment Variables

Required secrets:
- `OPENAI_API_KEY` - OpenAI API key
- `TWILIO_ACCOUNT_SID` - Twilio Account SID
- `TWILIO_AUTH_TOKEN` - Twilio Auth Token
- `TWILIO_API_KEY` - Twilio API Key
- `TWILIO_API_SECRET` - Twilio API Secret
- `TWILIO_PHONE_NUMBER` - Your Twilio phone number
- `TWILIO_TWIML_APP_SID` - TwiML Application SID

## Running Locally

```bash
npm install
npm run dev
```

## Golden Version

Stable production version: commit `ee0ed3ac6617b015a106677402f0fa93ca81237e`

## License

Private project
