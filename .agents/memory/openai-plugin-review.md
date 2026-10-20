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
