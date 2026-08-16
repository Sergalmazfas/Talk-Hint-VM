---
name: Local prod-boot testing side effects
description: Running dist/index.cjs locally with NODE_ENV=production mutates real Twilio webhooks — how to test safely.
---

Rule: never boot the production build locally without `DISABLE_AUTO_WEBHOOK_REPOINT=true`.

**Why:** production startup runs repointWebhooksOnStartup, which reconfigures ALL Twilio pool numbers' voice webhooks to the resolved base URL — locally that resolves to the `.replit.dev` dev domain, silently hijacking live inbound calls. Happened once during a publish-failure debug; had to immediately repoint all 7 numbers back to https://talkhint.app via a tsx one-off (set PRODUCTION_URL, await dbReady from server/db before calling repoint).

**How to apply:** local prod smoke test = `DISABLE_AUTO_WEBHOOK_REPOINT=true NODE_ENV=production PORT=<free> node dist/index.cjs`, then curl `/` for the 200 readiness check (same probe the deployer uses).

Also learned: a publish failing at "Waiting for deployment to be ready" with ZERO runtime logs, while the build phase passed and the local prod boot serves 200 on `/`, is a platform-side promote failure — retry publish; the live site keeps serving the previous successful build.
