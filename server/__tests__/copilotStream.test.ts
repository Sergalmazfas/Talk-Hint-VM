import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RealtimeTranslationSession } from "../translation/provider";
import { OpenAIRealtimeTranslationSession } from "../translation/openaiRealtimeTranslator";
import { authorizeCopilotCall, copilotSpokenReplyInstructions, createCopilotStream, resamplePcm16Mono } from "../copilotStream";
import { consumeVerifiedCopilotReply } from "../copilotVerifiedReplies";
import { hasUnexpectedCopilotCaptionScript, preserveCopilotLongNumber } from "../copilotTextSafety";

const { startSession } = vi.hoisted(() => ({ startSession: vi.fn() }));
vi.mock("../translation/openaiRealtimeTranslator", async (importOriginal) => ({
  ...await importOriginal<typeof import("../translation/openaiRealtimeTranslator")>(),
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
  it("keeps fictional phone digits in the source grouping and rejects altered numbers", () => {
    expect(preserveCopilotLongNumber("Мой тестовый номер 555-010-2048.",
      "My test number is 555-01-02-048.")).toBe("My test number is 555-010-2048.");
    expect(preserveCopilotLongNumber("Мой тестовый номер 555-010-020-48.",
      "My test number is 555-01-02-048.")).toBeNull();
    expect(preserveCopilotLongNumber("Да, всё правильно.", "Yes, that's correct."))
      .toBe("Yes, that's correct.");
    expect(hasUnexpectedCopilotCaptionScript("ちょっとだけ。")).toBe(true);
    expect(hasUnexpectedCopilotCaptionScript("Я уже использую Mint Mobile.")).toBe(false);
  });
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
  let owner: ReturnType<typeof session>;
  beforeEach(() => {
    vi.clearAllMocks();
    guest = session(); privateSession = session(); owner = session();
    startSession.mockImplementation(async (config: any) =>
      config.languages[0] === "en" && config.outputLanguage === "en" ? owner.value :
      config.outputLanguage === "en" ? privateSession.value : guest.value);
  });

  it("resamples native 16k PCM to 24k without treating the declared rate as 24k", () => {
    const input = Buffer.alloc(16_000 * 2); // one second at 16k
    expect(resamplePcm16Mono(input, 16_000)).toHaveLength(24_000 * 2);
    expect(resamplePcm16Mono(Buffer.alloc(24_000 * 2), 24_000)).toHaveLength(24_000 * 2);
  });

  it("keeps brief Copilot speech while preserving the default voice-Translator noise gate", () => {
    const config = {
      languages: ["ru", "en"] as [string, string],
      outputLanguage: "en",
      outputMode: "text" as const,
      inputFormat: { encoding: "pcm16" as const, sampleRateHz: 24_000 },
      outputFormat: { encoding: "pcm16" as const, sampleRateHz: 24_000 },
    };
    function briefTurn(microturnMinAudioMs?: number) {
      const provider = new OpenAIRealtimeTranslationSession({ ...config, microturnMinAudioMs });
      const events: any[] = [];
      const sent: any[] = [];
      provider.onEvent(event => events.push(event));
      (provider as any).sendJson = (message: any) => sent.push(message);
      (provider as any).turnInBytes = 500 * 24_000 * 2 / 1000;
      const feed = (message: any) => (provider as any).handleMessage(message);
      feed({ type: "input_audio_buffer.committed", item_id: "brief" });
      feed({ type: "response.created", response: { id: "brief-response" } });
      return { events, sent, feed };
    }
    const normalTranslator = briefTurn();
    expect(normalTranslator.sent).toContainEqual({ type: "response.cancel" });
    expect(normalTranslator.events).toContainEqual(expect.objectContaining({
      type: "suppressed_microturn", reason: "audio_too_short",
    }));

    const copilot = briefTurn(0);
    expect(copilot.sent).not.toContainEqual({ type: "response.cancel" });
    copilot.feed({ type: "response.output_text.done", text: "Yes.", response_id: "brief-response" });
    expect(copilot.events).toContainEqual({
      type: "translated_transcript_done", text: "Yes.", responseId: "brief-response",
    });

    const silentCopilot = briefTurn(0);
    silentCopilot.feed({ type: "conversation.item.input_audio_transcription.completed",
      item_id: "brief", transcript: "" });
    expect(silentCopilot.sent).toContainEqual({ type: "response.cancel" });
    expect(silentCopilot.events).toContainEqual(expect.objectContaining({
      type: "suppressed_microturn", reason: "transcript_empty",
    }));
  });

  it("requires a valid start, rejects replay and malformed/rate-invalid audio", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-auth-format", async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "audio", direction: "guest", pcm16: "AAAA" })));
    expect(ws.frames.at(-1)).toMatchObject({ type: "error", code: "not_started" });
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 11025 })));
    expect(ws.frames.at(-1)).toMatchObject({ type: "error", code: "rate" });
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 16_000, conversationFeed: true })));
    await tick();
    guest.emit({ type: "ready", provider: "test", model: "test", instructions: "" });
    privateSession.emit({ type: "ready", provider: "test", model: "test", instructions: "" });
    expect(ws.frames).not.toContainEqual({ type: "ready" });
    owner.emit({ type: "ready", provider: "test", model: "test", instructions: "" });
    expect(startSession).toHaveBeenCalledTimes(3);
    expect(startSession.mock.calls.map(([config]) => config.microturnMinAudioMs)).toEqual([0, 0, 0]);
    expect(startSession.mock.calls[0][0].instructionsOverride).toBeUndefined();
    expect(startSession.mock.calls[1][0].instructionsOverride).toBe(copilotSpokenReplyInstructions("ru"));
    expect(startSession.mock.calls[2][0].instructionsOverride).toBeUndefined();
    expect(copilotSpokenReplyInstructions("ru")).toContain("first person");
    expect(ws.frames).toContainEqual({ type: "ready", capabilities: ["owner_transcript", "conversation_source"] });
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
    expect(ws.frames).toContainEqual({ type: "ready" });
    expect(startSession).toHaveBeenCalledTimes(2);
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
    privateSession.emit({ type: "input_committed", ts: Date.now(), itemId: "delayed-item" });
    privateSession.emit({ type: "response_created", ts: Date.now(), responseId: "r1", sourceItemId: "delayed-item" });
    privateSession.emit({ type: "translated_transcript_delta", text: "PRIVATE SECRET", responseId: "r1" });
    expect(ws.frames.some(f => f.type === "text_delta")).toBe(false);
    privateSession.emit({ type: "source_transcript", text: "my private words", itemId: "delayed-item" });
    expect(ws.frames.at(-1)).toMatchObject({ type: "text_delta", direction: "private", holdId: "delayed-hold" });
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("PRIVATE SECRET"));
    log.mockRestore(); ws.close();
  });

  it("shows public conversation source text but keeps private source scoped to its hold", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-conversation", async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 24_000, conversationFeed: true })));
    await tick();
    guest.emit({ type: "source_transcript", text: "Hello", itemId: "guest-1" });
    guest.emit({ type: "response_created", ts: Date.now(), responseId: "guest-response", sourceItemId: "guest-1" });
    guest.emit({ type: "translated_transcript_done", text: "Привет", responseId: "guest-response" });
    owner.emit({ type: "source_transcript", text: "Hello again", itemId: "owner-1" });
    owner.emit({ type: "source_transcript", text: "ちょっとだけ。", itemId: "owner-japanese" });
    owner.emit({ type: "translated_transcript_done", text: "ignored", responseId: "owner-response" });
    expect(ws.frames).toContainEqual({ type: "source_text", direction: "guest", text: "Hello", itemId: "guest-1" });
    expect(ws.frames).toContainEqual({ type: "text_done", direction: "guest", text: "Привет", responseId: "guest-response", itemId: "guest-1" });
    expect(ws.frames).toContainEqual({ type: "source_text", direction: "owner", text: "Hello again", itemId: "owner-1" });
    expect(ws.frames.some(frame => frame.itemId === "owner-japanese")).toBe(false);
    expect(ws.frames.some(frame => frame.text === "ignored")).toBe(false);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_start", holdId: "private-hold" })));
    expect(owner.value.sendAudio).toHaveBeenCalledOnce();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "audio", direction: "owner",
      pcm16: Buffer.alloc(320).toString("base64") })));
    // Queued public audio is discarded after private hold_start.
    expect(owner.value.sendAudio).toHaveBeenCalledOnce();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "audio", direction: "private",
      pcm16: Buffer.alloc(320).toString("base64"), holdId: "private-hold" })));
    privateSession.emit({ type: "source_transcript", text: "unattributed secret", itemId: "unknown" });
    expect(ws.frames.some(frame => frame.text === "unattributed secret")).toBe(false);
    privateSession.emit({ type: "input_committed", ts: Date.now(), itemId: "private-item" });
    privateSession.emit({ type: "source_transcript", text: "my private words", itemId: "private-item" });
    expect(ws.frames).toContainEqual({ type: "source_text", direction: "private", text: "my private words", holdId: "private-hold", itemId: "private-item" });
    ws.close();
  });

  it("corrects a completed private phone number before showing or verifying the tap-to-speak card", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-number", async () => true);
    const callSid = "CA1234567890abcdef1234567890abcdef";
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid, language: "ru", sampleRateHz: 24_000 })));
    await tick();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_start", holdId: "number-hold" })));
    ws.emit("message", Buffer.from(JSON.stringify({
      type: "audio", direction: "private", holdId: "number-hold", pcm16: Buffer.alloc(320).toString("base64"),
    })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_end", holdId: "number-hold" })));
    privateSession.emit({ type: "input_committed", ts: Date.now(), itemId: "number-item" });
    privateSession.emit({ type: "response_created", ts: Date.now(), responseId: "number-response", sourceItemId: "number-item" });
    privateSession.emit({ type: "translated_transcript_done", text: "My test number is 555-01-02-048.", responseId: "number-response" });
    privateSession.emit({ type: "turn_completed", metrics: { responseId: "number-response", sourceItemId: "number-item",
      responseStatus: "completed", translatedTranscript: "My test number is 555-01-02-048." } });
    privateSession.emit({ type: "source_transcript", text: "Мой тестовый номер 555-010-2048.", itemId: "number-item" });
    const safe = "My test number is 555-010-2048.";
    expect(ws.frames.at(-1)).toMatchObject({ type: "text_done", text: safe, holdId: "number-hold" });
    expect(consumeVerifiedCopilotReply("copilot-number", callSid, "number-hold", "number-response",
      "My test number is 555-01-02-048.")).toBe(false);
    expect(consumeVerifiedCopilotReply("copilot-number", callSid, "number-hold", "number-response", safe)).toBe(true);
    ws.close();
  });

  it("does not offer private speech when the number in the completed reply disagrees with source STT", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-number-mismatch", async () => true);
    const callSid = "CA1234567890abcdef1234567890abcdef";
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid, language: "ru", sampleRateHz: 24_000 })));
    await tick();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_start", holdId: "number-hold" })));
    ws.emit("message", Buffer.from(JSON.stringify({
      type: "audio", direction: "private", holdId: "number-hold", pcm16: Buffer.alloc(320).toString("base64"),
    })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_end", holdId: "number-hold" })));
    privateSession.emit({ type: "input_committed", ts: Date.now(), itemId: "number-item" });
    privateSession.emit({ type: "response_created", ts: Date.now(), responseId: "number-response", sourceItemId: "number-item" });
    privateSession.emit({ type: "translated_transcript_done", text: "My test number is 555-01-02-048.", responseId: "number-response" });
    privateSession.emit({ type: "turn_completed", metrics: { responseId: "number-response", sourceItemId: "number-item",
      responseStatus: "completed", translatedTranscript: "My test number is 555-01-02-048." } });
    privateSession.emit({ type: "source_transcript", text: "Мой тестовый номер 555-010-020-48.", itemId: "number-item" });
    expect(ws.frames.some(frame => frame.type === "text_done")).toBe(false);
    expect(consumeVerifiedCopilotReply("copilot-number-mismatch", callSid, "number-hold", "number-response",
      "My test number is 555-01-02-048.")).toBe(false);
    expect(ws.closed).toBe(false);
    ws.close();
  });

  it("holds guest deltas and final text until the matching source transcript arrives", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-source-order", async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 24_000 })));
    await tick();
    guest.emit({ type: "input_committed", ts: Date.now(), itemId: "item-a" });
    guest.emit({ type: "response_created", ts: Date.now(), responseId: "response-a", sourceItemId: "item-a" });
    guest.emit({ type: "translated_transcript_delta", text: "Wrong if shown alone", responseId: "response-a" });
    guest.emit({ type: "translated_transcript_done", text: "Correct translation", responseId: "response-a" });
    guest.emit({ type: "source_transcript", text: "Other turn", itemId: "item-b" });
    expect(ws.frames.some(f => f.type.startsWith("text_"))).toBe(false);
    guest.emit({ type: "source_transcript", text: "Actual source", itemId: "item-a" });
    expect(ws.frames.slice(-3)).toEqual([
      { type: "source_text", direction: "guest", text: "Actual source", itemId: "item-a" },
      { type: "text_delta", direction: "guest", text: "Wrong if shown alone", responseId: "response-a", itemId: "item-a" },
      { type: "text_done", direction: "guest", text: "Correct translation", responseId: "response-a", itemId: "item-a" },
    ]);
    ws.close();
  });

  it("withholds private translation until its own hold's source text, then preserves attribution", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-private-order", async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 24_000 })));
    await tick();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_start", holdId: "h1" })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "audio", direction: "private", holdId: "h1", pcm16: Buffer.alloc(320).toString("base64") })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_end", holdId: "h1" })));
    privateSession.emit({ type: "input_committed", ts: Date.now(), itemId: "private-1" });
    privateSession.emit({ type: "response_created", ts: Date.now(), responseId: "private-response", sourceItemId: "private-1" });
    privateSession.emit({ type: "translated_transcript_done", text: "No, not earlier.", responseId: "private-response" });
    expect(ws.frames.some(f => f.type === "text_done")).toBe(false);
    privateSession.emit({ type: "source_transcript", text: "Нет, не раньше.", itemId: "private-1" });
    expect(ws.frames.some(f => f.type === "text_done")).toBe(false);
    privateSession.emit({ type: "turn_completed", metrics: { responseId: "private-response", responseStatus: "completed" } });
    expect(ws.frames.slice(-2)).toEqual([
      { type: "source_text", direction: "private", text: "Нет, не раньше.", itemId: "private-1", holdId: "h1" },
      { type: "text_done", direction: "private", text: "No, not earlier.", responseId: "private-response", itemId: "private-1", holdId: "h1" },
    ]);
    ws.close();
  });

  it("registers final private English only after matching source and noncancelled completion", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-tts-verified", async () => true);
    const callSid = "CA1234567890abcdef1234567890abcdef";
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid, language: "ru", sampleRateHz: 24_000 })));
    await tick();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_start", holdId: "verified-hold" })));
    ws.emit("message", Buffer.from(JSON.stringify({
      type: "audio", direction: "private", holdId: "verified-hold", pcm16: Buffer.alloc(320).toString("base64"),
    })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_end", holdId: "verified-hold" })));
    privateSession.emit({ type: "input_committed", ts: Date.now(), itemId: "verified-item" });
    privateSession.emit({ type: "response_created", ts: Date.now(), responseId: "verified-response", sourceItemId: "verified-item" });
    privateSession.emit({ type: "translated_transcript_done", text: "I will be there soon.", responseId: "verified-response" });
    privateSession.emit({ type: "turn_completed", metrics: {
      responseId: "verified-response", sourceItemId: "verified-item", responseStatus: "completed",
      translatedTranscript: "I will be there soon.",
    } });
    expect(consumeVerifiedCopilotReply("copilot-tts-verified", callSid, "verified-hold", "verified-response", "I will be there soon.")).toBe(false);
    privateSession.emit({ type: "source_transcript", text: "Я скоро буду.", itemId: "verified-item" });
    expect(consumeVerifiedCopilotReply("copilot-tts-verified", callSid, "verified-hold", "verified-response", "I will be there soon.")).toBe(true);
    expect(consumeVerifiedCopilotReply("copilot-tts-verified", callSid, "verified-hold", "verified-response", "I will be there soon.")).toBe(false);
    ws.close();
  });

  it("never registers a cancelled private reply", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-tts-cancelled", async () => true);
    const callSid = "CAabcdefabcdefabcdefabcdefabcdefab";
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid, language: "ru", sampleRateHz: 24_000 })));
    await tick();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_start", holdId: "cancelled-hold" })));
    ws.emit("message", Buffer.from(JSON.stringify({
      type: "audio", direction: "private", holdId: "cancelled-hold", pcm16: Buffer.alloc(320).toString("base64"),
    })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_end", holdId: "cancelled-hold" })));
    privateSession.emit({ type: "input_committed", ts: Date.now(), itemId: "cancelled-item" });
    privateSession.emit({ type: "response_created", ts: Date.now(), responseId: "cancelled-response", sourceItemId: "cancelled-item" });
    privateSession.emit({ type: "translated_transcript_done", text: "Unsafe partial.", responseId: "cancelled-response" });
    privateSession.emit({ type: "response_cancelled", ts: Date.now(), responseId: "cancelled-response", reason: "turn_detected" });
    privateSession.emit({ type: "turn_completed", metrics: {
      responseId: "cancelled-response", sourceItemId: "cancelled-item", responseStatus: "cancelled", cancelled: true,
      translatedTranscript: "Unsafe partial.",
    } });
    privateSession.emit({ type: "source_transcript", text: "не отправлять", itemId: "cancelled-item" });
    expect(consumeVerifiedCopilotReply("copilot-tts-cancelled", callSid, "cancelled-hold", "cancelled-response", "Unsafe partial.")).toBe(false);
    ws.close();
  });

  it("does not publish a provider response without source and fails explicitly after a bounded wait", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-no-source", async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 24_000 })));
    await tick();
    vi.useFakeTimers();
    try {
      guest.emit({ type: "response_created", ts: Date.now(), responseId: "unattributed" });
      guest.emit({ type: "translated_transcript_done", text: "幻覚", responseId: "unattributed" });
      expect(ws.frames.some(f => f.type === "text_done")).toBe(false);
      await vi.advanceTimersByTimeAsync(8_100);
      expect(ws.frames).toContainEqual(expect.objectContaining({ type: "error", code: "source_unavailable" }));
      expect(ws.frames.some(f => f.type === "text_done")).toBe(false);
    } finally { ws.close(); vi.useRealTimers(); }
  });

  it("discards a cancelled noise turn and stops on a broken provider attribution", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-cancelled", async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 24_000 })));
    await tick();
    vi.useFakeTimers();
    try {
      guest.emit({ type: "response_created", ts: Date.now(), responseId: "noise", sourceItemId: "noise-item" });
      guest.emit({ type: "translated_transcript_delta", text: "invented", responseId: "noise" });
      guest.emit({ type: "response_cancelled", ts: Date.now(), responseId: "noise", reason: "turn_detected" });
      guest.emit({ type: "turn_completed", metrics: { cancelled: true, responseId: "noise" } });
      guest.emit({ type: "source_transcript", text: "Noise", itemId: "noise-item" });
      await vi.advanceTimersByTimeAsync(8_100);
      expect(ws.frames.some(f => f.type.startsWith("text_") || f.code === "source_unavailable")).toBe(false);
      guest.emit({ type: "invariant_violation", ts: Date.now(), code: "MULTIPLE_RESPONSES_FOR_TURN", detail: "unsafe" });
      expect(ws.frames.at(-1)).toMatchObject({ type: "error", code: "source_unavailable" });
      expect(ws.closed).toBe(true);
    } finally { ws.close(); vi.useRealTimers(); }
  });

  it("discards cancelled partial text before late STT even without turn_completed", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-cancel-first", async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 24_000 })));
    await tick();
    vi.useFakeTimers();
    try {
      guest.emit({ type: "input_committed", ts: Date.now(), itemId: "first" });
      guest.emit({ type: "response_created", ts: Date.now(), responseId: "cancelled", sourceItemId: "first" });
      guest.emit({ type: "translated_transcript_delta", text: "incomplete question", responseId: "cancelled" });
      guest.emit({ type: "response_cancelled", ts: Date.now(), responseId: "cancelled", reason: "turn_detected" });
      guest.emit({ type: "source_transcript", text: "Complete source question", itemId: "first" });
      guest.emit({ type: "translated_transcript_done", text: "stale translation", responseId: "cancelled" });
      await vi.advanceTimersByTimeAsync(8_100);
      expect(ws.frames.some(f => f.type.startsWith("text_") || f.code === "source_unavailable")).toBe(false);
      expect(ws.closed).toBe(false);
    } finally { ws.close(); vi.useRealTimers(); }
  });

  it("does not attach an uncommitted private response to a newer active hold", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-unknown-private", async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 24_000 })));
    await tick();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_start", holdId: "new-hold" })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "audio", direction: "private", holdId: "new-hold", pcm16: Buffer.alloc(320).toString("base64") })));
    privateSession.emit({ type: "response_created", ts: Date.now(), responseId: "old-response", sourceItemId: "old-uncommitted-item" });
    privateSession.emit({ type: "source_transcript", text: "Old secret", itemId: "old-uncommitted-item" });
    privateSession.emit({ type: "translated_transcript_done", text: "Old translation", responseId: "old-response" });
    expect(ws.frames.some(f => f.type.startsWith("text_") || f.text === "Old secret")).toBe(false);
    ws.close();
  });

  it("never authorizes auto-speak from a private text.done that is later cancelled", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-cancelled-private-done", async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 24_000 })));
    await tick();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_start", holdId: "h" })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "audio", direction: "private", holdId: "h", pcm16: Buffer.alloc(320).toString("base64") })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_end", holdId: "h" })));
    privateSession.emit({ type: "input_committed", itemId: "item" });
    privateSession.emit({ type: "response_created", responseId: "response", sourceItemId: "item" });
    privateSession.emit({ type: "source_transcript", text: "Скажи, что я буду скоро.", itemId: "item" });
    privateSession.emit({ type: "translated_transcript_done", text: "I'll be there soon.", responseId: "response" });
    expect(ws.frames.some(f => f.type === "text_done")).toBe(false);
    privateSession.emit({ type: "response_cancelled", responseId: "response" });
    privateSession.emit({ type: "turn_completed", metrics: { responseId: "response", cancelled: true } });
    expect(ws.frames.some(f => f.type === "text_done")).toBe(false);
    expect(ws.closed).toBe(false);
    ws.close();
  });

  it.each(["failed", "incomplete"])("never authorizes auto-speak from a %s provider response", async (responseStatus) => {
    const ws = new FakeWs(); createCopilotStream(ws as any, `copilot-private-${responseStatus}`, async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 24_000 })));
    await tick();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_start", holdId: "h" })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "audio", direction: "private", holdId: "h", pcm16: Buffer.alloc(320).toString("base64") })));
    ws.emit("message", Buffer.from(JSON.stringify({ type: "hold_end", holdId: "h" })));
    privateSession.emit({ type: "input_committed", itemId: "item" });
    privateSession.emit({ type: "response_created", responseId: "response", sourceItemId: "item" });
    privateSession.emit({ type: "source_transcript", text: "Скажи, что я буду скоро.", itemId: "item" });
    privateSession.emit({ type: "translated_transcript_done", text: "I'll be there soon.", responseId: "response" });
    privateSession.emit({ type: "turn_completed", metrics: { responseId: "response", responseStatus } });
    expect(ws.frames.some(f => f.type === "text_done")).toBe(false);
    ws.close();
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

  it("closes only the Copilot socket and cancels all translator sessions on a fatal provider error", async () => {
    const ws = new FakeWs(); createCopilotStream(ws as any, "copilot-fatal", async () => true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "start", callSid: "CA1234567890abcdef1234567890abcdef", language: "ru", sampleRateHz: 24_000, conversationFeed: true })));
    await tick();
    guest.emit({ type: "error", fatal: true, message: "model unavailable" });
    expect(ws.frames.at(-1)).toMatchObject({ type: "error", code: "provider_error" });
    expect(ws.closed).toBe(true);
    expect(guest.value.cancel).toHaveBeenCalledOnce();
    expect(privateSession.value.cancel).toHaveBeenCalledOnce();
    expect(owner.value.cancel).toHaveBeenCalledOnce();
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