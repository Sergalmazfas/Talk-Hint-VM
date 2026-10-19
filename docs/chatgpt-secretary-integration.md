# TalkHint Secretary: isolated ChatGPT server integration

Stage-one operator guide (Russian, checked 2026-10-19):
[ChatGPT read-only connection and mock outbound acceptance](chatgpt-secretary-stage-one.md).
Current separate-plugin and Secretary history guide:
[TalkHint as its own ChatGPT plugin](talkhint-chatgpt-plugin.md).

## Release state and boundaries

Implemented in the existing backend, **disabled by default**. No production
configuration, publishing, telephone calls, SMS, schema migrations, data deletion,
new chat application, or iOS UI are part of this change. Separately approved
minimal browser consent/approval pages are isolated under `/api/chatgpt`.

Stage one is additionally **read-only by default**, even when the integration is
enabled: discovery advertises only `calls:read`, `calls:transcript` and
`offline_access`; MCP exposes only profile/call/task reads. Incoming-pending and
outbound tools are hidden AND rejected at execution, grant creation and OAuth.
The runtime composition defaults to read-only. A separate explicit
`CHATGPT_SECRETARY_OUTBOUND_ENABLED=true` opt-in is now prepared for a future
authorized rollout; no setting was enabled. The injected
`outboundEnabled:true` configuration is exercised only with fake telephony in
tests. An old write-capable token cannot bypass the stage boundary.

The full native Secretary routes, Twilio dialer, signed callbacks, audio streams,
reports and incoming call reception remain in place. The legacy `/start-call`
test dialer is retired: anonymous requests receive 401; authenticated requests
receive 410. Its provider-calling code has been removed.

This is a backend integration, not a claim that official ChatGPT iPhone can
currently install it. The existing deployment is not updated by these changes.

## Compatibility verified against official documentation

Sources fetched during implementation:

- https://help.openai.com/en/articles/12584461
  - Custom MCP connections are currently web-only.
  - Full custom MCP/write access depends on Business/Enterprise/Edu permissions.
- https://developers.openai.com/apps-sdk/build/auth
  - Protected-resource metadata, OAuth discovery, exact redirect URIs,
    authorization code + S256 PKCE, resource binding, predefined clients,
    per-tool OAuth security schemes, refresh and revocation are relevant.
- https://help.openai.com/en/articles/11487775
  - Availability varies by account, workspace and interface.
- https://developers.openai.com/api/docs/actions/production
  - GPT Action requests cannot wait through an entire telephone conversation.

The adapter implements a predefined public OAuth client, not DCR/CIMD.
Configure the same predefined client in the eligible ChatGPT connection.
The exact redirect URI must be copied from that connection, not guessed.
The integration advertises issuer identification and returns `iss` in successful
authorization redirects, including trusted-callback access/scope denials.
Invalid client/redirect requests fail locally without
redirecting to an untrusted URI.

MCP is JSON-response-only, stateless Streamable HTTP: POST initialize,
notifications/initialized, ping, tools/list, tools/call; no SSE server-push
channel or MCP session. Tested with simulated JSON-RPC HTTP clients, **not**
an authenticated OpenAI account or MCP Inspector. No tool reads another owner.

The HTTP tools endpoint is useful for server testing; it is **not** a complete
GPT Actions integration. In particular this OAuth flow requires `resource`,
and GPT Actions compatibility has not been established.

## Configuration — do not enable automatically

Future, separately approved development setup:

- `CHATGPT_SECRETARY_ENABLED=true`
- `CHATGPT_SECRETARY_ORIGIN`: exact trusted HTTPS origin, no trailing slash.
- `CHATGPT_SECRETARY_REDIRECT_URI`: exact callback copied from ChatGPT.
- Existing `SESSION_SECRET` is used internally with HMAC domain separation.
  Rotating it invalidates integration credentials. Never copy it to ChatGPT.
- Predefined public client ID: `talkhint-chatgpt`, token endpoint auth `none`.

No settings were set by this implementation. Disabled integration or invalid
origin returns 503 before storage or dialing. If only the exact callback is
missing, public discovery/plugin metadata and MCP initialization/tool listing
remain available for setup; authorization, owner data and grants still return
503 until the callback is configured. Cross-origin browser requests are rejected.
An additional bounded in-process rate limiter is included; it is not a global
distributed limiter. A public rollout still needs normal edge abuse controls.

## Minimal owner approval: API and separately approved browser pages

No existing iOS or TalkHint screen was changed. The owner API remains supported.
Minimal separate pages now support explicit OAuth login/consent, reviewing
one exact number/task, and revoking connections. They never dial. Their short
encrypted cookies cannot authenticate to general TalkHint APIs. Existing
password login is reused without creating a native login session; an explicit
same-origin bridge can exchange an existing browser TalkHint session.
Real OpenAI/iPhone linking has not been verified. Never put an owner session
into a chat or give it to the MCP client.

