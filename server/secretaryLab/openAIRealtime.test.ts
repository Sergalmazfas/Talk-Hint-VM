import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkLabRealtimeModel, labRealtimeConfig, LAB_REALTIME_MODEL, LAB_REALTIME_VOICE,
  OpenAILabRealtime, type LabRealtimeCallbacks, type RealtimeNetwork,
} from "./openAIRealtime";

class Socket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  sent: any[] = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = WebSocket.CLOSED; this.emit("close"); }
  message(event: object) { this.emit("message", Buffer.from(JSON.stringify(event))); }
}
const SDP = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
describe("Dev native OpenAI speech-to-speech — never a telephone call", () => {
  let socket: Socket, net: RealtimeNetwork, callbacks: LabRealtimeCallbacks, driver: OpenAILabRealtime;
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-not-a-key");
    socket = new Socket();
    net = {
      fetch: vi.fn(async () => new Response(SDP, { status: 201,
        headers: { location: "https://api.openai.com/v1/realtime/calls/rtc_fixture" } })) as typeof fetch,
      socket: vi.fn(() => socket as unknown as WebSocket),
    };
    callbacks = { ready: vi.fn(), turn: vi.fn(), state: vi.fn(), clear: vi.fn(), event: vi.fn(), end: vi.fn() };
    driver = new OpenAILabRealtime("owner-fixture", "Ask about opening hours.", callbacks, net);
  });
  afterEach(async () => { await driver.stop(); vi.unstubAllEnvs(); vi.useRealTimers(); });
  async function connected() {
    await driver.connect(SDP);
    socket.message({ type: "session.created", session: labRealtimeConfig("Ask about opening hours.") });
  }
  function response(id: string, text: string) {
    socket.message({ type: "output_audio_buffer.started", response_id: id });
    socket.message({ type: "response.output_audio_transcript.done", response_id: id, transcript: text });
    socket.message({ type: "output_audio_buffer.stopped", response_id: id });
  }
  it("requests the exact model, built-in voice and high reasoning, never clone synthesis", async () => {
    await connected();
    const args = vi.mocked(net.fetch).mock.calls[0];
    expect(args[0]).toBe("https://api.openai.com/v1/realtime/calls");
    const config = JSON.parse((args[1]!.body as FormData).get("session") as string);
    expect(config).toMatchObject({ model: LAB_REALTIME_MODEL, output_modalities: ["audio"], reasoning: { effort: "high" },
      audio: { output: { voice: LAB_REALTIME_VOICE }, input: { turn_detection: { interrupt_response: true } } } });
    expect(config.instructions).toContain("Ask about opening hours.");
    expect(callbacks.ready).toHaveBeenCalledWith(LAB_REALTIME_MODEL, LAB_REALTIME_VOICE);
    driver.startIntroduction(); driver.startIntroduction();
    expect(socket.sent.filter(e => e.type === "response.create")).toHaveLength(1);
    expect(socket.sent.find(e => e.type === "response.create").response.instructions).toContain("Ask about opening hours.");
    expect(socket.sent.find(e => e.type === "response.create").response.instructions)
      .toContain("trusted standard secretary introduction");
    expect(socket.sent.find(e => e.type === "response.create").response.instructions)
      .not.toContain("natural AI-assistant introduction");
  });
  it("actively requests a configuration ACK when joining an existing WebRTC call", async () => {
    await driver.connect(SDP);
    socket.emit("open");
    expect(socket.sent.at(-1)).toMatchObject({ type: "session.update", session: { type: "realtime" } });
    expect(callbacks.ready).not.toHaveBeenCalled();
    socket.message({ type: "session.updated", session: labRealtimeConfig("Ask about opening hours.") });
    expect(callbacks.ready).toHaveBeenCalledTimes(1);
  });
  it("fails closed on an actual model/voice mismatch, without replacing it", async () => {
    await driver.connect(SDP);
    socket.message({ type: "session.created", session: { model: "gpt-realtime", audio: { output: { voice: "alloy" } } } });
    expect(callbacks.ready).not.toHaveBeenCalled();
    expect(callbacks.end).toHaveBeenCalledWith("openai_model_voice_mismatch");
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
  it("clears stale playback state on interruption without issuing another cancellation race", async () => {
    await connected();
    socket.message({ type: "output_audio_buffer.started", response_id: "old" });
    socket.message({ type: "response.output_audio_transcript.done", response_id: "old", transcript: "An interrupted answer." });
    socket.message({ type: "input_audio_buffer.speech_started" });
    expect(callbacks.clear).toHaveBeenCalledWith("old");
    expect(callbacks.turn).toHaveBeenCalledWith("secretary", "An interrupted answer.", true);
    expect(socket.sent).toHaveLength(0);
    const states = vi.mocked(callbacks.state).mock.calls.length;
    socket.message({ type: "output_audio_buffer.started", response_id: "old" });
    expect(vi.mocked(callbacks.state).mock.calls).toHaveLength(states);
    socket.message({ type: "conversation.item.input_audio_transcription.completed", transcript: "Actually, I meant tomorrow." });
    response("new", "Tomorrow, understood.");
    expect(callbacks.turn).toHaveBeenCalledWith("guest", "Actually, I meant tomorrow.");
    expect(callbacks.turn).toHaveBeenCalledWith("secretary", "Tomorrow, understood.", false);
    expect(callbacks.end).not.toHaveBeenCalled();
  });
  it("keeps the same session through Please hold, 180 seconds of silence and a returning person", async () => {
    vi.useFakeTimers(); await connected();
    socket.message({ type: "conversation.item.input_audio_transcription.completed", transcript: "Please hold." });
    response("hold", "Of course, I'll wait.");
    await vi.advanceTimersByTimeAsync(180_000);
    expect(callbacks.end).not.toHaveBeenCalled();
    socket.message({ type: "conversation.item.input_audio_transcription.completed", transcript: "I'm back. How can I help?" });
    response("return", "Thank you. What time do you open tomorrow?");
    expect(callbacks.turn).toHaveBeenCalledWith("secretary", "Thank you. What time do you open tomorrow?", false);
    expect(net.socket).toHaveBeenCalledTimes(1);
  });
  it("does not lose a transcript if the playback-stopped event precedes its final text", async () => {
    await connected();
    socket.message({ type: "output_audio_buffer.stopped", response_id: "late" });
    socket.message({ type: "response.output_audio_transcript.done", response_id: "late", transcript: "Hello." });
    expect(callbacks.turn).toHaveBeenCalledWith("secretary", "Hello.", false);
  });
  it("negotiates only once and hangs up the OpenAI media resource exactly once on repeated stop", async () => {
    await connected();
    await expect(driver.connect(SDP)).rejects.toThrow(/single-use/);
    await driver.stop(); await driver.stop();
    expect(vi.mocked(net.fetch).mock.calls.filter(([url]) => String(url).endsWith("/hangup"))).toHaveLength(1);
    expect(callbacks.end).not.toHaveBeenCalled();
  });
  it("closes a late-created provider resource when the owner stopped during SDP setup", async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(net.fetch).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const connecting = driver.connect(SDP);
    await driver.stop();
    resolve(new Response(SDP, { status: 201, headers: { location: "/v1/realtime/calls/rtc_late" } }));
    await expect(connecting).rejects.toThrow(/already stopped/);
    expect(net.socket).not.toHaveBeenCalled();
    expect(vi.mocked(net.fetch).mock.calls.filter(([url]) => String(url).endsWith("/rtc_late/hangup"))).toHaveLength(1);
  });
  it("does not disclose API credentials to an unexpected Location", async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response(SDP, { status: 201, headers: { location: "https://outside.example/call" } }));
    await expect(driver.connect(SDP)).rejects.toThrow(/valid session location/);
    expect(net.socket).not.toHaveBeenCalled();
  });
  it("reports exact-model unavailability rather than accepting a different model alias", async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(Response.json({ id: "gpt-realtime" }));
    expect(await checkLabRealtimeModel(net)).toMatchObject({ ready: false });
    vi.mocked(net.fetch).mockResolvedValueOnce(Response.json({ id: LAB_REALTIME_MODEL }));
    expect(await checkLabRealtimeModel(net)).toEqual({ ready: true });
  });
});
