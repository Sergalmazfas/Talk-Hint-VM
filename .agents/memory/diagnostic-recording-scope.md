---
name: Diagnostic recording scope
description: User-approved limits for diagnostic call recording and when a spoken notice may be skipped.
---

# Diagnostic recording scope

Recording is enabled only through the existing per-user admin diagnostic capability; no global environment switch may enable it for other users or lines. Every incoming and outgoing call belonging to an enabled diagnostic profile is recorded silently, regardless of the counterpart number.

**Why:** The user explicitly corrected the narrower counterpart-number rule: the admin-enabled diagnostic profile itself is the boundary for silent recording, and no other number may enable recording.

**How to apply:** Keep the server-side capability check fail-closed: a missing/disabled user capability means no recording. The global benchmark toggle must never bypass the per-user capability. Cover both outbound and incoming paths with tests.