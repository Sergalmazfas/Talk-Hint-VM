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

**Stripe — RESOLVED (TEST mode).** All three secrets must be the SAME Stripe mode or checkout fails: STRIPE_SECRET_KEY (sk_…), STRIPE_PUBLISHABLE_KEY (pk_…), STRIPE_WEBHOOK_SECRET (whsec_). Final working state = TEST: sk_test_ + pk_test_ + whsec_ (acct_…X819XSmSSrj3, US, charges enabled, product "TalkHint-Monthly Subscription" exists).
**Why:** user repeatedly pasted mode-mismatched or restricted keys. Two recurring mistakes: (1) copying a key while the dashboard "Test mode" toggle was OFF yields a LIVE pk_live_/sk_live_; (2) creating a key under "Restricted keys" yields rk_… (won't authenticate as the standard key). Always use the "Standard keys" block, and confirm the Test-mode toggle matches the intended mode.
**How to apply:** verify keys with a temp node script (process.env is NOT readable in the code_execution sandbox) — check prefixes (sk_test_/pk_test_/whsec_), assert sk/pk modes match, and call stripe.accounts.retrieve() to live-validate the secret key. whsec_ can only be format-checked, not live-validated.
