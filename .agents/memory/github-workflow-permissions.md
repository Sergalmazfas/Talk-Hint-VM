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
against the delta's parent before preparing an additive delivery. That comparison
alone is insufficient: the chosen baseline must also retain all previously
accepted Mac fixes, including files outside the new delta. Ask for the Mac
baseline and unpushed fixes before preparing another delivery when this is
uncertain. A clean remote branch can still be behind the accepted Mac lineage.
An unpushed Mac commit cannot be recovered merely from its hash; obtain the
original patch rather than reconstructing an allegedly identical fix.

**Why:** a Prepare-only delivery matched every changed remote file but omitted
both an earlier call-screen crash fix and a Secretary async test fix in untouched
files. Mac correctly stopped before building; its unavailable push authorization
had left the crash fix only in the local Mac checkout.

Preserving a historical patch exactly is not enough to prove its regression test
still matches the destination branch's approved behavior. Restore the fix, then
check the test's UX assumptions against current behavior; do not change product
behavior merely to satisfy an older test.

**Why:** the restored screen-load test also expected one-tap removal, while the
destination branch already supported collapse/expand. Native execution confirmed
the crash fix but rejected that unrelated historical UX expectation.

A matching source hash does not replace the full native gate on the delivered
HEAD. Keep later failures explicit even if an identical source tree passed
earlier; do not rerun until green or attribute unrelated failures to the delta
without diagnostics.

**Why:** a byte-identical transferred fixture passed its checks, but a clean
worktree full run exposed a cold-simulator presentation timeout in another test.

**How to apply:** separate source-transfer evidence from native execution
evidence. Preserve UI readiness assertions and diagnose the unmet conditions;
test-environment wait limits are not automatically product performance limits.
