---
name: Diagnostic recording scope
description: User-approved limits for diagnostic call recording and when a spoken notice may be skipped.
---

# Diagnostic recording scope

Recording is enabled only through the existing per-user admin diagnostic capability; no global environment switch may enable it for other users or lines. Silent recording is allowed only for that approved user's explicitly designated test phone number(s). Any other recorded diagnostic call must retain the spoken recording notice.

**Why:** The user tests only their own phones and explicitly approved no-notice recording for that narrow scenario, while requiring that no other number can enable recording.

**How to apply:** Keep the server-side checks fail-closed: missing user/number configuration means no silent recording. The global benchmark toggle must never bypass the per-user capability. Cover both outbound and incoming counterpart paths with tests.