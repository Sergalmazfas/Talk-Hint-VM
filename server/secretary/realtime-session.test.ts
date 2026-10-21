import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAISecretaryRealtimeSession, type SecretaryRealtimeEvent } from "./agent";

class ProtocolSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  sent: any[] = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  message(data: object) { this.emit("message", Buffer.from(JSON.stringify(data))); }
  close() { this.readyState = WebSocket.CLOSED; this.emit("close"); }
}

describe("Secretary actual OpenAI wire protocol — interruption is not a hangup", () => {
  let socket: ProtocolSocket, session: OpenAISecretaryRealtimeSession, events: SecretaryRealtimeEvent[];
  beforeEach(async () => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-no-network");
    socket = new ProtocolSocket(); events = [];
    session = new OpenAISecretaryRealtimeSession("Fixture", () => socket as unknown as WebSocket);
    session.onEvent(event => events.push(event));
    const connected = session.connect();
    socket.emit("open"); socket.message({ type: "session.updated" }); await connected;
  });
  afterEach(() => { session.close(); vi.unstubAllEnvs(); });
  it("keeps full session instructions in the cloned-voice introduction without the old AI-assistant override", () => {
    session.startIntroduction();
    const introductions = socket.sent.filter(e => e.type === "response.create");
    expect(introductions).toHaveLength(1);
    expect(introductions[0].response.instructions).toContain("Fixture");
    expect(introductions[0].response.instructions).toContain("trusted standard secretary introduction");
    expect(introductions[0].response.instructions).not.toContain("identify yourself as an AI assistant");
  });
  it("never cancels when only the external cloned voice is playing after response.done", () => {
    socket.message({ type: "response.created", response: { id: "r1" } });
    socket.message({ type: "response.output_text.done", response_id: "r1", text: "Hello." });
    socket.message({ type: "response.done", response: { id: "r1", status: "completed" } });
    expect(events.some(e => e.type === "response_text")).toBe(true);
    session.cancelResponse();
    expect(socket.sent.filter(m => m.type === "response.cancel")).toHaveLength(0);
    socket.message({ type: "input_audio_buffer.speech_started" });
    socket.message({ type: "conversation.item.input_audio_transcription.completed", transcript: "Hello" });
    expect(events.some(e => e.type === "guest_transcript" && e.text === "Hello")).toBe(true);
    expect(events.some(e => e.type === "error" && e.fatal)).toBe(false);
  });
  it("targets an actually active response rather than cancelling an unrelated future answer", () => {
    socket.message({ type: "response.created", response: { id: "r2" } });
    session.cancelResponse();
    expect(socket.sent.at(-1)).toEqual({ type: "response.cancel", response_id: "r2" });
  });
  it("survives a server-VAD cancellation race, then accepts a new question and answer", () => {
    socket.message({ type: "response.created", response: { id: "old" } });
    session.cancelResponse();
    socket.message({ type: "error", error: { code: "response_cancel_not_active", message: "No active response found" } });
    expect(events.some(e => e.type === "error" && e.fatal)).toBe(false);
    socket.message({ type: "conversation.item.input_audio_transcription.completed", transcript: "Hello" });
    socket.message({ type: "response.created", response: { id: "new" } });
    socket.message({ type: "response.output_text.done", response_id: "new", text: "Hello, how can I help?" });
    socket.message({ type: "response.done", response: { id: "new", status: "completed" } });
    expect(events.some(e => e.type === "guest_transcript" && e.text === "Hello")).toBe(true);
    expect(events.some(e => e.type === "response_text" && e.text === "Hello, how can I help?")).toBe(true);
  });
  it("still rejects genuine service errors; does not silence all OpenAI failures", () => {
    socket.message({ type: "error", error: { code: "invalid_request_error", message: "Invalid audio format" } });
    expect(events.at(-1)).toMatchObject({ type: "error", fatal: true });
  });
});
