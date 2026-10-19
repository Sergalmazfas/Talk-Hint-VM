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
