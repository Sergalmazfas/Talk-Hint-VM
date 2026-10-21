# TalkHint Secretary: approval and live card

Candidate package **0.4.0 / MCP 1.3.0**. Not published by this work.

## Owner flow

1. Connect the existing TalkHint account through OAuth. Baseline remains
   `calls:read offline_access`; no password is collected by ChatGPT.
2. Ask for one call with the exact recipient, +1 number and goal.
   `prepare_call` requires `secretary:start` once. It creates no telephone task.
3. Review the compact inline card and press **Подтвердить и позвонить**.
   The UI-only `confirm_call_from_card` verifies the immutable draft and hidden
   owner capability and reuses the existing idempotent Secretary backend.
   No separate model `start_call` is needed. `start_call` is recovery-only.
4. In that card request live listening/text. The first monitor use requests
   `calls:listen calls:transcript` together. Existing granted scopes are preserved
   in step-up challenges, so adding listening must not drop calling permission.
5. Mute does not stop the call or the text feed. Reconnect resumes the same task
   and durable text, never dials. Lost live audio is not replayed. Ended tasks
   show their saved result; an expired listening ticket is not an ended call.

An individual host may impose its own additional permission/confirmation UI.
Do not suppress it with Allow all tools or fabricated model confirmation.

## Backend and privacy

- Reuses the native Secretary audio feed: guest and secretary, base64 G.711 μ-law
  8 kHz mono; existing finalized text turns, subtitle translations and statuses.
  No change to Twilio streams, voice selection, incoming routing or recording.
- UI-only `open_call_monitor({id})` checks OAuth grant/scopes and durable task
  ownership. Only hidden `_meta["talkhint/monitor"]` contains a two-minute,
  task-bound ticket. It is not a native session credential or model-visible token.
- `POST /api/chatgpt/monitor` accepts that ticket in Authorization, never query
  parameters, cookies or a client-chosen task selector. Initial and periodic
  snapshots recheck ownership and revocation (up to 2.5 seconds for a live grant).
  Expiration closes the stream. At most two streams per owner per VM process.
- CORS applies only to this read-only stream and only to the configured TalkHint
  origin, `https://chatgpt.com`, and HTTPS `web-sandbox.oaiusercontent.com` plus
  its subdomains. No credentialed CORS or wildcard origin. All original OAuth,
  login, CSRF, callback, PKCE, resource and call-approval guards remain in place.
- Snapshot/subscription handoff is buffered and bounded. Slow audio consumers
  drop old live frames instead of building an unbounded replay queue. Oversized
  connections close explicitly. Browser DOM keeps the last 200 turns.
- No new database tables, migrations, accounts, storage of audio or phone runtime.
  Appending the listening scope preserves positional bits in existing grant IDs.

## Model text access is separate from listening

`read_call_turns({id, afterTurnId?, limit?})` requires `calls:transcript`, checks
task ownership and returns up to 50 saved utterances and available translations,
`nextCursor`, `hasMore`, status and a reset flag if the cursor was lost.

Use it only when asked. It does not run continuously, push a later assistant
message into the original chat, send audio to the model, or grant the model
access to the human player's audio. Transcribed speech remains untrusted data.
RU translation is provided by the existing Secretary subtitle pipeline for RU
tasks (the default). Missing translation is displayed as unavailable, not invented.
An explicitly Spanish task keeps its existing translation setting.

## Card / host diagnosis

The new `ui://talkhint/call-approval/v2.html` avoids stale v1 resource caching.
Descriptors link the standard MCP Apps URI and ChatGPT compatibility template.
The resource grants a network connection only to TalkHint and allowlists the
TalkHint fallback origin; the widget checks the actual parent bridge handshake.
The status tool is explicitly widget-accessible for legacy ChatGPT hosts.

If the host returns only JSON/text, that is **not a rendered confirmation card**.
The plain tool result says no call has started and offers the existing protected
web approval for that exact draft. No approval bypass is allowed. After a task
exists, the fallback opens its protected saved report, explicitly labelled as a
report rather than embedded live listening. It does not start/retry a call or
guarantee that the native app opens its live-call controller.

No signed-in official ChatGPT web/iPhone environment is available to the agent.
Local VM/Chromium fixtures are not evidence of official-host rendering, actual
autoplay permission, Bluetooth routing, foreground/background behavior, or a
successful telephone call.

Official references checked during this work:

- https://developers.openai.com/apps-sdk/reference — UI resource MIME/metadata,
  widget-only full tool results, UI tool visibility, CSP and trusted external links.
- https://developers.openai.com/apps-sdk/build/mcp-server.md — widget troubleshooting.
- https://help.openai.com/en/articles/12584461 — custom MCP mobile FAQ currently says
  “No — web only”. This does not establish availability of every installed package;
  an actual supported connection and host test are still necessary.

## Release and acceptance

This work must not publish or perform a real call. Use the isolated integration
suite, TypeScript and offline build first. The preview script is a fake host with
synthetic task/audio/text responses; it cannot dial.

Verified in this session: TypeScript passed; full suite **115 files / 1422 tests**
passed; offline release preparation and MCP inclusion gate passed. Tests cover
both audio roles, RU text, mute, owner/scope denial, revocation, ticket expiration,
same-task reconnection, scope-preserving refresh, double-click/replayed results
and existing native idempotent dialing with mocks. Screenshots use an isolated
fake host, not the signed-in ChatGPT application.

After owner-approved publication, refresh the **existing** connection's tools
and package instructions/resource. Do not create another phone system or mix it
with another GPT. Grant the additional permissions once when needed. First check
rendering without confirming a call. Then perform an explicitly authorized single
owner-controlled call only under separate approval. Verify both audio roles,
mute, RU turns, interruption/reconnect, terminal result and the same task ID in
actual ChatGPT web and iPhone if the host supports it. Record unsupported hosts
as unsupported; the report fallback is not proof of in-chat playback.
