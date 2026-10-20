---
name: OpenAI public plugin review
description: Published-plugin target and an upstream schema conflict that must not be bypassed by removing OAuth.
---

Keep OAuth in the documented OpenAI MCP authentication extension. Do not
replace protected tools with noauth to satisfy a generic portable validator.

**Why:** On 2026-10-19, the official OpenAI package/auth documentation required
`mcpServers.<name>.extensions.com.openai.auth`, while the published Agent Plugins
1.0.0 MCP schema forbade server `extensions` via additionalProperties:false.
Local shape checks cannot prove the submission portal accepts this combination.

**How to apply:** Recheck both primary sources when preparing an actual
submission, retain user authorization, and resolve importer/schema findings
before review. Explicitly distinguish local packaging validation from real
OpenAI scan/acceptance. Sources:
https://developers.openai.com/plugins/build/plugins
https://agent-plugins.org/schemas/1.0.0/mcp.schema.json

## Private MCP OAuth is not public submission

A private connection may use the existing predefined public OAuth client
(`provided` / `none`) with mandatory S256 PKCE and resource binding. Do not add
open DCR or CIMD solely because they are preferred examples in authentication
documentation, and never substitute the Custom GPT Actions callback.

**Why:** Official OpenAI packaging/auth documentation checked on 2026-10-20
explicitly supports predefined clients and `none`. Registration expansion is
unnecessary for this chosen path and does not prove real ChatGPT acceptance.

**How to apply:** Copy the exact MCP callback from the connection management
page, retain exact redirect matching, and distinguish metadata scan from owner
OAuth completion. Verify the actual client's connection surface rather than
inferring iPhone MCP support from an existing Actions GPT.
https://developers.openai.com/plugins/build/auth
https://developers.openai.com/plugins/build/plugins

## MCP discovery scopes are baseline, not a capability catalogue

Always put the minimal connection scopes in the initial `WWW-Authenticate`
challenge and protected-resource `scopes_supported`. Do not advertise transcript
permission as a baseline; request it only in an explicit step-up challenge.
Keep the authorization validator able to accept that separately consented upgrade.

**Why:** The MCP scope-selection strategy tells clients to request every
protected-resource advertised scope when the initial challenge omits `scope`.
ChatGPT consequently requested transcript access even though TalkHint's tool
descriptors required only ordinary call reading.

**How to apply:** Check challenges and discovery together, not just tool
descriptors or package `baseScopes`. Upgrade challenges must include the basic
read permission as well as the new permission, without auto-upgrading any grant.
https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#scope-selection-strategy

## Live server and installed plugin update independently

When live MCP lists outbound tools but the selected plugin has old read-only
instructions or no tools, diagnose the ChatGPT connection snapshot and installed
package separately. Republish is not a way to replace a user's installed skills.
For a local package, use the actual registered MCP mapping from ChatGPT; an
installed package ID is not a registered MCP connection ID.

**Why:** OpenAI documents an explicit connection Refresh/new-chat step, a cached
installed copy for local plugins, and a separate registered MCP mapping. A live
seven-tool endpoint therefore does not prove that a selected plugin exposes it.

**How to apply:** Verify live initialize/tools first, then the actual selected
connection, registered mapping and installed skill files. Keep a source bundle
without an observed mapping explicitly blocked, never invent the mapping or
substitute a saved-history page for dispatch. Do not infer a successful current
call from a historical failed report.
https://developers.openai.com/plugins/build/plugins
https://developers.openai.com/plugins/deploy/connect-chatgpt

## OAuth navigation is not a cross-origin data action

Permit validated browser navigation into OAuth even when an embedded client
sends an external or opaque (`null`) Origin. Do not apply the MCP/data API's
blanket same-origin rule to every browser authorization entry.

**Why:** The iPhone Connect failure was reproduced against production: an
otherwise valid authorization GET redirected without Origin but returned 403
with the ChatGPT or opaque Origin, before OAuth validation could run.

**How to apply:** Keep any exception narrowly scoped to the actual OAuth HTML
GET entry and browser-bound review. Preserve exact callback, PKCE, resource,
scope, flow and owner checks. Do not trust opaque origins for POST, relax CSRF,
add wildcard CORS or exempt the MCP/data endpoints.

## Browser form Origin and referrer policy

Use an origin-only referrer policy on protected OAuth/browser form pages, not
`no-referrer`. Keep rejecting opaque/external Origin on state-changing requests.

**Why:** A production consent POST was rejected after OAuth entry had been
fixed. Under the Fetch referrer-policy rules, `no-referrer` makes native HTML
form POSTs use `Origin: null`, even when submitted to the same origin.
Origin-only policy keeps path/query out of Referer without breaking the Origin
check. See https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy.

**How to apply:** Check the actual form submission, not just synthetic GETs or
fetch POSTs: fetch defaults to CORS mode and does not reproduce the native form
Origin behavior. Preserve CSRF, browser binding, exact callback, PKCE, resource
and owner checks; never “fix” this by accepting null Origin on writes.

OAuth consent forms also need an exact registered callback CSP source. Keeping
`form-action 'self'` on that document blocks a post-consent 303 to ChatGPT in
Chromium, even after the server accepted the form.

**Why:** A real local browser reproduction reached no callback with self-only
policy and reached it with the exact callback allowed.

**How to apply:** Allow the registered callback only on the consent document;
keep login/approval/revocation forms self-only and all OAuth redirect validation
unchanged. Browser navigation tests catch this; HTTP clients following redirects do not.
