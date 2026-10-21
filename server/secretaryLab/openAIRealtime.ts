import { createHash } from "node:crypto";
import WebSocket from "ws";
import { buildSecretaryInstructions } from "../secretary/agent";
import { confirmedSecretaryOwnerName, type ConfirmedSecretaryOwnerName } from "../secretary/ownerIdentity";

export const LAB_REALTIME_MODEL = "gpt-realtime-2.1";
export const LAB_REALTIME_VOICE = "marin";
export const LAB_REASONING = "high";
const API = "https://api.openai.com/v1";
export interface LabRealtimeCallbacks {
  ready(model: string, voice: string): void;
  turn(role: "guest" | "secretary", text: string, interrupted?: boolean): void;
  state(state: "listening" | "thinking" | "speaking"): void;
  clear(responseId?: string): void;
  event(type: string): void;
  end(reason: string): void;
}
export interface LabRealtimeConnection {
  connect(sdp: string): Promise<string>;
  startIntroduction(): void;
  stop(): Promise<void>;
}
export interface RealtimeNetwork {
  fetch: typeof fetch;
  socket(url: string, options: { headers: Record<string, string> }): WebSocket;
}
const network: RealtimeNetwork = { fetch, socket: (url, options) => new WebSocket(url, options) };

/** No environment overrides or model fallback: this is an explicit comparison. */
export function labRealtimeConfig(instruction: string, ownerName?: ConfirmedSecretaryOwnerName) {
  return {
    type: "realtime", model: LAB_REALTIME_MODEL, output_modalities: ["audio"],
    reasoning: { effort: LAB_REASONING },
    instructions: buildSecretaryInstructions(instruction, ownerName) + "\n\n" + [
      "This is an authorized private conversation test; there is no telephone dial operation.",
      "If the representative asks you to hold or transfer, acknowledge briefly ONCE and then wait quietly.",
      "Silence or hold music is not a new question, success or permission to end the conversation.",
      "When a human returns, resume the same task naturally. Understand corrections and clarification before answering.",
      "Let the representative interrupt freely. Never resume an obsolete interrupted answer.",
    ].join("\n"),
    audio: {
      input: {
        noise_reduction: { type: "near_field" },
        // Optional display transcription, NOT an STT→LLM→TTS conversation chain.
        transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
        turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true },
      },
      output: { voice: LAB_REALTIME_VOICE },
    },
  };
}

export async function checkLabRealtimeModel(net: Pick<RealtimeNetwork, "fetch"> = network) {
  if (!process.env.OPENAI_API_KEY) return { ready: false, reason: "OpenAI API is not configured" };
  try {
    const response = await net.fetch(`${API}/models/${LAB_REALTIME_MODEL}`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(12_000), redirect: "error",
    });
    const data = await response.json();
    return response.status === 200 && data.id === LAB_REALTIME_MODEL
      ? { ready: true }
      : { ready: false, reason: `Exact model access unconfirmed (HTTP ${response.status}); no fallback` };
  } catch { return { ready: false, reason: "Exact model access check failed; no fallback" }; }
}

