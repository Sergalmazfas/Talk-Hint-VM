import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import {
  handleTranslatorTwilioStream, mulawToPcm24, translatorAudioDestinations, registerTranslatorCall,
  configureTranslatorDialer, subscribeTranslatorFeed,
  expireTranslatorCall, getTranslatorBridgeSnapshot, handleTranslatorGuestStatus,
  getTranslatorCall, resolveTranslatorVoices,
  resolveTranslatorPlayback,
  configureTranslatorCloneSynthesizer, configureTranslatorCartesiaCloneSynthesizer,
} from "../translation/twilioBridge";
import type { RealtimeTranslationProvider } from "../translation/provider";

class FakeSocket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  closed?: number;
  send(value: string) { this.sent.push(value); }
  close(code?: number) { this.closed = code; this.readyState = 3; }
}
const start = (id: string, leg: string, callSid = leg === "owner" ? "CAowner" : "CAguest") => Buffer.from(JSON.stringify({
  event: "start", start: { streamSid: `${leg}-stream`, callSid, customParameters: { translatorCallId: id, translatorLeg: leg } },
}));
function fakeProvider(sessions: any[], configs: any[] = []): RealtimeTranslationProvider {
  return {
    name: "test",
    async startSession(config) {
      configs.push(config);
      let listener: any;
      const session = {
        audio: [] as Buffer[],
        sendAudio(chunk: Buffer) { this.audio.push(chunk); }, async stop() {}, cancel() {},
        onEvent(cb: any) { listener = cb; },
        emit(ev: any) { listener(ev); },
      };
      sessions.push(session);
      return session as any;
    },
  };
}

async function startClonePair(id: string, sessions: any[], configs: any[] = []) {
  registerTranslatorCall({
    id, ownerId: "clone-owner", ownerCallSid: "CAowner", guestNumber: "+15551234567",
    callerId: "+15557654321", baseUrl: "https://example.test", cloneVoiceId: "server-snapshotted-clone",
  });
  configureTranslatorDialer({ async createGuestLeg() { return { sid: "CAguest" }; } });
  const owner = new FakeSocket(), guest = new FakeSocket(), provider = fakeProvider(sessions, configs);
  handleTranslatorTwilioStream(owner as any, provider);
  handleTranslatorTwilioStream(guest as any, provider);
  owner.emit("message", start(id, "owner"));
  await new Promise(resolve => setImmediate(resolve));
  guest.emit("message", start(id, "guest"));
  await new Promise(resolve => setImmediate(resolve));
  return { owner, guest };
}

