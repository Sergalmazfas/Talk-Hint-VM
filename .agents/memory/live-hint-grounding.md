---
name: Live hint grounding
description: Behavioral rules for live suggestions must cover every suggestion path, including LLM-bypassing fast paths.
---

**Rule:** live suggestions must never assert facts about the Owner or real-world state without a source, and any such behavioral rule must be enforced on EVERY path that can produce a suggestion — the main prompt builder, any secondary/legacy prompt assemblies, and non-LLM fast paths (canned/library lines need serve-time gating, since a prompt rule cannot reach them).

**Why:** a prompt-only fix looked complete but two live paths bypassed the main builder and the library fast path bypassed the LLM entirely; hints confidently asserted "still not working" and guessed the user's device.

**State precedence:** current explicit Owner statement > current call transcript > saved contexts/cards > older call state — stale contact memory must not pull suggestions back.

**How to apply:** when adding any new suggestion source, trace where its prompt (or canned content) comes from and wire the grounding rules or a serve-time gate into it, with tests against the real assembled output.
