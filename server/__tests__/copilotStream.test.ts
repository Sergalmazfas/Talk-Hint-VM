import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RealtimeTranslationSession } from "../translation/provider";
import { authorizeCopilotCall, createCopilotStream, resamplePcm16Mono } from "../copilotStream";

const { startSession } = vi.hoisted(() => ({ startSession: vi.fn() }));
vi.mock("../translation/openaiRealtimeTranslator", () => ({
  openaiRealtimeTranslationProvider: { startSession },
}));

class FakeWs extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  frames: any[] = [];
  closed = false;
  send(s: string) { this.frames.push(JSON.parse(s)); }
  close() { this.closed = true; this.readyState = 3; this.emit("close"); }
}

function session() {
  let listener: ((event: any) => void) | undefined;
  const value: RealtimeTranslationSession = {
    sendAudio: vi.fn(),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(),
    onEvent: vi.fn((cb) => { listener = cb; }),
  };
  return { value, emit: (event: any) => listener?.(event) };
}
const id = "01234567-89ab-4cde-8fab-0123456789ab";
const tick = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
};

describe("authenticated Copilot stream contract", () => {
  it("authorizes only active owned outgoing Copilot calls or accepted iOS Copilot pending calls", () => {
    expect(authorizeCopilotCall("u1", { userId: "u1", status: "active", metadata: { mode: "copilot" } }, undefined)).toBe(true);
    expect(authorizeCopilotCall("u2", { userId: "u1", status: "active", metadata: { mode: "copilot" } }, undefined)).toBe(false);
    expect(authorizeCopilotCall("u1", { userId: "u1", status: "completed", metadata: { mode: "copilot" } }, undefined)).toBe(false);
    expect(authorizeCopilotCall("u1", undefined, { userId: "u1", status: "accepted", clientType: "ios_copilot" })).toBe(true);
    expect(authorizeCopilotCall("u1", undefined, { userId: "u1", status: "accepted", clientType: "browser" })).toBe(false);
  });

  it("rejects arbitrary non-Twilio call identifiers before authorization", () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-sid", async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "random-uuid", language: "ru", sampleRateHz: 16_000 })));
    expect(ws.frames.at(-1)).toMatchObject({ type: "error", code: "call_sid" });
    expect(startSession).not.toHaveBeenCalled();
  });

  let guest: ReturnType<typeof session>;
  let privateSession: ReturnType<typeof session>;
  beforeEach(() => {
    vi.clearAllMocks();
    guest = session(); privateSession = session();
    startSession.mockImplementation(async (config: any) =>
      config.outputLanguage === "en" ? privateSession.value : guest.value);
  });

  it("resamples native 16k PCM to 24k without treating the declared rate as 24k", () => {
    const input = Buffer.alloc(16_000 * 2); // one second at 16k
    expect(resamplePcm16Mono(input, 16_000)).toHaveLength(24_000 * 2);
    expect(resamplePcm16Mono(Buffer.alloc(24_000 * 2), 24_000)).toHaveLength(24_000 * 2);
  });

  it("requires a valid start, rejects replay and malformed/rate-invalid audio", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-auth-format", async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "audio", direction: "guest", pcm16: "AAAA" })));
    expect(ws.frames.at(-1)).toMatchObject({ type: "error", code: "not_started" });
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 11025 })));
    expect(ws.frames.at(-1)).toMatchObject({ type: "error", code: "rate" });
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 16_000 })));
    await tick();
    guest.emit({ type: "ready", provider: "test", model: "test", instructions: "" });
    privateSession.emit({ type: "ready", provider: "test", model: "test", instructions: "" });
    expect(startSession).toHaveBeenCalledTimes(2);
    expect(ws.frames).toContainEqual({ type: "ready" });
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 16_000 })));
    expect(ws.frames.at(-1)).toMatchObject({ type: "error", code: "replay" });
    ws.close();
  });

  it("ACKs hold before accepting private PCM, rejects mismatched hold, and flushes VAD tail", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-hold", async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 16_000 })));
    await tick();
    guest.emit({ type: "ready", provider: "test", model: "test", instructions: "" });
    privateSession.emit({ type: "ready", provider: "test", model: "test", instructions: "" });
    const pcm = Buffer.alloc(320).toString("base64");
    ws.emit("message", Buffer.from(JSON.stringify({ type: "audio", direction: "private", pcm16: pcm, holdId: "h" })));
    expect(ws.frames.at(-1)).toMatchObject({ type: "error", code: "hold" });
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_start", holdId: "h" })));
    expect(ws.frames.at(-1)).toEqual({ type: "hold_ready", holdId: "h" });
    ws.emit("message", Buffer.from(JSON.stringify({ type: "audio", direction: "private", pcm16: pcm, holdId: "wrong" })));
    expect(ws.frames.at(-1)).toMatchObject({ type: "error", code: "hold" });
    ws.emit("message", Buffer.from(JSON.stringify({ type: "audio", direction: "private", pcm16: pcm, holdId: "h" })));
    expect(privateSession.value.sendAudio).toHaveBeenCalled();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_end", holdId: "h" })));
    expect(privateSession.value.sendAudio).toHaveBeenLastCalledWith(expect.any(Buffer));
    expect((privateSession.value.sendAudio as any).mock.lastCall[0]).toHaveLength(24000 * 2 * 600 / 1000);
    expect(ws.frames.at(-1)).toEqual({ type: "hold_end_ack", holdId: "h" });
    ws.close();
  });

  it("keeps delayed private output attributed to its hold and never forwards provider content to logs", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-isolation", async () => true);
    const log = vi.spyOn(console, "log");
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 24_000 })));
    await tick();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_start", holdId: "delayed-hold" })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "audio", direction: "private", pcm16: Buffer.alloc(320).toString("base64"), holdId: "delayed-hold" })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_end", holdId: "delayed-hold" })));
    // response.created can arrive after hold_end; the ended-hold candidate
    // remains valid until a newer hold starts.
    privateSession.emit({ type: "response_created", ts: Date.now(), responseId: "r1" });
    privateSession.emit({ type: "translated_transcript_delta", text: "PRIVATE SECRET", responseId: "r1" });
    expect(ws.frames.at(-1)).toMatchObject({ type: "text_delta", direction: "private", holdId: "delayed-hold" });
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("PRIVATE SECRET"));
    log.mockRestore(); ws.close();
  });

  it("drops an uncertain old response once a distinct hold starts", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-old-response", async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 24_000 })));
    await tick();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_start", holdId: "first" })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_end", holdId: "first" })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_start", holdId: "second" })));
    privateSession.emit({ type: "response_created", ts: Date.now(), responseId: "late-old" });
    privateSession.emit({ type: "translated_transcript_delta", text: "old", responseId: "late-old" });
    expect(ws.frames.some((frame) => frame.text === "old")).toBe(false);
    ws.close();
  });

  it("allows only one authenticated socket per user and reports provider failure without crashing the call", async () => {
    const first = new FakeWs(); createCopilotStream(first as any, "copilot-concurrent", async () => true);
    const second = new FakeWs(); createCopilotStream(second as any, "copilot-concurrent", async () => true);
    expect(second.frames.at(-1)).toMatchObject({ type: "error", code: "concurrency" });
    first.close();
    const third = new FakeWs(); createCopilotStream(third as any, "copilot-failure", async () => true);
    startSession.mockReset().mockRejectedValue(new Error("offline"));
    third.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 16_000 })));
    await tick();
    expect(third.frames.at(-1)).toMatchObject({ type: "error", code: "provider_error" });
    third.close();
  });

  it("handles authorization errors and does not start providers after disconnect during authorization", async () => {
    const errored = new FakeWs();
    createCopilotStream(errored as any, "copilot-auth-error", async () => { throw new Error("db unavailable"); });
    errored.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 16_000 })));
    await tick();
    expect(errored.frames.at(-1)).toMatchObject({ type: "error", code: "call_unauthorized" });

    let resolveAuthorization!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { resolveAuthorization = resolve; });
    const disconnected = new FakeWs();
    createCopilotStream(disconnected as any, "copilot-auth-disconnect", () => pending);
    disconnected.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 16_000 })));
    disconnected.close();
    resolveAuthorization(true);
    await tick();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("cancels the peer session when only one provider startup succeeds", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-partial", async () => true);
    const peer = session();
    startSession.mockReset()
      .mockResolvedValueOnce(peer.value)
      .mockRejectedValueOnce(new Error("second unavailable"));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 16_000 })));
    await tick();
    expect(peer.value.cancel).toHaveBeenCalledOnce();
    expect(ws.frames.at(-1)).toMatchObject({ type: "error", code: "provider_error" });
    ws.close();
  });
});