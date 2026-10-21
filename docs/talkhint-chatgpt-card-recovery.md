# Recover an existing TalkHint call card

## Scope and official host contract

This is read-only recovery of an **existing** Secretary task, not a new
`prepare_call`, approval, `start_call`, or dial. The native call worker, providers,
database and production settings are unchanged.

OpenAI's current UI documentation was checked on 2026-10-21:
[Manage state / widget persistence](https://developers.openai.com/plugins/build/chatgpt-ui#manage-state).
It documents `window.openai.widgetState` and synchronous `setWidgetState(state)`
as optional, widget-instance-scoped persistence. It explicitly says this is not
durable cross-session storage. MCP Apps remains the primary tool-call bridge;
widget persistence is a feature-detected ChatGPT extension.

Accordingly, reopening the same conversation/widget can restore a locator **if
the host retains it**. We do not promise survival after deleting a conversation,
opening a new chat or changing device. Server-owned tasks remain authoritative.

## Recovery paths

1. After a successful confirmation result, save **only**
   `{ version: 1, task_id: "<id>" }` with `setWidgetState`.
2. On bridge initialization, validate the saved version/ID and call `get_task`
   with `{ id }` using the host's current OAuth connection. The locator is not
   ownership proof. Neither historical status nor a cached summary is displayed.
3. Render only a successful fresh result whose task `id` matches exactly.
   Show summary, outcome and next step. Completed/failed/cancelled/busy/no-answer
   tasks do not reconnect. A protected saved-report link is reissued by the
   server after authorization.
4. A live task can request **new** `open_call_monitor` metadata on an explicit
   click. The existing monitor verifies the current grant, scopes and task owner
   again; durable text comes from its snapshot. Old audio is never replayed.
   Audio is not auto-resumed after reopening or returning from background.
5. If host state is absent or saving throws, the card explains the fallback:
   ask ChatGPT to call `get_task` for this exact `task_id`. In the existing
   outbound-enabled MCP profile, `get_task` now advertises the same card resource
   (`v4`). Reissued tool output supplies a locator, then the widget refetches it
   under the current account. Read-only deployment profiles retain their existing
   resource/approval boundary; Actions remains a separate non-widget adapter.

No OAuth tokens, approval capabilities, monitor tickets, report URLs, recipient,
phone number, goal, transcript, result snapshot or audio flag go into host state,
browser storage, a URL query or a follow-up message. Tool metadata remains the
existing in-memory capability channel. Consumed approval and obsolete monitor
capabilities are dropped by the widget.

## Logout, account switching and retries

- On page hide/background, stop audio/streaming, clear private rendered details
  and capabilities, and invalidate in-flight reads/tickets.
- On resume, refetch the task with current credentials. Late responses from the
  previous lifecycle cannot repopulate the view.
- A denied/not-found/mismatched/error result shows no old report or transcript;
  only the non-authoritative ID remains for a manual status retry.
- A revoked stream or denied monitor request clears private output and requires
  a status/ownership check before new monitoring.
- There is no documented generic host logout/account-change notification used
  here. We do not claim instantaneous detection of an invisible account change:
  server grant checks, stream revocation polling and lifecycle revalidation are
  the enforcement points.
- Network retries are bounded by user actions: one read/ticket request at a
  time, no polling loop, no replacement task and no approval replay.
- A lost confirmation response with no returned `task_id` is still ambiguous.
  Recovery never guesses the newest task or creates a replacement call.

## Verification and limits

Run `npm run test:chatgpt-secretary` (isolated credentials/provider fixtures).
VM/DOM host mocks cover save/remount, both tool bridges, historical get_task
reissue, invalid host state, repeated notifications, terminal results, network
errors/manual retries, missing/wrong task IDs, lifecycle interruption and stale
monitor responses. HTTP/SSE mocks cover expired grants, account ownership,
fresh ticket issuance, repeated result reads, transcript permission and no dial.

The local visual preview uses a synthetic completed task; it is not official
ChatGPT. Actual ChatGPT/iPhone conversation reopen, host-state retention, OAuth
account switching, audio gesture policy and background behavior require the
separate official-host verification. No real calls, production changes or
publication are authorized by this work.
