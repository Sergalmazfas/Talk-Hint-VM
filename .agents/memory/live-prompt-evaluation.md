---
name: LIVE prompt evaluation boundaries
description: How to distinguish a real LIVE prompt comparison from benchmark or historical-call claims.
---

Compare the actual assembled system AND user messages with the LIVE request settings and evaluate normalized output as well as raw text.

**Why:** the final user instruction can contradict system priorities; benchmark envelopes are not necessarily the phone envelope, and preamble removal can erase an otherwise useful natural reply. A prompt-only success is not proof of delivery through the call pipeline.

**How to apply:** capture baseline before editing. Label historical reconstructions explicitly when original request context was not saved; do not invent missing profile or strategy memory. Preserve failed candidates. Single sampled replies establish only observed turn-level behavior, not reliability or completion of a whole conversation.

Check the speaker and field of every judge citation, not merely whether its text
exists somewhere in the response. A Guest translation is not an Owner claim.
Negative past-action claims (“I haven't rebooted”) need evidence just like
positive claims; silence does not establish either answer.

**Why:** a separate judge can return complete valid JSON yet misattribute Guest
translations to Owner and approve an unsupported negative state. Independence
and format completeness alone do not establish semantic QA correctness.

**How to apply:** keep raw verdicts unchanged, reject wrong-speaker citations
explicitly, and report source-audit disagreements separately from model scores.