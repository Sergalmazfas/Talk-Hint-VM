---
name: Tutor Engine contract testing
description: Durable policy for freezing/verifying the Tutor Engine public API contract
---
- Source of truth = Engine's published contract; TalkHint keeps only a consumer copy (contract doc + frozen fixtures) — update FROM the Engine contract, never invent shapes.
- Two verification layers: offline frozen-fixture tests in the normal suite, plus a live probe run manually before every publish (deliberately outside vitest; no CI scheduling in v1).
- **Why:** the Engine renamed its hint event once without notice and broke prod hints; protocol drift must fail loudly before publish.
- **Contract v1 aligned (2026-08-13):** published doc copy lives at docs/tutor-engine-public-contract-v1.md; `tutor.hint {hint,mode}` (teaching hint) and `tutor.suggested_reply {text,translation|null,carryover}` are TWO DISTINCT stable events, never aliases — the Engine emits no legacy aliases; field validation is name-specific AND fail-closed on required fields (missing mode/carryover/translation → frame ignored).
- **Version reporting:** GET /v1/capabilities (unauthenticated) is the authoritative handshake — returns engine_version + contract{name,version,major,hash} + realtime{protocol_version}; the live probe must require all these fields, pin major=1 + tutor-realtime/1.0, and print the Engine-reported version it validated against on every run.
- Engine contract doc is NOT reachable over HTTP (SPA fallback for unknown paths) — get it from the user/Engine project when it changes.
- **How to apply:** live probes must bound every network phase, assert exact HTTP status codes, and treat cleanup/session-completion failure as a contract failure; probes check protocol only — never wording or teaching quality.
