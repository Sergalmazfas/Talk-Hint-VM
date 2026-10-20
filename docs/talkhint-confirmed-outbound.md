# Secretary outbound calls from ChatGPT

This reuses the existing Secretary, durable task reservation, Twilio dialer,
voice configuration, result storage and owner authentication. No new iOS UI,
incoming AI handling, forwarding, SMS or automatic recording is introduced.

## Explicit deployment opt-in

The default remains read-only. The new setting is:

```text
CHATGPT_SECRETARY_CALL_MODE=owner-confirmed
```

Do not set this in production or republish without the owner's separate approval.
The exact registered MCP callback and an enabled integration are also required.
Legacy `CHATGPT_SECRETARY_OUTBOUND_ENABLED=true` does not enable this mode.
An explicit integration kill switch continues to work.

The baseline OAuth connection still requests only `calls:read offline_access`.
Calling `prepare_call` without write permission returns a step-up challenge for
`calls:read offline_access secretary:start`. Transcript permission remains
separate and is not necessary to place a call or read its summary.
The release profile never permits `incoming:read`, including in outbound mode.

## Per-call sequence

1. The owner supplies an exact +1 destination and a task in ChatGPT.
2. `prepare_call` uses a stable UUID `clientRequestId` and returns the exact
   preview and a protected `approval_url`. It does not enqueue or dial.
3. The owner opens the page, signs into TalkHint if necessary, reviews the number
   and task, and approves that particular request. ChatGPT credentials cannot
   approve it; `confirmed:true` is not accepted.
4. ChatGPT calls `start_call` with the approved confirmation. Native durable
   task reservation allows at most one provider dial for concurrent retries.
   The immediate result contains `task_id`; an ambiguous timeout never warrants
   preparing a new request or automatically redialing.
5. `get_task` reads the saved status/result asynchronously. There is no automatic
   message pushed into the original ChatGPT conversation.

Approvals expire and are bound to the account, connection, exact number and task.
Owner revocation invalidates pending approvals. The existing Secretary still
requires an assigned number, a ready existing voice clone and provider readiness.
No number is purchased and no voice is changed by this adapter.

Removing the mode setting returns MCP to read-only after the normal approved
republish. This does not cancel a telephone call that is already in progress.

## Verification boundary

Release-profile tests exercise scope escalation and owner-approval refusals.
The native adapter integration test exercises OAuth, approval, two concurrent
starts, one simulated provider dial, the same task ID and result retrieval,
without transcript permission. Storage, identities and provider calls are fakes.
Browser tests cover the protected approval page and rejection paths.

These are not evidence of a completed real ChatGPT OAuth session or iPhone
tool execution. After the owner authorizes publication, verify OAuth in the
actual client before approving any real call. Real calls require separate
per-call owner approval and may incur the normal phone/provider charges.
