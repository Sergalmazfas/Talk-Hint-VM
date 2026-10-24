import { EventEmitter } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { SecretaryCallContext, SecretaryStreamDependencies } from "../secretary/agent";
import { type LabRealtimeCallbacks, type LabRealtimeConnection } from "./openAIRealtime";
import { SECRETARY_AUDIO_MODEL as LAB_REALTIME_MODEL,SECRETARY_AUDIO_VOICE as LAB_REALTIME_VOICE } from "../secretary/voice";
import type { LabRunCost, LabTariffSnapshot } from "../../shared/secretaryLabCost";
import { captureLabTariff, pricedLabReport } from "./cost";
import { RealtimeUsageMeter } from "./realtimeUsage";

export interface LabTurn {
  id: string;
  role: "guest" | "secretary";
  text: string;
  translation?: string;
  atMs: number;
  interrupted?: boolean;
}
export interface LabReport {
  tariffSnapshot?: LabTariffSnapshot;
  cost?: LabRunCost;
  realtimeUsage?: import("../../shared/secretaryLabCost").LabRealtimeUsage;
  audioConnectedAt?: string;
  id: string;
  status: "awaiting_connection" | "running" | "ended";
  createdAt: string;
  endedAt?: string;
  reason?: string;
  voiceProvider: "elevenlabs" | "cartesia" | "openai";
  model: string;
  voice: string;
  transport: "webrtc" | "simulated_twilio";
  modelVerified: boolean;
  instruction: string;
  turns: LabTurn[];
  events: Array<{ type: string; atMs: number; detail?: string }>;
  metrics: {
    guestTurns: number;
    secretaryTurns: number;
    firstAudioMs?: number;
    lastTurnToAudioMs?: number;
  };
}
export interface LabDependencies {
  startEngine(socket: WebSocket, dependencies: SecretaryStreamDependencies): void;
  context(owner: string, provider: "elevenlabs" | "cartesia" | "openai"): Promise<Omit<SecretaryCallContext, "instruction">>;
  translate(text: string): Promise<{ translation?: string; unavailableReason?: string }>;
  now?: () => number;
  onEnd?(report: LabReport): void;
  openAI?: {
    isAvailable(): Promise<boolean>;
    create(owner: string, instruction: string, callbacks: LabRealtimeCallbacks): LabRealtimeConnection;
  };
}
export const LAB_CLIENT_STOP_REASONS = [
  "user_stop", "browser_disconnected", "audio_suspended", "audio_decode_error",
  "audio_queue_limit", "audio_input_backpressure", "microphone_error", "client_error",
  "webrtc_error", "webrtc_disconnected", "audio_autoplay_blocked",
] as const;
export function isLabClientStopReason(reason: unknown): reason is typeof LAB_CLIENT_STOP_REASONS[number] {
  return typeof reason === "string" && (LAB_CLIENT_STOP_REASONS as readonly string[]).includes(reason);
}
type Sender = (message: Record<string, unknown>) => void;
/** An in-memory Twilio protocol peer. It has NO phone/provider dial operation. */
class LabPeer extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  constructor(private output: (message: any) => void) { super(); }
  send(data: string) { if (this.readyState === WebSocket.OPEN) this.output(JSON.parse(data)); }
  inject(data: object) {
    if (this.readyState === WebSocket.OPEN) this.emit("message", Buffer.from(JSON.stringify(data)));
  }
  close(code = 1000, reason = "") {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit("close", code, Buffer.from(reason));
  }
}
interface Session {
  owner: string;
  ticket: string | null;
  ticketUntil: number;
  report: LabReport;
  context: SecretaryCallContext | null;
  realtime?: LabRealtimeConnection;
  negotiating?: boolean;
  negotiated?: boolean;
  started: number;
  send?: Sender;
  peer?: LabPeer;
  pendingMarks: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
  stopTimer?: ReturnType<typeof setTimeout>;
  inputReady: boolean;
  stopReason?: string;
  stopPromise?: Promise<LabReport>;
  resolveStop?: (report: LabReport) => void;
  lastGuestTurn?: number;
  firstAudioForTurn: boolean;
  inputWindow: number;
  inputBytes: number;
}
function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
function errorCategory(reason?: string): string {
  if (!reason) return "engine_closed";
  if (/five-minute/i.test(reason)) return "duration_limit";
  if (/transcript.*saved/i.test(reason)) return "transcript_error";
  if (/acknowledgement/i.test(reason)) return "playback_ack_timeout";
  if (/synthesis.*timed out/i.test(reason)) return "tts_timeout";
  if (/voice|PCM|synthesis|speech/i.test(reason)) return "tts_error";
  if (/Realtime.*closed/i.test(reason)) return "openai_disconnected";
  if (/Realtime|OpenAI/i.test(reason)) return "openai_error";
  return "engine_error";
}

