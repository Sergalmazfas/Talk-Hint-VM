---
name: Secrets audit findings (Twilio / Stripe / VAPID / APNS)
description: State and gotchas of the project's third-party credentials as of mid-2026
---

# Secrets audit

**Twilio** — all good. ACCOUNT_SID (AC723e505a, subaccount TH-NUM-1), AUTH_TOKEN (32ch correct), API_KEY/SECRET valid, TWIML_APP "TalkHintTH_NUM_1" voiceUrl https://talkhint.app/twilio/voice, phone +19543200848 owned with that voiceUrl. See twilio-auth-token-gotcha.md.

**VAPID** — VAPID_PRIVATE_KEY ok (43ch base64url = 32 bytes, P-256). pushService.ts strips `=`/newlines before web-push.

**APNS (iOS VoIP)** — APNS_CERT_PEM / APNS_KEY_PEM contain the correct VoIP cert (CN "VoIP Services: app.talkhint", UID app.talkhint.voip, valid to Jul 2027) + matching RSA key, BUT the secret store stripped ALL newlines so they were single-line and failed OpenSSL parse ("no start line"). Fix: `normalizePem()` in iosPushChannel.ts rebuilds proper PEM at module load.
**Why:** env/secret stores routinely strip newlines from multi-line PEM blobs.
**How to apply:** any new code that loads a PEM from env must normalize it the same way — never `Buffer.from(process.env.X)` directly.

**Stripe — BROKEN / needs user action.** STRIPE_SECRET_KEY is **TEST** mode (sk_test_, live-validated: acct_…X819XSmSSrj3, US, charges enabled) but STRIPE_PUBLISHABLE_KEY is **LIVE** mode (pk_live_) → mode MISMATCH; checkout will fail. STRIPE_WEBHOOK_SECRET is **MISSING** (startup logs already warn). User must pick one mode and supply matching secret+publishable keys plus the whsec_ webhook secret for that mode. Stripe is manual mode (no Replit connector) — see replit.md.
