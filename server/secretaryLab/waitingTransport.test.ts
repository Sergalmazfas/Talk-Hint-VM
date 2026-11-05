import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetellEngineRegistry } from "./retellEngine";
import { rehearsalBindings } from "./rehearsalBinding";
import { RetellSecretaryLab } from "./retell";
import type { EngineRequest, EngineStream } from "../secretary/conversationEngine";
import { devMannersStream } from "../rehearsal/manners";

class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent: any[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit("close"); }
  frame(frame: object) { this.emit("message", Buffer.from(JSON.stringify(frame)), false); }
}
const registries: RetellEngineRegistry[] = [];
function fixture(options: { phone?: boolean; waitingRules?: () => boolean } = {}, buffered = true, gate?: Promise<void>, manners = false) {
  const requests: EngineRequest[] = [];
  const stream: EngineStream = async function* (req) {
    requests.push(req);
    if (gate) await gate;
    yield { type: "text", text: "The test answer." };
    yield { type: "complete", output: [], tools: [] };
  };
  if (manners) rehearsalBindings.set("session", { waiting: true, buffered, manners: true,
    create: () => { throw Error("fixture registry supplies its engine"); } });
  const registry = new RetellEngineRegistry(manners ? devMannersStream(stream) : stream,
    { bufferResponses: () => buffered, waitingRules: () => true, ...options });
  registries.push(registry);
  const r = registry.reserve("test-owner", "Take a test message", "session");
  registry.registered("session", "call_1");
  const ws = new Socket();
  registry.attach(ws as any, `/${options.phone ? "retell-phone-engine" : "retell-engine-stream"}/${r.ticket}/call_1`);
  return { registry, ws, requests, report: r.engine as any };
}
it("rehearsal is listen-first over a WEB call; an empty opening cannot start voice/model", async () => {
  vi.useFakeTimers();
  vi.stubEnv("NODE_ENV", "development");
  const { ws, requests } = fixture({ waitingRules: () => false }, false);
  rehearsalBindings.set("session", { create: () => { throw Error("not used"); }, waiting: false, buffered: false });
  try {
    ws.frame({ interaction_type: "call_details", call: { call_id: "call_1", call_type: "web_call" } });
    ws.frame({ interaction_type: "response_required", response_id: 1, transcript: [] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests).toHaveLength(0); expect(ws.sent.filter(x => x.content)).toHaveLength(0);
    ws.frame({ interaction_type: "response_required", response_id: 2, transcript: [{ role: "user", content: "Hello, truck service." }] });
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(1); expect(ws.sent.some(x => x.content === "The test answer.")).toBe(true);
  } finally { rehearsalBindings.delete("session"); }
});
it("wire replay answers Кать at 1:26 and Здесь at 1:50 after separate waiting acknowledgements", async () => {
  vi.useFakeTimers();
  vi.stubEnv("NODE_ENV", "development");
  const { ws, requests, registry } = fixture({}, false);
  const transcript: any[] = [];
  const turn = async (id: number, content: string) => {
    transcript.push({ role: "user", content });
    ws.frame({ interaction_type: "response_required", response_id: id, transcript: [...transcript] });
    await vi.advanceTimersByTimeAsync(0);
  };
  await vi.advanceTimersByTimeAsync(77_720);
  await turn(1, "Секунду подожди, пожалуйста, я сейчас вернусь. Посмотрю на складе есть или нет, хорошо?");
  registry.waitingPlaybackEnded("session");
  await vi.advanceTimersByTimeAsync(8_970); await turn(2, "Кать, ты меня слышишь?");
  expect(requests).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(11_940); await turn(3, "Да, подожди минуту, я сейчас на складе посмотрю, хорошо?");
  registry.waitingPlaybackEnded("session");
  await vi.advanceTimersByTimeAsync(12_230); await turn(4, "Здесь?");
  expect(requests).toHaveLength(2);
  expect(ws.sent.filter(x => x.content === "Конечно, жду.")).toHaveLength(2);
});
const speech = (s: string) => ({ role: "user", content: s });
afterEach(() => { registries.splice(0).forEach(r => r.dispose()); rehearsalBindings.delete("session"); vi.unstubAllEnvs(); vi.useRealTimers(); });
it("New Dev rehearsal wire replays 1:26 and 1:50, ignores colleague speech and answers both addresses", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.stubEnv("NODE_ENV", "development");
  const { ws, requests, registry } = fixture({}, true, undefined, true);
  const transcript: any[] = [];
  const turn = async (id: number, at: number, text: string) => {
    await vi.advanceTimersByTimeAsync(at - Date.now());
    transcript.push({ role: "user", content: text });
    ws.frame({ interaction_type: "response_required", response_id: id, transcript: [...transcript] });
    await vi.advanceTimersByTimeAsync(0);
  };
  await turn(1, 77_720, "Секунду подожди, пожалуйста, я сейчас вернусь. Посмотрю на складе есть или нет, хорошо?");
  registry.waitingPlaybackEnded("session");
  await turn(2, 80_000, "John, check the new tires.");
  expect(requests).toHaveLength(0);
  await turn(3, 86_690, "Кать, ты меня слышишь?");
  expect(requests).toHaveLength(1);
  expect(ws.sent.filter(x => x.content === "The test answer.")).toHaveLength(1);
  await turn(4, 98_630, "Да, подожди минуту, я сейчас на складе посмотрю, хорошо?");
  registry.waitingPlaybackEnded("session");
  await turn(5, 110_860, "Здесь?");
  await vi.advanceTimersByTimeAsync(200);
  expect(requests).toHaveLength(2);
  expect(ws.sent.filter(x => x.content === "The test answer.")).toHaveLength(2);
  expect(ws.sent.filter(x => x.content === "Конечно, жду.")).toHaveLength(2);
  expect(ws.sent.some(x => /Got it|New,|New tires,/.test(x.content ?? ""))).toBe(false);
});
describe("waiting gate on actual Custom LLM wire", () => {
  it("one sec suppresses response/reminders/bridges; one check; explicit return reaches the model", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.useFakeTimers();
    const { ws, registry, requests, report } = fixture();
    const transcript = [speech("give me a minute")];
    ws.frame({ interaction_type: "response_required", response_id: 1, transcript });
    ws.frame({ interaction_type: "reminder_required", response_id: 2, transcript });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(requests).toHaveLength(0);
    expect(ws.sent.filter(f => f.content).map(f => f.content)).toEqual(["Sure, take your time."]);
    registry.waitingAudio("session", false, false);
    await vi.advanceTimersByTimeAsync(501);
    expect(ws.sent.filter(f => f.content === "Still there?")).toHaveLength(1);
    ws.frame({ interaction_type: "reminder_required", response_id: 3, transcript });
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests).toHaveLength(0);
    const returned = [...transcript, speech("I'm back, we have one")];
    ws.frame({ interaction_type: "update_only", turntaking: "user_turn", transcript: returned });
    expect(requests).toHaveLength(0);
    ws.frame({ interaction_type: "response_required", response_id: 4, transcript: returned });
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(1);
    expect(ws.sent.some(f => f.content === "The test answer.")).toBe(true);
    expect(report.waiting.audit.rows[0]).toMatchObject({ type: "brief", probes: 1, outcome: "returned" });
  });
  it("wait cue during generation cancels stale speech and its 600ms bridge, not the next answer", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.useFakeTimers();
    const { ws, registry, requests } = fixture();
    ws.frame({ interaction_type: "response_required", response_id: 1, transcript: [speech("let me check the warehouse")] });
    await vi.advanceTimersByTimeAsync(120_000);
    registry.waitingAudio("session", true, false);
    ws.frame({ interaction_type: "response_required", response_id: 2,
      transcript: [speech("let me check the warehouse"), speech("Tell the colleague to bring a box")] });
    expect(requests).toHaveLength(0);
    expect(ws.sent.filter(f => f.content).map(f => f.content)).toEqual(["Sure, take your time."]);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(ws.sent.filter(f => f.end_call)).toHaveLength(1);
    expect(ws.sent.at(-1).content).toBe("I'll let him know and call back later.");
    ws.frame({ interaction_type: "response_required", response_id: 3, transcript: [speech("Hello")] });
    expect(requests).toHaveLength(0);
  });
  it("can play a full five-minute wait after the original five-minute session boundary", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.useFakeTimers();
    const { ws } = fixture();
    await vi.advanceTimersByTimeAsync(120_000);
    ws.frame({ interaction_type: "response_required", response_id: 1, transcript: [speech("I'll be right back")] });
    await vi.advanceTimersByTimeAsync(299_999);
    expect(ws.sent.some(f => f.end_call)).toBe(false);
    await vi.advanceTimersByTimeAsync(251);
    expect(ws.sent.filter(f => f.end_call)).toHaveLength(1);
  });
  it.each(["production", "deployed", "phone", "other-variant"])("cannot install waiting rules in %s", scope => {
    vi.stubEnv("NODE_ENV", scope === "production" ? "production" : "development");
    if (scope === "deployed") vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    const { registry, report } = fixture({ phone: scope === "phone",
      ...(scope === "other-variant" ? { waitingRules: () => false } : {}) });
    expect(report.waiting).toBeUndefined();
    expect(() => registry.waitingAudio("session", false, false)).toThrow("WAITING_DEV_C_ONLY");
    expect(() => registry.waitingPlaybackEnded("session")).toThrow("WAITING_DEV_C_ONLY");
  });
  it("ended/disposed sessions cannot emit later timer actions", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.useFakeTimers();
    const { registry, ws } = fixture();
    ws.frame({ interaction_type: "response_required", response_id: 1, transcript: [speech("one sec")] });
    registry.ended("session");
    const count = ws.sent.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(ws.sent).toHaveLength(count);
  });
  it("aborts an in-flight answer and filler when the guest asks to wait; later return starts fresh", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { ws, requests } = fixture({}, true, gate);
    ws.frame({ interaction_type: "response_required", response_id: 1, transcript: [speech("Hello, can you hear me?")] });
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(1);
    const transcript = [speech("Hello, can you hear me?"), speech("let me check")];
    ws.frame({ interaction_type: "update_only", turntaking: "user_turn", transcript });
    expect(requests[0].signal.aborted).toBe(true);
    release();
    await vi.advanceTimersByTimeAsync(2000);
    expect(ws.sent.some(f => f.content)).toBe(false);
    ws.frame({ interaction_type: "response_required", response_id: 2, transcript: [...transcript, speech("I'm back, the price is $150")] });
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(2);
    expect(ws.sent.filter(f => f.content === "The test answer.")).toHaveLength(1);
  });
  it("activity API resolves session ownership before forwarding input; unsupported stands reject", () => {
    const lab = new RetellSecretaryLab({} as any, Date.now, () => true);
    expect(() => lab.waitingAudio("another-owner", "not-owned", { active: false, agentSpeaking: false })).toThrow("Сессия не найдена");
  });
  it("activity input is strictly typed, owner scoped, and cannot revive an ended session", () => {
    const audio = vi.fn(), playback = vi.fn();
    const lab = new RetellSecretaryLab({} as any, Date.now, () => true, {
      agentName: "fixture", mode: "retell-engine", check: async () => ({}), reserve: vi.fn(),
      registered: vi.fn(), ended: vi.fn(), waitingAudio: audio, waitingPlaybackEnded: playback,
    });
    const report = { id: "owned", status: "live", createdAt: new Date().toISOString() };
    (lab as any).sessions.set("owned", { owner: "owner", report });
    expect(() => lab.waitingAudio("other", "owned", { active: false, agentSpeaking: false })).toThrow();
    expect(() => lab.waitingAudio("owner", "owned", { active: "false", agentSpeaking: false })).toThrow("Invalid waiting audio");
    expect(() => lab.waitingAudio("owner", "owned", { active: false, agentSpeaking: false, override: true })).toThrow();
    expect(lab.waitingAudio("owner", "owned", { active: true, agentSpeaking: false })).toEqual({ ok: true });
    expect(audio).toHaveBeenCalledWith("owned", true, false);
    lab.waitingAudio("owner", "owned", { event: "playback_ended" });
    expect(playback).toHaveBeenCalledWith("owned");
    report.status = "ended";
    expect(() => lab.waitingAudio("owner", "owned", { event: "playback_ended" })).toThrow("WAITING_DEV_C_ONLY");
  });
});
