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

**Why:** The user explicitly requested this boundary and wants the existing
telephone product preserved rather than replaced by another chat.
The user explicitly approved only the minimal web addition after the API-only
stage; this does not authorize changing native interfaces or production.

**How to apply:** Verify official iPhone support rather than assuming web MCP
support implies mobile availability. Do not automatically enable incoming AI
answering/conditional forwarding: that requires separate agreement. Implementation
and mock tests do not authorize production changes, publishing or real calls.
