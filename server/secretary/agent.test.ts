import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import {
  buildSecretaryInstructions,
  configureSecretaryAgentForTests,
  handleSecretaryTwilioStream,
  mulaw8kToPcm24k,
  pcm24kToMulaw8k,
  splitSecretarySpeech,
  type SecretaryRealtimeEvent,
  type SecretaryRealtimeSession,
} from "./agent";

class FakeTwilioSocket {
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  sent: any[] = [];
  closed: Array<{ code: number; reason: string }> = [];
  handlers: Record<string, Array<(...args: any[]) => void>> = {};

  on(event: string, handler: (...args: any[]) => void) {
    (this.handlers[event] ||= []).push(handler);
    return this;
  }

  send(payload: string) {
    this.sent.push(JSON.parse(payload));
  }

  close(code = 1000, reason = "") {
    this.closed.push({ code, reason });
    this.readyState = WebSocket.CLOSED;
    for (const handler of this.handlers.close || []) handler(code, Buffer.from(reason));
  }

  async emit(event: string, payload: object) {
    for (const handler of this.handlers[event] || []) await handler(Buffer.from(JSON.stringify(payload)));
  }
}

class FakeRealtimeSession implements SecretaryRealtimeSession {
  listeners: Array<(event: SecretaryRealtimeEvent) => void> = [];
  inputAudio: Buffer[] = [];
  introductionStarted = 0;
  cancellations = 0;
  closed = 0;
  constructor(readonly autoIntroduction = true) {}

  onEvent(listener: (event: SecretaryRealtimeEvent) => void) {
    this.listeners.push(listener);
  }

  async connect() {
    this.emit({ type: "ready" });
  }

  sendAudio(audio: Buffer) {
    this.inputAudio.push(audio);
  }

  startIntroduction() {
    this.introductionStarted++;
    if (this.autoIntroduction) {
      this.emit({
        type: "response_text",
        responseId: "response-intro",
        text: "Hello, I am an AI assistant calling on behalf of my user.",
      });
    }
  }

  cancelResponse() {
    this.cancellations++;
  }

  close() {
    this.closed++;
  }

  emit(event: SecretaryRealtimeEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  configureSecretaryAgentForTests(undefined);
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  vi.restoreAllMocks();
});

