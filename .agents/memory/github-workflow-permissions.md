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