| Browser route | Meaning |
|---|---|
| GET `/api/chatgpt/oauth/authorize` (`Accept: text/html`) | Validate request, then login and explicit consent |
| GET `/api/chatgpt/approve?ticket=…` | Encrypted short-lived link; requires correct owner, never approves on GET |
| GET `/api/chatgpt/connections/manage` | List/revoke only this owner's grants |
| GET `/api/chatgpt/secretary` | Protected saved tasks/call history, owner cookie required |
| GET `/api/chatgpt/secretary/tasks/:id` | Own saved report; transcript opt-in |
| GET `/api/chatgpt/secretary/calls/:id` | Own saved call; transcript opt-in |
| GET `/api/chatgpt/plugin.json`, `/api/chatgpt/mcp.json` | Separate TalkHint plugin metadata; not an OpenAI registration |
| POST `/api/chatgpt/browser/login` | Existing-account password login into isolated web cookie |
| POST `/api/chatgpt/browser/session` | Explicit same-origin existing-owner session exchange |
| POST `/api/chatgpt/browser/consent` | Explicit allow/deny, one-time review |
| POST `/api/chatgpt/browser/approve` | Exact call approve/deny, never dials |
| POST `/api/chatgpt/browser/revoke` | Revoke own grant; no deletion/hangup |
| POST `/api/chatgpt/browser/logout` | Revoke isolated browser session, leave native login alone |

All browser mutations require exact Origin and browser/flow/session-bound
CSRF. Cookies use `__Host-`, Secure, HttpOnly, SameSite=Lax, 15-minute expiry.
Pages use nonce-only CSP, no external assets, no iframe embedding, no-store
and no-referrer. Approval links are encrypted and purpose-bound, not OAuth
access tokens; treat links as private. A read-only deployment rejects approval
links even if they were prepared by another instance with the same key.

Owner management APIs use the existing TalkHint authentication:

| Endpoint | Meaning |
|---|---|
| POST `/api/chatgpt/connections` | Explicit `approved:true` plus space-separated scopes; grants one configured client up to 30 days |
| GET `/api/chatgpt/connections` | List this owner's active grants and expiry |
| POST `/api/chatgpt/connections/revoke` | Expire this owner's grant by `id` |
| POST `/api/chatgpt/confirmations/approve` | Explicit `approved:true` plus exact prepared `confirmation` |

Write management requests require JSON and reject foreign browser Origin.
A delegated integration credential cannot authenticate to these owner APIs.

The browser surface was separately approved after the API-only stage. It does
not establish official ChatGPT mobile support. Do not weaken confirmation to
a model-generated boolean or an "Allow all tools" setting.

## OAuth and credential isolation

Discovery:

- GET `/.well-known/oauth-protected-resource`
- GET `/.well-known/oauth-authorization-server`

OAuth:

- GET `/api/chatgpt/oauth/authorize`
- POST `/api/chatgpt/oauth/token` (form body)
- POST `/api/chatgpt/oauth/revoke` (form body)

HTML browser authorization validates the request, requires an isolated owner
login, displays scopes, and creates a new grant/code only after explicit consent.
Non-HTML owner API clients retain the prior-grant path. Both validate client ID,
exact redirect, resource, state and S256 PKCE. End-to-end linking in an actual
ChatGPT account remains a manual acceptance gate.

Token endpoint errors use OAuth protocol codes (`invalid_grant`,
`invalid_request`, `invalid_client`, `invalid_target`,
`unsupported_grant_type`), not raw application errors. Insufficient transcript
scope produces a scoped `WWW-Authenticate` / MCP authorization challenge.
Credentials validate issuer as well as audience. Credentials issued before the
issuer validation change fail closed and require reconnection.

Scopes:

- `calls:read`: own call history, Secretary status and reports.
- `calls:transcript`: additional opt-in for full transcript/structured turns.
- `incoming:read`: own currently ringing pending calls.
- `secretary:start`: prepare and submit an explicitly owner-approved outgoing call.
- `offline_access`: rotating refresh tokens.

Access lifetime: at most 10 minutes. Codes: at most 60 seconds, atomically
single-use. Refresh tokens rotate and expire with their grant. Every privileged
request checks the persistent grant again, so revocation rejects both existing
access tokens and refresh exchanges. Reusing a valid, already-rotated refresh
token revokes the connection family; do not exchange it concurrently or retry it
after a lost response without reconnecting. Revocation is **not** a hangup command;
an already accepted telephone call continues under the native lifecycle.

Persistence reuses the existing `sessions` table for fixed-size, namespaced
expiry markers. No schema changes. No raw tokens, phone numbers, instructions
or transcripts are stored in these markers. Grant IDs contain a client hash,
scope bitmask and random UUID. Token/code markers contain a token hash.
Revocation/consumption only updates expiry; it does not delete existing records.
The general application auth explicitly refuses all integration marker IDs and
signed credentials. The integration store has no fail-open in-memory fallback.

