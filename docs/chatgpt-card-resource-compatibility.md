# Missing Secretary card: resource compatibility repair

Checked 2026-10-21. No real call, publication, OAuth reset or connection deletion.

## Evidence before repair

The current public server reports MCP 1.5.0, template v4, OpenAI default, and a configured OAuth callback. Its tools/list links prepare_call and get_task to the current UI resource. Production deployment metadata reports a successful public VM deployment.

Real HTTPS resources/read requests to https://talkhint.app/api/chatgpt/mcp:

| Requested URI | Status |
| --- | --- |
| ui://talkhint/call-approval/v1.html | 404, Resource not found |
| ui://talkhint/call-approval/v2.html | 404, Resource not found |
| ui://talkhint/call-approval/v3.html | 404, Resource not found |
| ui://talkhint/call-approval/v4.html | 200, text/html;profile=mcp-app |

Existing production logs also contain repeated POST /api/chatgpt/mcp 404 responses around 17:42–17:44 UTC. Those logs omit the JSON-RPC method and requested resource URI. They do not prove which particular URI the owner's selected connection requested.

Confirmed defect: a previously installed connection referencing an older template cannot load it after the server changes to a new URI. This affects rendering independently of successful OAuth and preparation. A tool-result text/structuredContent response is not itself a rendering error: the host loads HTML separately through the descriptor URI.

The owner's selected plugin ID/version and its frozen MCP mapping are external to this workspace. They were supplied by the owner, not inspected through their logged-in ChatGPT account. We cannot honestly assert that this defect is the sole cause of their particular host's missing card.

## Repair prepared in source

MCP 1.5.1 retains template v4 and accepts the three exact historical URIs as aliases. resources/read returns the requested URI, current HTML and current metadata. This prevents a cached v2/v3 reference from failing without requiring a new account or connection.

No wildcard resource resolution, URL fetching or filesystem access was added. Unknown URIs, query-string variants and disabled outbound profiles remain blocked. Aliases contain no owner data; the card still requires a valid per-owner, per-grant, per-draft UI capability before approving. Existing one-task idempotency and read-only get_task recovery remain unchanged.

Bounded diagnostics log only:

- initialize: server version and whether the client advertised the standard MCP Apps HTML MIME type;
- resource read: a fixed version label (v1–v4 or unknown) and ok/not-found.

No raw clientInfo, arguments, phone, instruction, URI, headers, state, codes or tokens are logged. “Not advertised” alone does not mean unsupported: a host may use the OpenAI compatibility bridge. Resource read success also does not prove the UI mounted or received a click.

## Release / installed-plugin distinction

1. A separately authorized **server publication is required** to make this source repair available at talkhint.app. It has not been performed.
2. Do not change the existing OAuth client, callback, resource, grants or selected plugin identity to repair this cache mismatch.
3. If the existing connection snapshot contains a v1/v2/v3 resource reference, the alias patch is specifically designed to work with it without metadata refresh.
4. If its snapshot lacks UI linkage entirely, refresh the **same** connection's metadata in ChatGPT Plugins. Required fields on prepare_call: _meta.ui.resourceUri and/or openai/outputTemplate. They must point to the current resource or one supported alias. Confirm get_task also retains its task-card metadata.
5. Installed plugin version 1.0.1, MCP server version 1.5.1 and template v4 are different version domains. Do not replace the selected private plugin with this repository's generic package version, create another identity, or delete the separate old read-only installation.
6. If plugin skills or its frozen registered-app binding were independently copied into the installed package, updating the server cannot modify them. Update that existing package/binding in ChatGPT, preserving its ID and account; a new OAuth login is not intrinsically required by this server patch.

Reference: https://developers.openai.com/plugins/deploy/connect-chatgpt and https://developers.openai.com/plugins/build/chatgpt-ui (accessed 2026-10-21).

## Tests and remaining proof

176 isolated ChatGPT/legacy tests passed, as did TypeScript. The tests include all legacy resource aliases, exact current HTML, rejection of arbitrary resources, diagnostic redaction, OAuth refresh without a second login, owner isolation/revocation, denial/expiry, single mock dispatch under duplicate/replayed approval, final report and current-account task recovery after widget reload.

No logged-in ChatGPT browser is available to this agent. A local UI/host fixture is not a real ChatGPT or iPhone test. Actual selected-plugin rendering, a button click, and recovery in that host remain acceptance gates after the approved release. Do not test a real production draft by calling it a mock: production approval can dial.

The current real Compass request is not queued or launched. Its five approved service topics and refrigerator exclusion remain an owner instruction, not a license for an automatic test call.
