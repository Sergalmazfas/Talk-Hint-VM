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

The Contents API can return 404 for a workflow write even when ordinary tree,
commit and branch writes succeed and the account has repository admin access.
Requested OAuth scopes are not proof of granted scopes.

**Why:** the live credential lacked `workflow`, while reauthorization metadata
listed it among requested scopes and still reported `canReconnect: false`.
The attached source-control connector also had no generic `listConnections`
entry, although the already authenticated `gh` client worked.

**How to apply:** inspect granted scope names, not credentials; do not diagnose
this as a missing repository or repeatedly attach the connector. Never promise
that an unavailable reconnect card will fix it. A blocked workflow upload means
no native check ran, even if the isolated candidate branch was created.

The owner's standing native delivery procedure is maintained in `replit.md`,
section «iOS: передача сборки на Mac»; consult it before any iOS delivery.

Preserve unrelated changes from the existing Mac baseline when transferring a
native delta; do not synchronize the full development tree.

**Why:** an earlier local baseline lacked a Mac-side asynchronous UI-test fix.
Copying the entire local native tree would have overwritten that unrelated fix.

**How to apply:** verify the live remote baseline and compare affected files
against the delta's parent before preparing an additive delivery.