export class SecretaryLab {
  private sessions = new Map<string, Session>();
  private attempts = new Map<string, number[]>();
  private now: () => number;
  constructor(private deps: LabDependencies) { this.now = deps.now ?? Date.now; }
  sweep() { this.prune(); }
  private prune() {
    const now = this.now();
    for (const [id, s] of Array.from(this.sessions.entries())) {
      if (s.report.status === "awaiting_connection" && s.ticketUntil < now) this.end(s, "connection_timeout");
      if (s.report.status === "ended" && now - Date.parse(s.report.endedAt!) > 3_600_000) this.sessions.delete(id);
    }
    for (const [owner, times] of Array.from(this.attempts.entries())) {
      const recent = times.filter(t => now - t < 3_600_000);
      if (recent.length) this.attempts.set(owner, recent); else this.attempts.delete(owner);
    }
  }
  reports(owner: string): LabReport[] {
    this.prune();
    return Array.from(this.sessions.values()).filter(s => s.owner === owner)
      .map(s => pricedLabReport("gpt", s.report)).reverse().slice(0, 20);
  }
  private event(s: Session, type: string, detail?: string) {
    const event = { type, atMs: this.now() - s.started, ...(detail ? { detail } : {}) };
    s.report.events.push(event);
    if (s.report.events.length > 300) s.report.events.shift();
    s.send?.({ type: "event", event });
  }
  private addTurn(s: Session, role: "guest" | "secretary", text: string, interrupted?: boolean) {
    if (s.report.status === "ended") return;
    if (s.report.turns.length >= 200) { void this.stop(s.owner, s.report.id, "turn_limit"); return; }
    const turn: LabTurn = { id: randomUUID(), role, text: text.slice(0, 1500), atMs: this.now() - s.started,
      ...(interrupted ? { interrupted: true } : {}) };
    s.report.turns.push(turn);
    if (role === "guest") {
      s.report.metrics.guestTurns++;
      // Native speech-to-speech may answer before optional display STT finishes.
      if (s.report.voiceProvider !== "openai") { s.lastGuestTurn = this.now(); s.firstAudioForTurn = true; }
      s.send?.({ type: "state", state: "thinking", atMs: turn.atMs });
    } else {
      s.report.metrics.secretaryTurns++;
      s.send?.({ type: "state", state: "listening", atMs: turn.atMs });
    }
    s.send?.({ type: "turn", turn });
    void this.deps.translate(text).then(result => {
      if (result.translation) {
        turn.translation = result.translation.slice(0, 4000);
        s.send?.({ type: "subtitle", turnId: turn.id, translation: turn.translation });
      } else this.event(s, "subtitle_unavailable", "Translation unavailable; audio continues");
    }).catch(() => this.event(s, "subtitle_unavailable", "Translation unavailable; audio continues"));
  }
  async create(owner: string, input: any) {
    this.prune();
    if (!owner) fail(401, "Authentication required");
    if (input?.consent !== true) fail(400, "Confirm paid AI/audio processing before starting a test");
    if (!["elevenlabs", "cartesia", "openai"].includes(input.voiceProvider)) fail(400, "Select a voice provider");
    if (typeof input.instruction !== "string" || input.instruction.trim().length < 8 || input.instruction.length > 4000) {
      fail(400, "Instruction must contain 8–4000 characters");
    }
    if (Object.keys(input).some(key => !["instruction", "voiceProvider", "consent"].includes(key))) {
      fail(400, "Only a lab instruction and voice selection are accepted; no telephone parameters");
    }
    if (Array.from(this.sessions.values()).some(s => s.owner === owner && s.report.status !== "ended")) {
      fail(409, "A lab session is already active");
    }
    const now = this.now();
    const times = this.attempts.get(owner) ?? [];
    if (times.length >= 6) fail(429, "Six tests per hour maximum");
    if (this.sessions.size >= 200) fail(429, "Lab capacity reached");
    // Reserve before async provider readiness lookup: concurrent starts must not race.
    const id = randomUUID();
    const s: Session = {
      owner, ticket: randomBytes(32).toString("hex"), ticketUntil: now + 30_000,
      started: now, pendingMarks: new Set(), inputReady: false, firstAudioForTurn: true,
      inputWindow: now, inputBytes: 0,
      context: null,
      report: { id, status: "awaiting_connection", createdAt: new Date(now).toISOString(), tariffSnapshot: captureLabTariff(),
        instruction: input.instruction.trim(), voiceProvider: input.voiceProvider, turns: [], events: [],
        model: input.voiceProvider === "openai" ? LAB_REALTIME_MODEL : process.env.SECRETARY_REALTIME_MODEL || "gpt-realtime",
        voice: input.voiceProvider === "openai" ? LAB_REALTIME_VOICE : `Owner-linked ${input.voiceProvider} voice`,
        transport: "simulated_twilio", modelVerified: false,
        metrics: { guestTurns: 0, secretaryTurns: 0 } },
    };
    this.sessions.set(id, s);
    try {
      if (input.voiceProvider === "openai") {
        if (!this.deps.openAI || !await this.deps.openAI.isAvailable()) throw new Error("Exact OpenAI model unavailable");
      } else s.context = { ...await this.deps.context(owner, input.voiceProvider), instruction: s.report.instruction };
      if(input.voiceProvider==="openai")s.context={
        ...await this.deps.context(owner,"openai"),voiceProvider:"openai",cloneVoiceId:"",instruction:s.report.instruction,
      };
    } catch {
      this.sessions.delete(id);
      fail(409, input.voiceProvider === "openai" ? "Exact GPT-Live 1 / gpt-6.1-sol is unavailable in this Dev environment; no fallback"
        : "The selected owner voice or OpenAI service is unavailable; configure it in Voice Lab");
    }
    if (s.report.status === "ended") fail(409, "Lab session was cancelled");
    this.attempts.set(owner, [...times, now]);
    this.event(s, "session_created");
    s.timer = setTimeout(() => this.end(s, "connection_timeout"), 30_000);
    s.timer.unref?.();
    return { id, ticket: s.ticket, socketPath: "/secretary-lab-stream", report: pricedLabReport("gpt", s.report) };
  }
  connect(ticket: string, send: Sender, close: () => void): string {
    this.prune();
    const s = Array.from(this.sessions.values()).find(item => item.ticket === ticket && item.report.status === "awaiting_connection");
    if (!s || s.ticketUntil <= this.now()) fail(401, "Lab ticket is invalid or expired");
    s.ticket = null; // One use; never a reconnect/redial credential.
    s.send = message => { try { send(message); } catch { void this.stop(s.owner, s.report.id, "browser_disconnected"); } };
    clearTimeout(s.timer);
    s.report.status = "running";
    s.send({ type: "state", state: "connecting", atMs: this.now() - s.started });
    if (s.report.voiceProvider === "openai" && s.report.transport==="webrtc") {
      try {
        const meter = new RealtimeUsageMeter();
        s.report.realtimeUsage = meter.totals;
        s.realtime = this.deps.openAI!.create(s.owner, s.report.instruction, {
          ready: (model, voice) => {
            if (s.report.status === "ended") return;
            s.report.model = model; s.report.voice = voice; s.report.modelVerified = true;
            s.report.audioConnectedAt ??= new Date(this.now()).toISOString();
            s.send?.({ type: "ready", model, voice, transport: "webrtc" });
          },
          turn: (role, text, interrupted) => this.addTurn(s, role, text, interrupted),
          usage: (id, usage) => meter.record(id, usage),
          clear: responseId => s.send?.({ type: "clear", responseId }),
          state: state => s.send?.({ type: "state", state, atMs: this.now() - s.started }),
          event: type => {
            this.event(s, type);
            if (type === "guest_speech_stopped") { s.lastGuestTurn = this.now(); s.firstAudioForTurn = true; }
            if (type === "output_audio_started") {
              s.report.metrics.firstAudioMs ??= this.now() - s.started;
              if (s.lastGuestTurn !== undefined && s.firstAudioForTurn) {
                s.report.metrics.lastTurnToAudioMs = this.now() - s.lastGuestTurn; s.firstAudioForTurn = false;
              }
              s.send?.({ type: "metrics", metrics: { ...s.report.metrics } });
            }
          },
          end: reason => { this.end(s, s.stopReason ?? reason); close(); },
        });
        s.send({ type: "rtc_offer_required" });
        s.timer = setTimeout(() => { void this.stop(s.owner, s.report.id, "duration_limit"); }, 300_000);
        s.timer.unref?.();
      } catch { this.end(s, "openai_setup_error"); close(); }
      return s.report.id;
    }
    const streamSid = `lab-stream-${s.report.id}`;
    s.peer = new LabPeer(message => {
      if (s.report.status === "ended") return;
      if (message.event === "media") {
        const atMs = this.now() - s.started;
        s.report.metrics.firstAudioMs ??= atMs;
        if (s.lastGuestTurn !== undefined && s.firstAudioForTurn) {
          s.report.metrics.lastTurnToAudioMs = this.now() - s.lastGuestTurn;
          s.firstAudioForTurn = false;
        }
        s.send?.({ type: "audio", payload: message.media.payload, atMs });
      } else if (message.event === "mark") {
        s.pendingMarks.add(message.mark.name);
        s.send?.({ type: "mark", name: message.mark.name });
      } else if (message.event === "clear") {
        s.pendingMarks.clear();
        s.send?.({ type: "clear" });
      }
    });
    const finish = (reason?: string) => { this.end(s, s.stopReason ?? errorCategory(reason)); close(); };
    try {
      this.deps.startEngine(s.peer as unknown as WebSocket, {
        lookup: async (sid, id, auth) => sid === `lab-${s.report.id}` && id === s.report.id && auth === "isolated-lab"
          ? s.context : null,
        onAudio: () => {}, // No audio retained in lab reports.
        onDiagnostic: event => {
          if (s.report.status === "ended") return;
          this.event(s, event);
          if (event === "realtime_ready") {
            s.inputReady = true;s.report.modelVerified=s.report.voiceProvider==="openai";
            s.send?.({ type: "ready",model:s.report.model,voice:s.report.voice,transport:s.report.transport,modelVerified:s.report.modelVerified });
          }
          const state = event === "tts_received" ? "speaking"
            : event === "guest_speech_started" || event === "realtime_ready" ? "listening" : "thinking";
          s.send?.({ type: "state", state, atMs: this.now() - s.started });
        },
        onTurn: async (_id, role, text) => { this.addTurn(s, role, text); },
        onStreamEnd: async (_id, reason) => finish(reason),
        onEndCall: async () => finish(), // Simulated lab transport only; never a provider operation.
      });
      s.peer.inject({ event: "start", start: { callSid: `lab-${s.report.id}`, streamSid,
        customParameters: { taskId: s.report.id, streamAuth: "isolated-lab" } } });
    } catch { finish("engine error"); }
    if (!s.report.endedAt) {
      s.timer = setTimeout(() => { void this.stop(s.owner, s.report.id, "duration_limit"); }, 300_000);
      s.timer.unref?.();
    }
    return s.report.id;
  }
  async negotiate(owner: string, id: string, sdp: unknown) {
    const s = this.sessions.get(id);
    if (!s || s.owner !== owner) fail(404, "Lab session not found");
    if (s.report.status !== "running" || !s.realtime) fail(409, "No active OpenAI lab connection");
    if (typeof sdp !== "string" || sdp.length > 24_000 || !/^v=0\r?\n/.test(sdp) || !sdp.includes("m=audio")) fail(400, "Invalid audio SDP");
    if (s.negotiating || s.negotiated) fail(409, "WebRTC negotiation is single-use");
    s.negotiating = true;
    try {
      const answer = await s.realtime.connect(sdp);
      if (s.report.endedAt) fail(409, "Lab session ended during negotiation");
      s.negotiated = true;
      return { sdp: answer, model: s.report.model, voice: s.report.voice };
    } catch {
      this.end(s, "openai_setup_error");
      fail(409, "OpenAI WebRTC negotiation failed; no provider fallback");
    } finally { s.negotiating = false; }
  }
  receive(id: string, input: any) {
    const s = this.sessions.get(id);
    if (!s || s.report.status !== "running") return;
    if (input?.type === "rtc_connected") { s.realtime?.startIntroduction(); return; }
    if (input?.type === "user_stop") { void this.stop(s.owner, id); return; }
    if (input?.type === "client_error") {
      if (isLabClientStopReason(input.reason)) void this.stop(s.owner, id, input.reason);
      return;
    }
    if (input?.type === "mark") {
      if (typeof input.name !== "string" || !s.pendingMarks.delete(input.name)) return;
      s.peer?.inject({ event: "mark", mark: { name: input.name } });
    } else if (input?.type === "media" && s.inputReady) {
      const p = input.payload;
      if (typeof p !== "string" || p.length > 4096 || p.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(p)) {
        void this.stop(s.owner, id, "invalid_audio"); return;
      }
      if (this.now() - s.inputWindow >= 1000) { s.inputBytes = 0; s.inputWindow = this.now(); }
      s.inputBytes += Buffer.byteLength(p, "base64");
      if (s.inputBytes > 24_000) { void this.stop(s.owner, id, "audio_rate_limit"); return; }
      s.peer?.inject({ event: "media", media: { payload: p } });
    }
  }
  async stop(owner: string, id: string, reason = "user_stop"): Promise<LabReport> {
    const s = this.sessions.get(id);
    if (!s || s.owner !== owner) fail(404, "Lab session not found");
    if (s.report.status === "ended") return pricedLabReport("gpt", s.report);
    if (s.stopPromise) return s.stopPromise;
    s.stopReason = reason;
    s.stopPromise = new Promise(resolve => { s.resolveStop = resolve; });
    s.peer?.inject({ event: "stop" });
    if (!s.peer) this.end(s, reason);
    else {
      s.stopTimer = setTimeout(() => this.end(s, reason), 2000);
      s.stopTimer.unref?.();
    }
    return s.stopPromise;
  }
  disconnected(id: string) {
    const s = this.sessions.get(id);
    if (s && s.report.status !== "ended") void this.stop(s.owner, id, "browser_disconnected");
  }
  private end(s: Session, reason: string) {
    if (s.report.status === "ended") return;
    clearTimeout(s.timer); clearTimeout(s.stopTimer);
    s.ticket = null;
    s.report.status = "ended";
    s.report.reason = reason;
    s.report.endedAt = new Date(this.now()).toISOString();
    this.event(s, "session_ended", reason);
    s.peer?.close();
    s.send?.({ type: "ended", report: pricedLabReport("gpt", s.report) });
    s.send = undefined;
    if (s.context) s.context.cloneVoiceId = "";
    void s.realtime?.stop();
    try { this.deps.onEnd?.(pricedLabReport("gpt", s.report)); } catch { /* Reporting cannot keep audio running. */ }
    s.resolveStop?.(pricedLabReport("gpt", s.report));
  }
}
