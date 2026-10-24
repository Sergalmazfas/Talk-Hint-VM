---
name: Diagnostic recording consent boundary
description: Administrative diagnostic capability is not consent; unverified recording must stay blocked.
---

# Diagnostic recording scope

An administrative diagnostic flag is not participant consent. Unverified participant consent, disclosure, purpose or retention must block new audio recording without blocking the underlying voice call. No global environment switch may bypass this boundary.

**Why:** On 2026-10-22 the owner explicitly superseded the earlier silent-diagnostic rule with a requirement for verified grounds and fail-closed recording; administrative authority alone is insufficient.

**How to apply:** Capability remains necessary but never sufficient. Future consent work must cover participants and the specific recording, not infer consent from SMS, Google login, card permissions or a call-start approval. Preserve historical data unless separately instructed.