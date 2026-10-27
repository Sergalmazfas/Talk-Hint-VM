# Hint lab: recoverable startup and owner's pre-call check

## Scope

Dev change only. No telephone/audio/STT/iOS behavior, database schema, model
requests, real calls, email submission or autonomous QA is changed by this check.

Before the change, production had no control row and logged only a generic
`HintLab BLOCKED`. Dev could read the pinned Gmail profile; the owner's production
account and required tables existed. Those facts did **not** identify the exact
production bootstrap failure or prove production Gmail/worker readiness.

Two proven defects are addressed:

* Startup failure used to return permanently, so a transient OAuth/identity or
  database outage prevented recovery until another server restart.
* The failure did not identify whether configuration, Gmail, owner binding,
  worker imports or the control insert failed.

## Behavior

Failed initialization retries every 30 seconds, with one attempt in flight.
Diagnostics contain an allowlisted stage/error code, never raw SDK errors,
profiles, connection identifiers, tokens or private call content.

Prerequisites: pinned Gmail profile → admin/owner mapping → exact CrewAI import
version and configured model key → saved control. The key's existence and an
import do not prove model credits, analysis quality or delivery of a real report.
No model inference, agent execution or email submission occurs in readiness.

New controls are always disabled. Every production startup pauses existing
controls, even when `LAB_START_PAUSED` is missing or false. Readiness requested by
the authenticated owner does not reset an existing switch. Verified source-owner
binding is registered only after all startup prerequisites succeed.

## Owner's phone page

After publication: `/admin/call-lab` on the existing published domain.
Requires the existing administrator login; it is not a new public endpoint.
The API alias `/api/admin/call-lab` also serves the page to signed-in callers.

1. Open the page while signed in as the Gmail-bound owner.
2. Press **Проверить готовность**. If blocked, read the stage/code; do not call
   expecting a lab report.
3. Resource readiness, master configuration, owner switch and watchdog state are
   separate. Enabled configuration does not activate the owner switch.
4. Explicitly enable Hint-owner monitoring only after prerequisites pass.
5. Refresh status after the watchdog's next poll. Only a fresh checked watchdog
   plus resource readiness, matching environment and enabled control permits the
   page's ready-to-call message.
6. Only **new owner Hint calls after activation** are eligible. No historical
   replay, other users, Secretary, Translator or Copilot activation is added.

APIs remain protected by `requireBenchmarkAdmin`; setup also verifies that the
current user is the actual Gmail-bound owner. Readiness is POST because it may
create/rebind the disabled control record. Mutating actions are never retried by
the page, and activation requires explicit confirmation.

## Next Publish settings

The project configuration is prepared with `LAB_ENABLED=true`,
`LAB_TARGET_ENVIRONMENT=production`, `LAB_START_PAUSED=true`.
This prepares the **next owner Publish**, not activation of the currently running
production revision. Dev's environment does not match the target, so it cannot
process live reports. No recipients, connector IDs or keys were changed.

Publication is still the owner's action. Exact production failure resolution
must be verified on the new revision using the stage diagnostics. Until then,
do not claim that a control call will automatically generate an email.
