---
name: GitHub workflow push permissions
description: Distinguish Replit's generic push rejection from GitHub workflow authorization failures.
---

When Replit reports PUSH_REJECTED, capture an ordinary push's exact remote
response before assuming diverged history. A successful dry run does not prove
that GitHub will accept the objects and update the branch.

**Why:** GitHub rejected a native iOS CI workflow because Replit's OAuth
authorization lacked the `workflow` scope, despite a fast-forward branch and
successful dry run.

**How to apply:** Fix the GitHub credential's workflow-write permission through
approved authorization. Do not pull, force-push, delete CI, or rewrite commits
to work around this permission error. The YAML job's `permissions` setting
does not grant the uploading credential permission to modify workflow files.

For an explicitly requested Mac/iOS handoff, reuse the existing Xcode delivery
baseline and create a separate native-only branch with the reviewed iOS delta
and instructions. Preserve every unrelated file and the baseline workflow tree.
This does not synchronize the full development branch or fix its OAuth scope.

**Why:** the owner uses Claude on a Mac to receive isolated native deliveries;
this established route succeeded while a full development push was rejected.

**How to apply:** locate the previous handoff document and verify the live remote
baseline first. Compare affected native files against the delta's parent to
avoid overwriting Mac fixes. Use an additive commit/new branch, no force or
history rewrite; verify the remote SHA after push. Keep backend, database and
production operations out of the Mac instructions.
