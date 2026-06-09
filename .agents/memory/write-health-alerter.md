---
name: Write-health alerter conventions
description: Invariants for server/writeHealthAlerter.ts (per-table DB write-failure alerts + recovery all-clear)
---
The background poller (`checkWriteHealthOnce`) watches `getWriteHealth()` per table and pushes Twilio SMS + loud logs on failure, plus a single "recovered" all-clear when a previously-alerting table is healthy again.

**Conventions to keep consistent (e.g. when adding email alerts or more tables):**
- `checkWriteHealthOnce` return value counts ONLY failure alerts actually sent — recoveries and throttled/suppressed alerts are NOT counted. Existing tests assert this.
- Recovery requires *new* `writeSuccesses` since the alert, not merely the absence of new failures. A table with stalled writes (no new successes) must not be declared recovered.
- Only a table that actually *sent* an alert (`alerting=true`) can recover; a throttled/never-sent rise must not later produce a phantom all-clear.
- Recovery is debounced via `healthySince` over `recoveryWindowMs()` (defaults to the alert `cooldownMs()`); any new failure mid-window resets `healthySince` so a flap can't spam alert/recover/alert.

**Why:** on-call had no positive confirmation writes were healthy again after an outage/drift fix and had to manually re-poll /api/health.

**How to apply:** `WriteHealth` (in storage.ts) only tracks cumulative counters + lastError — there is no per-success timestamp, so "sustained healthy" is inferred from new successes + a wall-clock window held in the alerter's own state, not from storage.
