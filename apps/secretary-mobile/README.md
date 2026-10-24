# TalkHint Secretary client

An independent Expo SDK 54 client for the Secretary workflow. It contains only the Secretary, Cards, History, and Settings areas. The permanent backend is `https://talkhint.app`. Production advertises live calling; Dev defaults to TEST. Real calls require an immutable review and explicit `confirmRealCall:true` confirmation. Google Calendar connect/disconnect and calendar selection are supported, but appointment booking is unavailable.

## Run

```sh
npm install
npm run start
npm run web
npm run typecheck
npm run export:web
```

The web export is emitted to `dist/` and hosted by the Dev app at `/secretary-preview/`. Native clients use `EXPO_PUBLIC_API_ORIGIN=https://talkhint.app` or the address entered on sign-in. Tokens use native SecureStore; web uses sessionStorage. Separate-origin browser API requests remain restricted by CORS; use native builds or the existing same-origin Dev preview.

## Development builds

`eas.json` contains internal development and preview profiles only. No store/release credentials are configured. Sign in with account email/password or the PKCE browser handoff using the existing Google flow and explicit approval. No raw token needs to be pasted. Connecting to the permanent backend is distinct from publishing an App Store release.

## Current API expectations

The client calls `/api/mobile-secretary/*` only. The compatible adapter in `server/mobileSecretary/` is mounted in Dev and production. Production scoped state uses the additive `mobile_secretary_state` table; existing Dev state remains separate. Live confirmation reuses the SAME `secretaryBackend(dialSecretaryTask)` as ChatGPT, preserving model/voice, number selection, callbacks, isolation and recording/SMS guards. No dialing occurs on mount, login, prepare, GET, refresh or retry.

See `docs/roadmap/mobile-production-handoff.md` in the original backend workspace for the exact API and separate-project update instructions. Existing `/prepare` and `/test-tasks/*` remain TEST even in production. Ambiguous live starts are read/reconciled, never automatically redialed. Real reports remain in existing call history after temporary review state expires.

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

Task preparation uses a conversation-scoped clarification panel backed by `/prepare/message`; typed and explicitly recorded/transcribed instructions enter the same preparation flow. Suggested goals require “Use as instruction”, never auto-confirmation or model fallback. Production call confirmation explicitly starts a real call; Dev TEST confirmation does not. Microphone failures are visible; no transcript is fabricated.

## Verification gaps

No native device/simulator tests have run yet. Backend tests cover scoped session rotation/revocation, owner isolation, exact review, retry/concurrent confirmation and Work-card permission validation. A separate real Dev HTTP/PostgreSQL smoke test uses temporary synthetic accounts, exercises real edits and durable TEST state, then removes its fixtures. Device behavior still needs checking: microphone cleanup/backgrounding, copy controls, Google system-browser login, SecureStore recovery, interrupted responses and screen readers. Google OAuth uses the browser approval flow; a `setup_required` 409 is shown honestly when the development backend lacks provider configuration. The client asks users to return from the browser and refresh Settings. Outlook, iCloud, Cal.com, booking, phone-number assignment, and activation are intentionally unavailable.