describe("PSTN translator bridge routing", () => {
  it("uses owner text-only output for cloning while leaving Guest voice mode unchanged", async () => {
    const sessions: any[] = [], configs: any[] = [];
    const { owner, guest } = await startClonePair("clone-text-only", sessions, configs);
    expect(configs.map(c => [c.sourceLangHint, c.outputMode])).toEqual([["ru", "text"], ["en", "audio"]]);
    expect(configs[0].voice).toBeUndefined();
    expect(configs[1].voice).toBe("cedar");

    sessions[1].emit({ type: "translated_audio", base64: Buffer.alloc(12).toString("base64") });
    expect(guest.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(0);
    expect(owner.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(1);
    expect(owner.closed).toBeUndefined();
    owner.emit("close");
  });

  it("fails closed on any unexpected OpenAI owner audio in cloned mode", async () => {
    const sessions: any[] = [];
    const { owner, guest } = await startClonePair("clone-no-openai-audio", sessions);
    sessions[0].emit({ type: "translated_audio", base64: Buffer.alloc(12).toString("base64") });
    expect(owner.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(0);
    expect(guest.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(0);
    expect(owner.closed).toBe(1011);
    expect(guest.closed).toBe(1011);
  });

  it.each([
    ["Russian", { responseStatus: "completed", translatedTranscript: "Привет" }],
    ["missing source item", { responseStatus: "completed", translatedTranscript: "Hello", sourceItemId: undefined }],
    ["missing response id", { responseStatus: "completed", translatedTranscript: "Hello", responseId: undefined }],
  ])("does not synthesize %s owner turns", async (_label, metricsOverride) => {
    const sessions: any[] = [];
    let synthCalls = 0;
    configureTranslatorCloneSynthesizer(async () => { synthCalls++; return Buffer.alloc(12); });
    const { owner, guest } = await startClonePair(`clone-reject-${String(_label)}`, sessions);
    sessions[0].emit({ type: "response_created", responseId: "response-1", sourceItemId: "item-1" });
    sessions[0].emit({ type: "translated_transcript_done", text: "Привет", responseId: "response-1" });
    sessions[0].emit({ type: "turn_completed", metrics: {
      turnIndex: 0, provider: "test", model: "test", responseStatus: "completed",
      translatedTranscript: "Hello", sourceItemId: "item-1", responseId: "response-1",
      ...metricsOverride,
    } });
    await new Promise(resolve => setImmediate(resolve));
    expect(synthCalls).toBe(0);
    expect(owner.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(0);
    expect(owner.closed).toBe(1011);
    expect(guest.closed).toBe(1011);
    configureTranslatorCloneSynthesizer(undefined);
  });

  it("ignores cancelled owner responses without speaking or ending the call", async () => {
    const sessions: any[] = [];
    let synthCalls = 0;
    configureTranslatorCloneSynthesizer(async () => { synthCalls++; return Buffer.alloc(12); });
    const { owner, guest } = await startClonePair("clone-cancelled", sessions);
    sessions[0].emit({ type: "translated_transcript_delta", text: "partial", responseId: "response-1" });
    sessions[0].emit({ type: "turn_completed", metrics: {
      turnIndex: 0, provider: "test", model: "test", responseStatus: "cancelled", cancelled: true,
      translatedTranscript: "partial", sourceItemId: "item-1", responseId: "response-1",
    } });
    await new Promise(resolve => setImmediate(resolve));
    expect(synthCalls).toBe(0);
    expect(owner.closed).toBeUndefined();
    expect(guest.closed).toBeUndefined();
    expect(owner.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(0);
    owner.emit("close");
    configureTranslatorCloneSynthesizer(undefined);
  });

  it("chunks cloned PCM into identical 20 ms μ-law fanout and marks after the final chunk", async () => {
    const sessions: any[] = [];
    configureTranslatorCloneSynthesizer(async (voice, text) => {
      expect(voice).toBe("server-snapshotted-clone");
      expect(text).toBe("Hello there.");
      return Buffer.alloc(1_920, 100);
    });
    const { owner, guest } = await startClonePair("clone-fanout-marks", sessions);
    sessions[0].emit({ type: "response_created", responseId: "response-1", sourceItemId: "item-1" });
    sessions[0].emit({ type: "translated_transcript_done", text: "Hello there.", responseId: "response-1" });
    sessions[0].emit({ type: "turn_completed", metrics: {
      turnIndex: 0, provider: "test", model: "test", responseStatus: "completed",
      sourceItemId: "item-1", responseId: "response-1",
    } });
    await new Promise(resolve => setTimeout(resolve, 55));

    const ownerEvents = owner.sent.map(JSON.parse), guestEvents = guest.sent.map(JSON.parse);
    const ownerMedia = ownerEvents.filter(m => m.event === "media");
    const guestMedia = guestEvents.filter(m => m.event === "media");
    expect(ownerMedia).toHaveLength(2);
    expect(guestMedia).toHaveLength(2);
    expect(ownerMedia.map(m => m.media.payload)).toEqual(guestMedia.map(m => m.media.payload));
    expect(ownerMedia.map(m => Buffer.from(m.media.payload, "base64").length)).toEqual([160, 160]);
    expect(ownerEvents.at(-1)).toMatchObject({ event: "mark", mark: { name: "translation-owner-1" } });
    owner.emit("close");
    configureTranslatorCloneSynthesizer(undefined);
  });

  it("aborts an in-flight clone synthesis when the bridge tears down", async () => {
    const sessions: any[] = [];
    let observedSignal: AbortSignal | undefined;
    configureTranslatorCloneSynthesizer((_voice, _text, signal) => {
      observedSignal = signal;
      return new Promise(() => {});
    });
    const { owner } = await startClonePair("clone-abort-teardown", sessions);
    sessions[0].emit({ type: "response_created", responseId: "response-1", sourceItemId: "item-1" });
    sessions[0].emit({ type: "translated_transcript_done", text: "Hello", responseId: "response-1" });
    sessions[0].emit({ type: "turn_completed", metrics: {
      turnIndex: 0, provider: "test", model: "test", responseStatus: "completed",
      translatedTranscript: "Hello", sourceItemId: "item-1", responseId: "response-1",
    } });
    await new Promise(resolve => setImmediate(resolve));
    expect(observedSignal?.aborted).toBe(false);
    owner.emit("close");
    expect(observedSignal?.aborted).toBe(true);
    configureTranslatorCloneSynthesizer(undefined);
  });

  it("tears down instead of falling back when clone synthesis fails", async () => {
    const sessions: any[] = [];
    configureTranslatorCloneSynthesizer(async () => { throw new Error("provider unavailable"); });
    const { owner, guest } = await startClonePair("clone-network-failure", sessions);
    sessions[0].emit({ type: "response_created", responseId: "response-1", sourceItemId: "item-1" });
    sessions[0].emit({ type: "translated_transcript_done", text: "Hello", responseId: "response-1" });
    sessions[0].emit({ type: "turn_completed", metrics: {
      turnIndex: 0, provider: "test", model: "test", responseStatus: "completed",
      translatedTranscript: "Hello", sourceItemId: "item-1", responseId: "response-1",
    } });
    await new Promise(resolve => setImmediate(resolve));
    expect(owner.closed).toBe(1011);
    expect(guest.closed).toBe(1011);
    expect(owner.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(0);
    configureTranslatorCloneSynthesizer(undefined);
  });

  it("requires response-keyed completed text and matching response source when responses interleave", async () => {
    const sessions: any[] = [];
    let synthCalls = 0;
    configureTranslatorCloneSynthesizer(async () => { synthCalls++; return Buffer.alloc(12); });
    const { owner, guest } = await startClonePair("clone-interleaved-source", sessions);
    sessions[0].emit({ type: "response_created", responseId: "r1", sourceItemId: "item-1" });
    sessions[0].emit({ type: "response_created", responseId: "r2", sourceItemId: "item-2" });
    sessions[0].emit({ type: "translated_transcript_done", text: "This belongs to two.", responseId: "r2" });
    // Metrics text is deliberately present but must never be used as fallback.
    sessions[0].emit({ type: "turn_completed", metrics: {
      turnIndex: 0, provider: "test", model: "test", responseStatus: "completed",
      translatedTranscript: "Wrong response fallback.", sourceItemId: "item-1", responseId: "r1",
    } });
    sessions[0].emit({ type: "translated_transcript_done", text: "Too late.", responseId: "r1" });
    await new Promise(resolve => setImmediate(resolve));
    expect(synthCalls).toBe(0);
    expect(owner.closed).toBe(1011);
    expect(guest.closed).toBe(1011);
    configureTranslatorCloneSynthesizer(undefined);
  });

  it("fails explicitly when completed owner text has no response ID", async () => {
    const sessions: any[] = [];
    const { owner, guest } = await startClonePair("clone-missing-done-id", sessions);
    sessions[0].emit({ type: "translated_transcript_done", text: "Hello" });
    expect(owner.closed).toBe(1011);
    expect(guest.closed).toBe(1011);
  });

  it("rejects response text when its terminal source item does not match response-created attribution", async () => {
    const sessions: any[] = [];
    let synthCalls = 0;
    configureTranslatorCloneSynthesizer(async () => { synthCalls++; return Buffer.alloc(12); });
    const { owner, guest } = await startClonePair("clone-mismatched-source", sessions);
    sessions[0].emit({ type: "response_created", responseId: "r1", sourceItemId: "source-one" });
    sessions[0].emit({ type: "translated_transcript_done", text: "Hello", responseId: "r1" });
    sessions[0].emit({ type: "turn_completed", metrics: {
      turnIndex: 0, provider: "test", model: "test", responseStatus: "completed",
      sourceItemId: "source-two", responseId: "r1", translatedTranscript: "Wrong fallback",
    } });
    await new Promise(resolve => setImmediate(resolve));
    expect(synthCalls).toBe(0);
    expect(owner.closed).toBe(1011);
    expect(guest.closed).toBe(1011);
    configureTranslatorCloneSynthesizer(undefined);
  });

  it("clears both Twilio output queues and terminates on cancellation during paced playback", async () => {
    const sessions: any[] = [];
    configureTranslatorCloneSynthesizer(async () => Buffer.alloc(1_920, 100));
    const { owner, guest } = await startClonePair("clone-cancel-playback", sessions);
    sessions[0].emit({ type: "response_created", responseId: "r1", sourceItemId: "i1" });
    sessions[0].emit({ type: "translated_transcript_done", text: "Hello", responseId: "r1" });
    sessions[0].emit({ type: "turn_completed", metrics: {
      turnIndex: 0, provider: "test", model: "test", responseStatus: "completed",
      sourceItemId: "i1", responseId: "r1",
    } });
    await new Promise(resolve => setImmediate(resolve));
    expect(owner.sent.map(JSON.parse).some(m => m.event === "media")).toBe(true);
    sessions[0].emit({ type: "response_cancelled", responseId: "r1", sourceItemId: "i1", ts: Date.now(), reason: "test" });
    const ownerEvents = owner.sent.map(JSON.parse), guestEvents = guest.sent.map(JSON.parse);
    expect(ownerEvents.some(m => m.event === "clear")).toBe(true);
    expect(guestEvents.some(m => m.event === "clear")).toBe(true);
    expect(owner.closed).toBe(1011);
    expect(guest.closed).toBe(1011);
    configureTranslatorCloneSynthesizer(undefined);
  });

  it("waits for buffer pressure to drain and for marks before starting the next clone turn", async () => {
    const sessions: any[] = [], synthesized: string[] = [];
    configureTranslatorCloneSynthesizer(async (_voice, text) => {
      synthesized.push(text);
      return Buffer.alloc(960, 100);
    });
    const { owner } = await startClonePair("clone-backpressure-mark-serialization", sessions);
    owner.bufferedAmount = 40 * 1024;
    for (const [responseId, sourceItemId, text] of [
      ["r1", "i1", "First."], ["r2", "i2", "Second."],
    ]) {
      sessions[0].emit({ type: "response_created", responseId, sourceItemId });
      sessions[0].emit({ type: "translated_transcript_done", text, responseId });
      sessions[0].emit({ type: "turn_completed", metrics: {
        turnIndex: responseId === "r1" ? 0 : 1, provider: "test", model: "test",
        responseStatus: "completed", sourceItemId, responseId,
      } });
    }
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(owner.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(0);
    owner.bufferedAmount = 0;
    await new Promise(resolve => setTimeout(resolve, 35));
    const firstMark = owner.sent.map(JSON.parse).find(m => m.event === "mark");
    expect(firstMark).toBeDefined();
    expect(synthesized).toEqual(["First."]);
    owner.emit("message", Buffer.from(JSON.stringify({ event: "mark", mark: firstMark.mark })));
    await new Promise(resolve => setImmediate(resolve));
    expect(synthesized).toEqual(["First.", "Second."]);
    owner.emit("close");
    configureTranslatorCloneSynthesizer(undefined);
  });

  it("maps the closed preference to fixed opposite voices and defaults invalid input to Female", () => {
    expect(resolveTranslatorVoices("male")).toEqual({
      preference: "male",
      voices: { owner: "cedar", guest: "marin" },
    });
    expect(resolveTranslatorVoices("female")).toEqual({
      preference: "female",
      voices: { owner: "marin", guest: "cedar" },
    });
    expect(resolveTranslatorVoices("cedar")).toEqual({
      preference: "female",
      voices: { owner: "marin", guest: "cedar" },
    });
    expect(resolveTranslatorVoices(undefined)).toEqual({
      preference: "female",
      voices: { owner: "marin", guest: "cedar" },
    });
  });

  it("accepts only the closed text playback value and defaults everything else to Voice", () => {
    expect(resolveTranslatorPlayback("text")).toBe("text");
    expect(resolveTranslatorPlayback("voice")).toBe("voice");
    expect(resolveTranslatorPlayback("audio")).toBe("voice");
    expect(resolveTranslatorPlayback(undefined)).toBe("voice");
  });

  it("uses text output only for Guest→RU and never changes Owner→EN audio", async () => {
    const id = "text-only-output", sessions: any[] = [], configs: any[] = [];
    registerTranslatorCall({
      id, ownerId: "owner", ownerCallSid: "CAowner", guestNumber: "+15551234567",
      callerId: "+15557654321", baseUrl: "https://example.test", playbackPreference: "text",
    });
    configureTranslatorDialer({ async createGuestLeg() { return { sid: "CAguest" }; } });
    const owner = new FakeSocket(), guest = new FakeSocket(), provider = fakeProvider(sessions, configs);
    handleTranslatorTwilioStream(owner as any, provider);
    handleTranslatorTwilioStream(guest as any, provider);
    owner.emit("message", start(id, "owner"));
    await new Promise(resolve => setImmediate(resolve));
    guest.emit("message", start(id, "guest"));
    await new Promise(resolve => setImmediate(resolve));

    expect(configs.map(c => [c.sourceLangHint, c.outputMode])).toEqual([
      ["ru", "audio"],
      ["en", "text"],
    ]);

    sessions[1].emit({ type: "translated_transcript_delta", text: "При", responseId: "guest-r1" });
    sessions[1].emit({ type: "translated_transcript_done", text: "Привет", responseId: "guest-r1" });
    sessions[1].emit({ type: "turn_completed", metrics: {
      turnIndex: 0, translatedTranscript: "Привет", provider: "test", model: "test", responseId: "guest-r1",
    } });
    expect(owner.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(0);
    expect(owner.sent.map(JSON.parse).filter(m => m.event === "mark" && m.mark.name.startsWith("translation-"))).toHaveLength(0);

    const english = Buffer.alloc(12, 100).toString("base64");
    sessions[0].emit({ type: "translated_audio", base64: english, responseId: "owner-r1" });
    expect(owner.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(1);
    expect(guest.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(1);
    expect(owner.sent.map(JSON.parse).filter(m => m.event === "media")[0].media.payload)
      .toBe(guest.sent.map(JSON.parse).filter(m => m.event === "media")[0].media.payload);
  });

  it("rejects unexpected Guest audio at the bridge boundary in Text only", async () => {
    const id = "text-only-reject-audio", sessions: any[] = [];
    registerTranslatorCall({
      id, ownerId: "owner", ownerCallSid: "CAowner", guestNumber: "+15551234567",
      callerId: "+15557654321", baseUrl: "https://example.test", playbackPreference: "text",
    });
    configureTranslatorDialer({ async createGuestLeg() { return { sid: "CAguest" }; } });
    const owner = new FakeSocket(), guest = new FakeSocket(), feed = new FakeSocket();
    subscribeTranslatorFeed("owner", feed as any);
    const provider = fakeProvider(sessions);
    handleTranslatorTwilioStream(owner as any, provider);
    handleTranslatorTwilioStream(guest as any, provider);
    owner.emit("message", start(id, "owner"));
    await new Promise(resolve => setImmediate(resolve));
    guest.emit("message", start(id, "guest"));
    await new Promise(resolve => setImmediate(resolve));

    sessions[1].emit({ type: "translated_audio", base64: Buffer.alloc(12).toString("base64") });
    expect(owner.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(0);
    expect(feed.sent.map(JSON.parse)).toContainEqual(expect.objectContaining({
      type: "error", fatal: true, message: "Text-only Translator received unexpected Guest audio",
    }));
    expect(owner.closed).toBe(1011);
    expect(guest.closed).toBe(1011);
  });

  it("replays a coherent completed turn when source transcription arrives after text output", async () => {
    const id = "late-source-text", sessions: any[] = [];
    registerTranslatorCall({
      id, ownerId: "late-owner", ownerCallSid: "CAowner", guestNumber: "+15551234567",
      callerId: "+15557654321", baseUrl: "https://example.test", playbackPreference: "text",
    });
    configureTranslatorDialer({ async createGuestLeg() { return { sid: "CAguest" }; } });
    const owner = new FakeSocket(), guest = new FakeSocket(), feed = new FakeSocket();
    subscribeTranslatorFeed("late-owner", feed as any);
    const provider = fakeProvider(sessions);
    handleTranslatorTwilioStream(owner as any, provider);
    handleTranslatorTwilioStream(guest as any, provider);
    owner.emit("message", start(id, "owner"));
    await new Promise(resolve => setImmediate(resolve));
    guest.emit("message", start(id, "guest"));
    await new Promise(resolve => setImmediate(resolve));

    sessions[1].emit({ type: "translated_transcript_done", text: "Привет", responseId: "r-late" });
    sessions[1].emit({ type: "turn_completed", metrics: {
      turnIndex: 0, translatedTranscript: "Привет", provider: "test", model: "test",
      sourceItemId: "item-late", responseId: "r-late",
    } });
    sessions[1].emit({ type: "source_transcript", text: "Hello", itemId: "item-late" });

    const messages = feed.sent.map(JSON.parse);
    const sourceIndex = messages.findIndex(m => m.type === "source_transcript" && m.itemId === "item-late");
    expect(messages[sourceIndex]).toEqual(expect.objectContaining({
      text: "Hello", translatedTranscript: "Привет",
    }));
    expect(messages[sourceIndex + 1]).toEqual(expect.objectContaining({
      type: "turn_completed", leg: "guest",
    }));
  });

  it("snapshots resolved voices when the call is registered", () => {
    const id = "immutable-voice";
    const voices = { owner: "cedar", guest: "marin" } as const;
    registerTranslatorCall({
      id, ownerId: "owner", ownerCallSid: "CAvoice", guestNumber: "+15551234567",
      callerId: "+15557654321", baseUrl: "https://example.test",
      voicePreference: "male", voices,
    });
    (voices as any).owner = "marin";
    expect(getTranslatorCall(id)?.voices).toEqual({ owner: "cedar", guest: "marin" });
    expireTranslatorCall(id);
  });

  it("snapshots Cartesia provider and voice and never falls back to ElevenLabs", async () => {
    const id = "cartesia-clone-provider", sessions: any[] = [];
    let cartesiaCalls = 0, elevenCalls = 0;
    registerTranslatorCall({
      id, ownerId: "owner-cartesia", ownerCallSid: "CAowner", guestNumber: "+15551234567",
      callerId: "+15557654321", baseUrl: "https://example.test", cloneProvider: "cartesia",
      cloneVoiceId: "cartesia-owner-voice",
    });
    expect(getTranslatorCall(id)).toMatchObject({ cloneProvider: "cartesia", cloneVoiceId: "cartesia-owner-voice" });
    configureTranslatorCloneSynthesizer(async () => { elevenCalls++; return Buffer.alloc(12); });
    configureTranslatorCartesiaCloneSynthesizer(async (voiceId, text, signal) => {
      cartesiaCalls++;
      expect(voiceId).toBe("cartesia-owner-voice");
      expect(text).toBe("Hello from Cartesia.");
      expect(signal).toBeInstanceOf(AbortSignal);
      return Buffer.alloc(12, 7);
    });
    configureTranslatorDialer({ async createGuestLeg() { return { sid: "CAguest" }; } });
    const owner = new FakeSocket(), guest = new FakeSocket(), provider = fakeProvider(sessions);
    handleTranslatorTwilioStream(owner as any, provider);
    handleTranslatorTwilioStream(guest as any, provider);
    owner.emit("message", start(id, "owner"));
    await new Promise(resolve => setImmediate(resolve));
    guest.emit("message", start(id, "guest"));
    await new Promise(resolve => setImmediate(resolve));
    sessions[0].emit({ type: "response_created", responseId: "r1", sourceItemId: "item-1" });
    sessions[0].emit({ type: "translated_transcript_done", text: "Hello from Cartesia.", responseId: "r1" });
    sessions[0].emit({ type: "turn_completed", metrics: {
      turnIndex: 0, provider: "test", model: "test", responseStatus: "completed",
      translatedTranscript: "Hello from Cartesia.", sourceItemId: "item-1", responseId: "r1",
    } });
    await new Promise(resolve => setImmediate(resolve));
    expect(cartesiaCalls).toBe(1);
    expect(elevenCalls).toBe(0);
    expect(owner.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(1);
    expect(guest.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(1);
    owner.emit("close");
    configureTranslatorCloneSynthesizer(undefined);
    configureTranslatorCartesiaCloneSynthesizer(undefined);
  });

  it("does not fall back to ElevenLabs if selected Cartesia synthesis fails", async () => {
    const sessions: any[] = [];
    let elevenCalls = 0;
    registerTranslatorCall({
      id: "cartesia-no-fallback", ownerId: "owner-cartesia", ownerCallSid: "CAowner",
      guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test",
      cloneProvider: "cartesia", cloneVoiceId: "cartesia-owner-voice",
    });
    configureTranslatorCloneSynthesizer(async () => { elevenCalls++; return Buffer.alloc(12); });
    configureTranslatorCartesiaCloneSynthesizer(async () => { throw new Error("Cartesia unavailable"); });
    configureTranslatorDialer({ async createGuestLeg() { return { sid: "CAguest" }; } });
    const owner = new FakeSocket(), guest = new FakeSocket(), provider = fakeProvider(sessions);
    handleTranslatorTwilioStream(owner as any, provider);
    handleTranslatorTwilioStream(guest as any, provider);
    owner.emit("message", start("cartesia-no-fallback", "owner"));
    await new Promise(resolve => setImmediate(resolve));
    guest.emit("message", start("cartesia-no-fallback", "guest"));
    await new Promise(resolve => setImmediate(resolve));
    sessions[0].emit({ type: "response_created", responseId: "r1", sourceItemId: "item-1" });
    sessions[0].emit({ type: "translated_transcript_done", text: "Hello.", responseId: "r1" });
    sessions[0].emit({ type: "turn_completed", metrics: {
      turnIndex: 0, provider: "test", model: "test", responseStatus: "completed",
      translatedTranscript: "Hello.", sourceItemId: "item-1", responseId: "r1",
    } });
    await new Promise(resolve => setImmediate(resolve));
    expect(elevenCalls).toBe(0);
    expect(owner.closed).toBe(1011);
    expect(guest.closed).toBe(1011);
    configureTranslatorCloneSynthesizer(undefined);
    configureTranslatorCartesiaCloneSynthesizer(undefined);
  });

  it("declares the complete asymmetric eight-route matrix", () => {
    expect(translatorAudioDestinations("guest", "original")).toEqual(["owner"]);
    expect(translatorAudioDestinations("guest", "translation")).toEqual(["owner"]);
    expect(translatorAudioDestinations("owner", "original")).toEqual([]);
    expect(translatorAudioDestinations("owner", "translation")).toEqual(["guest", "owner"]);
  });

  it("uses directed languages, relays Guest original first, and fans one Owner translation payload to both legs", async () => {
    const id = "asymmetric-matrix", sessions: any[] = [], configs: any[] = [];
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAowner", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({ async createGuestLeg() { return { sid: "CAguest" }; } });
    const owner = new FakeSocket(), guest = new FakeSocket(), provider = fakeProvider(sessions, configs);
    handleTranslatorTwilioStream(owner as any, provider);
    handleTranslatorTwilioStream(guest as any, provider);
    owner.emit("message", start(id, "owner"));
    await new Promise(resolve => setImmediate(resolve));
    guest.emit("message", start(id, "guest"));
    await new Promise(resolve => setImmediate(resolve));

    expect(configs.map(c => [c.sourceLangHint, c.outputLanguage])).toEqual([["ru", "en"], ["en", "ru"]]);
    expect(configs.map(c => c.outputMode)).toEqual(["audio", "audio"]);
    expect(configs.map(c => c.voice)).toEqual(["marin", "cedar"]);

    const original = Buffer.from([0xff, 0x7f]).toString("base64");
    guest.emit("message", Buffer.from(JSON.stringify({ event: "media", media: { payload: original } })));
    sessions[1].emit({ type: "speech_started", ts: 1 });
    guest.emit("message", Buffer.from(JSON.stringify({ event: "media", media: { payload: original } })));
    sessions[1].emit({ type: "speech_stopped", ts: 2 });
    const ownerBeforeTranslation = owner.sent.map(JSON.parse);
    expect(ownerBeforeTranslation.filter(m => m.event === "media").map(m => m.media.payload)).toEqual([original, original]);
    expect(guest.sent).toEqual([]);
    expect(sessions[1].audio).toHaveLength(2);

    const ownerPcm = Buffer.alloc(12, 100).toString("base64");
    const guestPcm = Buffer.alloc(12, 500).toString("base64");
    sessions[0].emit({ type: "translated_audio", base64: ownerPcm, responseId: "owner-r1" });
    const ownerTranslation = owner.sent.map(JSON.parse).filter(m => m.event === "media").at(-1).media.payload;
    const guestTranslation = guest.sent.map(JSON.parse).filter(m => m.event === "media").at(-1).media.payload;
    expect(ownerTranslation).toBe(guestTranslation);

    sessions[1].emit({ type: "translated_audio", base64: guestPcm, responseId: "guest-r1" });
    expect(guest.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(1);
    expect(owner.sent.map(JSON.parse).filter(m => m.event === "media")).toHaveLength(4);
    const ownerEvents = owner.sent.map(JSON.parse);
    const originalMarkIndex = ownerEvents.findIndex(m => m.event === "mark" && m.mark.name.startsWith("original-guest-"));
    const guestTranslationIndex = ownerEvents.findIndex(
      (m, index) => index > originalMarkIndex && m.event === "media" && m.media.payload !== original && m.media.payload !== ownerTranslation,
    );
    expect(originalMarkIndex).toBeGreaterThan(1);
    expect(guestTranslationIndex).toBeGreaterThan(originalMarkIndex);

    const guestMediaBeforeOwnerSpeech = guest.sent.length;
    owner.emit("message", Buffer.from(JSON.stringify({ event: "media", media: { payload: original } })));
    expect(guest.sent).toHaveLength(guestMediaBeforeOwnerSpeech);
  });

  it("keeps Owner playback output-only until Twilio acknowledges its mark", async () => {
    const id = "owner-playback-gate", sessions: any[] = [];
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAowner", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({ async createGuestLeg() { return { sid: "CAguest" }; } });
    const owner = new FakeSocket(), guest = new FakeSocket(), provider = fakeProvider(sessions);
    handleTranslatorTwilioStream(owner as any, provider);
    handleTranslatorTwilioStream(guest as any, provider);
    owner.emit("message", start(id, "owner"));
    await new Promise(resolve => setImmediate(resolve));
    guest.emit("message", start(id, "guest"));
    await new Promise(resolve => setImmediate(resolve));

    const pcm = Buffer.alloc(12, 100).toString("base64");
    sessions[0].emit({ type: "translated_audio", base64: pcm, responseId: "r1" });
    const source = Buffer.from([0xff]).toString("base64");
    owner.emit("message", Buffer.from(JSON.stringify({ event: "media", media: { payload: source } })));
    expect(sessions[0].audio).toHaveLength(0);

    sessions[0].emit({ type: "turn_completed", metrics: { turnIndex: 0, provider: "test", model: "test", responseId: "r1" } });
    const mark = owner.sent.map(JSON.parse).find(m => m.event === "mark");
    owner.emit("message", Buffer.from(JSON.stringify({ event: "mark", mark: { name: mark.mark.name } })));
    owner.emit("message", Buffer.from(JSON.stringify({ event: "media", media: { payload: source } })));
    expect(sessions[0].audio).toHaveLength(1);
    expect(sessions[1].audio).toHaveLength(0);
  });

  it("does not reopen Owner input until every overlapping playback stream is acknowledged", async () => {
    const id = "overlapping-playback-gate", sessions: any[] = [];
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAowner", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({ async createGuestLeg() { return { sid: "CAguest" }; } });
    const owner = new FakeSocket(), guest = new FakeSocket(), provider = fakeProvider(sessions);
    handleTranslatorTwilioStream(owner as any, provider);
    handleTranslatorTwilioStream(guest as any, provider);
    owner.emit("message", start(id, "owner"));
    await new Promise(resolve => setImmediate(resolve));
    guest.emit("message", start(id, "guest"));
    await new Promise(resolve => setImmediate(resolve));

    const source = Buffer.from([0xff]).toString("base64");
    sessions[0].emit({ type: "translated_audio", base64: Buffer.alloc(12, 100).toString("base64"), responseId: "owner-r1" });
    sessions[1].emit({ type: "translated_audio", base64: Buffer.alloc(12, 500).toString("base64"), responseId: "guest-r1" });
    sessions[0].emit({ type: "turn_completed", metrics: { turnIndex: 0, provider: "test", model: "test", responseId: "owner-r1" } });
    sessions[1].emit({ type: "turn_completed", metrics: { turnIndex: 0, provider: "test", model: "test", responseId: "guest-r1" } });
    const marks = owner.sent.map(JSON.parse).filter(m => m.event === "mark");
    expect(marks).toHaveLength(2);

    owner.emit("message", Buffer.from(JSON.stringify({ event: "mark", mark: { name: marks[0].mark.name } })));
    owner.emit("message", Buffer.from(JSON.stringify({ event: "media", media: { payload: source } })));
    expect(sessions[0].audio).toHaveLength(0);

    owner.emit("message", Buffer.from(JSON.stringify({ event: "mark", mark: { name: marks[1].mark.name } })));
    owner.emit("message", Buffer.from(JSON.stringify({ event: "media", media: { payload: source } })));
    expect(sessions[0].audio).toHaveLength(1);
  });

  it("converts Twilio 8k μ-law input into PCM16 24k for gpt-realtime", () => {
    const pcm = mulawToPcm24(Buffer.from([0xff, 0x7f]).toString("base64"));
    expect(pcm.length).toBe(12); // 2 μ-law samples × 3 upsample × PCM16
    expect(pcm.readInt16LE(0)).toBe(pcm.readInt16LE(2));
    expect(pcm.readInt16LE(2)).toBe(pcm.readInt16LE(4));
  });

  it("fails closed for an unpaired/forged leg without starting a provider", async () => {
    const ws = new FakeSocket();
    let starts = 0;
    const provider = { name: "test", startSession: async () => { starts++; throw new Error("must not run"); } } as RealtimeTranslationProvider;
    handleTranslatorTwilioStream(ws as any, provider);
    ws.emit("message", start("not-owned", "owner"));
    await new Promise(resolve => setImmediate(resolve));
    expect(starts).toBe(0);
    expect(ws.closed).toBe(1008);
  });

  it("closes rather than falling back when the approved provider cannot start", async () => {
    const id = "provider-failure";
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAowner", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    const ws = new FakeSocket();
    const provider = { name: "test", startSession: async () => { throw new Error("provider unavailable"); } } as RealtimeTranslationProvider;
    handleTranslatorTwilioStream(ws as any, provider);
    ws.emit("message", start(id, "owner"));
    await new Promise(resolve => setImmediate(resolve));
    expect(ws.closed).toBe(1011);
    expect(ws.sent).toEqual([]);
  });

  it("shares both legs' telemetry with only the owning translator feed and closes both on fatal failure", async () => {
    const id = "paired-telemetry";
    registerTranslatorCall({ id, ownerId: "owner-a", ownerCallSid: "CApaired", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({ async createGuestLeg() { return { sid: "CAguest" }; } });
    const feed = new FakeSocket(), stranger = new FakeSocket(), owner = new FakeSocket(), guest = new FakeSocket(), sessions: any[] = [];
    subscribeTranslatorFeed("owner-a", feed as any);
    subscribeTranslatorFeed("other-user", stranger as any);
    const provider = fakeProvider(sessions);
    handleTranslatorTwilioStream(owner as any, provider);
    handleTranslatorTwilioStream(guest as any, provider);
    owner.emit("message", start(id, "owner", "CApaired"));
    await new Promise(resolve => setImmediate(resolve));
    guest.emit("message", start(id, "guest", "CAguest"));
    await new Promise(resolve => setImmediate(resolve));
    sessions[0].emit({ type: "source_transcript", text: "Привет", itemId: "i1" });
    sessions[1].emit({ type: "turn_completed", metrics: { turnIndex: 1, provider: "test", model: "gpt-realtime" } });
    sessions[0].emit({ type: "error", message: "fatal upstream", fatal: true });
    expect(JSON.parse(feed.sent[0])).toMatchObject({ type: "source_transcript", leg: "owner", text: "Привет" });
    expect(JSON.parse(feed.sent.at(-1)!)).toMatchObject({ type: "error", fatal: true });
    expect(stranger.sent).toEqual([]);
    expect(owner.closed).toBe(1011);
    expect(guest.closed).toBe(1011);
  });

  it("rejects mismatched and duplicate owner CallSids without a second guest dial", async () => {
    const id = "sid-guards", sessions: any[] = [];
    let dials = 0;
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAexpected", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({ async createGuestLeg() { dials++; return { sid: "CAguest2" }; } });
    const provider = fakeProvider(sessions);
    const wrong = new FakeSocket(); handleTranslatorTwilioStream(wrong as any, provider);
    wrong.emit("message", start(id, "owner", "CAwrong"));
    const first = new FakeSocket(); handleTranslatorTwilioStream(first as any, provider);
    first.emit("message", start(id, "owner", "CAexpected"));
    await new Promise(resolve => setImmediate(resolve));
    const duplicate = new FakeSocket(); handleTranslatorTwilioStream(duplicate as any, provider);
    duplicate.emit("message", start(id, "owner", "CAexpected"));
    await new Promise(resolve => setImmediate(resolve));
    expect(wrong.closed).toBe(1008);
    expect(duplicate.closed).toBe(1008);
    expect(dials).toBe(1);
  });

  it("attaches a late source transcript to its completed shared turn before teardown", async () => {
    const id = "late-transcript", sessions: any[] = [];
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAlate", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({ async createGuestLeg() { return { sid: "CAguestlate" }; } });
    const ws = new FakeSocket(); handleTranslatorTwilioStream(ws as any, fakeProvider(sessions));
    ws.emit("message", start(id, "owner", "CAlate"));
    await new Promise(resolve => setImmediate(resolve));
    sessions[0].emit({ type: "turn_completed", metrics: { turnIndex: 0, provider: "test", model: "gpt-realtime", sourceItemId: "item-late" } });
    sessions[0].emit({ type: "source_transcript", itemId: "item-late", text: "Поздний текст" });
    expect(getTranslatorBridgeSnapshot(id)?.turns[0].sourceTranscript).toBe("Поздний текст");
    ws.emit("close");
    expect(getTranslatorBridgeSnapshot(id)).toBeUndefined();
  });

  it("ends both PSTN legs when either established media leg closes", async () => {
    const id = "peer-close", sessions: any[] = [], hangups: string[] = [];
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAownerclose", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({
      async createGuestLeg() { return { sid: "CAguestclose" }; },
      async hangup(sid) { hangups.push(sid); },
    });
    const owner = new FakeSocket(), guest = new FakeSocket(), provider = fakeProvider(sessions);
    handleTranslatorTwilioStream(owner as any, provider);
    handleTranslatorTwilioStream(guest as any, provider);
    owner.emit("message", start(id, "owner", "CAownerclose"));
    await new Promise(resolve => setImmediate(resolve));
    guest.emit("message", start(id, "guest", "CAguestclose"));
    await new Promise(resolve => setImmediate(resolve));

    owner.emit("close");
    await new Promise(resolve => setImmediate(resolve));

    expect(guest.closed).toBe(1000);
    expect(hangups.sort()).toEqual(["CAguestclose", "CAownerclose"]);
    expect(getTranslatorBridgeSnapshot(id)).toBeUndefined();
  });

  it("does not dial a guest if the owner socket closes during provider startup", async () => {
    const id = "close-during-start";
    let resolveStart!: (session: any) => void, dials = 0, cancels = 0;
    const provider: RealtimeTranslationProvider = {
      name: "deferred",
      startSession: () => new Promise(resolve => { resolveStart = resolve; }),
    };
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAearly", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({
      async createGuestLeg() { dials++; return { sid: "CAshould-not-exist" }; },
      async hangup() {},
    });
    const owner = new FakeSocket();
    handleTranslatorTwilioStream(owner as any, provider);
    owner.emit("message", start(id, "owner", "CAearly"));
    owner.readyState = 3;
    owner.emit("close");
    resolveStart({
      sendAudio() {}, async stop() {}, cancel() { cancels++; }, onEvent() {},
    });
    await new Promise(resolve => setImmediate(resolve));

    expect(cancels).toBe(1);
    expect(dials).toBe(0);
    expect(getTranslatorBridgeSnapshot(id)).toBeUndefined();
  });

  it.each(["busy", "no-answer", "failed", "canceled"])(
    "fails both legs when the guest status callback reports %s",
    async (status) => {
      const id = `guest-status-${status}`, sessions: any[] = [], hangups: string[] = [];
      registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: `CAowner-${status}`, guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
      configureTranslatorDialer({
        async createGuestLeg() { return { sid: `CAguest-${status}` }; },
        async hangup(sid) { hangups.push(sid); },
      });
      const owner = new FakeSocket();
      handleTranslatorTwilioStream(owner as any, fakeProvider(sessions));
      owner.emit("message", start(id, "owner", `CAowner-${status}`));
      await new Promise(resolve => setImmediate(resolve));

      expect(handleTranslatorGuestStatus(`CAguest-${status}`, status)).toBe(true);
      await new Promise(resolve => setImmediate(resolve));

      expect(owner.closed).toBe(1011);
      expect(hangups.sort()).toEqual([`CAguest-${status}`, `CAowner-${status}`].sort());
      expect(getTranslatorBridgeSnapshot(id)).toBeUndefined();
    },
  );

  it("actively tears down an owner leg when its translator pairing expires", async () => {
    const id = "expired-call", sessions: any[] = [], hangups: string[] = [];
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAowner-expired", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({
      async createGuestLeg() { return { sid: "CAguest-expired" }; },
      async hangup(sid) { hangups.push(sid); },
    });
    const owner = new FakeSocket();
    handleTranslatorTwilioStream(owner as any, fakeProvider(sessions));
    owner.emit("message", start(id, "owner", "CAowner-expired"));
    await new Promise(resolve => setImmediate(resolve));

    expect(expireTranslatorCall(id)).toBe(true);
    await new Promise(resolve => setImmediate(resolve));

    expect(owner.closed).toBe(1011);
    expect(hangups.sort()).toEqual(["CAguest-expired", "CAowner-expired"]);
    expect(getTranslatorBridgeSnapshot(id)).toBeUndefined();
  });
});