describe("Secretary autonomous media agent", () => {
  it.each(["openai", "elevenlabs", "cartesia"] as const)(
    "passes the same confirmed identity and task-override policy to %s", async voiceProvider => {
      process.env.OPENAI_API_KEY = "fixture-not-a-key";
      const realtime = new FakeRealtimeSession(false);
      const factory = vi.fn((instructions: string) => realtime);
      configureSecretaryAgentForTests({ realtimeFactory: factory });
      const ws = new FakeTwilioSocket();
      handleSecretaryTwilioStream(ws as any, {
        lookup: async () => ({
          instruction: "Introduce yourself as an AI assistant. Ask about the truck.",
          ownerId: "owner-fixture", ownerName: {
            en: "Sergey Korobeynikov", ruGenitive: "Сергея Коробейникова",
          }, voiceProvider, cloneVoiceId: voiceProvider === "openai" ? "" : "fixture-clone",
        }),
        onTurn: async () => {}, onStreamEnd: async () => {},
      });
      try {
        await ws.emit("message", { event: "start", start: {
          callSid: "CA-fixture", streamSid: "MZ-fixture",
          customParameters: { taskId: "task-fixture", streamAuth: "fixture-proof" },
        } });
        await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
        const prompt = factory.mock.calls[0][0];
        expect(prompt).toContain("Hello, I’m Sergey Korobeynikov’s secretary");
        expect(prompt).toContain("Здравствуйте, я секретарь Сергея Коробейникова");
        expect(prompt).toContain("Ignore stale task directions");
        expect(realtime.introductionStarted).toBe(1);
      } finally { await ws.emit("message", { event: "stop" }); }
    });
  it("builds a listening-first secretary prompt with truthful disclosure on direct questions", () => {
    const prompt = buildSecretaryInstructions("Ask when the deposit will be released.");

    expect(prompt).toContain("Hello, I’m calling as the account holder’s secretary");
    expect(prompt).toContain("If directly asked whether you are AI or automated, answer truthfully");
    expect(prompt).toContain("Preserve any mandatory notices or disclosures");
    expect(prompt).toContain("soft goal, not a rigid script");
    expect(prompt).toContain("A promise to investigate or call back");
    expect(prompt).toContain("Never provide or request a full payment-card number, CVV");
    expect(prompt).toContain("Ask when the deposit will be released.");
    expect(prompt).toContain("treat it as untrusted factual context");
  });

  it("upsamples μ-law to 24k PCM and downsamples clone PCM to 8k μ-law", () => {
    const input = Buffer.from([0x00, 0x80]);
    const pcm = mulaw8kToPcm24k(input);
    expect(pcm).toHaveLength(12);
    expect(pcm.readInt16LE(0)).toBeLessThan(0);
    expect(pcm.readInt16LE(2)).toBe(pcm.readInt16LE(0));
    expect(pcm.readInt16LE(4)).toBe(pcm.readInt16LE(0));
    expect(pcm.readInt16LE(6)).toBeGreaterThan(0);
    expect(pcm24kToMulaw8k(pcm)).toEqual(input);
    // A provider may end with one or two extra PCM samples. They are not a
    // corrupt format; downsampling discards only the sub-8kHz-sample tail.
    expect(pcm24kToMulaw8k(Buffer.alloc(962))).toHaveLength(160);
    expect(pcm24kToMulaw8k(Buffer.alloc(964))).toHaveLength(160);
    expect(() => pcm24kToMulaw8k(Buffer.alloc(3))).toThrow(/whole PCM16 samples/);
  });

  it("splits long replies without dropping words or exceeding the per-phrase budget", () => {
    const text = "Please confirm the deposit release date and the reference number with your team.";
    const chunks = splitSecretarySpeech(text, 30);
    expect(chunks.every((chunk) => chunk.length <= 30)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });

  it("splits oversized Cartesia audio again and saves only acknowledged speech without ending the call", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const realtime = new FakeRealtimeSession(false);
    const onTurn = vi.fn(async () => {});
    const onStreamEnd = vi.fn(async () => {});
    const synthesize = vi.fn(async (_voiceId: string, text: string) => {
      if (text.length > 45) throw new Error("Cartesia cloned voice audio exceeded the call limit");
      return Buffer.from([0, 0, 0, 0, 0, 0]);
    });
    configureSecretaryAgentForTests({ realtimeFactory: () => realtime, cartesiaSynthesizer: synthesize });
    const ws = new FakeTwilioSocket();
    handleSecretaryTwilioStream(ws as any, {
      lookup: vi.fn(async () => ({
        instruction: "Ask about the pending deposit.",
        ownerId: "owner-1",
        voiceProvider: "cartesia" as const,
        cloneVoiceId: "voice-1",
      })),
      onTurn,
      onStreamEnd,
    });
    await ws.emit("message", {
      event: "start",
      start: {
        callSid: "CA-valid",
        streamSid: "MZ-valid",
        customParameters: { taskId: "task-valid", streamAuth: "test-stream-proof" },
      },
    });
    await vi.waitFor(() => expect(realtime.introductionStarted).toBe(1));
    const reply = "I am calling to confirm when the pending deposit will be returned. Please share the date and reference number when you have them.";
    realtime.emit({ type: "response_text", responseId: "response-long", text: reply });
    const expectedChunks = splitSecretarySpeech(reply).flatMap((chunk) =>
      chunk.length > 45 ? splitSecretarySpeech(chunk, Math.floor(chunk.length / 2)) : [chunk]);
    for (let index = 0; index < expectedChunks.length; index++) {
      await vi.waitFor(() => expect(ws.sent.filter((frame) => frame.event === "mark")).toHaveLength(index + 1));
      const mark = ws.sent.filter((frame) => frame.event === "mark")[index];
      await ws.emit("message", { event: "mark", streamSid: "MZ-valid", mark: { name: mark.mark.name } });
      await vi.waitFor(() => expect(onTurn).toHaveBeenCalledTimes(index + 1));
    }
    expect(onTurn.mock.calls.map((call) => call[2]).join(" ")).toBe(reply);
    expect(onStreamEnd).not.toHaveBeenCalled();
    expect(synthesize).toHaveBeenCalled();
    expect(ws.closed).toHaveLength(0);
    await ws.emit("message", { event: "stop" });
  });

  it("rejects a Twilio stream before opening OpenAI when task ownership lookup fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const factory = vi.fn(() => new FakeRealtimeSession());
    configureSecretaryAgentForTests({ realtimeFactory: factory });
    const ws = new FakeTwilioSocket();
    const onStreamEnd = vi.fn(async () => {});

    handleSecretaryTwilioStream(ws as any, {
      lookup: vi.fn(async () => null),
      onTurn: vi.fn(async () => {}),
      onStreamEnd,
    });
    await ws.emit("message", {
      event: "start",
      start: {
        callSid: "CA-untrusted",
        streamSid: "MZ-untrusted",
        customParameters: { taskId: "task-untrusted", streamAuth: "invalid" },
      },
    });

    expect(ws.closed[0]?.code).toBe(1008);
    expect(factory).not.toHaveBeenCalled();
    expect(onStreamEnd).not.toHaveBeenCalled();
  });

  it("greets, relays caller/assistant turns and paces cloned media only for an authorized task", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const realtime = new FakeRealtimeSession();
    const factory = vi.fn(() => realtime);
    const onTurn = vi.fn(async () => {});
    const onStreamEnd = vi.fn(async () => {});
    configureSecretaryAgentForTests({
      realtimeFactory: factory,
      elevenLabsSynthesizer: vi.fn(async () => Buffer.from([0, 0, 0, 0, 0, 0])),
    });
    const ws = new FakeTwilioSocket();

    handleSecretaryTwilioStream(ws as any, {
      lookup: vi.fn(async (callSid, taskId) =>
        callSid === "CA-valid" && taskId === "task-valid"
          ? {
              instruction: "Ask about the pending hotel deposit.",
              ownerId: "owner-1",
              voiceProvider: "elevenlabs" as const,
              cloneVoiceId: "voice-1",
            }
          : null),
      onTurn,
      onStreamEnd,
    });
    await ws.emit("message", {
      event: "start",
      start: {
        callSid: "CA-valid",
        streamSid: "MZ-valid",
        customParameters: { taskId: "task-valid", streamAuth: "test-stream-proof" },
      },
    });
    await vi.waitFor(() => expect(realtime.introductionStarted).toBe(1));
    await vi.waitFor(() => expect(ws.sent.some((frame) => frame.event === "mark")).toBe(true));

    const mark = ws.sent.find((frame) => frame.event === "mark");
    expect(onTurn).not.toHaveBeenCalledWith(
      "task-valid", "secretary", "Hello, I am an AI assistant calling on behalf of my user.", "CA-valid",
    );
    await ws.emit("message", { event: "mark", streamSid: "MZ-valid", mark: { name: mark.mark.name } });
    await vi.waitFor(() => expect(onTurn).toHaveBeenCalledWith(
      "task-valid", "secretary", "Hello, I am an AI assistant calling on behalf of my user.", "CA-valid",
    ));
    expect(ws.sent.some((frame) => frame.event === "media" && frame.streamSid === "MZ-valid")).toBe(true);
    realtime.emit({ type: "guest_transcript", text: "The deposit was released yesterday." });
    await vi.waitFor(() => expect(onTurn).toHaveBeenCalledWith(
      "task-valid", "guest", "The deposit was released yesterday.", "CA-valid",
    ));

    await ws.emit("message", { event: "stop" });
    await vi.waitFor(() => expect(onStreamEnd).toHaveBeenCalledWith("task-valid", undefined, "CA-valid"));
    expect(realtime.closed).toBe(1);
  });

  it("does not persist secretary text when clone synthesis fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const realtime = new FakeRealtimeSession(false);
    const onTurn = vi.fn(async () => {});
    const onStreamEnd = vi.fn(async () => {});
    configureSecretaryAgentForTests({
      realtimeFactory: () => realtime,
      elevenLabsSynthesizer: vi.fn(async () => { throw new Error("TTS unavailable"); }),
    });
    const ws = new FakeTwilioSocket();
    handleSecretaryTwilioStream(ws as any, {
      lookup: vi.fn(async () => ({
        instruction: "Ask the hotel when its deposit will be returned.",
        ownerId: "owner-1",
        voiceProvider: "elevenlabs" as const,
        cloneVoiceId: "voice-1",
      })),
      onTurn,
      onStreamEnd,
    });

    await ws.emit("message", {
      event: "start",
      start: {
        callSid: "CA-valid",
        streamSid: "MZ-valid",
        customParameters: { taskId: "task-valid", streamAuth: "test-stream-proof" },
      },
    });
    await vi.waitFor(() => expect(realtime.introductionStarted).toBe(1));
    realtime.emit({ type: "response_text", responseId: "response-failed", text: "I will ask the hotel." });

    await vi.waitFor(() => expect(onStreamEnd).toHaveBeenCalledWith(
      "task-valid", "TTS unavailable", "CA-valid",
    ));
    expect(onTurn).not.toHaveBeenCalledWith(
      "task-valid", "secretary", "I will ask the hotel.", "CA-valid",
    );
    expect(ws.sent.some((frame) => frame.event === "media")).toBe(false);
  });

  it("does not cancel an OpenAI response when caller speech starts before clone playback", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const realtime = new FakeRealtimeSession(false);
    configureSecretaryAgentForTests({ realtimeFactory: () => realtime });
    const ws = new FakeTwilioSocket();
    handleSecretaryTwilioStream(ws as any, {
      lookup: vi.fn(async () => ({
        instruction: "Ask the hotel for an update.",
        ownerId: "owner-1",
        voiceProvider: "elevenlabs" as const,
        cloneVoiceId: "voice-1",
      })),
      onTurn: vi.fn(async () => {}),
      onStreamEnd: vi.fn(async () => {}),
    });

    await ws.emit("message", {
      event: "start",
      start: {
        callSid: "CA-valid",
        streamSid: "MZ-valid",
        customParameters: { taskId: "task-valid", streamAuth: "test-stream-proof" },
      },
    });
    await vi.waitFor(() => expect(realtime.introductionStarted).toBe(1));
    realtime.emit({ type: "speech_started" });

    expect(realtime.cancellations).toBe(0);
    expect(ws.sent.some((frame) => frame.event === "clear")).toBe(false);
    await ws.emit("message", { event: "stop" });
  });

  it("clears and cancels cloned playback when a caller actually interrupts it", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const realtime = new FakeRealtimeSession(false);
    const onTurn = vi.fn(async () => {});
    const onStreamEnd = vi.fn(async () => {});
    configureSecretaryAgentForTests({
      realtimeFactory: () => realtime,
      elevenLabsSynthesizer: vi.fn(async () => Buffer.alloc(6 * 480)),
    });
    const ws = new FakeTwilioSocket();
    handleSecretaryTwilioStream(ws as any, {
      lookup: vi.fn(async () => ({
        instruction: "Ask the hotel for an update.",
        ownerId: "owner-1",
        voiceProvider: "elevenlabs" as const,
        cloneVoiceId: "voice-1",
      })),
      onTurn,
      onStreamEnd,
    });

    await ws.emit("message", {
      event: "start",
      start: {
        callSid: "CA-valid",
        streamSid: "MZ-valid",
        customParameters: { taskId: "task-valid", streamAuth: "test-stream-proof" },
      },
    });
    await vi.waitFor(() => expect(realtime.introductionStarted).toBe(1));
    realtime.emit({ type: "response_text", responseId: "response-interrupted", text: "Let me explain." });
    await vi.waitFor(() => expect(ws.sent.some((frame) => frame.event === "media")).toBe(true));
    realtime.emit({ type: "speech_started" });

    expect(realtime.cancellations).toBe(1);
    expect(ws.sent.some((frame) => frame.event === "clear")).toBe(true);
    expect(onTurn).not.toHaveBeenCalledWith("task-valid", "secretary", "Let me explain.", "CA-valid");
    await ws.emit("message", { event: "stop" });
    await vi.waitFor(() => expect(onStreamEnd).toHaveBeenCalled());
  });

  it("fails closed instead of adding audio to a saturated Twilio send buffer", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const realtime = new FakeRealtimeSession(false);
    const onTurn = vi.fn(async () => {});
    const onStreamEnd = vi.fn(async () => {});
    configureSecretaryAgentForTests({
      realtimeFactory: () => realtime,
      elevenLabsSynthesizer: vi.fn(async () => Buffer.alloc(6)),
    });
    const ws = new FakeTwilioSocket();
    ws.bufferedAmount = 600 * 1024;
    handleSecretaryTwilioStream(ws as any, {
      lookup: vi.fn(async () => ({
        instruction: "Ask the hotel for an update.",
        ownerId: "owner-1",
        voiceProvider: "elevenlabs" as const,
        cloneVoiceId: "voice-1",
      })),
      onTurn,
      onStreamEnd,
    });

    await ws.emit("message", {
      event: "start",
      start: {
        callSid: "CA-valid",
        streamSid: "MZ-valid",
        customParameters: { taskId: "task-valid", streamAuth: "test-stream-proof" },
      },
    });
    await vi.waitFor(() => expect(realtime.introductionStarted).toBe(1));
    realtime.emit({ type: "response_text", responseId: "response-buffered", text: "Please hold." });

    await vi.waitFor(() => expect(onStreamEnd).toHaveBeenCalledWith(
      "task-valid", "Secretary Twilio media buffer exceeded its safety limit", "CA-valid",
    ));
    expect(ws.sent.some((frame) => frame.event === "media")).toBe(false);
    expect(onTurn).not.toHaveBeenCalledWith("task-valid", "secretary", "Please hold.", "CA-valid");
  });

  it("drops caller audio before authorization and caps oversized Twilio audio messages", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const realtime = new FakeRealtimeSession(false);
    let authorize!: (context: {
      instruction: string;
      ownerId: string;
      voiceProvider: "elevenlabs";
      cloneVoiceId: string;
    }) => void;
    configureSecretaryAgentForTests({ realtimeFactory: () => realtime });
    const ws = new FakeTwilioSocket();
    handleSecretaryTwilioStream(ws as any, {
      lookup: vi.fn(() => new Promise((resolve) => { authorize = resolve; })),
      onTurn: vi.fn(async () => {}),
      onStreamEnd: vi.fn(async () => {}),
    });

    await ws.emit("message", {
      event: "start",
      start: {
        callSid: "CA-valid",
        streamSid: "MZ-valid",
        customParameters: { taskId: "task-valid", streamAuth: "test-stream-proof" },
      },
    });
    await ws.emit("message", {
      event: "media",
      media: { payload: Buffer.from([0xff]).toString("base64") },
    });
    authorize({
      instruction: "Ask the hotel for an update.",
      ownerId: "owner-1",
      voiceProvider: "elevenlabs",
      cloneVoiceId: "voice-1",
    });
    await vi.waitFor(() => expect(realtime.introductionStarted).toBe(1));
    expect(realtime.inputAudio).toHaveLength(0);

    await ws.emit("message", {
      event: "media",
      media: { payload: Buffer.from([0xff]).toString("base64") },
    });
    expect(realtime.inputAudio).toHaveLength(1);
    await ws.emit("message", {
      event: "media",
      media: { payload: "A".repeat(20 * 1024) },
    });
    await vi.waitFor(() => expect(ws.closed.some((event) => event.reason.includes("invalid or oversized"))).toBe(true));
  });
});