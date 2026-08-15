---
name: Benchmark admin allowlist
description: How admin identity is derived for benchmark/admin UI and why the owner's account wasn't admin
---
Admin identity for benchmark endpoints and the «Админка» links = SOLELY the `BENCHMARK_ADMIN_EMAILS` shared env var (comma-separated plain emails). Owner decided 2026-08-15: only `sergalmazfas@gmail.com` is admin; `ADMIN_PROVISION_USER` (leo@talkhint.app service account) grants NO admin anymore.

**Why:** the owner's real account is not the provisioned service account (leo@talkhint.app), so publishes appeared "broken" — the admin UI was simply hidden for a non-allowlisted email.
**How to apply:** to grant/revoke admin, edit `BENCHMARK_ADMIN_EMAILS` (shared) and republish for production. Never diagnose a "missing admin UI after publish" without first checking the allowlist vs. the logged-in email.
