---
name: Hint lab release and baseline
description: Owner-approved separation of direct Dev fixes, historical baselines and live laboratory activation.
---

Small, reversible Hint fixes may be prepared directly by the engineer without
waiting for CrewAI acceptance. Keep diffs and verification; owner still publishes
the server and builds/releases iOS.

**Why:** the owner explicitly approved fixing the unreadable choice cards and
missing action-result help while the lab rollout was still incomplete.

**How to apply:** no mandatory crew round-trip for obvious bounded fixes, but do
not equate a successful build or one control call with independent QA acceptance.
For this rollout, the owner requires the laboratory to start paused after Publish
until its readiness is checked. Historical manual baselines must be labelled as
manual, never forged into fresh-call provenance or automatic CrewAI execution.
Hiding the Prepare opening manually is not evidence it was spoken.
