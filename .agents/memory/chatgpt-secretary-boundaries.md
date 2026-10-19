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

Maintain two independent connection methods: Custom GPT Actions and OAuth/MCP,
both accessing ONE protected TalkHint backend and the existing Secretary,
not two Secretary systems. Telephone operation must remain independent of
the ChatGPT subscription; plan/client restrictions belong at the connection
boundary, not in the native telephone workflow.

**Why:** The user explicitly fixed this architecture to preserve flexibility
across available Plus/Pro capabilities without coupling TalkHint telephony
to the ChatGPT plan.

**How to apply:** Finish the API integration first, then verify real operation
before considering capability expansion. Keep transport-specific credentials
and grants isolated while reusing the same business logic, persistence and
native launch/idempotency. Mock success is not proof of a real ChatGPT connection.
Real calls, production changes and publication still require separate approval.

The immediate setup priority is personal API/Custom GPT Actions, not a public
catalogue/review; do not remove the independent OAuth/MCP path.
Road Ranger Business Processes is only a UX
reference, like Route Leader; never modify or replace those GPTs. Keep the
previous public-plugin preparation parked, not automatically resumed.
The target is the owner's existing personal ChatGPT subscription and the
official iPhone client; do not assume the plan is Plus. Verify the actual
plan and connection surface instead of requiring an upgrade as a workaround.
Prepare locally; separate owner approval is required before deployment,
publication, production changes or real calls.

**Why:** The user explicitly requested this boundary and wants the existing
telephone product preserved rather than replaced by another chat.
The user explicitly approved only the minimal web addition after the API-only
stage; this does not authorize changing native interfaces or production.
The user explicitly requested the independent-plugin boundary.
The user subsequently chose personal Custom GPT Actions instead of public review.

**How to apply:** Verify official iPhone support rather than assuming web MCP
support implies mobile availability. Do not automatically enable incoming AI
answering/conditional forwarding: that requires separate agreement. Implementation
and mock tests do not authorize production changes, publishing or real calls.

Do not persist an unapproved draft as a native queued Secretary job.

**Why:** the existing queued-job worker can place calls without the new browser
approval gate. A draft must not accidentally become executable work.

**How to apply:** keep preparation separate from the native launch. Only
owner-approved start may enter the existing idempotent live-task path.
