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

An owner-authorized repeat of a saved live call is a separately versioned manual
trigger, even when it actually executes CrewAI. Preserve the failed original,
label both source and execution environments, and reserve the single pass before
the model request. A saved letter must not be described as sent.

**Why:** the owner allowed one diagnostic repeat of a failed live-call analysis;
that permission is not permission for automatic historical replays or blind mail
resubmission.

**How to apply:** use the existing private lab store for the separate result;
do not overwrite the production baseline or turn the manual result into evidence
that the production pipeline has been repaired.

Cross-environment manual reviews need a lifecycle distinct from native calls,
not just an enabled/disabled switch.

**Why:** native orphan cleanup can remove a diagnostic reservation while the
manually triggered analysis is still running, because its source call exists
only in the other environment. A missing reservation must never permit a second
paid pass.

**How to apply:** mark the manual review explicitly, exclude it from automatic
claim/recovery, retain the existing diagnostic TTLs, and verify the saved result
instead of trusting an UPDATE that affected zero rows. Never fabricate a Dev
phone call to satisfy the cleanup.
