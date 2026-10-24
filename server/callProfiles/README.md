# General number onboarding

`POST /api/call-profiles/connect` accepts only `{choice: "frames" | "work" | "both"}`.
Frames uses the existing `personal` storage scope for compatibility; Work uses
`work`. There is no creator-specific number or owner in this public path.

The existing TalkHint subscription requirement remains. Each purpose can be
connected independently. Existing numbers, including legacy multiple numbers,
are returned intact and never removed/relabelled. Only missing purposes allocate.
An owner row lock serializes requests across app instances. Available pool rows
are locked with SKIP LOCKED and checked against actual phone-number bindings.
The two-number intent commits as one transaction, including default prompts.
Retrying after timeout or lost commit acknowledgement returns the same bindings.

Provider inspection is read-only, checks main-account voice routing and does not
purchase/replenish a number, repoint webhooks, enable AI or place a call.
The legacy `/api/numbers` and `/api/call-profiles/work-number` writes use the same
allocator. Keep the historical CDL migration helper out of this onboarding.

## Verification

`RUN_NUMBER_SETUP_DB_TESTS=1 npx vitest run server/callProfiles/assign.integration.test.ts`
creates and drops its own isolated schema in the Dev database, with synthetic
accounts and numbers and a fake provider. It never assigns real pool resources.
Do not run this against production.

Dev-only UI preview: `/settings/call-profiles?preview=1`.
All assignments in this preview are local synthetic state, never account writes.
The authenticated route uses the real API; do not exercise allocation with a
real account as an automated smoke test.