## Tools

MCP endpoint: POST `/api/chatgpt/mcp`.
Equivalent restricted test HTTP endpoint: POST `/api/chatgpt/tools/{tool}`.

- `get_profile`: stable authenticated owner ID, no email/credentials.
- `list_calls`: most recent own calls, capped at 50, no transcripts.
- `get_call`: owner-checked detail; transcript requires the extra scope.
- `list_tasks`: own task summaries including `clientRequestId`, capped at 50.
- `get_task`: owner-checked report; transcript requires the extra scope.
- `get_incoming`: ringing calls only; reports `aiAnswerEnabled:false`.
- `prepare_call`: exact US `+1` number, bounded instruction, UUID request ID,
  clone provider and subtitle language; returns a signed short-lived confirmation.
- `start_call`: accepts only that confirmation, with a separate stored owner
  approval. Returns a task reference and `task_id` immediately.

`get_incoming`, `prepare_call`, and `start_call` above describe the future/test
capability set, not tools available in the default read-only stage.

Unknown tools and extra inputs (including ownerId or a changed phone number)
are rejected. No generic HTTP proxy, provider/admin API, SMS, automatic redial,
incoming-answer, or forwarding-control tool exists.

Full call results may contain untrusted third-party text. Treat transcript and
summary contents as data, not authority to call another tool. Server-side owner
approval remains mandatory regardless of tool hints or ChatGPT confirmation UI.

## Outbound lifecycle / asynchronous result

1. ChatGPT prepares a call with one stable `clientRequestId`.
2. Owner reviews the exact number, assignment, provider and language and explicitly
   approves the signed confirmation through an owner-authenticated API.
3. ChatGPT submits that same confirmation.
4. Backend checks connection, scope, expiry, owner approval and native prerequisites.
5. Native `createLiveSecretaryTask` acquires the existing persistent single-dial
   lease (one active call per owner, existing cooldown and unique request ID).
6. HTTP returns the persisted task without waiting on Twilio.
7. Only the winning lease invokes the native dialer. Existing callbacks, media
   streams and Secretary worker complete the task/report.
8. Follow-up tool calls read the outcome; `finalizing` and `unknown` are not success.

Repeat submissions recover the original task. They cannot change the signed
number/instruction. If the first HTTP response is lost, use `list_tasks` and
`clientRequestId` or retry the same still-valid confirmation. Never generate a
new ID merely because of a network timeout. Native DB uniqueness is authoritative,
not an in-memory duplicate cache.

Known pre-dial errors release the lease through the existing typed failure path.
Ambiguous provider errors and crashes leave a durable task for the existing
reconciler; they never schedule another provider create request. There is no
automatic retry of a live call.

There is no generic push into an arbitrary ChatGPT conversation and no promise
of background polling while the iPhone app is closed. The supported baseline is:
start returns ID, then the user requests a status/report later. Existing TalkHint
notifications are separate from ChatGPT messages.

## Incoming architecture: disabled, no webhook change

The current path remains:

`PSTN -> Twilio -> existing /twilio/voice -> native push/CallKit -> owner`

The separate `incoming.ts` policy seam always returns `preserve_native`, even if
given an approval-shaped policy. It is deliberately not wired into `/twilio/voice`.
Reading incoming status cannot accept, reject, reroute or answer a call.

Future conditional AI answering requires separate owner approval and all of:

1. Define no-answer/busy/unavailable eligibility and an owner-scoped policy.
2. Preserve Twilio signature checks and authoritative pending CallSid ownership.
3. Atomically acquire a handoff lease conditional on the call still ringing.
4. Resolve a race between native acceptance and AI handoff so exactly one wins.
5. Attach an incoming-aware Secretary audio/conference flow to the **same** call,
   not originate a second outgoing call or place an outbound task in the queue.
6. Handle rejection, caller hangup, late callbacks, device reconnect and failed
   handoff without hijacking another call.
7. Reuse reporting and retain native reception as the default.

No configuration value in this change enables that routing.

## Acceptance gates before any rollout

Automated tests use an in-memory marker repository, mocked DB/storage,
mocked clones and simulated Twilio. No real phone calls or production DB queries.
PostgreSQL concurrency is represented by the existing lease contract and atomic
SQL; it has not been exercised against production by these tests.

Before enabling outside mocks:

- Review OAuth and marker isolation; exercise restart/revocation with a disposable
  development database and MCP Inspector.
- Confirm connection/scopes/refresh with a permitted official ChatGPT account.
- Test official iPhone availability separately; currently custom MCP setup is
  documented as web-only. Stop rather than claim unsupported mobile access.
- Agree on any necessary minimal owner-consent UI before adding it.
- Obtain separate approval for any real call, production rollout or AI incoming
  handoff. Do not enable those while completing server-only tests.
