---
name: ChatGPT widget recovery boundary
description: Host widget persistence is only a locator; historical tool output must not bypass current owner authorization.
---

Treat ChatGPT widget state and replayed tool output as untrusted task locators,
not durable business state or evidence of current account access. Persist only
the versioned task ID. Re-fetch the existing task using the host's current
connection before displaying private results; reacquire monitor permission
separately and never auto-resume audio.

**Why:** OpenAI documents widget state as optional and instance-scoped, not
cross-session storage. A conversation may outlive the OAuth account that
originally produced its tool results. The user requires recovery without a new
prepare/dial and without persisting OAuth or approval capabilities.

**How to apply:** Preserve the read-only get_task recovery path when changing
the widget or tool metadata. Clear private output and invalidate pending work on
background/revocation. Do not promise invisible-account-change notification or
real iPhone retention from local mocks; official-host verification is separate.
