---
name: Personal and work profiles
description: User-approved one-app architecture and privacy boundaries for business and personal calls.
---

Keep Personal and Work within the existing TalkHint app and backend, using
separate numbers and logical profiles, rather than a second business app.
Cards belong to the logical profile, not the physical telephone number.
Personal knowledge is not automatically copied to Work; sharing is explicit.

**Why:** The user explicitly approved the two-number, one-app approach after
rejecting the need for a separate business application.

**How to apply:** Select context by the actual incoming line or explicitly
approved outgoing profile. Keep personal and work calendars separate; business
availability may use personal busy intervals without revealing event details.
A promised booking requires a durable calendar acknowledgement, not merely a
transcript or generated reply. Number setup is not permission to enable
autonomous incoming answering or forwarding.

The user confirmed their existing CDL line is theirs and selected it as Work,
rejecting the alternative trial line. Keep that alternative in the pool; do not
cancel the provider number.

**Why:** The user explicitly corrected the initial number selection.

**How to apply:** Use the approved CDL plan, preserve old history, and do not
replace the owner's choice with another free number.

Use the explicit in-app confirmation to attach the existing CDL line rather
than buying a replacement or requiring web-only setup.

**Why:** The user confirmed that this native number-attachment flow succeeded.

**How to apply:** Preserve that setup flow while fixing cards or other profile
features; do not ask the owner to reattach a working number.

Personal/work numbers and cards must be reachable in the existing native iOS
app. A web-only settings page does not fulfill the requested mobile experience.

**Why:** The user updated the server and iOS app but could not see the promised
work number or cards because the first delivery only added web management.

**How to apply:** Include actual native navigation and scoped read/create/edit
behavior. Distinguish backend publication from installation of a new native
build; do not describe source checks as a verified iPhone experience.

The owner builds and installs TalkHint through Xcode.

**Why:** The user confirmed their actual iPhone update method.

**How to apply:** For native changes, ensure the Mac has the updated sources,
regenerate the XcodeGen project when new files are added, then build/install
through the existing Xcode workflow. A backend deployment is not that update.
