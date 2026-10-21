# Secretary inline confirmation: verification and release gate

Checked 2026-10-21. No publication, real dialing, production mutation or owner-account login was performed.

## Observed public deployment

The deployment service reports a public VM with a successful build at https://talkhint.app.

Real unauthenticated HTTPS requests returned:

| Request | Result |
| --- | --- |
| GET /api/chatgpt/readiness | HTTP 200; MCP 1.4.0, outbound mode, callbackConfigured=true, streamable-http, inline_card |
| POST /api/chatgpt/mcp initialize | HTTP 200; tools/resources capabilities, MCP server version 1.4.0 |
| POST /api/chatgpt/mcp tools/list | HTTP 200; prepare_call provider enum openai/elevenlabs/cartesia, default openai; standard UI resourceUri and OpenAI outputTemplate both point to v2.html |
| POST /api/chatgpt/mcp resources/read, v2.html | HTTP 200; text/html;profile=mcp-app; HTML includes the confirmation button |
| POST /api/chatgpt/mcp tools/call get_profile without credentials | HTTP 200 MCP error result, isError=true and OAuth challenge; no owner data |

Published v2 HTML SHA-256: `72a3e3dbc388d69d5e6a6a980984ad9dbf2f98fe4505a99fa12bc553559d1058`.

An authenticated production prepare_call was **not** exercised: we do not possess the owner's ChatGPT connection. Owner consent, refresh and real iPhone rendering were not observed in production.

## What the missing card does and does not establish

`content: [text]` plus `structuredContent` is a valid MCP Apps tool result. The card is not required to appear as an HTML content block in that result. The host discovers its URI in the tool descriptor, reads the resource and mounts a supported bridge; hidden result `_meta` supplies the approval capability.

The owner's previously observed schema excluding OpenAI does not match the current public descriptor. Stale/frozen connection metadata or a different selected connection is an established mismatch, not a missing provider on the current server. We cannot inspect which descriptor the owner's current ChatGPT connection actually cached.

The public server serves its UI resource successfully. This rules out “the resource is missing” for this observed version. It does **not** establish whether ChatGPT fetched or mounted it in the failing conversation. A screenshot of text output, and local UI tests, do not identify that host-side failure precisely.

## Prepared changes (not published)

- MCP 1.5.0; resource URI v3.html, a new cache key as recommended by OpenAI.
- Server-derived execution configuration displayed in the card and model-readable preview: native OpenAI uses gpt-realtime-2.1 / marin; clone modes retain their actual configured text model and identify the voice as the owner's clone without exposing a voice ID.
- Existing owner/grant/scope/draft-bound UI approval remains mandatory. One button approves and invokes the existing durable Secretary launch.
- Expired cards disable approval locally as well as server-side.
- Unsupported-host messages stop safely; MCP preparation no longer offers website approval as a substitute for an inline card. Post-start same-task monitoring fallback remains separate.
- Explicit model and app visibility plus invocation labels on the render tool. Existing native modes, providers, OAuth PKCE/resource/callback validation and native dialer are unchanged.

## Verification

- Isolated ChatGPT/legacy suite: 158 tests passed; TypeScript passed; offline production-candidate build passed.
- The OAuth-to-native-launch integration test runs separately with OpenAI and ElevenLabs, entirely on fake persistence/model preflight/dialer. It expires the initial access token, exchanges refresh_token without a second login, prepares the exact call, refuses model-only approval, approves, repeats concurrently after a simulated lost response, observes one mock dial and one task ID, then reads final status and summary. No fixture can reach real Twilio.
- Separate tests cover revoked/wrong-owner/read-only grants, denial, expiry with refreshed access, rotated refresh replay rejection, hidden capabilities and double-click locking.
- Mobile-width visual capture used an isolated browser host with fixtures, not ChatGPT or an actual iPhone. It confirms the layout and selected model text only.
- After one development workflow restart, the app root returned HTTP 200 and the server started cleanly. The development MCP readiness route returns HTTP 503, “ChatGPT integration is disabled or not configured”; its configuration was deliberately not changed. Tests inject isolated enabled configurations. This is not a live HTTPS test endpoint connected to ChatGPT.

## Official requirements and remaining host gate

Sources accessed 2026-10-21:

- https://developers.openai.com/apps-sdk/reference — tool `_meta.ui.resourceUri`, optional OpenAI outputTemplate compatibility alias, app-only visibility, hidden result metadata.
- https://developers.openai.com/apps-sdk/build/chatgpt-ui.md — standard HTML resource MIME type, bridge, resource URI as a cache key.
- https://developers.openai.com/apps-sdk/deploy/connect-chatgpt.md — refresh connection metadata after tool/schema/UI changes; then start a new conversation and retest.
- https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt — frozen tool snapshots, refresh/offline_access requirements, and “Can I connect custom MCP servers on mobile? No - web only.” It also describes plan/workspace-dependent write access.

The last FAQ explicitly restricts **connecting** custom MCP on mobile. Do not stretch this into proof that every already-connected app can never render on iPhone. Conversely, general MCP Apps support is not proof this owner's private plugin/card works on iPhone. Host policy can require additional action confirmation; the server must not bypass it.

Minimum documented validation path: after a separately approved deployment, open the existing connection in ChatGPT web Plugins, Refresh its metadata (do not create another connection), verify MCP 1.5.0 / v3 / OpenAI default, ensure the chosen account/workspace allows write actions, and start a new conversation. First test the card/bridge with isolated mock infrastructure; then separately inspect the official iPhone client's behavior. If web renders but iPhone does not, record client/build, resource requests and bridge evidence before claiming a platform limitation or changing delivery method. Never test by calling a real number.

There is currently no production dry-run switch: the deployed confirmation button can dial. All mock executions in this report were isolated tests, not the published owner's account. Do not ask the owner to click a real production draft as a “mock” verification.

The future Compass request has not been created, approved or queued. When explicitly authorized later, review its exact recipient, number and truck/service goal, excluding the refrigerator, before any real launch.
