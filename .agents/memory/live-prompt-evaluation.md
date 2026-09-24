---
name: LIVE prompt evaluation boundaries
description: How to distinguish a real LIVE prompt comparison from benchmark or historical-call claims.
---

Compare the actual assembled system AND user messages with the LIVE request settings and evaluate normalized output as well as raw text.

**Why:** the final user instruction can contradict system priorities; benchmark envelopes are not necessarily the phone envelope, and preamble removal can erase an otherwise useful natural reply. A prompt-only success is not proof of delivery through the call pipeline.

**How to apply:** capture baseline before editing. Label historical reconstructions explicitly when original request context was not saved; do not invent missing profile or strategy memory. Preserve failed candidates. Single sampled replies establish only observed turn-level behavior, not reliability or completion of a whole conversation.