---
name: Twilio auth token vs SID mis-paste
description: Why TWILIO_AUTH_TOKEN kept causing 401 code 20003, and how to verify the right value
---

# Twilio credential gotcha (account TH-NUM-1 / AC723e505a)

The app's active Twilio account is the subaccount **TH-NUM-1** (SID starts `AC723e505a`, status active, caller id +19543200848).

**Symptom:** Twilio REST 401 `code 20003 Authenticate`.

**Root cause:** `TWILIO_AUTH_TOKEN` repeatedly held the wrong value — a 34-char string starting `AC` (that's an Account **SID**, not a token) or a 65-char paste. The console shows "Account SID" and "Auth Token" right next to each other, so the SID gets copied by mistake.

**Correct shape:** the real auth token is **32 chars and does NOT start with `AC`**.

**Why it matters beyond REST:** `validateTwilioSignature` (server/routes.ts) uses `TWILIO_AUTH_TOKEN` for `twilio.validateRequest`, and in production the signature check is force-enabled (cannot be disabled). So the correct auth token — not just API key/secret — is required for prod inbound webhooks.

**How to verify a pasted token (no secret printed):** run a temp `.mjs` with `node` (process.env is NOT readable in the code_execution sandbox), check `len`/`startsWith('AC')`, then `twilio(sid, tok).api.v2010.accounts(sid).fetch()` — OK means valid.

**Fallback that also works:** `TWILIO_API_KEY` (SK…, 34) + `TWILIO_API_SECRET` (32) authenticate for this account via `twilio(key, sec, {accountSid: sid})` for REST, but they CANNOT fetch the Account resource and do NOT satisfy signature validation — so the auth token is still the real fix.