/** Audio is browser↔OpenAI WebRTC. This server sees control/transcript events only. */
export class OpenAILabRealtime implements LabRealtimeConnection {
  private callId?: string;
  private socket?: WebSocket;
  private closed = false;
  private started = false;
  private ready = false;
  private introduced = false;
  private timer?: ReturnType<typeof setTimeout>;
  private outputResponse = "";
  private interrupted = new Set<string>();
  private transcripts = new Map<string, string>();
  private emitted = new Set<string>();
  private finished = new Set<string>();
  constructor(
    private readonly owner: string, private readonly instruction: string,
    private readonly callbacks: LabRealtimeCallbacks, private readonly net: RealtimeNetwork = network,
  ) {}
  async connect(sdp: string): Promise<string> {
    if (this.started || this.closed) throw new Error("Realtime negotiation is single-use");
    this.started = true;
    const form = new FormData();
    form.set("sdp", sdp);
    form.set("session", JSON.stringify(labRealtimeConfig(this.instruction, confirmedSecretaryOwnerName(this.owner))));
    const response = await this.net.fetch(`${API}/realtime/calls`, {
      method: "POST", headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Safety-Identifier": createHash("sha256").update(`talkhint-lab:${this.owner}`).digest("hex"),
      }, body: form, signal: AbortSignal.timeout(20_000), redirect: "error",
    });
    if (![200, 201].includes(response.status)) {
      this.fail(`openai_setup_http_${response.status}`);
      throw new Error(`OpenAI WebRTC setup failed (HTTP ${response.status}); no fallback`);
    }
    const location = new URL(response.headers.get("location") ?? "", API);
    if (location.origin !== "https://api.openai.com" || location.search || location.hash ||
        !/^\/v1\/realtime\/calls\/[A-Za-z0-9_-]{1,200}$/.test(location.pathname)) {
      this.fail("openai_invalid_session_location");
      throw new Error("OpenAI returned no valid session location");
    }
    this.callId = location.pathname.split("/").at(-1)!;
    const answer = await response.text();
    if (this.closed) { await this.hangup(); throw new Error("Lab session already stopped"); }
    if (!/^v=0\r?\n/.test(answer)) { this.fail("openai_invalid_sdp"); throw new Error("Invalid OpenAI SDP"); }
    // Return SDP without waiting for browser ICE; sideband never needs browser credentials.
    this.socket = this.net.socket(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(this.callId)}`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
    this.timer = setTimeout(() => this.fail("openai_sideband_timeout"), 12_000);
    this.timer.unref?.();
    // Attaching to an EXISTING WebRTC session need not replay session.created.
    // Request an idempotent update and validate the full session.updated ACK.
    this.socket.on("open", () => this.send({
      type: "session.update", session: { type: "realtime", instructions: labRealtimeConfig(this.instruction, confirmedSecretaryOwnerName(this.owner)).instructions },
    }));
    this.socket.on("message", raw => {
      let event: any; try { event = JSON.parse(raw.toString()); } catch { return; }
      if (!this.closed) this.handle(event);
    });
    this.socket.on("error", () => this.fail("openai_connection_error"));
    this.socket.on("close", () => { if (!this.closed) this.fail("openai_disconnected"); });
    return answer;
  }
  private send(event: object) {
    if (!this.closed && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }
  private handle(event: any) {
    if (event.type === "session.created" || event.type === "session.updated") {
      const session = event.session;
      if (session?.model !== LAB_REALTIME_MODEL || session?.audio?.output?.voice !== LAB_REALTIME_VOICE) {
        this.fail("openai_model_voice_mismatch"); return;
      }
      if (!this.ready) {
        clearTimeout(this.timer); this.ready = true;
        this.callbacks.event("realtime_ready");
        this.callbacks.ready(session.model, session.audio.output.voice);
      }
    } else if (event.type === "input_audio_buffer.speech_started") {
      if (this.outputResponse) {
        this.interrupted.add(this.outputResponse);
        this.flushTranscript(this.outputResponse, true);
        // WebRTC + interrupt_response already clears/truncates on server VAD.
        // A duplicate clear here can itself race the completed output buffer.
      }
      this.callbacks.clear(this.outputResponse || undefined);
      this.callbacks.event("guest_speech_started");
      this.callbacks.state("listening");
    } else if (event.type === "input_audio_buffer.speech_stopped") {
      this.callbacks.event("guest_speech_stopped");
      this.callbacks.state("thinking");
    } else if (event.type === "conversation.item.input_audio_transcription.completed") {
      if (typeof event.transcript === "string" && event.transcript.trim()) this.callbacks.turn("guest", event.transcript);
    } else if (event.type === "response.output_audio_transcript.done") {
      this.callbacks.event("assistant_transcript_received");
      if (typeof event.response_id === "string" && typeof event.transcript === "string") {
        this.transcripts.set(event.response_id, event.transcript);
        if (this.interrupted.has(event.response_id) || this.finished.has(event.response_id)) {
          this.flushTranscript(event.response_id, this.interrupted.has(event.response_id));
        }
      }
    } else if (event.type === "output_audio_buffer.started") {
      const id = event.response_id;
      if (typeof id !== "string" || this.interrupted.has(id)) return;
      this.outputResponse = id;
      this.callbacks.event("output_audio_started");
      this.callbacks.state("speaking");
    } else if (event.type === "output_audio_buffer.stopped" || event.type === "output_audio_buffer.cleared") {
      this.callbacks.event(event.type.endsWith("cleared") ? "output_audio_cleared" : "output_audio_stopped");
      const id = event.response_id ?? this.outputResponse;
      if (id) this.finished.add(id);
      if (id) this.flushTranscript(id, event.type.endsWith("cleared") || this.interrupted.has(id));
      if (id === this.outputResponse) this.outputResponse = "";
      this.callbacks.state("listening");
    } else if (event.type === "error") {
      // Only expected already-settled interruption races are non-fatal.
      if (["response_cancel_not_active", "output_audio_buffer_clear_not_active"].includes(event.error?.code)) return;
      this.fail("openai_realtime_error");
    } else if (event.type === "response.done" && event.response?.status === "failed") {
      this.fail("openai_response_failed");
    } else if (event.type === "conversation.item.input_audio_transcription.failed") {
      this.callbacks.event("input_transcription_failed");
    }
    // Bounded per-session bookkeeping, no audio retention.
    while (this.interrupted.size > 100) this.interrupted.delete(this.interrupted.values().next().value!);
    while (this.emitted.size > 200) this.emitted.delete(this.emitted.values().next().value!);
    while (this.finished.size > 200) this.finished.delete(this.finished.values().next().value!);
    while (this.transcripts.size > 100) this.transcripts.delete(this.transcripts.keys().next().value!);
  }
  private flushTranscript(id: string, interrupted: boolean) {
    const text = this.transcripts.get(id);
    if (!text || this.emitted.has(id)) return;
    this.emitted.add(id); this.transcripts.delete(id);
    this.callbacks.turn("secretary", text, interrupted);
  }
  startIntroduction() {
    if (!this.ready || this.introduced || this.closed) return;
    this.introduced = true;
    this.send({ type: "response.create", response: {
      // Per-response instructions replace rather than append session instructions.
      instructions: labRealtimeConfig(this.instruction, confirmedSecretaryOwnerName(this.owner)).instructions +
        "\nBegin with the trusted standard secretary introduction above and this authorized task, then listen. Do not invent any details.",
    } });
  }
  private fail(reason: string) {
    if (this.closed) return;
    void this.stop();
    this.callbacks.end(reason);
  }
  private async hangup() {
    if (!this.callId) return;
    const id = this.callId; this.callId = undefined;
    try {
      await this.net.fetch(`${API}/realtime/calls/${encodeURIComponent(id)}/hangup`, {
        method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(5000), redirect: "error",
      });
    } catch { /* Browser tracks and server sideband are still closed; no retry session. */ }
  }
  async stop() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer);
    this.socket?.close(); this.transcripts.clear(); this.interrupted.clear(); this.emitted.clear(); this.finished.clear();
    await this.hangup();
  }
}
