import { SECRETARY_CALL_LIMIT_MS } from "../secretary/limits";
import { randomBytes, createHash } from "node:crypto";
import type WebSocket from "ws";
import { SpeedLimitError, speedLimitText } from "./speedRequestBudget";
import { RetellApi, RetellApiError, RETELL_LAB_MODEL, RETELL_LAB_VOICE } from "./retellApi";
import { RetellSecretaryLab, type RetellLabProfile } from "./retell";
import { SecretaryConversationEngine, type EngineStream, type SpokenTurn, type TelephoneTools } from "../secretary/conversationEngine";
import { SECRETARY_TEST_CONTEXT } from "./testContext";
import type { PersonalityBinding } from "../secretary/personalities/types";
import type { OutgoingContext } from "../secretary/personalities/outgoing";
import { speedEngine, speedLab } from "./speedRuntime";
import type { SpeedVariant } from "./speedExperiment";
import { CResponseBuffer } from "./cResponseBuffer";
import { phoneSpeechTiming } from "../secretary/phoneMetrics";
import { voicemailTurn } from "../secretary/voicemail";
import { PhoneLineGuard, type NoHumanReason } from "../secretary/phoneLineGuard";
import { DevWaitingPolicy, WAITING_DEV_DURATION_MS, WAITING_DEV_SUFFIX } from "./waitingPolicy";
import { waitingAudit } from "./waitingAudit";
import { rehearsalBindings } from "./rehearsalBinding";
import { devColleagueSpeech, devQuestion, devProviderHasText } from "../rehearsal/manners";

