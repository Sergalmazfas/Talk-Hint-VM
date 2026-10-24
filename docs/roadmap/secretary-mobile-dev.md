# Separate TalkHint Secretary mobile client — Dev implementation

This is a standalone Expo project in `apps/secretary-mobile`, **not a migration**.
The existing root npm app, Swift app, administrator interface, laboratories and
provider settings remain independent. No number is assigned by this client.

## Server boundary

`/api/mobile-secretary/*` is mounted only with `NODE_ENV=development`.
The new `thmobile.` bearer credential is valid only on that router. Legacy
`authMiddleware` explicitly rejects it even if a browser also has a Passport
cookie. It cannot authorize legacy dial, number-assignment, retry or hangup APIs.
Tokens are random, hashed in the Dev database, expire after 24 hours and can be
rotated/revoked. Native storage is Expo SecureStore; the web preview deliberately
uses temporary sessionStorage, not a claim of equivalent native security.

Existing email/password accounts can sign in directly. Existing Google users
can use a browser authorization flow: random verifier → SHA-256 challenge →
existing Google login → explicit authorization → single-use verifier exchange.
No long-lived token is passed in a redirect URL. The optional Dev return branch
does not grant administrator privileges or change the existing Swift callback.
Real Google login needs verification with the owner's account/browser.

## Real Dev data versus TEST actions

Real reads: current account, existing personal/work numbers, saved forwarding/
contact phone separately, owned cards, call/task history and saved transcripts/
summaries. Card edits write the existing cards, not a duplicate directory.
Work-card permissions update only the owned Work number's cardIds; enabled,
timezone and routing remain unchanged. A shared card is not disclosure consent.

Voice input is an explicit microphone action for a task instruction. It uses
the existing OpenAI `gpt-4o-transcribe` chain without a forced language, does not
store audio on the server, and does not create a call recording. Native capture
and microphone cleanup still need device verification. Preparation reuses the
existing Secretary preparation model `gpt-5.6-sol`, in a separate conversation
namespace, not the lab's active conversation. No fallback is added.

Live Secretary settings are read from the server's selected direct OpenAI chain:
`gpt-live-1`, `marin`, reasoning model `gpt-6.1-sol`. TEST transitions do not claim
to exercise that voice model. No ElevenLabs/Cartesia/Retell selector is exposed.

The new table `mobile_secretary_dev` holds only scoped sessions, browser
authorization handoffs and TEST state. TEST rows never enter `secretary_tasks`,
the real worker, dialer or notification path. Review is immutable and expires
after ten minutes. The owner+clientRequestId key is unique; conflicting retry
contents fail. A SQL conditional transition admits only prepared → completed
or cancelled. Repeated confirmation returns the same state. TEST completion
explicitly says no call/conversation occurred; no fake transcript is generated.
Transport methods are not dependencies of this router.

Technical Dev state expires after 24 hours; expired rows are deleted at startup
and hourly while running. Browser handoffs expire after five minutes. These
technical lifetimes are **not approved retention rules for customer history**.
Product retention, legal documents and consent work remain separate roadmap
gates. No Terms acceptance, recording consent or activation is fabricated.

## Calendar

The client calls the existing personal Google OAuth service, not the workspace
connector. OAuth consent starts inside the system browser with the existing
browser-bound cookie, only after the same TalkHint owner explicitly approves.
The existing Calendar callback saves the grant; users return to the app and
refresh. An unconfigured OAuth service fails explicitly.

The existing service grants calendar-list read and free/busy scopes, permits
selection of an owned secondary Work calendar, and refuses primary/shared
calendars. The app must not label this as selecting personal+work calendars
generally. Multi-calendar conflict checking is not implemented in that service.
Booking/reschedule/cancellation are unavailable; no calendar writes are added.
Outlook/iCloud/Cal.com are unsupported, not fictitiously connected.

## Native and release boundaries

Independent iOS bundle ID/Android package and URL scheme are in app.json.
EAS development/preview profiles are configuration only: no paid build or store
submission was run. Apple/Google signing, actual iPhone/Android development
builds, permission behavior and background/foreground recovery remain device
proof, not evidence obtained from web export.

No Twilio Voice SDK, CallKit, PushKit, Telecom, FCM or APNs integration is added.
The app sets tasks and displays records; the AI telephone session stays on the
server. No push/SMS/email/Calendar write/payment/call is sent by TEST actions.

## Reproducible checks

- Root: `npm run check`.
- Client: `cd apps/secretary-mobile && npm run typecheck && npm run export:web`.
- API/unit safety: `npx vitest run server/mobileSecretary/routes.test.ts server/communications/safety.test.ts`.
- Real Dev HTTP/DB proof:
  `NODE_ENV=development npx tsx server/mobileSecretary/devSmoke.ts`.
  Creates two temporary synthetic accounts/cards, verifies login/refresh/logout,
  owner isolation, edits, Unicode, exact review, concurrent/repeated confirmation,
  durable retrieval, legacy-token refusal, then removes all fixtures. It neither
  assigns numbers nor creates production Secretary tasks.
- Regression suites must also cover admin boundary, Secretary preparation,
  existing task/confirmation/early callbacks, owner Calendar and communications.

No production or native live-phone behavior is certified by these checks.

### Verification result — 22 October 2026

- Root TypeScript and standalone client TypeScript passed.
- Full root test suite: **1803 passed, 9 skipped** (152 passed files, one skipped).
  Five additional saved-history content tests passed after the final history
  review: call-only, missing linked report, different linked content, deduplication
  and task-only/missing content. Call text is rendered independently of task
  reports, with copy controls for each available source.
- **27 real Dev HTTP/PostgreSQL checks passed**; temporary accounts/cards and
  scoped sessions/TEST rows were removed. Six concurrent confirmations yielded
  one TEST row and zero real Secretary tasks.
- Expo web export passed; mobile-width screenshot at 402×874 shows a working,
  non-overflowing sign-in page. Signed-in screens were checked through source/
  API coverage, not a signed-in screenshot.
- Offline `npm run build:prepare` passed, including MCP bundle inclusion; the
  normal production pre-publish probe was not run or bypassed for publication.
- No physical iPhone/Android, actual owner Google authorization, live microphone
  or voice-model conversation was verified in this work.
