---
name: Web has no call history view
description: Where call history is (and isn't) rendered across the TalkHint frontends.
---
Only the iOS app renders call history (CallHistoryViewController / CallDetailViewController consuming `/api/calls`). The web `/app` (talkhint/ui) has a Contacts list and the live-call UI but NO call-history list/detail. The React client (client/) has no call history either.

**Why:** Task #73 ("show saved caller names in call history") listed talkhint/ui as in-scope, but there was nothing to edit there — the server `/api/calls` enrichment + iOS display were the only applicable changes.

**How to apply:** Any task touching "call history" in the web frontend must first build the view; don't assume one exists. The server `/api/calls` and `/api/calls/:id` already return a `contactName` field ready for a future web view.
