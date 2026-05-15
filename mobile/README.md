# TalkHint Mobile — iOS App

Native iPhone app for TalkHint real-time call assistant.

## Architecture

```
mobile/
├── app/                     # Expo Router screens
│   ├── _layout.tsx          # Root layout (SafeArea, Navigation)
│   └── (tabs)/
│       ├── _layout.tsx      # Tab bar (Assistant / History / Settings)
│       ├── index.tsx        # Main assistant screen
│       ├── history.tsx      # Transcript history
│       └── settings.tsx     # Server URL + language settings
├── components/
│   ├── TranscriptFeed.tsx   # Real-time transcript list
│   ├── HintCard.tsx         # GPT suggestion card (animated)
│   ├── MicButton.tsx        # Mic toggle with pulse animation
│   ├── StatusBar.tsx        # Connection status indicator
│   └── GoalBanner.tsx       # Current goal + slot tracking
├── hooks/
│   ├── useWebSocket.ts      # Connect/send to TalkHint backend
│   └── useMicrophone.ts     # Mic permissions + audio recording
├── services/
│   └── websocket.ts         # WebSocket client (singleton)
├── store/
│   └── appStore.ts          # Zustand global state
├── constants/
│   ├── colors.ts            # Design tokens (matches web UI)
│   └── index.ts             # App constants
├── app.json                 # Expo config + iOS permissions
└── eas.json                 # EAS Build config for App Store
```

## Backend Connection

The mobile app connects to the existing TalkHint backend via WebSocket `/ui` endpoint.

WebSocket messages used:
- Send: `{ type: "set_goal", goal: "..." }`
- Send: `{ type: "set_language", language: "ru" | "es" }`
- Send: `{ type: "ask_ai", question: "..." }`
- Receive: `{ type: "guest_transcript", text, isFinal }`
- Receive: `{ type: "owner_transcript", text, isFinal }`
- Receive: `{ type: "hint", suggestion: { en, translation } }`
- Receive: `{ type: "hints", hints: [{ en, translation }] }`
- Receive: `{ type: "goal_state_update", ... }`
- Receive: `{ type: "goal_achieved" }`

## Development Setup

```bash
cd mobile
npm install
npx expo start
```

Scan QR code with **Expo Go** app on iPhone to test.

## iOS Build (App Store)

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Build for TestFlight
eas build --platform ios --profile preview

# Submit to App Store
eas submit --platform ios
```

## Required Accounts

| Service | URL | Cost |
|---------|-----|------|
| Apple Developer | developer.apple.com | $99/year |
| Expo (EAS Build) | expo.dev | Free tier available |

## iOS Permissions (in app.json)

- `NSMicrophoneUsageDescription` — for real-time call transcription
- `UIBackgroundModes: ["audio", "voip"]` — for background call handling
