---
name: /ui WebSocket per-user routing
description: Live call transcripts/hints must be scoped to the owning user, never globally broadcast.
---

The `/ui` (and legacy `/honor-stream`) WebSocket carry live call transcripts and AI
hints. These channels MUST authenticate (session token query param `?token=`) and
deliver messages only to the owning user — never broadcast to every connected client.

**Why:** A global broadcast leaks one user's call content to all connected clients.
Code review rejected the first iOS-hint implementation for exactly this (optional auth
+ global `uiBroadcast`).

**How to apply:**
- Auth is enforced at the HTTP upgrade for `/ui`/`/honor-stream` (missing/invalid token
  -> 401, fail-closed). Twilio media channels (`/twilio-stream`, `/media`) are NOT
  user-authenticated (machine-to-machine).
- Each `/ui` socket is bound to its userId; routing goes through `sendToUser(userId, msg)`
  which fails closed (drops, never broadcasts) when the owner is unknown.
- A call's owner is resolved via the `callOwners` map (callSid -> userId), populated by
  `setCallOwner` in `/api/call/accept` (accept always precedes the Twilio media stream),
  with a `pendingCalls` DB fallback on the stream `start` event. Cleared on reject and
  stream close.
- EVERY call origination path must register an owner, or `sendToUser` silently drops all
  its transcripts/hints fail-closed (empty screen, no error). Incoming calls register via
  `pendingCalls` + accept; **browser OUTBOUND calls must call `setCallOwner(callSid, userId)`
  directly in the `/twilio/voice` `client:user-{id}` branch** — they have no accept step and
  no pendingCalls row, so this is the only owner source. This bit us in prod: outbound calls
  worked end-to-end (Deepgram/GPT ran) but showed nothing because the stream had no owner.
- `client:line_X` (line-based) outbound calls remain intentionally unowned — `/ui` auth needs
  a real `session.userId`; line sessions have none. Live hints don't route for line identity.
- Each handler shadows `uiBroadcast` with a local that routes to its user, so existing
  broadcast call-sites need no change as long as they stay inside the handler.
- Global `currentGoal`/`currentMode`/`currentLanguage` remain process-wide (pre-existing
  multi-tenancy limitation, out of scope).
- Any new browser/native client must append `?token=` (web UI does this in `getWSUrl`).
