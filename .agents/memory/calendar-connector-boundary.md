---
name: Calendar connector identity boundary
description: Why the project calendar connector is not automatic calendar access for every TalkHint account.
---

A workspace Google Calendar connection belongs to its authorized Google account,
not to whichever TalkHint user happens to call the app.

**Why:** Inheriting project-level connector permissions would expose the owner's
calendar to unrelated app accounts. Calendar creation and OAuth grant alone are
not consent to enable phone answering or automatic appointment booking.

**How to apply:** Keep the initial project connector Dev-only and restricted to
the trusted app administrator whose identity matches the connected Google owner,
on their own Work profile. Revalidate identity and calendar permissions; never
fall back to the primary calendar or another connection. General multi-user
production support needs explicit per-owner authorization/binding. A read-only
occupancy check is not a reservation or a voice-agent booking integration.
