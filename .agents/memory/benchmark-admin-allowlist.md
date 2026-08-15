---
name: Benchmark admin allowlist
description: How admin identity is derived for benchmark/admin UI and why the owner's account wasn't admin
---
Admin identity for benchmark endpoints and the «Админка» links = email allowlist in `server/benchmark/adminGate.ts`:
- `ADMIN_PROVISION_USER` secret (JSON with email; also carries password for provisioning — do not edit it just to grant admin), PLUS
- `BENCHMARK_ADMIN_EMAILS` shared env var (comma-separated plain emails; `sergalmazfas@gmail.com` added 2026-08-15).

**Why:** the owner's real account is not the provisioned service account (leo@talkhint.app), so publishes appeared "broken" — the admin UI was simply hidden for a non-allowlisted email.
**How to apply:** to grant/revoke admin, edit `BENCHMARK_ADMIN_EMAILS` (shared) and republish for production. Never diagnose a "missing admin UI after publish" without first checking the allowlist vs. the logged-in email.
