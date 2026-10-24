import { createHash, randomUUID } from "node:crypto";
import type WebSocket from "ws";
import { buildSecretaryInstructions } from "../secretary/agent";
import { confirmedSecretaryOwnerName } from "../secretary/ownerIdentity";
import { RetellApi, RetellApiError, RETELL_LAB_AGENT, RETELL_LAB_MODEL, RETELL_LAB_VOICE } from "./retellApi";
import { secretaryTestContextPrompt } from "./testContext";
import type { SecretaryConversationEngine } from "../secretary/conversationEngine";

export interface RetellReport {
  id: string; callId: string; status: "connecting" | "live" | "ended" | "stop_failed" | "failed";
  instruction: string; model: string; voice: string; promptHash: string;
  createdAt: string; endedAt?: string; reason?: string;
  monitorStatus: "waiting" | "connected" | "disconnected" | "ended";
  turns: Array<{ id: string; role: "guest" | "secretary"; text: string; atMs: number }>;
  events: Array<{ type: string; atMs: number; detail?: string }>;
  observations: Array<{ atMs: number; outcome: "stopped" | "continued" | "unknown"; note?: string }>;
  metrics: { guestTurns: number; secretaryTurns: number };
  mode?: string;
  engine?: SecretaryConversationEngine["report"];
}
interface Session {
  owner: string; requestId: string; inputHash: string; report: RetellReport; call?: any;
  creation?: Promise<any>; stop?: Promise<RetellReport>; socket?: WebSocket;
  timer?: ReturnType<typeof setTimeout>; poll?: ReturnType<typeof setInterval>;
  reconnect?: ReturnType<typeof setTimeout>; monitoring: boolean; polling: boolean;
  lastSeen: number; monitorAttempts: number; uncertain?: boolean;
  monitorDenied?: boolean;
}
const fail = (status: number, text: string): never => { throw Object.assign(new Error(text), { status }); };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const terminal = (s: Session) => s.report.status === "ended" || s.report.status === "failed";
export function retellSecretaryInstructions(owner: string, instruction: string) {
  return buildSecretaryInstructions(instruction, confirmedSecretaryOwnerName(owner)) + secretaryTestContextPrompt();
}
export interface RetellLabProfile {
  agentName: string; mode: string;
  check(): Promise<object>;
  reserve(owner: string, instruction: string, id: string): { ticket: string; engine: SecretaryConversationEngine["report"]; promptHash?: string };
  registered(id: string, callId: string): void;
  ended(id: string): void;
}
/** Dev-only web sessions. No dialer, phone endpoints, persistent call history, or tools. */
export class RetellSecretaryLab {
  private sessions = new Map<string, Session>();
  private attempts = new Map<string, number[]>();
  private setup?: ReturnType<RetellApi["ensureAgent"]>;
  constructor(private api = new RetellApi(), private now = Date.now,
    private isDev = () => process.env.NODE_ENV === "development", private profile?: RetellLabProfile) {}
  private dev() { if (!this.isDev()) fail(404, "Retell bench is Dev-only"); }
  private get(owner: string, id: string) {
    this.dev(); this.prune();
    const s = this.sessions.get(id);
    if (!s || s.owner !== owner) fail(404, "Сессия не найдена");
    return s!;
  }
  private event(s: Session, type: string, detail?: string) {
    s.report.events.push({ type, atMs: this.now() - Date.parse(s.report.createdAt), ...(detail ? { detail } : {}) });
    if (s.report.events.length > 300) s.report.events.shift();
  }
  private finish(s: Session, reason: string) {
    if (terminal(s)) return;
    clearTimeout(s.timer); clearInterval(s.poll); clearTimeout(s.reconnect);
    s.report.status = "ended"; s.report.endedAt = new Date(this.now()).toISOString();
    s.report.reason = reason; s.report.monitorStatus = "ended";
    this.event(s, "session_ended", reason);
    s.socket?.close(); s.socket = undefined;
    // Admission credentials never appear in report/history; destroy after end.
    s.call = undefined;
    this.profile?.ended(s.report.id);
  }
  private prune() {
    for (const [id, s] of Array.from(this.sessions)) {
      if (terminal(s) && this.now() - Date.parse(s.report.endedAt ?? s.report.createdAt) > 3_600_000) this.sessions.delete(id);
    }
    for (const [owner, times] of Array.from(this.attempts)) {
      const recent = times.filter(t => this.now() - t < 3_600_000);
      if (recent.length) this.attempts.set(owner, recent); else this.attempts.delete(owner);
    }
  }
  async readiness(owner: string) {
    this.dev(); this.prune();
    const base = { model: RETELL_LAB_MODEL, voice: RETELL_LAB_VOICE,
      limits: { durationSeconds: 300, historyMinutes: 60 },
      history: Array.from(this.sessions.values()).filter(s => s.owner === owner).map(s => structuredClone(s.report)).reverse() };
    try {
      const extra = await this.profile?.check();
      const matches = (await this.api.listAgents()).filter(a => a.agent_name === (this.profile?.agentName ?? RETELL_LAB_AGENT));
      if (matches.length > 1) fail(409, "Retell: дублирующиеся стенды");
      const agent = matches.length ? await this.api.inspectAgent(matches[0].agent_id) : undefined;
      return { ...base, ...extra, mode: this.profile?.mode ?? "retell", ready: true, keyStatus: "authenticated",
        agentId: agent?.id, reason: agent ? undefined : "Отдельный Dev-агент будет создан при первом запуске. Права Call ещё не испытаны." };
    } catch (e) {
      return { ...base, ready: false, keyStatus: "unavailable", reason: (e as Error).message };
    }
  }
  async create(owner: string, input: any) {
    this.dev(); this.prune();
    if (!owner) fail(401, "Authentication required");
    if (!input || Object.keys(input).some(k => !["instruction", "consent", "clientRequestId"].includes(k)) ||
        input.consent !== true || typeof input.instruction !== "string" ||
        input.instruction.trim().length < 8 || input.instruction.length > 4000 ||
        typeof input.clientRequestId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.clientRequestId)) {
      fail(400, "Нужны поручение 8–4000 символов, согласие на платный тест и UUID запроса. Телефонные параметры запрещены.");
    }
    if (this.profile) await this.profile.check();
    const instruction = input.instruction.trim(), inputHash = digest(instruction);
    const old = Array.from(this.sessions.values()).find(s => s.owner === owner && s.requestId === input.clientRequestId);
    if (old) {
      if (old.inputHash !== inputHash) fail(409, "Этот ID уже связан с другим поручением");
      if (old.creation) return old.creation;
      if (!old.call || terminal(old)) fail(409, "Запрос уже завершён или результат создания не установлен. Повторный вызов не создан.");
      return { id: old.report.id, call: old.call, report: structuredClone(old.report) };
    }
    if (Array.from(this.sessions.values()).some(s => s.owner === owner && (!terminal(s) || s.uncertain))) {
      fail(409, "Сессия Retell уже активна или её остановка не подтверждена");
    }
    const times = this.attempts.get(owner) ?? [];
    if (times.length >= 6 || this.sessions.size >= 200) fail(429, "Не более 6 тестов в час; либо стенд заполнен");
    const id = randomUUID(), instructions = retellSecretaryInstructions(owner, instruction);
    // No yield between owner exclusion above and reserving the session.
    const s: Session = { owner, requestId: input.clientRequestId, inputHash, lastSeen: this.now(),
      monitoring: false, polling: false, monitorAttempts: 0,
      report: { id, callId: "", status: "connecting", instruction, model: RETELL_LAB_MODEL,
        voice: RETELL_LAB_VOICE, promptHash: digest(instructions), createdAt: new Date(this.now()).toISOString(),
        monitorStatus: "waiting", turns: [], events: [], observations: [],
        metrics: { guestTurns: 0, secretaryTurns: 0 } } };
    const engine = this.profile?.reserve(owner, instruction, id);
    if (engine) { s.report.mode = this.profile!.mode; s.report.engine = engine.engine; }
    if (engine?.promptHash) s.report.promptHash = engine.promptHash;
    this.sessions.set(id, s); this.attempts.set(owner, [...times, this.now()]);
    s.creation = this.admit(s, instructions, engine?.ticket);
    try { return await s.creation; } finally { s.creation = undefined; }
  }
  private async admit(s: Session, instructions: string, ticket?: string) {
    let submitting = false;
    try {
      this.setup ??= this.api.ensureAgent().catch(e => { this.setup = undefined; throw e; });
      const agent = await this.setup;
      // Revalidate remote configuration before every paid admission.
      await this.api.inspectAgent(agent.id);
      submitting = true;
      const call = await this.api.request("/v3/create-web-call", {
        agent_id: agent.id, agent_version: agent.version,
        retell_llm_dynamic_variables: { talkhint_instructions: instructions, ...(ticket ? { talkhint_engine_ticket: ticket } : {}) },
        metadata: { talkhint_lab_session: s.report.id, purpose: "secretary_dev_comparison" },
      });
      // Keep call id even on a malformed credential response, so it can be stopped safely.
      if (typeof call.call_id === "string") s.report.callId = call.call_id;
      if (typeof call.call_id !== "string" || typeof call.access_token !== "string" ||
          call.transport !== "gateway" || !Array.isArray(call.ice_servers) ||
          typeof call.expires_at !== "number") throw new RetellApiError(503, "Retell: неподдерживаемые реквизиты web-сессии");
      this.profile?.registered(s.report.id, call.call_id);
      // Do not expose dynamic variables/callback capability if provider echoes them.
      s.call = Object.fromEntries(["call_id", "access_token", "transport", "ice_servers", "expires_at"].map(k => [k, call[k]]));
      this.event(s, "web_session_registered");
      s.timer = setTimeout(() => { void this.stop(s.owner, s.report.id, "duration_limit").catch(() => {}); }, 300_000);
      s.timer.unref?.();
      return { id: s.report.id, call: s.call, report: structuredClone(s.report) };
    } catch (e) {
      const uncertain = submitting && (!(e instanceof RetellApiError) || e.status >= 500);
      s.uncertain = uncertain;
      s.report.status = "failed"; s.report.endedAt = new Date(this.now()).toISOString();
      s.report.reason = uncertain ? "create_result_unknown" : "create_rejected";
      this.event(s, s.report.reason);
      this.profile?.ended(s.report.id);
      if (uncertain && s.report.callId) {
        s.report.status = "stop_failed";
        void this.stop(s.owner, s.report.id, "setup_failed").catch(() => {});
      }
      throw e;
    }
  }
  report(owner: string, id: string) {
    const s = this.get(owner, id); s.lastSeen = this.now();
    return { report: structuredClone(s.report) };
  }
  reports(owner: string) {
    this.dev(); this.prune();
    return Array.from(this.sessions.values()).filter(s => s.owner === owner)
      .map(s => structuredClone(s.report)).reverse();
  }
  async connected(owner: string, id: string) {
    const s = this.get(owner, id); s.lastSeen = this.now();
    if (terminal(s) || !s.report.callId || !s.call) fail(409, "Сессия уже завершена или не создана");
    if (!s.poll) {
      s.poll = setInterval(() => { void this.refresh(s); }, 2000); s.poll.unref?.();
      await this.refresh(s);
    }
    return this.report(owner, id);
  }
  private async refresh(s: Session) {
    if (terminal(s) || s.polling) return;
    if (this.now() - s.lastSeen > 20_000) {
      void this.stop(s.owner, s.report.id, "browser_disconnected").catch(() => {}); return;
    }
    s.polling = true;
    try {
      const call = await this.api.request(`/v2/get-call/${encodeURIComponent(s.report.callId)}`);
      if (terminal(s)) return;
      if (call.call_type !== "web_call" || call.call_id !== s.report.callId) {
        this.event(s, "provider_identity_mismatch"); return;
      }
      if (call.call_status === "ended" || call.call_status === "error" || call.call_status === "not_connected") {
        this.finish(s, String(call.disconnection_reason ?? call.call_status)); return;
      }
      if (call.call_status === "ongoing") {
        s.report.status = "live";
        if (!s.socket && !s.reconnect && !s.monitorDenied && s.monitorAttempts < 8) this.monitor(s);
      }
    } catch (e) { this.event(s, "provider_status_unavailable", (e as Error).message); }
    finally { s.polling = false; }
  }
  private monitor(s: Session) {
    if (terminal(s) || s.monitoring) return;
    s.monitoring = true; s.monitorAttempts++;
    let socket: WebSocket;
    try { socket = this.api.monitor(s.report.callId); }
    catch { s.monitoring = false; s.report.monitorStatus = "disconnected"; return; }
    s.socket = socket;
    socket.on("open", () => {
      if (terminal(s)) { socket.close(); return; }
      s.report.monitorStatus = "connected"; this.event(s, "transcript_connected");
    });
    socket.on("message", raw => {
      if (terminal(s)) return;
      try { this.applyMonitor(s, JSON.parse(raw.toString())); }
      catch { this.event(s, "invalid_transcript_event"); }
    });
    socket.on("error", () => { this.event(s, "transcript_socket_error"); });
    socket.on("close", (code, reason) => {
      s.socket = undefined; s.monitoring = false;
      if (terminal(s)) return;
      s.report.monitorStatus = "disconnected";
      this.event(s, "transcript_disconnected", `code=${code}`);
      if (code === 1000 && reason.toString() === "call_ended") { void this.refresh(s); return; }
      if ([4001, 4003, 4008].includes(code)) { s.monitorDenied = true; return; }
      if (s.monitorAttempts < 8) {
        s.reconnect = setTimeout(() => { s.reconnect = undefined; void this.refresh(s); }, Math.min(8000, 500 * 2 ** s.monitorAttempts));
        s.reconnect.unref?.();
      }
    });
  }
  private applyMonitor(s: Session, message: any) {
    if (message.type === "call_ended") { this.finish(s, String(message.disconnection_reason ?? "provider_ended")); return; }
    if (!["transcript_snapshot", "transcript_updated"].includes(message.type) || !Array.isArray(message.transcripts)) return;
    for (const t of message.transcripts.slice(0, 300)) {
      if (!["agent", "user"].includes(t.role) || typeof t.id !== "string" ||
          typeof t.content !== "string" || !Number.isFinite(t.time_sec) || t.time_sec < 0) continue;
      const turn = { id: t.id.slice(0, 100), role: (t.role === "agent" ? "secretary" : "guest") as "secretary" | "guest",
        text: t.content.slice(0, 4000), atMs: Math.round(t.time_sec * 1000) };
      const index = s.report.turns.findIndex(old => old.id === turn.id);
      if (index >= 0) s.report.turns[index] = turn;
      else if (s.report.turns.length < 300) s.report.turns.push(turn);
    }
    s.report.turns.sort((a, b) => a.atMs - b.atMs);
    s.report.metrics = { guestTurns: s.report.turns.filter(t => t.role === "guest").length,
      secretaryTurns: s.report.turns.filter(t => t.role === "secretary").length };
  }
  observe(owner: string, id: string, input: any) {
    const s = this.get(owner, id);
    if (!input || Object.keys(input).some(k => !["outcome", "note"].includes(k)) ||
        !["stopped", "continued", "unknown"].includes(input.outcome) ||
        (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 1000))) {
      fail(400, "Неверная отметка наблюдения");
    }
    if (s.report.observations.length >= 100) fail(429, "Лимит отметок");
    s.report.observations.push({ atMs: this.now() - Date.parse(s.report.createdAt), outcome: input.outcome,
      ...(input.note ? { note: input.note.trim() } : {}) });
    this.event(s, "human_interruption_observation", input.outcome);
    return this.report(owner, id);
  }
  async stop(owner: string, id: string, reason = "user_stop") {
    const s = this.get(owner, id);
    if (terminal(s) && !s.uncertain) return structuredClone(s.report);
    if (s.stop) return s.stop;
    if (!s.report.callId) fail(409, "Retell не подтвердил ID созданной сессии. Новый вызов заблокирован, чтобы исключить дубликат.");
    s.stop = (async () => {
      try {
        await this.api.request(`/v2/stop-call/${encodeURIComponent(s.report.callId)}`, undefined, "POST");
        s.uncertain = false;
        // finish also works after an uncertain admission.
        if (s.report.status === "failed") s.report.status = "stop_failed";
        this.finish(s, reason);
        return structuredClone(s.report);
      } catch (e) {
        s.report.status = "stop_failed"; s.report.reason = "stop_not_confirmed";
        this.event(s, "stop_failed", (e as Error).message); throw e;
      } finally { s.stop = undefined; }
    })();
    return s.stop;
  }
  /** Test/process shutdown; never creates a call or silently re-admits one. */
  dispose() {
    for (const s of Array.from(this.sessions.values())) {
      clearTimeout(s.timer); clearInterval(s.poll); clearTimeout(s.reconnect);
      s.report.status = "ended"; s.socket?.close();
      this.profile?.ended(s.report.id);
    }
  }
  sweep() { this.prune(); }
}
export const retellSecretaryLab = new RetellSecretaryLab();
setInterval(() => retellSecretaryLab.sweep(), 60_000).unref();
