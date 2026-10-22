import WebSocket from "ws";
import type { SecretaryRealtimeEvent, SecretaryRealtimeSession } from "./agent";
// Retained only for historical protocol tests; new phone sessions use liveAudio.ts.
const SECRETARY_AUDIO_MODEL="gpt-realtime-2.1",SECRETARY_AUDIO_VOICE="marin";

/** Direct OpenAI speech↔speech, using the SAME G.711 format as Twilio. */
export class OpenAISecretaryAudioSession implements SecretaryRealtimeSession {
  readonly inputFormat = "mulaw8k" as const;
  private socket?: WebSocket;
  private ready = false;
  private closed = false;
  private introduced = false;
  private active = "";
  private blocked = new Set<string>();
  private listeners: Array<(event: SecretaryRealtimeEvent) => void> = [];
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private instructions: string, private createSocket = (url: string) =>
    new WebSocket(url, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } })) {}
  onEvent(listener: (event: SecretaryRealtimeEvent) => void) { this.listeners.push(listener); }
  connect(): Promise<void> {
    if (this.socket || this.closed) return Promise.reject(new Error("Secretary audio session is single-use"));
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (reason: string) => {
        if (this.closed) return;
        clearTimeout(this.timer);
        if (!settled) { settled = true; reject(new Error(reason)); this.close(); }
        else this.emit({ type: "error", message: reason, fatal: true });
      };
      const socket = this.socket = this.createSocket(`wss://api.openai.com/v1/realtime?model=${SECRETARY_AUDIO_MODEL}`);
      this.timer = setTimeout(() => fail("OpenAI Secretary audio connection timed out"), 12_000);
      this.timer.unref?.();
      socket.on("open", () => this.send({ type: "session.update", session: {
        type: "realtime", model: SECRETARY_AUDIO_MODEL, output_modalities: ["audio"],
        reasoning: { effort: "high" },
        instructions: this.instructions + "\nWhen asked to hold or wait for a transfer, acknowledge once, remain silent and listen until the other party returns. Silence or hold music alone is not a reason to end the call.",
        audio: {
          input: { format: { type: "audio/pcmu" },
            transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
            turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true } },
          output: { format: { type: "audio/pcmu" }, voice: SECRETARY_AUDIO_VOICE },
        },
      } }));
      socket.on("message", raw => {
        if (this.closed) return;
        let e: any; try { e = JSON.parse(raw.toString()); } catch { return; }
        if (e.type === "session.updated" && !this.ready) {
          if (e.session?.model !== SECRETARY_AUDIO_MODEL ||
            e.session?.audio?.output?.voice !== SECRETARY_AUDIO_VOICE ||
            e.session?.audio?.output?.format?.type !== "audio/pcmu" ||
            e.session?.audio?.input?.format?.type !== "audio/pcmu") return fail("OpenAI Secretary model, voice or telephone audio format was not verified");
          clearTimeout(this.timer); this.ready = true; settled = true;
          this.emit({ type: "ready" }); resolve(); return;
        }
        if (e.type === "error") {
          if (e.error?.code === "response_cancel_not_active") return;
          return fail("OpenAI Secretary audio request failed");
        }
        if (!this.ready) return;
        if (e.type === "response.created") this.active = String(e.response?.id ?? "");
        if (e.type === "input_audio_buffer.speech_started") {
          if (this.active) {
            this.blocked.add(this.active);
            if (this.blocked.size > 100) this.blocked.delete(this.blocked.values().next().value!);
          }
          this.emit({ type: "speech_started" });
        }
        if (e.type === "conversation.item.input_audio_transcription.completed" && typeof e.transcript === "string")
          this.emit({ type: "guest_transcript", text: e.transcript.slice(0, 1500) });
        const id = String(e.response_id ?? "");
        if (id && !this.blocked.has(id)) {
          if (e.type === "response.output_audio.delta" && typeof e.delta === "string") {
            if (e.delta.length > 128_000 || e.delta.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(e.delta)) return fail("Invalid OpenAI telephone audio");
            this.emit({ type: "audio", responseId: id, itemId: String(e.item_id ?? ""), mulaw: Buffer.from(e.delta, "base64") });
          }
          if (e.type === "response.output_audio.done") this.emit({ type: "audio_done", responseId: id });
          if (e.type === "response.output_audio_transcript.done" && typeof e.transcript === "string")
            this.emit({ type: "assistant_transcript", responseId: id, text: e.transcript.slice(0, 1500) });
        }
        if (e.type === "response.done") {
          if (e.response?.status === "failed") return fail("OpenAI Secretary response failed");
          // Keep the last response id for interruption during queued playback.
        }
      });
      socket.on("error", () => fail("OpenAI Secretary audio connection failed"));
      socket.on("close", () => {
        clearTimeout(this.timer);
        if (!settled) { settled = true; reject(new Error("OpenAI Secretary closed before readiness")); }
        if (!this.closed) {
          this.emit({ type: "closed" });
        }
      });
    });
  }
  sendAudio(mulaw: Buffer) {
    if (this.ready) this.send({ type: "input_audio_buffer.append", audio: mulaw.toString("base64") });
  }
  startIntroduction() {
    if (!this.ready || this.introduced) return;
    this.introduced = true;
    // Do not override session instructions: they contain the actual authorized task.
    this.send({ type: "response.create" });
  }
  cancelResponse() { /* semantic VAD cancels generation; bridge clears/truncates actual playback */ }
  truncate(itemId: string, audioEndMs: number) {
    if (itemId) this.send({ type: "conversation.item.truncate", item_id: itemId, content_index: 0, audio_end_ms: Math.max(0, Math.floor(audioEndMs)) });
  }
  close() { this.closed = true; this.ready = false; clearTimeout(this.timer); this.socket?.close(); }
  private send(event: object) {
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN) return;
    const data = JSON.stringify(event);
    if (this.socket.bufferedAmount + Buffer.byteLength(data) > 512 * 1024) {
      this.emit({ type: "error", message: "OpenAI Secretary audio buffer exceeded its limit", fatal: true }); return;
    }
    this.socket.send(data);
  }
  private emit(event: SecretaryRealtimeEvent) {
    for (const callback of this.listeners) {
      try { callback(event); } catch { /* A reporting callback must not crash the telephone runtime. */ }
    }
  }
}