export const RETELL_ENGINE_AGENT = "TalkHint Secretary Lab — Retell + Engine Dev";
const fail = (text: string): never => { throw new RetellApiError(409, text); };
export function engineCallbackBase() {
  const host = process.env.REPLIT_DEV_DOMAIN;
  if (!host || !/^[a-z0-9.-]+\.replit\.dev$/i.test(host)) return fail("Retell + Engine: публичный Dev-домен не определён; Custom LLM не подключён");
  return `wss://${host}/retell-engine-stream/{{talkhint_engine_ticket}}`;
}
export class RetellEngineApi extends RetellApi {
  constructor(private callback = engineCallbackBase, network?: ConstructorParameters<typeof RetellApi>[0],
    private speedVariant: "A" | "B" | "C" = "A", private rehearsalHash?: string) { super(network); }
  private get agentName() { return this.rehearsalHash ? `TalkHint Rehearsal DEV · ${this.rehearsalHash}` : this.speedVariant === "A" ? RETELL_ENGINE_AGENT :
    `${RETELL_ENGINE_AGENT} · speed ${this.speedVariant}${this.speedVariant === "C" ? WAITING_DEV_SUFFIX : ""}`; }
  private get durationMs() { return this.rehearsalHash ? 180_000 : this.speedVariant === "C" ? WAITING_DEV_DURATION_MS : 300_000; }
  async inspectAgent(id: string) {
    const a = await this.request(`/get-agent/${encodeURIComponent(id)}`);
    if (a.agent_name !== this.agentName || a.response_engine?.type !== "custom-llm" ||
        a.response_engine.llm_websocket_url !== this.callback() || a.voice_id !== RETELL_LAB_VOICE ||
        a.interruption_sensitivity !== (this.speedVariant === "A" ? 0.9 : 0.85) || a.responsiveness !== 1 || a.enable_backchannel !== false ||
        (this.speedVariant !== "A" && (a.enable_dynamic_responsiveness !== true || a.stt_mode !== "fast")) ||
        a.max_call_duration_ms !== this.durationMs || a.end_call_after_silence_ms !== this.durationMs ||
        a.data_storage_setting !== (this.rehearsalHash ? "everything" : "basic_attributes_only") || a.webhook_events?.length !== 0 ||
        a.contact_memory_config?.enable_read !== false || a.contact_memory_config?.enable_update !== false ||
        a.pre_session_tools?.length || a.post_session_tools?.length || a.fallback_voice_ids?.length ||
        !Array.isArray(a.language) || ["en-US", "ru-RU", "es-ES"].some(l => !a.language.includes(l))) {
      return fail("Retell + Engine: Custom LLM/голос/настройки не совпадают; автоматической подмены нет");
    }
    return { id: a.agent_id as string, version: a.version as number, model: this.speedVariant === "C" ? "gpt-6-sol" : RETELL_LAB_MODEL, voice: RETELL_LAB_VOICE };
  }
  async ensureAgent() {
    const matches = (await this.listAgents()).filter(a => a.agent_name === this.agentName);
    if (matches.length > 1) return fail("Retell + Engine: дублирующиеся агенты");
    if (matches.length) return this.inspectAgent(matches[0].agent_id);
    const a = await this.request("/create-agent", {
      agent_name: this.agentName,
      response_engine: { type: "custom-llm", llm_websocket_url: this.callback() },
      voice_id: RETELL_LAB_VOICE, language: ["en-US", "ru-RU", "es-ES"],
      interruption_sensitivity: this.speedVariant === "A" ? 0.9 : 0.85, responsiveness: 1, enable_backchannel: false,
      ...(this.speedVariant === "A" ? {} : { enable_dynamic_responsiveness: true, stt_mode: "fast" }),
      data_storage_setting: this.rehearsalHash ? "everything" : "basic_attributes_only", max_call_duration_ms: this.durationMs,
      end_call_after_silence_ms: this.durationMs, webhook_events: [], fallback_voice_ids: [],
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
  commandCompleted?: number; interruptSequence?: number;
  buffer?: CResponseBuffer;
  lineGuard?: PhoneLineGuard;
  phoneGreetingSent?: boolean;
  voicemailMessageSent?: boolean;
  noHumanEnded?: boolean;
  waiting?: DevWaitingPolicy;
  waitingTimer?: ReturnType<typeof setInterval>;
};
function refreshWaitingReport(entry: Entry) {
  if (entry.waiting) (entry.engine.report as any).waiting = {
    ...entry.waiting.snapshot, audit: waitingAudit(entry.waiting.events),
  };
}
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
    onNoHuman?: (id: string, reason: NoHumanReason) => Promise<void>;
    telephoneTools?: (id: string) => TelephoneTools;
    createEngine?: (owner: string, instruction: string, id: string, personality?: PersonalityBinding) => SecretaryConversationEngine;
    bufferResponses?: (id: string) => boolean;
    phoneProfile?: (id: string) => "C" | "legacy";
    waitingRules?: (id: string) => boolean;
  } = {}) {}
  reserve(owner: string, instruction: string, id: string, personality?: PersonalityBinding, facts: OutgoingContext["cards"] = []) {
    const ticket = randomBytes(32).toString("hex");
    if (this.options.phone && this.options.createEngine) throw Error("Lab engine factory cannot enter telephone");
    const engine = this.options.createEngine?.(owner, instruction, id, personality) ??
      new SecretaryConversationEngine(owner, instruction, this.stream, this.options.phone, personality, facts,
        this.options.phone ? this.options.telephoneTools?.(id) : undefined, undefined,
        this.options.phone ? this.options.phoneProfile?.(id) : undefined);
    const entry: Entry = { id, ticket, engine,
      responseId: -1, epoch: 0, handled: new Set(), introduced: false, closed: false,
      expiresAt: Date.now() + (this.options.phone ? SECRETARY_CALL_LIMIT_MS : 300_000) };
    if (!this.options.phone && process.env.NODE_ENV === "development" && process.env.REPLIT_DEPLOYMENT !== "1" &&
      this.options.waitingRules?.(id)) {
      entry.waiting = new DevWaitingPolicy(Date.now, rehearsalBindings.get(id)?.manners ? { colleague: devColleagueSpeech } : undefined);
      entry.expiresAt = Date.now() + WAITING_DEV_DURATION_MS;
      refreshWaitingReport(entry);
    }
    this.entries.set(id, entry); this.tickets.set(ticket, entry);
    if (this.options.phone) {
      const expiry = setTimeout(() => {
        if (!entry.closed) {
          this.options.onFailure?.(id);
          this.ended(id);
        }
      }, SECRETARY_CALL_LIMIT_MS);
      expiry.unref();
    }
    return { ticket, engine: entry.engine.report, promptHash: createHash("sha256").update(entry.engine.instructions).digest("hex") };
  }
  registered(id: string, callId: string) { const entry = this.entries.get(id); if (entry) entry.callId = callId; }
  waitingAudio(id: string, active: boolean, agentSpeaking: boolean) {
    const entry = this.entries.get(id);
    if (this.options.phone || process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1" ||
      !entry?.waiting || entry.closed) throw Object.assign(Error("WAITING_DEV_C_ONLY"), { status: 404 });
    entry.waiting.audio(active, agentSpeaking);
    refreshWaitingReport(entry);
  }
  waitingPlaybackEnded(id: string) {
    const entry = this.entries.get(id);
    if (this.options.phone || process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1" ||
      !entry?.waiting || entry.closed) throw Object.assign(Error("WAITING_DEV_C_ONLY"), { status: 404 });
    entry.waiting.playbackEnded();
    refreshWaitingReport(entry);
  }
  diagnostics(id: string) {
    const report = this.entries.get(id)?.engine.report;
    if (!report) return undefined;
    return structuredClone({ model: report.model, runtime: report.phoneRuntime,
      usage: report.usage, events: report.events, interruption: (report as any).cInterruption ?? null,
      playback: (report as any).playback ?? [] });
  }
  /** Native Retell DTMF on the EXISTING SIP bridge; never redirect Twilio or restart media. */
  pressDigits(id: string, digits: string, signal?: AbortSignal, menuHash?: string) {
    const entry = this.entries.get(id), ws = entry?.socket;
    if (!this.options.phone || !entry || entry.closed || !ws || ws.readyState !== 1 ||
      signal?.aborted || (entry.buffer && !entry.buffer.permitsTools()) ||
      !/^[0-9*#]{1,5}$/.test(digits) || ws.bufferedAmount > 256 * 1024)
      throw Error("Current telephone transport unavailable");
    if (entry.pending !== undefined && signal === entry.abort?.signal) {
      ws.send(JSON.stringify({ response_type: "response", response_id: entry.pending, content: "",
        content_complete: true, digit_to_press: digits }));
      entry.commandCompleted = entry.pending;
    } else {
      entry.abort?.abort(); entry.epoch++; entry.pending = undefined;
      entry.interruptSequence = (entry.interruptSequence ?? 0) + 1;
      ws.send(JSON.stringify({ response_type: "agent_interrupt", interrupt_id: entry.interruptSequence,
        content: "", content_complete: true, digit_to_press: digits }));
    }
    if (menuHash) entry.lineGuard?.progress(menuHash); // Same menu/ASR or repeat digit is not progress.
  }
  ended(id: string) {
    const entry = this.entries.get(id); if (!entry) return;
    entry.closed = true; clearInterval(entry.waitingTimer); entry.lineGuard?.close(); entry.buffer?.close(); entry.abort?.abort(); entry.engine.report.connected = false;
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
      (entry.engine.report as any).playback = phoneSpeechTiming(frame.transcript);
      persisted = persisted.then(() => this.options.onTranscript!(entry.id, turns)).catch(() => {
        ws.close(1011, "Transcript persistence failed");
        this.options.onFailure?.(entry.id);
      });
      this.pendingWrites.set(entry.id, persisted);
    };
    const previous = entry.socket;
    entry.buffer?.close();
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
    let openingTimer: ReturnType<typeof setTimeout> | undefined;
    let firstGreetingSpeech: string | undefined;
    const speechKey = (turns: SpokenTurn[]) => turns.filter(t => t.role === "user")
      .map(t => t.content).join(" ").toLowerCase().replace(new RegExp("[^\\p{L}\\p{N}]+", "gu"), " ").trim();
    const heardOpening = (turns: any) => {
      if (!this.options.phone || !Array.isArray(turns) ||
        !turns.some(t => t?.role === "user" && t.content?.trim())) return;
      entry.engine.opening.heardSpeech = true;
      if (openingTimer) {
        clearTimeout(openingTimer); openingTimer = undefined;
        send({ response_type: "response", response_id: 0, content: "", content_complete: true });
      }
    };
    const abort = () => {
      entry.epoch++; entry.abort?.abort(); entry.engine.record("response_cancelled");
    };
    let labLimitEnded = false;
    let buffered = (this.options.phone ? entry.engine.report.phoneRuntime?.variant === "C" :
      process.env.NODE_ENV === "development" && process.env.REPLIT_DEPLOYMENT !== "1" && this.options.bufferResponses?.(entry.id))
      ? new CResponseBuffer({
        advanceCompletedTurn: !this.options.phone && process.env.NODE_ENV === "development" &&
          process.env.REPLIT_DEPLOYMENT !== "1" && rehearsalBindings.get(entry.id)?.advanceCompletedTurn === true,
        ...(!this.options.phone && rehearsalBindings.get(entry.id)?.manners ? {
          bridgeAllowed: (turns: SpokenTurn[]) => !devQuestion(turns),
          providerHasText: devProviderHasText, firstTextReason: "dev_streaming_text_delta",
          discardOnInterruption: true, interruptionActive: () => entry.waiting?.callerAudioActive ?? true,
        } : {}),
        generate: (turns, signal, emit, reminder) => entry.engine.respond(turns, signal, emit, reminder),
        send: frame => entry.commandCompleted === (frame as any).response_id ? true : send(frame),
        record: event => entry.engine.record(event),
        onGeneration: (controller, id) => {
          entry.pending = id;
          // The same signal must guard IVR side effects and stale generations.
          entry.abort = controller;
        },
        error: error => {
          if (this.options.phone) return {
            message: "Извините, сейчас не удалось получить ответ. Никакие реальные действия не выполнены.", end: false };
          const limited = error instanceof SpeedLimitError;
          if (limited) entry.engine.record("lab_budget_limit_reached");
          return { message: limited ? speedLimitText(error.code) :
            "Извините, сейчас не удалось получить ответ. Никакие реальные действия не выполнены.", end: true };
        },
      }) : undefined;
    entry.buffer = buffered;
    if (buffered) (entry.engine.report as any).cInterruption = buffered.metrics;
    let waitingReply: { id: number; turns: SpokenTurn[] } | undefined;
    clearInterval(entry.waitingTimer);
    if (entry.waiting) {
      entry.waitingTimer = setInterval(() => {
        if (entry.closed || entry.socket !== ws || ws.readyState !== 1) return;
        const action = entry.waiting!.tick();
        refreshWaitingReport(entry);
        if (!action) return;
        if (action.resume && waitingReply) {
          const pending = waitingReply; waitingReply = undefined;
          reply(pending.id, pending.turns); return;
        }
        waitingReply = undefined;
        buffered?.suspendForWaiting(); abort(); entry.pending = undefined;
        send({ response_type: "agent_interrupt", interrupt_id: (entry.interruptSequence = (entry.interruptSequence ?? 0) + 1),
          content: action.text, content_complete: true, ...(action.end ? { end_call: true } : {}) });
        entry.engine.record(action.end ? "dev_waiting_expired" : action.acknowledgement ?
          "dev_waiting_acknowledged" : action.resume ? "dev_waiting_resumed" : "dev_waiting_probe");
      }, 250);
      entry.waitingTimer.unref();
    }
    const waitingInput = (turns: SpokenTurn[], speaking: boolean, complete: boolean) => {
      const users = turns.filter(t => t.role === "user");
      const last = users.at(-1);
      if (last) entry.waiting?.observe(last.content, speaking, complete, `${users.length}:${last.content}`);
      refreshWaitingReport(entry);
      if (entry.waiting?.waiting) {
        if (waitingReply) {
          if (entry.waiting.awaitingPause) waitingReply.turns = turns;
          else waitingReply = undefined;
        }
        buffered?.suspendForWaiting(); abort();
        return true;
      }
      waitingReply = undefined;
      return false;
    };
    const reply = (id: number, turns: SpokenTurn[], reminder = false) => {
      if (rehearsalBindings.has(entry.id) && !turns.some(t => t.role === "user")) {
        send({ response_type: "response", response_id: id, content: "", content_complete: true });
        return;
      }
      if (entry.noHumanEnded) return;
      if (entry.waiting?.waiting) {
        const acknowledgement = !reminder && entry.waiting.takeAcknowledgement();
        if (acknowledgement) {
          waitingReply = undefined;
          send({ response_type: "response", response_id: id, content: acknowledgement.text, content_complete: true });
          entry.engine.record("dev_waiting_acknowledged"); refreshWaitingReport(entry);
          return;
        }
        if (entry.waiting.awaitingPause) {
          waitingReply = { id, turns }; return;
        }
        send({ response_type: "response", response_id: id, content: "", content_complete: true });
        return;
      }
      const vm = this.options.phone && (voicemailTurn(turns) || entry.lineGuard?.voicemail);
      if (vm && buffered) { buffered.close(); buffered = undefined; entry.buffer = undefined; }
      if (vm && entry.voicemailMessageSent) {
        send({ response_type: "response", response_id: id, content: "", content_complete: true, end_call: true });
        return;
      }
      // Silent opening/IVR must never acquire the C buffer's filler timer.
      const openingSilent = this.options.phone && !entry.engine.opening.permit(turns) && !voicemailTurn(turns);
      const firstGreeting = this.options.phone && !entry.phoneGreetingSent && !openingSilent && !vm;
      if (buffered && !openingSilent && !vm) { entry.pending = id; buffered.request(id, turns, reminder); return; }
      if (labLimitEnded) {
        send({ response_type: "response", response_id: id, content: "", content_complete: true, end_call: true });
        return;
      }
      if (entry.handled.has(id) || id <= entry.responseId) {
        if (entry.pending !== id) send({ response_type: "response", response_id: id, content: "", content_complete: true });
        return;
      }
      abort(); entry.responseId = id; entry.handled.add(id);
      firstGreetingSpeech = firstGreeting ? speechKey(turns) : undefined;
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
        if (current() && !controller.signal.aborted) {
          if (send({ response_type: "response", response_id: id, content: text, content_complete: false }) && firstGreeting && text.trim())
            entry.phoneGreetingSent = true;
        }
      }, reminder, !!vm).then(end => {
        endCall = !!(this.options.phone && end && current() && !controller.signal.aborted);
      }).catch((error: unknown) => {
        if (current() && !controller.signal.aborted) {
          if (!this.options.phone && process.env.NODE_ENV === "development" && process.env.REPLIT_DEPLOYMENT !== "1" &&
            error instanceof SpeedLimitError) {
            labLimitEnded = true;
            entry.engine.record("lab_budget_limit_reached");
            send({ response_type: "response", response_id: id, content: speedLimitText(error.code), content_complete: false });
            endCall = true;
            return;
          }
          entry.engine.record("engine_error");
          send({ response_type: "response", response_id: id, content: "Извините, сейчас не удалось получить ответ. Никакие реальные действия не выполнены.", content_complete: false });
        }
      }).finally(() => {
        clearTimeout(timeout);
        if (current() && endCall && vm) {
          entry.voicemailMessageSent = true;
          if (!entry.engine.skipsVoicemail) entry.lineGuard?.close();
        }
        // Interrupted/old responses never resume; a timeout still closes the CURRENT response.
        if (current()) { firstGreetingSpeech = undefined; entry.pending = undefined; if (entry.commandCompleted !== id) send({ response_type: "response", response_id: id, content: "", content_complete: true,
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
          if (rehearsalBindings.has(entry.id)) {
            entry.engine.record("rehearsal_listen_first");
            return;
          }
          if (this.options.phone) {
            entry.lineGuard ??= new PhoneLineGuard(entry.engine.skipsVoicemail, reason => {
              if (entry.closed || entry.noHumanEnded) return;
              entry.noHumanEnded = true;
              buffered?.close(); abort();
              entry.engine.record(reason);
              send({ response_type: "agent_interrupt", interrupt_id: (entry.interruptSequence = (entry.interruptSequence ?? 0) + 1),
                content: "", content_complete: true, end_call: true });
              // Durable task/SID lookup on the server also ends the actual PSTN leg.
              void this.flush(entry.id).then(() => this.options.onNoHuman?.(entry.id, reason)).catch(() => {
                entry.engine.record("no_human_hangup_failed");
              });
            });
            entry.engine.record("opening_listening");
            openingTimer = setTimeout(() => {
              openingTimer = undefined;
              const probe = entry.engine.opening.probe();
              send({ response_type: "response", response_id: 0, content: probe ?? "", content_complete: true });
              if (probe) entry.engine.record("opening_silence_probe");
            }, 3000);
            openingTimer.unref();
          } else reply(0, [{ role: "user", content:
            "Begin the authorized TEST conversation using the trusted standard secretary introduction. Then listen." }]);
        } else send({ response_type: "response", response_id: 0, content: "", content_complete: true });
        return;
      }
      if (frame.interaction_type === "update_only") {
        if (!Array.isArray(frame.transcript) || frame.transcript.length > 300 ||
            frame.transcript.some((t: any) => !["agent", "user"].includes(t?.role) ||
              typeof t.content !== "string" || t.content.length > 4000)) { ws.close(1008, "Invalid transcript"); return; }
        heardOpening(frame.transcript);
        const waiting = entry.waiting && waitingInput(frame.transcript, frame.turntaking === "user_turn", false);
        if (this.options.phone && Array.isArray(frame.transcript)) {
          const turns = frame.transcript.filter((t: any) => ["agent", "user"].includes(t?.role) && typeof t.content === "string");
          const last = [...turns].reverse().find((t: any) => t.role === "user");
          if (last) entry.lineGuard?.observe(last.content, entry.engine.opening.permit(turns, false));
          if (entry.lineGuard?.voicemail && buffered) {
            buffered.close(); buffered = undefined; entry.buffer = undefined; abort();
          }
        }
        if (buffered && !waiting) {
          if (!Array.isArray(frame.transcript) || frame.transcript.length > 300 ||
            frame.transcript.some((t: any) => !["agent", "user"].includes(t?.role) ||
              typeof t.content !== "string" || t.content.length > 4000)) { ws.close(1008, "Invalid transcript"); return; }
          buffered.update(frame.transcript, frame.turntaking === "user_turn",
            !!this.options.phone && !frame.transcript.some((t: SpokenTurn) =>
              t.role === "agent" && t.content.trim() && t.content.trim() !== "Hi, hello?"));
        }
        transcript(frame);
        if (frame.turntaking === "user_turn" && (firstGreetingSpeech !== undefined
          ? firstGreetingSpeech !== speechKey(frame.transcript) : !buffered)) abort();
        return;
      }
      if (!["response_required", "reminder_required"].includes(frame.interaction_type)) return;
      if (!Number.isSafeInteger(frame.response_id) || frame.response_id < 1 || frame.response_id > 10_000 ||
          !Array.isArray(frame.transcript) || frame.transcript.length > 300 ||
          frame.transcript.some((t: any) => !["agent", "user"].includes(t?.role) || typeof t?.content !== "string" || t.content.length > 4000)) {
        ws.close(1008, "Invalid response request"); return;
      }
      heardOpening(frame.transcript);
      if (entry.waiting) waitingInput(frame.transcript, false, frame.interaction_type === "response_required");
      if (this.options.phone) {
        const last = [...frame.transcript].reverse().find((t: any) => t.role === "user");
        if (last) entry.lineGuard?.observe(last.content, entry.engine.opening.permit(frame.transcript), true);
      }
      reply(frame.response_id, frame.transcript.map((t: any) => ({ role: t.role, content: t.content })), frame.interaction_type === "reminder_required");
      transcript(frame);
    });
    const close = () => {
      if (openingTimer) clearTimeout(openingTimer);
      if (entry.socket !== ws) return;
      clearInterval(entry.waitingTimer);
      buffered?.close();
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
const speedVariants = new Map<string, SpeedVariant>();
export const speedBufferModes = new Map<string, boolean>();
export const retellEngineRegistry = new RetellEngineRegistry(undefined, {
  createEngine: (owner, instruction, id, personality) => rehearsalBindings.get(id)?.create(owner, instruction) ??
    speedEngine(owner, instruction, speedVariants.get(id) ?? "A", personality),
  bufferResponses: id => rehearsalBindings.get(id)?.buffered ?? (speedVariants.get(id) === "C" && speedBufferModes.get(id) !== false),
  waitingRules: id => rehearsalBindings.get(id)?.waiting ?? (speedVariants.get(id) === "C"),
});
export const retellEngineLab = speedLab({ registry: retellEngineRegistry,
  api: variant => new RetellEngineApi(engineCallbackBase, undefined, variant), check: checkEngine,
  agentName: RETELL_ENGINE_AGENT, variantsBySession: speedVariants, bufferModesBySession: speedBufferModes });
setInterval(() => retellEngineLab.sweep(), 60_000).unref();
