import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureSecretaryAgentForTests, handleSecretaryTwilioStream,
  type SecretaryRealtimeEvent, type SecretaryRealtimeSession,
} from "../secretary/agent";
import { SecretaryLab, type LabDependencies } from "./service";

class Realtime implements SecretaryRealtimeSession {
  listeners: Array<(event: SecretaryRealtimeEvent) => void> = [];
  inputAudio: Buffer[] = [];
  closeCount = 0;
  cancelled = 0;
  onEvent(fn: (event: SecretaryRealtimeEvent) => void) { this.listeners.push(fn); }
  emit(event: SecretaryRealtimeEvent) { this.listeners.forEach(fn => fn(event)); }
  async connect() { this.emit({ type: "ready" }); }
  sendAudio(frame: Buffer) { this.inputAudio.push(frame); }
  startIntroduction() {}
  cancelResponse() { this.cancelled++; }
  close() { this.closeCount++; }
}
const input = { instruction: "Ask the representative for the case status.", voiceProvider: "elevenlabs", consent: true };
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
describe("Secretary Lab — real agent, fake transports and providers, never PSTN", () => {
  let realtime: Realtime, deps: LabDependencies, lab: SecretaryLab, now: number;
  let created: Awaited<ReturnType<SecretaryLab["create"]>>;
  const output: any[] = [];
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-no-network");
    now = 1_800_000_000_000; realtime = new Realtime(); output.length = 0;
    configureSecretaryAgentForTests({
      realtimeFactory: () => realtime,
      elevenLabsSynthesizer: async () => Buffer.alloc(960),
      cartesiaSynthesizer: async () => Buffer.alloc(960),
    });
    deps = {
      startEngine: handleSecretaryTwilioStream,
      context: async (ownerId, voiceProvider) => ({ ownerId, voiceProvider, cloneVoiceId: "private-fixture" }),
      translate: async () => ({ translation: "Тестовый перевод" }),
      now: () => now,
    };
    lab = new SecretaryLab(deps);
  });
  afterEach(async () => {
    if (created) await lab.stop("alice", created.id).catch(() => {});
    configureSecretaryAgentForTests(undefined); vi.unstubAllEnvs();
  });
  async function start() {
    created = await lab.create("alice", input);
    lab.connect(created.ticket!, event => output.push(event), () => {});
    await tick();
    return created.id;
  }
  it("requires explicit paid consent, exact provider, bounded instruction, no phone parameters", async () => {
    await expect(lab.create("alice", { ...input, consent: false })).rejects.toMatchObject({ status: 400 });
    await expect(lab.create("alice", { ...input, voiceProvider: "default" })).rejects.toMatchObject({ status: 400 });
    await expect(lab.create("alice", { ...input, phoneNumber: "+12025550123" })).rejects.toMatchObject({ status: 400 });
    await expect(lab.create("alice", { ...input, instruction: "x" })).rejects.toMatchObject({ status: 400 });
    expect(lab.reports("alice")).toEqual([]);
  });
  it("has one active session even with concurrent requests", async () => {
    const attempts = await Promise.allSettled([lab.create("alice", input), lab.create("alice", input)]);
    expect(attempts.filter(a => a.status === "fulfilled")).toHaveLength(1);
    created = (attempts.find(a => a.status === "fulfilled") as PromiseFulfilledResult<any>).value;
    expect(lab.reports("alice")).toHaveLength(1);
  });
  it("does not silently substitute a voice when readiness fails", async () => {
    const other = new SecretaryLab({ ...deps, context: async () => { throw new Error("unavailable"); } });
    await expect(other.create("alice", input)).rejects.toMatchObject({ status: 409 });
    expect(other.reports("alice")).toEqual([]);
  });
  it("keeps owner histories isolated and rejects foreign stop", async () => {
    await start();
    expect(lab.reports("bob")).toEqual([]);
    await expect(lab.stop("bob", created.id)).rejects.toMatchObject({ status: 404 });
    expect(realtime.closeCount).toBe(0);
  });
  it("uses one-use short-lived tickets; tickets and voices never enter reports", async () => {
    await start();
    expect(() => lab.connect(created.ticket!, () => {}, () => {})).toThrow("invalid or expired");
    const report = JSON.stringify(lab.reports("alice"));
    expect(report).not.toContain("private-fixture"); expect(report).not.toContain(created.ticket!);
  });
  it("rejects expired unused tickets without starting the engine", async () => {
    created = await lab.create("alice", input);
    now += 30_001;
    expect(() => lab.connect(created.ticket!, () => {}, () => {})).toThrow();
    expect(lab.reports("alice")[0].reason).toBe("connection_timeout");
    expect(realtime.inputAudio).toHaveLength(0);
  });
  it("waits for realtime readiness and forwards real G711 input into the same agent", async () => {
    const id = await start();
    expect(output.some(e => e.type === "ready")).toBe(true);
    lab.receive(id, { type: "media", payload: Buffer.alloc(160, 255).toString("base64") });
    expect(realtime.inputAudio[0]).toHaveLength(960);
    expect(lab.reports("alice")[0].status).toBe("running");
  });
  it("does not claim secretary speech was played until browser acknowledges it", async () => {
    const id = await start(); now += 100;
    realtime.emit({ type: "guest_transcript", text: "Please hold while I connect you." });
    await tick(); now += 600;
    realtime.emit({ type: "response_text", responseId: "test-response", text: "Understood. I will hold." });
    await tick();
    const before = lab.reports("alice")[0];
    expect(output.filter(e => e.type === "audio")).toHaveLength(1);
    expect(before.turns.filter(t => t.role === "secretary")).toHaveLength(0);
    const mark = output.find(e => e.type === "mark");
    expect(mark).toBeTruthy();
    lab.receive(id, { type: "mark", name: "forged" }); await tick();
    expect(lab.reports("alice")[0].metrics.secretaryTurns).toBe(0);
    lab.receive(id, { type: "mark", name: mark.name }); await tick();
    const after = lab.reports("alice")[0];
    expect(after.metrics.secretaryTurns).toBe(1);
    expect(after.metrics.lastTurnToAudioMs).toBe(600);
    expect(after.turns.every(t => t.translation === "Тестовый перевод")).toBe(true);
    expect(JSON.stringify(after)).not.toContain("payload");
  });
  it("isolates the OpenAI WebRTC mode from clone context, audio and owner crossover", async () => {
    let cb: any;
    const connection = { connect: vi.fn(async () => "v=0\r\nm=audio answer"), startIntroduction: vi.fn(), stop: vi.fn(async () => {}) };
    deps.context = vi.fn(deps.context);
    deps.startEngine = vi.fn(deps.startEngine);
    deps.openAI = { isAvailable: async () => true, create: (_owner, _instruction, callbacks) => { cb = callbacks; return connection; } };
    created = await lab.create("alice", { ...input, voiceProvider: "openai" });
    lab.connect(created.ticket!, e => output.push(e), () => {});
    expect(output.some(e => e.type === "rtc_offer_required")).toBe(true);
    expect(output.some(e => e.type === "ready")).toBe(false);
    expect(deps.context).not.toHaveBeenCalled(); expect(deps.startEngine).not.toHaveBeenCalled();
    await expect(lab.negotiate("bob", created.id, "v=0\r\nm=audio fake")).rejects.toMatchObject({ status: 404 });
    await lab.negotiate("alice", created.id, "v=0\r\nm=audio fake");
    await expect(lab.negotiate("alice", created.id, "v=0\r\nm=audio repeated")).rejects.toMatchObject({ status: 409 });
    expect(connection.connect).toHaveBeenCalledTimes(1);
    cb.ready("gpt-realtime-2.1", "marin");
    expect(output.find(e => e.type === "ready")).toMatchObject({ model: "gpt-realtime-2.1", voice: "marin" });
    cb.turn("guest", "Hello");
    cb.turn("secretary", "Hello, how can I help?", true);
    expect(lab.reports("alice")[0]).toMatchObject({ modelVerified: true, transport: "webrtc", voiceProvider: "openai", instruction: input.instruction });
    expect(lab.reports("alice")[0].turns[1].interrupted).toBe(true);
    expect(lab.reports("bob")).toEqual([]);
    await lab.stop("alice", created.id);
    expect(connection.stop).toHaveBeenCalled();
  });
  it("does not substitute a clone or another model if exact OpenAI availability fails", async () => {
    deps.context = vi.fn(deps.context);
    deps.openAI = { isAvailable: async () => false, create: vi.fn() };
    await expect(lab.create("alice", { ...input, voiceProvider: "openai" })).rejects.toMatchObject({ status: 409 });
    expect(deps.context).not.toHaveBeenCalled(); expect(deps.openAI.create).not.toHaveBeenCalled();
  });
  it("records a real browser audio failure, not a misleading user stop", async () => {
    deps.onEnd = vi.fn();
    const id = await start();
    lab.receive(id, { type: "client_error", reason: "arbitrary-provider-data" });
    expect(lab.reports("alice")[0].status).toBe("running");
    lab.receive(id, { type: "client_error", reason: "audio_suspended" });
    await tick(); await lab.stop("alice", id);
    expect(lab.reports("alice")[0].reason).toBe("audio_suspended");
    expect(deps.onEnd).toHaveBeenCalledTimes(1);
  });
  it("continues several replies when valid PCM ends with one or two extra samples", async () => {
    let synthesis = 0;
    configureSecretaryAgentForTests({
      realtimeFactory: () => realtime,
      elevenLabsSynthesizer: async () => Buffer.alloc([962, 964, 960][synthesis++]),
    });
    const id = await start();
    for (let turn = 0; turn < 3; turn++) {
      if (turn > 0) realtime.emit({ type: "guest_transcript", text: turn === 1 ? "Hello" : "Please continue." });
      realtime.emit({ type: "response_text", responseId: `r${turn}`, text: "Hello. How can I help?" });
      await tick();
      const marks = output.filter(e => e.type === "mark");
      expect(marks).toHaveLength(turn + 1);
      lab.receive(id, { type: "mark", name: marks.at(-1).name }); await tick();
      expect(lab.reports("alice")[0].status).toBe("running");
    }
    const report = lab.reports("alice")[0];
    expect(report.metrics.guestTurns).toBe(2);
    expect(report.metrics.secretaryTurns).toBe(3);
    expect(realtime.closeCount).toBe(0);
  });
  it("interruption clears playback and does not save an unheard response", async () => {
    await start();
    realtime.emit({ type: "response_text", responseId: "r", text: "I would like to ask a question." });
    await tick();
    realtime.emit({ type: "speech_started" }); await tick();
    expect(output.some(e => e.type === "clear")).toBe(true);
    expect(realtime.cancelled).toBe(1);
    expect(lab.reports("alice")[0].metrics.secretaryTurns).toBe(0);
  });
  it("subtitle failure is visible but does not stop the conversation", async () => {
    deps.translate = async () => { throw new Error("fixture"); };
    await start();
    realtime.emit({ type: "guest_transcript", text: "Please wait." }); await tick();
    const report = lab.reports("alice")[0];
    expect(report.status).toBe("running");
    expect(report.events.some(e => e.type === "subtitle_unavailable")).toBe(true);
    expect(realtime.closeCount).toBe(0);
  });
  it("does not end because of a hold phrase or long silence inside the limit", async () => {
    await start();
    realtime.emit({ type: "guest_transcript", text: "Please hold while I try to connect you." }); await tick();
    now += 180_000;
    expect(lab.reports("alice")[0].status).toBe("running");
    expect(realtime.closeCount).toBe(0);
    realtime.emit({ type: "guest_transcript", text: "This is the new representative." }); await tick();
    expect(lab.reports("alice")[0].turns).toHaveLength(2);
  });
  it("stops cleanly on disconnect and never reconnects/restarts a provider automatically", async () => {
    const engine = vi.spyOn(deps, "startEngine");
    const id = await start();
    lab.disconnected(id); await tick();
    const report = lab.reports("alice")[0];
    expect(report.status).toBe("ended"); expect(report.reason).toBe("browser_disconnected");
    expect(realtime.closeCount).toBe(1);
    lab.disconnected(id); lab.receive(id, { type: "media", payload: "/w==" });
    expect(engine).toHaveBeenCalledTimes(1);
  });
  it("distinguishes an OpenAI disconnect from owner stop without persisting secrets", async () => {
    await start();
    realtime.emit({ type: "closed" }); await tick();
    const report = lab.reports("alice")[0];
    expect(report.reason).toBe("openai_disconnected");
    expect(report.status).toBe("ended");
  });
  it("enforces input limits and ends the engine on invalid audio", async () => {
    const id = await start();
    lab.receive(id, { type: "media", payload: "invalid" }); await tick();
    expect(lab.reports("alice")[0].reason).toBe("invalid_audio");
    expect(realtime.closeCount).toBe(1);
  });
  it("expires temporary text reports and limits paid starts per owner", async () => {
    for (let i = 0; i < 6; i++) {
      created = await lab.create("alice", input);
      await lab.stop("alice", created.id);
    }
    await expect(lab.create("alice", input)).rejects.toMatchObject({ status: 429 });
    now += 3_600_001;
    expect(lab.reports("alice")).toEqual([]);
  });
});
