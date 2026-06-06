---
name: Call-history recording lifecycle
description: Where call records are created/updated and why outbound final-status is unreliable
---

# Call-history (`calls` table) recording

Records for real calls are created in `/twilio/voice` (incoming: when the number's
owner is found; outgoing: when `From` is `client:user-{id}`) and their final
status/`endedAt` are stamped by the `/twilio/status` callback (looked up by
`callSid`). Creation is guarded by a `getCallByCallSid` existence check so webhook
retries don't duplicate.

**Why:** `storage.createCall` was never invoked in the voice flow, so the iOS
History tab (`GET /api/calls`) was effectively always empty.

**How to apply / caveat:** Twilio `statusCallback` is configured at the
phone-number level (see `twilioService.ts`, derived `/twilio/voice`→`/twilio/status`).
It fires reliably for INBOUND calls to our numbers, but a browser/iOS-originated
OUTBOUND call's parent leg goes through the TwiML app, so its terminal status may
never reach `/twilio/status` — outbound records can stay `status:"active"` with no
`endedAt`. If reliable outbound final-status is needed, set `statusCallback` on the
outbound `<Dial>`/REST call explicitly rather than relying on number config.

`GET /api/calls` and `/api/calls/:id` are now `authMiddleware`-scoped to the
caller (`getUserCalls`, plus `userId` ownership check returning 404). The iOS
client-side filter is now redundant defense-in-depth.
