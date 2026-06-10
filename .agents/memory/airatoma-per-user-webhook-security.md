---
name: AirAtoma per-user webhook security
description: How the shared secret and SSRF guard work when AirAtoma webhook URLs are user-configurable.
---

# AirAtoma per-user webhook security

AirAtoma webhook URL is per-user (`users.airatomaWebhookUrl`), falling back to
`AIRATOMA_WEBHOOK_URL` env for single-tenant. Each delivery row stores its own
`target_url` (captured at enqueue, reused on retry). Two security invariants must
hold whenever this surface changes:

1. **Never send the shared `x-talkhint-secret` to a user-supplied URL.** The secret
   is attached only when the destination equals `process.env.AIRATOMA_WEBHOOK_URL`
   (the operator-configured endpoint).
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
