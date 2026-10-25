# Shared Secretary default — server / ChatGPT / Swift

Prepared 2026-10-24. This is a new coordinated server/native change, not proof of
a real phone conversation or successful ChatGPT-host rendering.

## Release behavior

- The explicit approved owner/line IDs in
  `server/secretary/personalities/defaults.ts` were verified against production
  using read-only queries. No suffix matching, guessing an account or global
  default assignment is used at runtime.
- Publish adds the non-destructive `secretary_outgoing_defaults` table through
  the existing schema flow. The production database has NOT been manually
  changed by this work.
- On startup, an awaited transaction verifies that the approved personal line
  still belongs to the approved owner; it releases the canonical Katya v2
  catalog seed, and inserts missing owner/number assignment, outgoing settings
  and default provider. The immutable version is checked for conflicts.
- All inserts are idempotent and preserve existing settings, newer catalog
  edits and subsequent personality choices. No other owner receives an
  assignment. Selected cards are NOT imported from Dev; missing outgoing card
  permissions start empty. To expose owner facts, explicitly select the
  permitted personal cards in Secretary settings.
- Both consumers use the same catalog, assignments, outgoing context and real
  Engine. Retell / Merritt, `gpt-6.1-sol`, `medium`; no clone or fallback.
- Catalog/settings API is available behind normal owner authentication in
  production. This does not enable Dev labs or personal incoming Secretary.
- No incoming Twilio route changes are part of this release.

## ChatGPT

- Existing OAuth/MCP and separate Actions share the same backend.
- Account defaults are resolved before issuing the signed call confirmation;
  older cached model arguments cannot replace an account's configured default
  with GPT. For accounts without a configured default, legacy behavior remains.
- Confirmation pins number ID, provider, public personality label/version and
  a digest of the complete permitted context. Full rules/cards are not placed
  in signed tokens/model-visible preview content.
- At approved start, context is re-created and its digest checked. Changed or
  revoked facts/permissions/personality require a new owner review; no call.
- Existing grant/scope checks, UI-only per-call capability, explicit owner
  decision and durable task/dial lease remain mandatory. A chat "yes" cannot
  start a call. Repeated requests recover the same attempt, never redial.
- MCP version 1.7.0, widget v6. Exact v1–v5 resource URIs remain readable and serve the current, non-monitoring UI.
  After publishing, refresh/reconnect TalkHint metadata in ChatGPT if it retains
  an older descriptor. A new scope, if absent from an old grant, still requires
  owner consent. We do NOT silently enable write scopes.
- Actual rendering and approval in the official ChatGPT client must be checked
  by the owner. Server mocks do not prove host/iPhone support. Do not replace a
  missing inline card with fabricated approval.

## Swift / Claude handoff

The new Swift changes are NOT automatically present in the previous Xcode
branch until explicitly transferred. Do not tell Claude to build an old SHA
and claim it contains them. Current work has not been pushed.

Files to transfer together:
- Networking/SecretaryPersonalityAPI.swift — optional account default.
- UI/SecretaryViewController.swift — resolve missing outgoing line from that
  owner's server default; preserve explicit selection and existing drafts.
- UI/HomeViewController.swift — use server default before new-call review,
  never when recovering an attempted request.
- UI/SecretaryPersonalityViewController.swift — prefer account default when
  there is no existing selection.

Continue using the existing TalkHint project and TalkHintValidation /
NativeValidation for isolated tests; fixture URL remains `.invalid`.
Run native validation after merging the new source, not only the old test fix.
Then build TalkHint / Debug with existing signing, on iPhone:
`TALKHINT_API_BASE_URL=https://talkhint.app`.
Verify effective origin before login; the owner enters credentials.

After the SERVER release is confirmed ready, open Secretary settings: personal
line, Katya v2, Retell + Engine. Explicitly review personal-card permissions.
Prepare a NEW assignment: verify destination, outgoing line, character/version,
Merritt, gpt-6.1-sol/medium, production. Stop before Call/Start in automation.

Only the owner subsequently approves a real call. Verify both audio sides,
transcript, ending by each party and reopened history without a second dial.
Nothing here proves phone audio by simulator tests.

## Release sequence

1. Complete server/unit/build checks and non-destructive schema-diff review.
2. Owner publishes this NEW server change (the prior successful publish does
   not contain it); verify catalog/default binding under owner auth.
3. With separate permission, transfer the coordinated Swift changes to the
   existing Xcode branch; Claude runs tests and builds/installs on the Mac.
4. Owner reviews a new ChatGPT preview and native preview; only then approves
   a real phone test. No automatic calls, notifications or calendar actions.
