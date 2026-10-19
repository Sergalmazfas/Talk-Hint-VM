/**
 * Portable remote-MCP plugin metadata, not a registration in OpenAI's directory.
 * No keys, owner identity, fixed bearer tokens, local servers or lifecycle hooks.
 */
export function talkHintPluginPackage(origin: string, outboundEnabled = false) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password)
    throw new Error("An exact HTTPS origin is required");
  const resource = `${origin}/api/chatgpt/mcp`;
  return {
    manifest: {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "talkhint", version: "0.1.0",
      description: "TalkHint Secretary: private call history, task status and saved reports.",
      author: { name: "TalkHint" },
      keywords: ["secretary", "calls", "reports"],
      extensions: { "com.openai": { interface: {
        displayName: "TalkHint", developerName: "TalkHint", category: "Productivity",
        shortDescription: "Secretary: звонки, поручения и отчёты",
        longDescription: outboundEnabled ?
          "Только свои данные. Каждый исходящий требует отдельного подтверждения номера и задания владельцем." :
          "Только чтение своих звонков, поручений Secretary и сохранённых итогов. Исходящие отключены.",
        capabilities: outboundEnabled ? ["Read", "Write"] : ["Read"],
        brandColor: "#315fca",
        websiteURL: `${origin}/api/chatgpt/secretary`,
        defaultPrompt: [
          "Покажи мои последние поручения Secretary и их статусы.",
          "Покажи сохранённый итог последнего завершённого поручения.",
        ],
      } } },
    },
    mcp: {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: { talkhint: {
        type: "streamable-http", url: resource,
        extensions: { "com.openai": { auth: {
          type: "oauth",
          client: { mode: "provided", clientId: "talkhint-chatgpt", tokenEndpointAuthMethod: "none" },
          authorizationUrl: `${origin}/api/chatgpt/oauth/authorize`,
          tokenUrl: `${origin}/api/chatgpt/oauth/token`,
          resource,
          // Least privilege on initial install. Transcript scope is incremental.
          baseScopes: ["calls:read", "offline_access", ...(outboundEnabled ? ["secretary:start"] : [])],
        } } },
      } },
    },
  };
}
