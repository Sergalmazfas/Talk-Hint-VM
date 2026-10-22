---
name: Incoming Live comparison boundary
description: Why GPT-Live uses its own Dev transport but the same protected intake workflow.
---

The owner approved GPT-Live as the sole model for new Secretary calls after a successful microphone trial, then requested rollout preparation across incoming/outgoing, iOS and ChatGPT. Keep publication, native installation and incoming-number activation separate from implementation.

**Why:** The later successful trial superseded the comparison-only scope, but did not itself publish a server or activate a phone number.

Use the native Live protocol, not renamed Realtime events. Voice conversation and delegated backend work have independent lifecycles; caller interruption must not cancel or repeat a saved business action.

**Why:** Live is full duplex and delegates reasoning separately. Realtime's response IDs, truncate commands and tool-continuation assumptions are not its protocol.

**How to apply:** Reuse owner-approved Work facts, intake validation and isolated TEST persistence, not the Realtime event coordinator. Expose both voice and backend identities, disable provider audio storage, never silently substitute an unavailable model, and test actual provider dialogue as well as mocks.

The separate browser microphone bench must remain usable without assigning a telephone number. It is not the general phone-onboarding flow.

**Why:** The user explicitly requires independent bench access while the universal frames/work/both-number product is developed.

**How to apply:** Keep account ownership and explicit Work-card disclosure permissions, but never make a real number or phone activation a prerequisite for this Dev test.
