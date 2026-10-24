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
never reach `/twilio/status`. Fix: the outbound `<Dial>` in `/twilio/voice` sets
`action`→`/twilio/dial-status`, which fires on the PARENT/client leg (so its
`CallSid` matches the record) with `DialCallStatus` (answered→completed, plus
busy/no-answer/failed/canceled). That handler stamps final status + `endedAt`,
skipping records already terminal-stamped by `/twilio/status`. Don't rely on
number-level statusCallback for outbound end.

`GET /api/calls` and `/api/calls/:id` are now `authMiddleware`-scoped to the
caller (`getUserCalls`, plus `userId` ownership check returning 404). The iOS
client-side filter is now redundant defense-in-depth.

## Native monitoring is not the PSTN call lifetime

Closing or losing the native Secretary monitor does not establish that the
server-side phone call ended. Do not create a replacement call merely because
the iPhone UI disappeared.

**Why:** A reported immediate app exit coincided with a provider-confirmed
five-minute call; task creation and successful webhook HTTP responses alone
could not establish its final outcome.

**How to apply:** Recover the same task/request first and, when local state is
inconclusive, read the exact provider call's status, duration and end time.
Keep callback acceptance, application state and provider state distinct.
Check the installed Twilio MCP's actual capabilities: search/retrieve tools may
return API documentation rather than live call records. Use an authenticated
read-only SDK GET if needed, without logging credentials or contact details.
