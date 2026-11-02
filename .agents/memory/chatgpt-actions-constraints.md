---
name: Personal ChatGPT Actions constraints
description: Why personal Actions needs a distinct OAuth mode and why Plus/iPhone installation cannot be promised from local tests.
---

## Verify the installed transport before extending ChatGPT

An owner saying “my GPT” does not establish whether the active connection uses
personal Actions or the ChatGPT MCP app. Check the actual adapter before
promising a schema-only update will expose a new capability.

**Why:** an Actions-focused request coincided with an active MCP connection;
an Actions-only implementation would leave that existing connection unchanged.

**How to apply:** reuse one business operation where both adapters are approved,
but retain distinct OAuth audiences, owner binding and the existing per-call
approval. A refreshed Actions schema does not refresh the MCP tool catalogue.

For a directly connected custom MCP server, updating the backend or starting a
new chat is not sufficient to refresh ChatGPT's saved tool metadata. Open the
existing connection at https://chatgpt.com/plugins and use **Refresh**, then
start a new conversation. Repeating OAuth **Connect** may merely report
"This account is already connected"; it is not the metadata refresh operation.

**Why:** the live server returned both new plan tools and the updated title while
the owner's ChatGPT still exposed the previous catalogue.

**How to apply:** verify live `initialize` and `tools/list` first; follow OpenAI's
[Refresh metadata](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata)
instructions before proposing disconnect/reconnect or another Publish. Distinguish
direct custom MCP connections from submitted plugins: tool definitions and shared
server instructions use continuous review; submitted names and imported skills
require a new version, review and publication. Do not invent the app-specific
Manage URL or assume the same workspace controls are available on every plan.

The owner's selected installed plugin is a separate artifact from the generic
plugin export in this repository. Preserve its identity and account; do not
replace it with the generic package or infer it is outdated just by comparing
its version with the MCP server version.

**Why:** the installed plugin has its own version and copied Secretary skill;
updating the server alone cannot rename that installed package or its skill.

**How to apply:** establish the original package/source and publication status
before preparing a replacement. The prior boundary is documented in
`docs/chatgpt-card-resource-compatibility.md` under “Release / installed-plugin distinction”.
For submitted plugins consult
https://developers.openai.com/plugins/deploy/app-review#continuous-review-and-tool-updates .

Do not switch the native phone server's HTTPS ingress or restart it just to
expose an Actions test service. Use an approved isolated test origin on 443.
Loopback HTTPS with a test CA proves transport behavior, not public reachability,
real-owner verification or a working ChatGPT/iPhone connection.

**Why:** The owner authorized mock testing while explicitly preserving existing
telephony; a private additional port is not an Actions-compatible public origin.

**How to apply:** Reuse the same adapter with synthetic backend injection,
keep native DB/auth/provider imports out of the test process, and obtain the
exact callback from the separate TalkHint GPT. Record external tests separately.

Keep MCP's resource binding and mandatory S256 unchanged. Actions needs its
own confidential-client OAuth mode, audience and browser ticket/cookie namespace.
Never make the MCP public client accept missing PKCE merely to fit Actions.

**Why:** OpenAI Actions authentication documents client-secret exchange without
requiring resource or PKCE. Remote MCP specifies a different client contract.
Sharing business logic does not mean weakening the established MCP flow.

**How to apply:** Use a distinct fixed callback/client, restrict the personal
adapter to its configured owner, require independent first-party per-call
approval, and test both protocols together. No API-key fallback.

As of 2026-10-19, OpenAI's official creating/editing GPTs help page says personal
plans, including Plus and Pro, cannot create NEW GPTs; existing GPTs remain
usable/editable subject to permissions. Mobile can use but cannot build GPTs.
Retirement notices are also present, with affected Enterprise dated 2026-12-11
and other plans expected to follow; do not claim that date is confirmed for
this owner's personal account.

The official Pro tiers page also lists Pro 100. Pro pricing does not override
the personal new-GPT restriction. Custom MCP documentation limits Pro
connections to read/fetch and says custom MCP is web-only; do not promise
outbound-call or iPhone support from the subscription price.

**Why:** A prepared OpenAPI document cannot overcome account-level creation
restrictions or prove native iPhone OAuth behavior.

**How to apply:** Recheck current official docs and the owner's available
separate GPT before promising installation. Never repurpose Road Ranger or
Route Leader as a workaround. Sources:
https://help.openai.com/en/articles/8554397
https://help.openai.com/en/articles/9442513
https://developers.openai.com/api/docs/actions/authentication
https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers
https://help.openai.com/en/articles/12584461
