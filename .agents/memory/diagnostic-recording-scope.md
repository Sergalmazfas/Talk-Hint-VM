---
name: Diagnostic recording consent boundary
description: Administrative diagnostic capability is not consent; unverified recording must stay blocked.
---

# Diagnostic recording scope

An administrative diagnostic flag is not participant consent. Unverified participant consent, disclosure, purpose or retention must block new audio recording without blocking the underlying voice call. No global environment switch may bypass this boundary.

**Why:** On 2026-10-22 the owner explicitly superseded the earlier silent-diagnostic rule with a requirement for verified grounds and fail-closed recording; administrative authority alone is insufficient.

**How to apply:** Capability remains necessary but never sufficient. Future consent work must cover participants and the specific recording, not infer consent from SMS, Google login, card permissions or a call-start approval. Preserve historical data unless separately instructed.

## Owner's laboratory direction

Owner requirement: «Должны все разговоры записываться у меня на телефоне».

**Why:** the owner stated the intended product behaviour, not that this
capability already works.

**How to apply:** distinguish audio available to play in the iPhone app from a
local offline audio copy before scoping implementation. This does not override
the participant-consent boundary above.

The owner wants his own test calls to supply audio to the corresponding Hint
and Translator laboratories, beginning with Hint, rather than enabling
recording for ordinary product users. He requested no spoken announcement
for his controlled test contacts.

**Why:** transcript-only review cannot establish acoustic recognition errors or
replay the full timing pipeline.

**How to apply:** treat this as requested laboratory scope, not an already
working recording route or evidence of each other participant's agreement.
Keep participant grounds, access and retention explicit before activation.

## Approved historical benchmark cohort

The owner permitted internal laboratory reuse of the existing 36 recorded-call
benchmark fixtures. Do not export the audio or copy conversation text into
reports. This does not authorize new calls or new recording.

**Why:** the owner explicitly approved this historical cohort for repairing the
Hint benchmark, then requested automatic channel-local VAD and a 2–3-recording
spot check.

**How to apply:** retain the frozen source and human-verification flags.
VAD identifies acoustic regions, not transcript-to-audio alignment; never assign
reference sentences to regions merely by count/order or promote automatic
boundaries to human-verified ground truth.