import { randomBytes, createHash } from "node:crypto";
import type WebSocket from "ws";
import { RetellApi, RetellApiError, RETELL_LAB_MODEL, RETELL_LAB_VOICE } from "./retellApi";
import { RetellSecretaryLab, type RetellLabProfile } from "./retell";
import { SecretaryConversationEngine, type EngineStream, type SpokenTurn } from "../secretary/conversationEngine";
import { SECRETARY_TEST_CONTEXT } from "./testContext";
import type { PersonalityBinding } from "../secretary/personalities/types";
import type { OutgoingContext } from "../secretary/personalities/outgoing";

export const RETELL_ENGINE_AGENT = "TalkHint Secretary Lab — Retell + Engine Dev";
const fail = (text: string): never => { throw new RetellApiError(409, text); };
export function engineCallbackBase() {
  const host = process.env.REPLIT_DEV_DOMAIN;
  if (!host || !/^[a-z0-9.-]+\.replit\.dev$/i.test(host)) return fail("Retell + Engine: публичный Dev-домен не определён; Custom LLM не подключён");
  return `wss://${host}/retell-engine-stream/{{talkhint_engine_ticket}}`;
}
export class RetellEngineApi extends RetellApi {
  constructor(private callback = engineCallbackBase, network?: ConstructorParameters<typeof RetellApi>[0]) { super(network); }
  async inspectAgent(id: string) {
    const a = await this.request(`/get-agent/${encodeURIComponent(id)}`);
    if (a.agent_name !== RETELL_ENGINE_AGENT || a.response_engine?.type !== "custom-llm" ||
        a.response_engine.llm_websocket_url !== this.callback() || a.voice_id !== RETELL_LAB_VOICE ||
        a.interruption_sensitivity !== 0.9 || a.responsiveness !== 1 || a.enable_backchannel !== false ||
        a.max_call_duration_ms !== 300_000 || a.end_call_after_silence_ms !== 300_000 ||
        a.data_storage_setting !== "basic_attributes_only" || a.webhook_events?.length !== 0 ||
        a.contact_memory_config?.enable_read !== false || a.contact_memory_config?.enable_update !== false ||
        a.pre_session_tools?.length || a.post_session_tools?.length || a.fallback_voice_ids?.length ||
        !Array.isArray(a.language) || ["en-US", "ru-RU", "es-ES"].some(l => !a.language.includes(l))) {
      return fail("Retell + Engine: Custom LLM/голос/настройки не совпадают; автоматической подмены нет");
    }
    return { id: a.agent_id as string, version: a.version as number, model: RETELL_LAB_MODEL, voice: RETELL_LAB_VOICE };
  }
  async ensureAgent() {
    const matches = (await this.listAgents()).filter(a => a.agent_name === RETELL_ENGINE_AGENT);
    if (matches.length > 1) return fail("Retell + Engine: дублирующиеся агенты");
    if (matches.length) return this.inspectAgent(matches[0].agent_id);
    const a = await this.request("/create-agent", {
      agent_name: RETELL_ENGINE_AGENT,
      response_engine: { type: "custom-llm", llm_websocket_url: this.callback() },
      voice_id: RETELL_LAB_VOICE, language: ["en-US", "ru-RU", "es-ES"],
      interruption_sensitivity: 0.9, responsiveness: 1, enable_backchannel: false,
      data_storage_setting: "basic_attributes_only", max_call_duration_ms: 300_000,
      end_call_after_silence_ms: 300_000, webhook_events: [], fallback_voice_ids: [],
      contact_memory_config: { enable_read: false, enable_update: false },
    });
    if (typeof a.agent_id !== "string") return fail("Retell + Engine: создание Custom LLM агента не подтверждено");
    return this.inspectAgent(a.agent_id);
  }
}
type Entry = {
  id: string; ticket: string; callId?: string; engine: SecretaryConversationEngine;
  socket?: WebSocket; abort?: AbortController; responseId: number; epoch: number;
  handled: Set<number>; introduced: boolean; closed: boolean; expiresAt: number;
  pending?: number;
};
/** Per-session high-entropy capability, not an owner bearer token or permanent Retell key.
 * Retell's Custom LLM socket has no signature/auth header. Never log these URL paths. */
