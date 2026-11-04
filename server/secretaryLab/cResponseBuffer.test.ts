import { afterEach, describe, expect, it, vi } from "vitest";
import { CResponseBuffer, classifyCInterruption } from "./cResponseBuffer";
import type { SpokenTurn } from "../secretary/conversationEngine";
const user = (content: string): SpokenTurn => ({ role: "user", content });
const agent = (content: string): SpokenTurn => ({ role: "agent", content });
const buffers: CResponseBuffer[] = [];
const tick = async () => { await vi.advanceTimersByTimeAsync(160); };
function fixture() {
  vi.useFakeTimers();
  const frames: any[] = [], calls: Array<{ turns: SpokenTurn[]; signal: AbortSignal; emit: (text: string) => void; done: () => void; fail: (e: Error) => void }> = [];
  const b = new CResponseBuffer({
    generate: (turns, signal, emit) => new Promise<void>((done, fail) => { calls.push({ turns, signal, emit, done, fail }); }),
    send: f => frames.push(f), record: vi.fn(),
    error: () => ({ message: "Test stopped", end: true }),
  });
  buffers.push(b); return { b, frames, calls };
}
afterEach(() => { buffers.splice(0).forEach(b => b.close()); vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("C interruption rules fail conservative", () => {
  it.each(["угу", "да", "ага", "ok", "yeah", "mhm", "yes"])("a: %s", text => {
    expect(classifyCInterruption("Tell me", "Tell me " + text).kind).toBe("a");
  });
  it.each(["нет", "не завтра", "да, но позже", "no", "yeah but Monday", "150", "two", "tomorrow", "когда?", "how?", "actually another place", "повтори"])("c: %s", text => {
    expect(classifyCInterruption("Tell me", "Tell me " + text).kind).toBe("c");
  });
  it("b ignores punctuation and appends; changed numbers and new questions remain c", () => {
    expect(classifyCInterruption("Tell me", "Tell me.").kind).toBe("b");
    expect(classifyCInterruption("Tell me", "Tell me please").kind).toBe("b");
    expect(classifyCInterruption("Tell me", "Tell me about Tuesday").kind).toBe("c");
    expect(classifyCInterruption("Tell me", "Tell me?").kind).toBe("b");
    expect(classifyCInterruption("Tell me", "Tell me новые провода")).toMatchObject({ kind: "b", regenerate: true });
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
  await tick();
  expect(calls[1].turns.at(-1)?.content).toBe("Not Tuesday, Friday");
  expect(frames.some(f => f.response_id === 3 && f.content.includes("Details"))).toBe(false);
});
it("new facts stop stale output quietly; one bridge after 600ms, not another on the next reply", async () => {
  const { b, calls, frames } = fixture();
  b.request(1, [user("Расскажи")]); calls[0].emit("Цена сто.");
  b.update([user("Расскажи"), agent("Цена сто."), user("Нет, 150")], true);
  calls[0].emit(" Завтра.");
  b.request(2, [user("Расскажи"), agent("Цена сто."), user("Нет, 150")]);
  expect(calls[0].signal.aborted).toBe(true);
  expect(b.metrics.bridges).toBe(0);
  calls[0].emit("OLD"); calls[0].done(); await tick();
  await vi.advanceTimersByTimeAsync(590);
  expect(frames.at(-1).content).toBe("Поняла. ");
  calls[1].emit("Цена 150."); calls[1].done(); await tick();
  b.request(3, [user("Расскажи"), agent("Цена сто."), user("Нет, 150"), agent("Цена 150."), user("Нет, завтра в 10")]);
  await vi.advanceTimersByTimeAsync(610);
  expect(b.metrics).toMatchObject({ c: 2, restarts: 2, bridges: 1 });
  expect(frames.some(f => f.content.includes("OLD"))).toBe(false);
});
it("unverified played text is never assumed to match the generated claim", () => {
  const { b, calls } = fixture();
  b.request(1, [user("Tell me")]); calls[0].emit("Price 150.");
  b.request(2, [user("Tell me"), agent("Price 100."), user("yeah")]);
  expect(b.metrics).toMatchObject({ ambiguousPlayback: 1, b: 1, c: 0, reused: 0, bridges: 0 });
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
  b.request(2, [user("Пожалуйста расскажи про возможности теста"), agent("Могу помочь."), user("no")]);
  await vi.advanceTimersByTimeAsync(750);
  expect(frames.at(-1).content).toBe("Поняла. ");
  calls[1].emit("По"); calls[1].emit("няла, "); calls[1].emit("расскажите подробнее.");
  calls[1].done(); await tick();
  expect(frames.filter(f => f.response_id === 2).map(f => f.content).join("")).toBe("Поняла. расскажите подробнее.");
});
it("never emits a bridge if first token is faster than 600ms or the caller is speaking", async () => {
  const { b, calls, frames } = fixture();
  b.request(1, [user("Расскажи")]); calls[0].emit("Ответ.");
  b.request(2, [user("Расскажи"), agent("Ответ."), user("Нет, 156 долларов")]);
  await tick(); calls[1].emit("Новая сумма.");
  await vi.advanceTimersByTimeAsync(600);
  expect(b.metrics.bridges).toBe(0);
  b.request(3, [user("Расскажи"), agent("Ответ."), user("Нет, 377.66")]);
  b.update([user("Расскажи"), agent("Ответ."), user("Нет, 377.66 долларов")], true);
  const n = frames.length; await vi.advanceTimersByTimeAsync(700);
  expect(frames).toHaveLength(n); expect(b.metrics.bridges).toBe(0);
});
it("coalesces many updates, retains the phrase bridge/token deadline, and never speaks stale dollars", async () => {
  const { b, calls, frames } = fixture();
  b.request(1, [user("Сумма 156 долларов")]); calls[0].emit("Сумма 156.");
  b.request(2, [user("Нет 377")]);
  b.request(3, [user("Нет 377.66")]);
  b.request(4, [user("Нет 377.66 долларов")]);
  expect(b.metrics.bridges).toBe(0); expect(calls).toHaveLength(1);
  await tick(); expect(calls).toHaveLength(2);
  calls[0].emit("OLD 156."); calls[0].done();
  await vi.advanceTimersByTimeAsync(450);
  expect(b.metrics.bridges).toBe(0);
  calls[1].emit("Сумма 377.66."); calls[1].done(); await tick();
  b.request(5, [user("Нет 377.66 долларов.")]);
  await vi.advanceTimersByTimeAsync(700);
  expect(b.metrics.bridges).toBe(0);
  expect(frames.filter(f => f.response_id >= 2).map(f => f.content).join("")).not.toContain("156");
});
it("RU/EN word endings and appended content are silent b, while written-out amounts stay c", () => {
  for (const [a,b] of [["купит","купить"],["Tell me","Tell me about the picnic"],["156 доллар","156 долларов"]])
    expect(classifyCInterruption(a,b)).toMatchObject({ kind: "b", regenerate: true });
  expect(classifyCInterruption("сумма сто пятьдесят", "сумма триста семьдесят")).toMatchObject({ kind: "c" });
});
it("no more than one bridge in three substantive agent replies, cycling all alternatives", async () => {
  const { b, calls } = fixture(); const turns: SpokenTurn[] = [];
  for (let i=1; i<=7; i++) {
    turns.push(user("Нет, " + i)); b.request(i, [...turns]);
    await vi.advanceTimersByTimeAsync(760);
    calls.at(-1)!.emit("Ответ " + i); calls.at(-1)!.done(); await tick();
    turns.push(agent("Ответ " + i));
  }
  expect(b.metrics.bridges).toBe(2);
  expect(b.metrics.events.filter(e => e.kind === "bridge").map(e => e.reason)).toEqual(["Поняла.", "Хорошо."]);
  // The first cold start does not need a filler; bridges occur on later c turns.
});
it("adjacent transcript fragments do not count as three secretary replies", async () => {
  const { b, calls } = fixture();
  const turns: SpokenTurn[] = [user("Расскажи")];
  b.request(1, [...turns]); calls[0].emit("Содержательная часть ответа."); calls[0].done(); await tick();
  turns.push(agent("Содержательная"), agent("часть"), agent("ответа."), user("Нет, 156"));
  b.request(2, [...turns]); await vi.advanceTimersByTimeAsync(760);
  expect(b.metrics.bridges).toBe(1);
  calls[1].emit("Новая сумма принята."); calls[1].done(); await tick();
  turns.push(agent("Новая"), agent("сумма"), agent("принята."), user("Нет, 377"));
  b.request(3, [...turns]); await vi.advanceTimersByTimeAsync(760);
  expect(b.metrics.bridges).toBe(1);
});
