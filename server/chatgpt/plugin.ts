/**
 * Portable remote-MCP plugin metadata, not a registration in OpenAI's directory.
 * No keys, owner identity, fixed bearer tokens, local servers or lifecycle hooks.
 */
import { MCP_BASE_SCOPES } from "./security";
import { TALKHINT_PLUGIN_VERSION, TALKHINT_CONNECTION_TITLE } from "./pluginWorkflow";

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
        "TalkHint — Hint + Secretary: save a Hint call preparation plan without dialing, or delegate a Secretary call after separate owner approval; read saved reports." :
        "TalkHint — Hint + Secretary: private call history, task status and saved reports. Preparation and outbound tools are disabled in read-only mode.",
      author: { name: listing?.developerName ?? "TalkHint" },
      keywords: ["hint", "preparation", "secretary", "calls", "reports"],
      extensions: { "com.openai": { onboardingSkill: "./skills/setup/SKILL.md", interface: {
         displayName: TALKHINT_CONNECTION_TITLE, developerName: "TalkHint", category: "Productivity",
        shortDescription: "Hint: план; Секретарь: звонки",
        longDescription: outboundEnabled ?
          "Hint: план следующего звонка без набора номера; живые подсказки — на экране звонка TalkHint. Секретарь: задания и отчёты. Только свои данные. Каждый исходящий требует отдельного подтверждения номера и задания владельцем." :
          "Только чтение своих звонков, поручений Секретаря и сохранённых итогов. Сохранение планов Hint и исходящие отключены.",
        capabilities: outboundEnabled ? ["Read", "Write"] : ["Read"],
        brandColor: "#315fca",
        websiteURL: `${origin}/api/chatgpt/secretary`,
        ...(listing ?? {}),
        defaultPrompt: outboundEnabled ? [
          "Подготовь звонок Secretary: уточни получателя, номер и цель, затем покажи карточку подтверждения прямо в чате. Без нажатия подтверждения не звони.",
          "Проверь результат поручения по task_id из этого чата. Не запускай новый звонок.",
          "Подготовь план для следующего звонка Hint: уточни цель, подтверждённые факты и ожидаемые вопросы. Сохраняй только по моему явному поручению; не звони.",
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
