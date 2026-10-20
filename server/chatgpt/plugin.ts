/**
 * Portable remote-MCP plugin metadata, not a registration in OpenAI's directory.
 * No keys, owner identity, fixed bearer tokens, local servers or lifecycle hooks.
 */
import { MCP_BASE_SCOPES } from "./security";
import { TALKHINT_PLUGIN_VERSION } from "./pluginWorkflow";

export interface TalkHintListing {
  developerName: string; websiteURL: string; privacyPolicyURL: string;
  termsOfServiceURL: string; supportURL: string;
}
export function talkHintPluginPackage(origin: string, outboundEnabled = false, listing?: TalkHintListing) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password)
    throw new Error("An exact HTTPS origin is required");
  const resource = `${origin}/api/chatgpt/mcp`;
  return {
    manifest: {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "talkhint", version: TALKHINT_PLUGIN_VERSION,
      description: outboundEnabled ?
        "Read your TalkHint reports and delegate a Secretary call after separate owner approval." :
        "TalkHint Secretary: private call history, task status and saved reports.",
      author: { name: listing?.developerName ?? "TalkHint" },
      keywords: ["secretary", "calls", "reports"],
      extensions: { "com.openai": { onboardingSkill: "./skills/setup/SKILL.md", interface: {
         displayName: "TalkHint Secretary", developerName: "TalkHint", category: "Productivity",
        shortDescription: "Secretary: звонки и отчёты",
        longDescription: outboundEnabled ?
          "Только свои данные. Каждый исходящий требует отдельного подтверждения номера и задания владельцем." :
          "Только чтение своих звонков, поручений Secretary и сохранённых итогов. Исходящие отключены.",
        capabilities: outboundEnabled ? ["Read", "Write"] : ["Read"],
        brandColor: "#315fca",
        websiteURL: `${origin}/api/chatgpt/secretary`,
        ...(listing ?? {}),
        defaultPrompt: outboundEnabled ? [
          "Подготовь звонок Secretary: уточни получателя, номер и цель, затем покажи карточку подтверждения прямо в чате. Без нажатия подтверждения не звони.",
          "Проверь результат поручения по task_id из этого чата. Не запускай новый звонок.",
        ] : [
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
          // Write and transcript access are incremental, not forced on install.
          baseScopes: [...MCP_BASE_SCOPES], defaultScopes: [],
        } } },
      } },
    },
  };
}