export class RetellEngineRegistry {
  private pendingWrites = new Map<string, Promise<void>>();
  async flush(id: string) { await this.pendingWrites.get(id); }
  private entries = new Map<string, Entry>();
  private tickets = new Map<string, Entry>();
  constructor(private stream?: EngineStream, private options: {
    phone?: boolean;
    onTranscript?: (id: string, turns: SpokenTurn[]) => Promise<void>;
    onFailure?: (id: string) => void;
  } = {}) {}
  reserve(owner: string, instruction: string, id: string, personality?: PersonalityBinding, facts: OutgoingContext["cards"] = []) {
    const ticket = randomBytes(32).toString("hex");
    const entry: Entry = { id, ticket, engine: new SecretaryConversationEngine(owner, instruction, this.stream, this.options.phone, personality, facts),
      responseId: -1, epoch: 0, handled: new Set(), introduced: false, closed: false, expiresAt: Date.now() + 300_000 };
    this.entries.set(id, entry); this.tickets.set(ticket, entry);
    if (this.options.phone) {
      const expiry = setTimeout(() => {
        if (!entry.closed) {
          this.options.onFailure?.(id);
          this.ended(id);
        }
      }, 300_000);
      expiry.unref();
    }
    return { ticket, engine: entry.engine.report, promptHash: createHash("sha256").update(entry.engine.instructions).digest("hex") };
  }
  registered(id: string, callId: string) { const entry = this.entries.get(id); if (entry) entry.callId = callId; }
  ended(id: string) {
    const entry = this.entries.get(id); if (!entry) return;
    entry.closed = true; entry.abort?.abort(); entry.engine.report.connected = false;
    entry.socket?.close(1000, "Test ended"); this.entries.delete(id); this.tickets.delete(entry.ticket);
    this.pendingWrites.delete(id);
  }
  private entry(path: string) {
    const match = (this.options.phone
      ? /^\/retell-phone-engine\/([a-f0-9]{64})\/([A-Za-z0-9_-]{1,120})$/
      : /^\/retell-engine-stream\/([a-f0-9]{64})\/([A-Za-z0-9_-]{1,120})$/).exec(path);
    if (!match) return undefined;
    const entry = this.tickets.get(match[1]);
    if (!entry || entry.closed || Date.now() > entry.expiresAt || (entry.callId && entry.callId !== match[2])) return undefined;
    return { entry, callId: match[2] };
  }
  permits(path: string) { return !!this.entry(path); }
  attach(ws: WebSocket, path: string) {
    const found = this.entry(path);
    if (!found) { ws.close(1008, "Dev session denied"); return; }
    const { entry, callId } = found;
    // Admission and provider callback can race. Wait for the known admission ID, never trust call_details alone.
    const started = Date.now();
    const wait = () => {
      if (entry.closed || ws.readyState !== 1) return;
      if (!entry.callId) {
        if (Date.now() - started > 8000) { ws.close(1008, "Admission unconfirmed"); return; }
        setTimeout(wait, 25).unref(); return;
      }
      if (entry.callId !== callId) { ws.close(1008, "Call identity mismatch"); return; }
      this.bind(ws, entry);
    };
    wait();
  }
  private bind(ws: WebSocket, entry: Entry) {
    let persisted = Promise.resolve();
    const transcript = (frame: any) => {
      if (!this.options.onTranscript || !Array.isArray(frame.transcript)) return;
      if (frame.transcript.length > 300 ||
        frame.transcript.some((t: any) => !["agent", "user"].includes(t?.role) ||
          typeof t.content !== "string" || t.content.length > 4000)) {
        ws.close(1008, "Invalid transcript"); return;
      }
      const turns = frame.transcript.map((t: any) => ({ role: t.role, content: t.content }));
      persisted = persisted.then(() => this.options.onTranscript!(entry.id, turns)).catch(() => {
        ws.close(1011, "Transcript persistence failed");
        this.options.onFailure?.(entry.id);
      });
      this.pendingWrites.set(entry.id, persisted);
    };
    const previous = entry.socket;
    entry.abort?.abort(); entry.epoch++;
    entry.pending = undefined;
    entry.socket = ws;
    previous?.close(1000, "Connection replaced");
    entry.engine.report.connected = true; entry.engine.record("custom_llm_connected");
    const send = (frame: object) => {
      if (ws.readyState !== 1 || entry.socket !== ws || entry.closed) return false;
      if (ws.bufferedAmount > 256 * 1024) { ws.close(1011, "Output backpressure"); return false; }
      ws.send(JSON.stringify(frame)); return true;
    };
    const abort = () => {
      entry.epoch++; entry.abort?.abort(); entry.engine.record("response_cancelled");
    };
    const reply = (id: number, turns: SpokenTurn[], reminder = false) => {
      if (entry.handled.has(id) || id <= entry.responseId) {
        if (entry.pending !== id) send({ response_type: "response", response_id: id, content: "", content_complete: true });
        return;
      }
      abort(); entry.responseId = id; entry.handled.add(id);
      entry.pending = id;
      const epoch = entry.epoch, controller = new AbortController(); entry.abort = controller;
      let endCall = false;
      const current = () => !entry.closed && entry.socket === ws && epoch === entry.epoch;
      const timeout = setTimeout(() => {
        if (current()) {
          entry.engine.record("engine_timeout");
          send({ response_type: "response", response_id: id, content: "Извините, ответ задерживается. Попробуйте ещё раз.", content_complete: false });
        }
        controller.abort();
      }, 25_000); timeout.unref();
      entry.engine.record("response_started");
      void entry.engine.respond(turns, controller.signal, text => {
        if (current() && !controller.signal.aborted) send({ response_type: "response", response_id: id, content: text, content_complete: false });
      }, reminder).then(end => {
        endCall = !!(this.options.phone && end && current() && !controller.signal.aborted);
      }).catch(() => {
        if (current() && !controller.signal.aborted) {
          entry.engine.record("engine_error");
          send({ response_type: "response", response_id: id, content: "Извините, сейчас не удалось получить ответ. Никакие реальные действия не выполнены.", content_complete: false });
        }
      }).finally(() => {
        clearTimeout(timeout);
        // Interrupted/old responses never resume; a timeout still closes the CURRENT response.
        if (current()) { entry.pending = undefined; send({ response_type: "response", response_id: id, content: "", content_complete: true,
          ...(endCall ? { end_call: true } : {}) }); entry.engine.record("response_complete"); }
      });
    };
    send({ response_type: "config", config: { auto_reconnect: true, call_details: true } });
    ws.on("message", (raw, binary) => {
      if (entry.socket !== ws || entry.closed) return;
      if (binary || raw.toString().length > 64 * 1024) { ws.close(1009, "Invalid frame"); return; }
      let frame: any;
      try { frame = JSON.parse(raw.toString()); } catch { ws.close(1008, "Invalid JSON"); return; }
      if (frame.interaction_type === "ping_pong") {
        if (Number.isFinite(frame.timestamp)) send({ response_type: "ping_pong", timestamp: frame.timestamp });
        return;
      }
      if (frame.interaction_type === "call_details") {
        if (frame.call?.call_id !== entry.callId ||
          frame.call?.call_type !== (this.options.phone ? "phone_call" : "web_call")) { ws.close(1008, "Registered call identity required"); return; }
        if (!entry.introduced) {
          entry.introduced = true;
          reply(0, [{ role: "user", content: this.options.phone
            ? "Begin the authorized telephone conversation using the trusted standard secretary introduction and actual assignment. Then listen."
            : "Begin the authorized TEST conversation using the trusted standard secretary introduction. Then listen." }]);
        } else send({ response_type: "response", response_id: 0, content: "", content_complete: true });
        return;
      }
      if (frame.interaction_type === "update_only") {
        transcript(frame);
        if (frame.turntaking === "user_turn") abort();
        return;
      }
      if (!["response_required", "reminder_required"].includes(frame.interaction_type)) return;
      if (!Number.isSafeInteger(frame.response_id) || frame.response_id < 1 || frame.response_id > 10_000 ||
          !Array.isArray(frame.transcript) || frame.transcript.length > 300 ||
          frame.transcript.some((t: any) => !["agent", "user"].includes(t?.role) || typeof t?.content !== "string" || t.content.length > 4000)) {
        ws.close(1008, "Invalid response request"); return;
      }
      reply(frame.response_id, frame.transcript.map((t: any) => ({ role: t.role, content: t.content })), frame.interaction_type === "reminder_required");
      transcript(frame);
    });
    const close = () => {
      if (entry.socket !== ws) return;
      abort(); entry.socket = undefined; entry.engine.report.connected = false;
      entry.engine.record("custom_llm_disconnected");
      if (this.options.phone && !entry.closed) {
        const grace = setTimeout(() => {
          if (!entry.closed && !entry.socket) this.options.onFailure?.(entry.id);
        }, 8000);
        grace.unref();
      }
    };
    ws.on("close", close); ws.on("error", close);
  }
  dispose() { for (const id of Array.from(this.entries.keys())) this.ended(id); }
}
let modelCheckedAt = 0;
async function checkEngine() {
  const callback = engineCallbackBase();
  if (!process.env.OPENAI_API_KEY) return fail("Retell + Engine: OpenAI для нашего Engine не настроен");
  if (Date.now() - modelCheckedAt > 60_000) {
    const r = await fetch(`https://api.openai.com/v1/models/${RETELL_LAB_MODEL}`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    if (!r.ok || (await r.json()).id !== RETELL_LAB_MODEL) return fail("Retell + Engine: доступ нашего OpenAI к gpt-6.1-sol не подтверждён");
    modelCheckedAt = Date.now();
  }
  return { mode: "retell-engine", stage: "configuration_verified", callbackConfigured: !!callback, engine: {
    provider: "OpenAI via TalkHint", model: RETELL_LAB_MODEL, tools: SECRETARY_TEST_CONTEXT.permissions,
    context: SECRETARY_TEST_CONTEXT, testOnly: true,
  } };
}
export const retellEngineRegistry = new RetellEngineRegistry();
const profile: RetellLabProfile = {
  agentName: RETELL_ENGINE_AGENT, mode: "retell-engine", check: checkEngine,
  reserve: (...args) => retellEngineRegistry.reserve(...args),
  registered: (...args) => retellEngineRegistry.registered(...args),
  ended: id => retellEngineRegistry.ended(id),
};
export const retellEngineLab = new RetellSecretaryLab(new RetellEngineApi(), Date.now,
  () => process.env.NODE_ENV === "development", profile);
setInterval(() => retellEngineLab.sweep(), 60_000).unref();
