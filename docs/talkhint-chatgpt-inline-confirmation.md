# TalkHint Secretary: confirmation inside ChatGPT

Prepared 2026-10-20. Candidate plugin **0.3.0**, MCP **1.2.0**.
Not a publication or proof of a real ChatGPT/iPhone/PSTN session.

## Supported design and its limits

The desired Gmail-like experience is account OAuth once, then review/confirm an
individual external action in the conversation. Gmail is a UX comparison, not a
claim that a private TalkHint connector inherits Google's integration privileges.

Official primary sources checked 2026-10-20:

- https://developers.openai.com/plugins/build/chatgpt-ui — MCP Apps inline UI is
  explicitly intended for confirmation; `ui.resourceUri`, resource MIME type,
  tool-result notifications and `tools/call` are supported.
- https://developers.openai.com/plugins/reference — result `_meta` is delivered
  only to the component, hidden from the model; `ui.visibility: ["app"]` makes a
  tool UI-only. Annotations influence host confirmation, not server authorization.
- https://developers.openai.com/plugins/plan/tools — consequential actions still
  need server authorization, validation and confirmation.
- https://developers.openai.com/plugins/deploy/connect-chatgpt — refresh server
  metadata, then start a new conversation after deploying changed tools/UI.
- https://help.openai.com/en/articles/11487775-apps-in-chatgpt — ChatGPT action
  confirmation depends on permissions and context, not a universal per-call
  server-verifiable approval receipt.
- https://help.openai.com/en/articles/12584461 — custom MCP availability is
  account/workspace dependent; documented custom MCP connection support is web,
  not mobile. A personal subscription price does not prove eligibility.

Do not confuse Responses API `mcp_approval_response` (controlled by the API caller)
with a signed ChatGPT approval receipt delivered to a third-party MCP server.
No such receipt is assumed by this implementation.

## Flow

1. OAuth uses the existing owner account, provided public client, exact callback,
   S256 PKCE and resource binding. No passwords or tokens are collected in chat.
2. `prepare_call` validates the exact number, goal, stable request UUID and
   optional recipient name supplied by the owner. No native job is queued.
3. MCP returns the immutable preview and a self-contained inline confirmation
   resource. A short-lived, single-draft approval capability goes **only** in
   result `_meta`, never model-visible text or structuredContent.
4. User presses **Подтвердить и позвонить один раз** in the conversation.
   The component calls UI-only `confirm_call_from_card`.
5. Backend checks OAuth owner, grant, write scope, revocation, expiration, exact
   signed draft binding and atomic capability consumption. It approves then
   invokes the SAME existing idempotent Secretary backend. Recipient label is
   display metadata, not a replacement for the exact dialed number.
6. The task ID and actual status are returned. The component can request
   `get_task`; it also sends a host message asking the assistant to read that
   task. This is not a background push guarantee. The owner can always ask
   “Покажи результат задачи …” in the same conversation.
7. Denial never starts a job. A plain "yes", `confirmed:true`, unknown tool name,
   OAuth bearer alone or Allow all tools cannot replace the UI capability.
8. A host without the inline MCP Apps resource/private metadata fails closed.
   No mandatory website fallback is inserted into the new MCP workflow.

The host is trusted to isolate hidden metadata and app-only tools as documented.
This is not protection against a stolen owner OAuth credential or compromised
ChatGPT host. Annotations do not force a unique native confirmation popup.

Legacy authenticated web approval and GPT Actions remain intact for their own
existing consumers. The MCP model does not receive a per-call approval URL.
`start_call` remains an already-approved recovery operation; it cannot self-approve.

## One connection, after owner-approved publication

Open https://chatgpt.com/plugins in the eligible account/workspace on web.
Add or refresh **one** TalkHint Secretary MCP connection:

- Endpoint: `https://talkhint.app/api/chatgpt/mcp`
- Transport: Streamable HTTP
- OAuth client registration: provided
- Client ID: `talkhint-chatgpt` (public identifier)
- Token endpoint auth: `none`; no client secret
- Exact callback: `https://chatgpt.com/connector_platform_oauth_redirect`
- Authorization: `https://talkhint.app/api/chatgpt/oauth/authorize`
- Token: `https://talkhint.app/api/chatgpt/oauth/token`
- Resource: `https://talkhint.app/api/chatgpt/mcp`

Keep baseline `calls:read offline_access`. To use calls without a later OAuth
upgrade, explicitly grant `secretary:start` during initial setup if the client
offers scope selection. Otherwise the first preparation requests that additional
OAuth consent once. Do not grant `calls:transcript` unless separately wanted.
Refreshing tokens uses the existing grant; revocation/expiry can require login again.

Complete the TalkHint login and consent, refresh metadata and use a new chat.
Expected versions: plugin 0.3.0, MCP 1.2.0, readiness
`confirmationMethod: inline_card`; seven model tools plus one UI-only tool.
If using an installed source package, update its skills as well; a server refresh
does not replace an old installed package's instructions.

First verify `get_profile`, `list_calls`, `list_tasks` without a call. Test the
inline card on an isolated mock backend before any separately authorized real
call. Do not place a call merely to test that the plugin loads.

## Verification boundary

Local tests use fake storage, fake owners, fake providers and a simulated MCP Apps
host. They test hidden capability isolation, forgery, account/grant isolation,
revocation, expiry, denied calls, doubleclick locking, immutable parameters and
native idempotent task recovery. They cannot prove OpenAI account eligibility,
real iframe rendering on iPhone, OAuth completion by the owner, or a PSTN outcome.

Checks actually passed in this preparation:

- TypeScript `npm run check`.
- Isolated integration suite: 14 files, 133 tests.
- Full suite: 113 files, 1401 tests.
- Offline `npm run build:prepare`, including MCP runtime inclusion gate.
- Inline resource rendered at phone-width in an isolated mock host. Interaction
  behavior is checked by simulated host/DOM tests, not by a signed-in ChatGPT
  browser session. The main telephone application was not booted or restarted.

Native iOS UI, telephony providers, incoming routing, voice, database schema and
production configuration are unchanged. No SMS, incoming AI, forwarding, automatic
recording, purchases or automatic background reports are enabled.
