---
name: Local prod-boot testing side effects
description: Running dist/index.cjs locally with NODE_ENV=production mutates real Twilio webhooks — how to test safely.
---

Rule: never boot the production build locally without `DISABLE_AUTO_WEBHOOK_REPOINT=true`.

**Why:** production startup runs repointWebhooksOnStartup, which reconfigures ALL Twilio pool numbers' voice webhooks to the resolved base URL — locally that resolves to the `.replit.dev` dev domain, silently hijacking live inbound calls. Happened once during a publish-failure debug; had to immediately repoint all 7 numbers back to https://talkhint.app via a tsx one-off (set PRODUCTION_URL, await dbReady from server/db before calling repoint).

**How to apply:** local prod smoke test = `DISABLE_AUTO_WEBHOOK_REPOINT=true NODE_ENV=production PORT=<free> node dist/index.cjs`, then curl `/` for the 200 readiness check (same probe the deployer uses).

## Distinguish build success from candidate startup

A publish can pass compilation and fail at "Waiting for deployment to be ready".
Missing candidate runtime logs alone do not prove a platform failure. A 200 from
the public site may be the previous successful release, not the failed candidate.

**Why:** Build logs and runtime logs are separate, and promotion can time out
without exposing the candidate's startup error. A successful local boot narrows
the cause but does not reproduce every production dependency or environment.

**How to apply:** Inspect the specific failed build and available runtime logs,
compare startup/config changes with the last successful release, and label an
unobserved candidate startup cause unknown. A bounded retry is reasonable after
checks pass; do not alter live phone routing or remove checks merely because
the readiness probe timed out.
