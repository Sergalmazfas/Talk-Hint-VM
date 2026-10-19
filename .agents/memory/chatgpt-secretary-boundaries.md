---
name: ChatGPT Secretary boundaries
description: User-approved integration scope and safety boundaries for official ChatGPT access to Secretary.
---

Use official ChatGPT as a command/result surface for the existing TalkHint
Secretary, not a replacement chat application or a new iOS interface. Keep
Secretary, Twilio, the existing database and native call reception intact.
Exclude SMS. The user approved minimal protected web pages for OAuth consent
and per-call approval, without changes to existing TalkHint or iOS interfaces.
Every outbound call requires separate owner confirmation showing its exact
number and task. Forwarding UI still requires separate agreement.

TalkHint must be a separate connectable ChatGPT app/plugin. Route Leader is
only a UX reference; never mix their projects, endpoints, identities or access.

The target is a publicly listed TalkHint plugin for ChatGPT Plus, primarily
the official iPhone client. Do not assume manual custom MCP access on Plus
or require a Pro upgrade. Prepare locally; owner approval is required before
any upload/review, deployment, publication or real calls.

**Why:** The user explicitly requested this boundary and wants the existing
telephone product preserved rather than replaced by another chat.
The user explicitly approved only the minimal web addition after the API-only
stage; this does not authorize changing native interfaces or production.
The user explicitly requested the independent-plugin boundary.

**How to apply:** Verify official iPhone support rather than assuming web MCP
support implies mobile availability. Do not automatically enable incoming AI
answering/conditional forwarding: that requires separate agreement. Implementation
and mock tests do not authorize production changes, publishing or real calls.

Do not persist an unapproved draft as a native queued Secretary job.

**Why:** the existing queued-job worker can place calls without the new browser
approval gate. A draft must not accidentally become executable work.

**How to apply:** keep preparation separate from the native launch. Only
owner-approved start may enter the existing idempotent live-task path.
