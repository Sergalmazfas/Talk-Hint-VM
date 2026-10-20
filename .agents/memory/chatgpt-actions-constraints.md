---
name: Personal ChatGPT Actions constraints
description: Why personal Actions needs a distinct OAuth mode and why Plus/iPhone installation cannot be promised from local tests.
---

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
