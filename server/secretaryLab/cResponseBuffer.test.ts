import { afterEach, describe, expect, it, vi } from "vitest";
import { CResponseBuffer, classifyCInterruption } from "./cResponseBuffer";
import type { SpokenTurn } from "../secretary/conversationEngine";
const user = (content: string): SpokenTurn => ({ role: "user", content });
const agent = (content: string): SpokenTurn => ({ role: "agent", content });
const buffers: CResponseBuffer[] = [];
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const frames: any[] = [], calls: Array<{ turns: SpokenTurn[]; signal: AbortSignal; emit: (text: string) => void; done: () => void; fail: (e: Error) => void }> = [];
  const b = new CResponseBuffer({
    generate: (turns, signal, emit) => new Promise<void>((done, fail) => { calls.push({ turns, signal, emit, done, fail }); }),
    send: f => frames.push(f), record: vi.fn(),
    error: () => ({ message: "Test stopped", end: true }),
  });
  buffers.push(b); return { b, frames, calls };
}
afterEach(() => { buffers.splice(0).forEach(b => b.close()); vi.unstubAllEnvs(); });
describe("C interruption rules fail conservative", () => {
  it.each(["угу", "да", "ага", "ok", "yeah", "mhm", "yes"])("a: %s", text => {
    expect(classifyCInterruption("Tell me", "Tell me " + text).kind).toBe("a");
  });
  it.each(["нет", "не завтра", "да, но позже", "no", "yeah but Monday", "150", "two", "tomorrow", "когда?", "how?", "actually another place", "новые провода"])("c: %s", text => {
    expect(classifyCInterruption("Tell me", "Tell me " + text).kind).toBe("c");
  });
  it("b only for unchanged context / known meaning-free suffix, not an arbitrary completed sentence", () => {
    expect(classifyCInterruption("Tell me", "Tell me.").kind).toBe("b");
    expect(classifyCInterruption("Tell me", "Tell me please").kind).toBe("b");
    expect(classifyCInterruption("Tell me", "Tell me about Tuesday").kind).toBe("c");
    expect(classifyCInterruption("Tell me", "Tell me?").kind).toBe("c");
  });
});
it("keeps generating silently through update_only and resumes at the played prefix with no new model request", async () => {
  const { b, calls, frames } = fixture();
  b.request(1, [user("Tell me")]);
  calls[0].emit("First. ");
  b.update([user("Tell me"), agent("First."), user("mhm")], true);
  const count = frames.length;
  calls[0].emit("Second.");
  expect(frames).toHaveLength(count);
  expect(calls[0].signal.aborted).toBe(false);
  b.request(2, [user("Tell me"), agent("First."), user("mhm")]);
  calls[0].done(); await tick();
  expect(calls).toHaveLength(1);
  expect(frames.filter(f => f.response_id === 2).map(f => f.content).join("")).toBe(" Second.");
  expect(frames.at(-1).content_complete).toBe(true);
  expect(b.metrics).toMatchObject({ a: 1, reused: 1, generations: 1, restarts: 0 });
});
it("an acknowledgement before first token retargets the same in-flight generation; duplicate ids do not replay", async () => {
  const { b, calls, frames } = fixture();
  b.request(1, [user("Tell me")]); b.update([user("Tell me"), user("yeah")], true);
  b.request(2, [user("Tell me"), user("yeah")]); calls[0].emit("Ready."); calls[0].done(); await tick();
  const n = frames.length;
  b.request(2, [user("Tell me"), user("yeah")]);
  expect(frames).toHaveLength(n); expect(calls).toHaveLength(1);
  expect(frames.at(-2)).toMatchObject({ response_id: 2, content: "Ready." });
});
it("b reuses a completed answer and stores the latest full transcript for the next actual generation", async () => {
  const { b, calls, frames } = fixture();
  b.request(1, [user("Tell me")]); calls[0].emit("Details."); calls[0].done(); await tick();
  b.request(2, [user("Tell me please")]);
  expect(calls).toHaveLength(1); expect(b.metrics.b).toBe(1);
  b.request(3, [user("Tell me please"), agent("Details."), user("Not Tuesday, Friday")]);
  expect(calls[1].turns.at(-1)?.content).toBe("Not Tuesday, Friday");
  expect(frames.some(f => f.response_id === 3 && f.content.includes("Details"))).toBe(false);
});
it("new facts stop stale output, bridge immediately, rotate RU phrases, and never replay the old claim", async () => {
  const { b, calls, frames } = fixture();
  b.request(1, [user("Расскажи")]); calls[0].emit("Цена сто.");
  b.update([user("Расскажи"), agent("Цена сто."), user("Нет, 150")], true);
  calls[0].emit(" Завтра.");
  b.request(2, [user("Расскажи"), agent("Цена сто."), user("Нет, 150")]);
  expect(calls[0].signal.aborted).toBe(true);
  expect(frames.at(-1).content).toBe("Поняла. ");
  calls[0].emit("OLD"); calls[0].done(); await tick();
  expect(frames.at(-1).content).toBe("Поняла. ");
  calls[1].emit("Цена 150."); calls[1].done(); await tick();
  b.request(3, [user("Расскажи"), agent("Цена сто."), user("Нет, 150"), agent("Цена 150."), user("Нет, завтра в 10")]);
  expect(frames.at(-1).content).toBe("Так. ");
  expect(b.metrics).toMatchObject({ c: 2, restarts: 2, bridges: 2 });
});
it("unverified played text is never assumed to match the generated claim", () => {
  const { b, calls } = fixture();
  b.request(1, [user("Tell me")]); calls[0].emit("Price 150.");
  b.request(2, [user("Tell me"), agent("Price 100."), user("yeah")]);
  expect(b.metrics).toMatchObject({ ambiguousPlayback: 1, c: 1, reused: 0 });
  expect(calls[0].signal.aborted).toBe(true);
});
it("errors while caller speaks are deferred until response_required, close once and cannot retry unknown work", async () => {
  const { b, calls, frames } = fixture();
  b.request(1, [user("Tell me")]); b.update([user("Tell me"), user("yeah")], true);
  calls[0].fail(Error("unknown")); await tick();
  expect(frames).toHaveLength(0);
  b.request(2, [user("Tell me"), user("yeah")]);
  expect(frames.at(-1)).toMatchObject({ content: "Test stopped", end_call: true });
  b.request(3, [user("Tell me"), user("yeah")]);
  expect(calls).toHaveLength(1);
});
it("greeting is not reused as an answer; disconnect aborts pending generation", () => {
  const { b, calls } = fixture();
  b.request(0, [user("Begin authorized test")]); calls[0].emit("Hello.");
  b.request(1, [agent("Hello."), user("Tell me")]);
  expect(calls).toHaveLength(2); expect(b.metrics.reused).toBe(0);
  b.close(); expect(calls[1].signal.aborted).toBe(true);
});
it("Retell case/punctuation and already-heard earlier responses do not force a model restart", async () => {
  const { b, calls, frames } = fixture();
  b.request(1, [user("Tell me"), agent("Earlier answer.")]);
  calls[0].emit("First, second."); calls[0].done(); await tick();
  b.request(2, [user("Tell me"), agent("Earlier answer."), agent("first"), user("yeah")]);
  expect(calls).toHaveLength(1); expect(b.metrics.a).toBe(1);
  expect(frames.filter(f => f.response_id === 2).map(f => f.content).join("")).toBe(" second.");
});
it("short ASR noise cannot switch a RU bridge to English and a repeated model bridge is removed across chunks", async () => {
  const { b, calls, frames } = fixture();
  b.request(1, [user("Пожалуйста расскажи про возможности теста")]); calls[0].emit("Могу помочь.");
  b.request(2, [user("Пожалуйста расскажи про возможности теста"), agent("Могу помочь."), user("gaga")]);
  expect(frames.at(-1).content).toBe("Поняла. ");
  calls[1].emit("По"); calls[1].emit("няла, "); calls[1].emit("расскажите подробнее.");
  calls[1].done(); await tick();
  expect(frames.filter(f => f.response_id === 2).map(f => f.content).join("")).toBe("Поняла. расскажите подробнее.");
});
