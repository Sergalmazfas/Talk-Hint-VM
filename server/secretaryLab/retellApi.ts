import WebSocket from "ws";

export const RETELL_LAB_AGENT = "TalkHint Secretary Lab — Retell Dev";
export const RETELL_LAB_MODEL = "gpt-6.1-sol";
export const RETELL_LAB_VOICE = "retell-Merritt";
export const RETELL_PROMPT_VARIABLE = "{{talkhint_instructions}}";
const API = "https://api.retellai.com";
export interface RetellNetwork {
  fetch: typeof fetch;
  socket(url: string, headers: Record<string, string>): WebSocket;
}
export class RetellApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export class RetellApi {
  constructor(private net: RetellNetwork = {
    fetch, socket: (url, headers) => new WebSocket(url, { headers, maxPayload: 128 * 1024 }),
  }) {}
  async request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> {
    const key = process.env.RETELL_API_KEY;
    if (!key) throw new RetellApiError(409, "Retell: RETELL_API_KEY не настроен");
    let response: Response;
    try {
      response = await this.net.fetch(API + path, {
        method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json",
          "X-Retell-Client-JS-SDK-Version": "3.0.3" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000), redirect: "error",
      });
    } catch { throw new RetellApiError(503, "Retell: сетевой таймаут. Автоматический повтор создания запрещён."); }
    if (!response.ok) {
      const labels: Record<number, string> = {
        400: "конфигурация/API отклонены; требуется проверка совместимости",
        401: "ключ недействителен или отозван; обновите RETELL_API_KEY через Secrets",
        402: "недостаточно средств или требуется оплата в Retell",
        403: "недостаточно прав ключа (Agent, Call или History)",
        404: "объект Retell не найден",
        422: "Retell не принял параметры",
        429: "лимит одновременных сессий или запросов Retell",
      };
      // Never relay arbitrary provider bodies: they may echo credentials or prompt data.
      throw new RetellApiError(response.status, `Retell HTTP ${response.status}: ${labels[response.status] ?? "ошибка сервиса"}`);
    }
    if (response.status === 204) return {};
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { throw new RetellApiError(503, "Retell: некорректный ответ API"); }
  }
  monitor(callId: string) {
    return this.net.socket(`wss://api.retellai.com/v2/monitor-call/${encodeURIComponent(callId)}`, {
      Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
    });
  }
  async listAgents() {
    const items: any[] = [];
    let pagination_key: string | undefined;
    for (let page = 0; page < 20; page++) {
      const data = await this.request("/v2/list-agents", {
        filter_criteria: { channel: { type: "string", op: "eq", value: "voice" } },
        limit: 100, ...(pagination_key ? { pagination_key } : {}),
      });
      if (!Array.isArray(data.items)) throw new RetellApiError(503, "Retell: несовместимый формат списка агентов");
      items.push(...data.items);
      if (!data.has_more) return items;
      if (!data.pagination_key || data.pagination_key === pagination_key) break;
      pagination_key = data.pagination_key;
    }
    throw new RetellApiError(503, "Retell: неполный список агентов; создание дубликата запрещено");
  }
  async inspectAgent(id: string) {
    const agent = await this.request(`/get-agent/${encodeURIComponent(id)}`);
    const llmId = agent.response_engine?.type === "retell-llm" && agent.response_engine.llm_id;
    if (!llmId) throw new RetellApiError(409, "Retell: стенд должен использовать отдельный Retell LLM");
    const llm = await this.request(`/get-retell-llm/${encodeURIComponent(llmId)}`);
    const config = llm.model_config;
    if (agent.agent_name !== RETELL_LAB_AGENT || agent.voice_id !== RETELL_LAB_VOICE ||
        agent.data_storage_setting !== "basic_attributes_only" ||
        agent.max_call_duration_ms !== 300_000 ||
        agent.interruption_sensitivity !== 0.9 ||
        agent.enable_backchannel !== false ||
        agent.contact_memory_config?.enable_read !== false ||
        agent.contact_memory_config?.enable_update !== false ||
        agent.webhook_events?.length !== 0 ||
        agent.pre_session_tools?.length || agent.post_session_tools?.length ||
        agent.fallback_voice_ids?.length ||
        !Array.isArray(agent.language) ||
        ["en-US", "ru-RU", "es-ES"].some(lang => !agent.language.includes(lang)) ||
        config?.type !== "cascading" || config.primary?.model !== RETELL_LAB_MODEL || config.backup ||
        llm.general_prompt !== RETELL_PROMPT_VARIABLE ||
        llm.general_tools?.length || llm.states?.length || llm.mcps?.length || llm.knowledge_base_ids?.length) {
      throw new RetellApiError(409, "Retell: конфигурация стенда отличается от проверенной. Подмена модели, инструментов или хранения запрещена.");
    }
    return { id: agent.agent_id as string, version: agent.version as number,
      model: config.primary.model as string, voice: agent.voice_id as string };
  }
  /** Explicit setup only; never edits existing customer agents, keys, numbers or webhooks. */
  async ensureAgent() {
    const matches = (await this.listAgents()).filter(agent => agent.agent_name === RETELL_LAB_AGENT);
    if (matches.length > 1) throw new RetellApiError(409, "Retell: несколько стендов с одинаковым именем; выберите вручную");
    if (matches.length === 1) return this.inspectAgent(matches[0].agent_id);
    const llm = await this.request("/create-retell-llm", {
      model_config: { type: "cascading", primary: { model: RETELL_LAB_MODEL, tier: "standard" }, backup: null },
      general_prompt: RETELL_PROMPT_VARIABLE, general_tools: [], states: [],
      start_speaker: "agent", begin_message: null,
    });
    if (typeof llm.llm_id !== "string") throw new RetellApiError(503, "Retell: создание LLM не подтверждено");
    const agent = await this.request("/create-agent", {
      agent_name: RETELL_LAB_AGENT, response_engine: { type: "retell-llm", llm_id: llm.llm_id },
      voice_id: RETELL_LAB_VOICE, language: ["en-US", "ru-RU", "es-ES"],
      interruption_sensitivity: 0.9, responsiveness: 1, enable_backchannel: false,
      data_storage_setting: "basic_attributes_only", max_call_duration_ms: 300_000,
      end_call_after_silence_ms: 300_000, webhook_events: [], fallback_voice_ids: [],
      contact_memory_config: { enable_read: false, enable_update: false },
    });
    if (typeof agent.agent_id !== "string") throw new RetellApiError(503, "Retell: создание агента не подтверждено");
    return this.inspectAgent(agent.agent_id);
  }
}
