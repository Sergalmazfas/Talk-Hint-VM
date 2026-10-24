import WebSocket from "ws";
import { SECRETARY_REASONING_MODEL } from "../secretary/voice";

export const ELEVEN_TTS_MODEL = "eleven_multilingual_v2";
export const ELEVEN_CATALOG = { voiceId: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "female", accent: "american" };
export class ElevenLabError extends Error { constructor(public status: number, message: string) { super(message); } }
export function elevenDevBase() {
  const host = process.env.REPLIT_DEV_DOMAIN;
  if (!host || !/^[a-z0-9.-]+\.replit\.dev$/i.test(host)) throw new ElevenLabError(503, "ElevenLabs: публичный Dev-домен не определён");
  return `https://${host}`;
}
export class ElevenLabApi {
  async workspaceSafe() {
    const s = await this.request("/v1/convai/settings");
    // Do not inherit an unrelated account's real webhook/notification integration.
    if (s.conversation_initiation_client_data_webhook || s.webhooks?.post_call_webhook_id)
      throw new ElevenLabError(503, "ElevenLabs workspace имеет внешний webhook; Dev-сессия заблокирована без изменения рабочего подключения");
  }
  async request(path: string, body?: object, method = body ? "POST" : "GET"): Promise<any> {
    if (!process.env.ELEVENLABS_API_KEY) throw new ElevenLabError(503, "ElevenLabs API не настроен");
    const r = await fetch(`https://api.elevenlabs.io${path}`, {
      method, headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000), redirect: "error",
    });
    if (!r.ok) {
      const detail = await r.json().catch(() => null) as any;
      if (detail?.detail?.status === "custom_llm_not_allowed_in_with_agent_with_ivc_voice")
        throw new ElevenLabError(409, "ElevenLabs запрещает Custom LLM с Instant Voice Clone; сохранённый голос не заменён");
      throw new ElevenLabError(r.status === 404 ? 404 : 503, `ElevenLabs HTTP ${r.status}: доступ/настройки не подтверждены; подмены нет`);
    }
    return r.status === 204 ? {} : r.json();
  }
  async voice(id: string) {
    const v = await this.request(`/v1/voices/${encodeURIComponent(id)}`);
    if (v.voice_id !== id) throw new ElevenLabError(503, "ElevenLabs: voice ID не подтверждён");
    return v;
  }
  configuration(name: string, voiceId: string, capability: string) {
    return {
      name,
      conversation_config: {
        asr: { provider: "scribe_realtime", quality: "high", user_input_audio_format: "pcm_16000" },
        tts: { voice_id: voiceId, model_id: ELEVEN_TTS_MODEL, agent_output_audio_format: "pcm_16000",
          stability: 0.5, similarity_boost: 0.8, speed: 1 },
        agent: { first_message: "", language: "en", disable_first_message_interruptions: false,
          prompt: { llm: "custom-llm", prompt: "Audio transport only. All business replies, permissions and tools are controlled by TalkHint.",
            custom_llm: { url: `${elevenDevBase()}/eleven-engine-llm/${capability}/v1/chat/completions`,
              model_id: SECRETARY_REASONING_MODEL, api_type: "chat_completions" },
            tools: [], tool_ids: [], knowledge_base: [], rag: { enabled: false },
            backup_llm_config: { preference: "disabled" } } },
        turn: { turn_timeout: 15, silence_end_call_timeout: -1, turn_eagerness: "normal", speculative_turn: false,
          spelling_patience: "auto", soft_timeout_config: { timeout_seconds: -1 } },
        conversation: { max_duration_seconds: 300, client_events: [
          "conversation_initiation_metadata", "audio", "interruption", "user_transcript", "agent_response",
          "agent_response_correction", "vad_score", "ping",
        ] },
      },
      platform_settings: { auth: { enable_auth: true },
        workspace_overrides: { webhooks: { post_call_webhook_id: null, events: [], send_audio: false } },
        privacy: { record_voice: false, retention_days: 1, delete_audio: true, delete_transcript_and_pii: true },
      },
    };
  }
  async create(voiceId: string, capability: string, id: string) {
    const config = this.configuration(`TalkHint ElevenLabs Engine DEV ${id}`, voiceId, capability);
    const r = await this.request("/v1/convai/agents/create", config);
    if (typeof r.agent_id !== "string") throw new ElevenLabError(503, "Создание Dev-аудиоагента не подтверждено");
    return r.agent_id as string;
  }
  async inspect(id: string, voiceId: string, capability: string) {
    const a = await this.request(`/v1/convai/agents/${encodeURIComponent(id)}`);
    const c = a.conversation_config, p = c?.agent?.prompt;
    if (!a.name?.startsWith("TalkHint ElevenLabs Engine DEV ") || p?.llm !== "custom-llm" ||
        p.custom_llm?.url !== this.configuration("", voiceId, capability).conversation_config.agent.prompt.custom_llm.url ||
        p.custom_llm?.model_id !== SECRETARY_REASONING_MODEL ||
        p.backup_llm_config?.preference !== "disabled" || p.tools?.length || p.tool_ids?.length ||
        p.knowledge_base?.length || p.rag?.enabled ||
        c?.tts?.voice_id !== voiceId || c.tts.model_id !== ELEVEN_TTS_MODEL ||
        c.asr?.provider !== "scribe_realtime" || c.turn?.speculative_turn !== false ||
        !c.conversation?.client_events?.includes("interruption") || c.conversation.max_duration_seconds !== 300 ||
        a.platform_settings?.auth?.enable_auth !== true || a.platform_settings?.privacy?.record_voice !== false ||
        a.platform_settings.privacy.retention_days !== 1 || a.platform_settings.privacy.delete_audio !== true ||
        a.platform_settings.privacy.delete_transcript_and_pii !== true ||
        a.platform_settings.workspace_overrides?.webhooks?.post_call_webhook_id) {
      throw new ElevenLabError(503, "ElevenLabs Custom LLM / голос / безопасность не совпадают; запуск запрещён");
    }
    await this.workspaceSafe();
  }
  async signedUrl(id: string) {
    const r = await this.request(`/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(id)}`);
    const url = new URL(r.signed_url);
    if (url.protocol !== "wss:" || url.hostname !== "api.elevenlabs.io" || url.pathname !== "/v1/convai/conversation")
      throw new ElevenLabError(503, "ElevenLabs: неподдерживаемый transport URL");
    return url.href;
  }
  async remove(id: string) {
    try { await this.request(`/v1/convai/agents/${encodeURIComponent(id)}`, undefined, "DELETE"); }
    catch (e) { if (!(e instanceof ElevenLabError && e.status === 404)) throw e; }
  }
  socket(url: string) { return new WebSocket(url, ["convai"], { maxPayload: 256 * 1024, handshakeTimeout: 12_000 }); }
}
