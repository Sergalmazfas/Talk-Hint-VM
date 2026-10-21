import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAISecretaryAudioSession } from "./nativeAudio";
import { SecretaryNativePlayback } from "./nativePlayback";
import type { SecretaryRealtimeEvent } from "./agent";
import { configureSecretaryAgentForTests, handleSecretaryTwilioStream } from "./agent";

class Socket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  sent: any[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  message(e: object) { this.emit("message", Buffer.from(JSON.stringify(e))); }
  close() { this.readyState = WebSocket.CLOSED; this.emit("close"); }
}
const ack = { type: "session.updated", session: {
  model: "gpt-realtime-2.1", audio: { input: { format: { type: "audio/pcmu" } },
    output: { format: { type: "audio/pcmu" }, voice: "marin" } },
} };
describe("Secretary default direct OpenAI telephone audio", () => {
  let socket: Socket, session: OpenAISecretaryAudioSession, events: SecretaryRealtimeEvent[];
  beforeEach(() => {
    socket = new Socket(); events = [];
    session = new OpenAISecretaryAudioSession("Authorized task: Saturday hours.", () => socket as unknown as WebSocket);
    session.onEvent(e => events.push(e));
  });
  afterEach(() => { session.close(); vi.useRealTimers(); });
  async function connect() {
    const promise = session.connect(); socket.emit("open"); socket.message(ack); await promise;
  }
  it("uses the exact model, built-in voice, high reasoning and native G711 in both directions", async () => {
    await connect();
    expect(socket.sent[0].session).toMatchObject({ model: "gpt-realtime-2.1",
      output_modalities: ["audio"], reasoning: { effort: "high" },
      audio: { input: { format: { type: "audio/pcmu" } }, output: { format: { type: "audio/pcmu" }, voice: "marin" } } });
    expect(socket.sent[0].session.instructions).toContain("Saturday");
    session.startIntroduction(); session.startIntroduction();
    expect(socket.sent.filter(e => e.type === "response.create")).toEqual([{ type: "response.create" }]);
    const input = Buffer.alloc(160, 0xff); session.sendAudio(input);
    expect(socket.sent.at(-1).audio).toBe(input.toString("base64"));
    socket.message({ type: "response.created", response: { id: "one" } });
    socket.message({ type: "response.output_audio.delta", response_id: "one", item_id: "item-one", delta: input.toString("base64") });
    expect(events.at(-1)).toMatchObject({ type: "audio", responseId: "one", mulaw: input });
    expect(events.some(e => e.type === "response_text")).toBe(false);
  });
  it("refuses a substituted model or telephone codec before introducing itself", async () => {
    const connected = session.connect(); socket.emit("open");
    socket.message({ ...ack, session: { ...ack.session, model: "gpt-realtime" } });
    await expect(connected).rejects.toThrow(/not verified/);
    expect(events.some(e => e.type === "ready")).toBe(false);
    expect(socket.sent.some(e => e.type === "response.create")).toBe(false);
  });
  it("settles a pending connection when its owner stops before readiness", async () => {
    const connected = session.connect();
    session.close();
    await expect(connected).rejects.toThrow(/before readiness/);
    expect(events.some(e => e.type === "ready")).toBe(false);
  });
  it("drops old audio after interruption but accepts the clarification and the new answer", async () => {
    await connect();
    socket.message({ type: "response.created", response: { id: "old" } });
    socket.message({ type: "input_audio_buffer.speech_started" });
    session.cancelResponse();
    socket.message({ type: "response.output_audio.delta", response_id: "old", delta: "////" });
    socket.message({ type: "conversation.item.input_audio_transcription.completed", transcript: "Only Saturday, please." });
    socket.message({ type: "response.created", response: { id: "new" } });
    socket.message({ type: "response.output_audio.delta", response_id: "new", delta: "////" });
    expect(events.filter(e => e.type === "audio")).toHaveLength(1);
    expect(events.find(e => e.type === "guest_transcript")).toMatchObject({ text: "Only Saturday, please." });
    expect(socket.sent.some(e => e.type === "response.cancel")).toBe(false);
    session.truncate("old-item", 42.9);
    expect(socket.sent.at(-1)).toMatchObject({ type: "conversation.item.truncate", audio_end_ms: 42 });
  });
  it("does not hang up for three minutes of hold after model readiness", async () => {
    vi.useFakeTimers(); await connect();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(events.some(e => e.type === "closed" || e.type === "error")).toBe(false);
    socket.message({ type: "conversation.item.input_audio_transcription.completed", transcript: "I'm back." });
    expect(events.at(-1)).toMatchObject({ type: "guest_transcript", text: "I'm back." });
  });
});

