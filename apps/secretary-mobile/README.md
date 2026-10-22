# TalkHint Secretary client

An independent Expo SDK 54 client for the Secretary workflow. It contains only the Secretary, Cards, History, and Settings areas. Every displayed task is marked TEST; preparing and confirming a task never initiates a phone call. Google Calendar connect/disconnect and calendar selection are supported, but appointment booking is unavailable.

## Run

```sh
npm install
npm run start
npm run web
npm run typecheck
npm run export:web
```

The web export is emitted to `dist/` and is intended to be hosted by the app at `/secretary-preview/`. Web requests use the current same-origin host and token storage uses `sessionStorage` (not durable storage); the Settings screen states this limitation. On native, enter a development HTTPS backend origin in Settings. Production `talkhint.app` origins are rejected.

## Development builds

`eas.json` contains internal development and preview profiles only. No production/release profile or production credentials are configured. Configure a development backend before signing in. Sign in with account email/password or use the optional PKCE browser handoff: the browser requires an existing account login and explicit approval. The client never displays or asks the user to paste a raw session token.

## Current API expectations

The client calls `/api/mobile-secretary/*` only. It does not call the live `/api/secretary/tasks` endpoint. The matching Dev-only adapter is implemented in `server/mobileSecretary/`; it is mounted by the existing TalkHint server. Run the root `npm run dev`, then open `/secretary-preview/` after `npm run export:web` here. Actual calls are deliberately unavailable in this stage.

For a local native development build, first set the existing Dev backend:

```sh
EXPO_PUBLIC_API_ORIGIN=https://YOUR-DEV-DOMAIN npx expo start --dev-client
# macOS/Xcode, after local native toolchain setup:
npx expo run:ios
# Android SDK/JDK/device, after local native toolchain setup:
npx expo run:android
```

No signing accounts, paid EAS builds, application-store registrations or push
credentials are created by these commands in this workspace. The checked-in
native configuration is not proof of a successful device build. Expo Go is not
the claimed validation target; use development builds.

Task preparation uses a conversation-scoped clarification panel backed by `/prepare/message`; both typed text and explicitly recorded/transcribed speech enter that same preparation conversation. Server replies and suggested goals are shown with an explicit “Use as instruction” action, never auto-confirmed or replaced by a fallback model. Preparation persists request/message IDs and conversation state. Task confirmation is explicit and does not place calls. Voice recording requires microphone permission and surfaces service/permission errors without fabricating a transcript.

## Verification gaps

No native device/simulator tests have run yet. Backend tests cover scoped session rotation/revocation, owner isolation, exact review, retry/concurrent confirmation and Work-card permission validation. A separate real Dev HTTP/PostgreSQL smoke test uses temporary synthetic accounts, exercises real edits and durable TEST state, then removes its fixtures. Device behavior still needs checking: microphone cleanup/backgrounding, copy controls, Google system-browser login, SecureStore recovery, interrupted responses and screen readers. Google OAuth uses the browser approval flow; a `setup_required` 409 is shown honestly when the development backend lacks provider configuration. The client asks users to return from the browser and refresh Settings. Outlook, iCloud, Cal.com, booking, phone-number assignment, and activation are intentionally unavailable.
