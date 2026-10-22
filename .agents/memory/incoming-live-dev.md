---
name: Incoming Live comparison boundary
description: Why GPT-Live uses its own Dev transport but the same protected intake workflow.
---

GPT-Live is an explicitly selected incoming microphone Dev comparison, not an automatic replacement of telephone Secretary. Keep Realtime available for fair comparison and keep phone activation separate.

**Why:** The owner asked to try a different conversation model without changing existing telephony or production.

Use the native Live protocol, not renamed Realtime events. Voice conversation and delegated backend work have independent lifecycles; caller interruption must not cancel or repeat a saved business action.

**Why:** Live is full duplex and delegates reasoning separately. Realtime's response IDs, truncate commands and tool-continuation assumptions are not its protocol.

**How to apply:** Reuse owner-approved Work facts, intake validation and isolated TEST persistence, not the Realtime event coordinator. Expose both voice and backend identities, disable provider audio storage, never silently substitute an unavailable model, and test actual provider dialogue as well as mocks.
