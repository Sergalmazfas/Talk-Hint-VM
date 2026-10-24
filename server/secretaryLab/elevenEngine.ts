import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type WebSocket from "ws";
import { z } from "zod";
import { SecretaryConversationEngine, streamSecretaryResponse, type EngineStream, type SpokenTurn } from "../secretary/conversationEngine";
import { SECRETARY_REASONING_MODEL } from "../secretary/voice";
import { getClone } from "../voiceLab/store";
import { SECRETARY_TEST_CONTEXT } from "./testContext";
import { ElevenLabApi, ElevenLabError, ELEVEN_CATALOG, ELEVEN_TTS_MODEL, elevenDevBase } from "./elevenApi";
import type { ComparisonRepository } from "./comparisonStore";
import { comparisonSnapshot, comparisonText } from "./comparisonSnapshot";
import type { RetellReport } from "./retell";

const startInput = z.object({ instruction: z.string().trim().min(8).max(4000),
  voice: z.enum(["clone", "catalog"]), consent: z.literal(true), clientRequestId: z.string().uuid() }).strict();
type Report = RetellReport & { savedComparisonId: string; voiceChoice: "clone" | "catalog"; ttsModel: string;
  evaluation: { audibility: number | null; naturalness: number | null; note: string; device: string } };
type Entry = {
  owner: string; id: string; fingerprint: string; capability: string; audioTicket: string;
  agentId?: string; signedUrl?: string; report: Report; engine: SecretaryConversationEngine;
  created: Promise<any>; closed: boolean; epoch: number; controller?: AbortController;
  browser?: WebSocket; upstream?: WebSocket; persistChain: Promise<unknown>; stopPromise?: Promise<any>;
  timer?: NodeJS.Timeout; heartbeat?: NodeJS.Timeout; lastSeen: number; connected: boolean;
  completed: Map<string, string>; sequence: number; activeHttp?: Response;
  archiveCreated: boolean;
};
function fail(status: number, message: string): never { throw new ElevenLabError(status, message); }
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Voice transport only. All generation/tools reuse the SAME unmodified text Engine as Retell + Engine. */
export class ElevenEngineLab {
  private sessions = new Map<string, Entry>();
  private capabilities = new Map<string, Entry>();
  private audioTickets = new Map<string, Entry>();
  private attempts = new Map<string, number[]>();
  constructor(private store: ComparisonRepository, private api = new ElevenLabApi(),
    private clone = getClone, private stream: EngineStream = streamSecretaryResponse,
    private dev = () => process.env.NODE_ENV === "development",
    private modelReady = async () => {
      if (!process.env.OPENAI_API_KEY) fail(503, "TalkHint OpenAI не настроен");
      const r = await fetch(`https://api.openai.com/v1/models/${SECRETARY_REASONING_MODEL}`, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(10_000), redirect: "error",
      });
      if (!r.ok || (await r.json()).id !== SECRETARY_REASONING_MODEL) fail(503, "Доступ TalkHint к модели не подтверждён; замены нет");
    }) {}
  private checkDev() { if (!this.dev()) fail(404, "Dev only"); }
  private owned(owner: string, id: string) {
    this.checkDev(); const s = this.sessions.get(id);
    if (!s || s.owner !== owner) fail(404, "Сессия не найдена");
    return s;
  }
  async readiness(owner: string) {
    this.checkDev();
    const base = { mode: "eleven-engine", model: SECRETARY_REASONING_MODEL, ttsModel: ELEVEN_TTS_MODEL,
      asr: "scribe_realtime", context: SECRETARY_TEST_CONTEXT, history: this.history(owner),
      settings: { languages: ["en", "ru", "es"], initialLanguage: "en", turnEagerness: "normal", turnTimeout: 15,
        maxDurationSeconds: 300, providerAudioRetention: false, archiveRetentionDays: 30 },
    };
    const voice = async (kind: "clone" | "catalog") => {
      try {
        const c = kind === "clone" ? await this.clone(owner) : null;
        const id = kind === "clone" ? c?.status === "ready" ? c.voiceId : undefined : ELEVEN_CATALOG.voiceId;
        if (!id) return { ready: false, reason: "Нет доступного сохранённого клона этого владельца; новый не создаётся" };
        const v = await this.api.voice(id);
        if (kind === "clone" && v.category === "cloned") return { ready: false, voiceId: id,
          reason: "ElevenLabs запрещает Custom LLM с Instant Voice Clone (custom_llm_not_allowed_in_with_agent_with_ivc_voice). Сохранённый клон не заменяется; новый не создаётся." };
        if (kind === "catalog" && (v.category !== "premade" || v.labels?.gender !== "female" || v.labels?.accent !== "american"))
          return { ready: false, reason: "Женский американский каталожный голос не подтверждён" };
        return { ready: true, voiceId: id, name: kind === "clone" ? "Мой сохранённый голос" : ELEVEN_CATALOG.name };
      } catch { return { ready: false, reason: "ElevenLabs не подтвердил доступ к выбранному голосу; подмены нет" }; }
    };
    const voices = { clone: await voice("clone"), catalog: await voice("catalog") };
    try {
      elevenDevBase();
      if (!this.store.checkpoint) fail(503, "Общее хранилище не поддерживает сохранение под ID поручения");
      await Promise.all([this.modelReady(), this.api.request("/v1/convai/agents"), this.api.workspaceSafe(), this.store.list()]);
      return { ...base, voices, ready: voices.clone.ready || voices.catalog.ready,
        reason: !voices.clone.ready && !voices.catalog.ready ? "Нет доступного голоса" : undefined,
        verification: "configuration_only; live_audio_unverified" };
    } catch (e) {
      return { ...base, voices, ready: false, reason: e instanceof ElevenLabError ? e.message :
        "ElevenLabs / Engine / общее хранилище недоступны; запуска и подмены нет" };
    }
  }
  history(owner: string) {
    return Array.from(this.sessions.values()).filter(s => s.owner === owner).reverse().map(s => structuredClone(s.report));
  }
  private event(s: Entry, type: string, detail?: string) {
    s.report.events.push({ type, atMs: Date.now() - Date.parse(s.report.createdAt), ...(detail ? { detail: comparisonText(detail) } : {}) });
    if (s.report.events.length > 300) s.report.events.shift();
  }
  private persist(s: Entry) {
    const snapshot = comparisonSnapshot("eleven-engine", s.report);
    snapshot.ttsModel = s.report.ttsModel; snapshot.voiceChoice = s.report.voiceChoice;
    snapshot.evaluation = { ...s.report.evaluation, note: comparisonText(s.report.evaluation.note), device: comparisonText(s.report.evaluation.device, 200) };
    const content = { title: `ElevenLabs + Engine · ${s.report.voiceChoice} · TEST`, instruction: comparisonText(s.report.instruction),
      evaluation: { score: null, note: "" }, runs: [snapshot] };
    const write = s.persistChain.then(() => this.store.checkpoint!(s.owner, s.id, content));
    s.persistChain = write.catch(() => undefined);
    return write.then(record => { s.archiveCreated = true; return record; });
  }
  async create(owner: string, raw: unknown) {
    this.checkDev();
    const parsed = startInput.safeParse(raw); if (!parsed.success) fail(400, "Проверьте поручение, голос, согласие и request ID");
    const input = parsed.data;
    const fingerprint = hash(input.instruction + "\n" + input.voice);
    const old = this.sessions.get(input.clientRequestId);
    if (old) {
      if (old.owner !== owner) fail(404, "Сессия не найдена");
      if (old.fingerprint !== fingerprint) fail(409, "Request ID уже относится к другому поручению или голосу");
      if (old.closed) return { id: old.id, report: structuredClone(old.report) };
      return old.created;
    }
    if (Array.from(this.sessions.values()).some(s => s.owner === owner && (!s.closed || s.report.status === "stop_failed")))
      fail(409, "Сначала подтвердите остановку предыдущей сессии");
    const recent = (this.attempts.get(owner) ?? []).filter(t => Date.now() - t < 3600_000);
    if (recent.length >= 6 || this.sessions.size >= 100) fail(429, "Лимит тестов; попробуйте позже");
    const id = input.clientRequestId;
    const s = { owner, id, fingerprint, capability: randomBytes(32).toString("hex"), audioTicket: randomBytes(32).toString("hex"),
      closed: false, epoch: 0, persistChain: Promise.resolve(), completed: new Map(), sequence: 0,
      lastSeen: Date.now(), connected: false, archiveCreated: false } as Entry;
    // Wrap the model transport, not the common Engine: after a TEST tool commits,
    // checkpoint/ACK the ledger BEFORE any follow-up model can claim success.
    const service = this;
    s.engine = new SecretaryConversationEngine(owner, input.instruction, async function* (request) {
      await service.persist(s);
      if (!request.signal.aborted) yield* service.stream(request);
    });
    s.report = { id, callId: "", mode: "eleven-engine", status: "connecting", instruction: input.instruction,
      model: SECRETARY_REASONING_MODEL, voice: "", promptHash: hash(s.engine.instructions),
      createdAt: new Date().toISOString(), monitorStatus: "waiting", turns: [], events: [], observations: [],
      metrics: { guestTurns: 0, secretaryTurns: 0 }, engine: s.engine.report, savedComparisonId: id,
      ttsModel: ELEVEN_TTS_MODEL, voiceChoice: input.voice,
      evaluation: { audibility: null, naturalness: null, note: "", device: "" } };
    this.sessions.set(id, s); this.attempts.set(owner, [...recent, Date.now()]);
    s.created = (async () => {
      try {
        if (await this.store.get(id)) fail(409, "Поручение уже сохранено; откройте результат, автоматического повторного запуска нет");
        const ready = await this.readiness(owner);
        const choice = ready.voices[input.voice];
        if (!ready.ready || !choice.ready || !choice.voiceId) fail(503, choice.reason ?? ready.reason ?? "Голос не подключён");
        s.report.voice = choice.voiceId;
        await this.persist(s);
        if (s.closed) fail(409, "Запуск отменён");
        this.capabilities.set(s.capability, s);
        s.agentId = await this.api.create(choice.voiceId, s.capability, id);
        if (s.closed) { await this.api.remove(s.agentId); s.agentId = undefined; fail(409, "Запуск отменён"); }
        await this.api.inspect(s.agentId, choice.voiceId, s.capability);
        s.signedUrl = await this.api.signedUrl(s.agentId);
        if (s.closed) { await this.api.remove(s.agentId); s.agentId = undefined; fail(409, "Запуск отменён"); }
        this.audioTickets.set(s.audioTicket, s); this.event(s, "custom_llm_configured");
        s.timer = setTimeout(() => void this.stop(owner, id).catch(() => undefined), 300_000); s.timer.unref();
        s.heartbeat = setInterval(() => {
          if (Date.now() - s.lastSeen > 25_000) void this.stop(owner, id).catch(() => undefined);
        }, 5000); s.heartbeat.unref();
        await this.persist(s);
        return { id, websocketPath: `/eleven-engine-audio/${s.audioTicket}`, report: structuredClone(s.report) };
      } catch (e) {
        this.close(s); s.report.status = "failed"; s.report.reason = e instanceof ElevenLabError ? e.message : "Сохранение/подключение не подтверждено";
        if (s.agentId) {
          try { await this.api.remove(s.agentId); s.agentId = undefined; }
          catch { s.report.status = "stop_failed"; s.report.reason = "Удаление изолированного Dev-аудиоагента не подтверждено; повторите Stop"; }
        }
        if (s.archiveCreated) await this.persist(s).catch(() => undefined);
        throw e;
      }
    })();
    return s.created;
  }
  private close(s: Entry) {
    s.closed = true; s.epoch++; s.controller?.abort(); s.activeHttp?.end(); s.activeHttp = undefined;
    clearTimeout(s.timer); clearInterval(s.heartbeat);
    this.capabilities.delete(s.capability); this.audioTickets.delete(s.audioTicket);
    s.engine.report.connected = false; s.report.monitorStatus = "ended";
    for (const ws of [s.upstream, s.browser]) {
      if (!ws) continue;
      if (ws.readyState === 0) ws.terminate(); else ws.close(1000, "Dev test stopped");
    }
  }
  async stop(owner: string, id: string) {
    const s = this.owned(owner, id);
    if (s.stopPromise) return s.stopPromise;
    this.close(s);
    s.stopPromise = (async () => {
      await s.created.catch(() => undefined);
      try {
        if (s.agentId) { await this.api.remove(s.agentId); s.agentId = undefined; }
        s.report.status = "ended"; s.report.endedAt ??= new Date().toISOString(); this.event(s, "stopped");
        await this.persist(s);
        return { report: structuredClone(s.report) };
      } catch {
        s.report.status = "stop_failed"; s.report.reason = "Остановка или сохранение не подтверждены; повторите Stop";
        await this.persist(s).catch(() => undefined);
        fail(503, s.report.reason);
      } finally { s.stopPromise = undefined; }
    })();
    return s.stopPromise;
  }
  async report(owner: string, id: string) {
    this.checkDev();
    const live = this.sessions.get(id);
    if (live) { const s = this.owned(owner, id); s.lastSeen = Date.now(); await this.persist(s); }
    const saved = await this.store.get(id);
    const run = saved?.runs.find(r => r.mode === "eleven-engine" && r.id === id);
    if (!run) fail(404, "Сохранённое поручение не найдено");
    // Only committed repository data is returned. Reads NEVER connect a voice session.
    return { report: { ...run, savedComparisonId: id } };
  }
  async evaluate(owner: string, id: string, raw: unknown) {
    const s = this.owned(owner, id);
    const input = z.object({ audibility: z.number().int().min(1).max(5).nullable(),
      naturalness: z.number().int().min(1).max(5).nullable(), note: z.string().max(2000), device: z.string().max(200) }).strict().safeParse(raw);
    if (!input.success) fail(400, "Некорректная оценка");
    s.report.evaluation = input.data; await this.persist(s); return this.report(owner, id);
  }
  async telemetry(owner: string, id: string, raw: unknown) {
    const s = this.owned(owner, id);
    const p = z.object({ type: z.enum(["playback_started", "playback_stopped", "error"]), atMs: z.number().min(0).max(900_000) }).strict().safeParse(raw);
    if (!p.success) fail(400, "Некорректная метка");
    if (s.report.events.length < 295) this.event(s, `client_${p.data.type}`, `clientElapsedMs=${Math.round(p.data.atMs)}; not acoustic measurement`);
    await this.persist(s); return { ok: true };
  }
  permitsAudio(ticket: string) {
    return this.dev() && !!this.audioTickets.get(ticket) && !this.audioTickets.get(ticket)!.closed;
  }
  attachAudio(browser: WebSocket, ticket: string) {
    const s = this.audioTickets.get(ticket);
    if (!s || !this.permitsAudio(ticket) || s.connected || !s.signedUrl) { browser.close(1008, "Dev admission denied"); return; }
    s.connected = true; s.browser = browser;
    const upstream = this.api.socket(s.signedUrl); s.upstream = upstream;
    const queue: string[] = [];
    upstream.on("open", () => { for (const raw of queue) upstream.send(raw); queue.length = 0; });
    browser.on("message", (raw, binary) => {
      if (s.closed) return;
      let f: any; try { if (binary) throw Error(); f = JSON.parse(raw.toString()); } catch { browser.close(1008, "Invalid message"); return; }
      if (f.type === "conversation_initiation_client_data") f = { type: "conversation_initiation_client_data" };
      else if (typeof f.user_audio_chunk === "string" && f.user_audio_chunk.length < 64 * 1024)
        f = { user_audio_chunk: f.user_audio_chunk };
      else if (f.type === "pong" && Number.isSafeInteger(f.event_id)) f = { type: "pong", event_id: f.event_id };
      else if (f.type === "user_message" && typeof f.text === "string" && f.text.length <= 4000) f = { type: "user_message", text: f.text };
      else if (f.type === "user_activity") f = { type: "user_activity" };
      else return;
      const text = JSON.stringify(f);
      if (upstream.readyState === 1) {
        if (upstream.bufferedAmount > 256 * 1024) { void this.stop(s.owner, s.id).catch(() => undefined); return; }
        upstream.send(text);
      } else if (queue.length < 8) queue.push(text);
      else browser.close(1009, "Startup queue full");
    });
    upstream.on("message", raw => {
      if (s.closed) return;
      try {
        const f = JSON.parse(raw.toString());
        if (f.type === "conversation_initiation_metadata") {
          s.report.callId = f.conversation_initiation_metadata_event?.conversation_id ?? "";
          s.report.status = "live"; s.report.monitorStatus = "connected"; s.engine.report.connected = true;
          this.event(s, "audio_connected");
        }
        if (f.type === "interruption") {
          s.epoch++; s.controller?.abort(); s.activeHttp?.end(); s.activeHttp = undefined;
          this.event(s, "provider_interruption_cancelled_generation");
        }
        const role = f.type === "user_transcript" ? "guest" : f.type === "agent_response" ? "secretary" : undefined;
        const text = role === "guest" ? f.user_transcription_event?.user_transcript : f.agent_response_event?.agent_response;
        if (role && typeof text === "string") {
          if (s.report.turns.length < 300) s.report.turns.push({ id: `${role}:${++s.sequence}`, role, text: text.slice(0, 4000), atMs: Date.now() - Date.parse(s.report.createdAt) });
          if (role === "guest") s.report.metrics.guestTurns++; else s.report.metrics.secretaryTurns++;
          this.event(s, role === "guest" ? "provider_final_user_transcript" : "provider_agent_response");
          void this.persist(s).catch(() => void this.stop(s.owner, s.id).catch(() => undefined));
        }
        if (f.type === "audio" && s.report.events.at(-1)?.type !== "provider_audio_frame")
          this.event(s, "provider_audio_frame");
      } catch { browser.close(1008, "Invalid provider frame"); return; }
      if (browser.readyState === 1 && browser.bufferedAmount < 512 * 1024)
        browser.send(raw.toString().replaceAll(s.capability, "[capability removed]").replaceAll(s.signedUrl!, "[signed URL removed]"));
      else void this.stop(s.owner, s.id).catch(() => undefined);
    });
    const end = () => { if (!s.closed) void this.stop(s.owner, s.id).catch(() => undefined); };
    upstream.on("error", end); upstream.on("close", end); browser.on("error", end); browser.on("close", end);
  }
  async completion(capability: string, req: Request, res: Response) {
    this.checkDev();
    const s = this.capabilities.get(capability);
    if (!s || s.closed) fail(404, "Unknown Dev admission");
    const body = req.body;
    if (!body || body.stream !== true || !Array.isArray(body.messages) || body.messages.length > 300) fail(400, "Streaming messages required");
    const turns: SpokenTurn[] = [];
    for (const m of body.messages) {
      // Provider system prompts/tools have NO authority. The trusted task/context are server-owned.
      if (m?.role === "system" || m?.role === "developer" || m?.role === "tool") continue;
      if (!["user", "assistant"].includes(m?.role) || typeof m.content !== "string" || m.content.length > 4000) fail(400, "Unsupported transcript");
      turns.push({ role: m.role === "user" ? "user" : "agent", content: m.content });
    }
    if (!turns.length) turns.push({ role: "user", content: "Begin the authorized TEST conversation." });
    s.epoch++; s.controller?.abort(); s.activeHttp?.end();
    const epoch = s.epoch, c = new AbortController(); s.controller = c; s.activeHttp = res;
    const current = () => !s.closed && s.epoch === epoch && !c.signal.aborted && !res.destroyed;
    const key = hash(JSON.stringify(turns));
    res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const send = (text: string, finish = false) => {
      if (!current()) return;
      res.write(`data: ${JSON.stringify({ id: `chatcmpl-${s.id}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
        model: SECRETARY_REASONING_MODEL, choices: [{ index: 0, delta: finish ? {} : { content: text }, finish_reason: finish ? "stop" : null }] })}\n\n`);
    };
    res.on("close", () => { if (s.epoch === epoch) c.abort(); });
    const timer = setTimeout(() => { c.abort(); res.end(); this.event(s, "engine_timeout"); }, 25_000); timer.unref();
    this.event(s, "engine_request_received");
    let output = "", first = true;
    try {
      const cached = s.completed.get(key);
      if (cached !== undefined) { send(cached); this.event(s, "response_replay_without_actions"); }
      else {
        await s.engine.respond(turns, c.signal, text => {
          if (!current()) return;
          if (first) { this.event(s, "engine_first_text"); first = false; }
          output += text; send(text);
        });
        if (current()) { s.completed.set(key, output); if (s.completed.size > 100) s.completed.delete(s.completed.keys().next().value!); }
      }
      await this.persist(s);
      if (current()) { send("", true); res.write("data: [DONE]\n\n"); res.end(); }
    } catch {
      if (current()) { this.event(s, "engine_or_checkpoint_error"); res.end(); }
      // No fabricated success or backup model. Revocation also stops synthesis/playback.
      if (!c.signal.aborted) void this.stop(s.owner, s.id).catch(() => undefined);
    } finally {
      clearTimeout(timer); if (s.activeHttp === res) s.activeHttp = undefined;
    }
  }
  dispose() { for (const s of Array.from(this.sessions.values())) this.close(s); }
}
