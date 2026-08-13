---
name: Tutor Engine contract testing
description: Durable policy for freezing/verifying the Tutor Engine public API contract
---
- Source of truth = Engine's published contract; TalkHint keeps only a consumer copy (contract doc + frozen fixtures) — update FROM the Engine contract, never invent shapes.
- Two verification layers: offline frozen-fixture tests in the normal suite, plus a live probe run manually before every publish (deliberately outside vitest; no CI scheduling in v1).
- **Why:** the Engine renamed its hint event once without notice and broke prod hints; protocol drift must fail loudly before publish.
- **No silent alias success:** each event has ONE canonical name; legacy aliases may render during migration but the live probe fails if only the legacy name arrives, and field validation is name-specific (no cross-shape acceptance).
- **How to apply:** live probes must bound every network phase, assert exact HTTP status codes, and treat cleanup/session-completion failure as a contract failure; probes check protocol only — never wording or teaching quality.
