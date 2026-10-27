---
name: Process on-call notifications
description: Owner expects immediate email on broken or missing process transitions; coverage must be explicit.
---

When a required process event/action fails or does not happen, the owner wants
the process on-call to notify him immediately by email.

**Why:** the owner explicitly requested a duty watcher for the process “green line”,
not silent failures that require manually checking for a report.

**How to apply:** distinguish deterministic operational monitoring from AI QA and
owner acceptance. Say which processes actually have instrumentation; do not
claim company-wide coverage from a Hint-only watcher. Deliberate pause is not an
incident. A same-server/same-mailbox watcher cannot guarantee notification when
the server, database or mail channel itself is down. Never mark these unknown
conditions green or blindly resend ambiguous mail.
