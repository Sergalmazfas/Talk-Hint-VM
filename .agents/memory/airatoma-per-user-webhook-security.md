---
name: AirAtoma per-user webhook security
description: How the shared secret and SSRF guard work when AirAtoma webhook URLs are user-configurable.
---

# AirAtoma per-user webhook security

AirAtoma webhook URL is **strictly per-user** (`users.airatomaWebhookUrl`). There is
**no server-wide env fallback** in the live delivery path: `deliverCallToAirAtoma`
uses `input.targetUrl` only and `processDueAirAtomaDeliveries` uses `row.targetUrl`
only — a user with no personal URL simply doesn't deliver. Each delivery row stores
its own `target_url` (captured at enqueue, reused on retry).
**Why removed:** with a global `AIRATOMA_WEBHOOK_URL` fallback, a new user who hadn't
set their own URL would have their call transcripts leak to the operator's global CRM
endpoint — unacceptable for multi-user onboarding. Auth is the per-account token in
the URL path (e.g. `…/api/talkhint/webhook/<token>`), so no shared secret is needed.
The low-level `attemptAirAtomaPost` primitive + legacy `sendCallToAirAtoma` still read
the env var (kept for their unit tests), but neither is on the per-user routing path.

Two security invariants must hold whenever this surface changes:

1. **Never send the shared `x-talkhint-secret` to a user-supplied URL.** The secret
   is attached only when the destination equals `process.env.AIRATOMA_WEBHOOK_URL`
   (the operator-configured endpoint). Since the live path no longer routes to the
   env URL, the secret is effectively never sent — but keep the gate intact.
   **Why:** otherwise any authed user could set their URL to a server they control
   and harvest the global secret. There is no per-user secret by design.

2. **SSRF guard rejects internal destinations before persistence.**
   `validateUserWebhookUrl()` (enforced in `POST /api/settings/airatoma`) rejects
   non-http(s), embedded credentials, IPv4 private/loopback/link-local/metadata/
   reserved ranges, and **all IPv6 literals** (any host containing `:`).
   **Why:** blocking all IPv6 literals cleanly covers ::1, fe80::/10, fc00::/7,
   ::ffff:x.x.x.x without fragile parsing of Node's normalized IPv6 text; real
   AirAtoma endpoints use hostnames.
   **Residual risk:** DNS rebinding (public name → private IP) is NOT mitigated by
   literal checks. If you ever need that, add resolve-time IP checks in the send path.

**How to apply:** if you touch `attemptAirAtomaPost` headers, the settings route, or
add another user-configurable outbound URL, re-verify both invariants and keep the
secret-gating + SSRF tests in `server/__tests__/airatomaWebhook.test.ts` green.
