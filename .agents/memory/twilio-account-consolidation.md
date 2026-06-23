---
name: Twilio single-account consolidation (Variant A)
description: Why TalkHint pool numbers must all live on the MAIN Twilio account, not per-number subaccounts.
---

# Twilio single-account consolidation

All TalkHint pool numbers must live on the **main** Twilio account (SID begins `AC723e50…`), not on per-number subaccounts.

**Why:** The app is single-account by design. Two things silently break for any number that sits on a subaccount:
1. Inbound webhook signature validation uses only the main `TWILIO_AUTH_TOKEN`, so a subaccount-signed webhook fails the check (403).
2. Call bridging is account-scoped — the caller leg (subaccount) and the agent leg (main-account TwiML app) never share a conference, so audio never connects.
Result: only numbers already on the main account receive/route calls; distributed numbers appear dead.

**How to apply:**
- Moving a number: authenticate as the *source subaccount* (its SID+token, stored per-row in `available_numbers.subaccount_sid/token`) and call `incomingPhoneNumbers(sid).update({ accountSid: MAIN_SID })`. The number's SID and `voiceUrl` survive the transfer. The parent can also do it; subaccount-creds path is simplest.
- New pool numbers (`purchaseFloridaNumber` auto-restock when free pool < 3) are bought directly on the main account; `subaccount_sid/token` are stored NULL and `subaccount_name` is kept only as a TH-NUM-xxx label.
- `configureVoiceWebhook` retries on the main-account client if the subaccount client throws — needed because the **production** `available_numbers` rows can keep stale subaccount creds (prod DB is read-only via agent tooling, so those rows can't be nulled directly; dev DB was cleaned). The fallback keeps the startup webhook repoint working regardless.

**Gotcha:** prod DB data changes can't be made by the agent (read-only replica + Publish only syncs schema, not data). Don't rely on nulling prod `available_numbers` subaccount fields — make the code resilient to stale values instead.
