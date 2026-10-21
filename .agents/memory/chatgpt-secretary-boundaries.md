---
name: ChatGPT Secretary boundaries
description: User-approved integration scope and safety boundaries for official ChatGPT access to Secretary.
---

Use official ChatGPT as a command/result surface for the existing TalkHint
Secretary, not a replacement chat application or a new iOS interface. Keep
Secretary, Twilio, the existing database and native call reception intact.
Exclude SMS. The user approved minimal protected web pages for initial OAuth
consent, without changes to existing TalkHint or iOS interfaces. Per-call approval
must now happen inside ChatGPT, without a mandatory website visit.
Every outbound call requires separate owner confirmation showing its exact
number and task. Forwarding UI still requires separate agreement.

Outbound integration must be an explicit new opt-in, not a reinterpretation of
old broad feature flags. Enabling outbound must not also enable incoming scopes.
**Why:** Existing flag values may predate the approved rollout; a later build
must not silently turn a read-only connection into permission to dial or access
unrelated capabilities.
**How to apply:** Keep baseline OAuth minimal, require separate write consent
and per-call approval, and apply a scope ceiling to the released MCP profile.
Preparing code is not permission to publish it or place a test call.

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

Private MCP setup and personal Custom GPT Actions do not imply a public
catalogue/review; do not automatically resume public submission.
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
The user approved initial web authorization but subsequently required per-call
confirmation in chat; this does not authorize changing native interfaces or production.
The user explicitly requested the independent-plugin boundary.
The user requested personal Actions and private MCP connections without
automatically resuming public review.

**How to apply:** Verify official iPhone support rather than assuming web MCP
support implies mobile availability. Do not automatically enable incoming AI
answering/conditional forwarding: that requires separate agreement. Implementation
and mock tests do not authorize production changes, publishing or real calls.

Do not persist an unapproved draft as a native queued Secretary job.

**Why:** the existing queued-job worker can place calls without the new browser
approval gate. A draft must not accidentally become executable work.

**How to apply:** keep preparation separate from the native launch. Only
owner-approved start may enter the existing idempotent live-task path.

## Confirmation inside ChatGPT

Use a supported in-chat owner interaction for each exact call, not a model-sent
`confirmed:true`, an instruction to trust "yes", or Allow all tools. OAuth bearer
access alone is not a per-call owner decision.

**Why:** The user explicitly requires the Gmail-like experience: initial login
and consent once, then call review, confirmation and results within the chat,
without visiting the TalkHint website before every call. Official tool
annotations affect host UX but are not a server-verifiable approval receipt.

**How to apply:** Preserve server owner/grant/scope/revocation/draft binding and
idempotency. MCP Apps supports inline confirmation and widget-only result
metadata; keep the per-draft approval capability hidden from the model and
limit its tool to the UI. Unsupported clients fail closed; do not promise
iPhone/private-MCP availability from local mock success.

## Live listening boundary

The owner wants both call sides and live RU text in the same ChatGPT card, with
an honest same-call fallback if the host cannot render/play it. This is not a
request to make the ChatGPT model hear a player or follow it autonomously.

**Why:** The user explicitly distinguishes owner listening from model access,
requires a short approval path, and forbids real third-party test calls.

**How to apply:** Keep audio UI-only and task-owner scoped; model text is a
separate permissioned on-request operation. Reconnection/monitor-ticket expiry
must never redial or imply that the telephone task ended. Permission upgrades
must retain earlier approved capabilities instead of causing an OAuth loop.