describe("Paced native audio playback without clone TTS", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  function fixture() {
    const ws = new Socket(), truncate = vi.fn(), playedText = vi.fn(), fail = vi.fn(), audio = vi.fn();
    let resolve!: () => void;
    const player = new SecretaryNativePlayback({ ws: ws as unknown as WebSocket, streamSid: () => "MSfixture",
      waitMark: (_name, signal) => new Promise<void>((done, reject) => {
        resolve = done; signal.addEventListener("abort", () => reject(new Error("interrupted")), { once: true });
      }), truncate, playedText, fail, audio });
    return { ws, player, truncate, playedText, fail, audio, ack: () => resolve() };
  }
  it("paces G711 at 20ms and saves text only after Twilio acknowledges playback", async () => {
    const f = fixture();
    f.player.audio("r", "item", Buffer.alloc(320, 0xff));
    f.player.transcript("r", "Saturday nine until noon."); f.player.done("r");
    expect(f.ws.sent.filter(e => e.event === "media")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(40);
    expect(f.ws.sent.filter(e => e.event === "media")).toHaveLength(2);
    expect(f.playedText).not.toHaveBeenCalled();
    f.ack(); await vi.advanceTimersByTimeAsync(0);
    expect(f.playedText).toHaveBeenCalledExactlyOnceWith("Saturday nine until noon.");
    f.player.close();
  });
  it("clears queued obsolete speech immediately, truncates context and resumes only the new response", async () => {
    const f = fixture();
    f.player.audio("old", "old-item", Buffer.alloc(1600, 0x55));
    f.player.interrupt();
    expect(f.ws.sent.at(-1).event).toBe("clear");
    expect(f.truncate).toHaveBeenCalledOnce();
    f.player.audio("new", "new-item", Buffer.alloc(160, 0xaa));
    f.player.transcript("new", "Only Saturday."); f.player.done("new");
    await vi.advanceTimersByTimeAsync(40);
    const media = f.ws.sent.filter(e => e.event === "media");
    expect(media).toHaveLength(2);
    expect(Buffer.from(media[1].media.payload, "base64")).toEqual(Buffer.alloc(160, 0xaa));
    f.ack(); await vi.advanceTimersByTimeAsync(0);
    expect(f.playedText).toHaveBeenCalledExactlyOnceWith("Only Saturday.");
    expect(f.fail).not.toHaveBeenCalled(); f.player.close();
  });
  it("pads a short tail, handles empty audio and closes without further output", async () => {
    const f = fixture();
    f.player.audio("empty", "empty", Buffer.alloc(0)); f.player.done("empty");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.ws.sent).toHaveLength(0);
    f.player.audio("short", "item", Buffer.from([1, 2])); f.player.done("short");
    expect(Buffer.from(f.ws.sent[0].media.payload, "base64")).toEqual(Buffer.concat([Buffer.from([1, 2]), Buffer.alloc(158, 0xff)]));
    f.player.close(); await vi.advanceTimersByTimeAsync(1000);
    expect(f.ws.sent.filter(e => e.event === "media")).toHaveLength(1);
  });
});

describe("Actual Secretary Twilio bridge → OpenAI native audio, no telephone network", () => {
  afterEach(() => { configureSecretaryAgentForTests(undefined); vi.unstubAllEnvs(); });
  it("authorizes a clone-free owner, relays unchanged G711, plays and persists an acknowledged answer", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-only");
    const protocol = new Socket(), twilio = new Socket(), onTurn = vi.fn(async () => {}), ended = vi.fn(async () => {});
    const clone = vi.fn(async () => { throw new Error("Clone synthesis must not run"); });
    configureSecretaryAgentForTests({
      realtimeFactory: instructions => new OpenAISecretaryAudioSession(instructions, () => protocol as unknown as WebSocket),
      elevenLabsSynthesizer: clone, cartesiaSynthesizer: clone,
    });
    handleSecretaryTwilioStream(twilio as unknown as WebSocket, {
      lookup: async () => ({ ownerId: "owner", instruction: "Ask for Saturday hours.", voiceProvider: "openai", cloneVoiceId: "" }),
      onTurn, onStreamEnd: ended,
    });
    twilio.message({ event: "start", start: { callSid: "CAfixture", streamSid: "MSfixture", customParameters: { taskId: "task", streamAuth: "fixture" } } });
    await vi.waitFor(() => expect(protocol.listenerCount("open")).toBe(1));
    protocol.emit("open"); protocol.message(ack);
    await vi.waitFor(() => expect(protocol.sent.some(e => e.type === "response.create")).toBe(true));
    const incoming = Buffer.from([0xff, 0x55, 0xaa]).toString("base64");
    twilio.message({ event: "media", media: { payload: incoming } });
    expect(protocol.sent.at(-1)).toMatchObject({ type: "input_audio_buffer.append", audio: incoming });
    protocol.message({ type: "response.created", response: { id: "reply" } });
    protocol.message({ type: "response.output_audio.delta", response_id: "reply", item_id: "item", delta: Buffer.alloc(160, 0xff).toString("base64") });
    protocol.message({ type: "response.output_audio_transcript.done", response_id: "reply", transcript: "Is the office open Saturday?" });
    protocol.message({ type: "response.output_audio.done", response_id: "reply" });
    await vi.waitFor(() => expect(twilio.sent.some(e => e.event === "mark")).toBe(true));
    const mark = twilio.sent.find(e => e.event === "mark");
    twilio.message({ event: "mark", mark: mark.mark });
    await vi.waitFor(() => expect(onTurn).toHaveBeenCalledWith("task", "secretary", "Is the office open Saturday?", "CAfixture"));
    expect(clone).not.toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();
    twilio.close(); await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce());
  });
});
