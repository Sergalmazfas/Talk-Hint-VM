---
name: ChatGPT Secretary boundaries
description: User-approved integration scope and safety boundaries for official ChatGPT access to Secretary.
---

Use official ChatGPT as a command/result surface for the existing TalkHint
Secretary, not a replacement chat application or a new iOS interface. Keep
Secretary, Twilio, the existing database and native call reception intact.
Exclude SMS. Start with an API-only owner-permission/approval approach; propose
any necessary permission or forwarding UI before adding it.

**Why:** The user explicitly requested this boundary and wants the existing
telephone product preserved rather than replaced by another chat.

**How to apply:** Verify official iPhone support rather than assuming web MCP
support implies mobile availability. Do not automatically enable incoming AI
answering/conditional forwarding: that requires separate agreement. Implementation
and mock tests do not authorize production changes, publishing or real calls.
